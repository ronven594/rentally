/**
 * Payment Date Math - Shared Logic for Ledger and Status Resolver
 *
 * This file contains the SINGLE SOURCE OF TRUTH for all PAYMENT date calculations.
 * Both ledger-regenerator.ts and tenant-status-resolver.ts MUST use these
 * functions to ensure consistency.
 *
 * KEY CONCEPTS:
 * - Ground Zero: The first valid due day on or after trackingStartDate
 * - Cycle: A single payment period (Weekly, Fortnightly, or Monthly)
 * - Paid Until: The date up to which the tenant has paid (Ground Zero + paid cycles)
 * - Days Overdue: Days from today to the next due date after paid_until
 *
 * IMPORTANT: This file uses date-utils.ts for all foundational date operations.
 * Never import directly from date-fns - use date-utils instead.
 */

import {
    // Core date utilities from our unified module
    parseDateISO,
    formatDateDisplay,
    formatDateISO,
    addDays,
    addWeeks,
    addMonths,
    daysBetween,
    startOfDay,
    isBefore,
    isAfter,
    isSameDay,
    // Day utilities
    getDayIndexFromName,
    DAY_NAME_TO_JS_INDEX,
    // Due date utilities
    findFirstDueDate as findFirstDueDateUtil,
    advanceDueDate as advanceDueDateUtil,
    type DueDateSettings
} from "./date-utils";
import { getDaysInMonth, nextDay, format } from "date-fns";

export type PaymentFrequency = 'Weekly' | 'Fortnightly' | 'Monthly';

export interface DateMathSettings {
    trackingStartDate: string; // ISO date string (YYYY-MM-DD)
    frequency: PaymentFrequency;
    rentDueDay: string; // Day name for Weekly/Fortnightly, day number for Monthly
    rentAmount: number;
}

export interface PaidUntilResult {
    groundZero: Date;
    paidUntilDate: Date;
    nextDueDate: Date;
    cyclesPaid: number;
    cyclesUnpaid: number;
    daysOverdue: number;
    totalCycles: number;
}

/**
 * Convert DateMathSettings to DueDateSettings for date-utils functions
 */
function toDueDateSettings(settings: DateMathSettings): DueDateSettings {
    return {
        frequency: settings.frequency,
        dueDay: settings.frequency === 'Monthly'
            ? parseInt(settings.rentDueDay, 10) || 1
            : settings.rentDueDay
    };
}

/**
 * Calculate "Ground Zero" - the first valid due day on or after trackingStartDate
 *
 * This is the ANCHOR for all payment calculations. Every due date must fall on
 * the due day grid starting from Ground Zero.
 *
 * @param settings - Date math settings
 * @returns The Ground Zero date (first valid due day)
 */
