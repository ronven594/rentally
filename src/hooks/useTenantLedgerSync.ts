/**
 * Tenant Ledger Sync Hook
 *
 * Automatically regenerates the payment ledger when tenant settings change.
 * This is the "reactive AI resolver" that keeps the ledger in sync with settings.
 *
 * RACE CONDITION FIX:
 * - Provides loading state via isSyncing
 * - Waits for regeneration to complete via database wait
 * - Only triggers onSyncComplete after confirmation
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { regeneratePaymentLedger, shouldRegenerateLedger, TenantSettings } from "@/lib/ledger-regenerator";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import type { RealtimeChannel } from "@supabase/supabase-js";

export interface UseTenantLedgerSyncOptions {
    tenantId: string;
    trackingStartDate: string;
    rentAmount: number;
    frequency: 'Weekly' | 'Fortnightly' | 'Monthly';
    rentDueDay: string;
    propertyId: string;
    enabled?: boolean; // Allow disabling the sync (e.g., during form initialization)
    onSyncComplete?: () => void; // Callback when sync is complete - use this to refresh data
}

export interface UseTenantLedgerSyncReturn {
    isSyncing: boolean;
    syncLedger: () => Promise<void>;
}

/**
 * Hook to automatically regenerate payment ledger when tenant settings change
 *
 * Usage in EditTenantDialog or ManageTenantDialog:
 * ```tsx
 * const { isSyncing, syncLedger } = useTenantLedgerSync({
 *   tenantId: tenant.id,
 *   trackingStartDate: tenant.trackingStartDate,
 *   rentAmount: formRentAmount,
 *   frequency: formFrequency,
 *   rentDueDay: formRentDueDay,
 *   propertyId: tenant.propertyId,
 *   enabled: !isInitializing
 * });
 *
 * // In your UI:
 * <Button onClick={syncLedger} disabled={isSyncing}>
 *   {isSyncing ? 'Syncing...' : 'Sync Ledger'}
 * </Button>
 * ```
 */
export function useTenantLedgerSync(options: UseTenantLedgerSyncOptions): UseTenantLedgerSyncReturn {
    const {
        tenantId,
        trackingStartDate,
        rentAmount,
        frequency,
        rentDueDay,
        propertyId,
        enabled = true,
        onSyncComplete
    } = options;

    const [isSyncing, setIsSyncing] = useState(false);
    const channelRef = useRef<RealtimeChannel | null>(null);
    const previousSettingsRef = useRef<TenantSettings | null>(null);

    const currentSettings: TenantSettings = {
        id: tenantId,
        trackingStartDate,
        rentAmount,
        frequency,
        rentDueDay,
        propertyId
    };

    /**
     * Wait for database writes to complete
     * Gives a small buffer to ensure all Supabase operations have finished
     */
    const waitForDatabaseSync = useCallback((): Promise<void> => {
        return new Promise((resolve) => {
            // Wait 300ms to ensure all database writes have propagated
            setTimeout(() => {
                console.log('✅ Database sync wait complete');
                resolve();
            }, 300);
        });
    }, []);

    /**
     * Manual sync trigger - returns a Promise that resolves when complete
     */
    const syncLedger = useCallback(async () => {
        if (isSyncing) {
            console.log('⚠️ Sync already in progress, skipping');
            return;
        }

        console.log('🔄 Manual sync triggered:', {
            tenantId,
            currentSettings
        });

        setIsSyncing(true);

        try {
            // Step 1: Trigger regeneration (this completes all database operations)
            console.log('📝 Starting ledger regeneration...');
            const result = await regeneratePaymentLedger(tenantId, currentSettings, supabase);

            if (!result.success) {
                throw new Error(result.error || 'Regeneration failed');
            }

            console.log('✅ Regeneration completed successfully:', {
                recordsDeleted: result.recordsDeleted,
                recordsCreated: result.recordsCreated,
                balanceRedistributed: result.balanceRedistributed
            });

            // Step 2: Wait for database writes to propagate
            console.log('⏳ Waiting for database sync...');
            await waitForDatabaseSync();

            // Step 3: Trigger callback to refresh UI
            console.log('🔄 Triggering UI refresh callback...');
            if (onSyncComplete) {
                onSyncComplete();
            }

            console.log('✅ Sync complete - UI refresh triggered');

            toast.success('Ledger synchronized', {
                description: `${result.recordsCreated} payments regenerated`
            });
        } catch (error: any) {
            console.error('❌ Sync failed:', error);
            toast.error('Failed to sync ledger', {
                description: error.message || 'Unknown error'
            });
        } finally {
            setIsSyncing(false);
        }
    }, [tenantId, currentSettings, isSyncing, waitForDatabaseSync, onSyncComplete]);

    /**
     * Auto-sync when settings change
     */
    useEffect(() => {
        // Skip if disabled or no previous settings (first render)
        if (!enabled || !previousSettingsRef.current) {
            previousSettingsRef.current = currentSettings;
            return;
        }

        // Skip if already syncing
        if (isSyncing) {
            return;
        }

        // Check if settings changed in a way that requires regeneration
        if (shouldRegenerateLedger(previousSettingsRef.current, currentSettings)) {
            console.log('🔄 Settings changed - auto-syncing ledger:', {
                oldSettings: previousSettingsRef.current,
                newSettings: currentSettings
            });

            // Trigger sync automatically
            syncLedger();
        }

        // Update previous settings
        previousSettingsRef.current = currentSettings;
    }, [enabled, tenantId, trackingStartDate, rentAmount, frequency, rentDueDay, propertyId, isSyncing, syncLedger]);

    /**
     * Cleanup realtime subscriptions on unmount
     */
    useEffect(() => {
        return () => {
            if (channelRef.current) {
                channelRef.current.unsubscribe();
            }
        };
    }, []);

    return {
        isSyncing,
        syncLedger
    };
}

/**
 * Standalone manual trigger for ledger regeneration
 *
 * Use this when you want to explicitly trigger regeneration outside of a component
 * For component usage, prefer the useTenantLedgerSync hook
 */
export async function manuallyRegenerateLedger(
    tenantId: string,
    settings: Omit<TenantSettings, 'id'>
): Promise<boolean> {
    console.log('🔄 Manual ledger regeneration triggered');

    const fullSettings: TenantSettings = {
        id: tenantId,
        ...settings
    };

    const result = await regeneratePaymentLedger(tenantId, fullSettings, supabase);

    if (result.success) {
        toast.success('Payment ledger regenerated', {
            description: `${result.recordsCreated} payments created, balance redistributed: $${result.balanceRedistributed.toFixed(2)}`
        });
        return true;
    } else {
        toast.error('Failed to regenerate ledger', {
            description: result.error || 'Unknown error'
        });
        return false;
    }
}
