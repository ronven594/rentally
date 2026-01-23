"use client"

import { parseISO, differenceInCalendarDays, format } from "date-fns"
import { AlertTriangle, Clock, CalendarCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { getTribunalFilingDeadline } from "@/lib/rent-logic"

interface TribunalFilingAlertProps {
    thirdNoticeServiceDate: string;
    testDate?: Date;
}

/**
 * TribunalFilingAlert - RTA Section 55(1)(aa) Compliance Component
 * 
 * Provides a high-visibility countdown for the 28-day window landlords 
 * have to file for termination at the Tenancy Tribunal after the 3rd 
 * Section 55 notice has been served.
 */
export function TribunalFilingAlert({ thirdNoticeServiceDate, testDate }: TribunalFilingAlertProps) {
    const deadlineStr = getTribunalFilingDeadline(thirdNoticeServiceDate);
    const deadline = parseISO(deadlineStr);
    const today = testDate || new Date();

    // Calculate calendar days remaining
    const daysRemaining = differenceInCalendarDays(deadline, today);
    const isOverdue = daysRemaining < 0;

    // Dynamic Styling Logic 
    // Green > 14 days | Amber 7-14 days | Red < 7 days
    let colorClass = "bg-emerald-50 border-emerald-100 text-emerald-800";
    let iconClass = "text-emerald-500";
    let progressColor = "bg-emerald-500";
    let statusText = "Eligible for Filing";

    if (daysRemaining < 7) {
        colorClass = "bg-rose-50 border-rose-100 text-rose-800 animate-pulse";
        iconClass = "text-rose-500";
        progressColor = "bg-rose-500";
        statusText = "CRITICAL DEADLINE";
    } else if (daysRemaining <= 14) {
        colorClass = "bg-amber-50 border-amber-100 text-amber-800";
        iconClass = "text-amber-500";
        progressColor = "bg-amber-500";
        statusText = "Filing Window Closing";
    }

    if (isOverdue) {
        return (
            <div className="bg-slate-900 border border-slate-800 rounded-[28px] p-6 text-white flex items-center gap-5 shadow-2xl">
                <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center text-rose-500 shrink-0 shadow-inner">
                    <AlertTriangle className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">Filing Window Closed</h4>
                    <p className="text-xs font-bold text-slate-300 leading-relaxed">
                        The 28-day window to file for termination (RTA s55) has expired as of {format(deadline, 'PPP')}.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className={cn(
            "relative overflow-hidden rounded-[32px] border p-6 shadow-sm transition-all duration-700",
            colorClass
        )}>
            {/* Visual Progress Bar (28-day backdrop) */}
            <div className="absolute bottom-0 left-0 h-2 w-full bg-slate-950/5">
                <div
                    className={cn("h-full transition-all duration-1000 ease-out", progressColor)}
                    style={{ width: `${Math.max(0, Math.min(100, (daysRemaining / 28) * 100))}%` }}
                />
            </div>

            <div className="flex items-start gap-5 relative z-10">
                <div className={cn(
                    "w-14 h-14 rounded-2xl flex items-center justify-center shadow-inner shrink-0",
                    daysRemaining < 7 ? "bg-rose-100/50" : daysRemaining <= 14 ? "bg-amber-100/50" : "bg-emerald-100/50"
                )}>
                    {daysRemaining < 7 ? (
                        <AlertTriangle className={cn("w-7 h-7", iconClass)} />
                    ) : (
                        <Clock className={cn("w-7 h-7", iconClass)} />
                    )}
                </div>

                <div className="flex-1 space-y-1.5">
                    <div className="flex justify-between items-start">
                        <div className="space-y-0.5">
                            <h4 className="text-[10px] font-black uppercase tracking-[0.25em] opacity-60 flex items-center gap-2">
                                {statusText}
                            </h4>
                            <p className="text-xs font-bold leading-tight">
                                Termination Eligible &mdash; 28 Day Filing Deadline
                            </p>
                        </div>
                        <div className="bg-white/40 px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-tighter opacity-50 border border-black/5">
                            RTA s55(1)(aa)
                        </div>
                    </div>

                    <div className="flex items-baseline gap-2 py-1">
                        <span className="text-4xl font-black tabular-nums tracking-tighter leading-none">
                            {daysRemaining}
                        </span>
                        <div className="flex flex-col">
                            <span className="text-[10px] font-black uppercase tracking-widest leading-none">Days Left</span>
                            <span className="text-xs font-bold opacity-60 leading-none mt-1">to file at Tribunal</span>
                        </div>
                    </div>

                    <div className="pt-1 flex flex-col gap-0.5 border-t border-black/5">
                        <p className="text-[11px] font-medium opacity-70">
                            3rd notice served on <span className="font-bold underline decoration-current/25">{format(parseISO(thirdNoticeServiceDate), 'PPP')}</span>
                        </p>
                        <p className="text-[11px] font-medium opacity-70">
                            You must file by <span className="font-bold">{format(deadline, 'PPP')}</span>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
