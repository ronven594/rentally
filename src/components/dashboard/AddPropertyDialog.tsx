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
import { Property } from "@/types"
import { Loader2 } from "lucide-react"
import { supabase } from "@/lib/supabaseClient"
import { toast } from "sonner"
import { NZRegion } from "@/lib/nz-holidays"

// Region options matching NZRegion type from nz-holidays.ts
const NZ_REGIONS: NZRegion[] = [
    "Auckland",
    "Wellington",
    "Canterbury",
    "Otago",
    "Nelson",
    "Taranaki",
    "Hawke's Bay",
    "Southland",
];

interface AddPropertyDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onAdd: (property: Property) => void;
}

export function AddPropertyDialog({ open, onOpenChange, onAdd }: AddPropertyDialogProps) {
    const [name, setName] = useState("");
    const [address, setAddress] = useState("");
    const [region, setRegion] = useState<NZRegion>("Auckland");
    const [type, setType] = useState("Apartment");
    const [yearBuilt, setYearBuilt] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            const { data, error } = await supabase
                .from('properties')
                .insert({
                    address: address, // Using address as the primary identifier
                    property_type: type,
                    region: region
                })
                .select()
                .single();

            if (error) throw error;

            if (data) {
                onAdd({
                    id: data.id,
                    name: name || data.address, // Fallback to address if name empty
                    address: data.address,
                    region: data.region,
                    type: data.property_type,
                    yearBuilt: yearBuilt ? Number(yearBuilt) : undefined,
                    tenants: []
                });

                toast.success("Property saved to database");

                // Reset and close
                setName("");
                setAddress("");
                setRegion("Auckland");
                setType("Apartment");
                setYearBuilt("");
                onOpenChange(false);
            }
        } catch (err: any) {
            console.error("Error saving property:", err);
            toast.error(err.message || "Failed to save property");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md bg-white border-0 shadow-lg rounded-3xl p-6">
                <DialogHeader className="mb-4">
                    <DialogTitle className="text-xl font-bold text-slate-900 tracking-tight">Add New Property</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="space-y-2">
                        <Label htmlFor="prop-name" className="text-sm font-semibold text-slate-700">Property Name</Label>
                        <Input
                            id="prop-name"
                            placeholder="e.g. 91 Boundary St"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="h-12 border-slate-200 focus:border-emerald-500 focus:ring-emerald-500 rounded-xl px-4"
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="prop-address" className="text-sm font-semibold text-slate-700">Address</Label>
                        <Input
                            id="prop-address"
                            placeholder="e.g. 123 Queen Street, Auckland"
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            className="h-12 border-slate-200 focus:border-emerald-500 focus:ring-emerald-500 rounded-xl px-4"
                            required
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="prop-region" className="text-sm font-semibold text-slate-700">
                                Region <span className="text-red-500">*</span>
                            </Label>
                            <Select value={region} onValueChange={(v: NZRegion) => setRegion(v)}>
                                <SelectTrigger id="prop-region" className="h-12 border-slate-200 rounded-xl focus:ring-emerald-500">
                                    <SelectValue placeholder="Select region" />
                                </SelectTrigger>
                                <SelectContent className="bg-white border-slate-200">
                                    {NZ_REGIONS.map(r => (
                                        <SelectItem key={r} value={r}>{r}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="prop-type" className="text-sm font-semibold text-slate-700">Type</Label>
                            <Input
                                id="prop-type"
                                placeholder="e.g. Apartment, House"
                                value={type}
                                onChange={(e) => setType(e.target.value)}
                                className="h-12 border-slate-200 focus:border-emerald-500 focus:ring-emerald-500 rounded-xl px-4"
                            />
                        </div>
                    </div>

                    <DialogFooter className="pt-2">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => onOpenChange(false)}
                            className="h-12 px-6 font-semibold"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={loading}
                            className="h-12 px-8 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl transition-all shadow-md active:scale-95 disabled:opacity-50"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                "Save Property"
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
