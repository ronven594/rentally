/**
 * Rent Calculator - Deterministic Rent Calculation Engine
 *
 * This file provides the SINGLE SOURCE OF TRUTH for rent balance calculations.
 * It uses pure math, not ledger record statuses.
 *
 * THE FORMULA:
 * Total Rent Due = (Number of Cycles Elapsed) × (Rent Per Cycle)
 * Current Balance = Total Rent Due + Opening Arrears - Sum of Payments
 *
 * CRITICAL RULES:
 * 1. Balance is NEVER derived from ledger record statuses
 * 2. Ledger records are for DISPLAY only, not calculation
 * 3. This function is DETERMINISTIC - same inputs always produce same outputs
 * 4. All date calculations use date-utils.ts as the foundation
 *
 * IMPORTANT: This file uses date-utils.ts for all foundational date operations.
 * Never import directly from date-fns for core operations - use date-utils instead.
 */

import {
    getEffectiveToday,
    findFirstDueDate,
    findDueDateForCycle,
    advanceDueDate,
    countCycles,
    daysBetween,
    startOfDay,
    parseDateISO,
    formatDateISO,
    isBefore,
    isAfter,
    isSameDay,
    addDays,
    type DueDateSettings,
    type PaymentFrequency
} from "./date-utils";

// ============================================================================
// TYPES
// ============================================================================

export interface RentSettings {
    /** Payment frequency: Weekly, Fortnightly, or Monthly */
    frequency: PaymentFrequency;
    /** Rent amount per cycle */
    rentAmount: number;
    /** Day rent is due: "Monday"-"Sunday" for weekly/fortnightly, 1-31 for monthly */
    rentDueDay: string | number;
    /** When tracking started (ISO date string YYYY-MM-DD) */
    trackingStartDate: string;
    /** Opening balance/arrears when tracking started (defaults to 0) */
    openingArrears: number;
    /** Optional anchor date for fortnightly alignment */
    anchorDate?: string;
}

export interface Payment {
    /** Payment ID */
    id: string;
    /** Payment amount */
    amount: number;
    /** Payment date (ISO date string YYYY-MM-DD) */
    date: string;
}

export interface RentCalculationResult {
    // =========================================================================
    // CORE FINANCIAL STATE
    // =========================================================================

    /** Total rent that should have been paid by now (cycles × rent amount) */
    totalRentDue: number;

    /** Sum of all payments received */
    totalPayments: number;

    /** Starting debt/arrears when tracking began */
    openingArrears: number;

    /**
     * Current balance: positive = tenant owes, negative = credit
     * Formula: totalRentDue + openingArrears - totalPayments
     */
    currentBalance: number;

    // =========================================================================
    // CYCLE INFORMATION
    // =========================================================================

    /** How many rent cycles have elapsed (passed their due date) */
    cyclesElapsed: number;

    /**
     * How many complete cycles are covered by payments
     * Calculated: floor((totalPayments - openingArrears) / rentAmount)
     * Never negative, capped at cyclesElapsed for "paid up"
     */
    cyclesPaidInFull: number;

    /** Cycles still owed: cyclesElapsed - cyclesPaidInFull (capped at 0 minimum) */
    cyclesUnpaid: number;

    // =========================================================================
    // KEY DATES
    // =========================================================================

    /** First rent due date (Ground Zero) */
    firstDueDate: Date;

    /** Next upcoming due date (strictly after effective date) */
    nextDueDate: Date;

    /**
     * Last date fully covered by payments
     * - null if not even 1 cycle is paid
     * - equals day before next unpaid cycle's due date
     * - capped at effective date if paid ahead
     */
    paidUntilDate: Date | null;

    // =========================================================================
    // OVERDUE INFORMATION
    // =========================================================================

    /** Whether tenant currently owes money */
    isOverdue: boolean;

    /** Calendar days since first unpaid due date (0 if not overdue) */
    daysOverdue: number;

    /**
     * The due date when the debt started (oldest unpaid due date)
     * null if tenant is not overdue
     */
    oldestUnpaidDueDate: Date | null;

    // =========================================================================
    // DEBUG/AUDIT INFORMATION
    // =========================================================================

    /** The effective date used for calculation */
    effectiveDate: Date;

    /** Rent amount per cycle */
    rentAmount: number;

