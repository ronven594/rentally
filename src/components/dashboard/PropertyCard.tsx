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
import type { TenantStatusResult } from "@/lib/status-calculator"

interface PropertyCardProps {
    property: Property;
    payments: RentPayment[];
    tenantStatuses: Record<string, TenantStatusResult>;
    onRecordPayment: (tenantId: string, amount: number, date: string) => Promise<void>;
    onVoidPayment?: (tenantId: string, paymentId: string) => Promise<void>;
    onManageTenant: (tenantId: string) => void;
    onDeleteTenant: (tenantId: string) => void;
    onAddTenant: (propertyId: string) => void;
    onDeleteProperty: (propertyId: string) => void;
    onNoticeSent?: () => Promise<void>;
    testDate?: Date;
}

export function PropertyCard({
    property,
    payments,
    tenantStatuses,
    onRecordPayment,
    onVoidPayment,
    onManageTenant,
    onAddTenant,
    onDeleteProperty,
    onNoticeSent,
    testDate,
}: PropertyCardProps) {
    const [isExpanded, setIsExpanded] = useState(true);

    /**
     * Calculate the highest severity across all tenants using unified status.
     * Maps severity tier (0-5) to property rank (1-5).
     */
    const getPropertySeverity = () => {
        let maxRank = 1;

        property.tenants.forEach(tenant => {
            const status = tenantStatuses[tenant.id];
            if (!status) return;

            // Map tier to rank: tier 0→1, 1→2, 2→3, 3→4, 4→4, 5→5
            const tierToRank: Record<number, number> = { 0: 1, 1: 2, 2: 3, 3: 4, 4: 4, 5: 5 };
            maxRank = Math.max(maxRank, tierToRank[status.severity.tier] ?? 1);
        });

        const rankMap: Record<number, { rank: 1|2|3|4|5; color: string; bannerText: string; animation: 'breathing'|'static'|'none' }> = {
            5: { rank: 5, color: '#FF3B3B', bannerText: 'TERMINATION ELIGIBLE (FOLLOW UP REQUIRED)', animation: 'breathing' },
            4: { rank: 4, color: '#FF3B3B', bannerText: 'SERIOUS ARREARS (10+ WORKING DAYS)', animation: 'static' },
            3: { rank: 3, color: '#FBBF24', bannerText: 'REPEATED BREACH (STRIKE READY)', animation: 'static' },
            2: { rank: 2, color: '#D97706', bannerText: 'LATE RENT (1-4 DAYS)', animation: 'none' },
        };

        return rankMap[maxRank] || { rank: 1 as const, color: '#22C55E', bannerText: 'RENT UP TO DATE', animation: 'none' as const };
    };

    const propertySeverity = getPropertySeverity();

    const status = propertySeverity.rank >= 4 ? 'critical' :
                   propertySeverity.rank === 3 ? 'warning' :
                   propertySeverity.rank === 2 ? 'caution' : 'safe';
    const text = propertySeverity.bannerText;

    const addressParts = property.address.split(',');
    const streetAddress = addressParts[0]?.trim() || property.address;
    const suburb = property.region || addressParts[1]?.trim() || '';

    return (
        <div className={cn(
            "relative rounded-[2rem] p-6 transition-all duration-300 font-sans h-fit",
            "bg-white/5 backdrop-blur-xl border border-white/10",
            "hover:border-white/20 hover:bg-white/[0.07]"
        )}>
            {/* Header */}
            <div className="flex justify-between items-start mb-8">
                <div onClick={() => setIsExpanded(!isExpanded)} className="cursor-pointer group flex-1">
                    <h3 className="text-lg font-black italic text-white tracking-tighter flex items-center gap-3">
                        {streetAddress}
                        <ChevronDown className={cn(
                            "w-5 h-5 text-white/30 transition-transform group-hover:text-white/60",
                            isExpanded && "rotate-180"
                        )} />
                    </h3>
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
                        const tenantStatus = tenantStatuses[tenant.id];
                        const allTenantPayments = payments.filter(p => p.tenantId === tenant.id);

                        if (!tenantStatus) return null;

                        return (
                            <TenantCard
                                key={tenant.id}
                                tenant={tenant}
                                status={tenantStatus}
                                payments={allTenantPayments}
                                propertyId={property.id}
                                propertyAddress={property.address}
                                region={(property.region || "Auckland") as any}
                                onRecordPayment={onRecordPayment}
                                onVoidPayment={onVoidPayment}
                                onSettings={() => onManageTenant(tenant.id)}
                                onNoticeSent={onNoticeSent}
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