export function calculateGroundZero(settings: DateMathSettings): Date {
    const trackingStart = startOfDay(parseDateISO(settings.trackingStartDate));

    console.log('📍 Calculating Ground Zero:', {
        trackingStartDate: settings.trackingStartDate,
        frequency: settings.frequency,
        rentDueDay: settings.rentDueDay
    });

    let groundZero: Date;

    if (settings.frequency === 'Monthly') {
        // For Monthly: Find the first occurrence of the day of month
        const targetDay = parseInt(settings.rentDueDay, 10) || 1;

        // Start with current month
        let year = trackingStart.getFullYear();
        let month = trackingStart.getMonth();

        // Get effective day for this month (handle months with fewer days)
        let daysInMonth = getDaysInMonth(new Date(year, month, 1));
        let effectiveDay = Math.min(targetDay, daysInMonth);

        groundZero = new Date(year, month, effectiveDay);

        // If Ground Zero is before tracking start, move to next month
        if (isBefore(groundZero, trackingStart)) {
            month += 1;
            if (month > 11) {
                month = 0;
                year += 1;
            }
            daysInMonth = getDaysInMonth(new Date(year, month, 1));
            effectiveDay = Math.min(targetDay, daysInMonth);
            groundZero = new Date(year, month, effectiveDay);
        }

        console.log('📅 Monthly Ground Zero calculation:', {
            targetDay,
            effectiveDay,
            groundZero: format(groundZero, 'yyyy-MM-dd (EEEE)'),
            daysInMonth
        });
    } else {
        // For Weekly/Fortnightly: Find the first occurrence of the target day
        const targetDayName = settings.rentDueDay;
        const targetDayIndex = getDayIndexFromName(targetDayName);

        if (targetDayIndex === undefined) {
            console.error(`Invalid day name: ${targetDayName}`);
            throw new Error(`Invalid day name: ${targetDayName}`);
        }

        const trackingStartDayIndex = trackingStart.getDay();

        // If tracking start IS the target day, use it as Ground Zero
        if (trackingStartDayIndex === targetDayIndex) {
            groundZero = trackingStart;
        } else {
            // Find the next occurrence of the target day
            groundZero = nextDay(trackingStart, targetDayIndex);
        }

        console.log('📅 Weekly/Fortnightly Ground Zero calculation:', {
            targetDayName,
            targetDayIndex,
            trackingStartDay: trackingStart.getDay(),
            groundZero: format(groundZero, 'yyyy-MM-dd (EEEE)')
        });
    }

    console.log('✅ Ground Zero:', format(groundZero, 'yyyy-MM-dd (EEEE)'));
    return startOfDay(groundZero);
}

/**
 * Get the next due date after a given date (not including the given date)
 *
 * @param afterDate - The date to start from
 * @param settings - Date math settings
 * @returns The next due date
 */
export function getNextDueDate(afterDate: Date, settings: DateMathSettings): Date {
    const groundZero = calculateGroundZero(settings);
    const normalizedAfterDate = startOfDay(afterDate);

    // If afterDate is before Ground Zero, return Ground Zero
    if (isBefore(normalizedAfterDate, groundZero)) {
        return groundZero;
    }

    // Count cycles from Ground Zero to afterDate
    let currentDue = groundZero;
    let iterations = 0;
    const maxIterations = 1000;

    while (iterations < maxIterations) {
        const nextDue = advanceByOneCycle(currentDue, settings);

        // If next due is after afterDate, that's our answer
        if (isAfter(nextDue, normalizedAfterDate)) {
            return startOfDay(nextDue);
        }

        currentDue = nextDue;
        iterations++;
    }

    // Fallback (should never reach here)
    console.error('Max iterations reached in getNextDueDate');
    return advanceByOneCycle(normalizedAfterDate, settings);
}

/**
 * Advance a date by one cycle based on frequency
 *
 * @param date - The current due date
 * @param settings - Date math settings
 * @returns The next due date
 */
export function advanceByOneCycle(date: Date, settings: DateMathSettings): Date {
    const normalizedDate = startOfDay(date);

    if (settings.frequency === 'Weekly') {
        return addWeeks(normalizedDate, 1);
    } else if (settings.frequency === 'Fortnightly') {
        return addWeeks(normalizedDate, 2);
    } else {
        // Monthly - handle day snapping for months with fewer days
        const targetDay = parseInt(settings.rentDueDay, 10) || 1;
        const nextMonth = addMonths(normalizedDate, 1);
        const daysInNextMonth = getDaysInMonth(nextMonth);
        const effectiveDay = Math.min(targetDay, daysInNextMonth);

        return new Date(nextMonth.getFullYear(), nextMonth.getMonth(), effectiveDay);
    }
}

/**
 * Count the number of cycles from Ground Zero to a given date (inclusive)
 *
 * @param toDate - The end date
 * @param settings - Date math settings
 * @returns Number of cycles
 */
