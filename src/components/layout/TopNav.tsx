"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Home, Users, FileText, ShieldCheck, Receipt, Building2, LogOut, Settings, Menu, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/contexts/AuthContext"
import { motion } from "framer-motion"
import { useState } from "react"

const navItems = [
    { href: "/", label: "Dashboard", icon: Home },
    { href: "/rent-tracker", label: "Properties", icon: Building2 },
    { href: "/compliance", label: "Compliance", icon: ShieldCheck },
    { href: "/reports", label: "Reports", icon: FileText },
    { href: "/settings", label: "Settings", icon: Settings },
]

export function TopNav() {
    const pathname = usePathname()
    const router = useRouter()
    const { signOut, profile, user } = useAuth()
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

    const handleSignOut = async () => {
        try {
            await signOut()
            router.push('/login')
        } catch (error) {
            console.error('Sign out error:', error)
        }
    }

    return (
        <>
            {/* Top Bar with Brand and User */}
            <header className="fixed top-0 left-0 right-0 z-50 h-16 bg-[#0B0E11]/80 backdrop-blur-xl border-b border-white/5">
                <div className="h-full max-w-7xl mx-auto px-6 flex items-center justify-between">
                    {/* Brand */}
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-[#00FFBB] rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(0,255,187,0.3)]">
                            <Building2 className="w-5 h-5 text-[#0B0E11]" />
                        </div>
                        <span className="text-sm font-black text-white tracking-tighter uppercase hidden sm:block">
                            NZ Landlord
                        </span>
                    </div>

                    {/* Floating Navigation Pill - Desktop */}
                    <nav className="hidden md:flex items-center">
                        <div className="flex items-center gap-1 px-2 py-2 bg-white/5 backdrop-blur-md rounded-full border border-white/10">
                            {navItems.map((item) => {
                                const isActive = pathname === item.href
                                const Icon = item.icon

                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={cn(
                                            "relative flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all duration-200",
                                            isActive
                                                ? "text-[#00FFBB]"
                                                : "text-white/50 hover:text-white/80"
                                        )}
                                    >
                                        <Icon className={cn("w-4 h-4", isActive && "stroke-[2.5px]")} />
                                        <span className="hidden lg:inline">{item.label}</span>

                                        {/* Animated Underline */}
                                        {isActive && (
                                            <motion.div
                                                layoutId="nav-underline"
                                                className="absolute inset-0 bg-[#00FFBB]/10 rounded-full border border-[#00FFBB]/30"
                                                transition={{
                                                    type: "spring",
                                                    stiffness: 380,
                                                    damping: 30
                                                }}
                                            />
                                        )}
                                    </Link>
                                )
                            })}
                        </div>
                    </nav>

                    {/* User Section */}
                    <div className="flex items-center gap-4">
                        {user && (
                            <div className="hidden sm:flex items-center gap-3">
                                <div className="text-right">
                                    <p className="text-xs font-bold text-white truncate max-w-[120px]">
                                        {profile?.full_name || 'Landlord'}
                                    </p>
                                    <p className="text-[10px] text-white/40 truncate max-w-[120px]">
                                        {user.email}
                                    </p>
                                </div>
                                <div className="w-9 h-9 bg-white/10 rounded-full flex items-center justify-center text-white/60 text-xs font-black border border-white/10">
                                    {profile?.full_name?.charAt(0) || 'L'}
                                </div>
                            </div>
                        )}

                        <button
                            onClick={handleSignOut}
                            className="hidden sm:flex items-center justify-center w-9 h-9 rounded-full text-white/40 hover:text-[#FF3B3B] hover:bg-[#FF3B3B]/10 transition-all duration-200"
                            title="Sign Out"
                        >
                            <LogOut className="w-4 h-4" />
                        </button>

                        {/* Mobile Menu Toggle */}
                        <button
                            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                            className="md:hidden flex items-center justify-center w-9 h-9 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-all"
                        >
                            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                        </button>
                    </div>
                </div>
            </header>

            {/* Mobile Dropdown Menu */}
            {mobileMenuOpen && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="fixed top-16 left-0 right-0 z-40 bg-[#0B0E11]/95 backdrop-blur-xl border-b border-white/10 md:hidden"
                >
                    <div className="px-4 py-4 space-y-1">
                        {navItems.map((item) => {
                            const isActive = pathname === item.href
                            const Icon = item.icon

                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    onClick={() => setMobileMenuOpen(false)}
                                    className={cn(
                                        "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all duration-200",
                                        isActive
                                            ? "bg-[#00FFBB]/10 text-[#00FFBB] border border-[#00FFBB]/20"
                                            : "text-white/60 hover:bg-white/5 hover:text-white"
                                    )}
                                >
                                    <Icon className={cn("w-5 h-5", isActive && "stroke-[2.5px]")} />
                                    {item.label}
                                </Link>
                            )
                        })}

                        <div className="border-t border-white/10 my-2" />

                        {user && (
                            <div className="px-4 py-3 bg-white/5 rounded-xl border border-white/10">
                                <p className="text-xs font-bold text-white">{profile?.full_name || 'Landlord'}</p>
                                <p className="text-[10px] text-white/40">{user.email}</p>
                            </div>
                        )}

                        <button
                            onClick={() => {
                                setMobileMenuOpen(false)
                                handleSignOut()
                            }}
                            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-white/60 hover:bg-[#FF3B3B]/10 hover:text-[#FF3B3B] transition-all"
                        >
                            <LogOut className="w-5 h-5" />
                            Sign Out
                        </button>
                    </div>
                </motion.div>
            )}

            {/* RTA Badge - Fixed Bottom Left */}
            <div className="hidden md:flex fixed bottom-4 left-4 z-30 items-center gap-2 px-3 py-1.5 bg-[#0B0E11]/80 backdrop-blur-md rounded-full border border-white/10">
                <div className="w-2 h-2 rounded-full bg-[#00FFBB] shadow-[0_0_8px_rgba(0,255,187,0.5)]" />
                <span className="text-[10px] font-bold text-white/40 uppercase tracking-tight">RTA v2026</span>
            </div>
        </>
    )
}
