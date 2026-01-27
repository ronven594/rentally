"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { PropertyCard } from "@/components/dashboard/PropertyCard"
import { AddTenantDialog } from "@/components/dashboard/AddTenantDialog"
import { AddPropertyDialog } from "@/components/dashboard/AddPropertyDialog"
import { ManageTenantDialog } from "@/components/dashboard/ManageTenantDialog"
import { ConfirmationDialog } from "@/components/dashboard/ConfirmationDialog"
import { Property, Tenant, RentPayment, PaymentStatus, PaymentFrequency, PaymentHistoryEntry } from "@/types"
import { parseISO, format, addDays, addMonths, startOfDay } from "date-fns"
import { logToEvidenceLedger, EVENT_TYPES, CATEGORIES } from "@/services/evidenceLedger"
import { Plus, Building2, Users, AlertCircle, Loader2 } from "lucide-react"
import { UpcomingObligations } from "@/components/dashboard/UpcomingObligations"
import { getObligationMessages } from "@/lib/status-engine"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { supabase } from "@/lib/supabaseClient"
import { usePathname } from "next/navigation"
import { useAuth } from "@/contexts/AuthContext"
import { calculateRentalLogic, type RentalLogicResult } from "@/hooks/useRentalLogic"
import type { StrikeRecord, NoticeType } from "@/lib/legal-engine"
import { calculateTenantStatus, type TenantStatusResult } from "@/lib/status-calculator"
import { toRentSettings, toPayments } from "@/lib/rent-calculator"

// Initial Properties with Tenants
const INITIAL_PROPERTIES: Property[] = [];

