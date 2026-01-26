/**
 * Date Utilities - Single Source of Truth
 *
 * This file is the ONLY place where date handling constants and core functions
 * should be defined. All other files MUST import from here.
 *
 * KEY PRINCIPLES:
 * 1. All "what is today" checks MUST use getEffectiveToday(testDate)
 * 2. All timezone conversions use NZ_TIMEZONE constant from here
 * 3. All working day calculations use functions from here
 * 4. Never use new Date() for "today" checks in business logic
 *
 * TEST DATE OVERRIDE:
 * The testDate parameter allows simulation of any date for testing.
 * When testDate is provided, all calculations use it instead of real "today".
 */

import {
    parseISO,
    format,
    addDays as dateFnsAddDays,
    addWeeks as dateFnsAddWeeks,
    addMonths as dateFnsAddMonths,
    differenceInCalendarDays,
    getDay,
    startOfDay,
    nextDay,
    getDaysInMonth,
    isBefore,
    isAfter,
    isSameDay
} from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { type NZRegion, isNZHoliday } from "./nz-holidays";

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * NZ Timezone - IANA timezone identifier
 * Use this constant everywhere instead of hardcoding "Pacific/Auckland"
 */
export const NZ_TIMEZONE = "Pacific/Auckland";

/**
 * Day name to JavaScript getDay() index mapping
 * JavaScript: Sunday = 0, Monday = 1, ..., Saturday = 6
 */
export const DAY_NAME_TO_JS_INDEX: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
    'Sunday': 0,
    'Monday': 1,
    'Tuesday': 2,
    'Wednesday': 3,
    'Thursday': 4,
    'Friday': 5,
    'Saturday': 6
};

/**
 * JavaScript getDay() index to day name mapping
 */
export const JS_INDEX_TO_DAY_NAME: Record<number, string> = {
    0: 'Sunday',
    1: 'Monday',
    2: 'Tuesday',
    3: 'Wednesday',
    4: 'Thursday',
    5: 'Friday',
    6: 'Saturday'
};

// ============================================================================
// CORE DATE GETTERS
// ============================================================================

/**
 * Get the effective "today" date, respecting test date override
 *
 * THIS IS THE MAIN FUNCTION FOR "WHAT IS TODAY" CHECKS.
 * Use this everywhere instead of new Date().
 *
 * @param testDate - Optional test date override for simulation
 * @returns The effective "today" date, normalized to start of day in NZ timezone
 *
 * @example
 * // In a component that receives testDate prop:
 * const today = getEffectiveToday(testDate);
 * const daysOverdue = daysBetween(dueDate, today);
 */
export function getEffectiveToday(testDate?: Date | null): Date {
    const baseDate = testDate ?? new Date();
    // Convert to NZ timezone and normalize to start of day
    const nzDate = toZonedTime(baseDate, NZ_TIMEZONE);
    return startOfDay(nzDate);
}

/**
 * Get today's date in NZ timezone (no test override)
 *
 * USE SPARINGLY - prefer getEffectiveToday(testDate) for testability.
 * Only use this for actual timestamps (e.g., "when was this action taken").
 *
 * @returns Today's date in NZ timezone at midnight
 */
export function getTodayNZ(): Date {
    const nzDate = toZonedTime(new Date(), NZ_TIMEZONE);
    return startOfDay(nzDate);
}

/**
 * Get current timestamp in NZ timezone
 *
 * Use for actual timestamps (database records, audit logs, etc.)
 * NOT for business logic calculations.
 *
 * @returns Current Date object in NZ timezone (with time)
 */
export function getNowNZ(): Date {
    return toZonedTime(new Date(), NZ_TIMEZONE);
}

// ============================================================================
// DAY OF WEEK UTILITIES
// ============================================================================

/**
 * Get day of week as number (1-7, Monday=1, Sunday=7) - ISO standard
 *
 * NOTE: This differs from JavaScript's getDay() which uses 0-6 with Sunday=0
 *
 * @param date - Date to check
 * @returns 1-7 where Monday=1, Sunday=7
 */
