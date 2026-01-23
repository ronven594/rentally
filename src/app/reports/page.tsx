"use client"

import { FileText } from "lucide-react"

export default function ReportsPage() {
    return (
        <div className="py-20 text-center space-y-4">
            <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300">
                <FileText className="w-10 h-10" />
            </div>
            <div>
                <h3 className="text-xl font-bold text-slate-900">Reports Coming Soon</h3>
                <p className="text-slate-500 mt-2">Professional summary reports for your accountant.</p>
            </div>
        </div>
    )
}