export function countCyclesToDate(toDate: Date, settings: DateMathSettings): number {
    const groundZero = calculateGroundZero(settings);
    const normalizedToDate = startOfDay(toDate);

    // If toDate is before Ground Zero, no cycles
    if (isBefore(normalizedToDate, groundZero)) {
        return 0;
    }

    let cycles = 0;
    let currentDue = groundZero;
    const maxIterations = 1000;

    while (cycles < maxIterations) {
        // If current due date is on or before toDate, count it
        if (isBefore(currentDue, normalizedToDate) || isSameDay(currentDue, normalizedToDate)) {
            cycles++;
            currentDue = advanceByOneCycle(currentDue, settings);
        } else {
            break;
        }
    }

    return cycles;
}

/**
 * Get the due date for a specific cycle number (1-indexed)
 *
 * @param cycleNumber - The cycle number (1 = Ground Zero, 2 = next cycle, etc.)
 * @param settings - Date math settings
 * @returns The due date for that cycle
 */
export function getDueDateForCycle(cycleNumber: number, settings: DateMathSettings): Date {
    if (cycleNumber < 1) {
        throw new Error('Cycle number must be >= 1');
    }

    const groundZero = calculateGroundZero(settings);

    if (cycleNumber === 1) {
        return groundZero;
    }

    let currentDue = groundZero;
    for (let i = 1; i < cycleNumber; i++) {
        currentDue = advanceByOneCycle(currentDue, settings);
    }

    return startOfDay(currentDue);
}

/**
 * Calculate "Paid Until" date and related metrics
 *
 * This is the CORE function for determining tenant status. It calculates:
 * - How many cycles the tenant has paid for
 * - The date they are "paid until"
 * - The next due date after that
 * - How many days overdue they are
 *
 * CRITICAL RULES (Future-Dating Prevention):
 * 1. ACCRUAL CAP: Total cycles only count up to TODAY, never future
 * 2. NO FUTURE-DATING: paid_until can NEVER be after the most recent past due date
 *    UNLESS Total_Paid > Total_Accrued (genuine credit balance)
 * 3. DUE DAY ANCHOR: paid_until must ALWAYS fall on a valid due day (e.g., Friday)
 *
 * IMPORTANT: currentDate parameter is REQUIRED. Do not use default = new Date().
 * Always pass the effective date from the calling context (respecting test date override).
 *
 * @param outstandingBalance - Current amount owed
 * @param settings - Date math settings
 * @param currentDate - Today's date (REQUIRED - for calculating days overdue)
 * @returns PaidUntilResult with all metrics
 */
