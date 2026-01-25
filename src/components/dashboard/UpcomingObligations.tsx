"use client"

import { AlertTriangle, ChevronRight, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { type ObligationMessage } from "@/lib/status-engine"

interface UpcomingObligationsProps {
    obligations?: ObligationMessage[] | null;
    globalSeverityRank?: 1 | 2 | 3 | 4 | 5;
}

export function UpcomingObligations({ obligations, globalSeverityRank = 1 }: UpcomingObligationsProps) {
    // Determine global banner message and styling based on severity rank
    type GlobalBannerConfig = {
        rank: 1 | 2 | 3 | 4 | 5;
        text: string;
        bgColor: string;
        borderColor: string;
        textColor: string;
        iconColor: string;
        breathing?: boolean;
    };

    const getGlobalBannerConfig = (): GlobalBannerConfig => {
        switch (globalSeverityRank) {
            case 5:
                return {
                    rank: 5,
                    text: "URGENT: YOU HAVE TENANTS ELIGIBLE FOR TERMINATION. ACTION REQUIRED.",
                    bgColor: "bg-[#FF3B3B]/10",
                    borderColor: "border-[#FF3B3B]",
                    textColor: "text-[#FF3B3B]",
                    iconColor: "#FF3B3B",
                    breathing: true
                };
            case 4:
                return {
                    rank: 4,
                    text: "ATTENTION: SERIOUS ARREARS DETECTED (10+ WORKING DAYS). CHECK TENANT CARDS.",
                    bgColor: "bg-[#FF3B3B]/10",
                    borderColor: "border-[#FF3B3B]",
                    textColor: "text-[#FF3B3B]",
                    iconColor: "#FF3B3B",
                    breathing: false
                };
            case 3:
                return {
                    rank: 3,
                    text: "NOTICE READY: REPEATED BREACHES DETECTED. STRIKE NOTICES ELIGIBLE.",
                    bgColor: "bg-[#FBBF24]/10",
                    borderColor: "border-[#FBBF24]",
                    textColor: "text-[#FBBF24]",
                    iconColor: "#FBBF24",
                    breathing: false
                };
            case 2:
                return {
                    rank: 2,
                    text: "REMINDER: SOME RENT IS OVERDUE (1-4 DAYS).",
                    bgColor: "bg-[#D97706]/10",
                    borderColor: "border-[#D97706]",
                    textColor: "text-[#D97706]",
                    iconColor: "#D97706",
                    breathing: false
                };
            default:
                return {
                    rank: 1,
                    text: "CHOICE! ALL RENT IS CURRENT ACROSS THE PORTFOLIO.",
                    bgColor: "bg-[#059669]",
                    borderColor: "border-[#059669]",
                    textColor: "text-white",
                    iconColor: "#FFFFFF",
                    breathing: false
                };
        }
    };

    const bannerConfig = getGlobalBannerConfig();

    // Only show banner if rank > 1 OR if we want to show the "all good" message
    // For now, let's only show when there are issues (rank > 1)
    if (globalSeverityRank === 1 && (!obligations || obligations.length === 0)) {
        // Show the green "all good" banner
        return (
            <div className="mb-6 animate-in slide-in-from-top-4 duration-500">
                <div className={cn(
                    "w-full flex items-center justify-between px-4 py-3 rounded-2xl backdrop-blur-md border",
                    bannerConfig.bgColor,
                    bannerConfig.borderColor
                )}>
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                            <CheckCircle2 className="w-4 h-4" style={{ color: bannerConfig.iconColor }} />
                        </div>
                        <p className={cn(
                            "text-[11px] font-bold uppercase tracking-wider tabular-nums",
                            bannerConfig.textColor
                        )}>
                            {bannerConfig.text}
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    if (!obligations || obligations.length === 0) return null;

    return (
        <div className="mb-6 animate-in slide-in-from-top-4 duration-500">
            {/* Global Portfolio Severity Banner */}
            <div
                className={cn(
                    "w-full flex items-center justify-between px-4 py-3 rounded-2xl backdrop-blur-md border transition-all",
                    bannerConfig.bgColor,
                    bannerConfig.borderColor,
                    bannerConfig.breathing && "animate-[global-banner-breathe_2s_ease-in-out_infinite]"
                )}
            >
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                         style={{ backgroundColor: `${bannerConfig.iconColor}20` }}>
                        <AlertTriangle className="w-4 h-4" style={{ color: bannerConfig.iconColor }} />
                    </div>
                    <p className={cn(
                        "text-[11px] font-bold uppercase tracking-wider tabular-nums",
                        bannerConfig.textColor
                    )}>
                        {bannerConfig.text}
                    </p>
                </div>
                {obligations.length > 0 && (
                    <div className="flex items-center gap-2">
                        <span className={cn(
                            "text-[10px] font-black uppercase tracking-widest font-mono tabular-nums",
                            bannerConfig.textColor
                        )}>
                            {obligations.length} {obligations.length === 1 ? 'ISSUE' : 'ISSUES'}
                        </span>
                        <ChevronRight className="w-5 h-5 opacity-40" style={{ color: bannerConfig.iconColor }} />
                    </div>
                )}
            </div>

            {/* Breathing animation for Rank 5 */}
            {bannerConfig.breathing && (
                <style dangerouslySetInnerHTML={{
                    __html: `
                        @keyframes global-banner-breathe {
                            0%, 100% {
                                opacity: 0.95;
                                box-shadow: 0 0 15px rgba(255, 59, 59, 0.3);
                            }
                            50% {
                                opacity: 1;
                                box-shadow: 0 0 25px rgba(255, 59, 59, 0.6);
                            }
                        }
                    `
                }} />
            )}
        </div>
    )
}
