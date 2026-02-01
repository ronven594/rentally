/**
 * Status Calculator - Complete Tenant Status Determination
 *
 * This builds on calculateRentState() (Session 2) and adds:
 * - Working days calculation (NZ RTA compliance)
 * - 5-tier severity system (GREEN → AMBER → GOLD → RED → BREATHING RED)
 * - Strike eligibility (sequential: 5/10/15 working days)
 * - 14-day notice eligibility
 * - Termination eligibility (21-day rule OR 3-strike rule)
 *
 * SINGLE SOURCE OF TRUTH for tenant status.
 * TenantCard.tsx, StrikeBar.tsx, and all UI components should consume
 * the output of calculateTenantStatus() rather than computing status independently.
 */

import {
    calculateRentState,
    type RentSettings,
    type Payment,
    type RentCalculationResult
} from "./rent-calculator";

import {
    getEffectiveToday,
    countWorkingDaysBetween,
    formatDateDisplay,
    addDays,
    type PaymentFrequency
} from "./date-utils";

import type { NZRegion } from "./nz-holidays";
import type { StrikeNotice } from "@/types";

import {
    STRIKE_NOTICE_WORKING_DAYS,
    STRIKE_EXPIRY_DAYS,
    TERMINATION_ELIGIBLE_DAYS,
    MAX_STRIKES,
    TRIBUNAL_FILING_WINDOW_DAYS
} from "./rta-constants";

import {
    calculateStrikeEligibilityPerDueDate,
    type StrikeEligibilityResult,
    type DueDateStrikeStatus,
} from "./strike-eligibility";

// ============================================================================
// TYPES
// ============================================================================

/** 5-tier severity: 0 = Green, 5 = Breathing Red */
export type SeverityTier = 0 | 1 | 2 | 3 | 4 | 5;

/** Named tier for UI mapping */
export type SeverityTierName =
    | 'GREEN'
    | 'AMBER_OUTLINE'
    | 'GOLD_SOLID'
    | 'RED_SOLID_STRIKE'
    | 'RED_BREATHING_TERMINATION';

export interface SeverityInfo {
    tier: SeverityTier;
    tierName: SeverityTierName;
    color: string;
    label: string;
    description: string;
    /** Banner text for TenantCard */
    bannerText: string;
    /** Primary action button text */
    buttonText: string;
    /** For dual-path termination logic */
    strikeCount?: number;
}

export interface StrikeEligibility {
    /** Whether strike 1 can be issued */
    canIssueStrike1: boolean;
    /** Whether strike 2 can be issued */
    canIssueStrike2: boolean;
    /** Whether strike 3 can be issued */
    canIssueStrike3: boolean;
    /** Strikes within 90-day rolling window */
    activeStrikes: number;
    /** Next strike number to issue (1, 2, 3), or null if all issued or not eligible */
    nextStrikeNumber: number | null;
    /** The next strike's working day threshold (always 5 in per-due-date model) */
    nextStrikeThreshold: number | null;
    /** Whether a new strike can be issued (any eligible due date exists) */
    canIssueStrike: boolean;
    /** The specific due date the next strike would be for */
    nextStrikeableDueDate: Date | null;
    /** Working days overdue for the next strikeable due date */
    nextStrikeableWorkingDays: number | null;
    /** When the 90-day window expires */
    windowExpiryDate: string | null;
    /** Per-due-date status breakdown (for UI) */
    dueDateStatuses: DueDateStrikeStatus[];
}

export interface NoticeEligibility {
    /** 14-day remedy notice: available whenever tenant is in arrears */
    canIssue14DayNotice: boolean;
    /** Whether remedy notice has already been sent */
    hasRemedyNotice: boolean;
    /** Whether landlord can apply to Tenancy Tribunal for termination */
    canApplyForTermination: boolean;
    /** Which RTA section applies */
    terminationBasis: '21_day_rule' | 'three_strikes' | 'section_56_expired' | null;
    /** Days remaining to file at tribunal (after 3rd strike, 28-day window) */
    tribunalDeadlineDays: number | null;
    /** Section 56: 14-day remedy notice expired and tenant hasn't remedied */
    section56Expired: boolean;
}

