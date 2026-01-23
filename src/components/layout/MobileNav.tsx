"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Home, Users, FileText, ShieldCheck, Receipt, LogOut, Settings } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/contexts/AuthContext"

const tabs = [
    { href: "/", label: "Home", icon: Home },
    { href: "/rent-tracker", label: "Tenants", icon: Users },
    { href: "/reports", label: "Reports", icon: FileText },
    { href: "/compliance", label: "Compliance", icon: ShieldCheck },
    { href: "/tax-vault", label: "Tax", icon: Receipt },
    { href: "/settings", label: "Settings", icon: Settings },
]

export function MobileNav() {
    const pathname = usePathname()
    const router = useRouter()
    const { signOut } = useAuth()

    const handleSignOut = async () => {
        try {
            await signOut()
            router.push('/login')
        } catch (error) {
            console.error('Sign out error:', error)
        }
    }

    return (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-lg border-t border-slate-100 px-4 pb-safe-area-inset-bottom">
            <div className="flex items-center justify-between h-16">
                {tabs.map((tab) => {
                    const isActive = pathname === tab.href
                    const Icon = tab.icon

                    return (
                        <Link
                            key={tab.href}
                            href={tab.href}
                            className={cn(
                                "flex flex-col items-center justify-center gap-1 transition-all duration-300",
                                isActive ? "text-emerald-600 scale-105" : "text-slate-400"
                            )}
                        >
                            <Icon className={cn("w-5 h-5", isActive && "stroke-[2.5px]")} />
                            <span className="text-[8px] font-black uppercase tracking-tighter">
                                {tab.label}
                            </span>
                            {isActive && (
                                <div className="absolute -bottom-1 w-1 h-1 rounded-full bg-emerald-600 animate-in fade-in duration-300" />
                            )}
                        </Link>
                    )
                })}

                <button
                    onClick={handleSignOut}
                    className="flex flex-col items-center justify-center gap-1 text-slate-400 hover:text-red-500 transition-all duration-300"
                >
                    <LogOut className="w-5 h-5" />
                    <span className="text-[8px] font-black uppercase tracking-tighter">
                        Exit
                    </span>
                </button>
            </div>
        </nav>
    )
}
