"use client"

import { Tenant, RentPayment } from "@/types"
import { cn } from "@/lib/utils"
import { useState } from "react"
import { CheckCircle, MoreHorizontal, Receipt, FileWarning, Loader2, Gavel, AlertTriangle, Clock, Info, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SmartPaymentModal } from "./SmartPaymentModal"
import { StrikeBar } from "./StrikeBar"
import { formatFrequencyLabel } from "@/lib/status-engine"
import { NoticePreview } from "@/components/notices/NoticePreview"
import type { TenantStatusResult } from "@/lib/status-calculator"
import type { NoticeType } from "@/lib/legal-engine"
import type { NZRegion } from "@/lib/nz-holidays"
import { format } from "date-fns"

interface TenantCardProps {
    tenant: Tenant;
    status: TenantStatusResult;
    payments: RentPayment[];
    propertyId: string;
    propertyAddress: string;
    region: NZRegion;
    suggestedMatch?: { amount: number; date: string; reference?: string; confidence: number } | null;
    onRecordPayment: (tenantId: string, amount: number, date: string) => Promise<void>;
    onVoidPayment?: (tenantId: string, paymentId: string) => Promise<void>;
    onSettings: () => void;
    onSettleOpeningBalance?: (tenantId: string) => Promise<void>;
    onNoticeSent?: () => Promise<void>;
    testDate?: Date;
}

