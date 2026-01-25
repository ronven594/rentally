"use client";

import { useState, useEffect } from "react";
import { format } from "date-fns";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Tenant } from "@/types";
import { CheckCircle2, Sparkles, Calendar, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatFrequencyLabel } from "@/lib/status-engine";

interface BankMatch {
    amount: number;
    date: string;
    reference?: string;
    confidence: number;
}

interface SmartPaymentModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    tenant: Tenant;
    onConfirmPayment: (amount: number, date: string) => Promise<void>;
    suggestedMatch?: BankMatch | null;
}

type ModalState = "input" | "processing" | "success";

export function SmartPaymentModal({
    open,
    onOpenChange,
    tenant,
    onConfirmPayment,
    suggestedMatch,
}: SmartPaymentModalProps) {
    // Auto-prefill with expected weekly rent and today's date
    const [amount, setAmount] = useState(tenant.rentAmount.toString());
    const [paymentDate, setPaymentDate] = useState(format(new Date(), "yyyy-MM-dd"));
    const [modalState, setModalState] = useState<ModalState>("input");
    const [useMatch, setUseMatch] = useState(false);

    // Reset state when modal opens
    useEffect(() => {
        if (open) {
            setAmount(tenant.rentAmount.toString());
            setPaymentDate(format(new Date(), "yyyy-MM-dd"));
            setModalState("input");
            setUseMatch(false);
        }
    }, [open, tenant.rentAmount]);

    // Handle clicking the AI suggestion
    const handleUseMatch = () => {
        if (suggestedMatch) {
            setAmount(suggestedMatch.amount.toString());
            setPaymentDate(suggestedMatch.date);
            setUseMatch(true);
        }
    };

    // Handle confirmation
    const handleConfirm = async () => {
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) return;

        setModalState("processing");

        try {
            await onConfirmPayment(parsedAmount, paymentDate);
            setModalState("success");

            // Auto-close after success animation
            setTimeout(() => {
                onOpenChange(false);
                // Reset for next time
                setTimeout(() => setModalState("input"), 300);
            }, 1500);
        } catch {
            setModalState("input");
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[420px] rounded-3xl border-0 shadow-2xl p-0 overflow-hidden">
                {/* Success State */}
                {modalState === "success" && (
                    <div className="flex flex-col items-center justify-center py-16 px-8">
                        <div className="relative">
                            <div className="absolute inset-0 bg-green-400/30 rounded-full animate-ping" />
                            <div className="relative w-20 h-20 bg-gradient-to-br from-green-400 to-green-500 rounded-full flex items-center justify-center shadow-lg shadow-green-500/30">
                                <CheckCircle2 className="w-10 h-10 text-white" />
                            </div>
                        </div>
                        <p className="mt-6 text-2xl font-black tracking-tighter text-nav-black">
                            Sweet as!
                        </p>
                        <p className="text-sm text-gray-500 mt-1">
                            Payment recorded successfully
                        </p>
                    </div>
                )}

                {/* Input State */}
                {modalState !== "success" && (
                    <>
                        <DialogHeader className="px-6 pt-6 pb-4">
                            <DialogTitle className="text-xl font-black italic tracking-tighter text-nav-black">
                                Confirm Payment
                            </DialogTitle>
                            <p className="text-sm text-gray-500 mt-1">
                                {tenant.name}
                            </p>
                        </DialogHeader>

                        <div className="px-6 pb-6 space-y-5">
                            {/* AI Suggestion Banner */}
                            {suggestedMatch && !useMatch && (
                                <button
                                    onClick={handleUseMatch}
                                    className="w-full bg-gradient-to-r from-violet-50 to-purple-50 border border-violet-200 rounded-2xl p-4 text-left hover:border-violet-300 transition-all group"
                                >
                                    <div className="flex items-start gap-3">
                                        <div className="w-8 h-8 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center flex-shrink-0">
                                            <Sparkles className="w-4 h-4 text-white" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-bold text-violet-600 uppercase tracking-wider mb-1">
                                                AI Suggestion
                                            </p>
                                            <p className="text-sm text-gray-700">
                                                I found a match for{" "}
                                                <span className="font-black text-nav-black">
                                                    ${suggestedMatch.amount.toFixed(2)}
                                                </span>{" "}
                                                on{" "}
                                                <span className="font-bold">
                                                    {format(new Date(suggestedMatch.date), "MMM d")}
                                                </span>
                                            </p>
                                            <p className="text-xs text-violet-500 mt-1 group-hover:text-violet-600 transition-colors">
                                                Click to reconcile
                                            </p>
                                        </div>
                                    </div>
                                </button>
                            )}

                            {/* Used Match Confirmation */}
                            {useMatch && suggestedMatch && (
                                <div className="bg-green-50 border border-green-200 rounded-2xl p-4">
                                    <div className="flex items-center gap-2">
                                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                                        <p className="text-sm font-bold text-green-700">
                                            Bank transaction matched
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Amount Input */}
                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">
                                    Amount
                                </label>
                                <div className="relative">
                                    <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                    <input
                                        type="number"
                                        value={amount}
                                        onChange={(e) => {
                                            setAmount(e.target.value);
                                            setUseMatch(false);
                                        }}
                                        className="w-full bg-[#F4F6F8] border-0 rounded-2xl py-4 pl-12 pr-4 text-2xl font-black tracking-tighter text-nav-black focus:ring-2 focus:ring-nav-black/20 focus:outline-none transition-all"
                                        placeholder="0.00"
                                        step="0.01"
                                        min="0"
                                        disabled={modalState === "processing"}
                                    />
                                </div>
                                <p className="text-xs text-gray-400 mt-2 pl-1">
                                    Expected: ${tenant.rentAmount.toFixed(2)} / {formatFrequencyLabel(tenant.frequency)}
                                </p>
                            </div>

                            {/* Date Input */}
                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">
                                    Payment Date
                                </label>
                                <div className="relative">
                                    <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                    <input
                                        type="date"
                                        value={paymentDate}
                                        onChange={(e) => {
                                            setPaymentDate(e.target.value);
                                            setUseMatch(false);
                                        }}
                                        className="w-full bg-[#F4F6F8] border-0 rounded-2xl py-4 pl-12 pr-4 text-base font-bold text-nav-black focus:ring-2 focus:ring-nav-black/20 focus:outline-none transition-all"
                                        disabled={modalState === "processing"}
                                    />
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={() => onOpenChange(false)}
                                    disabled={modalState === "processing"}
                                    className="flex-1 py-4 text-[11px] font-black uppercase tracking-[0.2em] rounded-full bg-white border-2 border-gray-200 text-gray-600 hover:border-gray-300 hover:text-nav-black transition-all disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleConfirm}
                                    disabled={modalState === "processing" || !amount || parseFloat(amount) <= 0}
                                    className={cn(
                                        "flex-1 py-4 text-[11px] font-black uppercase tracking-[0.2em] rounded-full transition-all disabled:opacity-50",
                                        "bg-safe-green text-white shadow-lg shadow-safe-green/20 hover:bg-safe-green/90"
                                    )}
                                >
                                    {modalState === "processing" ? (
                                        <span className="flex items-center justify-center gap-2">
                                            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            Processing
                                        </span>
                                    ) : (
                                        "Confirm"
                                    )}
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
