"use client"

import { Tenant, RentPayment } from "@/types"
import { cn } from "@/lib/utils"
import { useState } from "react"
import { CheckCircle, MoreHorizontal, Receipt, FileWarning, Loader2, Gavel, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SmartPaymentModal } from "./SmartPaymentModal"
import { StrikeBar } from "./StrikeBar"
import { format, parseISO, startOfDay, isBefore, differenceInCalendarDays, addWeeks, addMonths } from "date-fns"
import { toZonedTime } from "date-fns-tz"
import { formatFrequencyLabel } from "@/lib/status-engine"
import type { RentalLogicResult } from "@/hooks/useRentalLogic"

// NZ Timezone constant for consistent date handling
const NZ_TIMEZONE = "Pacific/Auckland";

/**
 * Calculates the first future due date by rolling forward from a base date.
 * If the calculated date is in the past, adds cycles until we find a future date.
 *
 * @param baseDate - The starting date to calculate from (usually last payment due date)
 * @param frequency - Payment frequency: Weekly, Fortnightly, or Monthly
 * @param today - Today's date (normalized to start of day)
 * @returns The first due date that is strictly in the future
 */
function findFirstFutureDueDate(
    baseDate: Date,
    frequency: "Weekly" | "Fortnightly" | "Monthly",
    today: Date
): Date {
    let nextDate = baseDate;

    // Roll forward until we find a date strictly after today
    while (!isBefore(today, nextDate)) {
        switch (frequency) {
            case "Weekly":
                nextDate = addWeeks(nextDate, 1);
                break;
            case "Fortnightly":
                nextDate = addWeeks(nextDate, 2);
                break;
            case "Monthly":
                nextDate = addMonths(nextDate, 1);
                break;
        }
    }

    return nextDate;
}

interface TenantCardProps {
    tenant: Tenant;
    legalStatus: RentalLogicResult;
    payments: RentPayment[];
    propertyId: string;
    suggestedMatch?: { amount: number; date: string; reference?: string; confidence: number } | null;
    onRecordPayment: (tenantId: string, amount: number, date: string) => Promise<void>;
    onVoidPayment?: (tenantId: string, paymentId: string) => Promise<void>;
    onSettings: () => void;
    onSettleOpeningBalance?: (tenantId: string) => Promise<void>; // Settlement action for backdated tenants
}

