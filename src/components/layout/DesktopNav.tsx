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
        <aside className="hidden md:flex flex-col w-64 fixed inset-y-0 left-0 bg-white border-r border-slate-50 z-20">
            <div className="flex flex-col h-full px-4 py-8">
                {/* Brand */}
                <div className="flex items-center gap-3 px-4 mb-10">
                    <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center shadow-lg shadow-emerald-100">
                        <Building2 className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-sm font-black text-slate-900 tracking-tighter uppercase">
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
                                        ? "bg-slate-900 text-white shadow-lg shadow-slate-200"
                                        : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
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
                        <div className="px-4 py-3 bg-slate-50 rounded-2xl border border-slate-100">
                            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest leading-none mb-1">Authenticated as</p>
                            <p className="text-sm font-bold text-slate-900 truncate">{profile?.full_name || 'Landlord'}</p>
                            <p className="text-[10px] text-slate-500 truncate">{user.email}</p>
                        </div>
                    )}

                    <button
                        onClick={handleSignOut}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-slate-500 hover:bg-red-50 hover:text-red-600 transition-all duration-200"
                    >
                        <LogOut className="w-5 h-5" />
                        Sign Out
                    </button>

                    <div className="px-4">
                        <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-glow-emerald" />
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">RTA v2026 Ready</span>
                        </div>
                    </div>
                </div>
            </div>
        </aside>
    )
}
