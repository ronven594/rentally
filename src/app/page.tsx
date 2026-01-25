"use client"

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Building2, ArrowRight, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function Home() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  // Auto-redirect to rent-tracker if authenticated
  useEffect(() => {
    if (!loading && user) {
      router.push('/rent-tracker');
    }
  }, [loading, user, router]);

  return (
    <ProtectedRoute>
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="text-center space-y-8 px-6">
          {/* Brand Icon */}
          <div className="mx-auto w-20 h-20 bg-[#00FFBB] rounded-2xl flex items-center justify-center shadow-[0_0_40px_rgba(0,255,187,0.3)]">
            <Building2 className="w-10 h-10 text-[#0B0E11]" />
          </div>

          {/* Welcome Text */}
          <div className="space-y-3">
            <h1 className="text-3xl font-black text-white tracking-tight">
              Welcome{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}
            </h1>
            <p className="text-white/50 text-lg max-w-md mx-auto">
              Your RTA-compliant property management command center
            </p>
          </div>

          {/* Loading / Redirect State */}
          <div className="flex items-center justify-center gap-3 text-white/40">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm font-medium">Redirecting to dashboard...</span>
          </div>

          {/* Manual Link */}
          <Link
            href="/rent-tracker"
            className="inline-flex items-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-[#00FFBB]/30 rounded-full text-white/70 hover:text-white text-sm font-bold transition-all"
          >
            Go to Properties
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </ProtectedRoute>
  );
}
