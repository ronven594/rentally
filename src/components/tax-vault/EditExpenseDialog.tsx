"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Expense } from "@/types"
import { useState } from "react"

interface EditExpenseDialogProps {
    expense: Expense;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (updated: Expense) => void;
}

export function EditExpenseDialog({ expense, open, onOpenChange, onSave }: EditExpenseDialogProps) {
    const [merchant, setMerchant] = useState(expense.merchant || "");
    const [amount, setAmount] = useState(expense.amount.toString());
    const [gst, setGst] = useState(expense.gst?.toString() || "");

    const handleSave = () => {
        const numAmount = parseFloat(amount) || 0;
        const numGst = gst ? parseFloat(gst) : (numAmount * 3) / 23; // Auto-calculate if empty

        onSave({
            ...expense,
            merchant,
            amount: numAmount,
            gst: numGst,
        });
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Edit Receipt Details</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="merchant">Vendor Name</Label>
                        <Input
                            id="merchant"
                            value={merchant}
                            onChange={(e) => setMerchant(e.target.value)}
                            placeholder="e.g., Bunnings Warehouse"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="amount">Total Amount (Incl GST)</Label>
                        <Input
                            id="amount"
                            type="number"
                            step="0.01"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0.00"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="gst">GST Component (Optional - Auto-calculated)</Label>
                        <Input
                            id="gst"
                            type="number"
                            step="0.01"
                            value={gst}
                            onChange={(e) => setGst(e.target.value)}
                            placeholder="Auto-calculated at 15%"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} className="bg-emerald-600 hover:bg-emerald-700">
                        Save Changes
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
