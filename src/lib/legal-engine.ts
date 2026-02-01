/**
 * NZ Tenancy Legal Engine
 *
 * Implements the legal logic for the NZ Residential Tenancies Act 1986.
 * Handles service date calculations, strike tracking, and tribunal eligibility.
 *
 * Key Sections Covered:
 * - Section 55(1)(aa): 3-Strike Rent Rule
 * - Section 55(1)(a): 21 Days In Arrears
 * - Section 55A: Anti-social Behaviour (3 Strikes)
 * - Section 56: 14-Day Notice to Remedy
 *
 * IMPORTANT: This file uses date-utils.ts for all foundational date operations.
 * Working day calculations, timezone handling, and core date utilities
 * are imported from the unified date-utils module.
 */

import { format, parseISO, isAfter, isBefore, isEqual, startOfDay, differenceInCalendarDays } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { type NZRegion } from "@/lib/nz-holidays";

// Import from unified date-utils module
import {
    NZ_TIMEZONE,
    isNZWorkingDay,
    getNextWorkingDay,
    countWorkingDaysBetween,
    addWorkingDays,
    addDays,
    daysBetween
} from "./date-utils";

// ============================================================================
// TYPES
// ============================================================================

export type NoticeType = "S55_STRIKE" | "S55A_SOCIAL" | "S56_REMEDY" | "S55_21DAYS";
export type AnalysisStatus = "ACTION_REQUIRED" | "COMPLIANT" | "TRIBUNAL_ELIGIBLE";

/**
 * Metadata structure for S56_REMEDY notices (stored in notices.metadata JSONB)
 *
 * CRITICAL: A 14-Day Notice to Remedy is DEBT-SPECIFIC.
 * If the specific debt mentioned in the notice is paid, the notice is "spent"
 * even if new debt has appeared since.
 */
export interface S56NoticeMetadata {
    /** Snapshot of ledger entry IDs that were unpaid when notice was issued */
    ledger_entry_ids: string[];
    /** Snapshot of due dates that were unpaid when notice was issued */
    due_dates: string[];
    /** Total amount owed at time of notice issuance */
    total_amount_owed: number;
    /** Individual unpaid amounts by due date for detailed tracking */
    unpaid_amounts: Record<string, number>;
}

export interface StrikeRecord {
    noticeId: string;
    sentDate: string;           // ISO timestamp when email was sent
    officialServiceDate: string; // Calculated OSD (YYYY-MM-DD)
    type: NoticeType;
    rentDueDate?: string;       // For rent strikes
    amountOwed?: number;
    /**
     * CRITICAL for S56_REMEDY notices: Contains snapshot of specific debt
     * This allows checking if the SPECIFIC debt mentioned in the notice was paid,
     * not just whether there's ANY current debt.
     */
    metadata?: S56NoticeMetadata | Record<string, any>;
}

export interface BehaviorNote {
    id: string;
    date: string;
    description: string;
    isStrike: boolean;
    officialServiceDate?: string;
}

export interface LedgerEntry {
    id: string;
    tenantId: string;
    dueDate: string;
    paidDate?: string;
    amount: number;
    amountPaid?: number;
    status: "Paid" | "Late" | "Unpaid" | "Pending" | "Partial";
}

export interface AnalysisInput {
    tenantId: string;
    region?: NZRegion;
    ledger: LedgerEntry[];
    strikeHistory: StrikeRecord[];
    behaviorNotes?: BehaviorNote[];
    currentDate?: Date; // For testing - defaults to now
    trackingStartDate?: string; // When we started tracking this tenant (YYYY-MM-DD) - defaults to today
    openingArrears?: number; // Any existing debt when we started tracking (defaults to 0)
}

/**
 * TRACKING START DATE LOGIC
 * This ensures the UI only reflects debt incurred AFTER we started tracking this tenant.
 * Any debt before the tracking start date should be captured in openingArrears instead.
 */
