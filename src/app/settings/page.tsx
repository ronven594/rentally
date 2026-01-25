"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/contexts/AuthContext"
import { supabase } from "@/lib/supabaseClient"
import { toast } from "sonner"
import { User, MapPin, Phone, Bell, Smartphone, Loader2, Save } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"

export default function SettingsPage() {
    const { user, profile, refreshProfile } = useAuth()
    const [isLoading, setIsLoading] = useState(false)
    const [isSaving, setIsSaving] = useState(false)

    // Form State
    const [fullName, setFullName] = useState("")
    const [address, setAddress] = useState("")
    const [phoneNumber, setPhoneNumber] = useState("")

    // Notification State
    const [smsEnabled, setSmsEnabled] = useState(false)
    const [pushEnabled, setPushEnabled] = useState(true)
    const [mobilePushEnabled, setMobilePushEnabled] = useState(true)

    // Load initial data
    useEffect(() => {
        if (profile) {
            setFullName(profile.full_name || "")
            setAddress(profile.service_address || "")
            setPhoneNumber(profile.phone || "")
        }
    }, [profile])

    // Fetch extra preferences not in AuthContext type yet
    useEffect(() => {
        const fetchPreferences = async () => {
            if (!user) return
            try {
                const { data, error } = await supabase
                    .from('user_profiles')
                    .select('pref_sms_notif, pref_push_notif, pref_mobile_push_notif')
                    .eq('user_id', user.id)
                    .single()

                if (error) throw error

                if (data) {
                    setSmsEnabled(data.pref_sms_notif ?? false)
                    setPushEnabled(data.pref_push_notif ?? true)
                    setMobilePushEnabled(data.pref_mobile_push_notif ?? true)
                }
            } catch (error) {
                console.error('Error fetching preferences:', error)
            }
        }

        fetchPreferences()
    }, [user])

    const handleSave = async () => {
        if (!user) return

        // Validation
        if (!fullName.trim() || fullName.length < 2) {
            toast.error("Full name is required (min 2 characters)")
            return
        }
        if (!address.trim() || address.length < 10) {
            toast.error("Service address is required (min 10 characters)")
            return
        }

        setIsSaving(true)
        try {
            // 1. Update Profile Fields via Context (handles secureAuth middleware if needed)
            // Note: We bypass context for strict updates to ensure all fields including prefs are saved together
            // or we do a direct supabase call here since secureAuth might not handle prefs yet.
            // Given the requirement to use supabase client for upsert data handling:

            const updates = {
                user_id: user.id,
                full_name: fullName.trim(),
                service_address: address.trim(),
                phone: phoneNumber.trim() || null,
                pref_sms_notif: smsEnabled,
                pref_push_notif: pushEnabled,
                pref_mobile_push_notif: mobilePushEnabled,
                updated_at: new Date().toISOString(),
            }

            const { error } = await supabase
                .from('user_profiles')
                .upsert(updates)

            if (error) throw error

            // Refresh context to update UI globally
            await refreshProfile()

            toast.success("Settings saved successfully")
        } catch (error: any) {
            console.error('Error saving settings:', error)
            toast.error("Failed to save settings: " + error.message)
        } finally {
            setIsSaving(false)
        }
    }

    if (!user) {
        return (
            <div className="flex items-center justify-center p-12">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
            </div>
        )
    }

    return (
        <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tight">Settings</h1>
                    <p className="text-slate-500 font-medium">Manage your profile and notification preferences.</p>
                </div>
                <Button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="bg-safe-green hover:bg-safe-green/90 text-white font-black shadow-lg shadow-safe-green/20"
                >
                    {isSaving ? (
                        <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Saving...
                        </>
                    ) : (
                        <>
                            <Save className="w-4 h-4 mr-2" />
                            Save Changes
                        </>
                    )}
                </Button>
            </div>

            <div className="grid gap-6">
                {/* Landlord Profile Section */}
                <Card className="border-slate-100 shadow-sm overflow-hidden">
                    <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-safe-bg rounded-lg">
                                <User className="w-5 h-5 text-safe-green" />
                            </div>
                            <div>
                                <CardTitle className="text-lg font-bold text-slate-800">Landlord Profile</CardTitle>
                                <CardDescription>Your legal details for tenancy agreements and notices.</CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-6 space-y-6">
                        <div className="grid md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <Label htmlFor="full_name" className="text-xs font-bold uppercase text-slate-500">Full Legal Name</Label>
                                <div className="relative">
                                    <User className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                                    <Input
                                        id="full_name"
                                        placeholder="e.g. John Doe"
                                        className="pl-9 font-medium"
                                        value={fullName}
                                        onChange={(e) => setFullName(e.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="phone" className="text-xs font-bold uppercase text-slate-500">Phone Number</Label>
                                <div className="relative">
                                    <Phone className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                                    <Input
                                        id="phone"
                                        placeholder="e.g. 021 123 4567"
                                        className="pl-9 font-medium"
                                        value={phoneNumber}
                                        onChange={(e) => setPhoneNumber(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="address" className="text-xs font-bold uppercase text-slate-500">Physical Address for Service</Label>
                            <div className="relative">
                                <MapPin className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                                <Input
                                    id="address"
                                    placeholder="e.g. 123 Queen Street, Auckland 1010"
                                    className="pl-9 font-medium"
                                    value={address}
                                    onChange={(e) => setAddress(e.target.value)}
                                />
                            </div>
                            <p className="text-[11px] text-slate-400 font-medium">
                                * This address will appear on generated legal notices (RTA requirement).
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {/* Notification Preferences Section */}
                <Card className="border-slate-100 shadow-sm overflow-hidden">
                    <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-amber-100 rounded-lg">
                                <Bell className="w-5 h-5 text-amber-600" />
                            </div>
                            <div>
                                <CardTitle className="text-lg font-bold text-slate-800">Notification Preferences</CardTitle>
                                <CardDescription>Manage how you want to be alerted about critical events.</CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-6">
                        <div className="flex flex-col gap-6">
                            <div className="flex items-center justify-between p-4 rounded-xl border border-slate-100 bg-slate-50/50">
                                <div className="flex items-center gap-4">
                                    <div className="p-2 bg-white rounded-full shadow-sm">
                                        <Smartphone className="w-5 h-5 text-slate-600" />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-slate-900">SMS Notifications</h4>
                                        <p className="text-xs text-slate-500">Receive text messages for urgent alerts like rent arrears.</p>
                                    </div>
                                </div>
                                <Switch
                                    checked={smsEnabled}
                                    onCheckedChange={setSmsEnabled}
                                    className="data-[state=checked]:bg-safe-green"
                                />
                            </div>

                            <div className="flex items-center justify-between p-4 rounded-xl border border-slate-100 bg-slate-50/50">
                                <div className="flex items-center gap-4">
                                    <div className="p-2 bg-white rounded-full shadow-sm">
                                        <Bell className="w-5 h-5 text-slate-600" />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-slate-900">Browser Push Notifications</h4>
                                        <p className="text-xs text-slate-500">Receive instant alerts on your desktop or mobile browser.</p>
                                    </div>
                                </div>
                                <Switch
                                    checked={pushEnabled}
                                    onCheckedChange={setPushEnabled}
                                    className="data-[state=checked]:bg-safe-green"
                                />
                            </div>

                            <div className="flex items-center justify-between p-4 rounded-xl border border-slate-100 bg-slate-50/50">
                                <div className="flex items-center gap-4">
                                    <div className="p-2 bg-white rounded-full shadow-sm">
                                        <Smartphone className="w-5 h-5 text-slate-600" />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-slate-900">Mobile Push Notifications</h4>
                                        <p className="text-xs text-slate-500">Receive native alerts on your phone for critical tenant events.</p>
                                    </div>
                                </div>
                                <Switch
                                    checked={mobilePushEnabled}
                                    onCheckedChange={setMobilePushEnabled}
                                    className="data-[state=checked]:bg-safe-green"
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
