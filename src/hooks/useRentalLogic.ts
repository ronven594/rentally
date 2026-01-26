/**
 * useRentalLogic Hook
 *
 * React hook that bridges legal-engine.ts to UI components.
 * Provides RTA-compliant status calculations for tenant rent management.
 *
 * This hook translates legal analysis into UI-friendly data structures,
 * ensuring all tenant statuses reflect working day calculations and legal thresholds.
 *
 * PERFORMANCE: Uses stable memoization to prevent unnecessary re-renders.
 * Only re-calculates when actual data changes, not when array references change.
 *
 * IMPORTANT: Uses date-utils.ts for all date handling to ensure consistency.
 */

import { useMemo } from 'react';
import { analyzeTenancySituation, type StrikeRecord, type AnalysisResult } from '@/lib/legal-engine';
import { STRIKE_NOTICE_WORKING_DAYS, TERMINATION_ELIGIBLE_DAYS, NOTICE_REMEDY_PERIOD, TRIBUNAL_FILING_WINDOW_DAYS } from '@/lib/rta-constants';
import type { RentPayment } from '@/types';
import type { NZRegion } from '@/lib/nz-holidays';
import { parseISO, differenceInCalendarDays, format, isAfter, isBefore, isEqual, addWeeks, addMonths, getDay, nextDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

// Import NZ_TIMEZONE from unified date-utils module (single source of truth)
import { NZ_TIMEZONE, addDays, startOfDay } from '@/lib/date-utils';

// Import deterministic rent calculator
import { calculateRentState, toRentSettings, toPayments, type RentSettings } from '@/lib/rent-calculator';

// ============================================================================
// TYPES
// ============================================================================

export interface UseRentalLogicInput {
    tenantId: string;
    payments: RentPayment[];
    strikeHistory: StrikeRecord[];
    region?: NZRegion;
    currentDate?: Date;
    trackingStartDate?: string; // YYYY-MM-DD format - when we started tracking this tenant (defaults to today)
    openingArrears?: number; // Any existing debt when we started tracking (defaults to 0)
    frequency?: "Weekly" | "Fortnightly" | "Monthly"; // Payment frequency for due date calculation
    rentDueDay?: string; // e.g. "Wednesday" for weekly/fortnightly, or "1" for monthly (day of month)
    rentAmount?: number; // Rent amount per cycle (required for deterministic calculation)
}

// ============================================================================
// STABLE REFERENCE HELPERS (Performance Optimization)
// ============================================================================

/**
 * Creates a stable hash string from payments array to detect actual changes.
 * This prevents unnecessary re-calculations when the payments array reference changes
 * but the data is identical.
 *
 * @param payments - Array of rent payments
 * @returns Stable hash string representing the payments data
 */
function getPaymentsHash(payments: RentPayment[]): string {
    // Sort by ID to ensure consistent ordering
    const sorted = [...payments].sort((a, b) => a.id.localeCompare(b.id));

    // Create hash from critical fields: id, status, dueDate, paidDate, amount_paid
    return sorted
        .map(p => `${p.id}:${p.status}:${p.dueDate}:${p.paidDate || ''}:${p.amount_paid || 0}`)
        .join('|');
}

/**
 * Creates a stable hash string from strike history to detect actual changes.
 *
 * @param strikes - Array of strike records
 * @returns Stable hash string representing the strike data
 */
function getStrikesHash(strikes: StrikeRecord[]): string {
    // Sort by noticeId to ensure consistent ordering
    const sorted = [...strikes].sort((a, b) => a.noticeId.localeCompare(b.noticeId));

    // Create hash from critical fields
    return sorted
        .map(s => `${s.noticeId}:${s.type}:${s.officialServiceDate}`)
        .join('|');
}

// ============================================================================
// STRIKE MEMORY LOGIC (90-Day Rolling Window)
// ============================================================================

/**
 * Gets active strikes within the 90-day rolling window from current date.
 *
 * CRITICAL: Strike Memory Rule
 * - A strike remains "active" for 90 days from its Official Service Date
 * - This is independent of whether the rent has been paid
 * - Paid rent only prevents NEW strikes, it doesn't erase existing ones
 *
 * @param notices - Full strike history (do NOT filter by paid status)
 * @param currentDate - Current date for window calculation
 * @returns Count of active strikes within 90-day window
 *
 * @example
 * ```typescript
 * // Tenant has 2 strikes from 30 and 60 days ago, but rent is now paid
 * const activeStrikes = getActiveStrikes(allStrikes, new Date());
 * // Returns: 2 (strikes remain active even if paid)
 * ```
 */
export function getActiveStrikes(notices: StrikeRecord[], currentDate: Date = new Date()): number {
    // Filter for strike notices only (not remedy notices)
    const strikeNotices = notices.filter(n => n.type === 'S55_STRIKE');

    if (strikeNotices.length === 0) return 0;

    // Count strikes where Official Service Date is within last 90 days
    const activeStrikes = strikeNotices.filter(strike => {
        const serviceDate = parseISO(strike.officialServiceDate);
        const daysSinceService = differenceInCalendarDays(currentDate, serviceDate);

        // Strike is active if it's 0-90 days old
        return daysSinceService >= 0 && daysSinceService <= 90;
    });

    return activeStrikes.length;
}

export interface RentalLogicResult {
    /** UI status: CLEAR (no arrears), PENDING (1-4 days), ARREARS (5+ working days), TERMINATION_RISK (21+ days or 3 strikes) */
    status: 'CLEAR' | 'PENDING' | 'ARREARS' | 'TERMINATION_RISK';

    /** Calendar days overdue (from earliest unpaid due date) */
    daysOverdue: number;

    /** Working days overdue (RTA critical - excludes weekends, holidays, summer blackout) */
    workingDaysOverdue: number;

    /** Total balance due across all unpaid/partial payments */
    totalBalanceDue: number;

    /** Legal actions available: ['SEND_14_DAY_REMEDY', 'SEND_STRIKE_NOTICE', 'APPLY_TERMINATION'] */
    eligibleActions: string[];

    /** Current active strike count within 90-day window (INDEPENDENT of payment status) */
    strikeCount: number;

    /**
     * Active strikes from strike history (90-day rolling window).
     * CRITICAL: This count persists even if rent is paid.
     * Use this for StrikeBar UI display.
     */
    activeStrikeCount: number;

    /** Whether current strikes are within the 90-day tribunal window */
    isWithin90DayWindow: boolean;

    // ============================================================================
    // MULTI-PATH TERMINATION ELIGIBILITY (RTA Compliance)
    // ============================================================================

    /**
     * Section 55(1)(a): 21-Day Rule
     * TRUE if daysOverdue >= 21 (calendar days)
     * Action: Apply to Tribunal for termination immediately
     */
    isEligibleSection55_1a: boolean;

    /**
     * Section 56: Unremedied Breach
     * TRUE if a 14-Day Notice to Remedy was served AND expiry date has passed without full payment
     * Action: Apply to Tribunal based on unremedied breach
     * Note: Requires checking notice history for active S56 notices
     */
    isEligibleSection56: boolean;

    /**
     * Section 55(1)(aa): Three Strikes Rule
     * TRUE if 3 Strike Notices served within any 90-day rolling window
     * Action: Apply to Tribunal within 28 days of 3rd notice being served
     *
     * CRITICAL: This will be FALSE if 28-day deadline has passed (right to apply is lost)
     */
    isEligibleSection55_1aa: boolean;

    /**
     * Days remaining in 28-day tribunal filing window (for 3-strike rule)
     * null if not applicable (less than 3 strikes)
     * 0 if deadline has passed (right to apply is LOST)
     * 1-28 if within filing window (URGENT if < 7 days)
     */
    tribunalDeadlineDays: number | null;

    /** Full legal analysis result from legal-engine.ts */
    legalAnalysis: AnalysisResult;

    /**
     * The calendar date of the FIRST unpaid rent cycle.
     * CRITICAL: This is an ANCHORED date that does NOT change daily.
     * Calculated from trackingStartDate + frequency + rentDueDay.
     * null if no overdue cycles exist (tenant is current).
     *
     * Example: If tenant started tracking Dec 31 with Wednesday due days,
     * and Jan 1 (Wednesday) is unpaid, firstMissedDueDate = "2025-01-01"
     */
    firstMissedDueDate: string | null;

    /**
     * Number of rent cycles missed since firstMissedDueDate.
     * Calculated as: Math.floor(daysSinceFirstMissed / cycleLength)
     * - Weekly: cycleLength = 7
     * - Fortnightly: cycleLength = 14
     * - Monthly: cycleLength = ~30 (calculated dynamically)
     *
     * CRITICAL: If missedCycleCount >= 3, this is a LEGAL EMERGENCY in NZ.
     * The UI should force the critical state regardless of calendar days.
     *
     * 0 if no missed payments, 1+ if cycles are missed.
     */
    missedCycleCount: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Compares two monetary amounts for equality using cents-based integer math.
 *
 * CRITICAL: Avoids floating point precision errors in financial calculations.
 * Instead of comparing $18.50 === $18.50 (which might fail due to 0.000001 differences),
 * we compare 1850 cents === 1850 cents (always reliable).
 *
 * @param amount1 - First amount in dollars
 * @param amount2 - Second amount in dollars
 * @returns true if amounts are equal (within 1 cent tolerance)
 *
 * @example
 * ```typescript
 * // Bad: 0.1 + 0.2 === 0.3 returns false in JavaScript!
 * // Good: moneyEquals(0.1 + 0.2, 0.3) returns true
 * const paid = 900.00;
 * const owed = 900.00;
 * if (moneyEquals(paid, owed)) {
 *     // Debt is fully paid
 * }
 * ```
 */
function moneyEquals(amount1: number, amount2: number): boolean {
    const cents1 = Math.round(amount1 * 100);
    const cents2 = Math.round(amount2 * 100);
    return cents1 === cents2;
}

/**
 * Checks if amount1 is greater than amount2 using cents-based integer math.
 *
 * @param amount1 - First amount in dollars
 * @param amount2 - Second amount in dollars
 * @returns true if amount1 > amount2 (by more than 1 cent)
 */
function moneyGreaterThan(amount1: number, amount2: number): boolean {
    const cents1 = Math.round(amount1 * 100);
    const cents2 = Math.round(amount2 * 100);
    return cents1 > cents2;
}

/**
 * Checks if a monetary amount is effectively zero (less than 1 cent).
 *
 * @param amount - Amount in dollars
 * @returns true if amount is zero or negligible
 */
function moneyIsZero(amount: number): boolean {
    return Math.abs(Math.round(amount * 100)) === 0;
}

/**
 * Creates metadata snapshot for S56_REMEDY notice.
 *
 * CRITICAL: Captures the SPECIFIC debt that the notice is addressing.
 * This allows tracking whether THIS SPECIFIC debt was paid, not just any debt.
 *
 * @param ledger - Current ledger entries (will snapshot unpaid ones)
 * @returns S56NoticeMetadata containing debt snapshot
 *
 * @example
 * ```typescript
 * // When creating a 14-Day Notice to Remedy
 * const metadata = createS56Metadata(unpaidLedger);
 * // Store this in notices.metadata JSONB column
 * await supabase.from('notices').insert({
 *     notice_type: 'S56_REMEDY',
 *     metadata: metadata,
 *     // ... other fields
 * });
 * ```
 */
export function createS56Metadata(ledger: Array<{
    id: string;
    dueDate: string;
    amount: number;
    amountPaid: number;
    status: string;
}>): import('@/lib/legal-engine').S56NoticeMetadata {
    // Filter to unpaid/partial entries
    const unpaidEntries = ledger.filter(e =>
        e.status === 'Unpaid' || e.status === 'Partial'
    );

    const ledger_entry_ids = unpaidEntries.map(e => e.id);
    const due_dates = unpaidEntries.map(e => e.dueDate);

    // Calculate unpaid amounts for each due date
    const unpaid_amounts: Record<string, number> = {};
    unpaidEntries.forEach(entry => {
        const unpaidAmount = entry.amount - (entry.amountPaid || 0);
        unpaid_amounts[entry.dueDate] = unpaidAmount;
    });

    // Total amount owed at this moment
    const total_amount_owed = unpaidEntries.reduce(
        (sum, entry) => sum + (entry.amount - (entry.amountPaid || 0)),
        0
    );

    return {
        ledger_entry_ids,
        due_dates,
        total_amount_owed,
        unpaid_amounts,
    };
}

// ============================================================================
// FIRST MISSED DUE DATE CALCULATION
// ============================================================================

/**
 * Maps day name to date-fns day number (0 = Sunday, 6 = Saturday)
 */
const DAY_NAME_TO_NUMBER: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
    'Sunday': 0,
    'Monday': 1,
    'Tuesday': 2,
    'Wednesday': 3,
    'Thursday': 4,
    'Friday': 5,
    'Saturday': 6,
};

/**
 * Calculates the FIRST unpaid due date starting from trackingStartDate.
 * This date is ANCHORED and does not change daily (unlike subDays(today, daysOverdue)).
 *
 * Algorithm:
 * 1. Start from trackingStartDate
 * 2. Find the first due date on or after that date (based on rentDueDay + frequency)
 * 3. Check if that due date is covered by payments
 * 4. If not covered, that's the first missed date
 * 5. If covered, advance to next due date and repeat until we find an unpaid one or reach today
 *
 * @param trackingStartDate - When we started tracking this tenant (YYYY-MM-DD)
 * @param frequency - Payment frequency: Weekly, Fortnightly, or Monthly
 * @param rentDueDay - Day rent is due: "Wednesday" for weekly/fortnightly, or "1"-"28" for monthly
 * @param payments - All payment records for this tenant
 * @param currentDate - Today's date (for determining what's "overdue")
 * @returns ISO date string of first unpaid due date, or null if no overdue payments
 */
function calculateFirstMissedDueDate(
    trackingStartDate: string | undefined,
    frequency: "Weekly" | "Fortnightly" | "Monthly" | undefined,
    rentDueDay: string | undefined,
    payments: Array<{ dueDate: string; amount: number; amountPaid: number; status: string }>,
    currentDate: Date
): string | null {
    // =========================================================================
    // DATABASE-DRIVEN APPROACH (Resilient to Setting Changes)
    // =========================================================================
    // This function now uses ACTUAL payment records as the source of truth
    // instead of generating theoretical due dates based on current settings.
    //
    // WHY THIS APPROACH:
    // 1. Frequency-agnostic: Works with mixed Weekly/Fortnightly/Monthly records
    // 2. Setting-agnostic: Handles rentDueDay changes (30th → 1st)
    // 3. Audit-trail preserving: Uses historical due_dates as they were recorded
    // 4. No theoretical date generation: No mismatch between theory and reality
    //
    // ALGORITHM:
    // 1. Take ALL payment records from database (source of truth)
    // 2. Sort by due_date (oldest first)
    // 3. Find first record that's unpaid/partial AND before today
    // 4. Return its actual due_date from the database
    // =========================================================================

    // If missing required data, cannot calculate
    if (!trackingStartDate || !frequency || !rentDueDay) {
        console.warn('⚠️ calculateFirstMissedDueDate - Missing required data:', {
            hasTrackingStartDate: !!trackingStartDate,
            hasFrequency: !!frequency,
            hasRentDueDay: !!rentDueDay
        });
        return null;
    }

    // Normalize current date to NZ timezone start of day
    const todayNZ = toZonedTime(currentDate, NZ_TIMEZONE);
    const today = startOfDay(todayNZ);

    // Parse tracking start date for logging purposes
    const trackingStart = startOfDay(toZonedTime(parseISO(trackingStartDate), NZ_TIMEZONE));

    // DIAGNOSTIC: Log input data for debugging
    console.log('🔍 calculateFirstMissedDueDate - Database-Driven Approach:', {
        trackingStartDate,
        today: format(today, 'yyyy-MM-dd'),
        currentFrequency: frequency,
        currentRentDueDay: rentDueDay,
        paymentRecordCount: payments.length,
        approachDescription: 'Using actual payment records, not theoretical dates'
    });

    // =========================================================================
    // STEP 1: Process all payment records from database
    // =========================================================================
    // Group payments by due_date and calculate paid/owed for each
    // This handles duplicate records for the same due date
    const paymentsByDueDate = new Map<string, { paid: number; owed: number }>();

    payments.forEach(p => {
        const dueDateStr = format(startOfDay(toZonedTime(parseISO(p.dueDate), NZ_TIMEZONE)), 'yyyy-MM-dd');
        const existing = paymentsByDueDate.get(dueDateStr) || { paid: 0, owed: 0 };
        existing.owed += p.amount;
        existing.paid += p.amountPaid || 0;
        paymentsByDueDate.set(dueDateStr, existing);
    });

    console.log('🔍 calculateFirstMissedDueDate - All Payment Records:', {
        paymentsByDueDateMap: Array.from(paymentsByDueDate.entries()).map(([date, data]) => ({
            date,
            owed: data.owed.toFixed(2),
            paid: data.paid.toFixed(2),
            status: data.paid >= data.owed - 0.01 ? 'PAID' : data.paid > 0 ? 'PARTIAL' : 'UNPAID',
            isBeforeToday: isBefore(parseISO(date), today)
        }))
    });

    // =========================================================================
    // STEP 2: Find first unpaid/partial record that's before today
    // =========================================================================
    // Sort by due_date (oldest first) and find first unpaid/partial that's overdue
    const sortedDueDates = Array.from(paymentsByDueDate.entries())
        .sort((a, b) => {
            const dateA = parseISO(a[0]);
            const dateB = parseISO(b[0]);
            return dateA.getTime() - dateB.getTime(); // Oldest first
        });

    for (const [dueDateStr, payment] of sortedDueDates) {
        const dueDate = parseISO(dueDateStr);
        const isBeforeToday = isBefore(dueDate, today);
        const isUnpaidOrPartial = payment.paid < payment.owed - 0.01;

        console.log('🔍 Checking payment record:', {
            dueDateStr,
            paid: payment.paid.toFixed(2),
            owed: payment.owed.toFixed(2),
            percentPaid: ((payment.paid / payment.owed) * 100).toFixed(1) + '%',
            isUnpaidOrPartial,
            isBeforeToday,
            shouldReturn: isUnpaidOrPartial && isBeforeToday
        });

        // If this record is unpaid/partial AND before today, this is our answer
        if (isUnpaidOrPartial && isBeforeToday) {
            console.log('✅ FOUND FIRST MISSED DUE DATE (Database-Driven):', dueDateStr);
            return dueDateStr;
        }
    }

    // No unpaid due dates found before today
    console.log('❌ calculateFirstMissedDueDate - No missed due dates found before today');
    return null;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Pure function to calculate RTA-compliant rental status.
 * Can be used in useMemo/useCallback or other non-reactive contexts.
 *
 * CRITICAL: Non-Destructive Ledger Processing
 * - Do NOT filter the full payments array before passing to legal engine
 * - The legal engine needs ALL payment history to correctly calculate strike eligibility
 * - Strike memory depends on seeing the full ledger, not just current unpaid amounts
 *
 * @param input - Tenant payment data and strike history
 * @returns RentalLogicResult with status, overdue calculations, and eligible actions
 */
export function calculateRentalLogic(input: UseRentalLogicInput): RentalLogicResult {
    // CRITICAL: Pass FULL payment history to legal engine
    // Do not filter here - the legal engine will handle determining what's unpaid
    // This ensures strike calculations have access to the complete ledger history
    const ledger = input.payments.map(p => ({
        id: p.id,
        tenantId: input.tenantId,
        dueDate: p.dueDate,
        paidDate: p.paidDate,
        amount: p.amount,
        amountPaid: p.amount_paid || 0,
        status: p.status,
    }));

    // DEBUG TRACE: Log input tracking start date, opening arrears, and raw ledger count
    console.log('🔍 useRentalLogic DEBUG TRACE:', {
        trackingStartDate: input.trackingStartDate || 'NOT PROVIDED (defaults to today)',
        openingArrears: input.openingArrears || 0,
        rawLedgerCount: ledger.length,
        rawLedgerEntries: ledger.map(e => ({
            dueDate: e.dueDate,
            amount: e.amount,
            status: e.status,
            amountPaid: e.amountPaid
        }))
    });

    // Call legal engine for RTA compliance analysis
    const legalAnalysis = analyzeTenancySituation({
        tenantId: input.tenantId,
        region: input.region || 'Auckland',
        ledger,
        strikeHistory: input.strikeHistory,
        currentDate: input.currentDate,
        trackingStartDate: input.trackingStartDate,
        openingArrears: input.openingArrears || 0,
    });

    // DEBUG TRACE: Log filtered ledger count after legal engine processing
    console.log('🔍 Legal Engine Output:', {
        filteredTotalArrears: legalAnalysis.analysis.totalArrears,
        daysArrears: legalAnalysis.analysis.daysArrears,
        workingDaysOverdue: legalAnalysis.analysis.workingDaysOverdue,
        openingArrearsIncluded: input.openingArrears || 0,
        expectedFilteredCount: input.trackingStartDate
            ? `Should exclude entries before ${input.trackingStartDate}`
            : 'No filtering (no tracking start date provided)'
    });

    // =========================================================================
    // DETERMINISTIC BALANCE CALCULATION
    // =========================================================================
    // Use the deterministic rent calculator if all required fields are present.
    // Formula: Balance = (Cycles × Rent) + Opening Arrears - Sum(Payments)
    // Fallback to legal engine's status-based calculation if rentAmount is missing.
    // =========================================================================
    let totalBalanceDue: number;
    let deterministicDaysOverdue: number | null = null;
    let deterministicFirstMissedDate: Date | null = null;

    if (input.rentAmount && input.frequency && input.rentDueDay && input.trackingStartDate) {
        // Use deterministic calculation
        const rentSettings: RentSettings = {
            frequency: input.frequency,
            rentAmount: input.rentAmount,
            rentDueDay: input.frequency === 'Monthly'
                ? parseInt(input.rentDueDay, 10) || 1
                : input.rentDueDay,
            trackingStartDate: input.trackingStartDate,
            openingArrears: input.openingArrears || 0
        };

        // Convert payments to the format expected by rent calculator
        // Only include actual payments (where amount_paid > 0 and paidDate exists)
        const rentPayments = input.payments
            .filter(p => (p.amount_paid || 0) > 0 && p.paidDate)
            .map(p => ({
                id: p.id,
                amount: p.amount_paid || 0,
                date: p.paidDate || ''
            }));

        const rentState = calculateRentState(rentSettings, rentPayments, input.currentDate);

        console.log('🧮 DETERMINISTIC RENT CALCULATION:', {
            totalRentDue: rentState.totalRentDue,
            totalPayments: rentState.totalPayments,
            openingArrears: rentState.openingArrears,
            currentBalance: rentState.currentBalance,
            cyclesElapsed: rentState.cyclesElapsed,
            cyclesPaidInFull: rentState.cyclesPaidInFull,
            daysOverdue: rentState.daysOverdue,
            formula: `${rentState.totalRentDue} + ${rentState.openingArrears} - ${rentState.totalPayments} = ${rentState.currentBalance}`,
            legalEngineBalance: legalAnalysis.analysis.totalArrears,
            difference: Math.abs(rentState.currentBalance - legalAnalysis.analysis.totalArrears)
        });

        // SINGLE SOURCE OF TRUTH: Use deterministic calculation
        totalBalanceDue = rentState.currentBalance;
        deterministicDaysOverdue = rentState.daysOverdue;
        deterministicFirstMissedDate = rentState.oldestUnpaidDueDate;
    } else {
        // Fallback to legal engine's status-based calculation
        console.log('⚠️ FALLING BACK TO LEGAL ENGINE BALANCE (missing rentAmount/frequency/rentDueDay/trackingStartDate)');
        totalBalanceDue = legalAnalysis.analysis.totalArrears;
    }

    // Determine UI status based on legal analysis
    let status: RentalLogicResult['status'] = 'CLEAR';

    if (legalAnalysis.status === 'TRIBUNAL_ELIGIBLE') {
        // 21+ calendar days OR 3 strikes in 90-day window
        status = 'TERMINATION_RISK';
    } else if (legalAnalysis.analysis.workingDaysOverdue >= STRIKE_NOTICE_WORKING_DAYS) {
        // 5+ working days overdue (strike-eligible)
        status = 'ARREARS';
    } else if (legalAnalysis.analysis.daysArrears >= 1) {
        // 1-4 calendar days late (not yet strike-eligible)
        status = 'PENDING';
    }

    // Extract S56 notices early for use in multiple sections
    const s56Notices = input.strikeHistory.filter(s => s.type === 'S56_REMEDY');

    // Determine eligible legal actions
    const eligibleActions: string[] = [];

    // Section 56: 14-day notice to remedy
    // CRITICAL: Only suggest if current debt exists (not just old remedied debt)
    if (legalAnalysis.analysis.daysArrears >= 1 && totalBalanceDue > 0) {
        // Check if there's a recent S56 that was already remedied
        const recentS56 = s56Notices.length > 0 ? s56Notices.sort((a, b) =>
            new Date(b.officialServiceDate).getTime() - new Date(a.officialServiceDate).getTime()
        )[0] : null;

        let shouldSuggestNewS56 = true;

        if (recentS56) {
            const metadata = recentS56.metadata as import('@/lib/legal-engine').S56NoticeMetadata | undefined;
            if (metadata && metadata.ledger_entry_ids) {
                // Check if old debt was remedied
                const specificEntries = ledger.filter(e => metadata.ledger_entry_ids.includes(e.id));
                const noticeDate = parseISO(recentS56.officialServiceDate);
                let totalPaidOnOldDebt = 0;

                specificEntries.forEach(entry => {
                    if (entry.paidDate) {
                        const paymentDate = parseISO(entry.paidDate);
                        if (isAfter(paymentDate, noticeDate) || format(paymentDate, 'yyyy-MM-dd') === format(noticeDate, 'yyyy-MM-dd')) {
                            totalPaidOnOldDebt += entry.amountPaid;
                        }
                    }
                });

                const oldDebtRemaining = metadata.total_amount_owed - totalPaidOnOldDebt;

                // If old debt is remedied but there's new debt, suggest NEW S56
                // If old debt still exists, don't suggest duplicate S56 (just wait for expiry)
                shouldSuggestNewS56 = moneyIsZero(oldDebtRemaining) || !moneyGreaterThan(oldDebtRemaining, 0);
            }
        }

        if (shouldSuggestNewS56) {
            eligibleActions.push('SEND_14_DAY_REMEDY');
        }
    }

    // Section 55(1)(aa): Strike notice (available from 5 working days)
    if (legalAnalysis.analysis.workingDaysOverdue >= STRIKE_NOTICE_WORKING_DAYS) {
        eligibleActions.push('SEND_STRIKE_NOTICE');
    }

    // Section 55(1)(a) or 55(1)(aa): Tribunal application
    if (legalAnalysis.status === 'TRIBUNAL_ELIGIBLE') {
        eligibleActions.push('APPLY_TERMINATION');
    }

    // ============================================================================
    // MULTI-PATH TERMINATION ELIGIBILITY CALCULATION
    // ============================================================================

    /**
     * Section 55(1)(a): 21-Day Rule
     * Tenant is 21+ calendar days in arrears
     */
    const isEligibleSection55_1a = legalAnalysis.analysis.daysArrears >= TERMINATION_ELIGIBLE_DAYS;

    /**
     * Section 56: Unremedied Breach (DEBT-SPECIFIC)
     *
     * CRITICAL LEGAL REQUIREMENT:
     * A 14-Day Notice to Remedy is valid ONLY for the specific debt it was issued for.
     * If that specific debt is paid, the notice is "spent" - even if new debt exists.
     *
     * Algorithm:
     * 1. Find most recent S56_REMEDY notice from strike history
     * 2. Extract metadata containing snapshot of specific debt (ledger_entry_ids, due_dates, amount)
     * 3. Calculate payments made AFTER notice date that apply to the specific debt
     * 4. Check if specific debt amount has been fully paid (remedied)
     * 5. Only mark eligible for tribunal if:
     *    - Expiry date (OSD + 14 days) has passed
     *    - AND the SPECIFIC debt from notice remains unpaid
     */
    let isEligibleSection56 = false;

    if (s56Notices.length > 0) {
        // Get most recent S56 notice
        const mostRecentS56 = s56Notices.sort((a, b) =>
            new Date(b.officialServiceDate).getTime() - new Date(a.officialServiceDate).getTime()
        )[0];

        // Calculate expiry date (OSD + 14 days)
        const expiryDate = addDays(parseISO(mostRecentS56.officialServiceDate), NOTICE_REMEDY_PERIOD);
        const currentDate = input.currentDate || new Date();

        // Check if expiry has passed
        if (differenceInCalendarDays(currentDate, expiryDate) >= 0) {
            // Extract metadata containing specific debt snapshot
            const metadata = mostRecentS56.metadata as import('@/lib/legal-engine').S56NoticeMetadata | undefined;

            if (metadata && metadata.ledger_entry_ids && metadata.total_amount_owed) {
                // DEBT-SPECIFIC CHECK: Has the specific debt from the notice been paid?

                // Get the specific ledger entries that were unpaid when notice was issued
                const specificEntries = ledger.filter(entry =>
                    metadata.ledger_entry_ids.includes(entry.id)
                );

                // Calculate how much of the specific debt has been paid since notice date
                const noticeDate = parseISO(mostRecentS56.officialServiceDate);
                let totalPaidOnSpecificDebt = 0;

                specificEntries.forEach(entry => {
                    // Count payments made AFTER the notice was issued
                    if (entry.paidDate) {
                        const paymentDate = parseISO(entry.paidDate);
                        if (isAfter(paymentDate, noticeDate) || format(paymentDate, 'yyyy-MM-dd') === format(noticeDate, 'yyyy-MM-dd')) {
                            totalPaidOnSpecificDebt += entry.amountPaid;
                        }
                    }
                });

                // Eligible for tribunal ONLY if specific debt remains unpaid
                const specificDebtRemaining = metadata.total_amount_owed - totalPaidOnSpecificDebt;
                isEligibleSection56 = moneyGreaterThan(specificDebtRemaining, 0);
            } else {
                // FALLBACK for notices created before metadata implementation
                // Use old logic: check if ANY debt exists
                // This maintains backwards compatibility but should be migrated
                isEligibleSection56 = totalBalanceDue > 0;
            }
        }
    }

    /**
     * Section 55(1)(aa): Three Strikes Rule
     * 3 Strike Notices within any 90-day rolling window
     *
     * CRITICAL: 28-Day "Use It or Lose It" Window
     * The landlord MUST apply to Tribunal within 28 days after the 3rd strike was given.
     * After 28 days, the right to apply based on 3 strikes is LOST.
     *
     * Algorithm:
     * 1. Check if 3+ strikes exist within 90-day window
     * 2. Find the 3rd strike (earliest strike in the current window that makes it 3)
     * 3. Check if current date is within 28 days of that 3rd strike's OSD
     * 4. Only eligible if: 3 strikes AND within 28-day filing window
     */
    let isEligibleSection55_1aa = false;
    let tribunalDeadlineDays: number | null = null;

    if (legalAnalysis.analysis.strikeCount >= 3 && legalAnalysis.analysis.isWithin90Days) {
        // Get all strike notices (S55_STRIKE type only)
        const strikeNotices = input.strikeHistory
            .filter(s => s.type === 'S55_STRIKE')
            .sort((a, b) => new Date(a.officialServiceDate).getTime() - new Date(b.officialServiceDate).getTime());

        if (strikeNotices.length >= 3) {
            // Find strikes within 90-day window
            const currentDate = input.currentDate || new Date();
            const activeStrikes = strikeNotices.filter(strike => {
                const serviceDate = parseISO(strike.officialServiceDate);
                const daysSinceService = differenceInCalendarDays(currentDate, serviceDate);
                return daysSinceService >= 0 && daysSinceService <= 90;
            });

            if (activeStrikes.length >= 3) {
                // The "3rd strike" is the 3rd strike in chronological order within the window
                const thirdStrike = activeStrikes[2]; // 0-indexed: [0, 1, 2]
                const thirdStrikeDate = parseISO(thirdStrike.officialServiceDate);

                // Check if we're within 28 days of the 3rd strike
                const daysSinceThirdStrike = differenceInCalendarDays(currentDate, thirdStrikeDate);

                // Calculate days remaining in filing window
                tribunalDeadlineDays = TRIBUNAL_FILING_WINDOW_DAYS - daysSinceThirdStrike;

                // Ensure it's not negative (deadline passed)
                if (tribunalDeadlineDays < 0) {
                    tribunalDeadlineDays = 0;
                }

                // Eligible only if within 28-day filing window
                isEligibleSection55_1aa = daysSinceThirdStrike >= 0 && daysSinceThirdStrike <= TRIBUNAL_FILING_WINDOW_DAYS;
            }
        }
    }

    // Calculate active strikes from FULL strike history (independent of payment status)
    // This is the "strike memory" - strikes remain active for 90 days even if rent is paid
    const activeStrikeCount = getActiveStrikes(
        input.strikeHistory,
        input.currentDate || new Date()
    );

    // Calculate ANCHORED first missed due date (does NOT float with today's date)
    // This is the actual calendar date of the first unpaid rent cycle
    console.log('🔍 CALLING calculateFirstMissedDueDate with:', {
        trackingStartDate: input.trackingStartDate,
        frequency: input.frequency,
        rentDueDay: input.rentDueDay,
        ledgerCount: ledger.length,
        currentDate: format(input.currentDate || new Date(), 'yyyy-MM-dd'),
        ledgerSummary: ledger.map(l => ({
            dueDate: l.dueDate,
            status: l.status,
            amount: l.amount,
            amountPaid: l.amountPaid,
            balance: l.amount - l.amountPaid
        }))
    });

    const firstMissedDueDate = calculateFirstMissedDueDate(
        input.trackingStartDate,
        input.frequency,
        input.rentDueDay,
        ledger,
        input.currentDate || new Date()
    );

    console.log('🔍 calculateFirstMissedDueDate RETURNED:', {
        result: firstMissedDueDate,
        wasNull: firstMissedDueDate === null
    });

    // Calculate missed cycle count (number of rent cycles missed)
    // CRITICAL: If missedCycleCount >= 3, this is a LEGAL EMERGENCY in NZ
    let missedCycleCount = 0;
    if (firstMissedDueDate && input.frequency) {
        const currentDate = input.currentDate || new Date();
        const todayNZ = toZonedTime(currentDate, NZ_TIMEZONE);
        const today = startOfDay(todayNZ);
        const firstMissed = startOfDay(toZonedTime(parseISO(firstMissedDueDate), NZ_TIMEZONE));
        const daysSinceFirstMissed = differenceInCalendarDays(today, firstMissed);

        // Calculate cycle length based on frequency
        let cycleLength: number;
        switch (input.frequency) {
            case 'Weekly':
                cycleLength = 7;
                break;
            case 'Fortnightly':
                cycleLength = 14;
                break;
            case 'Monthly':
                // Approximate monthly as 30 days for cycle counting
                cycleLength = 30;
                break;
            default:
                cycleLength = 7;
        }

        // Calculate how many complete cycles have been missed
        // +1 because the first missed date itself counts as 1 cycle
        missedCycleCount = Math.floor(daysSinceFirstMissed / cycleLength) + 1;
    }

    // Use deterministic daysOverdue if available, otherwise fall back to legal engine
    const effectiveDaysOverdue = deterministicDaysOverdue !== null
        ? deterministicDaysOverdue
        : legalAnalysis.analysis.daysArrears;

    // Use deterministic firstMissedDueDate if available
    const effectiveFirstMissedDueDate = deterministicFirstMissedDate
        ? deterministicFirstMissedDate.toISOString().split('T')[0]
        : firstMissedDueDate;

    return {
        status,
        daysOverdue: effectiveDaysOverdue,
        workingDaysOverdue: legalAnalysis.analysis.workingDaysOverdue, // Keep legal engine for working days (RTA-specific)
        totalBalanceDue,
        eligibleActions,
        strikeCount: legalAnalysis.analysis.strikeCount,
        activeStrikeCount, // Strike memory - persists even when paid
        isWithin90DayWindow: legalAnalysis.analysis.isWithin90Days,
        // Multi-path termination eligibility
        isEligibleSection55_1a,
        isEligibleSection56,
        isEligibleSection55_1aa,
        tribunalDeadlineDays, // Days remaining in 28-day filing window (null if N/A, 0 if expired)
        legalAnalysis,
        firstMissedDueDate: effectiveFirstMissedDueDate, // ANCHORED date - does not float daily
        missedCycleCount, // Number of rent cycles missed (CRITICAL if >= 3)
    };
}

/**
 * React hook to calculate RTA-compliant rental status for a tenant.
 * Memoized for performance with STABLE dependencies.
 *
 * PERFORMANCE OPTIMIZATION:
 * - Uses stable hash functions instead of array references
 * - Prevents unnecessary re-calculations when array references change but data is identical
 * - Only re-computes when actual payment/strike data changes
 *
 * @param input - Tenant payment data and strike history
 * @returns RentalLogicResult with status, overdue calculations, and eligible actions
 *
 * @example
 * ```tsx
 * const legalStatus = useRentalLogic({
 *     tenantId: 'abc-123',
 *     payments: unpaidPayments,
 *     strikeHistory: strikes,
 *     region: 'Auckland',
 *     currentDate: testDate
 * });
 *
 * // Display status
 * if (legalStatus.status === 'ARREARS') {
 *     showStrikeNoticeButton();
 * }
 * ```
 */
export function useRentalLogic(input: UseRentalLogicInput): RentalLogicResult {
    // Create stable dependency values that only change when actual data changes
    const paymentsHash = getPaymentsHash(input.payments);
    const strikesHash = getStrikesHash(input.strikeHistory);
    const currentDateStr = input.currentDate?.toISOString() || '';

    return useMemo(
        () => calculateRentalLogic(input),
        [
            input.tenantId,
            paymentsHash,      // Stable hash instead of payments array reference
            strikesHash,       // Stable hash instead of strikeHistory array reference
            input.region,
            currentDateStr,    // Stable string instead of Date object reference
            // Deterministic calculation dependencies
            input.rentAmount,
            input.frequency,
            input.rentDueDay,
            input.trackingStartDate,
            input.openingArrears,
        ]
        // eslint-disable-next-line react-hooks/exhaustive-deps
    );
}
