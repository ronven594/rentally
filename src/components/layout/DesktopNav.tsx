"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Home, Users, FileText, ShieldCheck, Receipt, Building2, LogOut, Settings } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/contexts/AuthContext"

const navItems = [
    { href: "/", label: "Dashboard", icon: Home },
    { href: "/rent-tracker", label: "Tenants & Properties", icon: Users },
    { href: "/reports", label: "Reports", icon: FileText },
    { href: "/compliance", label: "Legal Compliance", icon: ShieldCheck },
    { href: "/tax-vault", label: "Tax Vault", icon: Receipt },
    { href: "/settings", label: "Settings", icon: Settings },
]

export function DesktopNav() {
    const pathname = usePathname()
    const router = useRouter()
    const { signOut, profile, user } = useAuth()

    const handleSignOut = async () => {
        try {
            await signOut()
            router.push('/login')
        } catch (error) {
            console.error('Sign out error:', error)
        }
    }

    return (
        <aside className="hidden md:flex flex-col w-64 fixed inset-y-0 left-0 bg-[#0B0E11] border-r border-white/10 z-20">
            <div className="flex flex-col h-full px-4 py-8">
                {/* Brand */}
                <div className="flex items-center gap-3 px-4 mb-10">
                    <div className="w-8 h-8 bg-[#00FFBB] rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(0,255,187,0.3)]">
                        <Building2 className="w-5 h-5 text-[#0B0E11]" />
                    </div>
                    <span className="text-sm font-black text-white tracking-tighter uppercase">
                        NZ Landlord
                    </span>
                </div>

                {/* Links */}
                <div className="space-y-1">
                    {navItems.map((item) => {
                        const isActive = pathname === item.href
                        const Icon = item.icon

                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={cn(
                                    "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all duration-200",
                                    isActive
                                        ? "bg-white/10 text-[#00FFBB] shadow-[0_0_12px_rgba(0,255,187,0.15)]"
                                        : "text-white/50 hover:bg-white/5 hover:text-white"
                                )}
                            >
                                <Icon className={cn("w-5 h-5", isActive ? "stroke-[2.5px]" : "stroke-2")} />
                                {item.label}
                            </Link>
                        )
                    })}
                </div>

                {/* Footer / Profile */}
                <div className="mt-auto space-y-4">
                    {user && (
                        <div className="px-4 py-3 bg-white/5 rounded-2xl border border-white/10">
                            <p className="text-[10px] font-black uppercase text-white/40 tracking-widest leading-none mb-1">Authenticated as</p>
                            <p className="text-sm font-bold text-white truncate">{profile?.full_name || 'Landlord'}</p>
                            <p className="text-[10px] text-white/50 truncate">{user.email}</p>
                        </div>
                    )}

                    <button
                        onClick={handleSignOut}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-white/50 hover:bg-[#FF3B3B]/10 hover:text-[#FF3B3B] transition-all duration-200"
                    >
                        <LogOut className="w-5 h-5" />
                        Sign Out
                    </button>

                    <div className="px-4">
                        <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                            <div className="w-2 h-2 rounded-full bg-[#00FFBB] shadow-[0_0_8px_rgba(0,255,187,0.5)]" />
                            <span className="text-[10px] font-bold text-white/40 uppercase tracking-tight">RTA v2026 Ready</span>
                        </div>
                    </div>
                </div>
            </div>
        </aside>
    )
}
