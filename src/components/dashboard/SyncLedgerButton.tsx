/**
 * Sync Ledger Button
 *
 * Drop-in component for manually triggering ledger regeneration.
 * Shows loading state and prevents race conditions.
 *
 * Usage:
 * <SyncLedgerButton tenantId={tenant.id} currentSettings={...} />
 */

import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { useTenantLedgerSync } from "@/hooks/useTenantLedgerSync";
import type { TenantSettings } from "@/lib/ledger-regenerator";

interface SyncLedgerButtonProps {
    tenantId: string;
    currentSettings: Omit<TenantSettings, 'id'>;
    variant?: "default" | "outline" | "ghost" | "link" | "destructive" | "secondary";
    size?: "default" | "sm" | "lg" | "icon";
    showIcon?: boolean;
    className?: string;
    onSyncComplete?: () => void; // Callback when sync is complete - use to refresh data
}

export function SyncLedgerButton({
    tenantId,
    currentSettings,
    variant = "outline",
    size = "default",
    showIcon = true,
    className = "",
    onSyncComplete
}: SyncLedgerButtonProps) {
    const { isSyncing, syncLedger } = useTenantLedgerSync({
        tenantId,
        ...currentSettings,
        enabled: false, // Disable auto-sync, only sync on button click
        onSyncComplete
    });

    return (
        <Button
            variant={variant}
            size={size}
            onClick={syncLedger}
            disabled={isSyncing}
            className={className}
        >
            {isSyncing ? (
                <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Syncing...
                </>
            ) : (
                <>
                    {showIcon && <RefreshCw className="mr-2 h-4 w-4" />}
                    Sync Ledger
                </>
            )}
        </Button>
    );
}

/**
 * Example usage in ManageTenantDialog:
 *
 * import { SyncLedgerButton } from '@/components/dashboard/SyncLedgerButton';
 *
 * function ManageTenantDialog({ tenant }) {
 *     return (
 *         <DialogContent>
 *             <DialogHeader>
 *                 <DialogTitle>Manage Tenant</DialogTitle>
 *             </DialogHeader>
 *
 *             <div className="space-y-4">
 *                 {/* Tenant form fields here *\/}
 *
 *                 <div className="flex justify-between">
 *                     <SyncLedgerButton
 *                         tenantId={tenant.id}
 *                         currentSettings={{
 *                             trackingStartDate: tenant.tracking_start_date,
 *                             rentAmount: tenant.weekly_rent,
 *                             frequency: tenant.rent_frequency,
 *                             rentDueDay: tenant.rent_due_day,
 *                             propertyId: tenant.property_id
 *                         }}
 *                     />
 *
 *                     <Button onClick={handleSave}>Save Changes</Button>
 *                 </div>
 *             </div>
 *         </DialogContent>
 *     );
 * }
 */
