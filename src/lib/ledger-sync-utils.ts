/**
 * Ledger Sync Utilities
 *
 * Helper functions for waiting on ledger regeneration completion
 * and coordinating between queue-based and direct regeneration.
 */

import { supabase } from "./supabaseClient";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Wait for a specific queue record to be marked as completed
 *
 * This is used when the database trigger creates a queue record
 * and you want to wait for the background processor to finish.
 */
export function waitForQueueCompletion(
    tenantId: string,
    timeoutMs: number = 30000
): Promise<void> {
    return new Promise((resolve, reject) => {
        console.log('⏳ Waiting for queue completion...', { tenantId, timeoutMs });

        let timeout: NodeJS.Timeout;
        let pollInterval: NodeJS.Timeout;
        let channel: RealtimeChannel | null = null;

        // Cleanup function
        const cleanup = () => {
            if (timeout) clearTimeout(timeout);
            if (pollInterval) clearInterval(pollInterval);
            if (channel) channel.unsubscribe();
        };

        // Set timeout
        timeout = setTimeout(() => {
            console.warn('⚠️ Queue completion timeout - assuming complete');
            cleanup();
            resolve();
        }, timeoutMs);

        // Poll the queue table to check for completion
        const checkQueue = async () => {
            try {
                const { data: queueRecords } = await supabase
                    .from('ledger_regeneration_queue')
                    .select('*')
                    .eq('tenant_id', tenantId)
                    .in('status', ['pending', 'processing']);

                console.log('🔍 Checking queue status:', {
                    pendingRecords: queueRecords?.length || 0
                });

                // If no pending/processing records, regeneration is complete
                if (!queueRecords || queueRecords.length === 0) {
                    console.log('✅ Queue completion detected - no pending records');
                    cleanup();
                    resolve();
                }
            } catch (error) {
                console.error('❌ Error checking queue:', error);
            }
        };

        // Poll every 500ms
        pollInterval = setInterval(checkQueue, 500);

        // Also subscribe to realtime updates for faster response
        channel = supabase
            .channel(`ledger-queue-wait-${tenantId}-${Date.now()}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'ledger_regeneration_queue',
                    filter: `tenant_id=eq.${tenantId}`
                },
                (payload: any) => {
                    console.log('🔔 Queue realtime update:', payload.new);

                    if (payload.new.status === 'completed') {
                        console.log('✅ Queue completed (realtime)');
                        cleanup();
                        resolve();
                    } else if (payload.new.status === 'failed') {
                        console.error('❌ Queue failed (realtime):', payload.new.error_message);
                        cleanup();
                        reject(new Error(payload.new.error_message || 'Regeneration failed'));
                    }
                }
            )
            .subscribe();

        // Initial check
        checkQueue();
    });
}

/**
 * Create a queue record and wait for it to be processed
 *
 * This is useful for manually triggering a queue-based regeneration
 * from the UI instead of calling regeneratePaymentLedger directly.
 */
export async function triggerQueuedRegeneration(
    tenantId: string,
    oldSettings: {
        rentAmount: number;
        frequency: string;
        rentDueDay: string;
    },
    newSettings: {
        rentAmount: number;
        frequency: string;
        rentDueDay: string;
    }
): Promise<void> {
    console.log('📝 Creating queue record for regeneration...');

    // Insert queue record
    const { data: queueRecord, error: insertError } = await supabase
        .from('ledger_regeneration_queue')
        .insert({
            tenant_id: tenantId,
            old_rent_amount: oldSettings.rentAmount,
            new_rent_amount: newSettings.rentAmount,
            old_frequency: oldSettings.frequency,
            new_frequency: newSettings.frequency,
            old_due_day: oldSettings.rentDueDay,
            new_due_day: newSettings.rentDueDay,
            status: 'pending'
        })
        .select()
        .single();

    if (insertError) {
        console.error('❌ Failed to create queue record:', insertError);
        throw new Error(`Failed to create queue record: ${insertError.message}`);
    }

    console.log('✅ Queue record created:', queueRecord.id);

    // Wait for it to be processed
    await waitForQueueCompletion(tenantId);

    console.log('✅ Queued regeneration complete');
}

/**
 * Check if there are any pending regenerations for a tenant
 */
export async function hasPendingRegeneration(tenantId: string): Promise<boolean> {
    const { data, error } = await supabase
        .from('ledger_regeneration_queue')
        .select('id')
        .eq('tenant_id', tenantId)
        .in('status', ['pending', 'processing'])
        .limit(1);

    if (error) {
        console.error('❌ Error checking pending regenerations:', error);
        return false;
    }

    return (data?.length || 0) > 0;
}
