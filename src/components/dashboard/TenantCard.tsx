"use client"

import { Tenant, RentPayment } from "@/types"
import { cn } from "@/lib/utils"
import { useState } from "react"
import { CheckCircle, MoreHorizontal, Receipt, FileWarning, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SmartPaymentModal } from "./SmartPaymentModal"
import { StrikeBar } from "./StrikeBar"
import { format } from "date-fns"
import { formatFrequencyLabel, getKiwiStatus } from "@/lib/status-engine"
import type { RentalLogicResult } from "@/hooks/useRentalLogic"

interface TenantCardProps {
    tenant: Tenant;
    legalStatus: RentalLogicResult;
    payments: RentPayment[];
    propertyId: string;
    suggestedMatch?: { amount: number; date: string; reference?: string; confidence: number } | null;
    onRecordPayment: (tenantId: string, amount: number, date: string) => Promise<void>;
    onSettings: () => void;
    onSettleOpeningBalance?: (tenantId: string) => Promise<void>; // Settlement action for backdated tenants
}

export function TenantCard({
    tenant,
    legalStatus,
    payments,
    suggestedMatch,
    onRecordPayment,
    onSettings,
    onSettleOpeningBalance,
}: TenantCardProps) {
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [isSettling, setIsSettling] = useState(false);

    // Extract values from legal status
    const {
        status,
        daysOverdue,
        workingDaysOverdue,
        totalBalanceDue,
        eligibleActions,
        activeStrikeCount, // Strike memory - persists even when paid (independent of arrears)
    } = legalStatus;

    // Next due date calculation
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of day for accurate comparison

    const nextDuePayment = payments
        .filter(p => new Date(p.dueDate).getTime() >= today.getTime())
        .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];

    const nextDueDate = nextDuePayment ? format(new Date(nextDuePayment.dueDate), 'MMM d') : '-';

    // CRITICAL: Check if next UNPAID payment is actually overdue or just pending in future
    const nextUnpaidPayment = payments
        .filter(p => p.status === 'Unpaid' || p.status === 'Partial')
        .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];

    const isNextUnpaidFuture = nextUnpaidPayment
        ? new Date(nextUnpaidPayment.dueDate).getTime() > today.getTime()
        : false;

    // Handle payment confirmation from modal
    const handleConfirmPayment = async (amount: number, date: string) => {
        await onRecordPayment(tenant.id, amount, date);
    };

    // Get Kiwi Status with 4-Phase Visual Escalation
    const statusInfo = getKiwiStatus(daysOverdue, workingDaysOverdue, totalBalanceDue, activeStrikeCount);

    return (
        <div className={cn(
            // Glass Card Base - Neon Dark Theme
            "rounded-[2rem] p-6 flex flex-col font-sans transition-all duration-300",
            "bg-white/5 backdrop-blur-xl border border-white/10",
            // Phase-based glow effects (no solid backgrounds)
            statusInfo.severity === 'critical' && "shadow-[0_0_20px_rgba(255,59,59,0.3)]",
            statusInfo.severity === 'warning' && "shadow-[0_0_15px_rgba(255,184,0,0.25)]",
            statusInfo.severity === 'caution' && "border-[#FFB800]/50 shadow-[0_0_15px_rgba(255,184,0,0.2)]"
        )}>
            {/* Legal Action Banner - Neon Dark Theme */}
            {daysOverdue >= 21 ? (
                // 21+ Calendar Days: Termination Eligible - Electric Red
                <div className="rounded-2xl p-4 mb-4 border-l-4 bg-[#FF3B3B]/10 border-[#FF3B3B]">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[#FF3B3B]">
                        URGENT: Eligible for Termination Application (S55 1a)
                    </p>
                    <p className="text-xs text-white/60 mt-1 font-mono">
                        {daysOverdue} calendar days behind - Immediate tribunal eligibility
                    </p>
                </div>
            ) : workingDaysOverdue >= 10 ? (
                // 10+ Working Days: Strike 2/3 Territory - Electric Red
                <div className="rounded-2xl p-4 mb-4 border-l-4 bg-[#FF3B3B]/10 border-[#FF3B3B]">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[#FF3B3B]">
                        Action Required: Section 55 Strike Notice 2 Ready
                    </p>
                    <p className="text-xs text-white/60 mt-1 font-mono">
                        {workingDaysOverdue} working days overdue (RTA compliance)
                    </p>
                </div>
            ) : workingDaysOverdue >= 5 ? (
                // 5-9 Working Days: Strike 1 Territory - Electric Gold
                <div className="rounded-2xl p-4 mb-4 border-l-4 bg-[#FFB800]/10 border-[#FFB800]">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[#FFB800]">
                        Action Advised: Section 55 Strike Notice 1 Ready
                    </p>
                    <p className="text-xs text-white/60 mt-1 font-mono">
                        {workingDaysOverdue} working days overdue (RTA compliance)
                    </p>
                </div>
            ) : daysOverdue >= 1 && workingDaysOverdue < 5 ? (
                // 1+ Calendar Days (Monitor Phase): Section 56 Available - Electric Gold
                <div className="rounded-2xl p-4 mb-4 border-l-4 bg-[#FFB800]/10 border-[#FFB800]">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[#FFB800]">
                        Notice to Remedy (14-Day) Available
                    </p>
                    <p className="text-xs text-white/60 mt-1 font-mono">
                        Section 56: 14-Day Notice to Remedy can be issued
                    </p>
                </div>
            ) : null}

            <div className="flex justify-between items-start mb-4">
                <div className="flex items-start gap-4">
                    {/* Avatar - Glass Style */}
                    <div className="w-12 h-12 bg-white/10 border border-white/20 rounded-xl flex items-center justify-center font-black text-white/60 text-sm shrink-0">
                        {tenant.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                        {/* Name - Bold White */}
                        <h4 className="text-lg font-black text-white tracking-tighter leading-tight">
                            {tenant.name}
                        </h4>
                        <div className="flex flex-col mt-0.5">
                            {/* Status Text - Neon Colors */}
                            <p className={cn(
                                "text-[11px] font-bold tracking-wide mb-1.5 font-mono",
                                // Phase 4: Termination Eligible (Electric Red)
                                statusInfo.severity === 'critical' && "text-[#FF3B3B] font-black",
                                // Phase 3: Strike Warning (Electric Gold)
                                statusInfo.severity === 'warning' && "text-[#FFB800] font-black",
                                // Phase 2: Caution (Electric Gold)
                                statusInfo.severity === 'caution' && !isNextUnpaidFuture && "text-[#FFB800]",
                                // Phase 1: All Good (Neon Mint)
                                (statusInfo.severity === 'safe' || isNextUnpaidFuture) && "text-[#00FFBB]"
                            )}>
                                {statusInfo.severity === 'critical' ? (
                                    statusInfo.actionText // "Termination Eligible"
                                ) : statusInfo.severity === 'warning' ? (
                                    statusInfo.actionText // "X Strike(s) Active" or "Strike Notice Ready"
                                ) : statusInfo.severity === 'caution' && !isNextUnpaidFuture ? (
                                    `${statusInfo.actionText}: $${totalBalanceDue.toFixed(2)} (${daysOverdue} day${daysOverdue !== 1 ? 's' : ''})`
                                ) : (
                                    `Paid to ${nextDueDate}`
                                )}
                            </p>

                            {/* Micro-Data Row - Monospace Metrics */}
                            <div className="flex items-center gap-2 text-sm font-mono text-white/50 tracking-tight">
                                <span className="text-white/70">${tenant.rentAmount}</span>
                                <span className="text-white/30">/ {formatFrequencyLabel(tenant.frequency)}</span>
                                <span className="w-1 h-1 rounded-full bg-white/30 shrink-0" />
                                <span className="text-white/50">Next: {nextDueDate}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Settings Button (three dots) - Glass Theme */}
                <button
                    onClick={(e) => { e.stopPropagation(); onSettings(); }}
                    className="text-white/30 hover:text-white transition-colors mt-1 shrink-0"
                >
                    <MoreHorizontal className="w-6 h-6" />
                </button>
            </div>

            {/* Strike Bar - full width, aligned with button below */}
            {/* CRITICAL: Use activeStrikeCount for UI (strike memory persists even when paid) */}
            <StrikeBar
                strikes={activeStrikeCount}
                glow={workingDaysOverdue >= 5}
                maxStrikes={3}
                className="mb-4"
                windowExpiryDate={legalStatus.legalAnalysis.analysis.windowExpiryDate}
            />

            {/* Action Buttons */}
            <div className="flex flex-col gap-3">
                {/* Record Payment Button */}
                <Button
                    variant={totalBalanceDue > 0 ? "brand" : "brand-success"}
                    size="brand"
                    onClick={(e) => {
                        e.stopPropagation();
                        setIsPaymentModalOpen(true);
                    }}
                    className="w-full rounded-2xl"
                >
                    {totalBalanceDue > 0 ? (
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
                </Button>

                {/* Settlement Button - Only show if tenant has opening arrears */}
                {tenant.openingArrears && tenant.openingArrears > 0 && totalBalanceDue > 0 && onSettleOpeningBalance && (
                    <Button
                        variant="brand-success"
                        size="brand"
                        onClick={async (e) => {
                            e.stopPropagation();
                            setIsSettling(true);
                            try {
                                await onSettleOpeningBalance(tenant.id);
                            } finally {
                                setIsSettling(false);
                            }
                        }}
                        disabled={isSettling}
                        className="w-full rounded-2xl"
                    >
                        {isSettling ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                SETTLING...
                            </>
                        ) : (
                            <>
                                <CheckCircle className="w-4 h-4" />
                                MARK OPENING BALANCE AS PAID
                            </>
                        )}
                    </Button>
                )}

                {/* Issue Notice Button - Available from Day 1 (Section 56), Day 5 (Section 55), Day 21 (Termination) */}
                {daysOverdue >= 1 && (
                    <Button
                        variant="brand-secondary"
                        size="brand"
                        onClick={(e) => {
                            e.stopPropagation();
                            console.log('📋 Eligible legal actions:', eligibleActions);
                            console.log('📊 Days overdue (calendar):', daysOverdue);
                            console.log('⚖️ Working days overdue:', workingDaysOverdue);
                            // TODO: Open notice selector modal with context-aware options:
                            // - Day 1+: Section 56 (14-Day Notice to Remedy)
                            // - Day 5+ (working): Section 55 (Strike Notice)
                            // - Day 21+ (calendar): Termination Application
                        }}
                        className={cn(
                            "w-full rounded-2xl",
                            daysOverdue >= 21 && "hover:border-[#FF3B3B] hover:text-[#FF3B3B] hover:shadow-[0_0_12px_rgba(255,59,59,0.3)]",
                            daysOverdue < 21 && workingDaysOverdue >= 5 && "hover:border-[#FFB800] hover:text-[#FFB800] hover:shadow-[0_0_12px_rgba(255,184,0,0.3)]"
                        )}
                    >
                        <FileWarning className="w-4 h-4" />
                        ISSUE NOTICE
                    </Button>
                )}
            </div>

            <SmartPaymentModal
                open={isPaymentModalOpen}
                onOpenChange={setIsPaymentModalOpen}
                tenant={tenant}
                onConfirmPayment={handleConfirmPayment}
                suggestedMatch={suggestedMatch}
            />
        </div>
    )
}
