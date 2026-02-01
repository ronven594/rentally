/**
 * Strike Eligibility - Per-Due-Date Strike Tracking
 *
 * Implements RTA Section 55(1)(aa) correctly:
 * "On 3 separate occasions within a 90-day period, an amount of rent
 *  that was due has remained unpaid for at least 5 working days."
 *
 * KEY INSIGHT: "Separate occasion" = a DIFFERENT rent due date.
 * - Each strike must be tied to a specific due date
 * - Cannot issue 2 strikes for the same due date
 * - Tenant does NOT need to pay up between strikes
 * - Even if tenant later pays, the strike remains valid
 *
 * This replaces the old 5/10/15 continuous working day thresholds.
 */

import {
    getEffectiveToday,
    countWorkingDaysBetween,
    findFirstDueDate,
    advanceDueDate,
    isBefore,
    isSameDay,
    startOfDay,
    parseDateISO,
    formatDateISO,
    addDays,
    daysBetween,
    type DueDateSettings,
    type PaymentFrequency,
} from "./date-utils";
import type { NZRegion } from "./nz-holidays";
import type { StrikeNotice } from "@/types";
import type { RentSettings } from "./rent-calculator";
import { STRIKE_NOTICE_WORKING_DAYS, STRIKE_EXPIRY_DAYS, MAX_STRIKES } from "./rta-constants";

// ============================================================================
// TYPES
// ============================================================================

export interface DueDateStrikeStatus {
    /** The rent due date */
    dueDate: Date;
    /** Working days this due date is overdue */
    workingDaysOverdue: number;
    /** Whether this due date is 5+ working days overdue (strike-eligible) */
    isStrikeEligible: boolean;
    /** Whether a strike has already been issued for this specific due date */
    strikeAlreadyIssued: boolean;
    /** The strike notice for this due date, if one exists */
    existingStrikeNotice: StrikeNotice | null;
}

export interface StrikeEligibilityResult {
    /** Whether a new strike can be issued right now */
    canIssueStrike: boolean;
    /** What strike number this would be (1, 2, or 3), or null */
    nextStrikeNumber: number | null;
    /** The due date the next strike would be for, or null */
    nextStrikeableDueDate: Date | null;
    /** Working days overdue for the next strikeable due date */
    nextStrikeableWorkingDays: number | null;
    /** Number of active strikes in the current 90-day window */
    activeStrikesIn90Days: number;
    /** All due dates with their strike status (for UI display) */
    dueDateStatuses: DueDateStrikeStatus[];
    /** When the 90-day window expires (null if no active strikes) */
    windowExpiryDate: string | null;

    // Legacy compatibility fields
    canIssueStrike1: boolean;
    canIssueStrike2: boolean;
    canIssueStrike3: boolean;
    activeStrikes: number;
    nextStrikeThreshold: number | null;
}

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Get all due dates from first due date up to effective date, and check
 * each one's strike eligibility status.
 *
 * A due date is strike-eligible if:
 * 1. It is 5+ working days overdue (from that due date to effective date)
 * 2. No strike notice has already been issued for that specific due date
 */
export function getDueDateStatuses(
    settings: RentSettings,
    sentNotices: StrikeNotice[],
    effectiveDate: Date,
    region?: NZRegion
): DueDateStrikeStatus[] {
    const dueDateSettings: DueDateSettings = {
        frequency: settings.frequency,
        dueDay: settings.rentDueDay,
    };

    const trackingStart = parseDateISO(settings.trackingStartDate);
    const firstDueDate = findFirstDueDate(trackingStart, dueDateSettings);

    // Only look at strike notices (not REMEDY_NOTICE)
    const strikeNotices = sentNotices.filter(n => n.type !== 'REMEDY_NOTICE');

    const statuses: DueDateStrikeStatus[] = [];
    let currentDue = firstDueDate;
    const maxIterations = 500;
    let iterations = 0;

    while (iterations < maxIterations) {
        // Stop once we pass the effective date (future due dates aren't overdue)
        if (!isBefore(currentDue, effectiveDate) && !isSameDay(currentDue, effectiveDate)) {
            break;
        }

        const workingDaysOverdue = countWorkingDaysBetween(currentDue, effectiveDate, region);

        // Find if a strike was already issued for this specific due date
        const dueDateStr = formatDateISO(currentDue);
        const existingStrike = strikeNotices.find(
            n => n.dueDateFor && n.dueDateFor === dueDateStr
        ) || null;

        statuses.push({
            dueDate: startOfDay(currentDue),
            workingDaysOverdue,
            isStrikeEligible: workingDaysOverdue >= STRIKE_NOTICE_WORKING_DAYS,
            strikeAlreadyIssued: !!existingStrike,
            existingStrikeNotice: existingStrike,
        });

        currentDue = advanceDueDate(currentDue, dueDateSettings);
        iterations++;
    }

    return statuses;
}

