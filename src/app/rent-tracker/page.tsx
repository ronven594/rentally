"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { PropertyCard } from "@/components/dashboard/PropertyCard"
import { AddTenantDialog } from "@/components/dashboard/AddTenantDialog"
import { AddPropertyDialog } from "@/components/dashboard/AddPropertyDialog"
import { ManageTenantDialog } from "@/components/dashboard/ManageTenantDialog"
import { ConfirmationDialog } from "@/components/dashboard/ConfirmationDialog"
import { Property, Tenant, RentPayment, PaymentStatus } from "@/types"
import { differenceInCalendarDays, parseISO, format, addDays, startOfDay } from "date-fns"
import { calculateDueDates } from "@/lib/payment-automation"
import { logToEvidenceLedger, EVENT_TYPES, CATEGORIES } from "@/services/evidenceLedger"
import { Plus, Building2, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { supabase } from "@/lib/supabaseClient"
import { usePathname } from "next/navigation"
import { useAuth } from "@/contexts/AuthContext"

// Initial Properties with Tenants
const INITIAL_PROPERTIES: Property[] = [];

export default function RentTrackerPage() {
    const { profile } = useAuth();
    const [properties, setProperties] = useState<Property[]>([]);
    const [payments, setPayments] = useState<RentPayment[]>([]);
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
                        rentDueDay: t.rent_due_day || "Wednesday",
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

    // Auto-generate payment records for all tenants
    const autoGeneratePayments = async () => {
        if (properties.length === 0) return;

        console.log('🔄 Starting automatic payment generation...');
        let totalGenerated = 0;

        for (const property of properties) {
            for (const tenant of property.tenants) {
                // Skip if no lease start date
                if (!tenant.startDate) {
                    console.warn(`⚠️ Skipping ${tenant.name}: No lease start date`);
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
                        leaseStartDate: tenant.startDate || 'Not provided',
                        todayDate: format(testDate || new Date(), 'yyyy-MM-dd'),
                        rentDueDay: tenant.rentDueDay,
                        existingPaymentsInDB: existingPayments,
                        calculationStartDate: 'TODAY (Lease Start Ignored)'
                    });

                    // Simplified Generation Logic (Only on Day 7)
                    const tenantPayments = payments.filter(p => p.tenantId === tenant.id)
                        .sort((a, b) => parseISO(b.dueDate).getTime() - parseISO(a.dueDate).getTime());

                    const mostRecentPayment = tenantPayments[0];
                    let dueDates: string[] = [];

                    if (!mostRecentPayment) {
                        // First payment generation: use TODAY as start point
                        dueDates = calculateDueDates(
                            tenant.frequency,
                            tenant.rentDueDay,
                            testDate || new Date(),
                            testDate || new Date()
                        );
                        console.log(`🆕 First payment generation for ${tenant.name}:`, dueDates);
                    } else {
                        const todayDate = testDate || new Date();
                        const daysFromDueDate = differenceInCalendarDays(todayDate, parseISO(mostRecentPayment.dueDate));

                        console.log('💰 GENERATION CHECK:', {
                            tenant: tenant.name,
                            mostRecentDueDate: mostRecentPayment.dueDate,
                            daysFromDueDate,
                            status: mostRecentPayment.status
                        });

                        // Only generate next if we hit Day 7 (and current is Paid OR we're in test mode)
                        // This corresponds to the user's "Every Sunday" requirement
                        // When testDate is active, allow generation even if unpaid (for testing scenarios)
                        const triggerDay = tenant.frequency === 'Fortnightly' ? 14 : 7;
                        const isTestMode = testDate !== null;
                        const shouldGenerate = isTestMode
                            ? daysFromDueDate >= triggerDay
                            : (daysFromDueDate >= triggerDay && mostRecentPayment.status === 'Paid');

                        if (shouldGenerate) {
                            const interval = tenant.frequency === 'Fortnightly' ? 14 : 7;
                            const todayNormalized = startOfDay(todayDate);

                            // Generate ALL missing payments up to today, not just the next one
                            let nextDate = addDays(parseISO(mostRecentPayment.dueDate), interval);
                            while (startOfDay(nextDate) <= todayNormalized) {
                                dueDates.push(format(nextDate, 'yyyy-MM-dd'));
                                nextDate = addDays(nextDate, interval);
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
                testDate: testDate ? format(testDate, 'yyyy-MM-dd') : 'current date'
            });
            autoGeneratePayments();
        }
    }, [properties.length, totalTenantCount, loading, testDate]); // Include testDate to re-generate when date changes

    // Helper to get tenant state
    const getTenantState = useCallback((tenantId: string) => {
        // Find ALL unpaid payments for this tenant
        const unpaidPayments = payments.filter(p => p.tenantId === tenantId && (p.status === "Unpaid" || p.status === "Partial"));

        if (unpaidPayments.length === 0) return { isUnpaid: false, totalArrears: 0 };

        const today = testDate || new Date();
        const pastDueUnpaid = unpaidPayments.filter(p => {
            const due = parseISO(p.dueDate);
            return differenceInCalendarDays(today, due) >= 0;
        });

        const totalArrears = unpaidPayments.reduce((sum, p) => sum + (p.amount - (p.amount_paid || 0)), 0);

        return {
            isUnpaid: pastDueUnpaid.length > 0,
            totalArrears
        };
    }, [payments, testDate]);

    // Record Payment (Oldest Dollar First)
    const handleRecordPayment = async (tenantId: string, paymentAmount: number) => {
        try {
            console.log('💰 RECORD PAYMENT:', {
                tenantId,
                paymentAmount
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
                const paidDate = isFullyPaid ? new Date().toISOString() : null;

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

    // Build state maps for PropertyCard reactively
    const { tenantStates } = useMemo(() => {
        const states: Record<string, { isUnpaid: boolean; totalArrears: number }> = {};

        properties.forEach(property => {
            property.tenants.forEach(tenant => {
                states[tenant.id] = getTenantState(tenant.id);
            });
        });

        return { tenantStates: states };
    }, [properties, payments, testDate, getTenantState]);

    const managingTenant = properties.flatMap(p => p.tenants).find(t => t.id === managingTenantId);
    const totalTenants = properties.reduce((acc, p) => acc + p.tenants.length, 0);

    return (
        <div className="min-h-screen pb-20">
            {/* Clinical Top Bar */}
            <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-slate-50">
                <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-black text-slate-900 tracking-tighter uppercase">Overview</span>
                        </div>
                        <div className="h-4 w-px bg-slate-100" />
                        <div className="flex items-center gap-4 text-xs font-bold text-slate-400">
                            <div className="flex items-center gap-1.5">
                                <Building2 className="w-3.5 h-3.5" />
                                {properties.length} Properties
                            </div>
                            <div className="flex items-center gap-1.5">
                                <Users className="w-3.5 h-3.5" />
                                {totalTenants} Tenants
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={() => setIsAddPropertyOpen(true)}
                        className="h-10 px-5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-bold flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-slate-200"
                    >
                        <Plus className="w-4 h-4" />
                        Add Property
                    </button>
                </div>
            </div>

            {/* TESTING ONLY: Date Override */}
            <div className="bg-rose-50 border-b border-rose-100 py-2 px-6">
                <div className="max-w-4xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-rose-500" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-rose-600">Testing Only: Date Override</span>
                    </div>
                    <div className="flex items-center gap-3">
                        {isMounted && (
                            <input
                                type="date"
                                value={testDate ? format(testDate, 'yyyy-MM-dd') : ""}
                                onChange={(e) => setTestDate(e.target.value ? parseISO(e.target.value) : null)}
                                className="bg-white border border-rose-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-rose-400"
                            />
                        )}
                        {testDate && (
                            <button
                                onClick={() => setTestDate(null)}
                                className="text-[10px] font-black uppercase tracking-widest text-rose-500 hover:text-rose-700 underline"
                            >
                                Reset to Today
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className="max-w-4xl mx-auto px-6 py-10">
                {loading ? (
                    <div className="py-20 flex flex-col items-center justify-center space-y-4">
                        <Loader2 className="w-10 h-10 text-slate-300 animate-spin" />
                        <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Loading Properties...</p>
                    </div>
                ) : error ? (
                    <div className="py-20 text-center space-y-4">
                        <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mx-auto text-rose-500">
                            <AlertCircle className="w-10 h-10" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-slate-900">Connection Error</h3>
                            <p className="text-slate-500 mt-2">{error}</p>
                        </div>
                        <Button
                            onClick={() => window.location.reload()}
                            variant="secondary"
                            className="mt-4 rounded-xl font-bold"
                        >
                            Retry Connection
                        </Button>
                    </div>
                ) : properties.length === 0 ? (
                    <div className="py-20 text-center space-y-4">
                        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300">
                            <Building2 className="w-10 h-10" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-slate-900">No properties yet</h3>
                            <p className="text-slate-500 mt-2">Add your first property to start tracking rent.</p>
                        </div>
                        <Button
                            onClick={() => setIsAddPropertyOpen(true)}
                            variant="secondary"
                            className="mt-4 rounded-xl font-bold"
                        >
                            Get Started
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {properties.map(property => (
                            <PropertyCard
                                key={property.id}
                                property={property}
                                payments={payments}
                                tenantStates={tenantStates}
                                testDate={testDate || undefined}
                                onRecordPayment={handleRecordPayment}
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
        </div>
    );
}
