/**
 * Ledger Regenerator - Display-Only Payment Schedule Generator
 *
 * SESSION 4 REFACTOR: Ledger records are now for DISPLAY ONLY.
 *
 * KEY PRINCIPLES:
 * 1. Ledger records show the payment SCHEDULE (visual timeline)
 * 2. Record status is DERIVED from calculateRentState() at render time
 * 3. Balance is NEVER calculated from ledger records
 * 4. Settings changes regenerate the schedule without affecting balance
 * 5. Balance continuity on settings change is handled by baking currentBalance
 *    into openingArrears (see handleSettingsChange)
 *
 * WHAT CHANGED:
 * - Removed all balance calculation from ledger records
 * - Removed dependency on tenant-status-resolver.ts
 * - Records no longer store Paid/Unpaid status (derived at render time)
 * - Regeneration is now a simple delete-and-recreate of schedule entries
 */

import { format } from "date-fns";
import {
    findFirstDueDate,
    advanceDueDate,
    startOfDay,
    parseDateISO,
    isAfter,
    isBefore,
    isSameDay,
    type DueDateSettings,
    type PaymentFrequency
} from "./date-utils";
import {
    calculateRentState,
    type RentSettings,
    type Payment,
    type RentCalculationResult
} from "./rent-calculator";

// ============================================================================
// TYPES
// ============================================================================

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
    error?: string;
}

// ============================================================================
// MAIN FUNCTION: Regenerate Display-Only Ledger
// ============================================================================

/**
 * Regenerate the payment ledger for display purposes.
 *
 * This creates schedule entries showing when rent is/was due.
 * Records are created with status 'Pending' - actual display status
 * is derived at render time from calculateRentState().
 *
 * CRITICAL: This function does NOT affect balance calculation.
 * Balance comes exclusively from calculateRentState().
 *
 * @param tenantId - The tenant whose ledger needs regeneration
 * @param settings - The tenant settings (current, after any change)
 * @param supabaseClient - Supabase client instance
 * @param currentDate - Current date (for testing). Pass test date override if available.
 * @returns Result of the regeneration
 */
export async function regeneratePaymentLedger(
    tenantId: string,
    settings: TenantSettings,
    supabaseClient: any,
    currentDate: Date = new Date()
): Promise<LedgerRegenerationResult> {
    const effectiveDate = startOfDay(currentDate);

    console.log('🔄 LEDGER REGENERATOR (v2 - Display Only) - Starting:', {
        tenantId,
        settings: {
            trackingStartDate: settings.trackingStartDate,
            rentAmount: settings.rentAmount,
            frequency: settings.frequency,
            rentDueDay: settings.rentDueDay
        },
        effectiveDate: format(effectiveDate, 'yyyy-MM-dd')
    });

    try {
        // =====================================================================
        // STEP 1: Delete ALL existing ledger records for this tenant
        // =====================================================================
        // We delete everything because ledger records are display-only.
        // Balance is NOT derived from these records, so deleting is safe.
        const { data: existingRecords } = await supabaseClient
            .from('payments')
            .select('id')
            .eq('tenant_id', tenantId);

        const recordsToDelete = existingRecords?.length || 0;

        if (recordsToDelete > 0) {
            const { error: deleteError } = await supabaseClient
                .from('payments')
                .delete()
                .eq('tenant_id', tenantId);

            if (deleteError) {
                console.error('❌ Failed to delete existing records:', deleteError);
                return {
                    success: false,
                    recordsDeleted: 0,
                    recordsCreated: 0,
                    error: deleteError.message
                };
            }

            console.log(`🗑️ Deleted ${recordsToDelete} existing ledger records`);
        }

        // =====================================================================
        // STEP 2: Calculate first due date (Ground Zero)
        // =====================================================================
        const dueDateSettings: DueDateSettings = {
            frequency: settings.frequency,
            dueDay: settings.frequency === 'Monthly'
                ? parseInt(settings.rentDueDay, 10) || 1
                : settings.rentDueDay
        };

        const trackingStart = parseDateISO(settings.trackingStartDate);
        const firstDueDate = findFirstDueDate(trackingStart, dueDateSettings);

        console.log('📍 Ground Zero:', format(firstDueDate, 'yyyy-MM-dd (EEEE)'));

        // =====================================================================
        // STEP 3: Generate schedule records from firstDueDate to today + 2 cycles
        // =====================================================================
        // We generate a few future cycles so the UI can show upcoming due dates.
        const records: Array<{
            tenant_id: string;
            property_id: string;
            due_date: string;
            amount: number;
            status: string;
            amount_paid: number;
            paid_date: string | null;
        }> = [];

        let currentDue = firstDueDate;
        // Generate 2 extra cycles beyond today for future display
        let futureCyclesRemaining = 2;
        let iterations = 0;
        const maxIterations = 1000;

        while (iterations < maxIterations) {
            const isPastOrToday = isBefore(currentDue, effectiveDate) || isSameDay(currentDue, effectiveDate);

            records.push({
                tenant_id: tenantId,
                property_id: settings.propertyId,
                due_date: format(currentDue, 'yyyy-MM-dd'),
                amount: settings.rentAmount,
                // Status is 'Pending' - actual display status is derived at render time
                // from calculateRentState() via deriveLedgerRecordStatus()
                status: 'Pending',
                amount_paid: 0,
                paid_date: null
            });

            if (!isPastOrToday) {
                futureCyclesRemaining--;
                if (futureCyclesRemaining <= 0) break;
            }

            currentDue = advanceDueDate(currentDue, dueDateSettings);
            iterations++;
        }

        console.log('📅 Generated schedule entries:', {
            count: records.length,
            first: records.length > 0 ? records[0].due_date : 'None',
            last: records.length > 0 ? records[records.length - 1].due_date : 'None'
        });

        // =====================================================================
        // STEP 4: Insert records in batches (Supabase limit)
        // =====================================================================
        let totalInserted = 0;

        if (records.length > 0) {
            // Insert in batches of 100
            const batchSize = 100;
            for (let i = 0; i < records.length; i += batchSize) {
                const batch = records.slice(i, i + batchSize);
                const { error: insertError } = await supabaseClient
                    .from('payments')
                    .insert(batch);

                if (insertError) {
                    console.error('❌ Failed to insert batch:', insertError);
                    return {
                        success: false,
                        recordsDeleted: recordsToDelete,
                        recordsCreated: totalInserted,
                        error: insertError.message
                    };
                }

                totalInserted += batch.length;
            }
        }

        console.log('✅ Ledger regeneration complete (display-only):', {
            recordsDeleted: recordsToDelete,
            recordsCreated: totalInserted
        });

        return {
            success: true,
            recordsDeleted: recordsToDelete,
            recordsCreated: totalInserted
        };

    } catch (error: any) {
        console.error('❌ Ledger regeneration failed:', error);
        return {
            success: false,
            recordsDeleted: 0,
            recordsCreated: 0,
            error: error.message
        };
    }
}

