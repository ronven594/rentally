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
    /** Whether strike 1 can be issued (5+ working days, <1 active strikes) */
    canIssueStrike1: boolean;
    /** Whether strike 2 can be issued (10+ working days, <2 active strikes) */
    canIssueStrike2: boolean;
    /** Whether strike 3 can be issued (15+ working days, <3 active strikes) */
    canIssueStrike3: boolean;
    /** Strikes within 90-day rolling window */
    activeStrikes: number;
    /** Next strike number to issue (1, 2, 3), or null if all issued or not eligible */
    nextStrikeNumber: number | null;
    /** The next strike's working day threshold */
    nextStrikeThreshold: number | null;
}

export interface NoticeEligibility {
    /** 14-day remedy notice: available whenever tenant is in arrears */
    canIssue14DayNotice: boolean;
    /** Whether remedy notice has already been sent */
    hasRemedyNotice: boolean;
    /** Whether landlord can apply to Tenancy Tribunal for termination */
    canApplyForTermination: boolean;
    /** Which RTA section applies */
    terminationBasis: '21_day_rule' | 'three_strikes' | null;
    /** Days remaining to file at tribunal (after 3rd strike, 28-day window) */
    tribunalDeadlineDays: number | null;
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

    // Step 3: Count active strikes (90-day window)
    const activeStrikes = countActiveStrikes(sentNotices, effectiveDate);

    // Step 4: Determine severity tier
    const severity = determineSeverity(
        rentState.currentBalance,
        rentState.daysOverdue,
        workingDaysOverdue,
        activeStrikes,
        sentNotices,
        remedyNoticeSentAt
    );

    // Step 5: Calculate strike eligibility
    const strikes = calculateStrikeEligibility(workingDaysOverdue, activeStrikes);

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
    remedyNoticeSentAt?: string | null
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

    // TIER 4: RED_SOLID_STRIKE - 15+ working days (Strike 3 zone)
    if (workingDaysOverdue >= 15) {
        const nextButton = getNextStrikeButton(activeStrikes, 3);
        return {
            tier: 4,
            tierName: 'RED_SOLID_STRIKE',
            color: '#FF3B3B',
            label: 'Strike 3 Ready',
            description: `${workingDaysOverdue} working days overdue`,
            bannerText: activeStrikes === 2
                ? `STRIKE 3 READY (90-DAY WINDOW ACTIVE) - ${workingDaysOverdue} WORKING DAYS OVERDUE`
                : activeStrikes === 1
                    ? 'STRIKE 3 READY (ISSUE STRIKE 2 NOTICE FIRST)'
                    : 'STRIKE 3 READY (ISSUE STRIKE 1 & 2 FIRST)',
            buttonText: nextButton
        };
    }

    // TIER 3: RED_SOLID_STRIKE - 10-14 working days (Strike 2 zone)
    if (workingDaysOverdue >= 10) {
        const nextButton = getNextStrikeButton(activeStrikes, 2);
        return {
            tier: 3,
            tierName: 'RED_SOLID_STRIKE',
            color: '#FF3B3B',
            label: 'Strike 2 Ready',
            description: `${workingDaysOverdue} working days overdue`,
            bannerText: activeStrikes === 1
                ? `STRIKE 2 NOTICE READY - ${workingDaysOverdue} WORKING DAYS OVERDUE`
                : 'STRIKE 2 READY (SEND STRIKE 1 NOTICE FIRST)',
            buttonText: nextButton
        };
    }

