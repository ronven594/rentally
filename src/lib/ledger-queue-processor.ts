/**
 * Ledger Queue Processor
 *
 * Processes queued ledger regeneration requests triggered by database changes.
 * Works in conjunction with the database trigger to provide reliable,
 * server-side ledger regeneration.
 */

import { supabase } from "./supabaseClient";
import { regeneratePaymentLedger } from "./ledger-regenerator";

export interface RegenerationQueueItem {
    id: string;
    tenant_id: string;
    old_rent_amount: number;
    new_rent_amount: number;
    old_frequency: string;
    new_frequency: string;
    old_due_day: string;
    new_due_day: string;
    triggered_at: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    error_message?: string;
}

/**
 * Process all pending ledger regeneration requests
 *
 * Call this function periodically (e.g., in useEffect with interval)
 * or in response to realtime subscription events.
 */
export async function processRegenerationQueue(): Promise<void> {
    console.log('🔍 Checking for pending ledger regeneration requests...');

    try {
        // Fetch pending regeneration requests
        const { data: pendingRequests, error: fetchError } = await supabase
            .from('ledger_regeneration_queue')
            .select('*')
            .eq('status', 'pending')
            .order('triggered_at', { ascending: true })
            .limit(10); // Process up to 10 at a time

        if (fetchError) {
            console.error('❌ Failed to fetch regeneration queue:', fetchError);
            return;
        }

        if (!pendingRequests || pendingRequests.length === 0) {
            console.log('✅ No pending regeneration requests');
            return;
        }

        console.log(`📋 Found ${pendingRequests.length} pending regeneration requests`);

        // Process each request
        for (const request of pendingRequests) {
            await processRegenerationRequest(request);
        }
    } catch (error) {
        console.error('❌ Queue processing error:', error);
    }
}

/**
 * Process a single regeneration request
 */
async function processRegenerationRequest(request: RegenerationQueueItem): Promise<void> {
    console.log('⚙️ Processing regeneration request:', request.id);

    try {
        // Mark as processing
        await supabase
            .from('ledger_regeneration_queue')
            .update({ status: 'processing' })
            .eq('id', request.id);

        // Fetch tenant details
        const { data: tenant, error: tenantError } = await supabase
            .from('tenants')
            .select('*')
            .eq('id', request.tenant_id)
            .single();

        if (tenantError || !tenant) {
            throw new Error(`Failed to fetch tenant: ${tenantError?.message}`);
        }

        // Regenerate ledger
        const result = await regeneratePaymentLedger(
            request.tenant_id,
            {
                id: tenant.id,
                trackingStartDate: tenant.tracking_start_date,
                rentAmount: tenant.weekly_rent,
                frequency: tenant.rent_frequency,
                rentDueDay: tenant.rent_due_day,
                propertyId: tenant.property_id
            },
            supabase
        );

        if (result.success) {
            // Mark as completed
            await supabase
                .from('ledger_regeneration_queue')
                .update({
                    status: 'completed',
                    processed_at: new Date().toISOString()
                })
                .eq('id', request.id);

            console.log('✅ Regeneration request completed:', request.id);
        } else {
            // Mark as failed
            await supabase
                .from('ledger_regeneration_queue')
                .update({
                    status: 'failed',
                    processed_at: new Date().toISOString(),
                    error_message: result.error || 'Unknown error'
                })
                .eq('id', request.id);

            console.error('❌ Regeneration request failed:', request.id, result.error);
        }
    } catch (error: any) {
        console.error('❌ Error processing regeneration request:', error);

        // Mark as failed
        await supabase
            .from('ledger_regeneration_queue')
            .update({
                status: 'failed',
                processed_at: new Date().toISOString(),
                error_message: error.message
            })
            .eq('id', request.id);
    }
}

/**
 * Subscribe to realtime regeneration queue changes
 *
 * Use this in your app root to automatically process new requests
 * as they come in from the database trigger.
 */
export function subscribeToRegenerationQueue(
    onNewRequest?: (request: RegenerationQueueItem) => void
) {
    console.log('👂 Subscribing to regeneration queue...');

    const subscription = supabase
        .channel('regeneration_queue_changes')
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'ledger_regeneration_queue'
            },
            (payload) => {
                console.log('📨 New regeneration request received:', payload.new);

                if (onNewRequest) {
                    onNewRequest(payload.new as RegenerationQueueItem);
                }

                // Automatically process the queue
                processRegenerationQueue();
            }
        )
        .subscribe();

    return subscription;
}

/**
 * Clean up old completed/failed requests from the queue
 *
 * Call this periodically to prevent the queue from growing too large.
 */
export async function cleanupRegenerationQueue(olderThanDays: number = 7): Promise<void> {
    console.log(`🧹 Cleaning up regeneration queue (older than ${olderThanDays} days)...`);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const { error } = await supabase
        .from('ledger_regeneration_queue')
        .delete()
        .in('status', ['completed', 'failed'])
        .lt('triggered_at', cutoffDate.toISOString());

    if (error) {
        console.error('❌ Failed to cleanup regeneration queue:', error);
    } else {
        console.log('✅ Regeneration queue cleaned up');
    }
}
