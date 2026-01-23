"use client"

import { Tenant } from "@/types"
import { cn } from "@/lib/utils"
import { User, DollarSign } from "lucide-react"

interface TenantBubbleProps {
    tenant: Tenant;
    isUnpaid: boolean;
    onToggle: () => void;
}

export function TenantBubble({ tenant, isUnpaid, onToggle }: TenantBubbleProps) {
    return (
        <div
            onClick={onToggle}
            className={cn(
                "flex flex-col items-center justify-center w-32 h-32 rounded-3xl transition-all duration-300 cursor-pointer select-none",
                isUnpaid
                    ? "bg-red-50 text-red-600 shadow-neu-pressed border-2 border-red-100"
                    : "bg-neu-base text-gray-600 shadow-neu hover:shadow-lg active:shadow-neu-pressed"
            )}
        >
            <div className={cn(
                "p-3 rounded-full mb-2 transition-colors",
                isUnpaid ? "bg-red-100" : "bg-gray-200"
            )}>
                <User className="w-6 h-6" />
            </div>
            <span className="font-semibold text-sm truncate w-24 text-center">{tenant.name}</span>
            <span className="text-xs text-muted-foreground mt-1">${tenant.rentAmount}</span>
            {isUnpaid && <span className="text-[10px] font-bold mt-1 animate-pulse">UNPAID</span>}
        </div>
    )
}