export function calculatePaidUntilStatus(
    outstandingBalance: number,
    settings: DateMathSettings,
    currentDate: Date
): PaidUntilResult {
    const normalizedCurrentDate = startOfDay(currentDate);
    const groundZero = calculateGroundZero(settings);

    console.log('🧮 Calculating Paid Until Status:', {
        outstandingBalance,
        rentAmount: settings.rentAmount,
        frequency: settings.frequency,
        groundZero: format(groundZero, 'yyyy-MM-dd'),
        currentDate: format(normalizedCurrentDate, 'yyyy-MM-dd')
    });

    // =========================================================================
    // ACCRUAL CAP: Count total cycles from Ground Zero to today (inclusive)
    // This is the MAXIMUM number of cycles that can be "accrued" - never count future cycles
    // =========================================================================
    const totalCycles = countCyclesToDate(normalizedCurrentDate, settings);

    // Calculate total accrued rent (this is the CAP - can't owe more than this)
    const totalAccruedRent = Math.round(totalCycles * settings.rentAmount * 100) / 100;

    // Calculate total paid (Anchor Formula)
    const totalPaid = Math.round((totalAccruedRent - outstandingBalance) * 100) / 100;

    // Calculate cycles paid (floor to avoid partial cycle issues)
    const cyclesPaid = Math.max(0, Math.floor(totalPaid / settings.rentAmount));

    // Calculate cycles unpaid (capped at totalCycles - can't owe more cycles than have accrued)
    const cyclesUnpaid = Math.max(0, totalCycles - cyclesPaid);

    // Determine if tenant has CREDIT (paid more than accrued)
    const hasCredit = totalPaid > totalAccruedRent;
    const creditAmount = hasCredit ? totalPaid - totalAccruedRent : 0;
    const creditCycles = hasCredit ? Math.floor(creditAmount / settings.rentAmount) : 0;

    console.log('📊 Cycle calculation:', {
        totalCycles,
        totalAccruedRent,
        totalPaid,
        cyclesPaid,
        cyclesUnpaid,
        hasCredit,
        creditAmount: hasCredit ? `$${creditAmount.toFixed(2)}` : 'None',
        creditCycles,
        formula: `${totalCycles} total - ${cyclesPaid} paid = ${cyclesUnpaid} unpaid`
    });

    // =========================================================================
    // PAID UNTIL DATE CALCULATION (with Future-Dating Prevention)
    // =========================================================================
    // Rule: paid_until must be the MOST RECENT PAST due date, unless tenant has credit
    // =========================================================================
    let paidUntilDate: Date;
    let nextDueDate: Date;

    // Find the most recent past due date (the "anchor" - last completed cycle before today)
    const mostRecentPastDueDate = findMostRecentPastDueDate(normalizedCurrentDate, settings);

    if (cyclesPaid === 0) {
        // Tenant hasn't paid any full cycles - paid until is before Ground Zero
        paidUntilDate = addDays(groundZero, -1);
        nextDueDate = groundZero;
    } else if (hasCredit && creditCycles > 0) {
        // GENUINE CREDIT: Tenant has paid MORE than accrued
        // ONLY in this case can paid_until extend into the future
        const futureCycles = Math.min(creditCycles, 52); // Cap at 1 year ahead
        paidUntilDate = getDueDateForCycle(totalCycles + futureCycles, settings);
        nextDueDate = advanceByOneCycle(paidUntilDate, settings);

        console.log('💳 CREDIT BALANCE detected - allowing future paid_until:', {
            creditCycles,
            futureCycles,
            paidUntilDate: format(paidUntilDate, 'yyyy-MM-dd (EEEE)')
        });
    } else if (cyclesPaid >= totalCycles) {
        // Tenant is FULLY PAID UP through today (no debt, no credit)
        // paid_until = most recent past due date (NOT future!)
        if (mostRecentPastDueDate) {
            paidUntilDate = mostRecentPastDueDate;
        } else {
            // Edge case: no past due dates yet (we're before Ground Zero)
            paidUntilDate = addDays(groundZero, -1);
        }
        nextDueDate = getNextDueDate(paidUntilDate, settings);

        console.log('✅ Fully paid up - anchoring to most recent past due date:', {
            paidUntilDate: format(paidUntilDate, 'yyyy-MM-dd (EEEE)'),
            nextDueDate: format(nextDueDate, 'yyyy-MM-dd (EEEE)')
        });
    } else {
        // Tenant has paid some cycles but not all
        paidUntilDate = getDueDateForCycle(cyclesPaid, settings);
        nextDueDate = getDueDateForCycle(cyclesPaid + 1, settings);
    }

    // =========================================================================
    // FINAL VALIDATION: Ensure paid_until is NEVER in the future (unless credit)
    // =========================================================================
    if (!hasCredit && isAfter(paidUntilDate, normalizedCurrentDate)) {
        console.warn('⚠️ FUTURE-DATING PREVENTION: paid_until was in future, capping at most recent past due date');
        if (mostRecentPastDueDate) {
            paidUntilDate = mostRecentPastDueDate;
        } else {
            paidUntilDate = addDays(groundZero, -1);
        }
        nextDueDate = getNextDueDate(paidUntilDate, settings);
    }

    // Calculate days overdue
    // Days overdue = calendar days from next due date to today (if next due date is in the past)
    let daysOverdue = 0;
    if (isBefore(nextDueDate, normalizedCurrentDate) || isSameDay(nextDueDate, normalizedCurrentDate)) {
        daysOverdue = daysBetween(nextDueDate, normalizedCurrentDate);
    }

    const result: PaidUntilResult = {
        groundZero,
        paidUntilDate,
        nextDueDate,
        cyclesPaid: Math.min(cyclesPaid, totalCycles + creditCycles), // Include credit cycles if any
        cyclesUnpaid,
        daysOverdue,
        totalCycles
    };

    console.log('✅ Paid Until Status calculated:', {
        groundZero: format(groundZero, 'yyyy-MM-dd (EEEE)'),
        paidUntilDate: format(paidUntilDate, 'yyyy-MM-dd (EEEE)'),
        nextDueDate: format(nextDueDate, 'yyyy-MM-dd (EEEE)'),
        cyclesPaid: result.cyclesPaid,
        cyclesUnpaid,
        daysOverdue,
        totalCycles,
        hasCredit,
        interpretation: hasCredit
            ? `Tenant has CREDIT of $${creditAmount.toFixed(2)} (${creditCycles} cycle(s) ahead)`
            : cyclesUnpaid === 0
            ? 'Tenant is paid up!'
            : `Tenant is ${cyclesUnpaid} cycle(s) behind, ${daysOverdue} days overdue`
    });

    return result;
}

