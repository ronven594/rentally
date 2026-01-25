"use client"

import { useState } from "react"
import { Property, RentPayment } from "@/types"
import { TenantCard } from "./TenantCard"
import { StatusBadge } from "@/components/ui/StatusBadge"
import { cn } from "@/lib/utils"
import { ChevronDown, Plus } from "lucide-react"
import type { RentalLogicResult } from "@/hooks/useRentalLogic"
import { getKiwiStatus, type KiwiStatus } from "@/lib/status-engine"

interface PropertyCardProps {
    property: Property;
    payments: RentPayment[];
    tenantLegalStatuses: Record<string, RentalLogicResult>;
    onRecordPayment: (tenantId: string, amount: number, date: string) => Promise<void>;
    onManageTenant: (tenantId: string) => void;
    onDeleteTenant: (tenantId: string) => void;
    onAddTenant: (propertyId: string) => void;
    onDeleteProperty: (propertyId: string) => void;
    testDate?: Date;
}

export function PropertyCard({
    property,
    payments,
    tenantLegalStatuses,
    onRecordPayment,
    onManageTenant,
    onAddTenant,
}: PropertyCardProps) {
    const [isExpanded, setIsExpanded] = useState(true);

    // Determine property-level status from legal statuses
    // CRITICAL: Use getKiwiStatus for perfect synchronization with TenantCard
    let mostCriticalStatus: KiwiStatus = getKiwiStatus(0, 0, 0, 0); // Default to Safe

    property.tenants.forEach(tenant => {
        const legalStatus = tenantLegalStatuses[tenant.id];
        if (!legalStatus) return;

        const tenantStatus = getKiwiStatus(
            legalStatus.daysOverdue,
            legalStatus.workingDaysOverdue,
            legalStatus.totalBalanceDue,
            legalStatus.activeStrikeCount || 0
        );

        // Escalate to most critical severity found (4-Phase Visual Escalation)
        const severityPriority: Record<string, number> = {
            'critical': 4,   // Phase 4: Termination Eligible (Red)
            'warning': 3,    // Phase 3: Strike Warning (Solid Amber)
            'caution': 2,    // Phase 2: Caution (Glowing Amber)
            'safe': 1        // Phase 1: All Good (Green)
        };

        if (severityPriority[tenantStatus.severity] > severityPriority[mostCriticalStatus.severity]) {
            mostCriticalStatus = tenantStatus;
        }
    });

    const status = mostCriticalStatus.severity;
    const text = mostCriticalStatus.label.toUpperCase();

    // Parse address for street and suburb
    const addressParts = property.address.split(',');
    const streetAddress = addressParts[0]?.trim() || property.address;
    const suburb = property.region || addressParts[1]?.trim() || '';

    return (
        <div className={cn(
            // Glass Card Base - Neon Dark Theme
            "relative rounded-[2rem] p-6 transition-all duration-300 font-sans h-fit",
            "bg-white/5 backdrop-blur-xl border border-white/10",
            // Hover state for grid layout
            "hover:border-white/20 hover:bg-white/[0.07]"
        )}>
            {/* Header */}
            <div className="flex justify-between items-start mb-8">
                <div onClick={() => setIsExpanded(!isExpanded)} className="cursor-pointer group">
                    {/* Address - Bold White, italic */}
                    <h3 className="text-lg font-black italic text-white tracking-tighter flex items-center gap-3">
                        {streetAddress}
                        <ChevronDown className={cn(
                            "w-5 h-5 text-white/30 transition-transform group-hover:text-white/60",
                            isExpanded && "rotate-180"
                        )} />
                    </h3>
                    {/* Suburb - small, muted, uppercase */}
                    <p className="text-[11px] font-bold text-white/40 uppercase tracking-widest mt-1">
                        {suburb}
                    </p>
                </div>

                <StatusBadge
                    status={status as any}
                    text={text}
                />
            </div>

            {/* Expanded Content */}
            {isExpanded && (
                <div className="space-y-6 animate-in slide-in-from-top-4 duration-500 ease-out">
                    {property.tenants.map(tenant => {
                        const legalStatus = tenantLegalStatuses[tenant.id];
                        const allTenantPayments = payments.filter(p => p.tenantId === tenant.id);

                        return (
                            <TenantCard
                                key={tenant.id}
                                tenant={tenant}
                                legalStatus={legalStatus}
                                payments={allTenantPayments}
                                propertyId={property.id}
                                onRecordPayment={onRecordPayment}
                                onSettings={() => onManageTenant(tenant.id)}
                            />
                        );
                    })}

                    {/* Add Tenant Button */}
                    <button
                        onClick={() => onAddTenant(property.id)}
                        className={cn(
                            "w-full h-14 border-2 border-dashed border-gray-200 rounded-2xl hover:border-safe-green/30 hover:bg-safe-bg/30 transition-all flex items-center justify-center gap-3 text-gray-400 hover:text-safe-green font-black text-xs uppercase tracking-widest",
                            property.tenants.length === 0 && "mt-0 bg-gray-50"
                        )}
                    >
                        <Plus className="w-4 h-4" />
                        {property.tenants.length === 0 ? "Add your first tenant" : "Add New Tenant"}
                    </button>
                </div>
            )}
        </div>
    );
}