export function TenantCard({
    tenant,
    status,
    payments,
    propertyId,
    propertyAddress,
    region,
    suggestedMatch,
    onRecordPayment,
    onVoidPayment,
    onSettings,
    onSettleOpeningBalance,
    onNoticeSent,
    testDate,
}: TenantCardProps) {
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [isSettling, setIsSettling] = useState(false);
    const [noticeModalOpen, setNoticeModalOpen] = useState(false);
    const [noticeType, setNoticeType] = useState<NoticeType>("S55_STRIKE");
    const [noticeStrikeNumber, setNoticeStrikeNumber] = useState<number | undefined>(undefined);

    const openNoticePreview = (type: NoticeType, strikeNum?: number) => {
        setNoticeType(type);
        setNoticeStrikeNumber(strikeNum);
        setNoticeModalOpen(true);
    };

    const handleNoticeSent = async (noticeId: string) => {
        setNoticeModalOpen(false);
        if (onNoticeSent) {
            await onNoticeSent();
        }
    };

    // All values from the unified status calculator - NO local calculations
    const { severity, strikes, notices, displayText, rentState, workingDaysOverdue } = status;
    const totalBalanceDue = rentState.currentBalance;
    const daysOverdue = rentState.daysOverdue;

    // 14-day notice countdown logic
    const get14DayNoticeStatus = () => {
        if (!tenant.remedyNoticeSentAt) return null;
        const osd = new Date(tenant.remedyNoticeSentAt);
        const effectiveDate = testDate || new Date();
        const expiryDate = new Date(osd);
        expiryDate.setDate(expiryDate.getDate() + 14);
        const daysRemaining = Math.ceil((expiryDate.getTime() - effectiveDate.getTime()) / (1000 * 60 * 60 * 24));

        if (daysRemaining > 0) {
            return { status: 'active' as const, daysRemaining };
        } else if (totalBalanceDue > 0) {
            return { status: 'expired_unremedied' as const, daysRemaining: 0 };
        } else {
            return { status: 'remedied' as const, daysRemaining: 0 };
        }
    };
    const remedyStatus = get14DayNoticeStatus();

    const handleConfirmPayment = async (amount: number, date: string) => {
        await onRecordPayment(tenant.id, amount, date);
    };

    const handleVoidPayment = async (paymentId: string) => {
        if (onVoidPayment) {
            await onVoidPayment(tenant.id, paymentId);
        }
    };

    // Card glow based on severity tier
    const getCardStyle = (): React.CSSProperties => {
        const baseStyle: React.CSSProperties = {};

        if (severity.tierName === 'RED_BREATHING_TERMINATION' || severity.tierName === 'RED_SOLID_STRIKE') {
            baseStyle.boxShadow = '0 0 20px rgba(255, 59, 59, 0.3)';
        } else if (severity.tierName === 'GOLD_SOLID') {
            baseStyle.boxShadow = '0 0 15px rgba(251, 191, 36, 0.25)';
        } else if (severity.tierName === 'AMBER_OUTLINE') {
            baseStyle.borderColor = 'rgba(217, 119, 6, 0.5)';
            baseStyle.boxShadow = '0 0 15px rgba(217, 119, 6, 0.2)';
        }

        return baseStyle;
    };

    return (
        <div
            className="rounded-[2rem] p-6 flex flex-col font-sans transition-all duration-300 bg-white/5 backdrop-blur-xl border border-white/10"
            style={getCardStyle()}
        >
            {/* SECTION 1: Tenant Identity Header */}
            <div className="flex justify-between items-start mb-3">
                <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-white/10 border border-white/20 rounded-xl flex items-center justify-center font-black text-white/60 text-sm shrink-0">
                        {tenant.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                        <h4 className="text-2xl font-bold text-white tracking-tight leading-tight">
                            {tenant.name}
                        </h4>
                    </div>
                </div>

                <button
                    onClick={(e) => { e.stopPropagation(); onSettings(); }}
                    className="text-white/30 hover:text-white transition-colors mt-1 shrink-0"
                >
                    <MoreHorizontal className="w-6 h-6" />
                </button>
            </div>

            {/* SECTION 2: Strike Bar */}
            <StrikeBar
                strikes={strikes.activeStrikes}
                glow={workingDaysOverdue >= 5}
                maxStrikes={3}
                className="mb-3"
                canIssueNextStrike={strikes.canIssueStrike}
                windowExpiryDate={strikes.windowExpiryDate || undefined}
                effectiveDate={testDate}
            />

            {/* SECTION 3: Unified Ledger Line */}
            <p className="text-[13px] font-mono tracking-tight mb-6 whitespace-nowrap overflow-hidden text-ellipsis tabular-nums">
                <span style={{ color: '#94A3B8' }}>${tenant.rentAmount}/{formatFrequencyLabel(tenant.frequency)}</span>
                <span className="text-white/20 mx-1.5">•</span>
                {totalBalanceDue > 0 ? (
                    <>
                        {daysOverdue >= 1 ? (
                            <>
                                <span style={{ color: severity.color }}>
                                    {displayText.primary}
                                </span>
                                <span className="text-white/20 mx-1.5">•</span>
                                <span style={{ color: severity.color }} className="font-bold">
                                    {displayText.secondary}
                                </span>
                            </>
                        ) : (
                            <span style={{ color: severity.color }} className="font-bold">
                                Current balance: ${totalBalanceDue.toFixed(2)}
                            </span>
                        )}
                    </>
                ) : (
                    <span style={{ color: severity.color, opacity: 0.7 }}>
                        {displayText.primary || 'No payments recorded'}
                    </span>
                )}
            </p>

            {/* SECTION 4: Legal Action Banner */}
            {severity.tierName !== 'GREEN' && (
                <>
                    {severity.tierName === 'RED_BREATHING_TERMINATION' ? (
                        <div
                            className="rounded-2xl px-4 py-3 mb-3 backdrop-blur-md border luminance-breathing"
                            style={{ backgroundColor: 'rgba(255, 59, 59, 0.1)', borderColor: '#FF3B3B' }}
                        >
                            <div className="flex items-center gap-3 mb-2">
                                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'rgba(255, 59, 59, 0.2)' }}>
                                    <Gavel className="w-4 h-4" style={{ color: '#FF3B3B' }} />
                                </div>
                                <p className="text-[11px] font-bold uppercase tracking-wider tabular-nums" style={{ color: '#FF3B3B' }}>
                                    {severity.bannerText}
                                </p>
                            </div>
                            <p className="text-[10px] ml-11 tabular-nums" style={{ color: '#FF3B3B', opacity: 0.8 }}>
                                You can apply for termination now or continue with the Strike process.
                            </p>
                            <style dangerouslySetInnerHTML={{
                                __html: `
                                    @keyframes luminance-breathe {
                                        0%, 100% {
                                            border-opacity: 0.3;
                                            box-shadow: 0 0 12px -2px rgba(255, 59, 59, 0.25);
                                        }
                                        50% {
                                            border-opacity: 1;
                                            box-shadow: 0 0 20px 2px rgba(255, 59, 59, 0.6);
                                        }
                                    }
                                    .luminance-breathing {
                                        animation: luminance-breathe 3s ease-in-out infinite;
                                    }
                                `
                            }} />
                        </div>
                    ) : severity.tierName === 'RED_SOLID_STRIKE' ? (
                        <div
                            className="rounded-2xl px-4 py-3 mb-3 flex items-center gap-3 backdrop-blur-md border"
                            style={{ backgroundColor: 'rgba(255, 59, 59, 0.1)', borderColor: '#FF3B3B', boxShadow: '0 0 18px 1px rgba(255, 59, 59, 0.5)' }}
                        >
                            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'rgba(255, 59, 59, 0.2)' }}>
                                <Gavel className="w-4 h-4" style={{ color: '#FF3B3B' }} />
                            </div>
                            <p className="text-[11px] font-bold uppercase tracking-wider tabular-nums" style={{ color: '#FF3B3B' }}>
                                {severity.bannerText}
                            </p>
                        </div>
                    ) : severity.tierName === 'GOLD_SOLID' ? (
                        <div
                            className="rounded-2xl px-4 py-3 mb-3 flex items-center gap-3 backdrop-blur-md border"
                            style={{ backgroundColor: 'rgba(251, 191, 36, 0.1)', borderColor: '#FBBF24', boxShadow: '0 0 15px -2px rgba(251, 191, 36, 0.4)' }}
                        >
                            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'rgba(251, 191, 36, 0.2)' }}>
                                <AlertTriangle className="w-4 h-4" style={{ color: '#FBBF24' }} />
                            </div>
                            <p className="text-[11px] font-bold uppercase tracking-wider tabular-nums" style={{ color: '#FBBF24' }}>
                                {severity.bannerText}
                            </p>
                        </div>
                    ) : severity.tierName === 'AMBER_OUTLINE' ? (
                        <div
                            className="rounded-2xl px-4 py-3 mb-3 flex items-center gap-3 backdrop-blur-md border"
                            style={{ borderColor: '#D97706', backgroundColor: 'transparent' }}
                        >
                            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'rgba(217, 119, 6, 0.2)' }}>
                                <AlertTriangle className="w-4 h-4" style={{ color: '#D97706' }} />
                            </div>
                            <p className="text-[11px] font-bold uppercase tracking-wider tabular-nums" style={{ color: '#D97706' }}>
                                {severity.bannerText}
                            </p>
                        </div>
                    ) : null}
                </>
            )}

            {/* 14-Day Remedy Notice Countdown */}
            {remedyStatus && remedyStatus.status === 'active' && (
                <div className="rounded-xl px-3 py-2 mb-1 flex items-center gap-2 border" style={{ borderColor: '#D9770680', backgroundColor: 'rgba(217, 119, 6, 0.05)' }}>
                    <Clock className="w-3.5 h-3.5 shrink-0" style={{ color: '#D97706' }} />
                    <p className="text-[11px] font-bold tabular-nums" style={{ color: '#D97706' }}>
                        14-DAY NOTICE: {remedyStatus.daysRemaining} {remedyStatus.daysRemaining === 1 ? 'DAY' : 'DAYS'} REMAINING
                    </p>
                </div>
            )}
            {remedyStatus && remedyStatus.status === 'expired_unremedied' && (
                <div className="rounded-xl px-3 py-2 mb-1 flex items-center gap-2 border" style={{ borderColor: '#FF3B3B80', backgroundColor: 'rgba(255, 59, 59, 0.05)' }}>
                    <Gavel className="w-3.5 h-3.5 shrink-0" style={{ color: '#FF3B3B' }} />
                    <p className="text-[11px] font-bold tabular-nums" style={{ color: '#FF3B3B' }}>
                        14-DAY NOTICE EXPIRED — TERMINATION ELIGIBLE VIA S56
                    </p>
                </div>
            )}

            {/* SECTION 5: Action Buttons */}
            <div className="flex flex-col gap-3">
                {severity.tierName === 'RED_BREATHING_TERMINATION' ? (
                    <>
                        <Button
                            size="brand"
                            onClick={(e) => {
                                e.stopPropagation();
                                openNoticePreview("S55_21DAYS");
                            }}
                            className="w-full rounded-2xl transition-all tabular-nums border-2"
                            style={{
                                backgroundColor: '#FF3B3B',
                                borderColor: '#FF3B3B',
                                color: '#FFFFFF'
                            }}
                        >
                            <Gavel className="w-4 h-4" />
                            APPLY FOR TERMINATION
                        </Button>

                        <div className="flex flex-col sm:flex-row gap-3">
                            <Button
                                variant={totalBalanceDue > 0 ? "brand" : "brand-success"}
                                size="brand"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsPaymentModalOpen(true);
                                }}
                                className="flex-1 rounded-2xl"
                            >
                                {totalBalanceDue > 0 ? (
                                    <>
                                        <Receipt className="w-4 h-4" />
                                        RECORD PAYMENT
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle className="w-4 h-4" />
                                        VIEW LEDGER
                                    </>
                                )}
                            </Button>

                            {(severity.strikeCount ?? 0) < 3 && strikes.canIssueStrike && strikes.nextStrikeNumber && (() => {
                                const nextStrike = strikes.nextStrikeNumber!;
                                const strikeLabel = nextStrike === 1 ? 'STRIKE 1' : nextStrike === 2 ? 'STRIKE 2' : 'STRIKE 3';

                                return (
                                    <Button
                                        size="brand"
                                        variant={null as any}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            openNoticePreview("S55_STRIKE", nextStrike);
                                        }}
                                        className="flex-1 rounded-2xl transition-all tabular-nums bg-transparent border-2 font-black uppercase tracking-widest"
                                        style={{
                                            borderColor: 'rgba(255, 59, 59, 0.4)',
                                            color: 'rgba(255, 59, 59, 0.7)'
                                        }}
                                        title="Alternative path: Build strike history for stronger tribunal case"
                                    >
                                        <FileWarning className="w-4 h-4" style={{ opacity: 0.7 }} />
                                        ISSUE {strikeLabel}
                                    </Button>
                                );
                            })()}
                        </div>
                    </>
                ) : (
                    <div className="flex flex-col gap-3">
                        {/* Primary row: Payment + primary notice action */}
                        <div className="flex gap-3">
                            <Button
                                variant={totalBalanceDue > 0 ? "brand" : "brand-success"}
                                size="brand"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsPaymentModalOpen(true);
                                }}
                                className={cn(
                                    "rounded-2xl",
                                    severity.tierName !== 'GREEN' ? "flex-1" : "w-full"
                                )}
                            >
                                {totalBalanceDue > 0 ? (
                                    <>
                                        <Receipt className="w-4 h-4" />
                                        RECORD PAYMENT
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle className="w-4 h-4" />
                                        VIEW LEDGER
                                    </>
                                )}
                            </Button>

                            {/* Strike button — show when eligible */}
                            {strikes.canIssueStrike && strikes.nextStrikeNumber && (
                                <Button
                                    size="brand"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        openNoticePreview("S55_STRIKE", strikes.nextStrikeNumber!);
                                    }}
                                    className="flex-1 rounded-2xl transition-all tabular-nums bg-transparent border-2"
                                    style={{
                                        borderColor: `${severity.color}80`,
                                        color: severity.color
                                    }}
                                >
                                    <FileWarning className="w-4 h-4" />
                                    {severity.buttonText}
                                </Button>
                            )}

                            {/* If no strike eligible but amber tier, show remedy button in primary row */}
                            {!strikes.canIssueStrike && severity.tierName === 'AMBER_OUTLINE' && !notices.hasRemedyNotice && (
                                <Button
                                    size="brand"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        openNoticePreview("S56_REMEDY");
                                    }}
                                    className="flex-1 rounded-2xl transition-all tabular-nums bg-transparent border-2"
                                    style={{
                                        borderColor: `${severity.color}80`,
                                        color: severity.color
                                    }}
                                >
                                    <FileWarning className="w-4 h-4" />
                                    ISSUE 14-DAY NOTICE
                                </Button>
                            )}
                        </div>

                        {/* Secondary row: 14-Day Remedy button when Strike is also showing */}
                        {strikes.canIssueStrike && notices.canIssue14DayNotice && !notices.hasRemedyNotice && (
                            <div className="relative">
                                <Button
                                    size="brand"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        openNoticePreview("S56_REMEDY");
                                    }}
                                    className="w-full rounded-2xl transition-all tabular-nums bg-transparent border-2"
                                    style={{
                                        borderColor: '#D9770650',
                                        color: '#D97706'
                                    }}
                                >
                                    <FileWarning className="w-4 h-4" />
                                    ISSUE 14-DAY NOTICE TO REMEDY
                                </Button>
                                <div className="flex items-center gap-1 mt-1 ml-1">
                                    <Info className="w-3 h-3 text-white/30" />
                                    <span className="text-[9px] text-white/30">
                                        Sending both provides strongest protection under the RTA
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {(tenant.openingArrears ?? 0) > 0 && totalBalanceDue > 0 && onSettleOpeningBalance && (
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
            </div>

            <SmartPaymentModal
                open={isPaymentModalOpen}
                onOpenChange={setIsPaymentModalOpen}
                tenant={tenant}
                onConfirmPayment={handleConfirmPayment}
                onVoidPayment={handleVoidPayment}
                totalOutstandingBalance={totalBalanceDue}
                suggestedMatch={suggestedMatch}
            />

            {/* Notice Preview Modal */}
            {noticeModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setNoticeModalOpen(false)}>
                    <div onClick={(e) => e.stopPropagation()} className="max-h-[90vh] overflow-y-auto">
                        <NoticePreview
                            tenantId={tenant.id}
                            tenantName={tenant.name}
                            tenantEmail={tenant.email}
                            propertyId={propertyId}
                            propertyAddress={propertyAddress}
                            region={region}
                            noticeType={noticeType}
                            strikeNumber={noticeStrikeNumber}
                            rentDueDate={
                                noticeType === "S55_STRIKE" && strikes.nextStrikeableDueDate
                                    ? format(strikes.nextStrikeableDueDate, 'yyyy-MM-dd')
                                    : typeof rentState.oldestUnpaidDueDate === 'string'
                                        ? rentState.oldestUnpaidDueDate
                                        : undefined
                            }
                            rentAmount={tenant.rentAmount}
                            amountOwed={totalBalanceDue > 0 ? totalBalanceDue : undefined}
                            testDate={testDate}
                            onSendSuccess={handleNoticeSent}
                            onClose={() => setNoticeModalOpen(false)}
                        />
                    </div>
                </div>
            )}
        </div>
    )
}
