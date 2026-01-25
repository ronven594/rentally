/**
 * Ledger Regenerator - Self-Healing Payment System
 *
 * Automatically regenerates the payment ledger when tenant settings change.
 * This ensures that rent amount, frequency, or due day changes immediately
 * reflect across the entire payment history "as if they had always been in place."
 *
 * CRITICAL: This is the "AI Resolver in Reactive Mode"
 */

import { format, parseISO, addDays, addWeeks, addMonths } from "date-fns";
import { resolveTenantStatus, applyResolvedStatus } from "./tenant-status-resolver";
import { PaymentFrequency } from "@/types";

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export interface TenantSettings {
    id: string;
    trackingStartDate: string;
    rentAmount: number;
    frequency: PaymentFrequency;
    rentDueDay: string;
    propertyId: string;
}

export interface LedgerRegenerationResult {
    success: boolean;
    recordsDeleted: number;
    recordsCreated: number;
    balanceRedistributed: number;
    newOverdueSince: string | null;
    error?: string;
}

/**
 * Regenerate the entire payment ledger for a tenant
 *
 * This function is called when tenant settings change (rent amount, frequency, due day).
 * It preserves the current balance but redistributes it across a new timeline.
 *
 * @param tenantId - The tenant whose ledger needs regeneration
 * @param newSettings - The new tenant settings (after update)
 * @param supabaseClient - Supabase client instance
 * @param currentDate - Current date (for testing)
 * @returns Result of the regeneration
 */
