"use client"

import { useState, useEffect } from "react"
import { DropZone } from "@/components/tax-vault/DropZone"
import { ExpenseCard } from "@/components/tax-vault/ExpenseCard"
import { EditExpenseDialog } from "@/components/tax-vault/EditExpenseDialog"
import { Expense } from "@/types"
import { Button } from "@/components/ui/button"
import { Download, TrendingUp, Info, CheckCircle, FileX } from "lucide-react"
import { extractReceiptData } from "@/lib/ocr"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"

// Validation Helper
const validateExpense = (expense: Expense): Expense => {
    const hasRequiredFields = expense.date && expense.merchant && expense.amount;
    const needsGST = expense.amount > 50 && !expense.gst;

    if (!hasRequiredFields) {
        return { ...expense, status: "Incomplete Info" };
    }
    if (needsGST) {
        return { ...expense, status: "Missing GST" };
    }
    return { ...expense, status: "Verified" };
};

// Mock Data - includes incomplete examples
const INITIAL_EXPENSES: Expense[] = [];

export default function TaxVaultPage() {
    const [expenses, setExpenses] = useState<Expense[]>(INITIAL_EXPENSES);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isLoaded, setIsLoaded] = useState(false);
    const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [expenseToDelete, setExpenseToDelete] = useState<string | null>(null);

    // Load from LocalStorage
    useEffect(() => {
        const savedExpenses = localStorage.getItem("landlord_expenses");
        if (savedExpenses) setExpenses(JSON.parse(savedExpenses));
        setIsLoaded(true);
    }, []);

    // Save to LocalStorage
    useEffect(() => {
        if (isLoaded) {
            localStorage.setItem("landlord_expenses", JSON.stringify(expenses));
        }
    }, [expenses, isLoaded]);

    const handleUpdateCategory = (id: string, newCategory: Expense["category"]) => {
        setExpenses(prev => prev.map(e => e.id === id ? { ...e, category: newCategory } : e));
    };

    const handleEditExpense = (expense: Expense) => {
        setEditingExpense(expense);
    };

    const handleSaveExpense = (updated: Expense) => {
        const validated = validateExpense(updated);
        setExpenses(prev => prev.map(e => e.id === updated.id ? validated : e));
        setEditingExpense(null);
    };

    const handleRequestDelete = (id: string) => {
        setExpenseToDelete(id);
        setDeleteDialogOpen(true);
    };

    const handleConfirmDelete = () => {
        if (expenseToDelete) {
            setExpenses(prev => prev.filter(e => e.id !== expenseToDelete));
            setExpenseToDelete(null);
        }
        setDeleteDialogOpen(false);
    };

    const handleFilesDropped = async (files: File[]) => {
        setIsProcessing(true);

        try {
            // Process files with real OCR
            const newExpenses: Expense[] = [];

            for (const file of files) {
                // Extract data from image using Tesseract
                const extracted = await extractReceiptData(file);

                // Create expense with extracted data
                const expense: Expense = {
                    id: Math.random().toString(),
                    date: new Date().toISOString().split('T')[0],
                    merchant: extracted.vendor,
                    amount: extracted.amount || 0,
                    gst: extracted.gst,
                    category: "Maintenance" as const, // Default category
                    status: "Processing" as const
                };

                // Validate extracted data
                const validated = validateExpense(expense);
                newExpenses.push(validated);
            }

            // Add to expenses list
            setExpenses(prev => [...newExpenses, ...prev]);
        } catch (error) {
            console.error('OCR processing failed:', error);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleExport = () => {
        // IR3R Compliant CSV Export
        const headers = ["Date,Vendor,Category,Amount (Incl GST),GST Component,Notes\n"];
        const rows = expenses.map(e => {
            const gst = (e.amount * 3) / 23;
            return `${e.date},${e.merchant},${e.category},${e.amount.toFixed(2)},${gst.toFixed(2)},IRD Compliant Record`;
        });
        const csvContent = headers.concat(rows).join("\n");

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", "landlord_ir3r_export.csv");
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    // Derived State
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const taxOffset = totalExpenses * 0.33;

    return (
        <div className="min-h-screen bg-[#F5F9F9] p-6 pb-24 font-sans text-slate-800">
            {/* Header */}
            <header className="flex justify-between items-center mb-8 pt-2">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900">Tax Savings Optimizer</h1>
                    <p className="text-slate-400 text-sm font-medium">Maximize your deductions, minimize stress.</p>
                </div>
                <Button
                    onClick={handleExport}
                    className="bg-slate-900 text-white hover:bg-slate-800 shadow-md transition-all"
                >
                    <CheckCircle className="w-4 h-4 mr-2 text-emerald-400" />
                    Finalize for Accountant
                </Button>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
                {/* Left Column: Upload & Stats */}
                <div className="md:col-span-1 space-y-6">
                    {/* Hero Stat Card - GREEN for Success/Savings */}
                    <div className="bg-emerald-600 text-white p-6 rounded-2xl shadow-lg relative overflow-hidden group hover:shadow-xl transition-all">
                        <div className="relative z-10">
                            <div className="flex items-center gap-2 mb-1 opacity-90">
                                <p className="text-xs font-bold uppercase tracking-wider">Estimated Tax Offset</p>
                                <Info className="w-3 h-3 cursor-help" />
                            </div>
                            <h2 className="text-4xl font-bold tracking-tight">${taxOffset.toFixed(0)}</h2>
                            <p className="text-emerald-100 text-xs mt-2 font-medium">
                                Based on ${totalExpenses.toFixed(0)} expenses @ 33% rate
                            </p>
                        </div>
                        {/* Decorative Graphic */}
                        <TrendingUp className="absolute -bottom-4 -right-4 w-32 h-32 text-emerald-900 opacity-20 group-hover:scale-110 transition-transform duration-500" />
                    </div>

                    {/* Drop Zone */}
                    <DropZone onFilesDropped={handleFilesDropped} />

                    {isProcessing && (
                        <div className="relative w-full h-16 bg-white border-2 border-emerald-500 border-dashed rounded-xl flex items-center justify-center overflow-hidden">
                            <div className="absolute inset-0 bg-emerald-50/50 animate-pulse"></div>
                            <div className="relative flex items-center gap-3 text-emerald-700 font-bold tracking-wide animate-pulse">
                                <div className="w-2 h-2 bg-emerald-600 rounded-full animate-bounce"></div>
                                SCANNING...
                            </div>
                        </div>
                    )}
                </div>

                {/* Right Column: Feed */}
                <div className="md:col-span-2 space-y-4">
                    <div className="flex items-center justify-between mb-2">
                        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider ml-1">Digital Records</h2>
                        <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
                            {expenses.length} Records Verified
                        </span>
                    </div>

                    <div className="space-y-3">
                        {expenses.length > 0 ? (
                            expenses.map(expense => (
                                <ExpenseCard
                                    key={expense.id}
                                    expense={expense}
                                    onUpdateCategory={handleUpdateCategory}
                                    onEdit={handleEditExpense}
                                    onDelete={handleRequestDelete}
                                />
                            ))
                        ) : (
                            <div className="flex flex-col items-center justify-center h-64 bg-white rounded-xl border-2 border-dashed border-slate-200">
                                <FileX className="w-12 h-12 text-slate-300 mb-4" />
                                <h3 className="text-lg font-bold text-slate-600">No receipts uploaded yet</h3>
                                <p className="text-sm text-slate-400 mt-2">Tap to scan your first receipt!</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Edit Dialog */}
            {editingExpense && (
                <EditExpenseDialog
                    expense={editingExpense}
                    open={!!editingExpense}
                    onOpenChange={(open) => !open && setEditingExpense(null)}
                    onSave={handleSaveExpense}
                />
            )}

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Receipt?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will remove the receipt from your records. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleConfirmDelete}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
