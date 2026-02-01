import { cn } from "@/lib/utils"

interface StrikeBarProps {
    /** Number of active strikes in the 90-day window */
    strikes: number;
    maxStrikes?: number;
    className?: string;
    glow?: boolean;
    /**
     * Optional: Window expiry date (YYYY-MM-DD format)
     * Shows when the strike window will reset if no new strikes are issued
     */
    windowExpiryDate?: string;
    /**
     * Whether a new strike can be issued right now.
     * True when there's a due date that is 5+ working days overdue
     * and hasn't already been struck.
     */
    canIssueNextStrike?: boolean;
    /**
     * @deprecated Legacy prop - ignored in per-due-date model
     */
    workingDaysOverdue?: number;
    /**
     * @deprecated Legacy prop - use canIssueNextStrike instead
     */
    isStrikeEligible?: boolean;
    /**
     * Effective date for window reset calculation (supports test date override)
     */
    effectiveDate?: Date;
}

export function StrikeBar({ strikes, maxStrikes = 3, className, glow = false, windowExpiryDate, canIssueNextStrike = false, effectiveDate }: StrikeBarProps) {
    // Calculate days until window reset
    let daysUntilReset: number | null = null;
    if (windowExpiryDate && strikes > 0 && strikes < maxStrikes) {
        const expiryDate = new Date(windowExpiryDate);
        const today = effectiveDate || new Date();
        const diffTime = expiryDate.getTime() - today.getTime();
        daysUntilReset = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    /**
     * Determine pill state using per-due-date RTA logic.
     *
     * In the per-due-date model, eligibility is simple:
     * - Pills 0..strikes-1 are SENT
     * - The next pill (index === strikes) is ELIGIBLE if canIssueNextStrike
     * - All others are INACTIVE
     */
    const getPillState = (pillIndex: number): 'SENT' | 'ELIGIBLE' | 'INACTIVE' => {
        if (pillIndex < strikes) {
            return 'SENT';
        }

        if (pillIndex === strikes && canIssueNextStrike) {
            return 'ELIGIBLE';
        }

        return 'INACTIVE';
    };

    return (
        <div className={cn("w-full", className)}>
            <div className="flex justify-between items-center mb-3">
                <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">Tribunal Strikes</span>
                <span className={cn(
                    "text-[11px] font-black font-mono tabular-nums",
                    strikes >= 2 ? "text-[#FF3B3B]" : strikes === 1 ? "text-[#FBBF24]" : "text-white/30"
                )}>
                    {strikes} / {maxStrikes}
                </span>
            </div>
            <div className="w-full flex gap-4">
                {Array.from({ length: maxStrikes }).map((_, i) => {
                    const state = getPillState(i);

                    // STATE A: SENT - Static Slate Blue (#64748B)
                    if (state === 'SENT') {
                        const barColor = "#64748B"; // Slate 500
                        const baseGlow = "shadow-[0_0_12px_rgba(100,116,139,0.5)]";
                        const intensePulse = "shadow-[0_0_20px_rgba(100,116,139,0.8)]";

                        return (
                            <div
                                key={i}
                                className={cn(
                                    "flex-1 min-w-0 h-2 rounded-full transition-all duration-300",
                                    baseGlow,
                                    glow && intensePulse
                                )}
                                style={{ backgroundColor: barColor }}
                            />
                        );
                    }

                    // STATE B: ELIGIBLE - Gold Shimmer (Left-to-Right Animation)
                    if (state === 'ELIGIBLE') {
                        return (
                            <div
                                key={i}
                                className="flex-1 min-w-0 h-2 rounded-full relative overflow-hidden"
                                style={{ backgroundColor: 'rgba(251, 191, 36, 0.15)' }} // Gold background tint
                            >
                                <div
                                    className="absolute inset-0"
                                    style={{
                                        background: 'linear-gradient(90deg, transparent 0%, rgba(251, 191, 36, 0.6) 50%, transparent 100%)',
                                        animation: 'shimmer 2s ease-in-out infinite',
                                    }}
                                />
                                <style dangerouslySetInnerHTML={{
                                    __html: `
                                        @keyframes shimmer {
                                            0% { transform: translateX(-100%); opacity: 0.4; }
                                            50% { opacity: 0.8; }
                                            100% { transform: translateX(200%); opacity: 0.4; }
                                        }
                                    `
                                }} />
                            </div>
                        );
                    }

                    // STATE C: INACTIVE - Light Gray/Empty
                    return (
                        <div
                            key={i}
                            className="flex-1 min-w-0 h-2 rounded-full bg-white/10 transition-all duration-300"
                        />
                    );
                })}
            </div>
            {/* Window Reset Indicator */}
            {daysUntilReset !== null && daysUntilReset > 0 && (
                <div className="mt-2 text-[10px] text-white/30 font-mono tabular-nums">
                    Window resets in {daysUntilReset}d
                </div>
            )}
        </div>
    )
}
