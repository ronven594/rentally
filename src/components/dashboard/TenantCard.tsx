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

// Import NZ_TIMEZONE from unified date-utils module (single source of truth)
import { NZ_TIMEZONE } from "@/lib/date-utils"

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
    testDate?: Date; // Test/simulation date override - falls back to real-world date if not provided
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
    testDate,
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
    // PRODUCTION-READY: Uses testDate for simulation if provided, otherwise defaults to real-world date
    const effectiveDate = testDate || new Date();
    const todayNZ = toZonedTime(effectiveDate, NZ_TIMEZONE);
    const today = startOfDay(todayNZ);

    // DIAGNOSTIC: Log effective date to verify centralized date awareness
    console.log('📅 TENANT CARD - EFFECTIVE DATE:', {
        tenantName: tenant.name,
        testDateProvided: testDate ? format(testDate, 'yyyy-MM-dd HH:mm:ss') : 'None (using real-world date)',
        effectiveDate: format(effectiveDate, 'yyyy-MM-dd HH:mm:ss'),
        todayNormalized: format(today, 'yyyy-MM-dd'),
        isSimulationMode: !!testDate
    });

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

    // DIAGNOSTIC: Log ALL payments first to see what we're working with
    // CRITICAL: Check if due_date has been corrupted to payment_date
    console.log('🔍 TENANT CARD - ALL PAYMENTS (raw from database):', {
        tenantName: tenant.name,
        today: format(today, 'yyyy-MM-dd'),
        frequency: tenant.frequency,
        rentDueDay: tenant.rentDueDay,
        totalPaymentsCount: payments.length,
        allPayments: payments.map(p => ({
            id: p.id,
            dueDate: p.dueDate,
            paidDate: p.paidDate,
            status: p.status,
            amount: p.amount,
            amountPaid: p.amount_paid,
            isPartial: p.status === 'Partial',
            isUnpaid: p.status === 'Unpaid',
            willBeIncluded: p.status === 'Unpaid' || p.status === 'Partial',
            // CRITICAL: Detect if due_date was corrupted to match paid_date
            dueDateMatchesPaidDate: p.paidDate && p.dueDate === p.paidDate ? '⚠️ CORRUPTED!' : 'OK',
            // For monthly: check if due_date day matches rentDueDay
            dueDateDay: tenant.frequency === 'Monthly' ? parseInt(p.dueDate.substring(8, 10)) : 'N/A',
            expectedDay: tenant.frequency === 'Monthly' ? tenant.rentDueDay : 'N/A'
        }))
    });

    // Get ALL unpaid/partial payments (regardless of date)
    const allUnpaidPayments = payments.filter(p =>
        p.status === 'Unpaid' || p.status === 'Partial'
    );

    // Check for duplicate months (would indicate corrupted data)
    const monthCounts = new Map<string, number>();
    allUnpaidPayments.forEach(p => {
        const month = p.dueDate.substring(0, 7); // YYYY-MM
        monthCounts.set(month, (monthCounts.get(month) || 0) + 1);
    });
    const duplicateMonths = Array.from(monthCounts.entries()).filter(([_, count]) => count > 1);

    // =========================================================================
    // ORPHANED RECORD DETECTION: Check for setting misalignment
    // =========================================================================
    // Detect when payment records have due_dates that don't match current tenant settings
    // This happens when:
    // 1. rentDueDay changed (e.g., 30th → 1st for Monthly)
    // 2. frequency changed (e.g., Weekly → Fortnightly)
    // 3. rentDueDay changed day-of-week (e.g., Wednesday → Friday for Weekly)

    const orphanedRecords: Array<{ dueDate: string; issue: string }> = [];

    allUnpaidPayments.forEach(p => {
        const dueDate = parseISO(p.dueDate);

        if (tenant.frequency === 'Monthly') {
            // For Monthly: Check if day-of-month matches current rentDueDay
            const actualDayOfMonth = dueDate.getDate();
            const expectedDayOfMonth = parseInt(tenant.rentDueDay, 10) || 1;

            // Account for month-end snapping (e.g., Feb 28 for rentDueDay=31)
            const lastDayOfMonth = new Date(dueDate.getFullYear(), dueDate.getMonth() + 1, 0).getDate();
            const effectiveExpectedDay = Math.min(expectedDayOfMonth, lastDayOfMonth);

            if (actualDayOfMonth !== effectiveExpectedDay) {
                orphanedRecords.push({
                    dueDate: p.dueDate,
                    issue: `Monthly day mismatch: Record has day ${actualDayOfMonth}, current setting is ${tenant.rentDueDay}`
                });
            }
        } else {
            // For Weekly/Fortnightly: Check if day-of-week matches current rentDueDay
            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const actualDayName = dayNames[dueDate.getDay()];

            if (actualDayName !== tenant.rentDueDay) {
                orphanedRecords.push({
                    dueDate: p.dueDate,
                    issue: `${tenant.frequency} day mismatch: Record is ${actualDayName}, current setting is ${tenant.rentDueDay}`
                });
            }
        }
    });

    console.log('🔍 TENANT CARD - AFTER UNPAID/PARTIAL FILTER:', {
        tenantName: tenant.name,
        allUnpaidCount: allUnpaidPayments.length,
        duplicateMonthsDetected: duplicateMonths.length > 0 ? `⚠️ ${duplicateMonths.map(([m, c]) => `${m}: ${c} records`).join(', ')}` : 'None',
        orphanedRecordsDetected: orphanedRecords.length > 0 ? `⚠️ ${orphanedRecords.length} record(s) don't match current settings` : 'None - All records align with current settings',
        orphanedRecordDetails: orphanedRecords.length > 0 ? orphanedRecords : 'N/A',
        filteredPayments: allUnpaidPayments.map(p => ({
            id: p.id,
            dueDate: p.dueDate,
            status: p.status,
            amountPaid: p.amount_paid,
            normalizedDueDate: format(normalizeDate(p.dueDate), 'yyyy-MM-dd'),
            isBeforeTodayCheck: isBefore(normalizeDate(p.dueDate), today),
            todayForComparison: format(today, 'yyyy-MM-dd')
        }))
    });

    // PAST: Unpaid payments with due date < today (MISSED)
    const missedPayments = allUnpaidPayments
        .filter(p => isBefore(normalizeDate(p.dueDate), today))
        .sort((a, b) => normalizeDate(a.dueDate).getTime() - normalizeDate(b.dueDate).getTime());

    // =========================================================================
    // PAID UNTIL DATE: Find most recent payment with a paidDate
    // =========================================================================
    // CRITICAL: This is the "coverage-first" logic - shows when tenant is PAID UNTIL
    // NOT when next rent is DUE (fixes "The Arrears Trap")
    const mostRecentPaidPayment = payments
        .filter(p => p.paidDate != null) // Only payments that have been paid
        .sort((a, b) => parseISO(b.paidDate!).getTime() - parseISO(a.paidDate!).getTime())[0]; // Most recent first

    // FUTURE: Upcoming unpaid payments (for "Paid Until" fallback when no payments made yet)
    const upcomingPayments = allUnpaidPayments
        .filter(p => !isBefore(normalizeDate(p.dueDate), today)) // Due date >= today
        .sort((a, b) => normalizeDate(a.dueDate).getTime() - normalizeDate(b.dueDate).getTime());

    const nextUpcomingPayment = upcomingPayments[0];

    // =========================================================================
    // DERIVED VALUES
    // =========================================================================

    const oldestMissedPayment = missedPayments[0];
    const missedPaymentCount = missedPayments.length;

    console.log('🔍 TENANT CARD - Payment Classification:', {
        tenantName: tenant.name,
        today: format(today, 'yyyy-MM-dd'),
        allPaymentsCount: payments.length,
        allUnpaidCount: allUnpaidPayments.length,
        missedPaymentsCount: missedPaymentCount,
        allUnpaidPayments: allUnpaidPayments.map(p => ({
            dueDate: p.dueDate,
            status: p.status,
            amount: p.amount,
            amountPaid: p.amount_paid,
            paidDate: p.paidDate,
            isBeforeToday: isBefore(normalizeDate(p.dueDate), today)
        })),
        oldestMissedPayment: oldestMissedPayment ? {
            dueDate: oldestMissedPayment.dueDate,
            status: oldestMissedPayment.status
        } : null
    });

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

    // =========================================================================
    // OVERDUE SINCE ANCHOR: Must use DUE_DATE, not PAID_DATE
    // =========================================================================
    // Missed date: Oldest unpaid payment in the past
    // Priority: 1) Actual payment record's DUE_DATE (from database)
    // Priority: 2) ANCHORED date from legal engine (from database-driven calculation)
    // CRITICAL: Uses firstMissedDueDate which is ANCHORED (does NOT float daily)
    //
    // CRITICAL FIX: This must ALWAYS use due_date, never paid_date
    // The "overdue since" anchor is when the rent was DUE, not when payment was made
    const missedDate = oldestMissedPayment
        ? format(normalizeDate(oldestMissedPayment.dueDate), 'MMM d')
        : (legalEngineSaysOverdue && legalStatus.firstMissedDueDate)
            // No payment record but legal engine calculated the anchored first missed date
            ? format(parseISO(legalStatus.firstMissedDueDate), 'MMM d')
            : null;

    console.log('🔍 TENANT CARD - Overdue Since Anchor (Must Be Due Date):', {
        tenantName: tenant.name,
        oldestMissedPaymentExists: !!oldestMissedPayment,
        oldestMissedPayment_DUE_DATE: oldestMissedPayment?.dueDate,
        oldestMissedPayment_PAID_DATE: oldestMissedPayment?.paidDate,
        VERIFICATION_UsingDueDate: oldestMissedPayment ? '✅ Using due_date, not paid_date' : 'N/A',
        legalEngineSaysOverdue,
        firstMissedDueDateFromLegalEngine: legalStatus.firstMissedDueDate,
        calculatedMissedDate: missedDate,
        fallbackUsed: !oldestMissedPayment && legalEngineSaysOverdue && legalStatus.firstMissedDueDate ? 'Legal Engine' : oldestMissedPayment ? 'UI Payment Record' : 'None',
        WARNING_IfShowingPaymentDate: missedDate && oldestMissedPayment?.paidDate && missedDate.includes(format(parseISO(oldestMissedPayment.paidDate), 'd')) ? '❌ BUG: Showing payment date instead of due date!' : '✅ Correct'
    });

    // =========================================================================
    // BALANCE-AWARE PAID UNTIL: Only show if fully paid
    // =========================================================================
    // CRITICAL FIX: Don't show "Paid until [future date]" if balance outstanding
    // A tenant who paid $100 of $1000 is NOT "paid until" anything - they're in arrears
    // Only show "Paid until" when totalBalanceDue <= 0
    //
    // Priority (when fully paid):
    // 1) Most recent paidDate from any payment
    // 2) Next upcoming payment due date (for new tenants with no payments yet)
    // 3) Tracking start date (absolute fallback)
    const paidUntilDate = totalBalanceDue <= 0
        ? (mostRecentPaidPayment
            ? format(parseISO(mostRecentPaidPayment.paidDate!), 'MMM d')
            : nextUpcomingPayment
                ? format(normalizeDate(nextUpcomingPayment.dueDate), 'MMM d')
                : tenant.trackingStartDate
                    ? format(parseISO(tenant.trackingStartDate), 'MMM d')
                    : null)
        : null; // If any balance outstanding, don't show "paid until" date

    console.log('🔍 TENANT CARD - Paid Until Logic (Balance-Aware):', {
        tenantName: tenant.name,
        totalBalanceDue: totalBalanceDue.toFixed(2),
        isFullyPaid: totalBalanceDue <= 0,
        paidUntilDate: paidUntilDate || 'NULL - Balance outstanding',
        mostRecentPaidPaymentExists: !!mostRecentPaidPayment,
        mostRecentPaidPaymentDate: mostRecentPaidPayment?.paidDate
    });

    // =========================================================================
    // SAFE DISPLAY VALUES: Guaranteed non-null strings for UI
    // =========================================================================
    // safePaidUntilDate: Paid until date or placeholder (only used when NOT overdue)
    const safePaidUntilDate = paidUntilDate || '-';
    // safeMissedDate: Oldest missed payment date (calculated from legal engine if no payment record)
    const safeMissedDate = missedDate || '-';

    // =========================================================================
    // EFFECTIVE DAYS OVERDUE (for unified ledger line)
    // =========================================================================
    // Use the GREATER of daysOverdue (from legal engine) or calculatedDaysOverdue (from UI)
    // This ensures the day count is always accurate even if one source lags behind
    // CRITICAL: This value updates every morning at 12:01 AM NZ time
    const effectiveDaysOverdue = Math.max(daysOverdue, calculatedDaysOverdue);

    console.log('🔍 TENANT CARD - Days Overdue Calculation:', {
        tenantName: tenant.name,
        daysOverdueFromLegalEngine: daysOverdue,
        calculatedDaysOverdueFromUI: calculatedDaysOverdue,
        effectiveDaysOverdue,
        source: daysOverdue > calculatedDaysOverdue ? 'Legal Engine' : calculatedDaysOverdue > daysOverdue ? 'UI Calculation' : 'Both Equal',
        totalBalanceDue,
        legalEngineSaysOverdue
    });

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

        // Default fallback for edge cases
        // If we got here with a balance due, it means:
        // - workingDaysOverdue = 0 (payment due today or in future)
        // - totalBalanceDue > 0 (tenant owes money)
        // This should show as GREEN (current) since no deadlines have been missed yet
        if (totalBalanceDue > 0) {
            return {
                tier: 'GREEN',
                color: '#22C55E',
                label: 'Current',
                bannerText: '',
                buttonText: ''
            };
        }

        // Fully paid and current
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
                {/* CRITICAL: Balance takes priority - if totalBalanceDue > 0, NEVER show "Paid until" */}
                {totalBalanceDue > 0 ? (
                    <>
                        {/* Balance outstanding - show overdue if days >= 1, otherwise show current balance */}
                        {effectiveDaysOverdue >= 1 ? (
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
                            /* Balance exists but not overdue yet (due today or in future) */
                            <span style={{ color: severity.color }} className="font-bold">
                                Current balance: ${totalBalanceDue.toFixed(2)}
                            </span>
                        )}
                    </>
                ) : (
                    /* Paid state - Green - Only show when totalBalanceDue <= 0 */
                    <span style={{ color: severity.color, opacity: 0.7 }}>
                        {paidUntilDate ? `Paid until ${paidUntilDate}` : 'No payments recorded'}
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

                            {/* Issue Next Strike - Adaptive styling based on route */}
                            {/* Only show if < 3 strikes. Style adapts based on which route triggered termination: */}
                            {/* - If 3-strike route: Hidden (strikeCount = 3) */}
                            {/* - If 21-day route: Shown but subtle (backup option) */}
                            {(severity.strikeCount ?? 0) < 3 && (() => {
                                const nextStrike = (severity.strikeCount ?? 0) + 1;
                                const strikeLabel = nextStrike === 1 ? 'STRIKE 1' : nextStrike === 2 ? 'STRIKE 2' : 'STRIKE 3';
                                // Check if termination reached via 21-day route (not strike route)
                                const via21DayRoute = daysOverdue >= 21 && (severity.strikeCount ?? 0) < 3;

                                // DEBUG: Log the de-emphasis condition
                                console.log('🔍 STRIKE BUTTON DE-EMPHASIS CHECK:', {
                                    daysOverdue,
                                    strikeCount: severity.strikeCount,
                                    via21DayRoute,
                                    willDeEmphasize: via21DayRoute,
                                    borderColor: via21DayRoute ? 'rgba(255, 59, 59, 0.4)' : '#FF3B3B',
                                    textColor: via21DayRoute ? 'rgba(255, 59, 59, 0.7)' : '#FF3B3B'
                                });

                                return (
                                    <Button
                                        size="brand"
                                        variant={null as any} // CRITICAL: Prevent default variant from applying text-primary-foreground
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            console.log(`📋 STRIKE ${nextStrike}: Continuing strike process ${via21DayRoute ? '(backup path - termination via 21-day route)' : 'as backup'}`);
                                            console.log('🎯 Current strikes:', severity.strikeCount);
                                            console.log('📅 Days overdue:', daysOverdue);
                                        }}
                                        className="flex-1 rounded-2xl transition-all tabular-nums bg-transparent border-2 font-black uppercase tracking-widest"
                                        style={{
                                            borderColor: via21DayRoute ? 'rgba(255, 59, 59, 0.4)' : '#FF3B3B',
                                            color: via21DayRoute ? 'rgba(255, 59, 59, 0.7)' : '#FF3B3B'
                                        }}
                                        title={via21DayRoute ? "Alternative path: Build strike history for stronger tribunal case" : undefined}
                                    >
                                        <FileWarning className="w-4 h-4" style={{ opacity: via21DayRoute ? 0.7 : 1 }} />
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
