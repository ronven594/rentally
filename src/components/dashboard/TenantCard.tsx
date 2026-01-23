"use client"

import { Tenant, RentPayment } from "@/types"
import { cn } from "@/lib/utils"
import { useState, useMemo } from "react"
import { CheckCircle, Settings as SettingsIcon, Receipt } from "lucide-react"
import { RecordPaymentDialog } from "./RecordPaymentDialog"
import { format, startOfDay } from "date-fns"

interface TenantCardProps {
    tenant: Tenant;
    isUnpaid: boolean;
    totalArrears: number;
    payments: RentPayment[];
    propertyId: string;
    onRecordPayment: (tenantId: string, amount: number) => Promise<void>;
    onSettings: () => void;
}

export function TenantCard({
    tenant,
    isUnpaid,
    totalArrears,
    payments,
    onRecordPayment,
    onSettings,
}: TenantCardProps) {
    const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
    const today = startOfDay(new Date());

    // Calculate arrears start date (earliest unpaid payment due date)
    const arrearsStartDate = useMemo(() => {
        const unpaidPayments = payments.filter(p =>
            p.tenantId === tenant.id &&
            !p.paidDate &&
            p.status !== 'Paid'
        );
        if (unpaidPayments.length === 0) return undefined;

        // Sort by due date and get the earliest
        const sorted = [...unpaidPayments].sort((a, b) =>
            new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
        );
        return sorted[0]?.dueDate;
    }, [payments, tenant.id]);

    const statusLabel = isUnpaid ? "UNPAID ARREARS" : "ALL PAID";
    const statusColor = isUnpaid ? "text-[#E51C00]" : "text-[#008060]";
    const weeksBehind = tenant.rentAmount > 0 ? (totalArrears / tenant.rentAmount).toFixed(1) : "0.0";
    const statusSub = isUnpaid ? `${weeksBehind} weeks behind ($${Math.round(totalArrears)})` : "Account up to date";

    return (
        <div className={cn(
            "bg-gray-50/50 border rounded-[2rem] p-6 flex flex-col font-sans transition-all duration-300",
            isUnpaid ? "border-rose-100 bg-rose-50/10" : "border-[#EDEEEF]"
        )}>
            <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-white border border-[#E1E3E5] rounded-xl flex items-center justify-center font-black text-gray-300 text-sm shadow-sm">
                        {tenant.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                    </div>
                    <div>
                        <h4 className="text-lg font-black text-[#1A1C1D] tracking-tighter leading-tight">{tenant.name}</h4>
                        <div className="flex flex-col mt-0.5">
                            <div className="flex items-center gap-1.5">
                                <p className={cn(
                                    "text-xs font-black tracking-[0.2em] uppercase",
                                    statusColor
                                )}>
                                    {statusLabel}
                                </p>
                            </div>
                            <p className="text-[11px] font-bold text-gray-400 tracking-wider">
                                {statusSub}
                            </p>
                        </div>
                    </div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); onSettings(); }} className="text-gray-300 hover:text-gray-900 transition-colors">
                    <SettingsIcon className="w-5 h-5" />
                </button>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-3">
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setIsPaymentDialogOpen(true);
                    }}
                    className={cn(
                        "w-full py-5 text-[11px] font-black uppercase tracking-[0.2em] rounded-2xl transition-all flex items-center justify-center gap-3",
                        totalArrears > 0
                            ? "bg-[#1A1C1D] text-white shadow-lg shadow-black/10 hover:bg-black"
                            : "bg-white border-2 border-[#E3FBE3] text-[#008060] hover:bg-[#F0FDF4]"
                    )}
                >
                    {totalArrears > 0 ? (
                        <>
                            <Receipt className="w-4 h-4" />
                            RECORD PAYMENT
                        </>
                    ) : (
                        <>
                            <CheckCircle className="w-4 h-4" />
                            PAID
                        </>
                    )}
                </button>
            </div>

            <RecordPaymentDialog
                open={isPaymentDialogOpen}
                onOpenChange={setIsPaymentDialogOpen}
                tenant={tenant}
                totalOutstanding={totalArrears}
                onRecordPayment={(amount) => onRecordPayment(tenant.id, amount)}
            />
        </div>
    )
}