export function getValidLedger(ledger: LedgerEntry[], trackingStartDate: string): LedgerEntry[] {
    const floorDate = parseISO(trackingStartDate);

    return ledger.filter(entry => {
        const dueDate = parseISO(entry.dueDate);
        // Remove any entries that fall before the tracking start date
        // We keep entries ON the tracking start date, but filter out anything BEFORE
        return isAfter(dueDate, floorDate) || isEqual(dueDate, floorDate);
    });
}

export interface AnalysisResult {
    status: AnalysisStatus;
    analysis: {
        noticeType: NoticeType | null;
        strikeCount: number;
        isWithin90Days: boolean;
        daysArrears: number;
        workingDaysOverdue: number;
        totalArrears: number; // CRITICAL: Filtered total from legal engine (excludes ghost arrears)
        firstStrikeOSD?: string;
        windowExpiryDate?: string;
    };
    dates: {
        sentDate: string | null;
        officialServiceDate: string | null;
        remedyExpiryDate: string | null;
        tribunalDeadline: string | null;
    };
    legalContext: {
        citation: string;
        requirement: string;
        nextStep: string;
    };
}

// ============================================================================
// WORKING DAY CALCULATIONS
// ============================================================================
// NOTE: Core working day functions (isNZWorkingDay, getNextWorkingDay,
// countWorkingDaysBetween, addWorkingDays) are imported from date-utils.ts
// ============================================================================

/**
 * Calculates the Official Service Date (OSD) for a notice under RTA Section 136.
 *
 * CRITICAL: Uses NZ timezone for the 5 PM cutoff rule.
 * The RTA Section 136 5 PM rule refers to NZ time, not server time.
 *
 * The 5 PM Rule (RTA Section 136):
 * - If sent on a working day BEFORE 5 PM NZ time: Service Date = sent date
 * - If sent on a working day AFTER 5 PM NZ time: Service Date = next working day
 * - If sent on a non-working day (weekend/holiday): Service Date = next working day
 *
 * @param sentAt - The timestamp when the notice was sent (Date object, any timezone)
 * @param region - Optional NZ region for regional holidays
 * @returns The official service date (Date object, time set to start of day)
 *
 * @example
 * ```typescript
 * // IMPORTANT: Examples use UTC timestamps, but hour is checked in NZ time
 *
 * // Sent Monday at 4 PM NZDT (3 AM UTC) → Service Date = Monday
 * const osd1 = calculateServiceDate(new Date('2026-01-19T03:00:00Z'), 'Auckland');
 *
 * // Sent Monday at 6 PM NZDT (5 AM UTC) → Service Date = Tuesday
 * const osd2 = calculateServiceDate(new Date('2026-01-19T05:00:00Z'), 'Auckland');
 *
 * // Sent Saturday at 2 PM NZDT → Service Date = Monday (next working day)
 * const osd3 = calculateServiceDate(new Date('2026-01-24T01:00:00Z'), 'Auckland');
 * ```
 */
export function calculateServiceDate(sentAt: Date, region?: NZRegion): Date {
    // CRITICAL: Convert to NZ timezone before checking the hour
    // This ensures we check against 5 PM NZ time, not server time
    const sentDateNZ = toZonedTime(sentAt, NZ_TIMEZONE);
    const sentHourNZ = sentDateNZ.getHours();
    const sentDate = startOfDay(sentDateNZ); // Normalize to start of day for date checks

    // Check if sent date is a working day
    const isSentDateWorkingDay = isNZWorkingDay(sentDate, region);

    // Rule 1: Not a working day → next working day
    if (!isSentDateWorkingDay) {
        return getNextWorkingDay(addDays(sentDate, 1), region);
    }

    // Rule 2: Working day but after 5 PM NZ time → next working day
    if (sentHourNZ >= 17) {
        return getNextWorkingDay(addDays(sentDate, 1), region);
    }

    // Rule 3: Working day before 5 PM NZ time → same day
    return sentDate;
}

// Re-export isNZWorkingDay for backwards compatibility with existing imports
export { isNZWorkingDay, getNextWorkingDay, addWorkingDays } from "./date-utils";

