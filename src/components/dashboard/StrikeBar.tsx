import { cn } from "@/lib/utils"

interface StrikeBarProps {
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
     * Number of working days the tenant is overdue
     * Used to determine which pills show eligibility shimmer
     */
    workingDaysOverdue?: number;
    /**
     * @deprecated Use workingDaysOverdue instead for per-pill eligibility
     * Whether the next strike is eligible to be issued
     * Shows shimmer effect on the next empty pill when true
     */
    isStrikeEligible?: boolean;
}

export function StrikeBar({ strikes, maxStrikes = 3, className, glow = false, windowExpiryDate, workingDaysOverdue = 0, isStrikeEligible = false }: StrikeBarProps) {
    // Calculate days until window reset
    let daysUntilReset: number | null = null;
    if (windowExpiryDate && strikes > 0 && strikes < maxStrikes) {
        const expiryDate = new Date(windowExpiryDate);
        const today = new Date();
        const diffTime = expiryDate.getTime() - today.getTime();
        daysUntilReset = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    /**
     * Determine pill state based on strict sequential RTA-compliant logic
     * @param pillIndex - 0-based index (0 = Strike 1, 1 = Strike 2, 2 = Strike 3)
     *
     * CRITICAL SEQUENTIAL RULES:
     * - Pills only shimmer (ELIGIBLE) if the PREVIOUS strike has been sent
     * - Pill must meet working days threshold for that specific strike tier
     * - Only ONE pill can be ELIGIBLE at a time (the next sequential strike)
     */
    const getPillState = (pillIndex: number): 'SENT' | 'ELIGIBLE' | 'INACTIVE' => {
        // STATE A: SENT (Static Slate Blue #64748B)
        // This strike has already been issued and is within the 90-day window
        if (pillIndex < strikes) {
            return 'SENT';
        }

        // STATE B: ELIGIBLE (Gold Shimmer)
        // STRICT SEQUENTIAL LOGIC: Only the NEXT strike can be eligible
        // Pill 0 (Strike 1): Eligible if NO strikes sent yet AND 5+ working days overdue
        // Pill 1 (Strike 2): Eligible if EXACTLY 1 strike sent AND 10+ working days overdue
        // Pill 2 (Strike 3): Eligible if EXACTLY 2 strikes sent AND 15+ working days overdue

        const eligibilityThresholds = [5, 10, 15];
        const threshold = eligibilityThresholds[pillIndex];

        // Only the NEXT sequential strike (pillIndex === strikes) can be ELIGIBLE
        // AND tenant must meet the working days threshold for this strike tier
        if (pillIndex === strikes && workingDaysOverdue >= threshold) {
            return 'ELIGIBLE';
        }

        // STATE C: INACTIVE (Light Gray/Empty)
        // Default for all other cases:
        // - Future strikes beyond the next one
        // - Strikes that haven't met the working days threshold yet
        // - When tenant is paid up (workingDaysOverdue < threshold)
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
