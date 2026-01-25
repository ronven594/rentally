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
import { Loader2, Building2 } from "lucide-react"
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
    const [type, setType] = useState("House");
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
                setType("House");
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
            <DialogContent className="sm:max-w-md">
                <DialogHeader className="mb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-[#00FFBB]/10 rounded-xl flex items-center justify-center">
                            <Building2 className="w-5 h-5 text-[#00FFBB]" />
                        </div>
                        <DialogTitle>Add New Property</DialogTitle>
                    </div>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="space-y-1">
                        <Label htmlFor="prop-name">Property Name</Label>
                        <Input
                            id="prop-name"
                            placeholder="e.g. 91 Boundary St"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                    </div>

                    <div className="space-y-1">
                        <Label htmlFor="prop-address">Address</Label>
                        <Input
                            id="prop-address"
                            placeholder="e.g. 123 Queen Street, Auckland"
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            required
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <Label htmlFor="prop-region">
                                Region <span className="text-[#FF3B3B]">*</span>
                            </Label>
                            <Select value={region} onValueChange={(v: NZRegion) => setRegion(v)}>
                                <SelectTrigger id="prop-region">
                                    <SelectValue placeholder="Select region" />
                                </SelectTrigger>
                                <SelectContent>
                                    {NZ_REGIONS.map(r => (
                                        <SelectItem key={r} value={r}>{r}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="prop-type">Type</Label>
                            <Input
                                id="prop-type"
                                placeholder="e.g. Apartment, House"
                                value={type}
                                onChange={(e) => setType(e.target.value)}
                            />
                        </div>
                    </div>

                    <DialogFooter className="pt-4 gap-2">
                        <Button
                            type="button"
                            variant="brand-secondary"
                            size="brand"
                            onClick={() => onOpenChange(false)}
                            className="rounded-xl"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={loading}
                            variant="brand-accent"
                            size="brand"
                            className="rounded-xl"
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