/**
 * Calculates the expiry date for a notice based on RTA requirements.
 *
 * Notice Types:
 * - S56_REMEDY: Service Date + 14 calendar days
 * - S55_STRIKE (3rd strike): Service Date + 28 calendar days (tribunal filing window)
 * - S55_21DAYS: No expiry (immediate tribunal eligibility)
 *
 * @param officialServiceDate - The OSD calculated by calculateServiceDate()
 * @param noticeType - The type of notice
 * @param strikeNumber - For strike notices, which strike (1, 2, or 3)
 * @returns Expiry date (Date object) or null if no expiry applies
 *
 * @example
 * ```typescript
 * // const osd = calculateServiceDate(new Date('2026-01-19T16:00:00Z'), 'Auckland');
 * // const expiry = calculateNoticeExpiryDate(osd, 'S56_REMEDY');
 * // expiry = 2026-02-02 (14 days after OSD)
 * ```
 */
export function calculateNoticeExpiryDate(
    officialServiceDate: Date,
    noticeType: NoticeType,
    strikeNumber?: number
): Date | null {
    if (noticeType === 'S56_REMEDY') {
        // 14 calendar days to remedy
        return addDays(officialServiceDate, 14);
    }

    if (noticeType === 'S55_STRIKE' && strikeNumber === 3) {
        // 28 calendar days to apply to tribunal after 3rd strike
        return addDays(officialServiceDate, 28);
    }

    if (noticeType === 'S55_21DAYS') {
        // No expiry - immediate tribunal eligibility
        return null;
    }

    // Strike 1 and 2 don't have expiry dates
    return null;
}

/**
 * Counts working days between two dates (exclusive of start, inclusive of end).
 * Wrapper around countWorkingDaysBetween from date-utils for backwards compatibility.
 *
 * @param startDate - Start date
 * @param endDate - End date
 * @param region - Optional NZ region for regional holidays
 * @returns Number of working days between dates
 */
export function countWorkingDays(startDate: Date, endDate: Date, region?: NZRegion): number {
    return countWorkingDaysBetween(startDate, endDate, region);
}

// ============================================================================
// SERVICE DATE CALCULATIONS
// ============================================================================

const EMAIL_CUTOFF_HOUR = 17; // 5:00 PM NZ time
// NZ_TIMEZONE is imported from date-utils.ts

/**
 * Calculates the Official Service Date (OSD) for an email notice.
 *
 * CRITICAL: Uses NZ timezone for the 5 PM cutoff rule.
 * The RTA Section 136 5 PM rule refers to NZ time, not server time.
 *
 * Rules:
 * - If sent before 5:00 PM NZ time on a working day: OSD = same day
 * - If sent after 5:00 PM NZ time or on a non-working day: OSD = next working day
 *
 * @param sentTimestamp - ISO timestamp of when email was sent (any timezone)
 * @param region - NZ region for regional holiday calculations
 * @returns Official Service Date as YYYY-MM-DD string
 *
 * @example
 * ```typescript
 * // Server in UTC, user sends at 6 PM NZDT (5 AM UTC)
 * calculateOfficialServiceDate('2026-01-19T05:00:00Z', 'Auckland')
 * // Correctly uses NZ time (6 PM) → next working day
 * ```
 */
export function calculateOfficialServiceDate(sentTimestamp: string, region?: NZRegion): string {
    // Parse the timestamp (could be in any timezone)
    const sentDateUTC = parseISO(sentTimestamp);

    // CRITICAL: Convert to NZ timezone before checking the hour
    // This ensures we check against 5 PM NZ time, not server time
    const sentDateNZ = toZonedTime(sentDateUTC, NZ_TIMEZONE);
    const sentHourNZ = sentDateNZ.getHours();

    // Determine candidate date based on 5:00 PM NZ time rule
    let candidateDate: Date;

    if (sentHourNZ < EMAIL_CUTOFF_HOUR) {
        // Sent before 5:00 PM NZ time - candidate is same day
        candidateDate = startOfDay(sentDateNZ);
    } else {
        // Sent at or after 5:00 PM NZ time - candidate is next day
        candidateDate = addDays(startOfDay(sentDateNZ), 1);
    }

    // Validate that candidate is a working day, otherwise get next working day
    const officialServiceDate = isNZWorkingDay(candidateDate, region)
        ? candidateDate
        : getNextWorkingDay(candidateDate, region);

    return format(officialServiceDate, "yyyy-MM-dd");
}