/**
 * Find the most recent past due date (on or before today)
 *
 * This is critical for the "Friday Anchor" rule - paid_until must always
 * be a valid due day that has already passed.
 *
 * @param currentDate - Today's date
 * @param settings - Date math settings
 * @returns The most recent past due date, or null if none exists
 */
export function findMostRecentPastDueDate(
    currentDate: Date,
    settings: DateMathSettings
): Date | null {
    const normalizedCurrentDate = startOfDay(currentDate);
    const groundZero = calculateGroundZero(settings);

    // If we're before Ground Zero, no past due dates exist
    if (isBefore(normalizedCurrentDate, groundZero)) {
        return null;
    }

    // If today IS a due date, return it
    const totalCycles = countCyclesToDate(normalizedCurrentDate, settings);
    if (totalCycles > 0) {
        const lastDueDate = getDueDateForCycle(totalCycles, settings);
        if (isBefore(lastDueDate, normalizedCurrentDate) || isSameDay(lastDueDate, normalizedCurrentDate)) {
            return lastDueDate;
        }
    }

    // Find the last due date before today
    if (totalCycles > 1) {
        return getDueDateForCycle(totalCycles - 1, settings);
    }

    return groundZero;
}

/**
 * Generate all payment due dates from Ground Zero to a target date
 *
 * This function ensures all dates fall on the correct due day grid.
 *
 * @param settings - Date math settings
 * @param targetDate - Generate dates up to and including this date
 * @returns Array of due dates
 */
export function generateAllDueDates(
    settings: DateMathSettings,
    targetDate: Date
): Date[] {
    const groundZero = calculateGroundZero(settings);
    const normalizedTarget = startOfDay(targetDate);
    const dueDates: Date[] = [];

    let currentDue = groundZero;
    let iterations = 0;
    const maxIterations = 1000;

    while (iterations < maxIterations) {
        if (isAfter(currentDue, normalizedTarget)) {
            break;
        }

        dueDates.push(startOfDay(currentDue));
        currentDue = advanceByOneCycle(currentDue, settings);
        iterations++;
    }

    console.log('📅 Generated due dates:', {
        count: dueDates.length,
        first: dueDates.length > 0 ? format(dueDates[0], 'yyyy-MM-dd') : 'None',
        last: dueDates.length > 0 ? format(dueDates[dueDates.length - 1], 'yyyy-MM-dd') : 'None',
        frequency: settings.frequency,
        rentDueDay: settings.rentDueDay
    });

    return dueDates;
}

/**
 * Verbose debugging output for date calculations
 *
 * Use this to diagnose drift issues.
 *
 * @param outstandingBalance - Current amount owed
 * @param settings - Date math settings
 * @param currentDate - Today's date (REQUIRED - pass test date or effective date)
 */