    /** Whether tenant has credit (negative balance) */
    hasCredit: boolean;

    /** Credit amount if tenant has paid ahead (0 if not) */
    creditAmount: number;
}

// ============================================================================
// MAIN CALCULATION FUNCTION
// ============================================================================

/**
 * THE MAIN CALCULATION FUNCTION
 *
 * This calculates the tenant's financial state deterministically.
 * It does NOT look at ledger records or payment statuses.
 * It uses pure math: (cycles × rent) + opening - payments
 *
 * @param settings - Rent settings (frequency, amount, due day, tracking start, opening arrears)
 * @param payments - Array of payments received (amount + date)
 * @param asOfDate - Optional date override for testing (defaults to today in NZ timezone)
 * @returns Complete rent calculation result
 *
 * @example
 * ```typescript
 * const result = calculateRentState(
 *   {
 *     frequency: 'Weekly',
 *     rentAmount: 400,
 *     rentDueDay: 'Wednesday',
 *     trackingStartDate: '2025-01-06',
 *     openingArrears: 0
 *   },
 *   [], // No payments
 *   new Date('2025-01-16')
 * );
 * // result.currentBalance = 800 (2 cycles × $400)
 * ```
 */
export function calculateRentState(
    settings: RentSettings,
    payments: Payment[],
    asOfDate?: Date | null
): RentCalculationResult {
    const effectiveDate = getEffectiveToday(asOfDate);

    console.log('🧮 RENT CALCULATOR - Starting calculation:', {
        frequency: settings.frequency,
        rentAmount: settings.rentAmount,
        rentDueDay: settings.rentDueDay,
        trackingStartDate: settings.trackingStartDate,
        openingArrears: settings.openingArrears,
        paymentCount: payments.length,
        effectiveDate: formatDateISO(effectiveDate)
    });

    // =========================================================================
    // STEP 1: Find first due date (Ground Zero)
    // =========================================================================
    const dueDateSettings: DueDateSettings = {
        frequency: settings.frequency,
        dueDay: settings.rentDueDay
    };

    const trackingStart = parseDateISO(settings.trackingStartDate);
    const firstDueDate = findFirstDueDate(trackingStart, dueDateSettings);

    console.log('📅 Ground Zero (First Due Date):', {
        trackingStartDate: settings.trackingStartDate,
        firstDueDate: formatDateISO(firstDueDate),
        dayOfWeek: firstDueDate.toLocaleDateString('en-NZ', { weekday: 'long' })
    });

    // =========================================================================
    // STEP 2: Count elapsed cycles (up to effective date)
    // =========================================================================
    const cyclesElapsed = countCyclesElapsed(firstDueDate, effectiveDate, dueDateSettings);

    console.log('📊 Cycles elapsed:', {
        cyclesElapsed,
        calculation: `From ${formatDateISO(firstDueDate)} to ${formatDateISO(effectiveDate)}`
    });

    // =========================================================================
    // STEP 3: Calculate total rent due
    // =========================================================================
    const totalRentDue = roundMoney(cyclesElapsed * settings.rentAmount);

    // =========================================================================
    // STEP 4: Sum payments
    // =========================================================================
    const totalPayments = roundMoney(
        payments.reduce((sum, p) => sum + p.amount, 0)
    );

    console.log('💰 Payment summary:', {
        totalPayments,
        paymentCount: payments.length,
        payments: payments.map(p => ({ amount: p.amount, date: p.date }))
    });

    // =========================================================================
    // STEP 5: Calculate balance
    // =========================================================================
    // FORMULA: Balance = Total Rent Due + Opening Arrears - Total Payments
    const currentBalance = roundMoney(
        totalRentDue + settings.openingArrears - totalPayments
    );

    const hasCredit = currentBalance < 0;
    const creditAmount = hasCredit ? Math.abs(currentBalance) : 0;

    console.log('⚖️ Balance calculation:', {
        formula: `${totalRentDue} + ${settings.openingArrears} - ${totalPayments} = ${currentBalance}`,
        totalRentDue,
        openingArrears: settings.openingArrears,
        totalPayments,
        currentBalance,
        hasCredit,
        creditAmount
    });

    // =========================================================================
    // STEP 6: Calculate cycles paid
    // =========================================================================
    // Effective payments = total payments minus what went to opening arrears
    const paymentsForRent = Math.max(0, totalPayments - settings.openingArrears);
    const cyclesPaidInFull = Math.floor(paymentsForRent / settings.rentAmount);

    // Cycles unpaid = cycles elapsed minus cycles paid (min 0)
    const cyclesUnpaid = Math.max(0, cyclesElapsed - cyclesPaidInFull);

    console.log('📈 Cycle payment analysis:', {
        paymentsForRent,
        cyclesPaidInFull,
        cyclesUnpaid,
        explanation: `${totalPayments} total - ${settings.openingArrears} opening arrears = ${paymentsForRent} for rent → ${cyclesPaidInFull} full cycles`
    });

    // =========================================================================
    // STEP 7: Calculate paid until date
    // =========================================================================
    const paidUntilDate = calculatePaidUntilDate(
        cyclesPaidInFull,
        firstDueDate,
        dueDateSettings,
        effectiveDate
    );

    // =========================================================================
    // STEP 8: Calculate next due date
    // =========================================================================
    const nextDueDate = calculateNextDueDate(
        firstDueDate,
        effectiveDate,
        dueDateSettings
    );

    // =========================================================================
    // STEP 9: Calculate overdue status
    // =========================================================================
    const isOverdue = currentBalance > 0;
    const oldestUnpaidDueDate = isOverdue
        ? calculateOldestUnpaidDueDate(cyclesPaidInFull, firstDueDate, dueDateSettings, settings.openingArrears > 0, trackingStart)
        : null;
    const daysOverdue = oldestUnpaidDueDate
        ? Math.max(0, daysBetween(oldestUnpaidDueDate, effectiveDate))
        : 0;

    console.log('⏰ Overdue status:', {
        isOverdue,
        oldestUnpaidDueDate: oldestUnpaidDueDate ? formatDateISO(oldestUnpaidDueDate) : null,
        daysOverdue,
        currentBalance
    });

    const result: RentCalculationResult = {
        // Core financial state
        totalRentDue,
        totalPayments,
        openingArrears: settings.openingArrears,
        currentBalance,

        // Cycle information
        cyclesElapsed,
        cyclesPaidInFull,
        cyclesUnpaid,

        // Key dates
        firstDueDate,
        nextDueDate,
        paidUntilDate,

        // Overdue information
        isOverdue,
        daysOverdue,
        oldestUnpaidDueDate,

        // Debug/audit information
        effectiveDate,
        rentAmount: settings.rentAmount,
        hasCredit,
        creditAmount
    };

    console.log('✅ RENT CALCULATOR - Final result:', {
        currentBalance: result.currentBalance,
        cyclesElapsed: result.cyclesElapsed,
        cyclesPaidInFull: result.cyclesPaidInFull,
        cyclesUnpaid: result.cyclesUnpaid,
        daysOverdue: result.daysOverdue,
        paidUntilDate: result.paidUntilDate ? formatDateISO(result.paidUntilDate) : null,
        nextDueDate: formatDateISO(result.nextDueDate),
        oldestUnpaidDueDate: result.oldestUnpaidDueDate ? formatDateISO(result.oldestUnpaidDueDate) : null
    });

    return result;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Round to cents (2 decimal places) to avoid floating point issues
 */
function roundMoney(amount: number): number {
    return Math.round(amount * 100) / 100;
}

/**
 * Count how many complete cycles have elapsed from firstDueDate to asOfDate
 *
 * CRITICAL: A cycle is "elapsed" when its due date is ON or BEFORE asOfDate.
 * The first due date itself counts as cycle 1 if it's on/before asOfDate.
 *
 * @example
 * // First due: Jan 8 (Wednesday)
 * // As of: Jan 16 (Thursday)
 * // Cycles: 2 (Jan 8 = cycle 1, Jan 15 = cycle 2)
 */
function countCyclesElapsed(
    firstDueDate: Date,
    asOfDate: Date,
    settings: DueDateSettings
): number {
    // If we haven't reached the first due date, no cycles have elapsed
    if (isBefore(asOfDate, firstDueDate)) {
        return 0;
    }

    // Use the countCycles function from date-utils
    // It counts cycles where due date is on or before asOfDate
    return countCycles(firstDueDate, asOfDate, settings);
}

/**
 * Calculate the "paid until" date based on cycles paid
 *
 * Rules:
 * - If 0 cycles paid, return null (not even 1 cycle covered)
 * - Otherwise, return the due date of the last fully paid cycle
 * - If paid ahead (more cycles than elapsed), cap at effective date
 */
function calculatePaidUntilDate(
    cyclesPaid: number,
    firstDueDate: Date,
    settings: DueDateSettings,
    effectiveDate: Date
): Date | null {
    if (cyclesPaid === 0) {
        return null;
    }

    // Paid until is the due date of the last paid cycle
    const lastPaidCycleDueDate = findDueDateForCycle(firstDueDate, settings, cyclesPaid);

    // If the tenant has paid ahead (last paid cycle is after today), cap at effective date
    if (isAfter(lastPaidCycleDueDate, effectiveDate)) {
        return effectiveDate;
    }

    return lastPaidCycleDueDate;
}

/**
 * Calculate the oldest unpaid due date
 *
 * This is the due date when the current debt started.
 * - If opening arrears exist, this is the tracking start date
 * - Otherwise, it's the (cyclesPaid + 1)th cycle's due date
 */
function calculateOldestUnpaidDueDate(
    cyclesPaid: number,
    firstDueDate: Date,
    settings: DueDateSettings,
    hasOpeningArrears: boolean,
    trackingStartDate: Date
): Date {
    // If there are opening arrears, the debt started at tracking start
    if (hasOpeningArrears && cyclesPaid === 0) {
        return trackingStartDate;
    }

    // Otherwise, the oldest unpaid due date is the (cyclesPaid + 1)th cycle
    // e.g., if 1 cycle is paid, the first unpaid is cycle 2
    return findDueDateForCycle(firstDueDate, settings, cyclesPaid + 1);
}

/**
 * Calculate the next due date (strictly after effectiveDate)
 */
function calculateNextDueDate(
    firstDueDate: Date,
    effectiveDate: Date,
    settings: DueDateSettings
): Date {
    // If effective date is before first due date, return first due date
    if (isBefore(effectiveDate, firstDueDate)) {
        return firstDueDate;
    }

    // Find the next due date after effectiveDate
    let currentDue = firstDueDate;
    let iterations = 0;
    const maxIterations = 1000;

    while (iterations < maxIterations) {
        // If current due is after effective date, that's our answer
        if (isAfter(currentDue, effectiveDate)) {
            return currentDue;
        }

        currentDue = advanceDueDate(currentDue, settings);
        iterations++;
    }

    // Fallback (should never reach)
    console.error('Max iterations reached in calculateNextDueDate');
    return advanceDueDate(effectiveDate, settings);
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Convert tenant data to RentSettings for calculation
 *
 * @param tenant - Tenant object from database
 * @returns RentSettings for calculateRentState
 */
export function toRentSettings(tenant: {
    frequency: PaymentFrequency;
    rentAmount: number;
    rentDueDay: string;
    trackingStartDate?: string;
    openingArrears?: number;
}): RentSettings {
    return {
        frequency: tenant.frequency,
        rentAmount: tenant.rentAmount,
        rentDueDay: tenant.frequency === 'Monthly'
            ? parseInt(tenant.rentDueDay, 10) || 1
            : tenant.rentDueDay,
        trackingStartDate: tenant.trackingStartDate || formatDateISO(new Date()),
        openingArrears: tenant.openingArrears || 0
    };
}

/**
 * Convert payment history to Payment array for calculation
 *
 * @param payments - Payment records from database
 * @returns Payment array for calculateRentState
 */
export function toPayments(payments: Array<{
    id: string;
    amount_paid?: number;
    amount?: number;
    paidDate?: string;
    date?: string;
}>): Payment[] {
    return payments
        .filter(p => {
            // Only include actual payments (not unpaid records)
            const amount = p.amount_paid ?? p.amount ?? 0;
            const date = p.paidDate ?? p.date;
            return amount > 0 && date;
        })
        .map(p => ({
            id: p.id,
            amount: p.amount_paid ?? p.amount ?? 0,
            date: p.paidDate ?? p.date ?? ''
        }));
}

// ============================================================================
// EXPORTS
// ============================================================================

export type { PaymentFrequency, DueDateSettings };
