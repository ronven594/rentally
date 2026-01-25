"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, FileText, ShieldCheck, Building2, Settings } from "lucide-react"
import { cn } from "@/lib/utils"
import { motion } from "framer-motion"

// Synced with TopNav items
const tabs = [
    { href: "/", label: "Home", icon: Home },
    { href: "/rent-tracker", label: "Properties", icon: Building2 },
    { href: "/compliance", label: "Compliance", icon: ShieldCheck },
    { href: "/reports", label: "Reports", icon: FileText },
    { href: "/settings", label: "Settings", icon: Settings },
]

export function MobileNav() {
    const pathname = usePathname()

    return (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0B0E11]/95 backdrop-blur-xl border-t border-white/10 px-2 pb-safe-area-inset-bottom">
            <div className="flex items-center justify-around h-16">
                {tabs.map((tab) => {
                    const isActive = pathname === tab.href
                    const Icon = tab.icon

                    return (
                        <Link
                            key={tab.href}
                            href={tab.href}
                            className={cn(
                                "relative flex flex-col items-center justify-center gap-1 py-2 px-3 transition-all duration-200",
                                isActive ? "text-[#00FFBB]" : "text-white/30 active:text-white/50"
                            )}
                        >
                            {/* Active Background Pill */}
                            {isActive && (
                                <motion.div
                                    layoutId="mobile-nav-pill"
                                    className="absolute inset-0 bg-[#00FFBB]/10 rounded-xl border border-[#00FFBB]/20"
                                    transition={{
                                        type: "spring",
                                        stiffness: 380,
                                        damping: 30
                                    }}
                                />
                            )}

                            <Icon className={cn(
                                "relative w-5 h-5 z-10",
                                isActive && "stroke-[2.5px]"
                            )} />

                            <span className={cn(
                                "relative text-[9px] font-bold uppercase tracking-wide z-10",
                                isActive ? "text-[#00FFBB]" : "text-white/30"
                            )}>
                                {tab.label}
                            </span>
                        </Link>
                    )
                })}
            </div>
        </nav>
    )
}
