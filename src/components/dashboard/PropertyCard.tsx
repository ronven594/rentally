"use client"

import { useState } from "react"
import { Property, RentPayment } from "@/types"
import { TenantCard } from "./TenantCard"
import { StatusBadge } from "@/components/ui/StatusBadge"
import { cn } from "@/lib/utils"
import { ChevronDown, Plus, MoreVertical, Trash2 } from "lucide-react"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { RentalLogicResult } from "@/hooks/useRentalLogic"

interface PropertyCardProps {
    property: Property;
    payments: RentPayment[];
    tenantLegalStatuses: Record<string, RentalLogicResult>;
    onRecordPayment: (tenantId: string, amount: number, date: string) => Promise<void>;
    onVoidPayment?: (tenantId: string, paymentId: string) => Promise<void>;
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
    onVoidPayment,
    onManageTenant,
    onAddTenant,
    onDeleteProperty,
    testDate,
}: PropertyCardProps) {
    const [isExpanded, setIsExpanded] = useState(true);

    /**
     * 5-Tier Severity Hierarchy for Property-Level Banner
     * Maps tenant states to numerical rankings for max severity calculation
     */
    type PropertySeverityRank = 1 | 2 | 3 | 4 | 5;

    interface PropertySeverity {
        rank: PropertySeverityRank;
        color: string;
        bannerText: string;
        animation: 'breathing' | 'static' | 'none';
    }

    /**
     * Calculate the highest severity across all tenants in this property
     * Returns unified severity object for property-level banner display
     */
    const getPropertySeverity = (): PropertySeverity => {
        let maxRank = 1; // Use number type during calculation

        property.tenants.forEach(tenant => {
            const legalStatus = tenantLegalStatuses[tenant.id];
            if (!legalStatus) return;

            const { daysOverdue, workingDaysOverdue, totalBalanceDue, activeStrikeCount = 0 } = legalStatus;

            // Skip if paid
            if (totalBalanceDue <= 0) return;

            // RANK 5: RED_BREATHING (Termination - 21+ days OR 3 strikes)
            if (daysOverdue >= 21 || activeStrikeCount >= 3) {
                maxRank = Math.max(maxRank, 5);
            }
            // RANK 4: RED_SOLID (10-20 days overdue)
            else if (workingDaysOverdue >= 10) {
                maxRank = Math.max(maxRank, 4);
            }
            // RANK 3: GOLD_SOLID (5-9 days overdue)
            else if (workingDaysOverdue >= 5) {
                maxRank = Math.max(maxRank, 3);
            }
            // RANK 2: AMBER_OUTLINE (1-4 days overdue)
            else if (workingDaysOverdue >= 1) {
                maxRank = Math.max(maxRank, 2);
            }
        });

        // Map rank to display properties with grounded, professional phrasing
        switch (maxRank) {
            case 5:
                return {
                    rank: 5,
                    color: '#FF3B3B',
                    bannerText: 'TERMINATION ELIGIBLE (FOLLOW UP REQUIRED)',
                    animation: 'breathing'
                };
            case 4:
                return {
                    rank: 4,
                    color: '#FF3B3B',
                    bannerText: 'SERIOUS ARREARS (10+ WORKING DAYS)',
                    animation: 'static'
                };
            case 3:
                return {
                    rank: 3,
                    color: '#FBBF24',
                    bannerText: 'REPEATED BREACH (STRIKE READY)',
                    animation: 'static'
                };
            case 2:
                return {
                    rank: 2,
                    color: '#D97706',
                    bannerText: 'LATE RENT (1-4 DAYS)',
                    animation: 'none'
                };
            default:
                return {
                    rank: 1,
                    color: '#22C55E',
                    bannerText: 'RENT UP TO DATE',
                    animation: 'none'
                };
        }
    };

    const propertySeverity = getPropertySeverity();

    // Legacy status for StatusBadge (keeping for backward compatibility)
    const status = propertySeverity.rank >= 4 ? 'critical' :
                   propertySeverity.rank === 3 ? 'warning' :
                   propertySeverity.rank === 2 ? 'caution' : 'safe';
    const text = propertySeverity.bannerText;

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
                <div onClick={() => setIsExpanded(!isExpanded)} className="cursor-pointer group flex-1">
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

                <div className="flex items-center gap-2">
                    <StatusBadge
                        status={status as any}
                        text={text}
                        breathing={propertySeverity.rank === 5}
                    />

                    {/* Property Actions Menu */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/10 transition-all">
                                <MoreVertical className="w-4 h-4" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-[#0B0E11] border-white/10">
                            <DropdownMenuItem
                                onClick={() => onDeleteProperty(property.id)}
                                className="text-[#FF3B3B] focus:text-[#FF3B3B] focus:bg-[#FF3B3B]/10 cursor-pointer"
                            >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete Property
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
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
                                onVoidPayment={onVoidPayment}
                                onSettings={() => onManageTenant(tenant.id)}
                                testDate={testDate}
                            />
                        );
                    })}

                    {/* Add Tenant Button */}
                    <button
                        onClick={() => onAddTenant(property.id)}
                        className={cn(
                            "w-full h-14 border-2 border-dashed border-white/10 rounded-2xl hover:border-[#00FFBB]/30 hover:bg-[#00FFBB]/5 transition-all flex items-center justify-center gap-3 text-white/40 hover:text-[#00FFBB] font-black text-xs uppercase tracking-widest",
                            property.tenants.length === 0 && "mt-0 bg-white/5"
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
