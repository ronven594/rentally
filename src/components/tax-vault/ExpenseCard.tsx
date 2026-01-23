import { Expense } from "@/types"
import { cn } from "@/lib/utils"
import { FileText, Wrench, Building2, Shield, DollarSign, CheckCircle2, AlertCircle, Edit3, Trash2 } from "lucide-react"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

interface ExpenseCardProps {
    expense: Expense;
    onUpdateCategory: (id: string, newCategory: Expense["category"]) => void;
    onEdit: (expense: Expense) => void;
    onDelete: (id: string) => void;
}

export function ExpenseCard({ expense, onUpdateCategory, onEdit, onDelete }: ExpenseCardProps) {
    const getIcon = () => {
        switch (expense.category) {
            case "Maintenance": return <Wrench className="w-4 h-4 text-orange-500" />;
            case "Rates": return <Building2 className="w-4 h-4 text-blue-500" />;
            case "Insurance": return <Shield className="w-4 h-4 text-purple-500" />;
            case "Interest": return <DollarSign className="w-4 h-4 text-emerald-500" />;
            case "Management Fees": return <FileText className="w-4 h-4 text-indigo-500" />;
            case "Legal Fees": return <Shield className="w-4 h-4 text-red-500" />;
            default: return <FileText className="w-4 h-4 text-slate-400" />;
        }
    }

    const getBadgeConfig = () => {
        switch (expense.status) {
            case "Verified":
                return {
                    icon: <CheckCircle2 className="w-3 h-3" />,
                    text: "COMPLIANCE VERIFIED",
                    className: "bg-emerald-100 text-emerald-700"
                };
            case "Incomplete Info":
                return {
                    icon: <AlertCircle className="w-3 h-3" />,
                    text: "INCOMPLETE INFO",
                    className: "bg-orange-100 text-orange-700"
                };
            case "Missing GST":
                return {
                    icon: <AlertCircle className="w-3 h-3" />,
                    text: "MISSING GST",
                    className: "bg-amber-100 text-amber-700"
                };
            default:
                return {
                    icon: null,
                    text: expense.status,
                    className: "bg-slate-100 text-slate-500"
                };
        }
    };

    const badgeConfig = getBadgeConfig();
    const isIncomplete = expense.status === "Incomplete Info" || expense.status === "Missing GST";

    const handleDeleteClick = (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent triggering the card onClick
        onDelete(expense.id);
    };

    return (
        <div
            className={cn(
                "relative flex flex-col p-4 bg-white rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition-all group",
                isIncomplete && "cursor-pointer hover:border-orange-300"
            )}
            onClick={() => isIncomplete && onEdit(expense)}
        >
            {/* Delete Button - 44x44px touch target, bottom-right for better mobile UX */}
            <button
                onClick={handleDeleteClick}
                className="absolute bottom-2 right-2 w-11 h-11 flex items-center justify-center rounded-lg bg-white/80 hover:bg-red-50 text-slate-400 hover:text-red-500 shadow-sm transition-colors z-10"
                aria-label="Delete receipt"
            >
                <Trash2 className="w-4 h-4" />
            </button>

            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-slate-50 flex items-center justify-center border border-slate-100">
                        {getIcon()}
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-slate-800">{expense.merchant || "Unknown Vendor"}</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-slate-400">{expense.date} •</span>
                            <Select
                                value={expense.category}
                                onValueChange={(val) => onUpdateCategory(expense.id, val as Expense["category"])}
                                disabled={isIncomplete}
                            >
                                <SelectTrigger className="h-6 w-auto p-0 px-2 text-[10px] font-bold uppercase tracking-wider bg-slate-100 border-none rounded-full hover:bg-slate-200 text-slate-600 focus:ring-0">
                                    <SelectValue>{expense.category}</SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Maintenance">Maintenance</SelectItem>
                                    <SelectItem value="Rates">Rates</SelectItem>
                                    <SelectItem value="Insurance">Insurance</SelectItem>
                                    <SelectItem value="Interest">Interest</SelectItem>
                                    <SelectItem value="Management Fees">Management Fees</SelectItem>
                                    <SelectItem value="Legal Fees">Legal Fees</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>
                <div className="text-right">
                    <p className="text-sm font-bold text-slate-900">${expense.amount.toFixed(2)}</p>
                    <div className={cn(
                        "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full inline-block mt-1 flex items-center gap-1",
                        badgeConfig.className
                    )}>
                        {badgeConfig.icon}
                        {badgeConfig.text}
                    </div>
                </div>
            </div>

            {/* Compliance Footer */}
            {expense.status === "Verified" ? (
                <div className="mt-2 pt-2 border-t border-slate-50 flex items-center gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">
                    <Shield className="w-3 h-3 text-emerald-500" />
                    <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                        Meets IRD digital record-keeping standards. You may securely discard the original paper copy.
                    </span>
                </div>
            ) : (
                <div className="mt-2 pt-2 border-t border-slate-50 flex items-center gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">
                    <Edit3 className="w-3 h-3 text-orange-500" />
                    <span className="text-[10px] font-medium text-orange-600 uppercase tracking-wide">
                        Click to complete missing information
                    </span>
                </div>
            )}
        </div>
    )
}