// ============================================================================
// DERIVE LEDGER RECORD STATUS (for rendering)
// ============================================================================

/**
 * Derive the display status for a ledger record based on calculateRentState().
 *
 * CRITICAL: This is the ONLY way to determine a ledger record's visual status.
 * Never read the `status` column from the database for display purposes.
 *
 * Logic:
 * - If the due date is on or before paidUntilDate → 'Paid'
 * - If the due date is after effectiveDate (future) → 'Pending'
 * - Otherwise → 'Unpaid'
 *
 * @param recordDueDate - The ledger record's due date
 * @param rentState - Result from calculateRentState()
 * @returns Display status for UI rendering
 */
export function deriveLedgerRecordStatus(
    recordDueDate: Date,
    rentState: RentCalculationResult
): 'Paid' | 'Unpaid' | 'Pending' {
    const normalizedDueDate = startOfDay(recordDueDate);

    // Future records (due date after effective date) are Pending
    if (isAfter(normalizedDueDate, rentState.effectiveDate)) {
        return 'Pending';
    }

    // If tenant has paid through this date, it's Paid
    if (rentState.paidUntilDate) {
        const paidUntil = startOfDay(rentState.paidUntilDate);
        if (isBefore(normalizedDueDate, paidUntil) || isSameDay(normalizedDueDate, paidUntil)) {
            return 'Paid';
        }
    }

    // If no cycles are paid and there's no paidUntilDate, check if we're before firstDueDate
    if (!rentState.paidUntilDate && !rentState.isOverdue) {
        return 'Pending';
    }

    // Otherwise it's Unpaid
    return 'Unpaid';
}

// ============================================================================
// SETTINGS CHANGE HANDLER
// ============================================================================

/**
 * Handle tenant settings change while preserving balance continuity.
 *
 * THE KEY INSIGHT: When settings change (rent amount, frequency, due day),
 * we "bake" the current balance into openingArrears and reset trackingStartDate.
 * This ensures:
 * - Balance doesn't double (no ghost records)
 * - Balance doesn't reset (debt is preserved via openingArrears)
 * - The new schedule starts fresh with correct balance carried forward
 *
 * FLOW:
 * 1. Calculate current balance using OLD settings
 * 2. Set openingArrears = currentBalance
 * 3. Set trackingStartDate = today (reset)
 * 4. Clear old payment history (baked into openingArrears)
 * 5. Update tenant settings in DB
 * 6. Regenerate display ledger with NEW settings
 *
 * @param tenantId - Tenant to update
 * @param oldSettings - Current settings before change
 * @param newSettings - New settings to apply
 * @param paymentHistory - Actual payment history entries (for calculateRentState)
 * @param supabaseClient - Supabase client
 * @param testDate - Optional test date override
 * @returns Updated opening arrears value
 */
