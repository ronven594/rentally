"use client"

import { useState, useEffect } from "react"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tenant } from "@/types"
import { User, Trash2, CheckCircle2, Mail, Phone, Calendar } from "lucide-react"
import { toast } from "sonner"
import { useMediaQuery } from "@/hooks/use-media-query"

interface ManageTenantDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    tenant: Tenant;
    onUpdate: (tenantId: string, updates: Partial<Tenant>) => void;
    onDelete: (tenantId: string) => void;
}

export function ManageTenantDialog({ open, onOpenChange, tenant, onUpdate, onDelete }: ManageTenantDialogProps) {
    const isDesktop = useMediaQuery("(min-width: 768px)");

    // Internal state
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [amount, setAmount] = useState("");
    const [frequency, setFrequency] = useState<"Weekly" | "Fortnightly">("Weekly");
    const [rentDueDay, setRentDueDay] = useState("Wednesday");
    const [address, setAddress] = useState("");
    const [leaseStartDate, setLeaseStartDate] = useState("");

    useEffect(() => {
        if (open && tenant) {
            // Split name if first_name/last_name aren't available on the type yet
            const nameParts = tenant.name.split(' ');
            setFirstName(nameParts[0] || "");
            setLastName(nameParts.slice(1).join(' ') || "");

            setEmail(tenant.email || "");
            setPhone(tenant.phone || "");
            setAmount(tenant.rentAmount?.toString() || "");
            setFrequency(tenant.frequency || "Weekly");
            setRentDueDay(tenant.rentDueDay || "Wednesday");
            setAddress(tenant.tenant_address || "");
            setLeaseStartDate(tenant.startDate ? tenant.startDate.split('T')[0] : "");
            setLeaseStartDate(tenant.startDate ? tenant.startDate.split('T')[0] : "");
        }
    }, [open, tenant]);

    const handleSave = () => {
        onUpdate(tenant.id, {
            name: `${firstName} ${lastName}`.trim(),
            email,
            phone,
            rentAmount: Number(amount),
            frequency,
            rentDueDay,
            tenant_address: address,
            startDate: leaseStartDate || undefined
        });

        toast.success("Tenant updated", {
            description: `Changes to ${firstName || 'tenant'} have been saved.`,
            icon: <CheckCircle2 className="w-5 h-5 text-emerald-500" />,
        });
        onOpenChange(false);
    };

    const content = (
        <div className="space-y-6">
            <div className="space-y-5">
                {/* Names */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="first-name" className="text-[10px] font-black uppercase tracking-widest text-slate-400">First Name</Label>
                        <div className="relative group">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 group-focus-within:text-emerald-500 transition-colors" />
                            <Input
                                id="first-name"
                                value={firstName}
                                onChange={(e) => setFirstName(e.target.value)}
                                className="pl-9 h-11 bg-slate-50 border-slate-100 focus:bg-white transition-all rounded-xl font-medium"
                            />
                        </div>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="last-name" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Last Name</Label>
                        <Input
                            id="last-name"
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                            className="h-11 bg-slate-50 border-slate-100 focus:bg-white transition-all rounded-xl font-medium"
                        />
                    </div>
                </div>

                {/* Contact */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="email" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Email</Label>
                        <div className="relative group">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 group-focus-within:text-emerald-500 transition-colors" />
                            <Input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="pl-9 h-11 bg-slate-50 border-slate-100 focus:bg-white transition-all rounded-xl font-medium"
                            />
                        </div>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="phone" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Phone</Label>
                        <div className="relative group">
                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 group-focus-within:text-emerald-500 transition-colors" />
                            <Input
                                id="phone"
                                type="tel"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                className="pl-9 h-11 bg-slate-50 border-slate-100 focus:bg-white transition-all rounded-xl font-medium"
                            />
                        </div>
                    </div>
                </div>

                {/* Address */}
                <div className="grid gap-2">
                    <Label htmlFor="address" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Service Address (for Notices)</Label>
                    <Input
                        id="address"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="e.g. 123 Rental Lane, Auckland"
                        className="h-11 bg-slate-50 border-slate-100 focus:bg-white transition-all rounded-xl font-medium"
                    />
                </div>

                {/* Rent Info */}
                <div className="grid grid-cols-3 gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="amount" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Rent ($)</Label>
                        <Input
                            id="amount"
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="h-11 bg-slate-50 border-slate-100 focus:bg-white transition-all rounded-xl font-bold tabular-nums"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Frequency</Label>
                        <Select value={frequency} onValueChange={(val: any) => setFrequency(val)}>
                            <SelectTrigger className="h-11 bg-slate-50 border-slate-100 rounded-xl font-medium">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-white border-slate-200 shadow-xl rounded-xl">
                                <SelectItem value="Weekly">Weekly</SelectItem>
                                <SelectItem value="Fortnightly">Fortnightly</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid gap-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Due Day</Label>
                        <Select value={rentDueDay} onValueChange={setRentDueDay}>
                            <SelectTrigger className="h-11 bg-slate-50 border-slate-100 rounded-xl font-medium">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-white border-slate-200 shadow-xl rounded-xl">
                                {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(d => (
                                    <SelectItem key={d} value={d} className="rounded-lg">{d}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* Lease Period */}
                <div className="space-y-2">
                    <Label htmlFor="lease-start" className="text-[10px] font-black uppercase tracking-widest text-slate-400">Lease Start (Optional)</Label>
                    <div className="relative group">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                        <Input
                            id="lease-start"
                            type="date"
                            value={leaseStartDate}
                            onChange={(e) => setLeaseStartDate(e.target.value)}
                            className="pl-9 h-11 bg-slate-50 border-slate-100 focus:bg-white transition-all rounded-xl font-medium"
                        />
                    </div>
                    <p className="text-[10px] text-slate-400 font-medium">
                        For reference only - when did the tenant move in?
                    </p>
                </div>
            </div>

            <div className="pt-6 border-t border-slate-100 flex items-center justify-between gap-4">
                <button
                    onClick={() => {
                        if (confirm(`Are you sure you want to remove ${tenant.name}?`)) {
                            onDelete(tenant.id);
                            onOpenChange(false);
                        }
                    }}
                    className="flex items-center gap-2 text-rose-500 hover:text-rose-600 transition-colors group px-2"
                >
                    <div className="w-8 h-8 rounded-full bg-rose-50 flex items-center justify-center group-hover:bg-rose-100 transition-colors">
                        <Trash2 className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold uppercase tracking-wider">Remove Tenant</span>
                </button>

                <Button onClick={handleSave} className="flex-1 h-11 bg-slate-900 text-white hover:bg-black rounded-xl font-bold shadow-lg shadow-slate-100 transition-all active:scale-[0.98]">
                    Save Changes
                </Button>
            </div>
        </div>
    );

    if (isDesktop) {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-[480px] bg-white border-none shadow-2xl rounded-3xl p-8">
                    <DialogHeader className="mb-6">
                        <DialogTitle className="text-2xl font-black text-slate-900">Manage {tenant.name}</DialogTitle>
                    </DialogHeader>
                    {content}
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="bottom" className="bg-white rounded-t-[32px] p-8 border-none outline-none ring-0 focus:ring-0">
                <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-8" />
                <SheetHeader className="mb-6">
                    <SheetTitle className="text-2xl font-black text-slate-900 text-left">Manage {tenant.name}</SheetTitle>
                </SheetHeader>
                {content}
            </SheetContent>
        </Sheet>
    );
}