export default function RentTrackerPage() {
    const { profile } = useAuth();
    const [properties, setProperties] = useState<Property[]>([]);
    const [payments, setPayments] = useState<RentPayment[]>([]);
    const [strikeHistories, setStrikeHistories] = useState<Record<string, StrikeRecord[]>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isAddPropertyOpen, setIsAddPropertyOpen] = useState(false);
    const [isAddTenantOpen, setIsAddTenantOpen] = useState(false);
    const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
    const [managingTenantId, setManagingTenantId] = useState<string | null>(null);
    const [testDate, setTestDate] = useState<Date | null>(null);
    const [isSyncingLedger, setIsSyncingLedger] = useState(false);
    const [confirmState, setConfirmState] = useState<{
        open: boolean;
        message: string;
        onConfirm: () => void;
    }>({ open: false, message: "", onConfirm: () => { } });
    const [isMounted, setIsMounted] = useState(false);
    const pathname = usePathname();

    useEffect(() => {
        setIsMounted(true);
    }, []);

    const fetchProperties = useCallback(async () => {
        try {
            console.log('🔄 Fetching all properties, tenants, and payments...');
            setLoading(true);
            const { data, error } = await supabase
                .from('properties')
                .select('*, tenants(*)')
                .order('created_at', { ascending: false });

            if (error) throw error;

            console.log('✅ Properties fetched:', data?.length);

            // Map data to Property interface
            const mappedProperties: Property[] = (data || []).map(p => ({
                id: p.id,
                name: p.address,
                address: p.address,
                type: p.property_type,
                region: p.region || "Auckland",
                tenants: (p.tenants || []).map((t: any) => {
                    return {
                        id: t.id,
                        name: `${t.first_name} ${t.last_name}`,
                        email: t.email,
                        phone: t.phone,
                        rentAmount: t.weekly_rent || 0,
                        weekly_rent: t.weekly_rent,
                        tenant_address: t.tenant_address,
                        frequency: t.rent_frequency || "Weekly",
                        startDate: t.lease_start_date,
                        trackingStartDate: t.tracking_start_date, // CRITICAL: When we started tracking (for legal engine)
                        openingArrears: t.opening_arrears || 0,   // CRITICAL: Pre-existing debt (for legal engine)
                        rentDueDay: t.rent_due_day || "Wednesday",
                        sentNotices: t.sent_notices || [],        // 90-day rolling strike history
                        remedyNoticeSentAt: t.remedy_notice_sent_at, // 14-day notice to remedy
                        paymentHistory: t.payment_history || [],  // Payment history for modal
                        strikeHistory: [],
                        createdAt: t.created_at
                    };
                })
            }));

            setProperties(mappedProperties);
            setError(null);
        } catch (err: any) {
            console.error("Error fetching properties:", err);
            setError(err.message || "Failed to load properties");
            toast.error('Failed to load properties');
        } finally {
            setLoading(false);
            console.log('✅ Loading state set to false');
        }
    }, [supabase]);

    const fetchPayments = useCallback(async () => {
        try {
            const { data, error } = await supabase
                .from('payments')
                .select('*')
                .order('due_date', { ascending: false });

            if (error) throw error;

            const mappedPayments: RentPayment[] = (data || []).map(p => ({
                id: p.id,
                tenantId: p.tenant_id,
                dueDate: p.due_date,
                paidDate: p.paid_date,
                amount: p.amount,
                amount_paid: p.amount_paid,
                status: p.status as PaymentStatus,
                notes: p.notes
            }));

            setPayments(mappedPayments);
        } catch (err) {
            console.error("Error fetching payments:", err);
        }
    }, [supabase]);

    // Consolidated data fetching: initial load + pathname changes
    useEffect(() => {
        // Initial mount
        if (!isMounted) {
            console.log('🏁 Component mounted - initial data load');
            fetchProperties();
            fetchPayments();
            setIsMounted(true);
            return;
        }

        // Re-fetch when navigating back to this route
        if (pathname === '/rent-tracker' || pathname === '/') {
            console.log('📍 Navigated to rent tracker - refreshing data');
            fetchProperties();
            fetchPayments();
        }
    }, [pathname, isMounted, fetchProperties, fetchPayments]);

    // Re-fetch on tab visibility (stable - no changing dependencies)
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                console.log('👁️ Tab became visible - refreshing data');
                fetchProperties();
                fetchPayments();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [fetchProperties, fetchPayments]);

    // Fetch strike histories for legal compliance
    useEffect(() => {
        const fetchStrikeHistories = async () => {
            if (!properties.length) return;

            console.log('📊 Fetching strike histories for RTA compliance...');
            const histories: Record<string, StrikeRecord[]> = {};

            for (const property of properties) {
                for (const tenant of property.tenants) {
                    const { data, error } = await supabase.rpc('get_notice_timeline', {
                        p_tenant_id: tenant.id
                    });

                    if (error) {
                        console.error(`Error fetching strikes for ${tenant.name}:`, error);
                        continue;
                    }

                    if (data) {
                        histories[tenant.id] = data
                            .filter((n: any) => n.is_strike)
                            .map((n: any) => ({
                                noticeId: n.notice_id,
                                sentDate: n.sent_at,
                                officialServiceDate: n.official_service_date,
                                type: n.notice_type as NoticeType,
                                rentDueDate: n.rent_due_date,
                                amountOwed: n.amount_owed,
                            }));
                    }
                }
            }

            setStrikeHistories(histories);
            console.log('✅ Strike histories loaded:', Object.keys(histories).length, 'tenants');
        };

        fetchStrikeHistories();
    }, [properties]);

    // Auto-generate payment records for all tenants
    const autoGeneratePayments = async () => {
        if (properties.length === 0) return;

        console.log('🔄 Starting automatic payment generation...');
        let totalGenerated = 0;

        for (const property of properties) {
            for (const tenant of property.tenants) {
                // Determine the tracking start date (prefer trackingStartDate, fallback to startDate)
                const effectiveTrackingStart = tenant.trackingStartDate || tenant.startDate;

                // Skip if no tracking start date
                if (!effectiveTrackingStart) {
                    console.warn(`⚠️ Skipping ${tenant.name}: No tracking start date`);
                    continue;
                }

                try {
                    // Fetch existing payments for this tenant FIRST to decide strategy
                    // CRITICAL: Include paid_date and amount_paid for coverage check
                    const { data: existingPayments, error: fetchError } = await supabase
                        .from('payments')
                        .select('id, due_date, status, paid_date, amount_paid')
                        .eq('tenant_id', tenant.id);

                    if (fetchError) {
                        console.error(`Error fetching existing payments for ${tenant.name}:`, fetchError);
                        continue;
                    }

                    // User requested deep-dive debug log
                    console.log('🔍 AUTO-GENERATION DEBUG - START:', {
                        tenantName: tenant.name,
                        trackingStartDate: effectiveTrackingStart,
                        openingArrears: tenant.openingArrears || 0,
                        todayDate: format(testDate || new Date(), 'yyyy-MM-dd'),
                        rentDueDay: tenant.rentDueDay,
                        existingPaymentsInDB: existingPayments,
                    });

                    // CRITICAL FIX: Use fresh database data, not stale in-memory state
                    // The in-memory `payments` state might be outdated when testDate changes
                    // We need to use `existingPayments` from the database query above
                    const mostRecentPayment = existingPayments && existingPayments.length > 0
                        ? existingPayments.sort((a, b) => new Date(b.due_date).getTime() - new Date(a.due_date).getTime())[0]
                        : null;

                    let dueDates: string[] = [];

                    console.log('🔍 WATCHDOG - Payment Record Check:', {
                        tenantName: tenant.name,
                        existingPaymentsInDB: existingPayments?.length || 0,
                        mostRecentPaymentExists: !!mostRecentPayment,
                        mostRecentDueDate: mostRecentPayment?.due_date || 'N/A',
                        willRunFirstGeneration: !mostRecentPayment,
                        dataSource: 'Fresh from database (not stale state)'
                    });

                    if (!mostRecentPayment) {
                        // =====================================================================
                        // FIX: Debt Time Machine Bug - NO Historical Backfill
                        // =====================================================================
                        // CRITICAL: The watchdog should NEVER generate historical debt records
                        //
                        // BEFORE FIX (Time Machine):
                        //   - User creates tenant on Jan 26 with tracking start Dec 1
                        //   - Opening arrears: $1000 (or $0)
                        //   - Watchdog generates: Dec 1, Dec 30, Jan 1, Jan 26 (historical backfill)
                        //   - Result: Duplicate records OR debt appearing for paid periods ❌
                        //
                        // AFTER FIX (Proactive Only):
                        //   - User creates tenant on Jan 26 with tracking start Dec 1
                        //   - Opening arrears: $1000 → AddTenantDialog creates Dec 1 record
                        //   - Watchdog finds Dec 1 record exists → skips this branch
                        //   - Opening arrears: $0 → No records exist
                        //   - Watchdog generates ONLY next upcoming due date after today (Feb 1)
                        //   - Result: Clean ledger, no historical backfill ✅
                        //
                        // GOAL:
                        //   - $0 behind = Green status, no back-dated debts
                        //   - $x behind = Single opening arrears record, no backfill
                        // =====================================================================

                        console.log(`🆕 NO EXISTING PAYMENTS for ${tenant.name} - Generating NEXT upcoming due date only (no historical backfill)`);

                        // Don't backfill from tracking start date!
                        // Instead, find the NEXT due date after today
                        const todayDate = testDate || new Date();
                        const todayNormalized = startOfDay(todayDate);

                        let nextDate: Date;

                        if (tenant.frequency === 'Monthly') {
                            // For Monthly: Find next occurrence of the day-of-month AFTER today
                            const dayOfMonth = parseInt(tenant.rentDueDay, 10) || 1;
                            const currentMonth = todayNormalized.getMonth();
                            const currentYear = todayNormalized.getFullYear();

                            // Try current month first
                            const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
                            const effectiveDay = Math.min(dayOfMonth, lastDayOfMonth);
                            nextDate = new Date(currentYear, currentMonth, effectiveDay);

                            // If that's on or before today, move to next month
                            if (startOfDay(nextDate) <= todayNormalized) {
                                const nextMonth = addMonths(nextDate, 1);
                                const nextMonthLastDay = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
                                const nextMonthEffectiveDay = Math.min(dayOfMonth, nextMonthLastDay);
                                nextDate = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), nextMonthEffectiveDay);
                            }
                        } else {
                            // For Weekly/Fortnightly: Find next occurrence of the day-of-week AFTER today
                            const daysToAdd = tenant.frequency === 'Fortnightly' ? 14 : 7;

                            // Start from tracking start date and advance until we're in the future
                            const trackingStart = parseISO(effectiveTrackingStart);
                            nextDate = new Date(trackingStart);

                            // Advance in chunks until we pass today
                            while (startOfDay(nextDate) <= todayNormalized) {
                                nextDate = addDays(nextDate, daysToAdd);
                            }
                        }

                        dueDates = [format(nextDate, 'yyyy-MM-dd')];

                        console.log(`📅 NEXT DUE DATE for ${tenant.name}:`, {
                            today: format(todayNormalized, 'yyyy-MM-dd'),
                            nextDueDate: dueDates[0],
                            frequency: tenant.frequency,
                            rentDueDay: tenant.rentDueDay,
                            explanation: 'Generating ONLY next upcoming due date (no historical backfill)'
                        });
                    } else {
                        const todayDate = testDate || new Date();
                        const todayNormalized = startOfDay(todayDate);

                        console.log('💰 PROACTIVE GENERATION CHECK:', {
                            tenant: tenant.name,
                            mostRecentDueDate: mostRecentPayment.due_date,
                            mostRecentStatus: mostRecentPayment.status,
                            today: format(todayDate, 'yyyy-MM-dd')
                        });

                        // =====================================================================
                        // COVERAGE-DRIVEN GENERATION (FIX: Cycle Overlap Bug)
                        // =====================================================================
                        // CRITICAL: Check if tenant is still covered by previous payments
                        // Don't generate new debt if tenant has pre-paid coverage extending into future
                        //
                        // BEFORE FIX (Date-Driven):
                        //   - Tenant pays $1050 on Feb 1 debt → paid_date = March 3
                        //   - March 1 arrives → system generates March 1 Unpaid record
                        //   - Result: "Current Balance: $1000" even though covered until March 3
                        //
                        // AFTER FIX (Coverage-Driven):
                        //   - Check most recent paid_date across ALL payments
                        //   - If today <= paid_date, skip generation (tenant still covered)
                        //   - Only generate if today > paid_date (coverage expired)
                        //
                        // GOAL: Respect pre-paid time - $0 balance until coverage expires
                        // =====================================================================

                        // Find most recent paid_date across ALL payments (coverage endpoint)
                        const allPaidDates = existingPayments
                            .filter(p => p.paid_date != null)
                            .map(p => parseISO(p.paid_date!))
                            .sort((a, b) => b.getTime() - a.getTime());

                        const mostRecentPaidDate = allPaidDates.length > 0 ? startOfDay(allPaidDates[0]) : null;

                        console.log('🛡️ COVERAGE CHECK:', {
                            tenant: tenant.name,
                            mostRecentPaidDate: mostRecentPaidDate ? format(mostRecentPaidDate, 'yyyy-MM-dd') : 'None (no coverage)',
                            today: format(todayNormalized, 'yyyy-MM-dd'),
                            isCovered: mostRecentPaidDate ? mostRecentPaidDate >= todayNormalized : false,
                            coverageStatus: mostRecentPaidDate
                                ? (mostRecentPaidDate >= todayNormalized
                                    ? `✅ COVERED - No generation until ${format(addDays(mostRecentPaidDate, 1), 'yyyy-MM-dd')}`
                                    : `❌ EXPIRED - Coverage ended ${format(mostRecentPaidDate, 'yyyy-MM-dd')}`)
                                : '⚠️ NO COVERAGE - Will generate based on calendar'
                        });

                        // COVERAGE GUARD: If tenant is still covered, don't generate new debt
                        if (mostRecentPaidDate && mostRecentPaidDate >= todayNormalized) {
                            console.log(`✅ ${tenant.name}: Still covered until ${format(mostRecentPaidDate, 'yyyy-MM-dd')} - Skipping generation`);
                            continue; // Skip this tenant - they're pre-paid
                        }

                        // =====================================================================
                        // PROACTIVE DEBT GENERATION (Coverage has expired or never existed)
                        // =====================================================================
                        // Coverage has expired (or tenant has only Unpaid records with no paid_date)
                        // Generate missing debt records using calendar-based frequency logic

                        // =====================================================================
                        // CRITICAL FIX: Snap to Current Settings (Frequency & RentDueDay)
                        // =====================================================================
                        // Start searching from day after most recent payment
                        const searchStartDate = addDays(parseISO(mostRecentPayment.due_date), 1);

                        // Use current frequency and rentDueDay to find next due date
                        let nextDate: Date;

                        if (tenant.frequency === 'Monthly') {
                            // For Monthly: Find next occurrence of the day-of-month
                            const dayOfMonth = parseInt(tenant.rentDueDay, 10) || 1;
                            const searchMonth = searchStartDate.getMonth();
                            const searchYear = searchStartDate.getFullYear();

                            // Try current month first
                            const lastDayOfMonth = new Date(searchYear, searchMonth + 1, 0).getDate();
                            const effectiveDay = Math.min(dayOfMonth, lastDayOfMonth);
                            nextDate = new Date(searchYear, searchMonth, effectiveDay);

                            // If that's before our search start, move to next month
                            if (nextDate < searchStartDate) {
                                const nextMonth = addMonths(nextDate, 1);
                                const nextMonthLastDay = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
                                const nextMonthEffectiveDay = Math.min(dayOfMonth, nextMonthLastDay);
                                nextDate = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), nextMonthEffectiveDay);
                            }
                        } else {
                            // =====================================================================
                            // FIX: Frequency Blindness Bug
                            // =====================================================================
                            // BEFORE: System found next day-of-week (always 7 days max)
                            //   - Jan 30 (Thu) → searchStartDate = Jan 31
                            //   - Next Thursday = Feb 6 (7 days from Jan 30)
                            //   - Result: Fortnightly tenant gets WEEKLY debt! ❌
                            //
                            // AFTER: Use exact cycle length based on frequency
                            //   - Fortnightly: Jump exactly 14 days
                            //   - Weekly: Jump exactly 7 days
                            //   - Result: Jan 30 + 14 days = Feb 13 ✅
                            // =====================================================================

                            if (tenant.frequency === 'Fortnightly') {
                                // Fortnightly: Jump exactly 14 days from previous due date
                                nextDate = addDays(parseISO(mostRecentPayment.due_date), 14);
                            } else {
                                // Weekly: Jump exactly 7 days from previous due date
                                nextDate = addDays(parseISO(mostRecentPayment.due_date), 7);
                            }
                        }

                        console.log('📅 SNAP TO CURRENT SETTINGS:', {
                            tenant: tenant.name,
                            oldDueDate: mostRecentPayment.due_date,
                            currentFrequency: tenant.frequency,
                            currentRentDueDay: tenant.rentDueDay,
                            nextDateCalculated: format(nextDate, 'yyyy-MM-dd'),
                            snapDescription: 'Using current settings, not old due_date'
                        });

                        // =====================================================================
                        // PROACTIVE DEBT GENERATION
                        // =====================================================================
                        // Generate ALL missing payments from the last payment record up to TODAY
                        // This works correctly for both cases:
                        //   1. $0 behind: No historical records, handled by "!mostRecentPayment" branch
                        //   2. $x behind: Has historical records (e.g., Dec 1, Dec 8, Dec 15 for 3 weeks behind)
                        //                 → Continues from last record (Dec 15) to today (Dec 22, Dec 29, etc.)
                        //
                        // Example: $600 opening arrears ÷ $200/week = 3 weeks behind
                        //   - AddTenantDialog creates: Dec 1, Dec 8, Dec 15 (3 historical records)
                        //   - Watchdog finds mostRecent = Dec 15
                        //   - Watchdog generates: Dec 22, Dec 29, Jan 5, Jan 12, Jan 19, Jan 26
                        //   - Total: $1800 (9 weeks × $200) ✅
                        // =====================================================================

                        while (startOfDay(nextDate) <= todayNormalized) {
                            dueDates.push(format(nextDate, 'yyyy-MM-dd'));

                            // Advance by the current frequency
                            if (tenant.frequency === 'Monthly') {
                                nextDate = addMonths(nextDate, 1);
                                // Re-apply snap-to-month-end logic
                                const dayOfMonth = parseInt(tenant.rentDueDay, 10) || 1;
                                const nextMonthLastDay = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0).getDate();
                                const effectiveDay = Math.min(dayOfMonth, nextMonthLastDay);
                                nextDate = new Date(nextDate.getFullYear(), nextDate.getMonth(), effectiveDay);
                            } else {
                                // For Weekly/Fortnightly, just add the days
                                nextDate = addDays(nextDate, tenant.frequency === 'Fortnightly' ? 14 : 7);
                            }
                        }

                        if (dueDates.length > 0) {
                            console.log(`📅 PROACTIVE GENERATION: Auto-generating ${dueDates.length} payment(s) for ${tenant.name} (debt exists from due date):`, dueDates);
                        } else {
                            console.log(`✅ ${tenant.name}: All due dates up to today already exist`);
                        }
                    }

                    if (dueDates.length === 0) {
                        console.log(`✅ ${tenant.name}: No generation trigger reached`);
                        continue;
                    }

                    // Filter out any dates that already exist in the database
                    const existingDueDates = new Set((existingPayments || []).map(p => p.due_date));
                    const newDueDates = dueDates.filter(d => !existingDueDates.has(d));

                    if (newDueDates.length === 0) {
                        console.log(`✅ ${tenant.name}: All payment dates already exist, skipping`);
                        continue;
                    }

                    if (newDueDates.length !== dueDates.length) {
                        console.log(`⚠️ ${tenant.name}: Filtered out ${dueDates.length - newDueDates.length} duplicate dates`);
                    }

                    // Prepare batch insert
                    const newPayments = newDueDates.map((dueDate: string) => {
                        console.log('💾 Creating payment record (Client-Side):', {
                            due_date: dueDate,
                            amount: tenant.rentAmount,
                            status: 'Unpaid',
                            tenant_id: tenant.id
                        });
                        return {
                            tenant_id: tenant.id,
                            property_id: property.id,
                            due_date: dueDate,
                            amount: tenant.rentAmount,
                            status: 'Unpaid'
                        };
                    });

                    // Batch insert
                    const { data: insertedPayments, error: insertError } = await supabase
                        .from('payments')
                        .insert(newPayments)
                        .select();

                    if (insertError) {
                        console.error(`Error inserting payments for ${tenant.name}:`, insertError);
                        continue;
                    }

                    console.log(`✅ Created ${newPayments.length} payment records for ${tenant.name}:`,
                        newPayments.map((p: any) => ({
                            due_date: p.due_date,
                            amount: p.amount,
                            status: p.status
                        }))
                    );

                    totalGenerated += newPayments.length;

                    // Show toast notification
                    if (newPayments.length === 1) {
                        toast.info(`New rent due for ${tenant.name} on ${format(parseISO(newPayments[0].due_date), 'MMM d')} - marked as unpaid`);
                    } else {
                        toast.info(`${newPayments.length} new rent payments auto-generated for ${tenant.name}`);
                    }

                    // Add to local state
                    const mappedPayments: RentPayment[] = (insertedPayments || []).map(p => ({
                        id: p.id,
                        tenantId: p.tenant_id,
                        dueDate: p.due_date,
                        amount: p.amount,
                        amount_paid: p.amount_paid,
                        status: p.status as PaymentStatus,
                        paidDate: p.paid_date
                    }));

                    setPayments(prev => [...prev, ...mappedPayments]);

                } catch (err) {
                    console.error(`Error auto-generating payments for ${tenant.name}:`, err);
                }
            }
        }

        if (totalGenerated > 0) {
            console.log(`🎉 Auto-generation complete: ${totalGenerated} total payments created`);
        } else {
            console.log('✅ Auto-generation complete: No new payments needed');
        }

        // Always re-fetch payments to ensure state is in sync with DB (especially if we skipped existing duplicates)
        await fetchPayments();
    };

    // Calculate total tenant count to detect when new tenants are added
    const totalTenantCount = properties.reduce((sum, p) => sum + p.tenants.length, 0);

    // Run auto-generation after properties and payments are loaded
    // Track totalTenantCount to trigger when new tenants are added to existing properties
    // Also re-run when testDate changes to generate missing payments for the new simulated date
    useEffect(() => {
        if (properties.length > 0 && totalTenantCount > 0 && !loading) {
            console.log("🔄 Auto-generation effect triggered - checking for missing payments", {
                testDate: testDate ? format(testDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd')
            });
            autoGeneratePayments();
        }
    }, [properties.length, totalTenantCount, loading, testDate]); // Include testDate to re-generate when date changes

    // Calculate RTA-compliant legal status for each tenant
    const tenantLegalStatuses = useMemo(() => {
        const statuses: Record<string, RentalLogicResult> = {};

        properties.forEach(property => {
            property.tenants.forEach(tenant => {
                const tenantPayments = payments.filter(p => p.tenantId === tenant.id);
                const strikeHistory = strikeHistories[tenant.id] || [];

                statuses[tenant.id] = calculateRentalLogic({
                    tenantId: tenant.id,
                    payments: tenantPayments,
                    strikeHistory,
                    region: property.region || 'Auckland',
                    currentDate: testDate || undefined,
                    trackingStartDate: tenant.trackingStartDate || tenant.startDate, // When we started tracking (or lease start as fallback)
                    openingArrears: tenant.openingArrears || 0, // Any existing debt when we started tracking
                    frequency: tenant.frequency, // For firstMissedDueDate calculation
                    rentDueDay: tenant.rentDueDay, // For firstMissedDueDate calculation
                });
            });
        });

        return statuses;
    }, [properties, payments, strikeHistories, testDate]);

    // Calculate unified tenant status from status-calculator (Session 4+)
    // This is the SINGLE SOURCE OF TRUTH for severity, strikes, notices, and display text.
    const tenantStatuses = useMemo(() => {
        const statuses: Record<string, TenantStatusResult> = {};

        properties.forEach(property => {
            property.tenants.forEach(tenant => {
                if (!tenant.frequency || !tenant.rentAmount || !tenant.rentDueDay) return;

                const settings = toRentSettings({
                    frequency: tenant.frequency,
                    rentAmount: tenant.rentAmount,
                    rentDueDay: tenant.rentDueDay,
                    trackingStartDate: tenant.trackingStartDate || tenant.startDate,
                    openingArrears: tenant.openingArrears
                });

                const tenantPayments = payments.filter(p => p.tenantId === tenant.id);
                const convertedPayments = toPayments(tenantPayments.map(p => ({
                    id: p.id,
                    amount_paid: p.amount_paid,
                    paidDate: p.paidDate
                })));

                const sentNotices = tenant.sentNotices || [];
                const region = (property.region || 'Auckland') as any;

                statuses[tenant.id] = calculateTenantStatus(
                    settings,
                    convertedPayments,
                    sentNotices,
                    tenant.remedyNoticeSentAt,
                    region,
                    testDate
                );
            });
        });

        return statuses;
    }, [properties, payments, testDate]);

    // Record Payment (Oldest Dollar First) - AI-first reconciliation model
    const handleRecordPayment = async (tenantId: string, paymentAmount: number, paymentDate: string) => {
        try {
            console.log('💰 RECORD PAYMENT:', {
                tenantId,
                paymentAmount,
                paymentDate
            });

            // Get all unpaid payments for this tenant, oldest first
            const { data: unpaidPayments, error: fetchError } = await supabase
                .from('payments')
                .select('*')
                .eq('tenant_id', tenantId)
                // We want specifically Unpaid or Partial status. 
                // Using .in() is better if we have multiple statuses or just filter in JS if not large.
                // Assuming status column can be 'Partial' now.
                .in('status', ['Unpaid', 'Partial'])
                .order('due_date', { ascending: true }); // OLDEST FIRST

            if (fetchError) throw fetchError;

            if (!unpaidPayments || unpaidPayments.length === 0) {
                toast.error('No unpaid payments found');
                return;
            }

            console.log('📋 Unpaid payments (oldest first):', {
                count: unpaidPayments.length,
                payments: unpaidPayments.map(p => ({
                    dueDate: p.due_date,
                    amount: p.amount,
                    amountPaid: p.amount_paid,
                    status: p.status
                }))
            });

            let remainingPayment = paymentAmount;
            const paymentsToUpdate: { id: string, status: string, paid_date: string | null, amount_paid: number }[] = [];

            // Find tenant and property for strike checking / logging
            let flatTenants: Tenant[] = [];
            properties.forEach(p => flatTenants.push(...p.tenants));
            const tenant = flatTenants.find(t => t.id === tenantId);
            const property = properties.find(p => p.tenants.some(t => t.id === tenantId));

            if (!tenant || !property) throw new Error("Tenant or Property not found");

            // Helper: Calculate cycle days based on tenant frequency
            const getCycleDays = (frequency: PaymentFrequency): number => {
                switch (frequency) {
                    case 'Weekly': return 7;
                    case 'Fortnightly': return 14;
                    case 'Monthly': return 30; // Approximate for partial payment calculations
                    default: return 7;
                }
            };

            // PRIORITY 1: Apply payment to opening_arrears FIRST (if any exists)
            let newOpeningArrears = tenant.openingArrears || 0;
            if (newOpeningArrears > 0 && remainingPayment > 0) {
                const amountToApplyToOpeningArrears = Math.min(remainingPayment, newOpeningArrears);
                newOpeningArrears -= amountToApplyToOpeningArrears;
                remainingPayment -= amountToApplyToOpeningArrears;

                console.log('💰 OPENING ARREARS REDUCTION:', {
                    previousOpeningArrears: tenant.openingArrears,
                    amountApplied: amountToApplyToOpeningArrears,
                    newOpeningArrears,
                    remainingPaymentAfterOpeningArrears: remainingPayment
                });
            }

            // PRIORITY 2: Apply remaining payment to ledger entries (oldest first)
            for (const payment of unpaidPayments) {
                if (remainingPayment <= 0.01) break; // Use small epsilon for float safety

                const currentAmountPaid = payment.amount_paid || 0;
                const amountOwed = payment.amount - currentAmountPaid;

                // How much of the remaining payment can we apply to this debt?
                const amountToApply = Math.min(remainingPayment, amountOwed);

                if (amountToApply <= 0.01) continue;

                const newAmountPaid = currentAmountPaid + amountToApply;

                // Determine new status
                const isFullyPaid = newAmountPaid >= (payment.amount - 0.01);
                const newStatus = isFullyPaid ? 'Paid' : 'Partial';

                // FREQUENCY-AWARE PAID DATE CALCULATION
                // CRITICAL: Use DELTA ADDITION, not total recalculation
                let paidDate: string | null = null;

                if (isFullyPaid) {
                    // Full payment: advance by full cycle
                    const cycleDays = getCycleDays(tenant.frequency);
                    // Start from current paid_date if it exists, otherwise from due_date
                    const startDate = payment.paid_date ? parseISO(payment.paid_date) : parseISO(payment.due_date);
                    const paidUntilDate = addDays(startDate, cycleDays);
                    // CRITICAL: Store as date-only string (YYYY-MM-DD) to eliminate timezone drift
                    paidDate = format(paidUntilDate, 'yyyy-MM-dd');
                } else {
                    // Partial payment: calculate pro-rata coverage from due date
                    // Formula: PaidUntil = DueDate + (TotalPaid / TotalOwed) * CycleDays
                    // CRITICAL: Always calculate from due_date based on TOTAL amount paid (not delta)
                    const cycleDays = getCycleDays(tenant.frequency);
                    const coverageRatio = newAmountPaid / payment.amount; // TOTAL paid so far
                    const daysOfCoverage = coverageRatio * cycleDays;

                    console.log('📊 PARTIAL PAYMENT - Pro-rata calculation:', {
                        dueDate: payment.due_date,
                        totalPaid: newAmountPaid,
                        totalOwed: payment.amount,
                        coverageRatio: coverageRatio.toFixed(4),
                        cycleDays,
                        daysOfCoverage: Math.round(daysOfCoverage),
                        formula: `${payment.due_date} + ${Math.round(daysOfCoverage)} days`
                    });

                    // CRITICAL: Use Math.round() to minimize rounding error accumulation
                    // Always calculate from due_date to ensure consistency
                    const paidUntilDate = addDays(parseISO(payment.due_date), Math.round(daysOfCoverage));
                    // CRITICAL: Store as date-only string (YYYY-MM-DD) to eliminate timezone drift
                    paidDate = format(paidUntilDate, 'yyyy-MM-dd');
                }

                // VERIFICATION POINT 1: After delta math is performed
                console.log('💰 PAYMENT RECONCILIATION - Delta Math Complete:', {
                    paymentId: payment.id,
                    dueDate: payment.due_date,
                    frequency: tenant.frequency,
                    cycleDays: getCycleDays(tenant.frequency),
                    amountToApply,
                    totalAmount: payment.amount,
                    isFullyPaid,
                    calculatedPaidDate: paidDate,
                    previousPaidDate: payment.paid_date,
                    startDate: payment.paid_date || payment.due_date
                });

                console.log(`⚠️ Allocating to payment:`, {
                    paymentId: payment.id,
                    dueDate: payment.due_date,
                    totalAmount: payment.amount,
                    previouslyPaid: currentAmountPaid,
                    amountOwed,
                    applyingNow: amountToApply,
                    newAmountPaid,
                    newStatus
                });

                paymentsToUpdate.push({
                    id: payment.id,
                    status: newStatus,
                    paid_date: paidDate, // null if partial
                    amount_paid: newAmountPaid
                });

                remainingPayment -= amountToApply;
            }

            console.log('💾 Payments to update:', {
                count: paymentsToUpdate.length,
                updates: paymentsToUpdate
            });

            // VERIFICATION POINT 2: Before database write
            // CRITICAL: Verify we're NEVER updating due_date (it must remain immutable)
            console.log('💰 PAYMENT RECONCILIATION - Before DB Write:', {
                totalPaymentsToUpdate: paymentsToUpdate.length,
                paymentUpdates: paymentsToUpdate.map(u => {
                    // Find the original payment to compare
                    const originalPayment = unpaidPayments.find(p => p.id === u.id);
                    return {
                        paymentId: u.id,
                        ORIGINAL_DUE_DATE: originalPayment?.due_date,
                        newStatus: u.status,
                        newPaidDate: u.paid_date,
                        newAmountPaid: u.amount_paid,
                        verifyingDueDateNotInUpdate: !('due_date' in u) ? '✅ SAFE' : '❌ DANGER - due_date in update object!'
                    };
                })
            });

            // Update all payments in database
            // CRITICAL SAFEGUARD: NEVER update due_date - it must remain immutable
            for (const update of paymentsToUpdate) {
                // Double-check that due_date is not in the update object
                if ('due_date' in update) {
                    console.error('❌ CRITICAL ERROR: Attempted to update due_date!', update);
                    throw new Error('Cannot modify due_date - it must remain immutable');
                }

                const { error: updateError } = await supabase
                    .from('payments')
                    .update({
                        status: update.status,
                        paid_date: update.paid_date,
                        amount_paid: update.amount_paid // CRITICAL: Update this column
                        // CRITICAL: due_date is NEVER updated - it must remain immutable
                    })
                    .eq('id', update.id);

                if (updateError) {
                    console.error('❌ Update failed for payment:', update.id, updateError);
                    throw updateError;
                }

                console.log('✅ Updated payment:', update.id);
            }

            // Log the payment itself (strikes are logged by isStrikeWithLogging above)
            await logToEvidenceLedger(
                property.id,
                tenantId,
                EVENT_TYPES.RENT_PAID,
                CATEGORIES.PAYMENT,
                `Payment received: $${paymentAmount.toFixed(2)}`,
                `Payment of $${paymentAmount.toFixed(2)} recorded. ${paymentsToUpdate.length} payment(s) updated.`,
                {
                    paymentAmount,
                    debtsUpdated: paymentsToUpdate.length,
                    remainingBalance: remainingPayment
                }
            );

            // Add payment to tenant's payment history
            const paymentHistoryEntry: PaymentHistoryEntry = {
                id: crypto.randomUUID(),
                amount: paymentAmount,
                date: paymentDate,
                method: 'Bank Transfer', // Default method
                timestamp: new Date().toISOString()
            };

            // Update tenant's paymentHistory AND opening_arrears in database
            const currentHistory = tenant.paymentHistory || [];
            const updatedHistory = [paymentHistoryEntry, ...currentHistory];

            const { error: historyUpdateError } = await supabase
                .from('tenants')
                .update({
                    payment_history: updatedHistory,
                    opening_arrears: newOpeningArrears // CRITICAL: Update reduced opening arrears
                })
                .eq('id', tenantId);

            if (historyUpdateError) {
                console.error('⚠️ Failed to update payment history:', historyUpdateError);
                // Don't throw - payment was recorded, history is just a nice-to-have
            }

            console.log('✅ Opening arrears updated in database:', {
                previousValue: tenant.openingArrears || 0,
                newValue: newOpeningArrears,
                reduction: (tenant.openingArrears || 0) - newOpeningArrears
            });

            // CRITICAL VALIDATION: Math must be perfectly reversible
            const totalAllocated = ((tenant.openingArrears || 0) - newOpeningArrears) +
                                   paymentsToUpdate.reduce((sum, p) => sum + (p.amount_paid - (unpaidPayments.find(up => up.id === p.id)?.amount_paid || 0)), 0);
            console.log('🧮 PAYMENT - Allocation Math Validation:', {
                originalPaymentAmount: paymentAmount,
                openingArrearsReduction: (tenant.openingArrears || 0) - newOpeningArrears,
                ledgerAllocations: paymentsToUpdate.map(p => ({
                    paymentId: p.id,
                    dueDate: unpaidPayments.find(up => up.id === p.id)?.due_date,
                    previousPaid: unpaidPayments.find(up => up.id === p.id)?.amount_paid || 0,
                    newPaid: p.amount_paid,
                    allocated: p.amount_paid - (unpaidPayments.find(up => up.id === p.id)?.amount_paid || 0)
                })),
                totalAllocated,
                shouldEqual: paymentAmount,
                mathCheck: Math.abs(totalAllocated - paymentAmount) < 0.01 ? '✅ PASS' : '❌ FAIL - MONEY CREATED/DESTROYED!'
            });

            toast.success("Payment recorded successfully");

            console.log('🔄 Refreshing data...');
            await fetchPayments();
            await fetchProperties();
            console.log('✅ Data refresh complete');

            // VERIFICATION POINT 3: After success response
            console.log('💰 PAYMENT RECONCILIATION - Success:', {
                paymentAmount,
                paymentDate,
                paymentsUpdated: paymentsToUpdate.length,
                finalUpdates: paymentsToUpdate.map(u => ({
                    paymentId: u.id,
                    status: u.status,
                    paidDate: u.paid_date
                }))
            });

        } catch (error: any) {
            console.error('❌ Record payment error:', error);
            toast.error("Failed to record payment");
        }
    };

    // Void a payment (reverse payment reconciliation)
    const handleVoidPayment = async (tenantId: string, paymentId: string) => {
        try {
            console.log('🔄 VOID PAYMENT - START:', { tenantId, paymentId });

            // Find tenant and payment history entry
            let flatTenants: Tenant[] = [];
            properties.forEach(p => flatTenants.push(...p.tenants));
            const tenant = flatTenants.find(t => t.id === tenantId);
            const property = properties.find(p => p.tenants.some(t => t.id === tenantId));

            if (!tenant || !property) throw new Error("Tenant or Property not found");

            const paymentHistory = tenant.paymentHistory || [];
            const paymentToVoid = paymentHistory.find(p => p.id === paymentId);

            if (!paymentToVoid) {
                toast.error("Payment not found");
                return;
            }

            console.log('🔍 VOID PAYMENT - Initial State:', {
                tenantName: tenant.name,
                currentOpeningArrears: tenant.openingArrears || 0,
                paymentToVoidAmount: paymentToVoid.amount,
                paymentToVoidDate: paymentToVoid.date
            });

            // Get all payments for this tenant (most recent first for voiding)
            const { data: allPayments, error: fetchError } = await supabase
                .from('payments')
                .select('*')
                .eq('tenant_id', tenantId)
                .order('due_date', { ascending: false }); // NEWEST FIRST for voiding

            if (fetchError) throw fetchError;

            if (!allPayments || allPayments.length === 0) {
                toast.error('No payment records found');
                return;
            }

            // Helper: Calculate cycle days based on tenant frequency
            const getCycleDays = (frequency: PaymentFrequency): number => {
                switch (frequency) {
                    case 'Weekly': return 7;
                    case 'Fortnightly': return 14;
                    case 'Monthly': return 30;
                    default: return 7;
                }
            };

            // Reverse the payment by subtracting from newest payments first
            let amountToReverse = paymentToVoid.amount;
            const paymentsToUpdate: { id: string, status: string, paid_date: string | null, amount_paid: number }[] = [];

            // CRITICAL: Reverse ledger entries first (newest to oldest)
            // WARNING: This reverses in OPPOSITE order from how payment was applied!
            // Payment application: OLDEST → NEWEST (priority to old debts)
            // Payment reversal: NEWEST → OLDEST (this line)
            console.log('🔍 VOID - Starting ledger reversal:', {
                totalToReverse: amountToReverse,
                paymentRecordCount: allPayments.length,
                reverseOrder: 'NEWEST → OLDEST'
            });

            for (const payment of allPayments) {
                if (amountToReverse <= 0.01) break;

                const currentAmountPaid = payment.amount_paid || 0;
                if (currentAmountPaid <= 0) continue; // Skip unpaid payments

                // How much can we reverse from this payment?
                const amountToDeduct = Math.min(amountToReverse, currentAmountPaid);
                const newAmountPaid = currentAmountPaid - amountToDeduct;

                console.log(`🔍 VOID - Processing payment record:`, {
                    dueDate: payment.due_date,
                    currentAmountPaid,
                    amountToDeduct,
                    newAmountPaid,
                    amountStillToReverse: amountToReverse - amountToDeduct
                });

                // Determine new status
                const isFullyPaid = newAmountPaid >= (payment.amount - 0.01);
                const newStatus = newAmountPaid <= 0.01 ? 'Unpaid' : isFullyPaid ? 'Paid' : 'Partial';

                // Recalculate paid_date by SUBTRACTING the delta
                let paidDate: string | null = null;

                if (newStatus === 'Paid') {
                    // Still fully paid: paid_date stays the same
                    paidDate = payment.paid_date;
                } else if (newStatus === 'Partial') {
                    // Partial payment after void: calculate pro-rata coverage from due date
                    // Formula: PaidUntil = DueDate + (TotalPaid / TotalOwed) * CycleDays
                    // CRITICAL: Always calculate from due_date based on TOTAL amount paid (ensures symmetry with payment recording)
                    const cycleDays = getCycleDays(tenant.frequency);
                    const coverageRatio = newAmountPaid / payment.amount;
                    const daysOfCoverage = coverageRatio * cycleDays;

                    console.log('📊 VOID - Partial payment pro-rata calculation:', {
                        dueDate: payment.due_date,
                        previousPaid: currentAmountPaid,
                        amountReversed: amountToDeduct,
                        newTotalPaid: newAmountPaid,
                        totalOwed: payment.amount,
                        coverageRatio: coverageRatio.toFixed(4),
                        cycleDays,
                        daysOfCoverage: Math.round(daysOfCoverage),
                        formula: `${payment.due_date} + ${Math.round(daysOfCoverage)} days`
                    });

                    // Always calculate from due_date to ensure consistency with payment recording
                    const paidUntilDate = addDays(parseISO(payment.due_date), Math.round(daysOfCoverage));
                    // CRITICAL: Store as date-only string (YYYY-MM-DD) to eliminate timezone drift
                    paidDate = format(paidUntilDate, 'yyyy-MM-dd');
                }
                // If Unpaid, paidDate remains null

                console.log(`🔙 Reversing payment:`, {
                    paymentId: payment.id,
                    dueDate: payment.due_date,
                    previousAmountPaid: currentAmountPaid,
                    amountToDeduct,
                    newAmountPaid,
                    newStatus
                });

                paymentsToUpdate.push({
                    id: payment.id,
                    status: newStatus,
                    paid_date: paidDate,
                    amount_paid: newAmountPaid
                });

                amountToReverse -= amountToDeduct;
            }

            // CRITICAL: If amountToReverse still has value, it means the original payment
            // had reduced opening_arrears. Add it back now.
            let newOpeningArrears = tenant.openingArrears || 0;

            console.log('🔍 VOID - After ledger reversal:', {
                amountStillToReverse: amountToReverse,
                currentOpeningArrears: tenant.openingArrears || 0,
                ledgerRecordsReversed: paymentsToUpdate.length,
                totalLedgerAmountReversed: paymentToVoid.amount - amountToReverse
            });

            if (amountToReverse > 0.01) {
                newOpeningArrears += amountToReverse;
                console.log('🔄 OPENING ARREARS REVERSAL (Void):', {
                    previousOpeningArrears: tenant.openingArrears || 0,
                    amountAddedBack: amountToReverse,
                    newOpeningArrears,
                    expectedOpeningArrears: 'Should match original pre-payment value'
                });
            } else {
                console.log('⚠️ VOID - No opening arrears to restore:', {
                    amountToReverse,
                    allReversalWentToLedger: true,
                    warning: 'If original payment reduced opening_arrears, this is a BUG!'
                });
            }

            // Update all affected payments
            // CRITICAL SAFEGUARD: NEVER update due_date - it must remain immutable
            for (const update of paymentsToUpdate) {
                // Double-check that due_date is not in the update object
                if ('due_date' in update) {
                    console.error('❌ CRITICAL ERROR: Attempted to update due_date in void!', update);
                    throw new Error('Cannot modify due_date - it must remain immutable');
                }

                const { error: updateError } = await supabase
                    .from('payments')
                    .update({
                        status: update.status,
                        paid_date: update.paid_date,
                        amount_paid: update.amount_paid
                        // CRITICAL: due_date is NEVER updated - it must remain immutable
                    })
                    .eq('id', update.id);

                if (updateError) {
                    console.error('❌ Failed to update payment:', update.id, updateError);
                    throw updateError;
                }

                console.log('✅ Reversed payment:', update.id);
            }

            // Remove payment from tenant's payment history AND restore opening_arrears
            const updatedHistory = paymentHistory.filter(p => p.id !== paymentId);

            const { error: historyUpdateError } = await supabase
                .from('tenants')
                .update({
                    payment_history: updatedHistory,
                    opening_arrears: newOpeningArrears // CRITICAL: Restore opening arrears if applicable
                })
                .eq('id', tenantId);

            if (historyUpdateError) {
                throw historyUpdateError;
            }

            console.log('✅ Opening arrears restored in database (if applicable):', {
                previousValue: tenant.openingArrears || 0,
                newValue: newOpeningArrears,
                increase: newOpeningArrears - (tenant.openingArrears || 0)
            });

            // CRITICAL VALIDATION: Math must be perfectly reversible
            const totalReversed = (paymentToVoid.amount - amountToReverse) + (newOpeningArrears - (tenant.openingArrears || 0));
            console.log('🧮 VOID - Reversal Math Validation:', {
                originalPaymentAmount: paymentToVoid.amount,
                ledgerReversalAmount: paymentToVoid.amount - amountToReverse,
                openingArrearsRestored: newOpeningArrears - (tenant.openingArrears || 0),
                totalReversed,
                shouldEqual: paymentToVoid.amount,
                mathCheck: totalReversed === paymentToVoid.amount ? '✅ PASS' : '❌ FAIL - MONEY CREATED/DESTROYED!'
            });

            // Log the void action
            await logToEvidenceLedger(
                property.id,
                tenantId,
                EVENT_TYPES.RENT_PAID,
                CATEGORIES.PAYMENT,
                `Payment voided: $${paymentToVoid.amount.toFixed(2)}`,
                `Payment of $${paymentToVoid.amount.toFixed(2)} from ${format(parseISO(paymentToVoid.date), 'MMM d, yyyy')} was voided. ${paymentsToUpdate.length} payment record(s) reversed.`,
                {
                    voidedAmount: paymentToVoid.amount,
                    voidedDate: paymentToVoid.date,
                    paymentId,
                    debtsReversed: paymentsToUpdate.length
                }
            );

            toast.success("Payment voided successfully");

            console.log('🔄 Refreshing data...');
            await fetchPayments();
            await fetchProperties();
            console.log('✅ Data refresh complete');

        } catch (error: any) {
            console.error('❌ Void payment error:', error);
            toast.error("Failed to void payment");
        }
    };

    // Add property
    const handleAddProperty = (newProperty: Property) => {
        setProperties(prev => [newProperty, ...prev]);
        toast.success("Property added to list");
    };

    // Add tenant to property
    const handleAddTenant = (propertyId: string) => {
        setSelectedPropertyId(propertyId);
        setIsAddTenantOpen(true);
    };

    // Save new tenant
    const handleSaveTenant = (tenant: Tenant) => {
        if (!selectedPropertyId) return;

        setProperties(prev => prev.map(prop =>
            prop.id === selectedPropertyId
                ? { ...prop, tenants: [...prop.tenants, tenant] }
                : prop
        ));

        setIsAddTenantOpen(false);
        setSelectedPropertyId(null);
        // Auto-generation will trigger automatically via useEffect when totalTenantCount changes
    };

    // Delete tenant
    const handleDeleteTenant = (tenantId: string) => {
        const tenant = properties.flatMap(p => p.tenants).find(t => t.id === tenantId);
        if (!tenant) return;

        setConfirmState({
            open: true,
            message: `Delete ${tenant.name}? This will remove all payment history.`,
            onConfirm: async () => {
                try {
                    // 1. Delete from Supabase
                    const { error } = await supabase
                        .from('tenants')
                        .delete()
                        .eq('id', tenantId);

                    if (error) throw error;

                    // 2. Update local state
                    setProperties(prev => prev.map(prop => ({
                        ...prop,
                        tenants: prop.tenants.filter(t => t.id !== tenantId)
                    })));
                    setPayments(prev => prev.filter(p => p.tenantId !== tenantId));

                    toast.success("Tenant deleted successfully");
                } catch (err: any) {
                    console.error("Error deleting tenant:", err);
                    toast.error(err.message || "Failed to delete tenant from database");
                } finally {
                    setConfirmState({ open: false, message: "", onConfirm: () => { } });
                }
            }
        });
    };

    // Delete property
    const handleDeleteProperty = (propertyId: string) => {
        const property = properties.find(p => p.id === propertyId);
        if (!property) return;

        setConfirmState({
            open: true,
            message: `Delete "${property.name}"? This will remove all ${property.tenants.length} tenant(s) inside.`,
            onConfirm: async () => {
                try {
                    // 1. Delete from Supabase (Cascaders should handle tenants if configured, but let's be safe or just rely on the DB cascade)
                    const { error } = await supabase
                        .from('properties')
                        .delete()
                        .eq('id', propertyId);

                    if (error) throw error;

                    // 2. Update local state
                    const tenantIds = property.tenants.map(t => t.id);
                    setProperties(prev => prev.filter(p => p.id !== propertyId));
                    setPayments(prev => prev.filter(p => !tenantIds.includes(p.tenantId)));

                    toast.success("Property deleted successfully");
                } catch (err: any) {
                    console.error("Error deleting property:", err);
                    toast.error(err.message || "Failed to delete property from database");
                } finally {
                    setConfirmState({ open: false, message: "", onConfirm: () => { } });
                }
            }
        });
    };

    // Update tenant
    const handleUpdateTenant = async (tenantId: string, updates: Partial<Tenant>) => {
        try {
            // Prepare database updates
            const dbUpdates: any = {};
            if (updates.name) {
                const parts = updates.name.trim().split(' ');
                dbUpdates.first_name = parts[0] || '';
                dbUpdates.last_name = parts.slice(1).join(' ') || '';
            }
            if (updates.email !== undefined) {
                dbUpdates.email = updates.email;
            }
            if (updates.phone !== undefined) {
                dbUpdates.phone = updates.phone;
            }
            if (updates.rentAmount !== undefined) {
                dbUpdates.weekly_rent = updates.rentAmount;
            }
            if (updates.tenant_address !== undefined) {
                dbUpdates.tenant_address = updates.tenant_address;
            }
            if (updates.startDate !== undefined) {
                // Fix: specific handling for empty strings to null for DATE types
                dbUpdates.lease_start_date = updates.startDate ? updates.startDate : null;
            }
            // Add other standard fields if they exist in schema
            if (updates.frequency !== undefined) (dbUpdates as any).rent_frequency = updates.frequency;
            if (updates.rentDueDay !== undefined) (dbUpdates as any).rent_due_day = updates.rentDueDay;

            // User-requested debug log
            console.log('🔧 Updating tenant with data:', {
                fields: dbUpdates,
                tenantId: tenantId
            });

            console.log("DEBUG: Tenant update starting for ID:", tenantId);
            console.log("DEBUG: Cumulative updates object:", updates);
            console.log("DEBUG: Final dbUpdates sent to Supabase:", dbUpdates);

            if (Object.keys(dbUpdates).length > 0) {
                const { error, data } = await supabase
                    .from('tenants')
                    .update(dbUpdates)
                    .eq('id', tenantId)
                    .select(); // select to see what was updated

                if (error) {
                    console.error("DEBUG: Supabase Update Error:", {
                        message: error.message,
                        details: error.details,
                        hint: error.hint,
                        code: error.code
                    });
                    throw error;
                }
                console.log("DEBUG: Supabase Update Success, data returned:", data);
            }

            setProperties(prev => prev.map(prop => ({
                ...prop,
                tenants: prop.tenants.map(t => t.id === tenantId ? { ...t, ...updates } : t)
            })));
            toast.success("Tenant updated");
        } catch (err: any) {
            console.error("Error updating tenant:", err);
            toast.error(`Failed to update tenant: ${err.message || 'Unknown error'}`);
        }
    };

    // Build portfolio status from unified tenant statuses
    const { obligations, globalSeverityRank } = useMemo(() => {
        const tenantObligations: Array<{ name: string; propertyAddress: string; daysLate: number; calendarDays?: number; activeStrikeCount: number }> = [];
        let maxRank = 1;

        properties.forEach(property => {
            property.tenants.forEach(tenant => {
                const status = tenantStatuses[tenant.id];
                if (!status) return;

                // Use severity tier directly from status-calculator
                const tierToRank: Record<number, number> = { 0: 1, 1: 2, 2: 3, 3: 4, 4: 4, 5: 5 };
                maxRank = Math.max(maxRank, tierToRank[status.severity.tier] ?? 1);

                // Collect obligations for the banner
                if (status.rentState.daysOverdue >= 1) {
                    tenantObligations.push({
                        name: tenant.name,
                        propertyAddress: property.address,
                        daysLate: status.workingDaysOverdue,
                        calendarDays: status.rentState.daysOverdue,
                        activeStrikeCount: status.strikes.activeStrikes,
                    });
                }
            });
        });

        return {
            obligations: getObligationMessages(tenantObligations),
            globalSeverityRank: maxRank as 1 | 2 | 3 | 4 | 5,
        };
    }, [properties, tenantStatuses]);

    const managingTenant = properties.flatMap(p => p.tenants).find(t => t.id === managingTenantId);
    const managingTenantPropertyId = properties.find(p => p.tenants.some(t => t.id === managingTenantId))?.id || "";
    const totalTenants = properties.reduce((acc, p) => acc + p.tenants.length, 0);

    return (
        <div className="min-h-screen bg-[#0B0E11]">
            {/* Command Center Header */}
            <div className="border-b border-white/5 bg-[#0B0E11]">
                <div className="max-w-7xl mx-auto px-6 py-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-black text-white tracking-tight">
                                Property Command Center
                            </h1>
                            <div className="flex items-center gap-4 mt-2 text-xs font-bold text-white/40">
                                <div className="flex items-center gap-1.5">
                                    <Building2 className="w-3.5 h-3.5" />
                                    {properties.length} Properties
                                </div>
                                <div className="w-1 h-1 rounded-full bg-white/20" />
                                <div className="flex items-center gap-1.5">
                                    <Users className="w-3.5 h-3.5" />
                                    {totalTenants} Tenants
                                </div>
                            </div>
                        </div>

                        {/* TESTING ONLY: Date Override */}
                        <div className="flex items-center gap-3 px-4 py-2 bg-[#FF3B3B]/10 rounded-xl border border-[#FF3B3B]/20">
                            <AlertCircle className="w-4 h-4 text-[#FF3B3B]" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-[#FF3B3B] hidden sm:inline">Test Mode</span>
                            {isMounted && (
                                <input
                                    type="date"
                                    value={testDate ? format(testDate, 'yyyy-MM-dd') : ""}
                                    onChange={(e) => setTestDate(e.target.value ? parseISO(e.target.value) : null)}
                                    className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs font-bold text-white focus:outline-none focus:ring-1 focus:ring-[#FF3B3B]/50"
                                />
                            )}
                            {testDate && (
                                <>
                                    <button
                                        onClick={() => setTestDate(null)}
                                        className="text-[10px] font-black uppercase tracking-widest text-[#FF3B3B] hover:text-[#FF3B3B]/80"
                                    >
                                        Reset
                                    </button>
                                    <button
                                        onClick={async () => {
                                            setIsSyncingLedger(true);
                                            console.log('🔄 MANUAL SYNC TRIGGERED:', {
                                                currentTestDate: testDate ? format(testDate, 'yyyy-MM-dd') : 'None',
                                                description: 'Simulating Roadmap Item #3 Cron Job - Running Watchdog'
                                            });
                                            await autoGeneratePayments();
                                            toast.success("Ledger synced successfully");
                                            setIsSyncingLedger(false);
                                        }}
                                        disabled={isSyncingLedger}
                                        className="text-[10px] font-black uppercase tracking-widest bg-[#00FFBB]/10 text-[#00FFBB] px-3 py-1 rounded-lg border border-[#00FFBB]/30 hover:bg-[#00FFBB]/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                    >
                                        {isSyncingLedger ? (
                                            <>
                                                <Loader2 className="w-3 h-3 inline mr-1 animate-spin" />
                                                Syncing...
                                            </>
                                        ) : (
                                            'Sync Ledger'
                                        )}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content - Full Width Command Center */}
            <div className="max-w-7xl mx-auto px-6 py-8">
                {/* Global Portfolio Severity Banner (Rank 1-5 with "CHOICE!" for all-paid state) */}
                <UpcomingObligations obligations={obligations} globalSeverityRank={globalSeverityRank} />

                {loading ? (
                    <div className="py-20 flex flex-col items-center justify-center space-y-4">
                        <Loader2 className="w-10 h-10 text-white/30 animate-spin" />
                        <p className="text-sm font-bold text-white/40 uppercase tracking-widest">Loading Properties...</p>
                    </div>
                ) : error ? (
                    <div className="py-20 text-center space-y-4">
                        <div className="w-20 h-20 bg-[#FF3B3B]/10 rounded-full flex items-center justify-center mx-auto text-[#FF3B3B]">
                            <AlertCircle className="w-10 h-10" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-white">Connection Error</h3>
                            <p className="text-white/50 mt-2">{error}</p>
                        </div>
                        <Button
                            onClick={() => window.location.reload()}
                            variant="brand-secondary"
                            size="brand"
                            className="mt-4 rounded-xl"
                        >
                            Retry Connection
                        </Button>
                    </div>
                ) : properties.length === 0 ? (
                    <div className="py-20 text-center space-y-4">
                        <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mx-auto text-white/30">
                            <Building2 className="w-10 h-10" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-white">No properties yet</h3>
                            <p className="text-white/50 mt-2">Add your first property to start tracking rent.</p>
                        </div>
                        <Button
                            onClick={() => setIsAddPropertyOpen(true)}
                            variant="brand-success"
                            size="brand"
                            className="mt-4 rounded-xl"
                        >
                            Get Started
                        </Button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {properties.map(property => (
                            <PropertyCard
                                key={property.id}
                                property={property}
                                payments={payments}
                                tenantStatuses={tenantStatuses}
                                testDate={testDate || undefined}
                                onRecordPayment={handleRecordPayment}
                                onVoidPayment={handleVoidPayment}
                                onManageTenant={(tid) => setManagingTenantId(tid)}
                                onDeleteTenant={handleDeleteTenant}
                                onAddTenant={handleAddTenant}
                                onDeleteProperty={handleDeleteProperty}
                            />
                        ))}
                    </div>
                )}

                {/* Management Dialogs */}
                <AddPropertyDialog
                    open={isAddPropertyOpen}
                    onOpenChange={setIsAddPropertyOpen}
                    onAdd={handleAddProperty}
                />

                <AddTenantDialog
                    open={isAddTenantOpen}
                    onOpenChange={setIsAddTenantOpen}
                    propertyId={selectedPropertyId || ""}
                    propertyAddress={properties.find(p => p.id === selectedPropertyId)?.address || ""}
                    onAdd={handleSaveTenant}
                />

                {managingTenant && (
                    <ManageTenantDialog
                        open={!!managingTenantId}
                        onOpenChange={(open) => !open && setManagingTenantId(null)}
                        tenant={managingTenant}
                        propertyId={managingTenantPropertyId}
                        onUpdate={handleUpdateTenant}
                        onDelete={() => handleDeleteTenant(managingTenantId!)}
                        onRefreshData={fetchProperties}
                    />
                )}

                <ConfirmationDialog
                    open={confirmState.open}
                    onOpenChange={(open) => !open && setConfirmState({ open: false, message: "", onConfirm: () => { } })}
                    title="Confirm Action"
                    description={confirmState.message}
                    onConfirm={confirmState.onConfirm}
                />
            </div>

            {/* Floating Action Button - Neon Mint */}
            <Button
                variant="brand-accent"
                size="brand"
                onClick={() => setIsAddPropertyOpen(true)}
                className="fixed bottom-24 right-4 hover:scale-105 z-40"
            >
                <Plus className="w-4 h-4" />
                ADD PROPERTY
            </Button>
        </div>
    );
}