export function TenantCard({
    tenant,
    legalStatus,
    payments,
    suggestedMatch,
    onRecordPayment,
    onVoidPayment,
    onSettings,
    onSettleOpeningBalance,
}: TenantCardProps) {
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [isSettling, setIsSettling] = useState(false);

    // Extract values from legal status
    const {
        daysOverdue,
        workingDaysOverdue,
        totalBalanceDue,
        eligibleActions,
        activeStrikeCount, // Strike memory - persists even when paid (independent of arrears)
    } = legalStatus;

    // =========================================================================
    // DATE LOGIC: Determine tenant's payment status relative to today
    // =========================================================================
    // CRITICAL: Lock all date comparisons to NZ timezone (Pacific/Auckland)
    // This ensures status shifts correctly at 12:01 AM NZ time, not server time
    // toZonedTime converts UTC to NZ local, then startOfDay normalizes to midnight
    const todayNZ = toZonedTime(new Date(), NZ_TIMEZONE);
    const today = startOfDay(todayNZ);

    // Helper: Normalize a date string to start of day for comparison
    // Uses NZ timezone to ensure consistent date handling regardless of server location
    const normalizeDate = (dateStr: string): Date => {
        const parsed = parseISO(dateStr);
        const inNZ = toZonedTime(parsed, NZ_TIMEZONE);
        return startOfDay(inNZ);
    };

    // =========================================================================
    // PAYMENT CLASSIFICATION: Separate past, today, and future payments
    // =========================================================================

    // Get ALL unpaid/partial payments (regardless of date)
    const allUnpaidPayments = payments.filter(p =>
        p.status === 'Unpaid' || p.status === 'Partial'
    );

    // PAST: Unpaid payments with due date < today (MISSED)
    const missedPayments = allUnpaidPayments
        .filter(p => isBefore(normalizeDate(p.dueDate), today))
        .sort((a, b) => normalizeDate(a.dueDate).getTime() - normalizeDate(b.dueDate).getTime());

    // TRUE NEXT: Find first payment (any status) with due date > today
    // This is the actual next payment cycle regardless of payment status
    const trueNextPaymentFromDB = payments
        .filter(p => isBefore(today, normalizeDate(p.dueDate))) // dueDate > today (strictly future)
        .sort((a, b) => normalizeDate(a.dueDate).getTime() - normalizeDate(b.dueDate).getTime())[0];

    // =========================================================================
    // ROLLING NEXT DATE: If no future payment in DB, calculate mathematically
    // =========================================================================
    // This ensures we ALWAYS have a valid future date to display
    let calculatedNextDate: Date | null = null;

    if (!trueNextPaymentFromDB) {
        // No future payment in DB - calculate from most recent payment or oldest missed
        const mostRecentPayment = payments
            .sort((a, b) => normalizeDate(b.dueDate).getTime() - normalizeDate(a.dueDate).getTime())[0];

        if (mostRecentPayment) {
            // Roll forward from most recent payment until we find a future date
            calculatedNextDate = findFirstFutureDueDate(
                normalizeDate(mostRecentPayment.dueDate),
                tenant.frequency,
                today
            );
        }
    }

    // =========================================================================
    // DERIVED VALUES
    // =========================================================================

    const oldestMissedPayment = missedPayments[0];
    const missedPaymentCount = missedPayments.length;

    // HARD OVERRIDE: Force "Missed" if legal engine says we're overdue
    // This catches cases where payment array might be missing entries
    // CRITICAL: Legal engine data is source of truth for overdue status
    const legalEngineSaysOverdue = daysOverdue >= 1 && totalBalanceDue > 0;
    const hasMissedPayment = missedPaymentCount > 0 || legalEngineSaysOverdue;

    // Calculate exact days overdue from the OLDEST missed payment
    const calculatedDaysOverdue = oldestMissedPayment
        ? differenceInCalendarDays(today, normalizeDate(oldestMissedPayment.dueDate))
        : 0;

    // =========================================================================
    // DISPLAY DATES: What to show in the UI
    // =========================================================================

    // Missed date: Oldest unpaid payment in the past
    // Priority: 1) Actual payment record, 2) ANCHORED date from legal engine
    // CRITICAL: Uses firstMissedDueDate which is ANCHORED (does NOT float daily)
    const missedDate = oldestMissedPayment
        ? format(normalizeDate(oldestMissedPayment.dueDate), 'MMM d')
        : (legalEngineSaysOverdue && legalStatus.firstMissedDueDate)
            // No payment record but legal engine calculated the anchored first missed date
            ? format(parseISO(legalStatus.firstMissedDueDate), 'MMM d')
            : null;

    // True Next date: First payment cycle in the future
    // Priority: 1) Future payment from DB, 2) Calculated rolling date
    // CRITICAL: This MUST be a future date, never a past date
    const trueNextDate = trueNextPaymentFromDB
        ? format(normalizeDate(trueNextPaymentFromDB.dueDate), 'MMM d')
        : calculatedNextDate
            ? format(calculatedNextDate, 'MMM d')
            : null;

    // =========================================================================
    // SAFE DISPLAY VALUES: Guaranteed non-null strings for UI
    // =========================================================================
    // safeNextDate: Always a future date or placeholder
    const safeNextDate = trueNextDate || '-';
    // safeMissedDate: Oldest missed payment date (calculated from legal engine if no payment record)
    const safeMissedDate = missedDate || '-';

    // =========================================================================
    // EFFECTIVE DAYS OVERDUE (for unified ledger line)
    // =========================================================================
    // Use the GREATER of daysOverdue (from legal engine) or calculatedDaysOverdue (from UI)
    // This ensures the day count is always accurate even if one source lags behind
    // CRITICAL: This value updates every morning at 12:01 AM NZ time
    const effectiveDaysOverdue = Math.max(daysOverdue, calculatedDaysOverdue);

    // Handle payment confirmation from modal
    const handleConfirmPayment = async (amount: number, date: string) => {
        await onRecordPayment(tenant.id, amount, date);
    };

    // Handle voiding a payment
    const handleVoidPayment = async (paymentId: string) => {
        if (onVoidPayment) {
            await onVoidPayment(tenant.id, paymentId);
        }
    };

    // =========================================================================
    // SEVERITY TIER SYSTEM - SINGLE SOURCE OF TRUTH
    // =========================================================================
    type SeverityTier = 'GREEN' | 'AMBER_OUTLINE' | 'GOLD_SOLID' | 'RED_SOLID_STRIKE' | 'RED_BREATHING_TERMINATION';

    interface TenantSeverity {
        tier: SeverityTier;
        color: string;
        label: string;
        bannerText: string;
        buttonText: string;
        strikeCount?: number; // For dual-path termination logic
    }

    const getTenantSeverity = (): TenantSeverity => {
        // =====================================================================
        // 90-DAY ROLLING STRIKE WINDOW FILTER
        // =====================================================================
        // Calculate valid strikes within 90-day window from sentNotices
        const validStrikes = (tenant.sentNotices || []).filter(notice => {
            if (notice.type === 'REMEDY_NOTICE') return false; // Only count strike notices
            const sentDate = new Date(notice.officialServiceDate);
            const daysSinceSent = Math.floor((new Date().getTime() - sentDate.getTime()) / (1000 * 60 * 60 * 24));
            return daysSinceSent >= 0 && daysSinceSent <= 90; // Valid if 0-90 days old
        });

        const strikeCount = validStrikes.length;

        // CRITICAL: Use activeStrikeCount from legal engine as backup/verification
        // Legal engine already filters by 90-day window
        const validStrikeCount = Math.max(strikeCount, activeStrikeCount);

        // =====================================================================
        // STRICT SEVERITY HIERARCHY - HIGHEST PRIORITY FIRST
        // =====================================================================

        // TIER 0 (Paid): totalBalanceDue <= 0
        if (totalBalanceDue <= 0) {
            return {
                tier: 'GREEN',
                color: '#22C55E',
                label: 'Paid',
                bannerText: '',
                buttonText: ''
            };
        }

        // =====================================================================
        // PRIORITY 1 (Tier 5 - Breathing Red): RTA TERMINATION ELIGIBLE
        // =====================================================================
        // ROUTE 1: Section 55(1)(a) - 21+ calendar days overdue
        // ROUTE 2: Section 55(1)(aa) - Three strikes within 90-day window
        if (daysOverdue >= 21 || validStrikeCount >= 3) {
            return {
                tier: 'RED_BREATHING_TERMINATION',
                color: '#FF3B3B',
                label: 'Termination',
                bannerText: validStrikeCount >= 3
                    ? 'TERMINATION ELIGIBLE (3 STRIKES - 90-DAY WINDOW)'
                    : `TERMINATION ELIGIBLE (TRIBUNAL READY) - ${daysOverdue} DAYS OVERDUE`,
                buttonText: 'APPLY FOR TERMINATION',
                strikeCount: validStrikeCount // Pass strike count for dual button logic
            };
        }

        // =====================================================================
        // PRIORITY 2 (Tier 3/4 - Static Red): SEQUENTIAL STRIKE ESCALATION
        // CRITICAL: Once 10+ days overdue, STAYS RED regardless of user inaction
        // =====================================================================

        // -----------------------------------------------------------------------
        // RED TIER - 15+ DAYS: Strike 3 Zone (Must catch up on previous notices)
        // -----------------------------------------------------------------------
        if (workingDaysOverdue >= 15) {
            // Case 1: Strike 2 active, ready for Strike 3
            if (validStrikeCount === 2) {
                return {
                    tier: 'RED_SOLID_STRIKE',
                    color: '#FF3B3B',
                    label: 'Strike 3 Ready',
                    bannerText: `STRIKE 3 READY (90-DAY WINDOW ACTIVE) - ${workingDaysOverdue} WORKING DAYS OVERDUE`,
                    buttonText: 'ISSUE STRIKE 3 NOTICE'
                };
            }

            // Case 2: Strike 1 sent, missing Strike 2
            if (validStrikeCount === 1) {
                return {
                    tier: 'RED_SOLID_STRIKE',
                    color: '#FF3B3B',
                    label: 'Strike 3 Ready',
                    bannerText: 'STRIKE 3 READY (ISSUE STRIKE 2 NOTICE FIRST)',
                    buttonText: 'ISSUE STRIKE 2 NOTICE'
                };
            }

            // Case 3: No strikes sent yet - missing both Strike 1 & 2
            if (validStrikeCount === 0) {
                return {
                    tier: 'RED_SOLID_STRIKE',
                    color: '#FF3B3B',
                    label: 'Strike 3 Ready',
                    bannerText: 'STRIKE 3 READY (ISSUE STRIKE 1 & 2 FIRST)',
                    buttonText: 'ISSUE STRIKE 1 NOTICE'
                };
            }
        }

        // -----------------------------------------------------------------------
        // RED TIER - 10-14 DAYS: Strike 2 Zone (Sequential send-first logic)
        // -----------------------------------------------------------------------
        if (workingDaysOverdue >= 10) {
            // Case 1: Strike 1 active, ready for Strike 2
            if (validStrikeCount === 1) {
                return {
                    tier: 'RED_SOLID_STRIKE',
                    color: '#FF3B3B',
                    label: 'Strike 2 Ready',
                    bannerText: `STRIKE 2 NOTICE READY - ${workingDaysOverdue} WORKING DAYS OVERDUE`,
                    buttonText: 'ISSUE STRIKE 2 NOTICE'
                };
            }

            // Case 2: No strikes sent yet - MUST send Strike 1 first
            // CRITICAL: This prevents dropping back to Gold when user hasn't acted
            if (validStrikeCount === 0) {
                return {
                    tier: 'RED_SOLID_STRIKE',
                    color: '#FF3B3B',
                    label: 'Strike 2 Ready',
                    bannerText: 'STRIKE 2 READY (SEND STRIKE 1 NOTICE FIRST)',
                    buttonText: 'ISSUE STRIKE 1 NOTICE'
                };
            }
        }

        // =====================================================================
        // PRIORITY 3 (Tier 2 - Gold): STRIKE 1 ELIGIBLE (5-9 working days)
        // =====================================================================
        if (workingDaysOverdue >= 5 && workingDaysOverdue < 10 && validStrikeCount === 0) {
            return {
                tier: 'GOLD_SOLID',
                color: '#FBBF24',
                label: 'Strike 1 Ready',
                bannerText: `STRIKE 1 NOTICE READY - ${workingDaysOverdue} WORKING DAYS OVERDUE`,
                buttonText: 'ISSUE STRIKE 1'
            };
        }

        // =====================================================================
        // PRIORITY 4 (Tier 1 - Amber): OVERDUE (1-4 working days)
        // =====================================================================
        // CRITICAL: This tier only applies when no strikes have been sent yet
        // Once 5+ days overdue, strike logic takes priority even if remedy notice was never sent
        if (workingDaysOverdue >= 1 && workingDaysOverdue < 5 && validStrikeCount === 0) {
            // Check if remedy notice has been sent
            const hasRemedyNotice = tenant.remedyNoticeSentAt !== null && tenant.remedyNoticeSentAt !== undefined;

            return {
                tier: 'AMBER_OUTLINE',
                color: '#D97706',
                label: 'Overdue',
                bannerText: hasRemedyNotice ? 'REMEDY NOTICE SENT - MONITORING' : '14-DAY NOTICE TO REMEDY READY',
                buttonText: hasRemedyNotice ? 'VIEW NOTICE' : 'ISSUE NOTICE'
            };
        }

        // Default fallback (should never reach)
        return {
            tier: 'GREEN',
            color: '#22C55E',
            label: 'Paid',
            bannerText: '',
            buttonText: ''
        };
    };

    const severity = getTenantSeverity();

    // Determine card glow based on severity tier
    const getCardStyle = (): React.CSSProperties => {
        const baseStyle: React.CSSProperties = {};

        if (severity.tier === 'RED_BREATHING_TERMINATION' || severity.tier === 'RED_SOLID_STRIKE') {
            // Red glow for all red tiers
            baseStyle.boxShadow = '0 0 20px rgba(255, 59, 59, 0.3)';
        } else if (severity.tier === 'GOLD_SOLID') {
            // Gold glow for Strike 1 Eligible
            baseStyle.boxShadow = '0 0 15px rgba(251, 191, 36, 0.25)';
        } else if (severity.tier === 'AMBER_OUTLINE') {
            // Amber glow for Tier 1
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
                    {/* Avatar - Glass Style */}
                    <div className="w-12 h-12 bg-white/10 border border-white/20 rounded-xl flex items-center justify-center font-black text-white/60 text-sm shrink-0">
                        {tenant.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                        {/* Name - Extra Large Bold White (increased to text-2xl) */}
                        <h4 className="text-2xl font-bold text-white tracking-tight leading-tight">
                            {tenant.name}
                        </h4>
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

            {/* SECTION 2: Strike Bar - Positioned between Name and Ledger Line */}
            {/* CRITICAL: Use activeStrikeCount for UI (strike memory persists even when paid) */}
            {/* INDEPENDENT STATE MACHINE: Each pill determines its own state based on workingDaysOverdue */}
            <StrikeBar
                strikes={activeStrikeCount}
                glow={workingDaysOverdue >= 5}
                maxStrikes={3}
                className="mb-3"
                windowExpiryDate={legalStatus.legalAnalysis.analysis.windowExpiryDate}
                workingDaysOverdue={workingDaysOverdue}
            />

            {/* SECTION 3: Unified Ledger Line - Inherits Banner Color */}
            {/* Format: $Rent/Freq • [Days] days overdue since [Date] • $Amount outstanding */}
            {/* CRITICAL: $Rent/Freq is ALWAYS #94A3B8 (Slate-400), everything after first dot matches tier color */}
            <p className="text-[13px] font-mono tracking-tight mb-6 whitespace-nowrap overflow-hidden text-ellipsis tabular-nums">
                {/* Rent/Freq prefix - Always Slate-400 #94A3B8 */}
                <span style={{ color: '#94A3B8' }}>${tenant.rentAmount}/{formatFrequencyLabel(tenant.frequency)}</span>
                {/* Middle dot separator with tight padding */}
                <span className="text-white/20 mx-1.5">•</span>
                {hasMissedPayment ? (
                    <>
                        {/* Overdue segment - Matches Severity Tier Color */}
                        <span style={{ color: severity.color }}>
                            {effectiveDaysOverdue} day{effectiveDaysOverdue !== 1 ? 's' : ''} overdue since {safeMissedDate}
                        </span>
                        <span className="text-white/20 mx-1.5">•</span>
                        <span style={{ color: severity.color }} className="font-bold">
                            ${totalBalanceDue.toFixed(2)} outstanding
                        </span>
                    </>
                ) : (
                    /* Paid state - Green */
                    <span style={{ color: severity.color, opacity: 0.7 }}>
                        Paid until {safeNextDate}
                    </span>
                )}
            </p>

            {/* SECTION 4: Legal Action Banner - Tier-Based Rendering */}
            {/* CRITICAL: Uses severity helper as single source of truth */}
            {severity.tier !== 'GREEN' && (
                <>
                    {severity.tier === 'RED_BREATHING_TERMINATION' ? (
                        // TIER 5: CRITICAL (21+ days OR 3+ strikes) - Red Glass + Luminance Breathing + Dual Path Messaging
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
                            {/* Helper text for dual-path explanation */}
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
                    ) : severity.tier === 'RED_SOLID_STRIKE' ? (
                        // TIERS 3-4: STRIKE 2/3 READY (1-2 strikes active) - Red Glass + Static Glow (NO ANIMATION)
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
                    ) : severity.tier === 'GOLD_SOLID' ? (
                        // TIER 2: STRIKE 1 ELIGIBLE (5+ working days, no strikes) - Gold Glass + Static Glow
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
                    ) : severity.tier === 'AMBER_OUTLINE' ? (
                        // TIER 1: OVERDUE (1-4 days, no strikes) - Amber Outline Only (NO glass fill, NO glow)
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

            {/* SECTION 5: Action Buttons - Vertical Stack for Tier 5, Horizontal for Others */}
            <div className="flex flex-col gap-3">
                {severity.tier === 'RED_BREATHING_TERMINATION' ? (
                    // TIER 5 VERTICAL LAYOUT: Termination button on top, then Payment + Strike side-by-side
                    <>
                        {/* Primary: Apply for Termination - Full Width on Top */}
                        <Button
                            size="brand"
                            onClick={(e) => {
                                e.stopPropagation();
                                // TODO: Trigger termination application flow with evidence modal
                                console.log('🏛️ TERMINATION: Applying for Tenancy Tribunal termination');
                                console.log('📂 Evidence folder ready with ledger snapshots and notices');
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

                        {/* Secondary Row: Record Payment + Issue Strike (Side-by-side on desktop, stacked on mobile) */}
                        <div className="flex flex-col sm:flex-row gap-3">
                            {/* Record Payment Button */}
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

                            {/* Issue Next Strike - Red Outline (Only if < 3 strikes) */}
                            {(severity.strikeCount ?? 0) < 3 && (() => {
                                const nextStrike = (severity.strikeCount ?? 0) + 1;
                                const strikeLabel = nextStrike === 1 ? 'STRIKE 1' : nextStrike === 2 ? 'STRIKE 2' : 'STRIKE 3';
                                return (
                                    <Button
                                        size="brand"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            console.log(`📋 STRIKE ${nextStrike}: Continuing strike process as backup`);
                                            console.log('🎯 Current strikes:', severity.strikeCount);
                                        }}
                                        className="flex-1 rounded-2xl transition-all tabular-nums bg-transparent border-2"
                                        style={{
                                            borderColor: '#FF3B3B',
                                            color: '#FF3B3B'
                                        }}
                                    >
                                        <FileWarning className="w-4 h-4" />
                                        ISSUE {strikeLabel}
                                    </Button>
                                );
                            })()}
                        </div>
                    </>
                ) : (
                    // ALL OTHER TIERS: Standard horizontal layout
                    <div className="flex gap-3">
                        {/* Record Payment Button - Expands to fill if Issue Notice is hidden */}
                        <Button
                            variant={totalBalanceDue > 0 ? "brand" : "brand-success"}
                            size="brand"
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsPaymentModalOpen(true);
                            }}
                            className={cn(
                                "rounded-2xl",
                                severity.tier !== 'GREEN' ? "flex-1" : "w-full"
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

                        {/* Issue Notice Button - Single button for all non-Tier-5 states */}
                        {severity.tier !== 'GREEN' && (
                            <Button
                                size="brand"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    console.log('📋 Eligible legal actions:', eligibleActions);
                                    console.log('📊 Legal Status:', legalStatus.status);
                                    console.log('⚖️ Working days overdue:', workingDaysOverdue);
                                    console.log('🎯 Active strikes:', activeStrikeCount);
                                }}
                                className="flex-1 rounded-2xl transition-all tabular-nums bg-transparent border-2"
                                style={{
                                    borderColor: `${severity.color}80`, // 50% opacity on border
                                    color: severity.color
                                }}
                            >
                                <FileWarning className="w-4 h-4" />
                                {severity.buttonText}
                            </Button>
                        )}
                    </div>
                )}

                {/* Secondary Row: Settlement Button (Only if tenant has opening arrears) */}
                {/* FIX: Use > 0 check only to avoid rendering "0" when openingArrears === 0 */}
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
        </div>
    )
}
