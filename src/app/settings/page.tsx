"use client"

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { User, MapPin, Phone, Mail, Save } from 'lucide-react';
import { isValidNZPhone, isValidAddress } from '@/lib/validation';

function SettingsContent() {
    const { profile, updateProfile, refreshProfile, user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [fullName, setFullName] = useState('');
    const [serviceAddress, setServiceAddress] = useState('');
    const [phone, setPhone] = useState('');

    useEffect(() => {
        if (profile) {
            setFullName(profile.full_name || '');
            setServiceAddress(profile.service_address || '');
            setPhone(profile.phone || '');
        }
    }, [profile]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        console.log('🔍 SAVE PROFILE DEBUG - Starting...');
        console.log('📝 Values:', { fullName, serviceAddress, phone });

        try {
            // Validate inputs
            console.log('✅ Step 1: Validating inputs...');
            if (fullName.trim().length < 2) {
                console.error('❌ Name validation failed');
                toast.error('Full name must be at least 2 characters');
                setLoading(false);
                return;
            }

            if (!isValidAddress(serviceAddress)) {
                console.error('❌ Address validation failed');
                toast.error('Service address must be between 10-200 characters');
                setLoading(false);
                return;
            }

            if (phone && !isValidNZPhone(phone)) {
                console.error('❌ Phone validation failed');
                toast.error('Invalid NZ phone number format');
                setLoading(false);
                return;
            }

            console.log('✅ Step 2: Calling updateProfile...');
            await updateProfile({
                full_name: fullName,
                service_address: serviceAddress,
                phone: phone || undefined
            });

            console.log('✅ Step 3: Refreshing profile...');
            await refreshProfile();

            console.log('✅ Step 4: Success!');
            toast.success('Profile updated successfully!');
        } catch (error: any) {
            console.error('❌ Save failed:', error);
            console.error('Error message:', error.message);
            console.error('Error details:', error);
            toast.error(error.message || 'Failed to update profile');
        } finally {
            console.log('🏁 Setting loading to false');
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 p-6">
            <div className="max-w-2xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-black text-slate-900 tracking-tight">
                        Profile Settings
                    </h1>
                    <p className="text-sm text-slate-500 mt-2">
                        Your details will appear on legal notices and documents
                    </p>
                </div>

                {/* Settings Card */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8">
                    <form onSubmit={handleSave} className="space-y-6">
                        {/* Email (Read-only) */}
                        <div>
                            <label className="text-xs font-black uppercase text-slate-400 tracking-widest mb-2 block">
                                Email
                            </label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                <input
                                    type="email"
                                    value={user?.email || ''}
                                    disabled
                                    className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-500 cursor-not-allowed"
                                />
                            </div>
                            <p className="text-xs text-slate-400 mt-1">
                                Email cannot be changed
                            </p>
                        </div>

                        {/* Full Name */}
                        <div>
                            <label className="text-xs font-black uppercase text-slate-400 tracking-widest mb-2 block">
                                Full Name *
                            </label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                <input
                                    type="text"
                                    value={fullName}
                                    onChange={(e) => setFullName(e.target.value)}
                                    placeholder="John Smith"
                                    required
                                    className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                />
                            </div>
                            <p className="text-xs text-slate-400 mt-1">
                                Your full legal name for notices
                            </p>
                        </div>

                        {/* Service Address */}
                        <div>
                            <label className="text-xs font-black uppercase text-slate-400 tracking-widest mb-2 block">
                                Service Address *
                            </label>
                            <div className="relative">
                                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                <input
                                    type="text"
                                    value={serviceAddress}
                                    onChange={(e) => setServiceAddress(e.target.value)}
                                    placeholder="123 Main Street, Auckland 1010"
                                    required
                                    className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                />
                            </div>
                            <p className="text-xs text-slate-400 mt-1">
                                Address where you can be served legal notices
                            </p>
                        </div>

                        {/* Phone */}
                        <div>
                            <label className="text-xs font-black uppercase text-slate-400 tracking-widest mb-2 block">
                                Phone (Optional)
                            </label>
                            <div className="relative">
                                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                <input
                                    type="tel"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    placeholder="021 234 5678"
                                    className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                />
                            </div>
                            <p className="text-xs text-slate-400 mt-1">
                                NZ format: 021 234 5678 or 09 123 4567
                            </p>
                        </div>

                        {/* Save Button */}
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full flex items-center justify-center gap-2 py-3 bg-slate-900 hover:bg-black text-white font-black uppercase tracking-widest text-sm rounded-xl transition-all disabled:opacity-50"
                        >
                            <Save className="w-4 h-4" />
                            {loading ? 'Saving...' : 'Save Profile'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}

export default function SettingsPage() {
    return (
        <ProtectedRoute>
            <SettingsContent />
        </ProtectedRoute>
    );
}
