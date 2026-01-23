"use client"

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

export default function AuthCallbackPage() {
    const router = useRouter();

    useEffect(() => {
        // Handle the OAuth/Email callback
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
                if (session) {
                    router.push('/');
                }
            }
        });

        return () => subscription.unsubscribe();
    }, [router]);

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="text-center max-w-sm">
                <div className="w-12 h-12 border-4 border-slate-200 border-t-emerald-600 rounded-full animate-spin mx-auto mb-6"></div>
                <h2 className="text-lg font-black text-slate-900 uppercase tracking-tighter mb-2">
                    Verifying your email
                </h2>
                <p className="text-sm text-slate-500 font-medium">
                    Please wait while we secure your account. You will be redirected to your dashboard automatically.
                </p>
            </div>
        </div>
    );
}
