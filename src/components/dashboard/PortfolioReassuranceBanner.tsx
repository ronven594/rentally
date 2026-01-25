"use client"

import { CheckCircle } from "lucide-react"

interface PortfolioReassuranceBannerProps {
    show: boolean;
}

export function PortfolioReassuranceBanner({ show }: PortfolioReassuranceBannerProps) {
    if (!show) return null;

    return (
        <div className="bg-[#00FFBB]/10 border border-[#00FFBB]/30 text-[#00FFBB] py-3 px-4 rounded-2xl text-center mb-6 backdrop-blur-sm shadow-[0_0_15px_rgba(0,255,187,0.2)]">
            <p className="text-[12px] font-black flex items-center justify-center gap-2 tracking-wide">
                <CheckCircle className="w-4 h-4" />
                Everything's sorted. No actions needed.
            </p>
        </div>
    )
}
