/**
 * AI Status Resolver
 *
 * Takes raw payment records and tenant settings, then intelligently resolves:
 * - Which payments are actually unpaid based on "Amount Behind"
 * - The true overdue date (using Ground Zero anchor)
 * - Current balance and days overdue
 *
 * CRITICAL LOGIC:
 * If a user says tenant is "$600 behind", we assume:
 * - The OLDEST periods are Paid (tenant was paying earlier)
 * - Only the MOST RECENT $600 worth of cycles are Unpaid
 *
 * This matches real-world scenarios where tenants fall behind gradually,
 * not that they never paid from the start.
 *
 * USES SHARED DATE MATH:
 * All date calculations use payment-date-math.ts to ensure consistency
 * with ledger-regenerator.ts.
 */

import { parseISO, differenceInCalendarDays, format } from "date-fns";
import {
    calculateGroundZero,
    calculatePaidUntilStatus,
    debugDateCalculation,
    type DateMathSettings,
    type PaymentFrequency
} from "./payment-date-math";

export interface PaymentRecord {
    id: string;
    due_date: string;
    amount: number;
    status: 'Paid' | 'Unpaid' | 'Partial';
    amount_paid: number;
}

export interface TenantSettings {
    trackingStartDate: string;
    openingBalance: number; // Amount behind when tracking started
    rentAmount: number;
    frequency: PaymentFrequency;
    rentDueDay?: string; // Optional - needed for accurate date calculations
}

export interface ResolvedStatus {
    status: 'Paid Up' | 'Overdue' | 'Warning';
    days: number;
    dateSince: string | null; // Formatted date string (e.g., "Jan 15")
    paidUntilDate: string | null; // ISO date string (e.g., "2024-01-15")
    nextDueDate: string | null; // ISO date string of next unpaid due date
    balance: number;
    unpaidRecords: string[]; // IDs of records that should be marked unpaid
    paidRecords: string[]; // IDs of records that should be marked paid
    partialPayments: Map<string, number>; // Map of payment ID to amount_paid for partial payments
    cyclesPaid: number;
    cyclesUnpaid: number;
}

/**
 * Resolve tenant status based on opening balance and payment records
 *
 * @param payments - All payment records from tracking start to today
 * @param settings - Tenant configuration (tracking start, opening balance, etc.)
 * @param currentDate - Current date for calculations (defaults to today)
 * @returns Resolved status object
 */
