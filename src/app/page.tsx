"use client"

import Image from "next/image";

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Link as LinkIcon } from 'lucide-react';

function LinkPropertiesButton() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleLinkProperties = async () => {
    if (!user) return;

    setLoading(true);
    try {
      // Update all properties with null user_id
      const { data, error } = await supabase
        .from('properties')
        .update({ user_id: user.id })
        .is('user_id', null)
        .select();

      if (error) throw error;

      toast.success(`Linked ${data?.length || 0} properties to your account`);

      // Refresh the page to show updated data
      window.location.reload();
    } catch (error: any) {
      toast.error('Failed to link properties');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleLinkProperties}
      disabled={loading}
      className="flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase tracking-widest text-xs rounded-full shadow-lg shadow-emerald-100 transition-all disabled:opacity-50"
    >
      <LinkIcon className="w-4 h-4" />
      {loading ? 'Linking...' : 'Link My Properties'}
    </button>
  );
}

export default function Home() {
  const { user, profile, loading } = useAuth();

  console.log('🔐 Auth State (Home):', { user, profile, loading });

  return (
    <ProtectedRoute>
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
        <main className="flex min-h-screen w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
          <Image
            className="dark:invert"
            src="/next.svg"
            alt="Next.js logo"
            width={100}
            height={20}
            priority
          />
          <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
            <h1 className="max-w-xs text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
              Welcome to NZ Landlord
            </h1>
            <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
              Your RTA-compliant management tool. If you have existing property data, click below to link it to your account.
            </p>
          </div>

          <div className="flex flex-col gap-4 w-full sm:flex-row items-center mt-8">
            <LinkPropertiesButton />

            <a
              className="flex h-12 px-8 items-center justify-center rounded-full border border-solid border-black/[.08] transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a] text-sm font-bold"
              href="/rent-tracker"
            >
              Continue to Tenants
            </a>
          </div>
        </main>
      </div>
    </ProtectedRoute>
  );
}