/**
 * Calculates the 14-day remedy expiry date.
 * Day 0 = Official Service Date
 * Expiry = OSD + 14 calendar days
 *
 * @param officialServiceDate - OSD in YYYY-MM-DD format
 * @returns Remedy expiry date as YYYY-MM-DD string
 */
export function calculateRemedyExpiryDate(officialServiceDate: string): string {
    const osd = parseISO(officialServiceDate);
    const expiryDate = addDays(osd, 14);
    return format(expiryDate, "yyyy-MM-dd");
}

/**
 * Calculates the 28-day tribunal filing deadline for 3rd strike notices.
 * Deadline = Official Service Date of 3rd notice + 28 calendar days
 *
 * @param thirdStrikeOSD - Official Service Date of 3rd strike (YYYY-MM-DD)
 * @returns Tribunal deadline as YYYY-MM-DD string
 */
export function calculateTribunalDeadline(thirdStrikeOSD: string): string {
    const osd = parseISO(thirdStrikeOSD);
    const deadline = addDays(osd, 28);
    return format(deadline, "yyyy-MM-dd");
}

// ============================================================================
// STRIKE WINDOW CALCULATIONS
// ============================================================================

/**
 * Checks if a strike falls within the 90-day window from the first strike.
 * The window starts on the Official Service Date of the first valid strike.
 *
 * @param firstStrikeOSD - Official Service Date of first strike (YYYY-MM-DD)
 * @param strikeOSD - Official Service Date of strike to check (YYYY-MM-DD)
 * @returns True if strike is within 90-day window
 */
export function isWithin90DayWindow(firstStrikeOSD: string, strikeOSD: string): boolean {
    const firstDate = parseISO(firstStrikeOSD);
    const strikeDate = parseISO(strikeOSD);

    const daysDiff = differenceInCalendarDays(strikeDate, firstDate);

    // Strike must be on or after first strike and within 90 days
    return daysDiff >= 0 && daysDiff <= 90;
}

/**
 * Calculates when the 90-day window expires.
 *
 * @param firstStrikeOSD - Official Service Date of first strike (YYYY-MM-DD)
 * @returns Window expiry date as YYYY-MM-DD string
 */
export function calculate90DayWindowExpiry(firstStrikeOSD: string): string {
    const firstDate = parseISO(firstStrikeOSD);
    const expiryDate = addDays(firstDate, 90);
    return format(expiryDate, "yyyy-MM-dd");
}

/**
 * Filters strikes to only those valid within the 90-day rolling window.
 *
 * CRITICAL: Window Reset Behavior
 * - Each strike is checked independently against the CURRENT DATE
 * - If Strike 1 is 100 days old, it is EXPIRED and filtered out
 * - If a new strike is issued after the old ones expire, it becomes the "first strike" of a NEW window
 * - This ensures the 90-day window properly "resets" when old strikes age out
 *
 * Example:
 * - Jan 1: Strike 1 issued
 * - Jan 10: Strike 2 issued
 * - May 1 (120 days later): Strike 1 & 2 are both EXPIRED (> 90 days old)
 * - May 5: New strike issued → This becomes "Strike 1" of a FRESH 90-day window
 *
 * @param strikes - Array of strike records
 * @param currentDate - Current date for window calculation (defaults to now)
 * @returns Array of strikes within the current 90-day rolling window, sorted chronologically
 */
