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
}

export function StrikeBar({ strikes, maxStrikes = 3, className, glow = false, windowExpiryDate }: StrikeBarProps) {
    // Calculate days until window reset
    let daysUntilReset: number | null = null;
    if (windowExpiryDate && strikes > 0 && strikes < maxStrikes) {
        const expiryDate = new Date(windowExpiryDate);
        const today = new Date();
        const diffTime = expiryDate.getTime() - today.getTime();
        daysUntilReset = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    return (
        <div className={cn("w-full", className)}>
            <div className="flex justify-between items-center mb-3">
                <span className="text-[11px] font-black text-white/40 uppercase tracking-widest">Tribunal Strikes</span>
                <span className={cn(
                    "text-[11px] font-black font-mono",
                    strikes > 0 ? "text-[#FF3B3B]" : "text-white/30"
                )}>
                    {strikes} / {maxStrikes}
                </span>
            </div>
            <div className="w-full flex gap-4">
                {Array.from({ length: maxStrikes }).map((_, i) => {
                    const isActive = i < strikes;
                    return (
                        <div key={i} className={cn(
                            "flex-1 min-w-0 h-2 rounded-full transition-all duration-300",
                            isActive
                                ? "bg-[#FF3B3B] shadow-[0_0_12px_rgba(255,59,59,0.5)]"
                                : "bg-white/10",
                            (isActive && glow) && "shadow-[0_0_20px_rgba(255,59,59,0.8)]"
                        )} />
                    );
                })}
            </div>
            {/* Window Reset Indicator */}
            {daysUntilReset !== null && daysUntilReset > 0 && (
                <div className="mt-2 text-[10px] text-white/30 font-mono">
                    Window resets in {daysUntilReset}d
                </div>
            )}
        </div>
    )
}
