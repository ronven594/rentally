"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { PropertyCard } from "@/components/dashboard/PropertyCard"
import { AddTenantDialog } from "@/components/dashboard/AddTenantDialog"
import { AddPropertyDialog } from "@/components/dashboard/AddPropertyDialog"
import { ManageTenantDialog } from "@/components/dashboard/ManageTenantDialog"
import { ConfirmationDialog } from "@/components/dashboard/ConfirmationDialog"
import { Property, Tenant, RentPayment, PaymentStatus, PaymentFrequency, PaymentHistoryEntry } from "@/types"
import { differenceInCalendarDays, parseISO, format, addDays, addMonths, startOfDay } from "date-fns"
import { calculateDueDates } from "@/lib/payment-automation"
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
                    const { data: existingPayments, error: fetchError } = await supabase
                        .from('payments')
                        .select('id, due_date, status')
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

                    // Simplified Generation Logic (Only on Day 7)
                    const tenantPayments = payments.filter(p => p.tenantId === tenant.id)
                        .sort((a, b) => parseISO(b.dueDate).getTime() - parseISO(a.dueDate).getTime());

                    const mostRecentPayment = tenantPayments[0];
                    let dueDates: string[] = [];

                    if (!mostRecentPayment) {
                        // First payment generation: use TRACKING START DATE as start point
                        const generationStartDate = parseISO(effectiveTrackingStart);
                        dueDates = calculateDueDates(
                            tenant.frequency,
                            tenant.rentDueDay,
                            testDate || new Date(),
                            generationStartDate
                        );
                        console.log(`🆕 First payment generation for ${tenant.name} from tracking start ${effectiveTrackingStart}:`, dueDates);
                    } else {
                        const todayDate = testDate || new Date();
                        const daysFromDueDate = differenceInCalendarDays(todayDate, parseISO(mostRecentPayment.dueDate));

                        console.log('💰 GENERATION CHECK:', {
                            tenant: tenant.name,
                            mostRecentDueDate: mostRecentPayment.dueDate,
                            daysFromDueDate,
                            status: mostRecentPayment.status
                        });

                        // Only generate next if we hit the trigger day (and current is Paid OR we're in test mode)
                        // Trigger days: Weekly = 7, Fortnightly = 14, Monthly = 28
                        const triggerDay = tenant.frequency === 'Monthly' ? 28 : tenant.frequency === 'Fortnightly' ? 14 : 7;
                        const isTestMode = testDate !== null;
                        const shouldGenerate = isTestMode
                            ? daysFromDueDate >= triggerDay
                            : (daysFromDueDate >= triggerDay && mostRecentPayment.status === 'Paid');

                        if (shouldGenerate) {
                            const todayNormalized = startOfDay(todayDate);

                            // Generate ALL missing payments up to today, not just the next one
                            let nextDate = tenant.frequency === 'Monthly'
                                ? addMonths(parseISO(mostRecentPayment.dueDate), 1)
                                : addDays(parseISO(mostRecentPayment.dueDate), tenant.frequency === 'Fortnightly' ? 14 : 7);

                            while (startOfDay(nextDate) <= todayNormalized) {
                                dueDates.push(format(nextDate, 'yyyy-MM-dd'));
                                nextDate = tenant.frequency === 'Monthly'
                                    ? addMonths(nextDate, 1)
                                    : addDays(nextDate, tenant.frequency === 'Fortnightly' ? 14 : 7);
                            }

                            console.log(`📅 Day ${triggerDay}+ reached! Auto-generating ${dueDates.length} payment(s) for ${tenant.name}${isTestMode ? ' (TEST MODE)' : ''}:`, dueDates);
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

            // Apply payment to oldest debts first
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
                    // Partial payment: advance proportionally by the DELTA only
                    // Formula: AdditionalDays = (AmountToApply / CycleRentAmount) * CycleDays
                    const cycleDays = getCycleDays(tenant.frequency);
                    const additionalCoverageRatio = amountToApply / payment.amount; // Only the NEW payment
                    const additionalDays = additionalCoverageRatio * cycleDays;

                    // CRITICAL: Use Math.round() to minimize rounding error accumulation
                    // Start from CURRENT paid_date (or due_date if first payment)
                    const startDate = payment.paid_date ? parseISO(payment.paid_date) : parseISO(payment.due_date);
                    const paidUntilDate = addDays(startDate, Math.round(additionalDays));
                    // CRITICAL: Store as date-only string (YYYY-MM-DD) to eliminate timezone drift
                    paidDate = format(paidUntilDate, 'yyyy-MM-dd');
                }

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

            // Update all payments in database
            for (const update of paymentsToUpdate) {
                const { error: updateError } = await supabase
                    .from('payments')
                    .update({
                        status: update.status,
                        paid_date: update.paid_date,
                        amount_paid: update.amount_paid // CRITICAL: Update this column
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

            // Update tenant's paymentHistory in database
            const currentHistory = tenant.paymentHistory || [];
            const updatedHistory = [paymentHistoryEntry, ...currentHistory];

            const { error: historyUpdateError } = await supabase
                .from('tenants')
                .update({ payment_history: updatedHistory })
                .eq('id', tenantId);

            if (historyUpdateError) {
                console.error('⚠️ Failed to update payment history:', historyUpdateError);
                // Don't throw - payment was recorded, history is just a nice-to-have
            }

            toast.success("Payment recorded successfully");

            console.log('🔄 Refreshing data...');
            await fetchPayments();
            await fetchProperties();
            console.log('✅ Data refresh complete');

        } catch (error: any) {
            console.error('❌ Record payment error:', error);
            toast.error("Failed to record payment");
        }
    };

    // Void a payment (reverse payment reconciliation)
    const handleVoidPayment = async (tenantId: string, paymentId: string) => {
        try {
            console.log('🔄 VOID PAYMENT:', { tenantId, paymentId });

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

            for (const payment of allPayments) {
                if (amountToReverse <= 0.01) break;

                const currentAmountPaid = payment.amount_paid || 0;
                if (currentAmountPaid <= 0) continue; // Skip unpaid payments

                // How much can we reverse from this payment?
                const amountToDeduct = Math.min(amountToReverse, currentAmountPaid);
                const newAmountPaid = currentAmountPaid - amountToDeduct;

                // Determine new status
                const isFullyPaid = newAmountPaid >= (payment.amount - 0.01);
                const newStatus = newAmountPaid <= 0.01 ? 'Unpaid' : isFullyPaid ? 'Paid' : 'Partial';

                // Recalculate paid_date by SUBTRACTING the delta
                let paidDate: string | null = null;

                if (newStatus === 'Paid') {
                    // Still fully paid: paid_date stays the same
                    paidDate = payment.paid_date;
                } else if (newStatus === 'Partial') {
                    // Was fully paid, now partial: subtract the reversed amount's days
                    const cycleDays = getCycleDays(tenant.frequency);
                    const reversedCoverageRatio = amountToDeduct / payment.amount;
                    const daysToSubtract = reversedCoverageRatio * cycleDays;

                    // CRITICAL: Subtract from CURRENT paid_date, use Math.round() for precision
                    if (payment.paid_date) {
                        const currentPaidDate = parseISO(payment.paid_date);
                        const newPaidUntilDate = addDays(currentPaidDate, -Math.round(daysToSubtract));
                        // CRITICAL: Store as date-only string (YYYY-MM-DD) to eliminate timezone drift
                        paidDate = format(newPaidUntilDate, 'yyyy-MM-dd');
                    } else {
                        // Fallback: shouldn't happen, but recalculate from due_date if no paid_date
                        const dueDateObj = parseISO(payment.due_date);
                        const coverageRatio = newAmountPaid / payment.amount;
                        const daysToAdd = coverageRatio * cycleDays;
                        const paidUntilDate = addDays(dueDateObj, Math.round(daysToAdd));
                        // CRITICAL: Store as date-only string (YYYY-MM-DD) to eliminate timezone drift
                        paidDate = format(paidUntilDate, 'yyyy-MM-dd');
                    }
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

            // Update all affected payments
            for (const update of paymentsToUpdate) {
                const { error: updateError } = await supabase
                    .from('payments')
                    .update({
                        status: update.status,
                        paid_date: update.paid_date,
                        amount_paid: update.amount_paid
                    })
                    .eq('id', update.id);

                if (updateError) {
                    console.error('❌ Failed to update payment:', update.id, updateError);
                    throw updateError;
                }

                console.log('✅ Reversed payment:', update.id);
            }

            // Remove payment from tenant's payment history
            const updatedHistory = paymentHistory.filter(p => p.id !== paymentId);

            const { error: historyUpdateError } = await supabase
                .from('tenants')
                .update({ payment_history: updatedHistory })
                .eq('id', tenantId);

            if (historyUpdateError) {
                throw historyUpdateError;
            }

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

    // Build portfolio status from legal statuses
    const { obligations, globalSeverityRank } = useMemo(() => {
        const tenantObligations: Array<{ name: string; propertyAddress: string; daysLate: number; calendarDays?: number; activeStrikeCount: number }> = [];
        let maxRank = 1; // Start with lowest severity

        properties.forEach(property => {
            property.tenants.forEach(tenant => {
                const legalStatus = tenantLegalStatuses[tenant.id];
                if (!legalStatus) return;

                // Calculate severity rank for this tenant (same logic as PropertyCard)
                const { daysOverdue, workingDaysOverdue, totalBalanceDue, activeStrikeCount = 0 } = legalStatus;

                // Skip if paid
                if (totalBalanceDue > 0) {
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
                }

                // Collect obligations for the banner
                // Include ALL overdue states: Payment Pending (0 strikes), Strike 1, Strike 2+
                if (legalStatus.daysOverdue >= 1) {
                    tenantObligations.push({
                        name: tenant.name,
                        propertyAddress: property.address,
                        daysLate: legalStatus.workingDaysOverdue,  // Use working days for legal compliance
                        calendarDays: legalStatus.daysOverdue,     // Calendar days for Monitor phase display
                        activeStrikeCount: legalStatus.activeStrikeCount || 0, // CRITICAL: Strike count for severity
                    });
                }
            });
        });

        return {
            obligations: getObligationMessages(tenantObligations),
            globalSeverityRank: maxRank as 1 | 2 | 3 | 4 | 5,
        };
    }, [properties, tenantLegalStatuses]);

    const managingTenant = properties.flatMap(p => p.tenants).find(t => t.id === managingTenantId);
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
                                <button
                                    onClick={() => setTestDate(null)}
                                    className="text-[10px] font-black uppercase tracking-widest text-[#FF3B3B] hover:text-[#FF3B3B]/80"
                                >
                                    Reset
                                </button>
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
                                tenantLegalStatuses={tenantLegalStatuses}
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
                        onUpdate={handleUpdateTenant}
                        onDelete={() => handleDeleteTenant(managingTenantId!)}
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