export function getValidStrikesInWindow(strikes: StrikeRecord[], currentDate: Date = new Date()): StrikeRecord[] {
    if (strikes.length === 0) return [];

    // Filter to strikes within 90 days of CURRENT DATE (not first strike)
    // This allows the window to naturally "reset" when old strikes expire
    const activeStrikes = strikes.filter(strike => {
        const serviceDate = parseISO(strike.officialServiceDate);
        const daysSinceService = differenceInCalendarDays(currentDate, serviceDate);

        // Strike is valid if it's 0-90 days old from current date
        return daysSinceService >= 0 && daysSinceService <= 90;
    });

    // Sort by OSD (chronologically)
    return activeStrikes.sort((a, b) =>
        a.officialServiceDate.localeCompare(b.officialServiceDate)
    );
}

// ============================================================================
// ARREARS CALCULATIONS
// ============================================================================

/**
 * Calculates total days in arrears based on unpaid rent ledger entries.
 * Uses the oldest unpaid due date to calculate arrears days.
 *
 * CRITICAL: All dates are normalized to startOfDay to avoid timezone issues.
 * This ensures consistent day calculations regardless of server timezone.
 *
 * @param ledger - Array of ledger entries
 * @param currentDate - Current date for calculation (will be normalized)
 * @returns Number of calendar days in arrears
 */
export function calculateDaysInArrears(ledger: LedgerEntry[], currentDate: Date = new Date()): number {
    const unpaidEntries = ledger.filter(entry =>
        entry.status === "Unpaid" || entry.status === "Partial"
    );

    if (unpaidEntries.length === 0) return 0;

    // Find oldest unpaid due date (normalized to start of day)
    const oldestDueDate = unpaidEntries
        .map(e => startOfDay(parseISO(e.dueDate)))
        .sort((a, b) => a.getTime() - b.getTime())[0];

    // Normalize currentDate as well for consistent comparison
    const normalizedCurrent = startOfDay(currentDate);

    const daysArrears = differenceInCalendarDays(normalizedCurrent, oldestDueDate);
    return Math.max(0, daysArrears);
}

/**
 * Calculates working days overdue for a specific rent payment.
 * A strike can be issued after 5 working days overdue.
 *
 * CRITICAL: All dates are normalized to startOfDay to avoid timezone issues.
 *
 * @param dueDate - Rent due date
 * @param currentDate - Current date
 * @param region - NZ region for holiday calculations
 * @returns Number of working days overdue
 */
export function calculateWorkingDaysOverdue(
    dueDate: Date | string,
    currentDate: Date = new Date(),
    region?: NZRegion
): number {
    // Normalize both dates to start of day for consistent comparison
    const due = startOfDay(typeof dueDate === "string" ? parseISO(dueDate) : dueDate);
    const normalizedCurrent = startOfDay(currentDate);

    // If currentDate <= dueDate, not overdue yet
    if (isBefore(normalizedCurrent, due) || isEqual(normalizedCurrent, due)) {
        return 0;
    }

    return countWorkingDays(due, normalizedCurrent, region);
}

/**
 * Calculates total arrears amount from ledger.
 *
 * @deprecated SESSION 4: Balance should come from calculateRentState() in rent-calculator.ts.
 * This function derives balance from ledger record statuses, which is the OLD approach.
 * It's kept for backward compatibility with analyzeTenancySituation() but should NOT
 * be used as the primary balance source. Use calculateRentState().currentBalance instead.
 *
 * @param ledger - Array of ledger entries
 * @returns Total unpaid amount (legacy calculation)
 */
export function calculateTotalArrears(ledger: LedgerEntry[]): number {
    // SESSION 4 NOTE: Ledger records now have status='Pending' (display-only).
    // This function will return 0 for regenerated ledgers since no records
    // are marked 'Unpaid'. This is intentional - balance comes from calculateRentState().
    return ledger
        .filter(entry => entry.status === "Unpaid" || entry.status === "Partial")
        .reduce((total, entry) => {
            const paid = entry.amountPaid || 0;
            return total + (entry.amount - paid);
        }, 0);
}

