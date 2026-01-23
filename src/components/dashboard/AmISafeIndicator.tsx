"use client"

import { CheckCircle2, AlertCircle } from "lucide-react"

interface AmISafeIndicatorProps {
    issuesCount: number;
}

export function AmISafeIndicator({ issuesCount }: AmISafeIndicatorProps) {
    const isSafe = issuesCount === 0;

    return (
        <div className="w-full bg-white rounded-3xl p-6 shadow-sm border border-slate-100 mb-8 flex items-center justify-between transition-all duration-500">
            <div className="flex flex-col">
                <h2 className="text-xl font-semibold text-slate-800 mb-1">
                    {isSafe ? "All good, Alex." : "Action Recommended"}
                </h2>
                <p className="text-slate-500 text-sm">
                    {isSafe
                        ? "Your properties are up to date."
                        : `${issuesCount} property requires your attention.`}
                </p>
            </div>

            <div className="flex items-center justify-center h-14 w-14 rounded-full bg-slate-50 relative">
                {isSafe ? (
                    <>
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-100 opacity-75"></span>
                        <CheckCircle2 className="h-8 w-8 text-emerald-500 relative z-10" />
                    </>
                ) : (
                    <>
                        <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-rose-100 opacity-75"></span>
                        <AlertCircle className="h-8 w-8 text-rose-500 relative z-10" />
                    </>
                )}
            </div>
        </div>
    )
}