/**
 * Find the next due date that can receive a strike notice.
 * Returns the oldest eligible due date that doesn't already have a strike.
 */
export function getNextStrikeableDueDate(
    dueDateStatuses: DueDateStrikeStatus[]
): DueDateStrikeStatus | null {
    return dueDateStatuses.find(
        d => d.isStrikeEligible && !d.strikeAlreadyIssued
    ) || null;
}

/**
 * Count strikes that are still active (within 90-day rolling window).
 * Uses officialServiceDate (OSD), not sentAt.
 */
export function countActiveStrikesIn90DayWindow(
    sentNotices: StrikeNotice[],
    effectiveDate: Date
): number {
    const windowStart = addDays(effectiveDate, -STRIKE_EXPIRY_DAYS);

    return sentNotices.filter(notice => {
        if (notice.type === 'REMEDY_NOTICE') return false;
        const osd = parseDateISO(notice.officialServiceDate);
        return (isBefore(windowStart, osd) || isSameDay(windowStart, osd)) &&
            (isBefore(osd, effectiveDate) || isSameDay(osd, effectiveDate));
    }).length;
}

/**
 * Get the 90-day window expiry date based on the oldest active strike.
 * Returns null if no active strikes exist.
 */
export function getStrikeWindowExpiry(
    sentNotices: StrikeNotice[],
    effectiveDate: Date
): string | null {
    const windowStart = addDays(effectiveDate, -STRIKE_EXPIRY_DAYS);

    const activeStrikes = sentNotices.filter(notice => {
        if (notice.type === 'REMEDY_NOTICE') return false;
        const osd = parseDateISO(notice.officialServiceDate);
        return (isBefore(windowStart, osd) || isSameDay(windowStart, osd)) &&
            (isBefore(osd, effectiveDate) || isSameDay(osd, effectiveDate));
    });

    if (activeStrikes.length === 0) return null;

    // Find the oldest active strike
    const oldestOSD = activeStrikes
        .map(s => s.officialServiceDate)
        .sort()[0];

    const expiryDate = addDays(parseDateISO(oldestOSD), STRIKE_EXPIRY_DAYS);
    return formatDateISO(expiryDate);
}

/**
 * Calculate complete strike eligibility using per-due-date logic.
 *
 * This is the main entry point that replaces the old
 * calculateStrikeEligibility(workingDaysOverdue, activeStrikes).
 */
export function calculateStrikeEligibilityPerDueDate(
    settings: RentSettings,
    sentNotices: StrikeNotice[],
    effectiveDate: Date,
    region?: NZRegion
): StrikeEligibilityResult {
    // Get all due dates and their strike status
    const dueDateStatuses = getDueDateStatuses(settings, sentNotices, effectiveDate, region);

    // Count active strikes in 90-day window
    const activeStrikes = countActiveStrikesIn90DayWindow(sentNotices, effectiveDate);

    // Find next strikeable due date
    const nextStrikeable = getNextStrikeableDueDate(dueDateStatuses);

    // Can only issue if there's an eligible due date AND we haven't hit 3 strikes
    const canIssueStrike = nextStrikeable !== null && activeStrikes < MAX_STRIKES;
    const nextStrikeNumber = canIssueStrike ? activeStrikes + 1 : null;

    // Window expiry
    const windowExpiryDate = getStrikeWindowExpiry(sentNotices, effectiveDate);

    return {
        canIssueStrike,
        nextStrikeNumber,
        nextStrikeableDueDate: nextStrikeable?.dueDate || null,
        nextStrikeableWorkingDays: nextStrikeable?.workingDaysOverdue || null,
        activeStrikesIn90Days: activeStrikes,
        dueDateStatuses,
        windowExpiryDate,

        // Legacy compatibility
        canIssueStrike1: canIssueStrike && nextStrikeNumber === 1,
        canIssueStrike2: canIssueStrike && nextStrikeNumber === 2,
        canIssueStrike3: canIssueStrike && nextStrikeNumber === 3,
        activeStrikes,
        nextStrikeThreshold: canIssueStrike ? STRIKE_NOTICE_WORKING_DAYS : null,
    };
}
