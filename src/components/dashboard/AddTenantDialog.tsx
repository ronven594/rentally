"use client"

import { useState, useEffect } from "react"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tenant, PaymentFrequency } from "@/types"
import { User, Mail, Phone, Calendar, Loader2, UserPlus } from "lucide-react"
import { supabase } from "@/lib/supabaseClient"
import { toast } from "sonner"
import { format, addDays, addWeeks, addMonths, parseISO } from "date-fns"
import { resolveTenantStatus, applyResolvedStatus } from "@/lib/tenant-status-resolver"

interface AddTenantDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    propertyId: string;
    propertyAddress: string;
    onAdd: (tenant: Tenant) => void;
}

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => (i + 1).toString());

export function AddTenantDialog({ open, onOpenChange, propertyId, propertyAddress, onAdd }: AddTenantDialogProps) {
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [address, setAddress] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [amount, setAmount] = useState("");
    const [frequency, setFrequency] = useState<PaymentFrequency>("Weekly");
    const [dueDay, setDueDay] = useState("Wednesday");
    const [dueDayOfMonth, setDueDayOfMonth] = useState("1");

    // Simplified onboarding: Toggle-based tracking
    const [trackFromToday, setTrackFromToday] = useState(true); // Default: Start tracking from today
    const [leaseStartDate, setLeaseStartDate] = useState(""); // When tenant actually moved in (optional, for reference)
    const [customTrackingDate, setCustomTrackingDate] = useState(""); // If tracking from past date
    const [existingBalance, setExistingBalance] = useState("0"); // Pre-existing debt (if backdating)
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (open) {
            setAddress(propertyAddress);
        }
    }, [open, propertyAddress]);

    // Get the rent label based on frequency
    const getRentLabel = () => {
        switch (frequency) {
            case "Weekly": return "Weekly Rent ($)";
            case "Fortnightly": return "Fortnightly Rent ($)";
            case "Monthly": return "Monthly Rent ($)";
        }
    };

    // Get the effective due day based on frequency
    const getEffectiveDueDay = () => {
        return frequency === "Monthly" ? dueDayOfMonth : dueDay;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        const effectiveDueDay = getEffectiveDueDay();

        try {
            // Determine tracking start date and opening balance based on toggle
            const finalTrackingStartDate = trackFromToday
                ? format(new Date(), 'yyyy-MM-dd') // Track from today
                : customTrackingDate; // Track from custom past date

            const finalOpeningBalance = trackFromToday
                ? 0 // No existing debt if tracking from today
                : Number(existingBalance) || 0; // Use specified existing balance if backdating

            console.log('🔍 SAVING TENANT:', {
                frequency,
                dueDay: effectiveDueDay,
                amount: Number(amount),
                trackFromToday,
                trackingStartDate: finalTrackingStartDate,
                openingBalance: finalOpeningBalance
            });

            const { data, error } = await supabase
                .from('tenants')
                .insert({
                    property_id: propertyId,
                    first_name: firstName.trim(),
                    last_name: lastName.trim(),
                    email: email || "",
                    phone: phone || "",
                    lease_start_date: leaseStartDate || null, // Optional: actual lease start date (for reference)
                    tracking_start_date: finalTrackingStartDate, // Required: when we started tracking
                    opening_arrears: 0, // CRITICAL: Set to 0 because opening arrears are materialized as payment records below
                    weekly_rent: Number(amount), // This stores the rent amount regardless of frequency
                    tenant_address: address,
                    is_active: true,
                    rent_due_day: effectiveDueDay,
                    rent_frequency: frequency
                })
                .select()
                .single();

            if (error) throw error;

            if (data) {
                // =====================================================================
                // AI STATUS RESOLVER: Smart Payment Generation
                // =====================================================================
                // CRITICAL LOGIC:
                // If user says tenant is "$600 behind", we assume:
                // - The tenant was PAYING older periods (historical payments)
                // - They only fell behind on RECENT periods
                //
                // NEW APPROACH:
                // 1. Generate ALL payment records from tracking start to today
                // 2. Insert them all as Unpaid initially
                // 3. Use AI Resolver to determine which should be marked Paid
                // 4. Apply the resolved status
                //
                // Example: $600 behind, $400/fortnight, tracking Nov 1, today Jan 26
                //   - Generate ALL periods: Nov 7, Nov 21, Dec 5, Dec 19, Jan 2, Jan 16
                //   - Total if all unpaid: $2400
                //   - But user said only $600 behind
                //   - Resolver marks Nov 7-Dec 19 as Paid ($1800)
                //   - Leaves Jan 2-16 as Unpaid ($600)
                //   - "Overdue since Jan 2" ✅
                // =====================================================================

                if (finalTrackingStartDate) {
                    const rentAmount = Number(amount);
                    const today = new Date();
                    const trackingStart = parseISO(finalTrackingStartDate);

                    console.log('🤖 AI STATUS RESOLVER - Generating payment cycle:', {
                        tenantName: `${firstName} ${lastName}`,
                        openingBalance: finalOpeningBalance,
                        rentAmount,
                        frequency,
                        trackingStartDate: finalTrackingStartDate,
                        rentDueDay: effectiveDueDay,
                        today: format(today, 'yyyy-MM-dd'),
                        strategy: 'Generate ALL periods from tracking start, then use AI resolver'
                    });

                    // Generate all due dates from tracking start to today
                    const allDueDates: Date[] = [];
                    let currentDueDate: Date;

                    // Find first due date based on frequency
                    if (frequency === 'Monthly') {
                        // For Monthly: Find first occurrence of rentDueDay on or after tracking start
                        const dayOfMonth = parseInt(effectiveDueDay, 10) || 1;
                        const trackingMonth = trackingStart.getMonth();
                        const trackingYear = trackingStart.getFullYear();

                        const lastDayOfMonth = new Date(trackingYear, trackingMonth + 1, 0).getDate();
                        const effectiveDay = Math.min(dayOfMonth, lastDayOfMonth);
                        currentDueDate = new Date(trackingYear, trackingMonth, effectiveDay);

                        // If that's before tracking start, move to next month
                        if (currentDueDate < trackingStart) {
                            const nextMonth = addMonths(currentDueDate, 1);
                            const nextMonthLastDay = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
                            const nextMonthEffectiveDay = Math.min(dayOfMonth, nextMonthLastDay);
                            currentDueDate = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), nextMonthEffectiveDay);
                        }
                    } else {
                        // For Weekly/Fortnightly: Find first occurrence of rentDueDay on or after tracking start
                        // DAYS_OF_WEEK = ["Monday", "Tuesday", ..., "Sunday"]
                        const targetDayIndex = DAYS_OF_WEEK.indexOf(effectiveDueDay);
                        const targetJsDay = targetDayIndex === 6 ? 0 : targetDayIndex + 1;
                        const trackingStartJsDay = trackingStart.getDay();

                        // Calculate days to add to reach target day of week
                        let daysToAdd = (targetJsDay - trackingStartJsDay + 7) % 7;

                        currentDueDate = addDays(trackingStart, daysToAdd);

                        console.log('📅 Finding first due date for Weekly/Fortnightly:', {
                            trackingStart: format(trackingStart, 'yyyy-MM-dd (EEEE)'),
                            targetDay: effectiveDueDay,
                            daysToAdd,
                            firstDueDate: format(currentDueDate, 'yyyy-MM-dd (EEEE)')
                        });
                    }

                    // Generate all due dates up to today
                    const maxIterations = 520; // Safety limit
                    let iterations = 0;

                    while (currentDueDate <= today && iterations < maxIterations) {
                        allDueDates.push(new Date(currentDueDate));
                        iterations++;

                        // Advance by frequency
                        if (frequency === 'Weekly') {
                            currentDueDate = addWeeks(currentDueDate, 1);
                        } else if (frequency === 'Fortnightly') {
                            currentDueDate = addWeeks(currentDueDate, 2);
                        } else if (frequency === 'Monthly') {
                            const dayOfMonth = parseInt(effectiveDueDay, 10) || 1;
                            const nextMonth = addMonths(currentDueDate, 1);
                            const lastDayOfNextMonth = new Date(
                                nextMonth.getFullYear(),
                                nextMonth.getMonth() + 1,
                                0
                            ).getDate();
                            const effectiveDay = Math.min(dayOfMonth, lastDayOfNextMonth);
                            currentDueDate = new Date(
                                nextMonth.getFullYear(),
                                nextMonth.getMonth(),
                                effectiveDay
                            );
                        }
                    }

                    console.log('📅 Generated ALL payment periods:', {
                        totalPeriods: allDueDates.length,
                        firstDueDate: allDueDates.length > 0 ? format(allDueDates[0], 'yyyy-MM-dd') : 'None',
                        lastDueDate: allDueDates.length > 0 ? format(allDueDates[allDueDates.length - 1], 'yyyy-MM-dd') : 'None',
                        totalPotentialDebt: allDueDates.length * rentAmount
                    });

                    // =====================================================================
                    // STEP 1: Create ALL payment records as Unpaid initially
                    // =====================================================================
                    const allPaymentRecords = allDueDates.map(dueDate => ({
                        tenant_id: data.id,
                        property_id: propertyId,
                        due_date: format(dueDate, 'yyyy-MM-dd'),
                        amount: rentAmount,
                        status: 'Unpaid' as const,
                        amount_paid: 0,
                        paid_date: null
                    }));

                    console.log('📝 Creating ALL payment records initially as Unpaid:', {
                        totalRecords: allPaymentRecords.length,
                        totalDebtIfAllUnpaid: allPaymentRecords.length * rentAmount
                    });

                    const { data: insertedPayments, error: paymentError } = await supabase
                        .from('payments')
                        .insert(allPaymentRecords)
                        .select();

                    if (paymentError) {
                        console.error('❌ Failed to create payment records:', paymentError);
                        toast.error('Tenant created but payment records failed. Please add manually.');
                        return;
                    }

                    console.log('✅ Payment records created successfully');

                    // =====================================================================
                    // STEP 2: Use AI Status Resolver to determine which are actually unpaid
                    // =====================================================================
                    if (finalOpeningBalance > 0 && insertedPayments && insertedPayments.length > 0) {
                        console.log('🤖 Running AI Status Resolver...');

                        const resolvedStatus = resolveTenantStatus(
                            insertedPayments.map(p => ({
                                id: p.id,
                                due_date: p.due_date,
                                amount: p.amount,
                                status: p.status,
                                amount_paid: p.amount_paid
                            })),
                            {
                                trackingStartDate: finalTrackingStartDate,
                                openingBalance: finalOpeningBalance,
                                rentAmount,
                                frequency
                            },
                            today
                        );

                        console.log('🎯 Resolver result:', resolvedStatus);

                        // =====================================================================
                        // STEP 3: Apply the resolved status to the database
                        // =====================================================================
                        try {
                            await applyResolvedStatus(resolvedStatus, supabase);
                            console.log('✅ AI Status Resolver applied successfully');
                            toast.success(`${firstName} added with ${resolvedStatus.balance.toFixed(2)} outstanding balance`);
                        } catch (applyError) {
                            console.error('❌ Failed to apply resolved status:', applyError);
                            toast.error('Tenant created but status resolution failed.');
                        }
                    } else {
                        // No opening balance - tenant is paid up
                        console.log('✅ No opening balance - all payments left as unpaid for watchdog to manage');
                    }
                }

                onAdd({
                    id: data.id,
                    name: `${data.first_name} ${data.last_name}`.trim(),
                    email: data.email,
                    phone: data.phone,
                    rentAmount: Number(amount),
                    weekly_rent: Number(amount),
                    tenant_address: data.tenant_address,
                    frequency: frequency,
                    startDate: data.lease_start_date,
                    trackingStartDate: data.tracking_start_date,
                    openingArrears: data.opening_arrears || 0,
                    rentDueDay: effectiveDueDay
                });

                toast.success(`${firstName} added successfully`);

                // Reset form
                setFirstName("");
                setLastName("");
                setAddress("");
                setEmail("");
                setPhone("");
                setAmount("");
                setFrequency("Weekly");
                setDueDay("Wednesday");
                setDueDayOfMonth("1");
                setTrackFromToday(true); // Reset to default: track from today
                setLeaseStartDate(""); // Reset to empty
                setCustomTrackingDate(""); // Reset to empty
                setExistingBalance("0"); // Reset to 0
                onOpenChange(false);
            }
        } catch (err: any) {
            console.error("Error saving tenant:", err);
            toast.error(err.message || "Failed to save tenant");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px] flex flex-col">
                <DialogHeader className="flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-[#00FFBB]/10 rounded-xl flex items-center justify-center">
                            <UserPlus className="w-5 h-5 text-[#00FFBB]" />
                        </div>
                        <DialogTitle>Add New Tenant</DialogTitle>
                    </div>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
                    {/* Scrollable content area */}
                    <div className="max-h-[70vh] overflow-y-auto pr-2 space-y-5 custom-scrollbar">
                        {/* Names */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="firstName">First Name</Label>
                                <div className="relative group">
                                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 group-focus-within:text-[#00FFBB] transition-colors" />
                                    <Input
                                        id="firstName"
                                        value={firstName}
                                        onChange={(e) => setFirstName(e.target.value)}
                                        placeholder="e.g. John"
                                        className="pl-11"
                                        required
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="lastName">Last Name</Label>
                                <Input
                                    id="lastName"
                                    value={lastName}
                                    onChange={(e) => setLastName(e.target.value)}
                                    placeholder="e.g. Doe"
                                    required
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="email">
                                    Email <span className="text-[#FF3B3B]">*</span>
                                </Label>
                                <div className="relative group">
                                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 group-focus-within:text-[#00FFBB] transition-colors" />
                                    <Input
                                        id="email"
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="john@example.com"
                                        className="pl-11"
                                        required
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="phone">Phone (Optional)</Label>
                                <div className="relative group">
                                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 group-focus-within:text-[#00FFBB] transition-colors" />
                                    <Input
                                        id="phone"
                                        type="tel"
                                        value={phone}
                                        onChange={(e) => setPhone(e.target.value)}
                                        placeholder="021..."
                                        className="pl-11"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="address">Tenant Address (for Notices)</Label>
                            <Input
                                id="address"
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
                                placeholder="Defaults to Property Address"
                            />
                        </div>

                        {/* Payment Frequency */}
                        <div className="space-y-2">
                            <Label>Payment Frequency</Label>
                            <div className="grid grid-cols-3 gap-2">
                                {(["Weekly", "Fortnightly", "Monthly"] as PaymentFrequency[]).map((freq) => (
                                    <button
                                        key={freq}
                                        type="button"
                                        onClick={() => setFrequency(freq)}
                                        className={`h-11 rounded-xl font-bold text-sm transition-all backdrop-blur-sm ${
                                            frequency === freq
                                                ? "bg-[#00FFBB]/15 border border-[#00FFBB]/40 text-[#00FFBB] shadow-[0_0_15px_rgba(0,255,187,0.2)]"
                                                : "bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:border-white/20"
                                        }`}
                                    >
                                        {freq}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="amount">{getRentLabel()}</Label>
                                <Input
                                    id="amount"
                                    type="number"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    placeholder="0.00"
                                    className="font-bold text-lg tabular-nums"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>
                                    {frequency === "Monthly" ? "Due Day of Month" : "Due Day"}
                                    {frequency === "Monthly" && parseInt(dueDayOfMonth, 10) > 28 && (
                                        <span className="text-[10px] text-white/40 ml-2 font-normal">
                                            (snaps to month end for shorter months)
                                        </span>
                                    )}
                                </Label>
                                {frequency === "Monthly" ? (
                                    <Select value={dueDayOfMonth} onValueChange={setDueDayOfMonth}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select day" />
                                        </SelectTrigger>
                                        <SelectContent className="max-h-[200px]">
                                            {DAYS_OF_MONTH.map(d => (
                                                <SelectItem key={d} value={d}>
                                                    {d}{d === "1" ? "st" : d === "2" ? "nd" : d === "3" ? "rd" : "th"}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <Select value={dueDay} onValueChange={setDueDay}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select day" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {DAYS_OF_WEEK.map(d => (
                                                <SelectItem key={d} value={d}>{d}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            </div>
                        </div>

                        {/* Lease Start Date (Optional - for reference only) */}
                        <div className="space-y-2">
                            <Label htmlFor="leaseStartDate">Lease Start Date (Optional)</Label>
                            <div className="relative group">
                                <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 group-focus-within:text-[#00FFBB] transition-colors" />
                                <Input
                                    id="leaseStartDate"
                                    type="date"
                                    value={leaseStartDate}
                                    onChange={(e) => setLeaseStartDate(e.target.value)}
                                    className="pl-11"
                                />
                            </div>
                            <p className="text-[10px] text-white/40 font-medium">
                                When did the tenant move in? (For your records only - not used for rent tracking)
                            </p>
                        </div>

                        {/* Rent Tracking Toggle */}
                        <div className="space-y-3 p-4 bg-[#00FFBB]/5 rounded-2xl border border-[#00FFBB]/20">
                            <div className="flex items-center justify-between">
                                <div className="flex-1">
                                    <Label className="text-sm font-black text-white mb-0">
                                        Start tracking rent from today
                                    </Label>
                                    <p className="text-[10px] text-white/50 font-medium mt-0.5">
                                        Recommended for new tenants or those who are paid up
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setTrackFromToday(!trackFromToday)}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#00FFBB]/50 focus:ring-offset-2 focus:ring-offset-[#0B0E11] ${
                                        trackFromToday ? 'bg-[#00FFBB]' : 'bg-white/20'
                                    }`}
                                >
                                    <span
                                        className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                                            trackFromToday ? 'translate-x-6 bg-[#0B0E11]' : 'translate-x-1 bg-white'
                                        }`}
                                    />
                                </button>
                            </div>

                            {/* Conditional Fields: Show if tracking from past date */}
                            {!trackFromToday && (
                                <div className="space-y-3 pt-3 border-t border-[#00FFBB]/20">
                                    {/* Custom Tracking Date */}
                                    <div className="space-y-2">
                                        <Label htmlFor="customTrackingDate">
                                            Track from past date <span className="text-[#FF3B3B]">*</span>
                                        </Label>
                                        <div className="relative group">
                                            <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 group-focus-within:text-[#00FFBB] transition-colors" />
                                            <Input
                                                id="customTrackingDate"
                                                type="date"
                                                value={customTrackingDate}
                                                onChange={(e) => setCustomTrackingDate(e.target.value)}
                                                className="pl-11"
                                                required={!trackFromToday}
                                            />
                                        </div>
                                        <p className="text-[10px] text-white/40 font-medium">
                                            When should we start tracking rent? (This is "Day 0" for arrears calculations)
                                        </p>
                                    </div>

                                    {/* Existing Balance */}
                                    <div className="space-y-2">
                                        <Label htmlFor="existingBalance">Existing Balance ($)</Label>
                                        <div className="relative group">
                                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 group-focus-within:text-[#00FFBB] font-medium">$</span>
                                            <Input
                                                id="existingBalance"
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={existingBalance}
                                                onChange={(e) => setExistingBalance(e.target.value)}
                                                className="pl-11"
                                                placeholder="0.00"
                                            />
                                        </div>
                                        <p className="text-[10px] text-white/40 font-medium">
                                            How much rent are they behind? (leave as $0 if paid up)
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Pinned footer - always visible */}
                    <div className="pt-4 flex gap-3 flex-shrink-0 border-t border-white/5 mt-4">
                        <Button
                            type="button"
                            variant="brand-secondary"
                            size="brand"
                            onClick={() => onOpenChange(false)}
                            className="flex-1"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={loading}
                            variant="brand-accent"
                            className="flex-1 h-12 rounded-xl"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                "Save Tenant"
                            )}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}