export async function regeneratePaymentLedger(
    tenantId: string,
    newSettings: TenantSettings,
    supabaseClient: any,
    currentDate: Date = new Date()
): Promise<LedgerRegenerationResult> {
    console.log('🔄 LEDGER REGENERATOR - Starting ledger regeneration:', {
        tenantId,
        newSettings,
        currentDate: format(currentDate, 'yyyy-MM-dd')
    });

    try {
        // =====================================================================
        // STEP 1: Calculate total paid and current balance
        // =====================================================================
        // CRITICAL: We must preserve the total amount PAID when regenerating
        // This prevents "Balance Drift" when settings change
        const { data: currentPayments, error: fetchError } = await supabaseClient
            .from('payments')
            .select('*')
            .eq('tenant_id', tenantId)
            .gte('due_date', newSettings.trackingStartDate);

        if (fetchError) {
            console.error('❌ Failed to fetch current payments:', fetchError);
            return {
                success: false,
                recordsDeleted: 0,
                recordsCreated: 0,
                balanceRedistributed: 0,
                newOverdueSince: null,
                error: fetchError.message
            };
        }

        // =====================================================================
        // CASH-BASIS ANCHOR: Calculate ground truth before regeneration
        // =====================================================================
        // CRITICAL: Count CYCLES, don't sum amounts (amounts may vary from previous changes)
        // Number of cycles = number of payment records from tracking start to today
        const numberOfCycles = currentPayments.length;

        // Get the OLD rent amount from the first record (before the change)
        // All records should have the same old amount
        const oldRentAmount = numberOfCycles > 0 ? currentPayments[0].amount : newSettings.rentAmount;

        // Calculate old accrued rent based on CYCLES × OLD RENT AMOUNT
        // This is the "ground truth" - what SHOULD have been paid with old settings
        const oldAccruedRent = Math.round(numberOfCycles * oldRentAmount * 100) / 100;

        // Calculate current unpaid balance
        const currentBalance = currentPayments
            .filter((p: any) => p.status === 'Unpaid' || p.status === 'Partial')
            .reduce((sum: number, p: any) => sum + (p.amount - p.amount_paid), 0);

        // CRITICAL: Calculate TOTAL PAID CASH using the anchor formula
        // Total Paid Cash = Total Accrued (old) - Current Outstanding Balance
        // This represents the actual cash the tenant has paid
        const totalPaidCash = Math.round((oldAccruedRent - currentBalance) * 100) / 100;

        console.log('💰 Cash-Basis Anchor - Pre-regeneration ground truth:', {
            numberOfCycles,
            oldRentAmount,
            oldAccruedRent: `${numberOfCycles} cycles × $${oldRentAmount} = $${oldAccruedRent}`,
            currentBalance,
            totalPaidCash,
            formula: `Total Paid Cash = $${oldAccruedRent} (${numberOfCycles} cycles × $${oldRentAmount}) - $${currentBalance} (owing) = $${totalPaidCash}`,
            verification: `$${totalPaidCash} paid + $${currentBalance} owing = $${totalPaidCash + currentBalance} (should equal $${oldAccruedRent})`
        });

        // =====================================================================
        // STEP 2: Delete all existing payment records from tracking start
        // =====================================================================
        // We wipe the slate clean and regenerate based on new settings
        const { error: deleteError } = await supabaseClient
            .from('payments')
            .delete()
            .eq('tenant_id', tenantId)
            .gte('due_date', newSettings.trackingStartDate);

        if (deleteError) {
            console.error('❌ Failed to delete existing payments:', deleteError);
            return {
                success: false,
                recordsDeleted: 0,
                recordsCreated: 0,
                balanceRedistributed: 0,
                newOverdueSince: null,
                error: deleteError.message
            };
        }

        console.log('🗑️ Deleted existing payment records:', {
            recordsDeleted: currentPayments.length
        });

        // Verify deletion - check for ghost records
        const { data: ghostCheck } = await supabaseClient
            .from('payments')
            .select('id, due_date, amount')
            .eq('tenant_id', tenantId)
            .gte('due_date', newSettings.trackingStartDate);

        if (ghostCheck && ghostCheck.length > 0) {
            console.error('⚠️ GHOST RECORDS DETECTED - deletion failed!', {
                remainingRecords: ghostCheck.length,
                records: ghostCheck
            });
            throw new Error(`Ghost records detected: ${ghostCheck.length} records remain after deletion`);
        }

        console.log('✅ Ghost record check passed - slate is clean');

        // =====================================================================
        // STEP 3: Generate ALL payment records with NEW settings
        // =====================================================================
        const allDueDates = generatePaymentDates(
            newSettings.trackingStartDate,
            newSettings.frequency,
            newSettings.rentDueDay,
            currentDate
        );

        console.log('📅 Generated payment dates with new settings:', {
            totalDates: allDueDates.length,
            firstDate: allDueDates.length > 0 ? format(allDueDates[0], 'yyyy-MM-dd') : 'None',
            lastDate: allDueDates.length > 0 ? format(allDueDates[allDueDates.length - 1], 'yyyy-MM-dd') : 'None',
            newRentAmount: newSettings.rentAmount,
            newFrequency: newSettings.frequency
        });

        // Create all payment records as Unpaid initially
        const allPaymentRecords = allDueDates.map(dueDate => ({
            tenant_id: tenantId,
            property_id: newSettings.propertyId,
            due_date: format(dueDate, 'yyyy-MM-dd'),
            amount: newSettings.rentAmount,
            status: 'Unpaid' as const,
            amount_paid: 0,
            paid_date: null
        }));

        const { data: insertedPayments, error: insertError } = await supabaseClient
            .from('payments')
            .insert(allPaymentRecords)
            .select();

        if (insertError) {
            console.error('❌ Failed to insert new payment records:', insertError);
            return {
                success: false,
                recordsDeleted: currentPayments.length,
                recordsCreated: 0,
                balanceRedistributed: 0,
                newOverdueSince: null,
                error: insertError.message
            };
        }

        console.log('✅ Created new payment records:', {
            recordsCreated: insertedPayments.length
        });

        // =====================================================================
        // STEP 4: Calculate NEW accrued rent and outstanding balance
        // =====================================================================
        // CRITICAL FORMULA:
        // New Accrued Rent = Total of all new records (with new rent amount)
        // New Outstanding Balance = New Accrued Rent - Total Paid
        //
        // Example: Rent changes from $405 to $400, tenant has paid $1620
        // - Old: 4 periods x $405 = $1620 accrued, $1620 paid, $0 owing
        // - New: 4 periods x $400 = $1600 accrued, $1620 paid, -$20 owing (CREDIT!)
        //
        // This is CORRECT! Tenant overpaid by $20 when rent was higher.
        // =====================================================================

        const newAccruedRent = insertedPayments.reduce((sum: number, p: any) => sum + p.amount, 0);

        // CRITICAL: Round to cents to prevent floating point errors
        // This prevents $0.01 errors from triggering extra cycles
        const newOutstandingBalance = Math.round((newAccruedRent - totalPaidCash) * 100) / 100;

        console.log('🧮 Balance recalculation:', {
            oldAccruedRent,
            newAccruedRent,
            totalPaidCash,
            oldOutstanding: currentBalance,
            newOutstanding: newOutstandingBalance,
            difference: Math.round((newOutstandingBalance - currentBalance) * 100) / 100,
            oldCycles: Math.round((currentBalance / (oldAccruedRent / currentPayments.length)) * 10) / 10,
            newCycles: Math.round((newOutstandingBalance / newSettings.rentAmount) * 10) / 10,
            interpretation: newOutstandingBalance < 0
                ? `Tenant has CREDIT of $${Math.abs(newOutstandingBalance).toFixed(2)}`
                : newOutstandingBalance === 0
                ? 'Tenant is paid up'
                : `Tenant owes $${newOutstandingBalance.toFixed(2)}`
        });

        // =====================================================================
        // STEP 5: Use AI Resolver to redistribute the balance
        // =====================================================================
        if (newOutstandingBalance > 0 && insertedPayments && insertedPayments.length > 0) {
            console.log('🤖 Running AI Status Resolver to redistribute balance...');

            const resolvedStatus = resolveTenantStatus(
                insertedPayments.map((p: any) => ({
                    id: p.id,
                    due_date: p.due_date,
                    amount: p.amount,
                    status: p.status,
                    amount_paid: p.amount_paid
                })),
                {
                    trackingStartDate: newSettings.trackingStartDate,
                    openingBalance: newOutstandingBalance, // Use NEW calculated balance, not old!
                    rentAmount: newSettings.rentAmount,
                    frequency: newSettings.frequency
                },
                currentDate
            );

            console.log('🎯 Resolver result:', resolvedStatus);

            // Apply the resolved status
            await applyResolvedStatus(resolvedStatus, supabaseClient);

            console.log('✅ Ledger regeneration complete:', {
                recordsDeleted: currentPayments.length,
                recordsCreated: insertedPayments.length,
                oldBalance: currentBalance,
                newBalance: newOutstandingBalance,
                balanceChange: newOutstandingBalance - currentBalance,
                newOverdueSince: resolvedStatus.dateSince,
                newStatus: resolvedStatus.status
            });

            return {
                success: true,
                recordsDeleted: currentPayments.length,
                recordsCreated: insertedPayments.length,
                balanceRedistributed: newOutstandingBalance,
                newOverdueSince: resolvedStatus.dateSince
            };
        } else if (newOutstandingBalance <= 0 && insertedPayments && insertedPayments.length > 0) {
            // Tenant has paid up or has credit - mark ALL records as paid
            console.log('💳 Tenant has credit or is paid up - marking all records as Paid');

            // Mark all records as fully paid
            const { data: recordsToPay } = await supabaseClient
                .from('payments')
                .select('id, amount')
                .in('id', insertedPayments.map((p: any) => p.id));

            if (recordsToPay) {
                for (const record of recordsToPay) {
                    await supabaseClient
                        .from('payments')
                        .update({
                            status: 'Paid',
                            amount_paid: record.amount,
                            paid_date: format(currentDate, 'yyyy-MM-dd')
                        })
                        .eq('id', record.id);
                }
            }

            console.log('✅ Ledger regeneration complete (tenant paid up/credit):', {
                recordsDeleted: currentPayments.length,
                recordsCreated: insertedPayments.length,
                oldBalance: currentBalance,
                newBalance: newOutstandingBalance,
                creditAmount: newOutstandingBalance < 0 ? Math.abs(newOutstandingBalance) : 0
            });

            return {
                success: true,
                recordsDeleted: currentPayments.length,
                recordsCreated: insertedPayments.length,
                balanceRedistributed: 0,
                newOverdueSince: null
            };
        } else {
            // No payments generated - edge case
            console.log('✅ Ledger regeneration complete (no payments):', {
                recordsDeleted: currentPayments.length,
                recordsCreated: 0,
                balanceRedistributed: 0
            });

            return {
                success: true,
                recordsDeleted: currentPayments.length,
                recordsCreated: 0,
                balanceRedistributed: 0,
                newOverdueSince: null
            };
        }
    } catch (error: any) {
        console.error('❌ Ledger regeneration failed:', error);
        return {
            success: false,
            recordsDeleted: 0,
            recordsCreated: 0,
            balanceRedistributed: 0,
            newOverdueSince: null,
            error: error.message
        };
    }
}

