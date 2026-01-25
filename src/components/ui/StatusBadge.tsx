import { cn } from "@/lib/utils"

interface StatusBadgeProps {
    status: 'safe' | 'caution' | 'warning' | 'critical' | 'neutral';
    text: string;
    className?: string;
}

export function StatusBadge({ status, text, className }: StatusBadgeProps) {
    // Neon-Dark Color Palette
    const variants = {
        // Phase 1: All Good (Neon Mint)
        safe: {
            container: "bg-[#00FFBB]/10 border-[#00FFBB]/30",
            dot: "bg-[#00FFBB]",
            text: "text-[#00FFBB]",
            glow: "shadow-[0_0_15px_rgba(0,255,187,0.4)]"
        },
        // Phase 2: Caution (Electric Gold with glow)
        caution: {
            container: "bg-[#FFB800]/10 border-[#FFB800]/50",
            dot: "bg-[#FFB800]",
            text: "text-[#FFB800]",
            glow: "shadow-[0_0_15px_rgba(255,184,0,0.5)]"
        },
        // Phase 3: Strike Warning (Electric Gold)
        warning: {
            container: "bg-[#FFB800]/10 border-[#FFB800]/30",
            dot: "bg-[#FFB800]",
            text: "text-[#FFB800]",
            glow: ""
        },
        // Phase 4: Termination Eligible (Electric Red with pulse glow)
        critical: {
            container: "bg-[#FF3B3B]/10 border-[#FF3B3B]/30",
            dot: "bg-[#FF3B3B]",
            text: "text-[#FF3B3B]",
            glow: "shadow-[0_0_20px_rgba(255,59,59,0.5)]"
        },
        neutral: {
            container: "bg-white/5 border-white/10",
            dot: "bg-white/40",
            text: "text-white/50",
            glow: ""
        }
    }

    const variant = variants[status]

    return (
        <div className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all duration-300 backdrop-blur-sm",
            variant.container,
            variant.glow,
            className
        )}>
            <div className="relative flex items-center justify-center w-2.5 h-2.5">
                {/* Multi-Ring Halo Pulse */}
                <span className={cn(
                    "absolute w-full h-full rounded-full",
                    status === 'critical' && "animate-[status-pulse-red_2s_infinite]",
                    status === 'warning' && "animate-[status-pulse-gold_2s_infinite]",
                    status === 'caution' && "animate-[status-pulse-gold_2s_infinite]",
                    status === 'safe' && "animate-[status-pulse-green_2s_infinite]"
                )} />
                {/* Solid Center Dot with inner glow */}
                <span className={cn(
                    "relative w-2.5 h-2.5 rounded-full",
                    variant.dot,
                    status === 'critical' && "shadow-[0_0_8px_rgba(255,59,59,0.8)]",
                    status === 'safe' && "shadow-[0_0_8px_rgba(0,255,187,0.6)]",
                    (status === 'warning' || status === 'caution') && "shadow-[0_0_8px_rgba(255,184,0,0.6)]"
                )} />
            </div>
            <span className={cn("text-[10px] font-black uppercase tracking-wider font-mono", variant.text)}>
                {text}
            </span>
        </div>
    )
}
