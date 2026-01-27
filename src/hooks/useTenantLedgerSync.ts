/**
 * Tenant Ledger Sync Hook
 *
 * SESSION 4 REFACTOR: Simplified to use display-only ledger regeneration.
 *
 * WHAT CHANGED:
 * - Sync now only regenerates display schedule (no balance implications)
 * - Balance comes from calculateRentState(), not ledger records
 * - Settings changes use handleSettingsChange() for balance continuity
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { regeneratePaymentLedger, shouldRegenerateLedger, type TenantSettings } from "@/lib/ledger-regenerator";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";

export interface UseTenantLedgerSyncOptions {
    tenantId: string;
    trackingStartDate: string;
    rentAmount: number;
    frequency: 'Weekly' | 'Fortnightly' | 'Monthly';
    rentDueDay: string;
    propertyId: string;
    enabled?: boolean;
    onSyncComplete?: () => void;
}

export interface UseTenantLedgerSyncReturn {
    isSyncing: boolean;
    syncLedger: () => Promise<void>;
}

/**
 * Hook to regenerate display-only payment ledger.
 *
 * IMPORTANT: This only regenerates the visual schedule.
 * Balance is calculated by calculateRentState() independently.
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
     * Manual sync trigger - regenerates display ledger only
     */
    const syncLedger = useCallback(async () => {
        if (isSyncing) {
            console.log('⚠️ Sync already in progress, skipping');
            return;
        }

        console.log('🔄 Sync triggered (display-only regeneration):', { tenantId });

        setIsSyncing(true);

        try {
            const result = await regeneratePaymentLedger(tenantId, currentSettings, supabase);

            if (!result.success) {
                throw new Error(result.error || 'Regeneration failed');
            }

            console.log('✅ Sync complete:', {
                recordsDeleted: result.recordsDeleted,
                recordsCreated: result.recordsCreated
            });

            if (onSyncComplete) {
                onSyncComplete();
            }

            toast.success('Ledger synchronized', {
                description: `${result.recordsCreated} schedule entries generated`
            });
        } catch (error: any) {
            console.error('❌ Sync failed:', error);
            toast.error('Failed to sync ledger', {
                description: error.message || 'Unknown error'
            });
        } finally {
            setIsSyncing(false);
        }
    }, [tenantId, currentSettings, isSyncing, onSyncComplete]);

    /**
     * Auto-sync when settings change
     */
    useEffect(() => {
        if (!enabled || !previousSettingsRef.current) {
            previousSettingsRef.current = currentSettings;
            return;
        }

        if (isSyncing) return;

        if (shouldRegenerateLedger(previousSettingsRef.current, currentSettings)) {
            console.log('🔄 Settings changed - auto-syncing display ledger');
            syncLedger();
        }

        previousSettingsRef.current = currentSettings;
    }, [enabled, tenantId, trackingStartDate, rentAmount, frequency, rentDueDay, propertyId, isSyncing, syncLedger]);

    return {
        isSyncing,
        syncLedger
    };
}

/**
 * Standalone manual trigger for ledger regeneration
 */
export async function manuallyRegenerateLedger(
    tenantId: string,
    settings: Omit<TenantSettings, 'id'>
): Promise<boolean> {
    const fullSettings: TenantSettings = {
        id: tenantId,
        ...settings
    };

    const result = await regeneratePaymentLedger(tenantId, fullSettings, supabase);

    if (result.success) {
        toast.success('Payment schedule regenerated', {
            description: `${result.recordsCreated} entries created`
        });
        return true;
    } else {
        toast.error('Failed to regenerate ledger', {
            description: result.error || 'Unknown error'
        });
        return false;
    }
}
