import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tenant } from "@/types";
import { toast } from "sonner";

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
            <DialogContent className="sm:max-w-md bg-white">
                <DialogHeader>
                    <DialogTitle>Record Payment - {tenant.name}</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* Outstanding Amount */}
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                        <p className="text-xs text-slate-600 mb-1">Total Outstanding</p>
                        <p className="text-2xl font-bold text-slate-900">${totalOutstanding.toFixed(2)}</p>
                    </div>

                    {/* Payment Amount Input */}
                    <div>
                        <label className="text-sm font-medium text-slate-700 mb-2 block">
                            Payment Received
                        </label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-medium">$</span>
                            <Input
                                type="number"
                                value={paymentAmount}
                                onChange={(e) => setPaymentAmount(e.target.value)}
                                className="pl-8 text-lg font-semibold"
                                placeholder="0.00"
                                step="0.01"
                                min="0"
                                max={totalOutstanding}
                            />
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                            Payment will be applied to oldest debt first
                        </p>
                    </div>

                    {/* Quick Amount Buttons */}
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setPaymentAmount((totalOutstanding / 2).toFixed(2))}
                            className="flex-1"
                        >
                            Half
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setPaymentAmount(totalOutstanding.toString())}
                            className="flex-1"
                        >
                            Full Amount
                        </Button>
                    </div>
                </div>

                <DialogFooter className="gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isProcessing}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        onClick={handleSubmit}
                        disabled={isProcessing}
                        className="bg-slate-900 hover:bg-black text-white"
                    >
                        {isProcessing ? 'Recording...' : 'Record Payment'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
