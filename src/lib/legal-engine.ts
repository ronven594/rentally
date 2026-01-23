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
 */

import { format, addDays, differenceInCalendarDays, getDay, parseISO, isAfter, isBefore, isEqual } from "date-fns";
import { type NZRegion, isNZHoliday } from "@/lib/nz-holidays";

// ============================================================================
// TYPES
// ============================================================================

export type NoticeType = "S55_STRIKE" | "S55A_SOCIAL" | "S56_REMEDY" | "S55_21DAYS";
export type AnalysisStatus = "ACTION_REQUIRED" | "COMPLIANT" | "TRIBUNAL_ELIGIBLE";

export interface StrikeRecord {
    noticeId: string;
    sentDate: string;           // ISO timestamp when email was sent
    officialServiceDate: string; // Calculated OSD (YYYY-MM-DD)
    type: NoticeType;
    rentDueDate?: string;       // For rent strikes
    amountOwed?: number;
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
}

export interface AnalysisResult {
    status: AnalysisStatus;
    analysis: {
        noticeType: NoticeType | null;
        strikeCount: number;
        isWithin90Days: boolean;
        daysArrears: number;
        workingDaysOverdue: number;
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

/**
 * Checks if a date is a NZ working day.
 * Working days exclude weekends and all NZ public holidays (national + regional).
 *
 * @param date - The date to check
 * @param region - Optional NZ region for regional anniversary days
 * @returns True if the date is a working day
 */
export function isNZWorkingDay(date: Date, region?: NZRegion): boolean {
    const dayOfWeek = getDay(date);

    // Exclude weekends (Saturday = 6, Sunday = 0)
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        return false;
    }

    // Check against NZ public holidays
    const dateStr = format(date, "yyyy-MM-dd");
    if (isNZHoliday(dateStr, region)) {
        return false;
    }

    return true;
}

/**
 * Gets the next working day from a given date.
 * If the date is already a working day, returns that date.
 *
 * @param date - Starting date
 * @param region - Optional NZ region for regional holidays
 * @returns The next working day
 */
export function getNextWorkingDay(date: Date, region?: NZRegion): Date {
    let current = new Date(date);

    while (!isNZWorkingDay(current, region)) {
        current = addDays(current, 1);
    }

    return current;
}

/**
 * Adds working days to a date (excludes weekends and holidays).
 *
 * @param date - Starting date
 * @param days - Number of working days to add
 * @param region - Optional NZ region for regional holidays
 * @returns Date after adding specified working days
 */
export function addWorkingDays(date: Date, days: number, region?: NZRegion): Date {
    let current = new Date(date);
    let remaining = days;

    while (remaining > 0) {
        current = addDays(current, 1);
        if (isNZWorkingDay(current, region)) {
            remaining--;
        }
    }

    return current;
}

/**
 * Counts working days between two dates (exclusive of start, inclusive of end).
 *
 * @param startDate - Start date
 * @param endDate - End date
 * @param region - Optional NZ region for regional holidays
 * @returns Number of working days between dates
 */
export function countWorkingDays(startDate: Date, endDate: Date, region?: NZRegion): number {
    let count = 0;
    let current = addDays(startDate, 1);

    while (isBefore(current, endDate) || isEqual(current, endDate)) {
        if (isNZWorkingDay(current, region)) {
            count++;
        }
        current = addDays(current, 1);
    }

    return count;
}

// ============================================================================
// SERVICE DATE CALCULATIONS
// ============================================================================

const EMAIL_CUTOFF_HOUR = 17; // 5:00 PM

/**
 * Calculates the Official Service Date (OSD) for an email notice.
 *
 * Rules:
 * - If sent before/at 5:00 PM on a working day: OSD = same day
 * - If sent after 5:00 PM or on a non-working day: OSD = next working day
 *
 * @param sentTimestamp - ISO timestamp of when email was sent
 * @param region - NZ region for regional holiday calculations
 * @returns Official Service Date as YYYY-MM-DD string
 */
export function calculateOfficialServiceDate(sentTimestamp: string, region?: NZRegion): string {
    const sentDate = parseISO(sentTimestamp);
    const sentHour = sentDate.getHours();

    // Determine candidate date based on 5:00 PM rule
    let candidateDate: Date;

    if (sentHour < EMAIL_CUTOFF_HOUR) {
        // Sent before 5:00 PM - candidate is same day
        candidateDate = sentDate;
    } else {
        // Sent at or after 5:00 PM - candidate is next day
        candidateDate = addDays(sentDate, 1);
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
 * Filters strikes to only those valid within the 90-day window.
 *
 * @param strikes - Array of strike records
 * @returns Array of strikes within the current 90-day window
 */
export function getValidStrikesInWindow(strikes: StrikeRecord[]): StrikeRecord[] {
    if (strikes.length === 0) return [];

    // Sort by OSD
    const sorted = [...strikes].sort((a, b) =>
        a.officialServiceDate.localeCompare(b.officialServiceDate)
    );

    const firstStrikeOSD = sorted[0].officialServiceDate;

    return sorted.filter(strike =>
        isWithin90DayWindow(firstStrikeOSD, strike.officialServiceDate)
    );
}

// ============================================================================
// ARREARS CALCULATIONS
// ============================================================================

/**
 * Calculates total days in arrears based on unpaid rent ledger entries.
 * Uses the oldest unpaid due date to calculate arrears days.
 *
 * @param ledger - Array of ledger entries
 * @param currentDate - Current date for calculation
 * @returns Number of calendar days in arrears
 */
export function calculateDaysInArrears(ledger: LedgerEntry[], currentDate: Date = new Date()): number {
    const unpaidEntries = ledger.filter(entry =>
        entry.status === "Unpaid" || entry.status === "Partial"
    );

    if (unpaidEntries.length === 0) return 0;

    // Find oldest unpaid due date
    const oldestDueDate = unpaidEntries
        .map(e => parseISO(e.dueDate))
        .sort((a, b) => a.getTime() - b.getTime())[0];

    const daysArrears = differenceInCalendarDays(currentDate, oldestDueDate);
    return Math.max(0, daysArrears);
}

/**
 * Calculates working days overdue for a specific rent payment.
 * A strike can be issued after 5 working days overdue.
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
    const due = typeof dueDate === "string" ? parseISO(dueDate) : dueDate;

    if (isBefore(currentDate, due) || isEqual(currentDate, due)) {
        return 0;
    }

    return countWorkingDays(due, currentDate, region);
}

/**
 * Calculates total arrears amount from ledger.
 *
 * @param ledger - Array of ledger entries
 * @returns Total unpaid amount
 */
export function calculateTotalArrears(ledger: LedgerEntry[]): number {
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
    const { ledger, strikeHistory, behaviorNotes, region } = input;
    const currentDate = input.currentDate || new Date();

    // Calculate arrears
    const daysArrears = calculateDaysInArrears(ledger, currentDate);
    const totalArrears = calculateTotalArrears(ledger);

    // Get oldest unpaid entry for working days calculation
    const unpaidEntries = ledger.filter(e => e.status === "Unpaid" || e.status === "Partial");
    const oldestUnpaid = unpaidEntries.length > 0
        ? unpaidEntries.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
        : null;

    const workingDaysOverdue = oldestUnpaid
        ? calculateWorkingDaysOverdue(oldestUnpaid.dueDate, currentDate, region)
        : 0;

    // Get valid strikes within 90-day window
    const rentStrikes = strikeHistory.filter(s => s.type === "S55_STRIKE");
    const validStrikes = getValidStrikesInWindow(rentStrikes);
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
): { canIssue: boolean; reason: string } {
    const unpaidEntries = ledger.filter(e => e.status === "Unpaid" || e.status === "Partial");

    if (unpaidEntries.length === 0) {
        return { canIssue: false, reason: "No unpaid rent entries." };
    }

    const oldestUnpaid = unpaidEntries.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    const workingDaysOverdue = calculateWorkingDaysOverdue(oldestUnpaid.dueDate, currentDate, region);

    if (workingDaysOverdue < 5) {
        return {
            canIssue: false,
            reason: `Only ${workingDaysOverdue} working days overdue. Must be at least 5 working days.`
        };
    }

    const validStrikes = getValidStrikesInWindow(existingStrikes.filter(s => s.type === "S55_STRIKE"));

    if (validStrikes.length >= 3) {
        return {
            canIssue: false,
            reason: "Already have 3 strikes in window. Apply to Tribunal instead."
        };
    }

    return { canIssue: true, reason: "Strike notice can be issued." };
}
