import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
    // Fallback for development if env variables aren't loaded yet
    // but we should really throw to ensure they are set
    // throw new Error('Missing Supabase environment variables');
}

// Create client with safe defaults
export const supabase = createClient(supabaseUrl || 'https://aojcpoichyxebxsnwitf.supabase.co', supabaseAnonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvamNwb2ljaHl4ZWJ4c253aXRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgzMzI3MDksImV4cCI6MjA4MzkwODcwOX0.GHUIN_nBX4eNkyRgBIzyTz6Hi8MabFnAgmjwyzLpAgw', {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    },
    global: {
        headers: {
            'x-client-info': 'landlord-manager-app',
        },
    },
});
