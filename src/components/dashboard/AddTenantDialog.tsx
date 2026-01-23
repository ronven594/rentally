"use client"

import { useState } from "react"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tenant } from "@/types"
import { User, Mail, Phone, Calendar, Loader2 } from "lucide-react"
import { supabase } from "@/lib/supabaseClient"
import { toast } from "sonner"
import { useEffect } from "react"

interface AddTenantDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    propertyId: string;
    propertyAddress: string;
    onAdd: (tenant: Tenant) => void;
}

export function AddTenantDialog({ open, onOpenChange, propertyId, propertyAddress, onAdd }: AddTenantDialogProps) {
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [address, setAddress] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [amount, setAmount] = useState("");
    const [day, setDay] = useState("Wednesday");
    const [leaseStartDate, setLeaseStartDate] = useState("");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (open) {
            setAddress(propertyAddress);
        }
    }, [open, propertyAddress]);


    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);


        try {
            console.log('🔍 SAVING TENANT - Due Day:', {
                selectedInUI: day,
                whatWillBeSaved: day,
                frequency: "Weekly"
            });

            const { data, error } = await supabase
                .from('tenants')
                .insert({
                    property_id: propertyId,
                    first_name: firstName.trim(),
                    last_name: lastName.trim(),
                    email: email || "",
                    phone: phone || "",
                    lease_start_date: leaseStartDate || null,
                    weekly_rent: Number(amount),
                    tenant_address: address,
                    is_active: true,
                    rent_due_day: day,
                    rent_frequency: "Weekly"
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
                    frequency: "Weekly",
                    startDate: data.lease_start_date,
                    rentDueDay: day
                });

                toast.success(`${firstName} added successfully`);

                // Reset and close
                setDay("Wednesday");
                setFirstName("");
                setLastName("");
                setAddress("");
                setEmail("");
                setPhone("");
                setAmount("");
                setLeaseStartDate("");
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
                        <DialogTitle className="text-xl font-bold text-slate-900 tracking-tight">Add New Tenant</DialogTitle>
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

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="amount" className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                Weekly Rent ($)
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
                            <Label htmlFor="day" className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                Due Day
                            </Label>
                            <Select value={day} onValueChange={setDay}>
                                <SelectTrigger className="h-12 bg-white border-slate-200 rounded-xl font-medium">
                                    <SelectValue placeholder="Select day" />
                                </SelectTrigger>
                                <SelectContent className="bg-white border-slate-200 shadow-xl rounded-xl">
                                    {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(d => (
                                        <SelectItem key={d} value={d} className="rounded-lg focus:bg-slate-50">{d}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Lease Period */}
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
                            For reference only - when did the tenant move in? (e.g. 01/01/2026)
                        </p>
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
                            className="flex-2 h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-lg shadow-emerald-100 transition-all active:scale-[0.98] disabled:opacity-50"
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
