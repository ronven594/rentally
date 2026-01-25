"use client"

import { AlertTriangle, ChevronRight, Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { type ObligationMessage } from "@/lib/status-engine"

interface UpcomingObligationsProps {
    obligations?: ObligationMessage[] | null;
}

export function UpcomingObligations({ obligations }: UpcomingObligationsProps) {
    if (!obligations || obligations.length === 0) return null;

    // Get the most urgent obligation
    const primary = obligations[0];
    const isCritical = primary.urgency === 'critical';  // Phase 3: 10+ working days (Solid Red)
    const isHigh = primary.urgency === 'high';          // Phase 2: 5-9 working days (Solid Amber)
    const isMonitor = primary.urgency === 'monitor';    // Phase 1: 1-4 calendar days (White + Glow)

    return (
        <div className="mb-6 animate-in slide-in-from-top-4 duration-500 space-y-2">
            {/* Primary (most urgent) obligation - Neon Dark 3-Phase Escalation */}
            <button
                className={cn(
                    "w-full flex items-center justify-between p-4 rounded-2xl active:scale-[0.98] transition-all",
                    // Phase 3: Termination Eligible (Solid Electric Red)
                    isCritical && "bg-[#FF3B3B] text-white shadow-[0_0_20px_rgba(255,59,59,0.5)]",
                    // Phase 2: Strike Warning (Solid Electric Gold)
                    isHigh && "bg-[#FFB800] text-[#0B0E11] shadow-[0_0_15px_rgba(255,184,0,0.4)]",
                    // Phase 1: Caution (Glass + Electric Gold Glow)
                    isMonitor && "bg-white/5 backdrop-blur-xl text-white border border-[#FFB800]/50 shadow-[0_0_15px_rgba(255,184,0,0.3)]"
                )}
            >
                <div className="flex items-center gap-3">
                    <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center",
                        isCritical && "bg-white/20",
                        isHigh && "bg-[#0B0E11]/20",
                        isMonitor && "bg-[#FFB800]/10"
                    )}>
                        {isCritical ? (
                            <AlertTriangle className="w-5 h-5 text-white" />
                        ) : isMonitor ? (
                            <Clock className="w-5 h-5 text-[#FFB800]" />
                        ) : (
                            <AlertTriangle className="w-5 h-5 text-[#0B0E11]" />
                        )}
                    </div>
                    <div className="text-left">
                        <p className={cn(
                            "text-[10px] font-black uppercase tracking-[0.2em] mb-0.5 font-mono",
                            isCritical && "text-white/80",
                            isHigh && "text-[#0B0E11]/70",
                            isMonitor && "text-[#FFB800]"
                        )}>
                            {isCritical ? 'Action Required' : isMonitor ? 'Payment Pending' : 'Strike Warning'}
                        </p>
                        <p className={cn(
                            "text-sm font-black leading-tight tracking-tight",
                            isCritical && "text-white",
                            isHigh && "text-[#0B0E11]",
                            isMonitor && "text-white"
                        )}>
                            {isCritical
                                ? `Strike Notice Ready for ${primary.propertyAddress.split(',')[0]}`
                                : isMonitor
                                    ? `${primary.tenantName} is ${primary.calendarDays || primary.daysLate} day${(primary.calendarDays || primary.daysLate) !== 1 ? 's' : ''} overdue`
                                    : `${primary.tenantName} is ${primary.daysLate} working days behind`
                            }
                        </p>
                    </div>
                </div>
                <ChevronRight className={cn(
                    "w-5 h-5",
                    isCritical && "text-white/60",
                    isHigh && "text-[#0B0E11]/40",
                    isMonitor && "text-white/40"
                )} />
            </button>

            {/* Secondary obligations (if any) */}
            {obligations.length > 1 && (
                <div className="flex items-center gap-2 px-2">
                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider font-mono">
                        +{obligations.length - 1} more
                    </span>
                    <div className="flex -space-x-1">
                        {obligations.slice(1, 4).map((obl, idx) => (
                            <div
                                key={idx}
                                className={cn(
                                    "w-6 h-6 rounded-full border-2 border-[#0B0E11] flex items-center justify-center text-[8px] font-black font-mono",
                                    obl.urgency === 'critical' && "bg-[#FF3B3B] text-white shadow-[0_0_8px_rgba(255,59,59,0.5)]",
                                    obl.urgency === 'high' && "bg-[#FFB800] text-[#0B0E11]",
                                    obl.urgency === 'monitor' && "bg-[#FFB800]/80 text-[#0B0E11]"
                                )}
                            >
                                {obl.calendarDays || obl.daysLate}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