export function resolveTenantStatus(
    payments: PaymentRecord[],
    settings: TenantSettings,
    currentDate: Date = new Date()
): ResolvedStatus {
    const { openingBalance, trackingStartDate, rentAmount, frequency } = settings;

    console.log('🔍 AI STATUS RESOLVER - Starting resolution:', {
        openingBalance,
        trackingStartDate,
        rentAmount,
        frequency,
        rentDueDay: settings.rentDueDay,
        totalPaymentRecords: payments.length,
        currentDate: format(currentDate, 'yyyy-MM-dd')
    });

    // Sort payments by due date (oldest first)
    const sortedPayments = [...payments].sort((a, b) =>
        a.due_date.localeCompare(b.due_date)
    );

    console.log('📅 Sorted payments (oldest to newest):',
        sortedPayments.map(p => ({
            due_date: p.due_date,
            amount: p.amount,
            currentStatus: p.status
        }))
    );

    // ========================================================================
    // USE SHARED DATE MATH for Paid Until calculation
    // ========================================================================
    let paidUntilResult = null;
    let groundZero = null;

    if (settings.rentDueDay) {
        const dateMathSettings: DateMathSettings = {
            trackingStartDate,
            frequency,
            rentDueDay: settings.rentDueDay,
            rentAmount
        };

        // Debug output for troubleshooting
        debugDateCalculation(openingBalance, dateMathSettings, currentDate);

        // Calculate Paid Until status using shared math
        paidUntilResult = calculatePaidUntilStatus(openingBalance, dateMathSettings, currentDate);
        groundZero = calculateGroundZero(dateMathSettings);

        console.log('🎯 Shared Date Math Result:', {
            groundZero: format(paidUntilResult.groundZero, 'yyyy-MM-dd'),
            paidUntilDate: format(paidUntilResult.paidUntilDate, 'yyyy-MM-dd'),
            nextDueDate: format(paidUntilResult.nextDueDate, 'yyyy-MM-dd'),
            cyclesPaid: paidUntilResult.cyclesPaid,
            cyclesUnpaid: paidUntilResult.cyclesUnpaid,
            daysOverdue: paidUntilResult.daysOverdue
        });
    }

    // ========================================================================
    // CRITICAL LOGIC: Opening Balance Resolution
    // ========================================================================
    // If opening balance is $600 and we have payment records totaling $2400,
    // the tenant actually PAID $1800 worth of the oldest periods.
    // We work BACKWARDS from today to find which periods are actually unpaid.
    // ========================================================================

    // Calculate total amount if all periods were unpaid
    const totalPotentialDebt = sortedPayments.reduce((sum, p) => sum + p.amount, 0);

    // Calculate how much was actually paid (historical payments before falling behind)
    const historicalPayments = Math.round((totalPotentialDebt - openingBalance) * 100) / 100;

    console.log('💰 Debt calculation:', {
        totalPotentialDebt,
        openingBalance,
        historicalPayments,
        interpretation: `Tenant paid $${historicalPayments.toFixed(2)} of older periods, now behind $${openingBalance.toFixed(2)}`
    });

    // Work backwards from newest to oldest to find which periods are unpaid
    const unpaidRecords: string[] = [];
    const paidRecords: string[] = [];
    const partialPayments = new Map<string, number>();
    let remainingDebt = Math.round(openingBalance * 100) / 100; // Round to cents

    // Start from the NEWEST payment and work backwards
    for (let i = sortedPayments.length - 1; i >= 0; i--) {
        const payment = sortedPayments[i];

        if (remainingDebt <= 0.01) { // Allow for 1 cent tolerance
            // All remaining older payments were paid
            paidRecords.push(payment.id);
        } else {
            // This payment is part of the unpaid amount
            const roundedRemainingDebt = Math.round(remainingDebt * 100) / 100;
            const roundedPaymentAmount = Math.round(payment.amount * 100) / 100;

            if (roundedRemainingDebt >= roundedPaymentAmount) {
                // Fully unpaid
                unpaidRecords.push(payment.id);
                remainingDebt -= payment.amount;
            } else {
                // Partially unpaid (this is the oldest unpaid period)
                // Mark as Partial and track the amount paid
                const amountPaid = Math.round((payment.amount - remainingDebt) * 100) / 100;
                partialPayments.set(payment.id, amountPaid);
                unpaidRecords.push(payment.id);

                console.log('💳 Partial payment detected:', {
                    paymentId: payment.id,
                    dueDate: payment.due_date,
                    totalAmount: payment.amount,
                    amountPaid,
                    amountOwing: remainingDebt
                });

                remainingDebt = 0;
            }
        }
    }

    // Reverse unpaidRecords so oldest unpaid is first
    unpaidRecords.reverse();

    console.log('📊 Resolution result:', {
        unpaidRecords: unpaidRecords.length,
        paidRecords: paidRecords.length,
        unpaidDates: sortedPayments
            .filter(p => unpaidRecords.includes(p.id))
            .map(p => p.due_date)
    });

    // ========================================================================
    // DETERMINE OVERDUE STATUS using Paid Until calculation
    // ========================================================================
    let daysOverdue = 0;
    let dateSince: string | null = null;
    let paidUntilDateStr: string | null = null;
    let nextDueDateStr: string | null = null;
    let cyclesPaid = 0;
    let cyclesUnpaid = 0;

    if (paidUntilResult) {
        // Use the shared date math result
        daysOverdue = paidUntilResult.daysOverdue;
        paidUntilDateStr = format(paidUntilResult.paidUntilDate, 'yyyy-MM-dd');
        nextDueDateStr = format(paidUntilResult.nextDueDate, 'yyyy-MM-dd');
        dateSince = format(paidUntilResult.nextDueDate, 'MMM d');
        cyclesPaid = paidUntilResult.cyclesPaid;
        cyclesUnpaid = paidUntilResult.cyclesUnpaid;
    } else {
        // Fallback: Use oldest unpaid payment date
        const oldestUnpaid = sortedPayments.find(p => unpaidRecords.includes(p.id));
        if (oldestUnpaid) {
            const oldestUnpaidDate = parseISO(oldestUnpaid.due_date);
            daysOverdue = differenceInCalendarDays(currentDate, oldestUnpaidDate);
            dateSince = format(oldestUnpaidDate, 'MMM d');
            nextDueDateStr = oldestUnpaid.due_date;
        }
        cyclesUnpaid = unpaidRecords.length;
        cyclesPaid = paidRecords.length;
    }

    // Handle paid up case
    if (unpaidRecords.length === 0 || openingBalance <= 0) {
        return {
            status: 'Paid Up',
            days: 0,
            dateSince: null,
            paidUntilDate: paidUntilDateStr,
            nextDueDate: nextDueDateStr,
            balance: 0,
            unpaidRecords: [],
            paidRecords: sortedPayments.map(p => p.id),
            partialPayments: new Map(),
            cyclesPaid: sortedPayments.length,
            cyclesUnpaid: 0
        };
    }

    // Determine status based on days overdue
    let status: 'Paid Up' | 'Overdue' | 'Warning' = 'Overdue';
    if (daysOverdue >= 5) {
        status = 'Overdue';
    } else if (daysOverdue > 0) {
        status = 'Warning';
    } else {
        status = 'Paid Up';
    }

    const result: ResolvedStatus = {
        status,
        days: Math.max(0, daysOverdue),
        dateSince,
        paidUntilDate: paidUntilDateStr,
        nextDueDate: nextDueDateStr,
        balance: openingBalance,
        unpaidRecords,
        paidRecords,
        partialPayments,
        cyclesPaid,
        cyclesUnpaid
    };

    console.log('✅ Final resolved status:', {
        ...result,
        partialPayments: Array.from(partialPayments.entries()).map(([id, amount]) => ({
            paymentId: id,
            amountPaid: amount
        }))
    });

    return result;
}

