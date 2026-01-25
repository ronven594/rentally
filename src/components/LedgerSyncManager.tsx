/**
 * Ledger Sync Manager
 *
 * Global component that manages automatic ledger regeneration.
 * Include this once in your app root (e.g., layout.tsx or _app.tsx).
 *
 * This component:
 * 1. Subscribes to realtime queue changes
 * 2. Processes pending regeneration requests
 * 3. Provides status updates to the user
 */

"use client";

import { useEffect, useState } from "react";
import { subscribeToRegenerationQueue, processRegenerationQueue, cleanupRegenerationQueue } from "@/lib/ledger-queue-processor";
import { toast } from "sonner";

export function LedgerSyncManager() {
    const [isProcessing, setIsProcessing] = useState(false);
    const [processedCount, setProcessedCount] = useState(0);

    useEffect(() => {
        console.log('🚀 Ledger Sync Manager initialized');

        // Process any existing pending requests on mount
        processRegenerationQueue();

        // Subscribe to new requests
        const subscription = subscribeToRegenerationQueue((request) => {
            console.log('📨 New ledger regeneration request:', request);
            setIsProcessing(true);
            setProcessedCount(prev => prev + 1);

            toast.info('Updating payment ledger...', {
                description: 'Tenant settings changed, regenerating payment history'
            });
        });

        // Periodic queue processing (every 30 seconds as backup)
        const interval = setInterval(() => {
            processRegenerationQueue();
        }, 30000);

        // Periodic cleanup (every hour)
        const cleanupInterval = setInterval(() => {
            cleanupRegenerationQueue(7); // Clean up requests older than 7 days
        }, 3600000);

        // Cleanup on unmount
        return () => {
            subscription.unsubscribe();
            clearInterval(interval);
            clearInterval(cleanupInterval);
        };
    }, []);

    // This component doesn't render anything visible
    // It runs silently in the background
    return null;
}

/**
 * Status indicator component (optional)
 *
 * Shows when ledger regeneration is in progress.
 * Include this in your layout if you want a visual indicator.
 */
export function LedgerSyncStatus() {
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        const subscription = subscribeToRegenerationQueue(() => {
            setIsProcessing(true);

            // Reset after 3 seconds
            setTimeout(() => {
                setIsProcessing(false);
            }, 3000);
        });

        return () => {
            subscription.unsubscribe();
        };
    }, []);

    if (!isProcessing) return null;

    return (
        <div className="fixed bottom-4 right-4 bg-blue-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            <span className="text-sm font-medium">Updating payment ledger...</span>
        </div>
    );
}