// ============================================================================
// MAIN ANALYSIS ENGINE
// ============================================================================

/**
 * Main analysis function that evaluates tenancy situation and returns
 * the analysis result per the blueprint specification.
 *
 * @param input - Analysis input data
 * @returns Complete analysis result
 */
export function analyzeTenancySituation(input: AnalysisInput): AnalysisResult {
    const { strikeHistory, behaviorNotes, region, trackingStartDate, openingArrears = 0 } = input;
    // CRITICAL: Normalize currentDate to start of day in NZ timezone for consistent date comparisons
    // This ensures status shifts at 12:01 AM NZ time, not server time
    // toZonedTime converts to NZ local, then startOfDay normalizes to midnight
    const currentDateNZ = toZonedTime(input.currentDate || new Date(), NZ_TIMEZONE);
    const currentDate = startOfDay(currentDateNZ);

    // 1. FILTER LEDGER FOR "GHOST PAYMENTS"
    // If tracking start date is provided, filter out any payments due BEFORE we started tracking
    let ledger = input.ledger;
    if (trackingStartDate) {
        ledger = getValidLedger(input.ledger, trackingStartDate);
    }

    // 2. ARREARS CALCULATION LOGIC
    // Total balance = SUM of all records where status === 'Unpaid' or 'Partial'
    // We do NOT filter by due_date because:
    // - Opening arrears can have future due dates but are already overdue
    // - The status field is the source of truth for whether a payment counts toward balance
    // NOTE: The ledger is already filtered for "ghost payments" (before tracking start date)

    // 3. CALCULATE ARREARS
    // Total = Opening Arrears + Unpaid entries after Tracking Start Date (and on or before current date)
    const ledgerArrears = calculateTotalArrears(ledger);
    const totalArrears = openingArrears + ledgerArrears;

    // 4. CALCULATE DAYS IN ARREARS
    // If opening arrears exist, use tracking start date as the "due date" for that balance
    // Otherwise, use the normal calculation based on ledger entries
    let daysArrears: number;
    if (openingArrears > 0 && trackingStartDate) {
        // Opening arrears are considered overdue from the tracking start date
        const trackingStart = parseISO(trackingStartDate);
        daysArrears = Math.max(0, differenceInCalendarDays(currentDate, trackingStart));
    } else {
        daysArrears = calculateDaysInArrears(ledger, currentDate);
    }

    // 5. CALCULATE WORKING DAYS OVERDUE
    // If opening arrears exist, use tracking start date for working days calculation
    // Otherwise, use the oldest unpaid ledger entry
    let workingDaysOverdue = 0;

    if (openingArrears > 0 && trackingStartDate) {
        // Opening arrears: calculate working days from tracking start date
        workingDaysOverdue = calculateWorkingDaysOverdue(trackingStartDate, currentDate, region);
    } else {
        // Normal calculation: use oldest unpaid entry from ledger
        const unpaidEntries = ledger.filter(e => e.status === "Unpaid" || e.status === "Partial");
        const oldestUnpaid = unpaidEntries.length > 0
            ? unpaidEntries.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
            : null;

        workingDaysOverdue = oldestUnpaid
            ? calculateWorkingDaysOverdue(oldestUnpaid.dueDate, currentDate, region)
            : 0;
    }

    // Get valid strikes within 90-day window
    const rentStrikes = strikeHistory.filter(s => s.type === "S55_STRIKE");
    const validStrikes = getValidStrikesInWindow(rentStrikes, currentDate);
    const strikeCount = validStrikes.length;

    const firstStrikeOSD = validStrikes.length > 0 ? validStrikes[0].officialServiceDate : undefined;
    const windowExpiryDate = firstStrikeOSD ? calculate90DayWindowExpiry(firstStrikeOSD) : undefined;

    // Determine if within 90-day window (for new potential strike)
    const isWithin90Days = firstStrikeOSD
        ? isWithin90DayWindow(firstStrikeOSD, format(currentDate, "yyyy-MM-dd"))
        : true; // No existing strikes, so any new one starts fresh window

    // DECISION LOGIC

    // Check Section 55(1)(a): 21 Days In Arrears - immediate tribunal eligibility
    if (daysArrears >= 21) {
        return {
            status: "TRIBUNAL_ELIGIBLE",
            analysis: {
                noticeType: "S55_21DAYS",
                strikeCount,
                isWithin90Days,
                daysArrears,
                workingDaysOverdue,
                totalArrears, // Filtered total from legal engine
                firstStrikeOSD,
                windowExpiryDate,
            },
            dates: {
                sentDate: null,
                officialServiceDate: null,
                remedyExpiryDate: null,
                tribunalDeadline: format(currentDate, "yyyy-MM-dd"), // Can apply immediately
            },
            legalContext: {
                citation: "Residential Tenancies Act 1986, Section 55(1)(a)",
                requirement: "Rent is 21 or more calendar days in arrears.",
                nextStep: "Apply to Tenancy Tribunal for termination (no notice required).",
            },
        };
    }

    // Check Section 55(1)(aa): 3 Strikes within 90 days
    if (strikeCount >= 3 && isWithin90Days) {
        const thirdStrikeOSD = validStrikes[2].officialServiceDate;
        const tribunalDeadline = calculateTribunalDeadline(thirdStrikeOSD);

        // Check if still within 28-day filing window
        const deadlineDate = parseISO(tribunalDeadline);
        if (isBefore(currentDate, deadlineDate) || isEqual(currentDate, deadlineDate)) {
            return {
                status: "TRIBUNAL_ELIGIBLE",
                analysis: {
                    noticeType: "S55_STRIKE",
                    strikeCount,
                    isWithin90Days: true,
                    daysArrears,
                    workingDaysOverdue,
                    totalArrears, // Filtered total from legal engine
                    firstStrikeOSD,
                    windowExpiryDate,
                },
                dates: {
                    sentDate: validStrikes[2].sentDate,
                    officialServiceDate: thirdStrikeOSD,
                    remedyExpiryDate: null,
                    tribunalDeadline,
                },
                legalContext: {
                    citation: "Residential Tenancies Act 1986, Section 55(1)(aa)",
                    requirement: "3 strike notices served within 90-day window.",
                    nextStep: `Apply to Tenancy Tribunal before ${tribunalDeadline} (28-day deadline).`,
                },
            };
        }
    }

    // Check if action is required (5+ working days overdue, can issue strike)
    if (workingDaysOverdue >= 5 && totalArrears > 0) {
        const nextStrikeNumber = strikeCount + 1;

        return {
            status: "ACTION_REQUIRED",
            analysis: {
                noticeType: "S55_STRIKE",
                strikeCount,
                isWithin90Days,
                daysArrears,
                workingDaysOverdue,
                totalArrears, // Filtered total from legal engine
                firstStrikeOSD,
                windowExpiryDate,
            },
            dates: {
                sentDate: null,
                officialServiceDate: null,
                remedyExpiryDate: null,
                tribunalDeadline: null,
            },
            legalContext: {
                citation: "Residential Tenancies Act 1986, Section 55(1)(aa)",
                requirement: "Rent must be 5 working days overdue for a strike notice.",
                nextStep: isWithin90Days || strikeCount === 0
                    ? `Send Strike ${nextStrikeNumber} Notice via Email.`
                    : "90-day window expired. New strike will start a fresh window.",
            },
        };
    }

    // COMPLIANT - No action required
    return {
        status: "COMPLIANT",
        analysis: {
            noticeType: null,
            strikeCount,
            isWithin90Days,
            daysArrears,
            workingDaysOverdue,
            totalArrears, // Filtered total from legal engine
            firstStrikeOSD,
            windowExpiryDate,
        },
        dates: {
            sentDate: null,
            officialServiceDate: null,
            remedyExpiryDate: null,
            tribunalDeadline: null,
        },
        legalContext: {
            citation: "Residential Tenancies Act 1986",
            requirement: "No action required at this time.",
            nextStep: workingDaysOverdue > 0 && workingDaysOverdue < 5
                ? `Monitor - rent ${workingDaysOverdue} working days overdue. Strike eligible after 5 working days.`
                : "Continue monitoring rent payments.",
        },
    };
}

