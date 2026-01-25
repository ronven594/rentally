import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tenant } from "@/types";
import { toast } from "sonner";
import { DollarSign } from "lucide-react";

interface RecordPaymentDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    tenant: Tenant;
    totalOutstanding: number;
    onRecordPayment: (amount: number) => Promise<void>;
}

export function RecordPaymentDialog({
    open,
    onOpenChange,
    tenant,
    totalOutstanding,
    onRecordPayment
}: RecordPaymentDialogProps) {
    // Default to full amount, but ensure string consistency
    const [paymentAmount, setPaymentAmount] = useState((totalOutstanding || 0).toFixed(2));
    const [isProcessing, setIsProcessing] = useState(false);

    const handleSubmit = async () => {
        const amount = parseFloat(paymentAmount);

        if (isNaN(amount) || amount <= 0) {
            toast.error('Please enter a valid payment amount');
            return;
        }

        if (amount > totalOutstanding) {
            toast.error(`Payment amount cannot exceed outstanding balance of $${totalOutstanding}`);
            return;
        }

        setIsProcessing(true);

        try {
            await onRecordPayment(amount);
            toast.success(`Payment of $${amount.toFixed(2)} recorded`);
            onOpenChange(false);
        } catch (error) {
            // Error handling is done in parent, but good to have a catch here just in case specific UI logic is needed
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader className="mb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-[#00FFBB]/10 rounded-xl flex items-center justify-center">
                            <DollarSign className="w-5 h-5 text-[#00FFBB]" />
                        </div>
                        <DialogTitle>Record Payment - {tenant.name}</DialogTitle>
                    </div>
                </DialogHeader>

                <div className="space-y-4">
                    {/* Outstanding Amount */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                        <p className="text-xs text-white/50 mb-1 uppercase tracking-wider font-bold">Total Outstanding</p>
                        <p className="text-2xl font-black text-[#FFB800] tabular-nums">${totalOutstanding.toFixed(2)}</p>
                    </div>

                    {/* Payment Amount Input */}
                    <div className="space-y-2">
                        <Label>Payment Received</Label>
                        <div className="relative group">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 group-focus-within:text-[#00FFBB] font-medium">$</span>
                            <Input
                                type="number"
                                value={paymentAmount}
                                onChange={(e) => setPaymentAmount(e.target.value)}
                                className="pl-10 text-lg font-bold tabular-nums"
                                placeholder="0.00"
                                step="0.01"
                                min="0"
                                max={totalOutstanding}
                            />
                        </div>
                        <p className="text-xs text-white/40 font-medium">
                            Payment will be applied to oldest debt first
                        </p>
                    </div>

                    {/* Quick Amount Buttons */}
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            variant="brand-secondary"
                            size="sm"
                            onClick={() => setPaymentAmount((totalOutstanding / 2).toFixed(2))}
                            className="flex-1"
                        >
                            Half
                        </Button>
                        <Button
                            type="button"
                            variant="brand-secondary"
                            size="sm"
                            onClick={() => setPaymentAmount(totalOutstanding.toString())}
                            className="flex-1"
                        >
                            Full Amount
                        </Button>
                    </div>
                </div>

                <DialogFooter className="gap-2 pt-4">
                    <Button
                        type="button"
                        variant="brand-secondary"
                        size="brand"
                        onClick={() => onOpenChange(false)}
                        disabled={isProcessing}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        onClick={handleSubmit}
                        disabled={isProcessing}
                        variant="brand-accent"
                        className="h-12 px-6 rounded-xl"
                    >
                        {isProcessing ? 'Recording...' : 'Record Payment'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