export interface TenantStatusResult {
    /** Base rent calculation from rent-calculator.ts */
    rentState: RentCalculationResult;

    /** NZ working days overdue (excludes weekends, holidays, summer blackout) */
    workingDaysOverdue: number;

    /** 5-tier severity with colors and display text */
    severity: SeverityInfo;

    /** Strike eligibility based on working days and sent notices */
    strikes: StrikeEligibility;

    /** Notice and termination eligibility */
    notices: NoticeEligibility;

    /** Pre-formatted display strings */
    displayText: {
        /** e.g. "Paid until Jan 14" or "8 days overdue since Jan 8" */
        primary: string;
        /** e.g. "$400 outstanding" or "Paid in full" */
        secondary: string;
    };
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Calculate complete tenant status.
 *
 * This is the SINGLE ENTRY POINT for all status determination.
 * It composes: rent calculation → working days → severity → strikes → notices.
 *
 * @param settings - Rent settings (from toRentSettings())
 * @param payments - Actual payments received (from toPayments())
 * @param sentNotices - Strike/remedy notices from tenant record
 * @param remedyNoticeSentAt - ISO date of remedy notice (if sent)
 * @param region - NZ region for regional holidays
 * @param testDate - Optional test date override
 */
export function calculateTenantStatus(
    settings: RentSettings,
    payments: Payment[],
    sentNotices: StrikeNotice[],
    remedyNoticeSentAt?: string | null,
    region?: NZRegion,
    testDate?: Date | null
): TenantStatusResult {
    // Step 1: Get base rent state (deterministic balance calculation)
    const rentState = calculateRentState(settings, payments, testDate);

    // Step 2: Calculate working days overdue
    const effectiveDate = getEffectiveToday(testDate);
    const workingDaysOverdue = rentState.isOverdue && rentState.oldestUnpaidDueDate
        ? countWorkingDaysBetween(rentState.oldestUnpaidDueDate, effectiveDate, region)
        : 0;

    // Step 3: Calculate per-due-date strike eligibility (replaces old 5/10/15 model)
    const strikeResult = calculateStrikeEligibilityPerDueDate(
        settings,
        sentNotices,
        effectiveDate,
        region
    );
    const activeStrikes = strikeResult.activeStrikes;

    // Step 4: Determine severity tier
    const severity = determineSeverity(
        rentState.currentBalance,
        rentState.daysOverdue,
        workingDaysOverdue,
        activeStrikes,
        sentNotices,
        remedyNoticeSentAt,
        strikeResult.canIssueStrike,
        strikeResult.nextStrikeNumber
    );

    // Step 5: Map strike eligibility result to StrikeEligibility interface
    const strikes: StrikeEligibility = {
        ...strikeResult,
    };

    // Step 6: Calculate notice eligibility
    const notices = calculateNoticeEligibility(
        rentState.daysOverdue,
        activeStrikes,
        rentState.isOverdue,
        remedyNoticeSentAt,
        sentNotices,
        effectiveDate
    );

    // Step 7: Generate display text
    const displayText = generateDisplayText(rentState);

    return {
        rentState,
        workingDaysOverdue,
        severity,
        strikes,
        notices,
        displayText
    };
}

// ============================================================================
// SEVERITY DETERMINATION
// ============================================================================

/**
 * Determine the 5-tier severity level.
 *
 * Ported from TenantCard.tsx getTenantSeverity() - this is the canonical version.
 *
 * TIER HIERARCHY (highest priority first):
 *   5 - RED_BREATHING_TERMINATION: 21+ calendar days OR 3+ strikes
 *   4 - RED_SOLID_STRIKE (15+ working days)
 *   3 - RED_SOLID_STRIKE (10-14 working days)
 *   2 - GOLD_SOLID (5-9 working days, strike 1 eligible)
 *   1 - AMBER_OUTLINE (1-4 working days)
 *   0 - GREEN (paid or <1 working day overdue)
 */
function determineSeverity(
    balance: number,
    calendarDaysOverdue: number,
    workingDaysOverdue: number,
    activeStrikes: number,
    sentNotices: StrikeNotice[],
    remedyNoticeSentAt?: string | null,
    canIssueStrike?: boolean,
    nextStrikeNumber?: number | null
): SeverityInfo {
    // TIER 0: GREEN - No debt
    if (balance <= 0) {
        return {
            tier: 0,
            tierName: 'GREEN',
            color: '#22C55E',
            label: 'Paid',
            description: 'Rent is up to date',
            bannerText: '',
            buttonText: ''
        };
    }

    // TIER 5: RED_BREATHING_TERMINATION
    // Route 1: Section 55(1)(a) - 21+ calendar days overdue
    // Route 2: Section 55(1)(aa) - 3 strikes within 90-day window
    if (calendarDaysOverdue >= TERMINATION_ELIGIBLE_DAYS || activeStrikes >= MAX_STRIKES) {
        return {
            tier: 5,
            tierName: 'RED_BREATHING_TERMINATION',
            color: '#FF3B3B',
            label: 'Termination',
            description: activeStrikes >= MAX_STRIKES
                ? '3 strikes within 90-day window'
                : `${calendarDaysOverdue}+ calendar days overdue`,
            bannerText: activeStrikes >= MAX_STRIKES
                ? 'TERMINATION ELIGIBLE (3 STRIKES - 90-DAY WINDOW)'
                : `TERMINATION ELIGIBLE (TRIBUNAL READY) - ${calendarDaysOverdue} DAYS OVERDUE`,
            buttonText: 'APPLY FOR TERMINATION',
            strikeCount: activeStrikes
        };
    }

    // TIERS 2-4: Strike-eligible tiers (per-due-date model)
    // Tier is determined by which strike number would be next, not cumulative days
    if (canIssueStrike && nextStrikeNumber) {
        if (nextStrikeNumber === 3 || activeStrikes >= 2) {
            // TIER 4: RED_SOLID_STRIKE - Strike 3 eligible
            return {
                tier: 4,
                tierName: 'RED_SOLID_STRIKE',
                color: '#FF3B3B',
                label: 'Strike 3 Ready',
                description: `${workingDaysOverdue} working days overdue`,
                bannerText: `STRIKE 3 READY (90-DAY WINDOW ACTIVE) - ${workingDaysOverdue} WORKING DAYS OVERDUE`,
                buttonText: 'ISSUE STRIKE 3 NOTICE'
            };
        }
        if (nextStrikeNumber === 2 || activeStrikes >= 1) {
            // TIER 3: RED_SOLID_STRIKE - Strike 2 eligible
            return {
                tier: 3,
                tierName: 'RED_SOLID_STRIKE',
                color: '#FF3B3B',
                label: 'Strike 2 Ready',
                description: `${workingDaysOverdue} working days overdue`,
                bannerText: `STRIKE 2 NOTICE READY - ${workingDaysOverdue} WORKING DAYS OVERDUE`,
                buttonText: 'ISSUE STRIKE 2 NOTICE'
            };
        }
        // TIER 2: GOLD_SOLID - Strike 1 eligible
        return {
            tier: 2,
            tierName: 'GOLD_SOLID',
            color: '#FBBF24',
            label: 'Strike 1 Ready',
            description: `${workingDaysOverdue} working days overdue`,
            bannerText: `STRIKE 1 NOTICE READY - ${workingDaysOverdue} WORKING DAYS OVERDUE`,
            buttonText: 'ISSUE STRIKE 1'
        };
    }

    // If we have active strikes but no new one is eligible yet, still show elevated tier
    if (activeStrikes >= 2 && workingDaysOverdue >= 5) {
        return {
            tier: 4,
            tierName: 'RED_SOLID_STRIKE',
            color: '#FF3B3B',
            label: 'Strike Window Active',
            description: `${activeStrikes} strikes in 90-day window`,
            bannerText: `${activeStrikes} STRIKES ACTIVE - MONITORING FOR NEXT ELIGIBLE DUE DATE`,
            buttonText: 'VIEW STRIKES'
        };
    }
    if (activeStrikes >= 1 && workingDaysOverdue >= 5) {
        return {
            tier: 3,
            tierName: 'RED_SOLID_STRIKE',
            color: '#FF3B3B',
            label: 'Strike Window Active',
            description: `${activeStrikes} strike in 90-day window`,
            bannerText: `${activeStrikes} STRIKE ACTIVE - MONITORING FOR NEXT ELIGIBLE DUE DATE`,
            buttonText: 'VIEW STRIKES'
        };
    }

    // 5+ working days overdue but no strike eligible (all due dates already struck)
    if (workingDaysOverdue >= 5) {
        return {
            tier: 2,
            tierName: 'GOLD_SOLID',
            color: '#FBBF24',
            label: 'Overdue',
            description: `${workingDaysOverdue} working days overdue`,
            bannerText: `${workingDaysOverdue} WORKING DAYS OVERDUE`,
            buttonText: activeStrikes > 0 ? 'VIEW STRIKES' : 'ISSUE NOTICE'
        };
    }

    // TIER 1: AMBER_OUTLINE - 1-4 working days overdue
    if (workingDaysOverdue >= 1) {
        const hasRemedyNotice = !!remedyNoticeSentAt;
        return {
            tier: 1,
            tierName: 'AMBER_OUTLINE',
            color: '#D97706',
            label: 'Overdue',
            description: `${workingDaysOverdue} working days overdue`,
            bannerText: hasRemedyNotice ? 'REMEDY NOTICE SENT - MONITORING' : '14-DAY NOTICE TO REMEDY READY',
            buttonText: hasRemedyNotice ? 'VIEW NOTICE' : 'ISSUE NOTICE'
        };
    }

    // Opening arrears with no missed cycles yet — show as amber (debt exists)
    if (balance > 0) {
        return {
            tier: 1,
            tierName: 'AMBER_OUTLINE',
            color: '#D97706',
            label: 'Outstanding',
            description: 'Opening balance outstanding',
            bannerText: '14-DAY NOTICE TO REMEDY READY',
            buttonText: 'ISSUE NOTICE'
        };
    }

    // TIER 0: GREEN - Balance due but <1 working day overdue (payment due today/future)
    return {
        tier: 0,
        tierName: 'GREEN',
        color: '#22C55E',
        label: 'Current',
        description: 'Less than 1 working day overdue',
        bannerText: '',
        buttonText: ''
    };
}


// ============================================================================
// STRIKE ELIGIBILITY
// ============================================================================
// Strike eligibility is now calculated by strike-eligibility.ts using
// per-due-date tracking (RTA Section 55(1)(aa) "separate occasions").
// See calculateStrikeEligibilityPerDueDate() in strike-eligibility.ts.
// ============================================================================

// ============================================================================
// NOTICE ELIGIBILITY
// ============================================================================

/**
 * Calculate notice and termination eligibility.
 *
 * - 14-day remedy notice: Available whenever tenant is in arrears
 * - Termination via Section 55(1)(a): 21+ calendar days overdue
 * - Termination via Section 55(1)(aa): 3 strikes within 90-day window
 * - 28-day tribunal filing window after 3rd strike
 */
function calculateNoticeEligibility(
    calendarDaysOverdue: number,
    activeStrikes: number,
    isOverdue: boolean,
    remedyNoticeSentAt?: string | null,
    sentNotices?: StrikeNotice[],
    effectiveDate?: Date
): NoticeEligibility {
    const canIssue14DayNotice = isOverdue;
    const hasRemedyNotice = !!remedyNoticeSentAt;

    let canApplyForTermination = false;
    let terminationBasis: '21_day_rule' | 'three_strikes' | 'section_56_expired' | null = null;
    let tribunalDeadlineDays: number | null = null;
    let section56Expired = false;

    // Path 0: Section 56 - 14-day remedy notice expired and debt not cleared
    if (hasRemedyNotice && effectiveDate && isOverdue) {
        const remedyOSD = new Date(remedyNoticeSentAt!);
        const expiryDate = addDays(remedyOSD, 14);
        if (effectiveDate > expiryDate) {
            section56Expired = true;
            canApplyForTermination = true;
            terminationBasis = 'section_56_expired';
        }
    }

    // Path 1: 3 strikes within 90-day window → Section 55(1)(aa)
    if (activeStrikes >= MAX_STRIKES) {
        canApplyForTermination = true;
        terminationBasis = 'three_strikes';

        // Calculate tribunal filing deadline (28 days from 3rd strike OSD)
        if (sentNotices && effectiveDate) {
            const thirdStrike = findThirdStrike(sentNotices);
            if (thirdStrike) {
                const osd = new Date(thirdStrike.officialServiceDate);
                const deadline = addDays(osd, TRIBUNAL_FILING_WINDOW_DAYS);
                const daysRemaining = Math.max(0, Math.ceil(
                    (deadline.getTime() - effectiveDate.getTime()) / (1000 * 60 * 60 * 24)
                ));
                tribunalDeadlineDays = daysRemaining;
            }
        }
    }

    // Path 2: 21+ calendar days overdue → Section 55(1)(a)
    if (calendarDaysOverdue >= TERMINATION_ELIGIBLE_DAYS) {
        canApplyForTermination = true;
        if (!terminationBasis || terminationBasis === 'section_56_expired') {
            terminationBasis = '21_day_rule';
        }
    }

    return {
        canIssue14DayNotice,
        hasRemedyNotice,
        canApplyForTermination,
        terminationBasis,
        tribunalDeadlineDays,
        section56Expired,
    };
}

/**
 * Find the 3rd strike notice (most recent STRIKE_3, or 3rd strike by OSD order)
 */
function findThirdStrike(sentNotices: StrikeNotice[]): StrikeNotice | null {
    // Look for explicit STRIKE_3
    const strike3 = sentNotices.find(n => n.type === 'STRIKE_3');
    if (strike3) return strike3;

    // Fallback: find the 3rd strike notice by OSD order
    const strikes = sentNotices
        .filter(n => n.type !== 'REMEDY_NOTICE')
        .sort((a, b) => new Date(a.officialServiceDate).getTime() - new Date(b.officialServiceDate).getTime());

    return strikes.length >= 3 ? strikes[2] : null;
}

// ============================================================================
// DISPLAY TEXT
// ============================================================================

/**
 * Generate human-readable display text from rent state.
 */
function generateDisplayText(rentState: RentCalculationResult): {
    primary: string;
    secondary: string;
} {
    if (!rentState.isOverdue) {
        // Credit balance
        if (rentState.currentBalance < 0) {
            return {
                primary: 'Credit balance',
                secondary: `$${Math.abs(rentState.currentBalance).toFixed(2)} in credit`
            };
        }

        // Paid until date
        if (rentState.paidUntilDate) {
            return {
                primary: `Paid until ${formatDateDisplay(rentState.paidUntilDate, 'MMM d')}`,
                secondary: 'Rent is current'
            };
        }

        // No payment due yet
        return {
            primary: 'Current',
            secondary: 'No payment due yet'
        };
    }

    // Overdue
    // If oldestUnpaidDueDate is null, debt is purely from opening arrears
    // (no rent cycles have been missed yet) — show balance without overdue date
    if (!rentState.oldestUnpaidDueDate) {
        return {
            primary: `$${rentState.currentBalance.toFixed(2)} outstanding`,
            secondary: 'Opening balance'
        };
    }

    const sinceDate = formatDateDisplay(rentState.oldestUnpaidDueDate, 'MMM d');
    return {
        primary: `${rentState.daysOverdue} days overdue since ${sinceDate}`,
        secondary: `$${rentState.currentBalance.toFixed(2)} outstanding`
    };
}

// ============================================================================
// EXPORTS
// ============================================================================

export type {
    RentSettings,
    Payment,
    RentCalculationResult,
    PaymentFrequency
};

export type { DueDateStrikeStatus } from "./strike-eligibility";