/**
 * Prepares a strike notice with calculated service date and generates
 * the data needed for sending via email.
 *
 * @param sentTimestamp - When the email will be/was sent (ISO timestamp)
 * @param region - NZ region for holiday calculations
 * @param strikeNumber - Which strike this is (1, 2, or 3)
 * @param rentDueDate - The rent due date for this strike
 * @param amountOwed - Amount owed
 * @returns Strike record with all calculated dates
 */
export function prepareStrikeNotice(
    sentTimestamp: string,
    region: NZRegion,
    strikeNumber: number,
    rentDueDate: string,
    amountOwed: number
): StrikeRecord & { remedyExpiryDate: string } {
    const officialServiceDate = calculateOfficialServiceDate(sentTimestamp, region);
    const remedyExpiryDate = calculateRemedyExpiryDate(officialServiceDate);

    return {
        noticeId: `strike-${Date.now()}`,
        sentDate: sentTimestamp,
        officialServiceDate,
        type: "S55_STRIKE",
        rentDueDate,
        amountOwed,
        remedyExpiryDate,
    };
}

/**
 * Validates if a new strike notice can be legally issued.
 *
 * @param ledger - Current rent ledger
 * @param existingStrikes - Existing strike history
 * @param region - NZ region
 * @param currentDate - Current date
 * @returns Validation result with reason
 */