export async function handleSettingsChange(
    tenantId: string,
    oldSettings: TenantSettings & { openingArrears?: number },
    newSettings: Partial<TenantSettings>,
    paymentHistory: Array<{ id: string; amount: number; date: string }>,
    supabaseClient: any,
    testDate?: Date
): Promise<{ success: boolean; newOpeningArrears: number; error?: string }> {
    const effectiveDate = testDate || new Date();

    console.log('⚙️ SETTINGS CHANGE HANDLER - Starting:', {
        tenantId,
        oldSettings: {
            rentAmount: oldSettings.rentAmount,
            frequency: oldSettings.frequency,
            rentDueDay: oldSettings.rentDueDay,
            openingArrears: oldSettings.openingArrears || 0
        },
        newSettings,
        effectiveDate: format(effectiveDate, 'yyyy-MM-dd')
    });

    try {
        // =====================================================================
        // STEP 1: Calculate current balance using OLD settings
        // =====================================================================
        const currentRentSettings: RentSettings = {
            frequency: oldSettings.frequency,
            rentAmount: oldSettings.rentAmount,
            rentDueDay: oldSettings.frequency === 'Monthly'
                ? parseInt(oldSettings.rentDueDay, 10) || 1
                : oldSettings.rentDueDay,
            trackingStartDate: oldSettings.trackingStartDate,
            openingArrears: oldSettings.openingArrears || 0
        };

        const payments: Payment[] = paymentHistory.map(p => ({
            id: p.id,
            amount: p.amount,
            date: p.date
        }));

        const currentState = calculateRentState(currentRentSettings, payments, effectiveDate);
        const currentBalance = currentState.currentBalance;

        console.log('💰 Current balance (from old settings):', {
            currentBalance,
            formula: `${currentState.totalRentDue} + ${currentState.openingArrears} - ${currentState.totalPayments}`
        });

        // =====================================================================
        // STEP 2: Bake current balance into openingArrears
        // =====================================================================
        // The current balance becomes the opening arrears for the new settings.
        // This preserves any debt/credit while allowing a fresh start.
        const newOpeningArrears = Math.max(0, currentBalance);
        // Note: if tenant has credit (negative balance), we set openingArrears to 0.
        // Credit handling could be extended in future if needed.

        console.log('📦 Baking balance into openingArrears:', {
            currentBalance,
            newOpeningArrears,
            note: currentBalance < 0 ? 'Tenant has credit - not carried as arrears' : 'Debt preserved'
        });

        // =====================================================================
        // STEP 3: Clear old payment history from Supabase
        // (the amounts are now baked into openingArrears)
        // =====================================================================
        // Note: We clear the paymentHistory on the tenant record (JSON field),
        // NOT the payments table (that's the ledger which we regenerate).
        // The calling code should handle updating tenant.paymentHistory = []
        // and tenant.openingArrears = newOpeningArrears

        // =====================================================================
        // STEP 4: Build final settings for regeneration
        // =====================================================================
        const finalSettings: TenantSettings = {
            id: tenantId,
            trackingStartDate: format(effectiveDate, 'yyyy-MM-dd'),
            rentAmount: newSettings.rentAmount ?? oldSettings.rentAmount,
            frequency: (newSettings.frequency ?? oldSettings.frequency) as PaymentFrequency,
            rentDueDay: newSettings.rentDueDay ?? oldSettings.rentDueDay,
            propertyId: newSettings.propertyId ?? oldSettings.propertyId
        };

        // =====================================================================
        // STEP 5: Regenerate display ledger with new settings
        // =====================================================================
        const regenResult = await regeneratePaymentLedger(
            tenantId,
            finalSettings,
            supabaseClient,
            effectiveDate
        );

        if (!regenResult.success) {
            return {
                success: false,
                newOpeningArrears,
                error: regenResult.error
            };
        }

        console.log('✅ Settings change complete:', {
            newOpeningArrears,
            newTrackingStart: format(effectiveDate, 'yyyy-MM-dd'),
            ledgerRecordsCreated: regenResult.recordsCreated
        });

        return {
            success: true,
            newOpeningArrears
        };

    } catch (error: any) {
        console.error('❌ Settings change failed:', error);
        return {
            success: false,
            newOpeningArrears: 0,
            error: error.message
        };
    }
}

// ============================================================================
// SETTINGS CHANGE DETECTION
// ============================================================================

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
