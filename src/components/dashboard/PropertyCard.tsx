"use client"

import { useState } from "react"
import { Property, RentPayment } from "@/types"
import { TenantCard } from "./TenantCard"
import { cn } from "@/lib/utils"
import { ChevronDown, Plus } from "lucide-react"
import { isBefore, isSameDay, parseISO, startOfDay } from "date-fns"

interface PropertyCardProps {
    property: Property;
    payments: RentPayment[];
    tenantStates: Record<string, { isUnpaid: boolean; totalArrears: number }>;
    onRecordPayment: (tenantId: string, amount: number) => Promise<void>;
    onManageTenant: (tenantId: string) => void;
    onDeleteTenant: (tenantId: string) => void;
    onAddTenant: (propertyId: string) => void;
    onDeleteProperty: (propertyId: string) => void;
    testDate?: Date;
}

export function PropertyCard({
    property,
    payments,
    tenantStates,
    onRecordPayment,
    onManageTenant,
    onDeleteTenant,
    onAddTenant,
    onDeleteProperty,
    testDate
}: PropertyCardProps) {
    const [isExpanded, setIsExpanded] = useState(true);

    const getPropertyStatus = () => {
        if (property.tenants.length === 0) return { color: "slate", text: "No Tenants", isOverdue: false };

        let hasUnpaid = false;
        property.tenants.forEach(tenant => {
            const state = tenantStates[tenant.id];
            if (state?.isUnpaid) hasUnpaid = true;
        });

        return {
            color: hasUnpaid ? "rose" : "emerald",
            text: hasUnpaid ? "Unpaid Arrears" : "All Paid",
            isOverdue: hasUnpaid
        };
    };

    const status = getPropertyStatus();

    return (
        <div className={cn(
            "relative bg-white rounded-[2.5rem] p-8 border border-[#E1E3E5] transition-all duration-500 mb-8 font-sans",
            status.isOverdue
                ? "hover:shadow-[0_20px_50px_-12px_rgba(229,28,0,0.15)] hover:border-[#FAD4D4]"
                : "hover:shadow-[0_20px_50px_-12px_rgba(0,128,96,0.1)] hover:border-[#B7F5D0]"
        )}>
            <div className="flex justify-between items-start mb-8">
                <div onClick={() => setIsExpanded(!isExpanded)} className="cursor-pointer group">
                    <h3 className="text-2xl font-black text-[#1A1C1D] tracking-tighter flex items-center gap-3">
                        {property.address}
                        <ChevronDown className={cn("w-5 h-5 text-slate-300 transition-transform", isExpanded && "rotate-180")} />
                    </h3>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mt-1.5">Portfolio • {property.tenants.length} Active</p>
                </div>

                <div className={cn(
                    "flex items-center gap-2.5 px-4 py-2 rounded-full border transition-all",
                    status.isOverdue ? "bg-[#FFF1F0] border-[#FAD4D4]" : "bg-[#E3FBE3] border-[#B7F5D0]"
                )}>
                    <div className={cn(
                        "w-2.5 h-2.5 rounded-full",
                        status.isOverdue ? "bg-[#E51C00] animate-pulse shadow-[0_0_8px_rgba(229,28,0,0.4)]" : "bg-[#008060]"
                    )} />
                    <span className={cn(
                        "text-[10px] font-black uppercase tracking-widest",
                        status.isOverdue ? "text-[#E51C00]" : "text-[#008060]"
                    )}>
                        {status.text}
                    </span>
                </div>
            </div>

            {isExpanded && (
                <div className="space-y-6 animate-in fade-in slide-in-from-top-2 duration-500">
                    {property.tenants.map(tenant => {
                        const state = tenantStates[tenant.id] || { isUnpaid: false, totalArrears: 0 };
                        const allTenantPayments = payments.filter(p => p.tenantId === tenant.id);

                        return (
                            <TenantCard
                                key={tenant.id}
                                tenant={tenant}
                                isUnpaid={state.isUnpaid}
                                totalArrears={state.totalArrears}
                                payments={allTenantPayments}
                                propertyId={property.id}
                                onRecordPayment={onRecordPayment}
                                onSettings={() => onManageTenant(tenant.id)}
                            />
                        );
                    })}

                    <button
                        onClick={() => onAddTenant(property.id)}
                        className="w-full h-14 border-2 border-dashed border-[#EDEEEF] rounded-2xl hover:border-emerald-200 hover:bg-emerald-50/30 transition-all flex items-center justify-center gap-3 text-gray-400 hover:text-emerald-600 font-black text-xs uppercase tracking-widest"
                    >
                        <Plus className="w-4 h-4" />
                        Add New Tenant
                    </button>
                </div>
            )}
        </div>
    );
}
