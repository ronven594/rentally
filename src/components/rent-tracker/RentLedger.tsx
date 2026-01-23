"use client"

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RentPayment } from "@/types"
import { getPaymentStatus, isStrike } from "@/lib/rent-logic"
import { cn } from "@/lib/utils"

interface RentLedgerProps {
    payments: RentPayment[];
    onToggleStatus: (id: string) => void; // Added onToggleStatus prop
}

export function RentLedger({ payments, onToggleStatus }: RentLedgerProps) { // Destructured onToggleStatus
    // Sort payments by due date descending
    const sortedPayments = [...payments].sort((a, b) =>
        new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime()
    );

    return (
        <div className="rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Due Date</TableHead>
                        <TableHead>Paid Date</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Notes</TableHead> {/* Removed text-right from Notes */}
                        <TableHead className="text-right">Action</TableHead> {/* Added Action TableHead */}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {sortedPayments.map((payment) => {
                        const status = getPaymentStatus(payment.dueDate, payment.paidDate);
                        const strike = isStrike(payment.dueDate, payment.paidDate);

                        return (
                            <TableRow key={payment.id} className={cn(strike && "bg-red-50 hover:bg-red-50")}>
                                <TableCell className="font-medium">{payment.dueDate}</TableCell>
                                <TableCell>{payment.paidDate || "-"}</TableCell>
                                <TableCell>${payment.amount}</TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-2">
                                        <Badge
                                            variant={
                                                status === "Paid" ? "outline" :
                                                    status === "Unpaid" ? "destructive" :
                                                        status === "Late" ? "secondary" : "default"
                                            }
                                            className={
                                                status === "Paid" ? "bg-green-50 text-green-700 border-green-200" :
                                                    status === "Late" ? "bg-yellow-50 text-yellow-700 border-yellow-200" : ""
                                            }
                                        >
                                            {status}
                                        </Badge>
                                        {strike && (
                                            <Badge variant="destructive" className="bg-red-600 text-white h-5 px-1.5 text-[10px]">
                                                STRIKE
                                            </Badge>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell>{payment.notes || "-"}</TableCell> {/* Notes cell */}
                                <TableCell className="text-right"> {/* Added Action TableCell */}
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => onToggleStatus(payment.id)}
                                        className="h-8 text-xs underline"
                                    >
                                        {status === "Paid" ? "Mark Unpaid" : "Mark Paid"}
                                    </Button>
                                </TableCell>
                            </TableRow>
                        )
                    })}
                </TableBody>
            </Table>
        </div>
    )
}
