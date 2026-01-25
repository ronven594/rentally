"use client";

import { useState, useEffect } from "react";
import { format, parseISO } from "date-fns";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Tenant, PaymentHistoryEntry } from "@/types";
import { CheckCircle2, Sparkles, Calendar, DollarSign, Trash2, AlertCircle } from "lucide-react";
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
    onVoidPayment?: (paymentId: string) => Promise<void>;
    totalOutstandingBalance?: number;
    suggestedMatch?: BankMatch | null;
}

type ModalState = "input" | "processing" | "success";

export function SmartPaymentModal({
    open,
    onOpenChange,
    tenant,
    onConfirmPayment,
    onVoidPayment,
    totalOutstandingBalance,
    suggestedMatch,
}: SmartPaymentModalProps) {
    // Auto-prefill with expected weekly rent and today's date
    const [amount, setAmount] = useState(tenant.rentAmount.toString());
    const [paymentDate, setPaymentDate] = useState(format(new Date(), "yyyy-MM-dd"));
    const [modalState, setModalState] = useState<ModalState>("input");
    const [useMatch, setUseMatch] = useState(false);
    const [voidingPaymentId, setVoidingPaymentId] = useState<string | null>(null);

    // Calculate validation states
    const parsedAmount = parseFloat(amount);
    const exceedsBalance = totalOutstandingBalance !== undefined && parsedAmount > totalOutstandingBalance;
    const isAmountValid = !isNaN(parsedAmount) && parsedAmount > 0 && !exceedsBalance;

    // Reset state when modal opens
    useEffect(() => {
        if (open) {
            setAmount(tenant.rentAmount.toString());
            setPaymentDate(format(new Date(), "yyyy-MM-dd"));
            setModalState("input");
            setUseMatch(false);
            setVoidingPaymentId(null);
        }
    }, [open, tenant.rentAmount]);

    // Get recent payment history (last 5 payments)
    const recentPayments = (tenant.paymentHistory || [])
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 5);

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
        if (!isAmountValid) return;

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

    // Handle voiding a payment
    const handleVoidPayment = async (paymentId: string) => {
        if (!onVoidPayment) return;

        setVoidingPaymentId(paymentId);

        try {
            await onVoidPayment(paymentId);
            // Success will be handled by parent component refresh
        } catch (error) {
            console.error("Failed to void payment:", error);
        } finally {
            setVoidingPaymentId(null);
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
                                        className={cn(
                                            "w-full bg-white border-2 border-gray-200 rounded-2xl py-4 pl-12 pr-4 text-2xl font-black tracking-tighter text-nav-black focus:ring-2 focus:outline-none transition-all",
                                            exceedsBalance ? "focus:ring-red-500/30 ring-2 ring-red-500/20 border-red-500/20" : "focus:ring-nav-black/20 focus:border-nav-black/30"
                                        )}
                                        placeholder="0.00"
                                        step="0.01"
                                        min="0"
                                        max={totalOutstandingBalance}
                                        disabled={modalState === "processing"}
                                    />
                                </div>
                                {exceedsBalance && totalOutstandingBalance !== undefined ? (
                                    <div className="flex items-center gap-1.5 mt-2 pl-1">
                                        <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                                        <p className="text-xs text-red-500 font-bold">
                                            Cannot exceed current balance of ${totalOutstandingBalance.toFixed(2)}
                                        </p>
                                    </div>
                                ) : (
                                    <p className="text-xs text-gray-400 mt-2 pl-1">
                                        Expected: ${tenant.rentAmount.toFixed(2)} / {formatFrequencyLabel(tenant.frequency)}
                                    </p>
                                )}
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
                                        className="w-full bg-white border-2 border-gray-200 rounded-2xl py-4 pl-12 pr-4 text-base font-bold text-nav-black focus:ring-2 focus:ring-nav-black/20 focus:border-nav-black/30 focus:outline-none transition-all"
                                        disabled={modalState === "processing"}
                                    />
                                </div>
                            </div>

                            {/* Recent Payment History */}
                            {recentPayments.length > 0 && (
                                <div className="border-t border-gray-200 pt-5">
                                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 block">
                                        Recent Payments
                                    </label>
                                    <div className="max-h-[160px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                                        {recentPayments.map((payment, index) => (
                                            <div
                                                key={payment.id}
                                                className="flex items-center justify-between py-2.5 px-3 bg-white rounded-xl border border-gray-200 transition-all hover:bg-gray-50"
                                            >
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-bold text-nav-black">
                                                            ${payment.amount.toFixed(2)}
                                                        </span>
                                                        <span className="text-xs text-gray-400">•</span>
                                                        <span className="text-xs text-gray-700 font-medium">
                                                            {format(parseISO(payment.date), "MMM d, yyyy")}
                                                        </span>
                                                    </div>
                                                    {payment.method && (
                                                        <p className="text-[10px] text-gray-400 mt-0.5">
                                                            {payment.method}
                                                        </p>
                                                    )}
                                                </div>

                                                {/* Void button - only show for most recent payment */}
                                                {index === 0 && onVoidPayment && (
                                                    <button
                                                        onClick={() => handleVoidPayment(payment.id)}
                                                        disabled={voidingPaymentId === payment.id || modalState === "processing"}
                                                        className="ml-3 p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                                                        title="Void this payment"
                                                    >
                                                        {voidingPaymentId === payment.id ? (
                                                            <span className="w-4 h-4 border-2 border-red-500/30 border-t-red-500 rounded-full animate-spin block" />
                                                        ) : (
                                                            <Trash2 className="w-4 h-4" />
                                                        )}
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>

                                    {/* Custom scrollbar styles */}
                                    <style dangerouslySetInnerHTML={{
                                        __html: `
                                            .custom-scrollbar::-webkit-scrollbar {
                                                width: 4px;
                                            }
                                            .custom-scrollbar::-webkit-scrollbar-track {
                                                background: #F1F5F9;
                                                border-radius: 10px;
                                            }
                                            .custom-scrollbar::-webkit-scrollbar-thumb {
                                                background: #CBD5E1;
                                                border-radius: 10px;
                                            }
                                            .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                                                background: #94A3B8;
                                            }
                                        `
                                    }} />
                                </div>
                            )}

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
                                    disabled={modalState === "processing" || !isAmountValid}
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