export function canIssueStrikeNotice(
    ledger: LedgerEntry[],
    existingStrikes: StrikeRecord[],
    region?: NZRegion,
    currentDate: Date = new Date()
): { canIssue: boolean; reason: string; dueDateFor?: string } {
    const unpaidEntries = ledger.filter(e => e.status === "Unpaid" || e.status === "Partial");

    if (unpaidEntries.length === 0) {
        return { canIssue: false, reason: "No unpaid rent entries." };
    }

    // Check 90-day window first
    const validStrikes = getValidStrikesInWindow(existingStrikes.filter(s => s.type === "S55_STRIKE"), currentDate);
    if (validStrikes.length >= 3) {
        return {
            canIssue: false,
            reason: "Already have 3 strikes in window. Apply to Tribunal instead."
        };
    }

    // Find a due date that is 5+ working days overdue AND not already struck
    // Sort oldest first so we strike the earliest eligible date
    const sortedUnpaid = [...unpaidEntries].sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    for (const entry of sortedUnpaid) {
        const workingDaysOverdue = calculateWorkingDaysOverdue(entry.dueDate, currentDate, region);
        if (workingDaysOverdue < 5) continue;

        // Check if a strike was already issued for this due date
        const alreadyStruck = existingStrikes.some(
            s => s.type === "S55_STRIKE" && s.rentDueDate === entry.dueDate
        );
        if (alreadyStruck) continue;

        return {
            canIssue: true,
            reason: `Strike notice can be issued for rent due ${entry.dueDate} (${workingDaysOverdue} working days overdue).`,
            dueDateFor: entry.dueDate,
        };
    }

    // All eligible due dates already have strikes
    const anyEligible = sortedUnpaid.some(
        e => calculateWorkingDaysOverdue(e.dueDate, currentDate, region) >= 5
    );
    if (anyEligible) {
        return {
            canIssue: false,
            reason: "All overdue due dates already have strike notices issued."
        };
    }

    const oldestUnpaid = sortedUnpaid[0];
    const workingDaysOverdue = calculateWorkingDaysOverdue(oldestUnpaid.dueDate, currentDate, region);
    return {
        canIssue: false,
        reason: `Only ${workingDaysOverdue} working days overdue. Must be at least 5 working days.`
    };
}
