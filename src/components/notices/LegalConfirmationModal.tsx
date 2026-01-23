"use client";

import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Send } from "lucide-react";

interface LegalConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    isLoading?: boolean;
    noticeType: string;
    tenantName: string;
}

export function LegalConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
    isLoading = false,
    noticeType,
    tenantName,
}: LegalConfirmationModalProps) {
    const [bankAccountChecked, setBankAccountChecked] = useState(false);
    const [ledgerAccuracyChecked, setLedgerAccuracyChecked] = useState(false);
    const [tribunalWarningChecked, setTribunalWarningChecked] = useState(false);

    const allChecked = bankAccountChecked && ledgerAccuracyChecked && tribunalWarningChecked;

    const handleClose = () => {
        // Reset checkboxes when modal closes
        setBankAccountChecked(false);
        setLedgerAccuracyChecked(false);
        setTribunalWarningChecked(false);
        onClose();
    };

    const handleConfirm = () => {
        if (allChecked) {
            onConfirm();
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-[525px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-amber-500" />
                        Legal Confirmation Required
                    </DialogTitle>
                    <DialogDescription>
                        You are about to send a <strong>{noticeType}</strong> notice to{" "}
                        <strong>{tenantName}</strong>. Please confirm the following before
                        proceeding.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* Bank Account Check */}
                    <div className="flex items-start space-x-3">
                        <Checkbox
                            id="bank-account"
                            checked={bankAccountChecked}
                            onCheckedChange={(checked) =>
                                setBankAccountChecked(checked === true)
                            }
                            disabled={isLoading}
                        />
                        <Label
                            htmlFor="bank-account"
                            className="text-sm leading-relaxed cursor-pointer"
                        >
                            I have checked my bank account and confirmed no payments have
                            arrived in the last 24 hours.
                        </Label>
                    </div>

                    {/* Ledger Accuracy Check */}
                    <div className="flex items-start space-x-3">
                        <Checkbox
                            id="ledger-accuracy"
                            checked={ledgerAccuracyChecked}
                            onCheckedChange={(checked) =>
                                setLedgerAccuracyChecked(checked === true)
                            }
                            disabled={isLoading}
                        />
                        <Label
                            htmlFor="ledger-accuracy"
                            className="text-sm leading-relaxed cursor-pointer"
                        >
                            I confirm that the rent ledger provided to the AI is accurate as
                            of this moment.
                        </Label>
                    </div>

                    {/* Tribunal Warning Check */}
                    <div className="flex items-start space-x-3">
                        <Checkbox
                            id="tribunal-warning"
                            checked={tribunalWarningChecked}
                            onCheckedChange={(checked) =>
                                setTribunalWarningChecked(checked === true)
                            }
                            disabled={isLoading}
                        />
                        <Label
                            htmlFor="tribunal-warning"
                            className="text-sm leading-relaxed cursor-pointer"
                        >
                            I understand that serving an invalid notice may result in a
                            challenge at the Tenancy Tribunal.
                        </Label>
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button
                        variant="outline"
                        onClick={handleClose}
                        disabled={isLoading}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        disabled={!allChecked || isLoading}
                        className="gap-2"
                    >
                        {isLoading ? (
                            <>
                                <span className="animate-spin">⏳</span>
                                Sending...
                            </>
                        ) : (
                            <>
                                <Send className="h-4 w-4" />
                                Confirm & Send Notice
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
