/**
 * Ledger Regenerator - Self-Healing Payment System
 *
 * Automatically regenerates the payment ledger when tenant settings change.
 * This ensures that rent amount, frequency, or due day changes immediately
 * reflect across the entire payment history "as if they had always been in place."
 *
 * CRITICAL: This is the "AI Resolver in Reactive Mode"
 *
 * USES SHARED DATE MATH:
 * All date calculations use payment-date-math.ts to ensure consistency
 * with tenant-status-resolver.ts.
 */

import { format, parseISO } from "date-fns";
import { resolveTenantStatus, applyResolvedStatus } from "./tenant-status-resolver";
import {
    calculateGroundZero,
    generateAllDueDates,
    calculatePaidUntilStatus,
    debugDateCalculation,
    countCyclesToDate,
    type DateMathSettings,
    type PaymentFrequency
} from "./payment-date-math";

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
    paidUntilDate: string | null;
    daysOverdue: number;
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

    // Create DateMathSettings for shared calculations
    const dateMathSettings: DateMathSettings = {
        trackingStartDate: newSettings.trackingStartDate,
        frequency: newSettings.frequency,
        rentDueDay: newSettings.rentDueDay,
        rentAmount: newSettings.rentAmount
    };

    // Show verbose debug output
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🔧 LEDGER REGENERATOR - Using Shared Date Math');
    console.log('═══════════════════════════════════════════════════════════════');

    // Calculate Ground Zero using shared logic
    const groundZero = calculateGroundZero(dateMathSettings);
    console.log(`📍 Ground Zero: ${format(groundZero, 'yyyy-MM-dd (EEEE)')}`);

    try {
        // =====================================================================
        // STEP 1: COUNT THE UNPAID CYCLES (NOT CASH!) BEFORE ANY CHANGES
        // =====================================================================
        // CRITICAL FIX (Cycle Creep Bug):
        //
        // When rent changes from $400 to $405, we must preserve the NUMBER OF
        // UNPAID CYCLES, not the cash amount!
        //
        // Problem with cash-based approach:
        //   Cash paid = $2000, at $405/cycle = 4.94 cycles paid
        //   floor(4.94) = 4 cycles paid, so 3 cycles unpaid ← WRONG!
        //
        // Solution - COUNT, DON'T CALCULATE:
        //   Old balance = $800, old rent = $400
        //   Unpaid cycles = floor($800 / $400) = 2 cycles ← THIS IS THE ANCHOR
        //   New balance = 2 × $405 = $810 ← CORRECT!
        //
        // The landlord said tenant owes 2 cycles. After rent change, tenant
        // still owes exactly 2 cycles. No ghost accruals!
        // =====================================================================

        // First, fetch ALL records to understand current state
        const { data: allRecords, error: fetchAllError } = await supabaseClient
            .from('payments')
            .select('*')
            .eq('tenant_id', tenantId);

        if (fetchAllError) {
            console.error('❌ Failed to fetch all payments:', fetchAllError);
            return {
                success: false,
                recordsDeleted: 0,
                recordsCreated: 0,
                balanceRedistributed: 0,
                newOverdueSince: null,
                paidUntilDate: null,
                daysOverdue: 0,
                error: fetchAllError.message
            };
        }

        // Get the OLD rent amount from existing records (before the change)
        // All existing records should have the same amount (old rent)
        const oldRentAmount = allRecords && allRecords.length > 0
            ? allRecords[0].amount
            : newSettings.rentAmount;

        // Calculate the CURRENT OUTSTANDING BALANCE from existing records
        // This is: Total Owed - Total Paid = sum(amount) - sum(amount_paid)
        const totalOwedFromRecords = (allRecords || []).reduce(
            (sum: number, p: any) => sum + (p.amount || 0), 0
        );
        const totalPaidFromRecords = (allRecords || []).reduce(
            (sum: number, p: any) => sum + (p.amount_paid || 0), 0
        );
        const currentOutstandingBalance = Math.round((totalOwedFromRecords - totalPaidFromRecords) * 100) / 100;

        // =====================================================================
        // THE UNPAID CYCLE COUNT ANCHOR (Cycle Creep Fix)
        // =====================================================================
        // This is the CRITICAL calculation:
        //
        // Unpaid_Cycle_Count = floor(Current_Balance / Old_Rent)
        //
        // Example: Balance = $800, Old Rent = $400
        //          Unpaid Cycles = floor($800 / $400) = 2 cycles
        //
        // This COUNT is the ANCHOR - it represents how many periods the tenant
        // owes, and it MUST be preserved when rent changes!
        //
        // ROUNDING GUARD: We use Math.floor to prevent a $0.01 difference
        // from triggering a whole new cycle of debt.
        // =====================================================================
        const unpaidCycleCount = oldRentAmount > 0
            ? Math.floor(currentOutstandingBalance / oldRentAmount)
            : 0;

        // Calculate partial payment remainder (if any)
        const partialPaymentRemainder = oldRentAmount > 0
            ? Math.round((currentOutstandingBalance % oldRentAmount) * 100) / 100
            : 0;

        // Calculate total cycles from tracking start to today (for reference only)
        const totalCyclesOnCalendar = countCyclesToDate(currentDate, dateMathSettings);

        console.log('═══════════════════════════════════════════════════════════════');
        console.log('🔢 UNPAID CYCLE COUNT ANCHOR (Cycle Creep Fix)');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('📊 Old State (Before Rent Change):');
        console.log(`   - Old Rent Amount: $${oldRentAmount.toFixed(2)}`);
        console.log(`   - Current Outstanding Balance: $${currentOutstandingBalance.toFixed(2)}`);
        console.log('');
        console.log('🔢 UNPAID CYCLE COUNT (THE ANCHOR):');
        console.log(`   - Unpaid Cycles: ${unpaidCycleCount}`);
        console.log(`   - Formula: floor($${currentOutstandingBalance.toFixed(2)} / $${oldRentAmount.toFixed(2)}) = ${unpaidCycleCount}`);
        console.log(`   - Partial Payment Remainder: $${partialPaymentRemainder.toFixed(2)}`);
        console.log('');
        console.log('📅 Calendar Reference (NOT used for balance):');
        console.log(`   - Total Cycles on Calendar: ${totalCyclesOnCalendar}`);
        console.log(`   - Note: We do NOT add ghost cycles from the calendar!`);
        console.log('═══════════════════════════════════════════════════════════════');

        // Separate Paid records from Unpaid/Partial/Projected for deletion tracking
        const paidRecords = (allRecords || []).filter((p: any) => p.status === 'Paid');
        const unpaidRecords = (allRecords || []).filter((p: any) =>
            p.status === 'Unpaid' || p.status === 'Partial' || p.status === 'Projected'
        );

        console.log('📋 Record Analysis:', {
            totalRecords: allRecords?.length || 0,
            paidRecords: paidRecords.length,
            unpaidRecords: unpaidRecords.length,
            oldRentAmount: `$${oldRentAmount.toFixed(2)}`,
            newRentAmount: `$${newSettings.rentAmount.toFixed(2)}`,
            rentChanged: oldRentAmount !== newSettings.rentAmount
        });

        // =====================================================================
        // STEP 2: Delete ONLY Unpaid/Partial/Projected records
        // =====================================================================
        // CRITICAL: Paid records survive the atomic wipe!

        if (unpaidRecords.length > 0) {
            const unpaidIds = unpaidRecords.map((p: any) => p.id);

            const { error: deleteError } = await supabaseClient
                .from('payments')
                .delete()
                .in('id', unpaidIds);

            if (deleteError) {
                console.error('❌ Failed to delete unpaid payments:', deleteError);
                return {
                    success: false,
                    recordsDeleted: 0,
                    recordsCreated: 0,
                    balanceRedistributed: 0,
                    newOverdueSince: null,
                    paidUntilDate: null,
                    daysOverdue: 0,
                    error: deleteError.message
                };
            }

            console.log('🗑️ Deleted Unpaid/Partial/Projected records:', {
                recordsDeleted: unpaidRecords.length,
                preservedPaidRecords: paidRecords.length
            });
        } else {
            console.log('ℹ️ No Unpaid/Partial/Projected records to delete');
        }

        // Verify deletion - check for ghost records (excluding Paid)
        const { data: ghostCheck } = await supabaseClient
            .from('payments')
            .select('id, due_date, amount, status')
            .eq('tenant_id', tenantId)
            .in('status', ['Unpaid', 'Partial', 'Projected']);

        if (ghostCheck && ghostCheck.length > 0) {
            console.error('⚠️ GHOST RECORDS DETECTED - deletion failed!', {
                remainingRecords: ghostCheck.length,
                records: ghostCheck
            });
            throw new Error(`Ghost records detected: ${ghostCheck.length} Unpaid/Partial/Projected records remain after deletion`);
        }

        console.log('✅ Ghost record check passed - only Paid records remain');

        // Also delete any Paid records that fall BEFORE the new tracking start date
        // (These are historical records that are no longer relevant)
        const { data: oldPaidRecords } = await supabaseClient
            .from('payments')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('status', 'Paid')
            .lt('due_date', newSettings.trackingStartDate);

        if (oldPaidRecords && oldPaidRecords.length > 0) {
            await supabaseClient
                .from('payments')
                .delete()
                .in('id', oldPaidRecords.map((p: any) => p.id));

            console.log('🗑️ Deleted old Paid records before tracking start:', {
                count: oldPaidRecords.length
            });
        }

        // Get the final count of surviving Paid records within tracking period
        const { data: survivingPaidRecords } = await supabaseClient
            .from('payments')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('status', 'Paid')
            .gte('due_date', newSettings.trackingStartDate);

        const finalTotalPaid = (survivingPaidRecords || []).reduce((sum: number, p: any) =>
            sum + (p.amount_paid || p.amount), 0
        );

        console.log('💵 Final Paid Record Summary:', {
            survivingPaidRecords: survivingPaidRecords?.length || 0,
            totalActuallyPaid: `$${finalTotalPaid.toFixed(2)}`
        });

        // =====================================================================
        // STEP 3: Generate ALL payment records with NEW settings using SHARED DATE MATH
        // =====================================================================
        const allDueDates = generateAllDueDates(dateMathSettings, currentDate);

        console.log('📅 Generated payment dates with SHARED DATE MATH:', {
            totalDates: allDueDates.length,
            groundZero: format(groundZero, 'yyyy-MM-dd (EEEE)'),
            firstDate: allDueDates.length > 0 ? format(allDueDates[0], 'yyyy-MM-dd (EEEE)') : 'None',
            lastDate: allDueDates.length > 0 ? format(allDueDates[allDueDates.length - 1], 'yyyy-MM-dd (EEEE)') : 'None',
            newRentAmount: newSettings.rentAmount,
            newFrequency: newSettings.frequency,
            newRentDueDay: newSettings.rentDueDay
        });

        // Validate all dates fall on the correct day
        if (allDueDates.length > 0) {
            console.log('🔍 Validating due date grid alignment:');
            allDueDates.slice(0, 5).forEach((date, index) => {
                console.log(`   Cycle ${index + 1}: ${format(date, 'yyyy-MM-dd')} (${format(date, 'EEEE')})`);
            });
            if (allDueDates.length > 5) {
                console.log(`   ... and ${allDueDates.length - 5} more cycles`);
            }
        }

        // =====================================================================
        // STEP 4: Calculate NEW outstanding balance using UNPAID CYCLE COUNT
        // =====================================================================
        // CRITICAL FORMULA (Cycle Creep Fix):
        //
        // We preserve the NUMBER OF UNPAID CYCLES, not cash paid!
        //
        // New_Outstanding_Balance = Unpaid_Cycle_Count × NEW_Rent_Amount
        //
        // Example: Rent changes from $400 to $405, tenant was 2 cycles behind
        //   Old: 2 cycles × $400 = $800 balance
        //   New: 2 cycles × $405 = $810 balance ← EXACTLY 2 CYCLES!
        //
        // NO GHOST ACCRUALS: We do NOT look at the calendar and decide the
        // tenant "should" owe more rent from months ago. If the landlord said
        // they owed 2 cycles before, they owe 2 cycles after.
        // =====================================================================

        // Calculate new balance: Unpaid cycles × New rent (+ partial remainder)
        const newOutstandingBalance = Math.round(
            (unpaidCycleCount * newSettings.rentAmount + partialPaymentRemainder) * 100
        ) / 100;

        // The number of unpaid cycles stays EXACTLY the same!
        const cyclesUnpaid = unpaidCycleCount;

        // Calculate paid cycles from calendar (for record generation only)
        const cyclesPaidOnCalendar = Math.max(0, allDueDates.length - unpaidCycleCount);

        console.log('═══════════════════════════════════════════════════════════════');
        console.log('🧮 NEW BALANCE CALCULATION (Using Unpaid Cycle Count)');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('📊 New State (After Rent Change):');
        console.log(`   - New Rent Amount: $${newSettings.rentAmount.toFixed(2)}`);
        console.log(`   - Unpaid Cycle Count (PRESERVED): ${unpaidCycleCount}`);
        console.log(`   - Partial Remainder: $${partialPaymentRemainder.toFixed(2)}`);
        console.log('');
        console.log('💰 NEW OUTSTANDING BALANCE:');
        console.log(`   - New Balance: $${newOutstandingBalance.toFixed(2)}`);
        console.log(`   - Formula: ${unpaidCycleCount} cycles × $${newSettings.rentAmount.toFixed(2)} + $${partialPaymentRemainder.toFixed(2)} = $${newOutstandingBalance.toFixed(2)}`);
        console.log(`   - Cycles Behind: ${unpaidCycleCount} (EXACTLY preserved!)`);
        if (oldRentAmount !== newSettings.rentAmount) {
            console.log('');
            console.log('📈 RENT CHANGE IMPACT:');
            console.log(`   - Old: ${unpaidCycleCount} cycles × $${oldRentAmount.toFixed(2)} = $${currentOutstandingBalance.toFixed(2)}`);
            console.log(`   - New: ${unpaidCycleCount} cycles × $${newSettings.rentAmount.toFixed(2)} = $${newOutstandingBalance.toFixed(2)}`);
            console.log(`   - Difference: $${(newOutstandingBalance - currentOutstandingBalance).toFixed(2)}`);
            console.log(`   - Cycles Changed: NO! Still exactly ${unpaidCycleCount} cycles`);
        }
        console.log('═══════════════════════════════════════════════════════════════');

        console.log('📊 Cycle Distribution:', {
            totalCyclesOnCalendar: allDueDates.length,
            cyclesPaidOnCalendar,
            cyclesUnpaid: unpaidCycleCount,
            note: 'Unpaid count preserved from old balance, NOT calculated from calendar'
        });

        // Create NEW Unpaid records ONLY for the unpaid cycles
        // We create EXACTLY unpaidCycleCount records (preserved from old balance)
        // Take the MOST RECENT cycles (from the end of the calendar)
        const unpaidDueDates = allDueDates.slice(-unpaidCycleCount);

        const allPaymentRecords = unpaidDueDates.map(dueDate => ({
            tenant_id: tenantId,
            property_id: newSettings.propertyId,
            due_date: format(dueDate, 'yyyy-MM-dd'),
            amount: newSettings.rentAmount,
            status: 'Unpaid' as const,
            amount_paid: 0,
            paid_date: null
        }));

        let insertedPayments: any[] = [];

        if (allPaymentRecords.length > 0) {
            const { data: inserted, error: insertError } = await supabaseClient
                .from('payments')
                .insert(allPaymentRecords)
                .select();

            if (insertError) {
                console.error('❌ Failed to insert new payment records:', insertError);
                return {
                    success: false,
                    recordsDeleted: unpaidRecords.length,
                    recordsCreated: 0,
                    balanceRedistributed: 0,
                    newOverdueSince: null,
                    paidUntilDate: null,
                    daysOverdue: 0,
                    error: insertError.message
                };
            }

            insertedPayments = inserted || [];
        }

        console.log('✅ Created new Unpaid payment records:', {
            recordsCreated: insertedPayments.length,
            expectedUnpaidCycles: cyclesUnpaid,
            match: insertedPayments.length === cyclesUnpaid ? '✅ MATCH' : '⚠️ MISMATCH'
        });

        // Combine surviving paid records with new unpaid records for full picture
        const allCurrentRecords = [
            ...(survivingPaidRecords || []),
            ...insertedPayments
        ].sort((a: any, b: any) => a.due_date.localeCompare(b.due_date));

        // =====================================================================
        // CALCULATE PAID UNTIL STATUS using SHARED DATE MATH
        // =====================================================================
        let paidUntilDate: string | null = null;
        let daysOverdue = 0;

        if (newOutstandingBalance > 0) {
            // Debug the new balance calculation
            debugDateCalculation(newOutstandingBalance, dateMathSettings, currentDate);

            const paidUntilStatus = calculatePaidUntilStatus(
                newOutstandingBalance,
                dateMathSettings,
                currentDate
            );

            paidUntilDate = format(paidUntilStatus.paidUntilDate, 'yyyy-MM-dd');
            daysOverdue = paidUntilStatus.daysOverdue;

            console.log('📊 Paid Until Status (from shared math):', {
                paidUntilDate: format(paidUntilStatus.paidUntilDate, 'yyyy-MM-dd (EEEE)'),
                nextDueDate: format(paidUntilStatus.nextDueDate, 'yyyy-MM-dd (EEEE)'),
                cyclesPaid: paidUntilStatus.cyclesPaid,
                cyclesUnpaid: paidUntilStatus.cyclesUnpaid,
                daysOverdue: paidUntilStatus.daysOverdue
            });
        }

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
                    frequency: newSettings.frequency,
                    rentDueDay: newSettings.rentDueDay
                },
                currentDate
            );

            console.log('🎯 Resolver result:', {
                status: resolvedStatus.status,
                days: resolvedStatus.days,
                dateSince: resolvedStatus.dateSince,
                paidUntilDate: resolvedStatus.paidUntilDate,
                cyclesPaid: resolvedStatus.cyclesPaid,
                cyclesUnpaid: resolvedStatus.cyclesUnpaid
            });

            // Apply the resolved status
            await applyResolvedStatus(resolvedStatus, supabaseClient);

            console.log('✅ Ledger regeneration complete:', {
                recordsDeleted: unpaidRecords.length,
                recordsCreated: insertedPayments.length,
                paidRecordsPreserved: survivingPaidRecords?.length || 0,
                unpaidCycleCount: unpaidCycleCount,
                newBalance: newOutstandingBalance,
                newOverdueSince: resolvedStatus.dateSince,
                paidUntilDate: resolvedStatus.paidUntilDate,
                daysOverdue: resolvedStatus.days,
                newStatus: resolvedStatus.status
            });

            return {
                success: true,
                recordsDeleted: unpaidRecords.length,
                recordsCreated: insertedPayments.length,
                balanceRedistributed: newOutstandingBalance,
                newOverdueSince: resolvedStatus.dateSince,
                paidUntilDate: resolvedStatus.paidUntilDate,
                daysOverdue: resolvedStatus.days
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

            // Calculate paid until date for fully paid tenant
            const lastDueDate = insertedPayments.length > 0
                ? insertedPayments[insertedPayments.length - 1].due_date
                : null;

            console.log('✅ Ledger regeneration complete (tenant paid up/credit):', {
                recordsDeleted: unpaidRecords.length,
                recordsCreated: insertedPayments.length,
                paidRecordsPreserved: survivingPaidRecords?.length || 0,
                unpaidCycleCount: unpaidCycleCount,
                newBalance: newOutstandingBalance,
                creditAmount: newOutstandingBalance < 0 ? Math.abs(newOutstandingBalance) : 0,
                paidUntilDate: lastDueDate
            });

            return {
                success: true,
                recordsDeleted: unpaidRecords.length,
                recordsCreated: insertedPayments.length,
                balanceRedistributed: 0,
                newOverdueSince: null,
                paidUntilDate: lastDueDate,
                daysOverdue: 0
            };
        } else {
            // No payments generated - edge case
            console.log('✅ Ledger regeneration complete (no payments):', {
                recordsDeleted: unpaidRecords.length,
                recordsCreated: 0,
                paidRecordsPreserved: survivingPaidRecords?.length || 0,
                unpaidCycleCount: unpaidCycleCount,
                balanceRedistributed: 0
            });

            return {
                success: true,
                recordsDeleted: unpaidRecords.length,
                recordsCreated: 0,
                balanceRedistributed: 0,
                newOverdueSince: null,
                paidUntilDate: null,
                daysOverdue: 0
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
            paidUntilDate: null,
            daysOverdue: 0,
            error: error.message
        };
    }
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
