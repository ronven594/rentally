"use client"

import { useState, useEffect } from "react"
import { logToEvidenceLedger, EVENT_TYPES, CATEGORIES, type EvidenceLedgerEntry } from '@/services/evidenceLedger'
import { supabase } from '@/lib/supabaseClient'
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, Database, AlertCircle } from "lucide-react"

export default function TestEvidencePage() {
    const [realData, setRealData] = useState<{ propertyId: string; tenantId: string } | null>(null)
    const [lastEntry, setLastEntry] = useState<EvidenceLedgerEntry | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isLogging, setIsLogging] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true)
            try {
                // 1. Fetch one real property
                const { data: properties, error: propError } = await supabase
                    .from('properties')
                    .select('id, address')
                    .limit(1)

                if (propError) throw propError

                if (!properties || properties.length === 0) {
                    setError("No properties found. Please add a property in the dashboard first.")
                    setIsLoading(false)
                    return
                }

                // 2. Fetch one real tenant
                const { data: tenants, error: tenantError } = await supabase
                    .from('tenants')
                    .select('id, first_name')
                    .limit(1)

                if (tenantError) throw tenantError

                setRealData({
                    propertyId: properties[0].id,
                    tenantId: tenants && tenants.length > 0 ? tenants[0].id : ''
                })
            } catch (err: any) {
                console.error("Fetch error:", err)
                setError(err.message || "Failed to fetch database records.")
            } finally {
                setIsLoading(false)
            }
        }

        fetchData()
    }, [])

    const handleLog = async (type: keyof typeof EVENT_TYPES, title: string, description: string) => {
        if (!realData?.propertyId) {
            toast.error("Missing property ID")
            return
        }

        setIsLogging(true)
        try {
            const result = await logToEvidenceLedger(
                realData.propertyId,
                realData.tenantId || null,
                EVENT_TYPES[type],
                CATEGORIES.ARREARS,
                title,
                description,
                { test: true, timestamp: new Date().toISOString(), source: 'verification-page' }
            )

            if (result) {
                setLastEntry(result)
                toast.success(`Logged: ${title}`)
                console.log("Success:", result)
            } else {
                toast.error("Failed to log. See console.")
            }
        } catch (err: any) {
            console.error("Logging error:", err)
            toast.error("Error: " + err.message)
        } finally {
            setIsLogging(false)
        }
    }

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen gap-4">
                <Loader2 className="w-10 h-10 animate-spin text-slate-400" />
                <p className="text-slate-500 font-medium">Connecting to Supabase...</p>
            </div>
        )
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center max-w-md mx-auto gap-6">
                <div className="w-16 h-16 bg-rose-50 rounded-2xl flex items-center justify-center text-rose-500">
                    <AlertCircle className="w-8 h-8" />
                </div>
                <div className="space-y-2">
                    <h2 className="text-xl font-bold text-slate-900">Database Context Required</h2>
                    <p className="text-slate-500">{error}</p>
                </div>
                <Button onClick={() => window.location.href = '/'} className="w-full h-12 rounded-xl font-bold">
                    Go to Dashboard
                </Button>
            </div>
        )
    }

    return (
        <div className="p-8 max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <header className="space-y-2">
                <div className="flex items-center gap-2 text-emerald-500">
                    <Database className="w-5 h-5" />
                    <span className="text-xs font-black uppercase tracking-widest">Live Connection</span>
                </div>
                <h1 className="text-3xl font-black tracking-tight text-slate-900 leading-none">Evidence Ledger Verification</h1>
                <p className="text-slate-500 font-medium text-sm">Testing Supabase logging with real database records.</p>
            </header>

            {/* Target Info */}
            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 grid grid-cols-2 gap-4">
                <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Target Property ID</p>
                    <p className="text-xs font-mono font-bold truncate text-slate-700">{realData?.propertyId}</p>
                </div>
                <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Target Tenant ID</p>
                    <p className="text-xs font-mono font-bold truncate text-slate-700">{realData?.tenantId || 'NONE (Logged as null)'}</p>
                </div>
            </div>

            {/* Test Actions */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Button
                    disabled={isLogging}
                    onClick={() => handleLog(
                        'STRIKE_ISSUED',
                        'Strike issued - Payment late',
                        'Automatic verification log for strike detection.'
                    )}
                    className="h-28 flex flex-col items-center justify-center gap-2 rounded-2xl bg-white border-2 border-slate-100 text-slate-900 hover:bg-slate-50 hover:border-slate-200 shadow-sm transition-all active:scale-95"
                >
                    <div className="w-8 h-8 bg-slate-900 text-white rounded-lg flex items-center justify-center font-bold">S</div>
                    <span className="text-xs font-bold uppercase tracking-tight">Test Strike</span>
                </Button>

                <Button
                    disabled={isLogging}
                    onClick={() => handleLog(
                        'NOTICE_GENERATED',
                        'Section 55 Notice generated',
                        'Verification log for overdue rent notice.'
                    )}
                    className="h-28 flex flex-col items-center justify-center gap-2 rounded-2xl bg-white border-2 border-amber-100 text-amber-900 hover:bg-amber-50 hover:border-amber-200 shadow-sm transition-all active:scale-95"
                >
                    <div className="w-8 h-8 bg-amber-500 text-white rounded-lg flex items-center justify-center font-bold">N</div>
                    <span className="text-xs font-bold uppercase tracking-tight">Test Notice</span>
                </Button>

                <Button
                    disabled={isLogging}
                    onClick={() => handleLog(
                        'RENT_MISSED',
                        'Rent missed alert',
                        'Manual verification log for missed rent payment.'
                    )}
                    className="h-28 flex flex-col items-center justify-center gap-2 rounded-2xl bg-white border-2 border-rose-100 text-rose-900 hover:bg-rose-50 hover:border-rose-200 shadow-sm transition-all active:scale-95"
                >
                    <div className="w-8 h-8 bg-rose-500 text-white rounded-lg flex items-center justify-center font-bold">A</div>
                    <span className="text-xs font-bold uppercase tracking-tight">Test Arrears</span>
                </Button>
            </div>

            {/* Receipt / Result */}
            <Card className="border-none shadow-xl shadow-slate-200/50 rounded-[32px] overflow-hidden">
                <CardHeader className="bg-slate-900 text-white py-6">
                    <CardTitle className="text-xs font-black uppercase tracking-widest opacity-60">
                        Supabase Response Ledger
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-8">
                    {lastEntry ? (
                        <div className="space-y-6">
                            <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                                <div className="space-y-1">
                                    <p className="text-[10px] font-black uppercase text-slate-400">Entry UID</p>
                                    <p className="text-xs font-mono font-bold text-slate-900 truncate">{lastEntry.id}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-[10px] font-black uppercase text-slate-400">Event Type</p>
                                    <p className="text-xs font-bold text-emerald-600">{lastEntry.event_type}</p>
                                </div>
                                <div className="col-span-2 space-y-1">
                                    <p className="text-[10px] font-black uppercase text-slate-400">Entry Title</p>
                                    <p className="text-sm font-bold text-slate-900">{lastEntry.title}</p>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <p className="text-[10px] font-black uppercase text-slate-400">Payload Metadata</p>
                                <pre className="bg-slate-50 p-4 rounded-2xl text-[11px] font-mono text-slate-600 border border-slate-100 overflow-x-auto whitespace-pre">
                                    {JSON.stringify(lastEntry.metadata, null, 2)}
                                </pre>
                            </div>

                            <div className="pt-4 flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
                                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                Confirmed write to evidence_ledger table at {lastEntry.created_at}
                            </div>
                        </div>
                    ) : (
                        <div className="py-20 text-center space-y-4">
                            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-slate-200">
                                <Database className="w-8 h-8" />
                            </div>
                            <p className="text-slate-400 font-medium italic">No entries logged in this session.</p>
                        </div>
                    )}
                </CardContent>
            </Card>

            <div className="flex justify-center flex-col items-center gap-4">
                <Button variant="ghost" onClick={() => window.location.href = '/'} className="text-slate-400 hover:text-slate-900 text-xs font-bold uppercase tracking-widest">
                    &larr; Back to Dashboard
                </Button>
            </div>
        </div>
    )
}