/**
 * Generate all payment due dates from tracking start to current date
 *
 * @param trackingStartDate - ISO date string when tracking began
 * @param frequency - Payment frequency
 * @param rentDueDay - Due day (day of week for Weekly/Fortnightly, day of month for Monthly)
 * @param currentDate - Current date to generate up to
 * @returns Array of Date objects representing due dates
 */
function generatePaymentDates(
    trackingStartDate: string,
    frequency: PaymentFrequency,
    rentDueDay: string,
    currentDate: Date
): Date[] {
    const allDueDates: Date[] = [];
    const trackingStart = parseISO(trackingStartDate);
    let currentDueDate: Date;

    // Find first due date based on frequency
    if (frequency === 'Monthly') {
        const dayOfMonth = parseInt(rentDueDay, 10) || 1;
        const trackingMonth = trackingStart.getMonth();
        const trackingYear = trackingStart.getFullYear();

        const lastDayOfMonth = new Date(trackingYear, trackingMonth + 1, 0).getDate();
        const effectiveDay = Math.min(dayOfMonth, lastDayOfMonth);
        currentDueDate = new Date(trackingYear, trackingMonth, effectiveDay);

        if (currentDueDate < trackingStart) {
            const nextMonth = addMonths(currentDueDate, 1);
            const nextMonthLastDay = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
            const nextMonthEffectiveDay = Math.min(dayOfMonth, nextMonthLastDay);
            currentDueDate = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), nextMonthEffectiveDay);
        }
    } else {
        // For Weekly/Fortnightly
        const targetDayIndex = DAYS_OF_WEEK.indexOf(rentDueDay);
        const targetJsDay = targetDayIndex === 6 ? 0 : targetDayIndex + 1;
        const trackingStartJsDay = trackingStart.getDay();

        let daysToAdd = (targetJsDay - trackingStartJsDay + 7) % 7;
        currentDueDate = addDays(trackingStart, daysToAdd);
    }

    // Generate all due dates up to current date
    const maxIterations = 520;
    let iterations = 0;

    while (currentDueDate <= currentDate && iterations < maxIterations) {
        allDueDates.push(new Date(currentDueDate));
        iterations++;

        // Advance by frequency
        if (frequency === 'Weekly') {
            currentDueDate = addWeeks(currentDueDate, 1);
        } else if (frequency === 'Fortnightly') {
            currentDueDate = addWeeks(currentDueDate, 2);
        } else if (frequency === 'Monthly') {
            const dayOfMonth = parseInt(rentDueDay, 10) || 1;
            const nextMonth = addMonths(currentDueDate, 1);
            const lastDayOfNextMonth = new Date(
                nextMonth.getFullYear(),
                nextMonth.getMonth() + 1,
                0
            ).getDate();
            const effectiveDay = Math.min(dayOfMonth, lastDayOfNextMonth);
            currentDueDate = new Date(
                nextMonth.getFullYear(),
                nextMonth.getMonth(),
                effectiveDay
            );
        }
    }

    return allDueDates;
}

/**
 * Detect if tenant settings have changed in a way that requires ledger regeneration
 *
 * @param oldSettings - Previous tenant settings
 * @param newSettings - New tenant settings
 * @returns True if ledger needs regeneration
 */
export function shouldRegenerateLedger(
    oldSettings: TenantSettings,
    newSettings: TenantSettings
): boolean {
    return (
        oldSettings.rentAmount !== newSettings.rentAmount ||
        oldSettings.frequency !== newSettings.frequency ||
        oldSettings.rentDueDay !== newSettings.rentDueDay
    );
}