/**
 * Apply resolved status to payment records in database
 *
 * This function would update the Supabase payments table to mark
 * records as Paid or Unpaid based on the resolver's decision.
 */
export async function applyResolvedStatus(
    resolvedStatus: ResolvedStatus,
    supabaseClient: any
): Promise<void> {
    console.log('📝 Applying resolved status to database...');

    // Mark records as Paid
    if (resolvedStatus.paidRecords.length > 0) {
        // First fetch the records to get their amounts
        const { data: recordsToPay } = await supabaseClient
            .from('payments')
            .select('id, amount')
            .in('id', resolvedStatus.paidRecords);

        // Update each record individually to set amount_paid = amount
        if (recordsToPay) {
            for (const record of recordsToPay) {
                const { error: paidError } = await supabaseClient
                    .from('payments')
                    .update({
                        status: 'Paid',
                        amount_paid: record.amount,
                        paid_date: new Date().toISOString().split('T')[0]
                    })
                    .eq('id', record.id);

                if (paidError) {
                    console.error('❌ Error marking payment as paid:', paidError);
                    throw paidError;
                }
            }
        }
    }

    // Mark records as Unpaid or Partial
    if (resolvedStatus.unpaidRecords.length > 0) {
        for (const recordId of resolvedStatus.unpaidRecords) {
            const partialAmount = resolvedStatus.partialPayments.get(recordId);

            if (partialAmount !== undefined) {
                // This is a partial payment
                const { error: partialError } = await supabaseClient
                    .from('payments')
                    .update({
                        status: 'Partial',
                        amount_paid: partialAmount,
                        paid_date: new Date().toISOString().split('T')[0]
                    })
                    .eq('id', recordId);

                if (partialError) {
                    console.error('❌ Error marking payment as partial:', partialError);
                    throw partialError;
                }
            } else {
                // This is fully unpaid
                const { error: unpaidError } = await supabaseClient
                    .from('payments')
                    .update({
                        status: 'Unpaid',
                        amount_paid: 0,
                        paid_date: null
                    })
                    .eq('id', recordId);

                if (unpaidError) {
                    console.error('❌ Error marking payment as unpaid:', unpaidError);
                    throw unpaidError;
                }
            }
        }
    }

    console.log('✅ Status applied successfully:', {
        markedPaid: resolvedStatus.paidRecords.length,
        markedUnpaid: resolvedStatus.unpaidRecords.length - resolvedStatus.partialPayments.size,
        markedPartial: resolvedStatus.partialPayments.size
    });
}
