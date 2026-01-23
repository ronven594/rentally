"use client"

import { ShieldCheck } from "lucide-react"

export default function CompliancePage() {
    return (
        <div className="py-20 text-center space-y-4">
            <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300">
                <ShieldCheck className="w-10 h-10" />
            </div>
            <div>
                <h3 className="text-xl font-bold text-slate-900">Compliance Hub Coming Soon</h3>
                <p className="text-slate-500 mt-2">Stay up to date with the latest RTA regulations and healthy home standards.</p>
            </div>
        </div>
    )
}
