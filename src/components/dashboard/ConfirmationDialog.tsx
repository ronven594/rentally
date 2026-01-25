"use client"

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface ConfirmationDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: string;
    confirmText?: string;
    variant?: "default" | "destructive";
    onConfirm: () => void;
}

export function ConfirmationDialog({
    open,
    onOpenChange,
    title,
    description,
    confirmText = "Confirm",
    variant = "default",
    onConfirm
}: ConfirmationDialogProps) {
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent className="bg-white rounded-2xl shadow-lg border-none">
                <AlertDialogHeader>
                    <AlertDialogTitle className="font-black text-nav-black">{title}</AlertDialogTitle>
                    <AlertDialogDescription className="text-slate-500">
                        {description}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel className="rounded-xl border-none hover:bg-slate-100 text-nav-black font-bold">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={onConfirm}
                        className={variant === "destructive"
                            ? "bg-overdue-red hover:bg-overdue-red/90 text-white rounded-xl font-black shadow-lg"
                            : "bg-safe-green hover:bg-safe-green/90 text-white rounded-xl font-black shadow-lg"}
                    >
                        {confirmText}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
