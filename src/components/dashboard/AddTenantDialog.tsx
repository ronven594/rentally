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
import { User, Mail, Phone, Calendar, Loader2 } from "lucide-react"
import { supabase } from "@/lib/supabaseClient"
import { toast } from "sonner"
import { format } from "date-fns"

interface AddTenantDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    propertyId: string;
    propertyAddress: string;
    onAdd: (tenant: Tenant) => void;
}

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAYS_OF_MONTH = Array.from({ length: 28 }, (_, i) => (i + 1).toString());

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
                    opening_arrears: finalOpeningBalance, // Any existing debt when we started tracking
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
            <DialogContent className="sm:max-w-[450px] bg-white border border-slate-200 shadow-xl rounded-2xl p-0 overflow-hidden">
                <div className="bg-slate-50/50 px-6 py-4 border-b border-slate-100">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-black italic text-nav-black tracking-tight">Add New Tenant</DialogTitle>
                    </DialogHeader>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    {/* Names */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="firstName" className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                First Name
                            </Label>
                            <div className="relative group">
                                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-emerald-500 transition-colors" />
                                <Input
                                    id="firstName"
                                    value={firstName}
                                    onChange={(e) => setFirstName(e.target.value)}
                                    placeholder="e.g. John"
                                    className="h-12 pl-11 bg-white border-slate-200 focus:border-emerald-500 focus:ring-emerald-500 rounded-xl font-medium"
                                    required
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="lastName" className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                Last Name
                            </Label>
                            <Input
                                id="lastName"
                                value={lastName}
                                onChange={(e) => setLastName(e.target.value)}
                                placeholder="e.g. Doe"
                                className="h-12 bg-white border-slate-200 focus:border-emerald-500 focus:ring-emerald-500 rounded-xl font-medium"
                                required
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="email" className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                Email <span className="text-red-500">*</span>
                            </Label>
                            <div className="relative group">
                                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-emerald-500 transition-colors" />
                                <Input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="john@example.com"
                                    className="h-12 pl-11 bg-white border-slate-200 focus:border-emerald-500 focus:ring-emerald-500 rounded-xl font-medium"
                                    required
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="phone" className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                Phone (Optional)
                            </Label>
                            <div className="relative group">
                                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-emerald-500 transition-colors" />
                                <Input
                                    id="phone"
                                    type="tel"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    placeholder="021..."
                                    className="h-12 pl-11 bg-white border-slate-200 focus:border-emerald-500 focus:ring-emerald-500 rounded-xl font-medium"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="address" className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            Tenant Address (for Notices)
                        </Label>
                        <Input
                            id="address"
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            placeholder="Defaults to Property Address"
                            className="h-12 bg-white border-slate-200 focus:border-emerald-500 focus:ring-emerald-500 rounded-xl font-medium text-slate-600"
                        />
                    </div>

                    {/* Payment Frequency */}
                    <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            Payment Frequency
                        </Label>
                        <div className="grid grid-cols-3 gap-2">
                            {(["Weekly", "Fortnightly", "Monthly"] as PaymentFrequency[]).map((freq) => (
                                <button
                                    key={freq}
                                    type="button"
                                    onClick={() => setFrequency(freq)}
                                    className={`h-12 rounded-xl font-bold text-sm transition-all ${
                                        frequency === freq
                                            ? "bg-nav-black text-white shadow-lg"
                                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                    }`}
                                >
                                    {freq}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="amount" className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                {getRentLabel()}
                            </Label>
                            <Input
                                id="amount"
                                type="number"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                placeholder="0.00"
                                className="h-12 bg-white border-slate-200 rounded-xl font-bold text-lg tabular-nums"
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                {frequency === "Monthly" ? "Due Day of Month" : "Due Day"}
                            </Label>
                            {frequency === "Monthly" ? (
                                <Select value={dueDayOfMonth} onValueChange={setDueDayOfMonth}>
                                    <SelectTrigger className="h-12 bg-white border-slate-200 rounded-xl font-medium">
                                        <SelectValue placeholder="Select day" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-white border-slate-200 shadow-xl rounded-xl max-h-[200px]">
                                        {DAYS_OF_MONTH.map(d => (
                                            <SelectItem key={d} value={d} className="rounded-lg focus:bg-slate-50">
                                                {d}{d === "1" ? "st" : d === "2" ? "nd" : d === "3" ? "rd" : "th"}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <Select value={dueDay} onValueChange={setDueDay}>
                                    <SelectTrigger className="h-12 bg-white border-slate-200 rounded-xl font-medium">
                                        <SelectValue placeholder="Select day" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-white border-slate-200 shadow-xl rounded-xl">
                                        {DAYS_OF_WEEK.map(d => (
                                            <SelectItem key={d} value={d} className="rounded-lg focus:bg-slate-50">{d}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>
                    </div>

                    {/* Lease Start Date (Optional - for reference only) */}
                    <div className="space-y-2">
                        <Label htmlFor="leaseStartDate" className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            Lease Start (Optional)
                        </Label>
                        <div className="relative group">
                            <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-emerald-500 transition-colors" />
                            <Input
                                id="leaseStartDate"
                                type="date"
                                value={leaseStartDate}
                                onChange={(e) => setLeaseStartDate(e.target.value)}
                                className="h-12 pl-11 bg-white border-slate-200 focus:border-emerald-500 focus:ring-emerald-500 rounded-xl font-medium"
                            />
                        </div>
                        <p className="text-[10px] text-slate-400 font-medium">
                            When did the tenant move in? (for your records only)
                        </p>
                    </div>

                    {/* Rent Tracking Toggle */}
                    <div className="space-y-3 p-4 bg-emerald-50/50 rounded-2xl border border-emerald-200/50">
                        <div className="flex items-center justify-between">
                            <div className="flex-1">
                                <Label className="text-sm font-black text-nav-black">
                                    Start tracking rent from today
                                </Label>
                                <p className="text-[10px] text-slate-500 font-medium mt-0.5">
                                    Recommended for new tenants or those who are paid up
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setTrackFromToday(!trackFromToday)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 ${
                                    trackFromToday ? 'bg-emerald-600' : 'bg-slate-300'
                                }`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                        trackFromToday ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                                />
                            </button>
                        </div>

                        {/* Conditional Fields: Show if tracking from past date */}
                        {!trackFromToday && (
                            <div className="space-y-3 pt-3 border-t border-emerald-200/50">
                                {/* Custom Tracking Date */}
                                <div className="space-y-2">
                                    <Label htmlFor="customTrackingDate" className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                                        Track from past date <span className="text-red-500">*</span>
                                    </Label>
                                    <div className="relative group">
                                        <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-emerald-500 transition-colors" />
                                        <Input
                                            id="customTrackingDate"
                                            type="date"
                                            value={customTrackingDate}
                                            onChange={(e) => setCustomTrackingDate(e.target.value)}
                                            className="h-12 pl-11 bg-white border-slate-200 focus:border-emerald-500 focus:ring-emerald-500 rounded-xl font-medium"
                                            required={!trackFromToday}
                                        />
                                    </div>
                                    <p className="text-[10px] text-slate-500 font-medium">
                                        When should we start tracking rent?
                                    </p>
                                </div>

                                {/* Existing Balance */}
                                <div className="space-y-2">
                                    <Label htmlFor="existingBalance" className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                                        Existing Balance ($)
                                    </Label>
                                    <div className="relative group">
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-500 font-medium">$</span>
                                        <Input
                                            id="existingBalance"
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={existingBalance}
                                            onChange={(e) => setExistingBalance(e.target.value)}
                                            className="h-12 pl-11 bg-white border-slate-200 focus:border-emerald-500 focus:ring-emerald-500 rounded-xl font-medium"
                                            placeholder="0.00"
                                        />
                                    </div>
                                    <p className="text-[10px] text-slate-500 font-medium">
                                        How much rent are they behind? (leave as $0 if paid up)
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="pt-4 flex gap-3">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => onOpenChange(false)}
                            className="flex-1 h-12 font-bold text-slate-500 hover:bg-slate-50 rounded-xl"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={loading}
                            className="flex-1 h-12 bg-safe-green hover:bg-safe-green/90 text-white font-black rounded-xl shadow-lg shadow-safe-green/20 transition-all active:scale-[0.98] disabled:opacity-50"
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