export function debugDateCalculation(
    outstandingBalance: number,
    settings: DateMathSettings,
    currentDate: Date
): void {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🔍 DATE MATH DEBUG OUTPUT');
    console.log('═══════════════════════════════════════════════════════════════');

    console.log('📝 INPUT SETTINGS:');
    console.log(`   - Tracking Start: ${settings.trackingStartDate}`);
    console.log(`   - Frequency: ${settings.frequency}`);
    console.log(`   - Due Day: ${settings.rentDueDay}`);
    console.log(`   - Rent Amount: $${settings.rentAmount}`);
    console.log(`   - Outstanding Balance: $${outstandingBalance}`);
    console.log(`   - Current Date: ${format(currentDate, 'yyyy-MM-dd')}`);

    const groundZero = calculateGroundZero(settings);
    console.log('');
    console.log('📍 GROUND ZERO:');
    console.log(`   - Date: ${format(groundZero, 'yyyy-MM-dd')}`);
    console.log(`   - Day: ${format(groundZero, 'EEEE')}`);

    const status = calculatePaidUntilStatus(outstandingBalance, settings, currentDate);
    console.log('');
    console.log('📊 CYCLE ANALYSIS:');
    console.log(`   - Total Cycles (Ground Zero to Today): ${status.totalCycles}`);
    console.log(`   - Total Accrued: $${(status.totalCycles * settings.rentAmount).toFixed(2)}`);
    console.log(`   - Total Paid: $${((status.totalCycles * settings.rentAmount) - outstandingBalance).toFixed(2)}`);
    console.log(`   - Cycles Paid: ${status.cyclesPaid}`);
    console.log(`   - Cycles Unpaid: ${status.cyclesUnpaid}`);

    console.log('');
    console.log('📅 KEY DATES:');
    console.log(`   - Paid Until: ${format(status.paidUntilDate, 'yyyy-MM-dd (EEEE)')}`);
    console.log(`   - Next Due: ${format(status.nextDueDate, 'yyyy-MM-dd (EEEE)')}`);
    console.log(`   - Days Overdue: ${status.daysOverdue}`);

    console.log('');
    console.log('🔍 VALIDATION:');
    const cycleBalanceCheck = status.cyclesUnpaid * settings.rentAmount;
    console.log(`   - Expected Balance (cycles × rent): $${cycleBalanceCheck.toFixed(2)}`);
    console.log(`   - Actual Balance: $${outstandingBalance.toFixed(2)}`);
    console.log(`   - Difference: $${Math.abs(cycleBalanceCheck - outstandingBalance).toFixed(2)}`);

    if (Math.abs(cycleBalanceCheck - outstandingBalance) < settings.rentAmount) {
        console.log('   - ✅ Balance is within one cycle tolerance');
    } else {
        console.log('   - ⚠️ WARNING: Balance differs by more than one cycle!');
    }

    // Future-dating validation
    const normalizedCurrentDate = startOfDay(currentDate);
    const mostRecentPastDue = findMostRecentPastDueDate(normalizedCurrentDate, settings);
    console.log('');
    console.log('🚫 FUTURE-DATING CHECK:');
    console.log(`   - Most Recent Past Due Date: ${mostRecentPastDue ? format(mostRecentPastDue, 'yyyy-MM-dd (EEEE)') : 'None'}`);
    console.log(`   - Paid Until Date: ${format(status.paidUntilDate, 'yyyy-MM-dd (EEEE)')}`);
    const paidUntilIsInFuture = isAfter(status.paidUntilDate, normalizedCurrentDate);
    const totalPaid = (status.totalCycles * settings.rentAmount) - outstandingBalance;
    const hasCredit = totalPaid > (status.totalCycles * settings.rentAmount);
    if (paidUntilIsInFuture && !hasCredit) {
        console.log('   - ⚠️ WARNING: Paid Until is in the future without credit!');
    } else if (paidUntilIsInFuture && hasCredit) {
        console.log('   - ✅ Paid Until is in the future (allowed - tenant has credit)');
    } else {
        console.log('   - ✅ Paid Until is correctly anchored to past due date');
    }

    console.log('═══════════════════════════════════════════════════════════════');
}
