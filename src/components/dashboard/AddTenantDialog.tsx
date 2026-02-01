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
import { format } from "date-fns"
import { regeneratePaymentLedger } from "@/lib/ledger-regenerator"
import { calculateArrearsStartDate } from "@/lib/rent-calculator"
import { formatDateISO, getEffectiveToday } from "@/lib/date-utils"
// SESSION 4: tenant-status-resolver is deprecated. Ledger records are display-only.
// Status is derived at render time from calculateRentState() via deriveLedgerRecordStatus().

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
            //
            // KEY INSIGHT: "Existing balance" means "total debt as of TODAY".
            // It REPLACES any historical rent calculation, not adds to it.
            // So we always track NEW rent from today, and store the existing
            // debt as opening_arrears. The historical date goes into lease_start_date.
            //
            // We also back-calculate arrears_start_date: the estimated date when
            // the debt originated. E.g. $600 at $400/fortnight = ~2 cycles back.
            const todayDate = getEffectiveToday();
            const today = formatDateISO(todayDate);
            const finalOpeningBalance = trackFromToday
                ? 0
                : Number(existingBalance) || 0;

            // Always start tracking new rent from today.
            const finalTrackingStartDate = today;

            // Back-calculate when the debt started (for "overdue since" display)
            const rentDueDay = frequency === 'Monthly'
                ? parseInt(effectiveDueDay, 10) || 1
                : effectiveDueDay;
            const arrearsStart = finalOpeningBalance > 0
                ? calculateArrearsStartDate(
                    finalOpeningBalance,
                    Number(amount),
                    frequency,
                    rentDueDay,
                    todayDate
                )
                : null;
            const arrearsStartDateISO = arrearsStart ? formatDateISO(arrearsStart) : null;

            console.log('🔍 SAVING TENANT:', {
                frequency,
                dueDay: effectiveDueDay,
                amount: Number(amount),
                trackFromToday,
                trackingStartDate: finalTrackingStartDate,
                openingBalance: finalOpeningBalance,
                arrearsStartDate: arrearsStartDateISO
            });

            const { data, error } = await supabase
                .from('tenants')
                .insert({
                    property_id: propertyId,
                    first_name: firstName.trim(),
                    last_name: lastName.trim(),
                    email: email || "",
                    phone: phone || "",
                    lease_start_date: leaseStartDate || (trackFromToday ? null : customTrackingDate) || null,
                    tracking_start_date: finalTrackingStartDate, // Always today - new rent accrues from here
                    opening_arrears: finalOpeningBalance, // Existing debt at creation time (0 if new/paid up)
                    arrears_start_date: arrearsStartDateISO, // Back-calculated: when debt originated
                    settings_effective_date: finalTrackingStartDate, // Current settings effective from today
                    carried_forward_balance: 0, // No carried forward balance on creation
                    weekly_rent: Number(amount),
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
                // Generate display-only ledger records via regeneratePaymentLedger().
                // Balance is calculated deterministically by calculateRentState(),
                // so these records are purely for UI display of the payment schedule.
                // =====================================================================
                if (finalTrackingStartDate) {
                    const ledgerSettings = {
                        id: data.id,
                        trackingStartDate: finalTrackingStartDate,
                        rentAmount: Number(amount),
                        frequency,
                        rentDueDay: effectiveDueDay,
                        propertyId,
                    };
                    console.log('🔍 DEBUG: Calling regeneratePaymentLedger with:', {
                        tenantId: data.id,
                        settings: ledgerSettings,
                    });

                    const result = await regeneratePaymentLedger(
                        data.id,
                        ledgerSettings,
                        supabase
                    );

                    if (!result.success) {
                        console.error('❌ Failed to create payment records:', result.error);
                        console.error('❌ DEBUG: Full regeneration result:', JSON.stringify(result, null, 2));
                        toast.error('Tenant created but payment records failed. Please add manually.');
                        return;
                    }

                    console.log('✅ Payment ledger created:', {
                        recordsCreated: result.recordsCreated,
                    });

                    if (finalOpeningBalance > 0) {
                        toast.success(`${firstName} added with $${finalOpeningBalance.toFixed(2)} opening arrears`);
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
                    arrearsStartDate: data.arrears_start_date || undefined,
                    settingsEffectiveDate: data.settings_effective_date || undefined,
                    carriedForwardBalance: data.carried_forward_balance || 0,
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
                                            When did the tenancy start? (Stored for your records. New rent tracks from today.)
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
                                            Total amount they owe right now (leave as $0 if paid up)
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