    // TIER 2: GOLD_SOLID - 5-9 working days (Strike 1 eligible)
    if (workingDaysOverdue >= 5) {
        return {
            tier: 2,
            tierName: 'GOLD_SOLID',
            color: '#FBBF24',
            label: 'Strike 1 Ready',
            description: `${workingDaysOverdue} working days overdue`,
            bannerText: `STRIKE 1 NOTICE READY - ${workingDaysOverdue} WORKING DAYS OVERDUE`,
            buttonText: activeStrikes === 0 ? 'ISSUE STRIKE 1' : 'VIEW STRIKES'
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

/**
 * Get the correct button text for sequential strike issuance.
 * CRITICAL: Must send strikes in order (1 → 2 → 3).
 */
function getNextStrikeButton(activeStrikes: number, targetStrike: number): string {
    if (activeStrikes === 0) return 'ISSUE STRIKE 1 NOTICE';
    if (activeStrikes === 1) return 'ISSUE STRIKE 2 NOTICE';
    if (activeStrikes === 2) return 'ISSUE STRIKE 3 NOTICE';
    return 'VIEW STRIKES';
}

// ============================================================================
// STRIKE ELIGIBILITY
// ============================================================================

/**
 * Calculate strike eligibility based on working days and active strikes.
 *
 * RTA thresholds (sequential):
 * - Strike 1: 5+ working days overdue
 * - Strike 2: 10+ working days overdue (requires Strike 1 first)
 * - Strike 3: 15+ working days overdue (requires Strikes 1 & 2 first)
 */
function calculateStrikeEligibility(
    workingDaysOverdue: number,
    activeStrikes: number
): StrikeEligibility {
    const canIssueStrike1 = workingDaysOverdue >= STRIKE_NOTICE_WORKING_DAYS && activeStrikes < 1;
    const canIssueStrike2 = workingDaysOverdue >= STRIKE_NOTICE_WORKING_DAYS * 2 && activeStrikes >= 1 && activeStrikes < 2;
    const canIssueStrike3 = workingDaysOverdue >= STRIKE_NOTICE_WORKING_DAYS * 3 && activeStrikes >= 2 && activeStrikes < 3;

    // Determine next strike number (sequential order)
    let nextStrikeNumber: number | null = null;
    let nextStrikeThreshold: number | null = null;

    if (canIssueStrike1) {
        nextStrikeNumber = 1;
        nextStrikeThreshold = STRIKE_NOTICE_WORKING_DAYS;
    } else if (canIssueStrike2) {
        nextStrikeNumber = 2;
        nextStrikeThreshold = STRIKE_NOTICE_WORKING_DAYS * 2;
    } else if (canIssueStrike3) {
        nextStrikeNumber = 3;
        nextStrikeThreshold = STRIKE_NOTICE_WORKING_DAYS * 3;
    }

    return {
        canIssueStrike1,
        canIssueStrike2,
        canIssueStrike3,
        activeStrikes,
        nextStrikeNumber,
        nextStrikeThreshold
    };
}

/**
 * Count strikes within the 90-day rolling window.
 * Only counts STRIKE_1/2/3 notices (not REMEDY_NOTICE).
 * Uses officialServiceDate for the window calculation.
 */
function countActiveStrikes(sentNotices: StrikeNotice[], effectiveDate: Date): number {
    const windowStart = addDays(effectiveDate, -STRIKE_EXPIRY_DAYS);

    return sentNotices.filter(notice => {
        // Only count strike notices
        if (notice.type === 'REMEDY_NOTICE') return false;

        const osd = new Date(notice.officialServiceDate);
        // Valid if within 0-90 days
        return osd >= windowStart && osd <= effectiveDate;
    }).length;
}

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
    let terminationBasis: '21_day_rule' | 'three_strikes' | null = null;
    let tribunalDeadlineDays: number | null = null;

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
    // This takes priority for display if both paths apply
    if (calendarDaysOverdue >= TERMINATION_ELIGIBLE_DAYS) {
        canApplyForTermination = true;
        // Only override basis if 3-strike path isn't already set
        if (!terminationBasis) {
            terminationBasis = '21_day_rule';
        }
    }

    return {
        canIssue14DayNotice,
        hasRemedyNotice,
        canApplyForTermination,
        terminationBasis,
        tribunalDeadlineDays
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
    const sinceDate = rentState.oldestUnpaidDueDate
        ? formatDateDisplay(rentState.oldestUnpaidDueDate, 'MMM d')
        : '';

    return {
        primary: sinceDate
            ? `${rentState.daysOverdue} days overdue since ${sinceDate}`
            : `${rentState.daysOverdue} days overdue`,
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
