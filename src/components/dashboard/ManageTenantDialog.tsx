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
import { User, Trash2, CheckCircle2, Mail, Phone, Calendar, Settings2 } from "lucide-react"
import { toast } from "sonner"
import { useMediaQuery } from "@/hooks/use-media-query"
import { ConfirmationDialog } from "./ConfirmationDialog"

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
    const [frequency, setFrequency] = useState<"Weekly" | "Fortnightly" | "Monthly">("Weekly");
    const [rentDueDay, setRentDueDay] = useState("Wednesday");
    const [address, setAddress] = useState("");
    const [leaseStartDate, setLeaseStartDate] = useState("");
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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

    // Auto-reset Due Day when frequency changes to prevent invalid state
    useEffect(() => {
        if (!open) return;

        const currentValue = rentDueDay;
        const isNumeric = !isNaN(parseInt(currentValue, 10));
        const isDayName = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].includes(currentValue);

        if (frequency === "Monthly" && isDayName) {
            // Switching TO Monthly with a day name selected - reset to 1st
            setRentDueDay("1");
        } else if ((frequency === "Weekly" || frequency === "Fortnightly") && isNumeric) {
            // Switching FROM Monthly to Weekly/Fortnightly with a number selected - reset to Wednesday
            setRentDueDay("Wednesday");
        }
    }, [frequency, open]);

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
            icon: <CheckCircle2 className="w-5 h-5 text-[#00FFBB]" />,
        });
        onOpenChange(false);
    };

    const content = (
        <div className="space-y-6">
            <div className="space-y-5">
                {/* Names */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="first-name">First Name</Label>
                        <div className="relative group">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40 group-focus-within:text-[#00FFBB] transition-colors" />
                            <Input
                                id="first-name"
                                value={firstName}
                                onChange={(e) => setFirstName(e.target.value)}
                                className="pl-9"
                            />
                        </div>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="last-name">Last Name</Label>
                        <Input
                            id="last-name"
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                        />
                    </div>
                </div>

                {/* Contact */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="email">Email</Label>
                        <div className="relative group">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40 group-focus-within:text-[#00FFBB] transition-colors" />
                            <Input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="pl-9"
                            />
                        </div>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="phone">Phone</Label>
                        <div className="relative group">
                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40 group-focus-within:text-[#00FFBB] transition-colors" />
                            <Input
                                id="phone"
                                type="tel"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                className="pl-9"
                            />
                        </div>
                    </div>
                </div>

                {/* Address */}
                <div className="grid gap-2">
                    <Label htmlFor="address">Service Address (for Notices)</Label>
                    <Input
                        id="address"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="e.g. 123 Rental Lane, Auckland"
                    />
                </div>

                {/* Rent Info */}
                <div className="grid grid-cols-3 gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="amount">Rent ($)</Label>
                        <Input
                            id="amount"
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="font-bold tabular-nums"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label>Frequency</Label>
                        <Select value={frequency} onValueChange={(val: any) => setFrequency(val)}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Weekly">Weekly</SelectItem>
                                <SelectItem value="Fortnightly">Fortnightly</SelectItem>
                                <SelectItem value="Monthly">Monthly</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid gap-2">
                        <Label>
                            {frequency === "Monthly" ? "Due Day of Month" : "Due Day"}
                            {frequency === "Monthly" && parseInt(rentDueDay, 10) > 28 && (
                                <span className="text-[10px] text-white/40 ml-2 font-normal">
                                    (snaps to month end)
                                </span>
                            )}
                        </Label>
                        <Select value={rentDueDay} onValueChange={setRentDueDay}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {frequency === "Monthly"
                                    ? Array.from({ length: 31 }, (_, i) => (i + 1).toString()).map(d => (
                                        <SelectItem key={d} value={d}>{d}</SelectItem>
                                      ))
                                    : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(d => (
                                        <SelectItem key={d} value={d}>{d}</SelectItem>
                                      ))
                                }
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* Lease Period */}
                <div className="space-y-2">
                    <Label htmlFor="lease-start">Lease Start Date (Optional)</Label>
                    <div className="relative group">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40 group-focus-within:text-[#00FFBB] transition-colors" />
                        <Input
                            id="lease-start"
                            type="date"
                            value={leaseStartDate}
                            onChange={(e) => setLeaseStartDate(e.target.value)}
                            className="pl-9"
                        />
                    </div>
                    <p className="text-[10px] text-white/40 font-medium">
                        For reference only - when did the tenant move in?
                    </p>
                </div>
            </div>

            <div className="pt-6 border-t border-white/10 flex items-center justify-between gap-4">
                <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center gap-2 text-[#FF3B3B] hover:text-[#FF3B3B]/80 transition-colors group px-2"
                >
                    <div className="w-8 h-8 rounded-full bg-[#FF3B3B]/10 flex items-center justify-center group-hover:bg-[#FF3B3B]/20 transition-colors">
                        <Trash2 className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold uppercase tracking-wider">Remove Tenant</span>
                </button>

                <Button onClick={handleSave} variant="brand-accent" className="flex-1 h-11 rounded-xl">
                    Save Changes
                </Button>
            </div>
        </div>
    );

    if (isDesktop) {
        return (
            <>
                <Dialog open={open} onOpenChange={onOpenChange}>
                    <DialogContent className="sm:max-w-[480px]">
                        <DialogHeader className="mb-6">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-[#00FFBB]/10 rounded-xl flex items-center justify-center">
                                    <Settings2 className="w-5 h-5 text-[#00FFBB]" />
                                </div>
                                <DialogTitle>Manage {tenant.name}</DialogTitle>
                            </div>
                        </DialogHeader>
                        {content}
                    </DialogContent>
                </Dialog>

                <ConfirmationDialog
                    open={showDeleteConfirm}
                    onOpenChange={setShowDeleteConfirm}
                    title="Remove Tenant?"
                    description={`This will permanently delete ${tenant.name} and all associated rent records. This action cannot be undone.`}
                    confirmText="Remove"
                    variant="destructive"
                    onConfirm={() => {
                        onDelete(tenant.id);
                        setShowDeleteConfirm(false);
                        onOpenChange(false);
                    }}
                />
            </>
        );
    }

    return (
        <>
            <Sheet open={open} onOpenChange={onOpenChange}>
                <SheetContent side="bottom" className="rounded-t-[32px] p-8">
                    <div className="w-12 h-1.5 bg-white/20 rounded-full mx-auto mb-8" />
                    <SheetHeader className="mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-[#00FFBB]/10 rounded-xl flex items-center justify-center">
                                <Settings2 className="w-5 h-5 text-[#00FFBB]" />
                            </div>
                            <SheetTitle className="text-left">Manage {tenant.name}</SheetTitle>
                        </div>
                    </SheetHeader>
                    {content}
                </SheetContent>
            </Sheet>

            <ConfirmationDialog
                open={showDeleteConfirm}
                onOpenChange={setShowDeleteConfirm}
                title="Remove Tenant?"
                description={`This will permanently delete ${tenant.name} and all associated rent records. This action cannot be undone.`}
                confirmText="Remove"
                variant="destructive"
                onConfirm={() => {
                    onDelete(tenant.id);
                    setShowDeleteConfirm(false);
                    onOpenChange(false);
                }}
            />
        </>
    );
}