export function getISODayOfWeek(date: Date): number {
    const jsDay = date.getDay();
    // Convert: JS Sunday (0) → ISO 7, JS Monday (1) → ISO 1, etc.
    return jsDay === 0 ? 7 : jsDay;
}

/**
 * Get day of week as number in JavaScript format (0-6, Sunday=0)
 *
 * @param date - Date to check
 * @returns 0-6 where Sunday=0, Monday=1, Saturday=6
 */
export function getJSDayOfWeek(date: Date): number {
    return date.getDay();
}

/**
 * Convert day name to JavaScript day index (0-6)
 *
 * @param dayName - Day name ("Monday", "Tuesday", etc.)
 * @returns Day index (0-6) or undefined if invalid
 */
export function getDayIndexFromName(dayName: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 | undefined {
    return DAY_NAME_TO_JS_INDEX[dayName];
}

/**
 * Convert JavaScript day index to day name
 *
 * @param dayIndex - Day index (0-6)
 * @returns Day name ("Sunday", "Monday", etc.)
 */
export function getDayNameFromIndex(dayIndex: number): string {
    return JS_INDEX_TO_DAY_NAME[dayIndex] || 'Unknown';
}

// ============================================================================
// DATE ARITHMETIC
// ============================================================================

/**
 * Calculate calendar days between two dates
 *
 * @param startDate - Start date
 * @param endDate - End date
 * @returns Number of calendar days (positive if endDate is after startDate)
 */
export function daysBetween(startDate: Date, endDate: Date): number {
    return differenceInCalendarDays(endDate, startDate);
}

/**
 * Add days to a date
 * Re-export from date-fns for consistency
 */
export function addDays(date: Date, days: number): Date {
    return dateFnsAddDays(date, days);
}

/**
 * Add weeks to a date
 * Re-export from date-fns for consistency
 */
export function addWeeks(date: Date, weeks: number): Date {
    return dateFnsAddWeeks(date, weeks);
}

/**
 * Add months to a date
 * Re-export from date-fns for consistency
 */
export function addMonths(date: Date, months: number): Date {
    return dateFnsAddMonths(date, months);
}

// ============================================================================
// DUE DATE FINDING
// ============================================================================

export type PaymentFrequency = 'Weekly' | 'Fortnightly' | 'Monthly';

export interface DueDateSettings {
    frequency: PaymentFrequency;
    dueDay: number | string;  // number (1-31) for Monthly, day name for Weekly/Fortnightly
    anchorDate?: Date;        // For Fortnightly alignment
}

/**
 * Find the first due date on or after a given start date
 *
 * This is the "Ground Zero" calculation - the anchor point for all payment dates.
 *
 * @param startDate - The date to start searching from (e.g., trackingStartDate)
 * @param settings - Frequency and due day settings
 * @returns The first due date on or after startDate
 *
 * @example
 * // Weekly rent due on Fridays, tracking starts Jan 15 (Wednesday)
 * const groundZero = findFirstDueDate(
 *   parseISO('2026-01-15'),
 *   { frequency: 'Weekly', dueDay: 'Friday' }
 * );
 * // Returns Jan 17 (the first Friday on or after Jan 15)
 */
export function findFirstDueDate(startDate: Date, settings: DueDateSettings): Date {
    const normalizedStart = startOfDay(startDate);

    if (settings.frequency === 'Monthly') {
        // For Monthly: find first occurrence of the day-of-month
        const targetDay = typeof settings.dueDay === 'number'
            ? settings.dueDay
            : parseInt(settings.dueDay, 10) || 1;

        let year = normalizedStart.getFullYear();
        let month = normalizedStart.getMonth();

        // Get effective day for this month (handle months with fewer days)
        let daysInMonth = getDaysInMonth(new Date(year, month, 1));
        let effectiveDay = Math.min(targetDay, daysInMonth);

        let groundZero = new Date(year, month, effectiveDay);

        // If ground zero is before start date, move to next month
        if (isBefore(groundZero, normalizedStart)) {
            month += 1;
            if (month > 11) {
                month = 0;
                year += 1;
            }
            daysInMonth = getDaysInMonth(new Date(year, month, 1));
            effectiveDay = Math.min(targetDay, daysInMonth);
            groundZero = new Date(year, month, effectiveDay);
        }

        return startOfDay(groundZero);
    } else {
        // For Weekly/Fortnightly: find first occurrence of the target weekday
        const targetDayName = typeof settings.dueDay === 'string'
            ? settings.dueDay
            : getDayNameFromIndex(settings.dueDay as number);
        const targetDayIndex = getDayIndexFromName(targetDayName);

        if (targetDayIndex === undefined) {
            throw new Error(`Invalid day name: ${targetDayName}`);
        }

        const startDayIndex = normalizedStart.getDay();

        // If start date IS the target day, use it
        if (startDayIndex === targetDayIndex) {
            return normalizedStart;
        }

        // Find the next occurrence of the target day
        return startOfDay(nextDay(normalizedStart, targetDayIndex));
    }
}

/**
 * Find the next due date strictly AFTER a given date
 *
 * @param fromDate - Find the next due date after this date
 * @param settings - Frequency and due day settings
 * @param firstDueDate - The ground zero / first due date (anchor)
 * @returns The next due date after fromDate
 */
export function findNextDueDate(
    fromDate: Date,
    settings: DueDateSettings,
    firstDueDate: Date
): Date {
    const normalizedFrom = startOfDay(fromDate);

    // If fromDate is before firstDueDate, return firstDueDate
    if (isBefore(normalizedFrom, firstDueDate)) {
        return firstDueDate;
    }

    // Count forward from firstDueDate until we find one after fromDate
    let currentDue = firstDueDate;
    let iterations = 0;
    const maxIterations = 1000;

    while (iterations < maxIterations) {
        const nextDue = advanceDueDate(currentDue, settings);

        if (isAfter(nextDue, normalizedFrom)) {
            return startOfDay(nextDue);
        }

        currentDue = nextDue;
        iterations++;
    }

    // Fallback - should never reach here
    console.error('Max iterations reached in findNextDueDate');
    return advanceDueDate(normalizedFrom, settings);
}

/**
 * Advance a due date by one cycle
 *
 * @param currentDue - Current due date
 * @param settings - Frequency settings
 * @returns The next due date
 */
export function advanceDueDate(currentDue: Date, settings: DueDateSettings): Date {
    const normalized = startOfDay(currentDue);

    if (settings.frequency === 'Weekly') {
        return addWeeks(normalized, 1);
    } else if (settings.frequency === 'Fortnightly') {
        return addWeeks(normalized, 2);
    } else {
        // Monthly - handle day snapping for months with fewer days
        const targetDay = typeof settings.dueDay === 'number'
            ? settings.dueDay
            : parseInt(settings.dueDay as string, 10) || 1;
        const nextMonth = addMonths(normalized, 1);
        const daysInNextMonth = getDaysInMonth(nextMonth);
        const effectiveDay = Math.min(targetDay, daysInNextMonth);

        return new Date(nextMonth.getFullYear(), nextMonth.getMonth(), effectiveDay);
    }
}

/**
 * Find the due date for a specific cycle number (1-indexed)
 *
 * @param firstDueDate - Ground zero (cycle 1)
 * @param settings - Frequency settings
 * @param cycleNumber - The cycle number (1 = first cycle, 2 = second, etc.)
 * @returns The due date for that cycle
 */
export function findDueDateForCycle(
    firstDueDate: Date,
    settings: DueDateSettings,
    cycleNumber: number
): Date {
    if (cycleNumber < 1) {
        throw new Error('Cycle number must be >= 1');
    }

    if (cycleNumber === 1) {
        return startOfDay(firstDueDate);
    }

    let currentDue = firstDueDate;
    for (let i = 1; i < cycleNumber; i++) {
        currentDue = advanceDueDate(currentDue, settings);
    }

    return startOfDay(currentDue);
}

/**
 * Count cycles from firstDueDate up to and including toDate
 *
 * @param firstDueDate - Ground zero
 * @param toDate - Count cycles up to this date
 * @param settings - Frequency settings
 * @returns Number of cycles
 */
export function countCycles(
    firstDueDate: Date,
    toDate: Date,
    settings: DueDateSettings
): number {
    const normalizedTo = startOfDay(toDate);

    if (isBefore(normalizedTo, firstDueDate)) {
        return 0;
    }

    let cycles = 0;
    let currentDue = firstDueDate;
    const maxIterations = 1000;

    while (cycles < maxIterations) {
        if (isBefore(currentDue, normalizedTo) || isSameDay(currentDue, normalizedTo)) {
            cycles++;
            currentDue = advanceDueDate(currentDue, settings);
        } else {
            break;
        }
    }

    return cycles;
}

// ============================================================================
// WORKING DAYS (NZ RTA Compliance)
// ============================================================================

/**
 * Check if a date is a NZ working day
 *
 * Working days exclude:
 * - Weekends (Saturday, Sunday)
 * - NZ public holidays (national and regional)
 * - Summer blackout period (Dec 25 - Jan 15) per RTA
 *
 * @param date - Date to check
 * @param region - Optional NZ region for regional holidays (e.g., 'Auckland')
 * @returns True if the date is a working day
 */
export function isNZWorkingDay(date: Date, region?: NZRegion): boolean {
    const dayOfWeek = getDay(date);

    // Exclude weekends (Saturday = 6, Sunday = 0)
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        return false;
    }

    // Summer blackout period: Dec 25 - Jan 15 (inclusive)
    // These are NOT working days per RTA
    const month = date.getMonth() + 1; // 1-indexed (1 = January, 12 = December)
    const day = date.getDate();

    if ((month === 12 && day >= 25) || (month === 1 && day <= 15)) {
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
 * Get the next working day from a given date
 * If the date is already a working day, returns that date.
 *
 * @param date - Starting date
 * @param region - Optional NZ region for regional holidays
 * @returns The next working day (could be same day if already working day)
 */
export function getNextWorkingDay(date: Date, region?: NZRegion): Date {
    let current = new Date(date);

    while (!isNZWorkingDay(current, region)) {
        current = addDays(current, 1);
    }

    return current;
}

/**
 * Count working days between two dates
 * Exclusive of start date, inclusive of end date.
 *
 * @param startDate - Start date (not counted)
 * @param endDate - End date (counted if working day)
 * @param region - Optional NZ region for regional holidays
 * @returns Number of working days
 */
export function countWorkingDaysBetween(
    startDate: Date,
    endDate: Date,
    region?: NZRegion
): number {
    let count = 0;
    let current = addDays(startDate, 1);

    while (isBefore(current, endDate) || isSameDay(current, endDate)) {
        if (isNZWorkingDay(current, region)) {
            count++;
        }
        current = addDays(current, 1);
    }

    return count;
}

/**
 * Add working days to a date
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

// ============================================================================
// DATE PARSING AND FORMATTING
// ============================================================================

/**
 * Parse an ISO date string to a Date object
 * Re-export from date-fns for consistency
 */
export function parseDateISO(dateString: string): Date {
    return parseISO(dateString);
}

/**
 * Format a date to ISO string (YYYY-MM-DD)
 *
 * @param date - Date to format
 * @returns ISO date string (e.g., "2026-01-15")
 */
export function formatDateISO(date: Date): string {
    return format(date, 'yyyy-MM-dd');
}

/**
 * Format a date for display
 *
 * @param date - Date to format
 * @param formatString - date-fns format string (default: 'MMM d, yyyy')
 * @returns Formatted date string
 */
export function formatDateDisplay(date: Date, formatString: string = 'MMM d, yyyy'): string {
    return format(date, formatString);
}

/**
 * Convert any date to NZ timezone
 *
 * @param date - Date to convert
 * @returns Date in NZ timezone
 */
export function toNZTimezone(date: Date): Date {
    return toZonedTime(date, NZ_TIMEZONE);
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

// Re-export commonly used date-fns functions for convenience
export { startOfDay, isBefore, isAfter, isSameDay, parseISO, format };
