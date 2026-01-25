"use client"

import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { User } from '@supabase/supabase-js';
import { secureSignIn, secureSignUp, secureUpdateProfile } from '@/lib/secureAuth';

interface UserProfile {
    id: string;
    user_id: string;
    full_name: string | null;
    service_address: string | null;
    phone: string | null;
    email: string | null;
}

interface AuthContextType {
    user: User | null;
    profile: UserProfile | null;
    loading: boolean;
    signIn: (email: string, password: string) => Promise<void>;
    signUp: (email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
    updateProfile: (updates: { full_name?: string; service_address?: string; phone?: string }) => Promise<void>;
    refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchProfile = async (userId: string) => {
        try {
            console.log('🔍 Fetching profile for user:', userId);
            const { data, error } = await supabase
                .from('user_profiles')
                .select('*')
                .eq('user_id', userId)
                .single();

            if (error) {
                console.error('❌ Error fetching profile:', error);
                return;
            }

            console.log('✅ User profile loaded:', data);
            setProfile(data);
        } catch (err) {
            console.error('❌ Error in fetchProfile:', err);
            setError('Failed to load profile');
        }
    };

    useEffect(() => {
        let isMounted = true;

        const initAuth = async () => {
            try {
                console.log('🔐 Initializing auth...');

                // Check active session
                const { data: { session }, error: sessionError } = await supabase.auth.getSession();

                if (sessionError) {
                    console.error('❌ Session error:', sessionError);
                    throw sessionError;
                }

                if (isMounted) {
                    console.log('👤 Session:', session?.user?.email || 'No user');
                    setUser(session?.user ?? null);
                    if (session?.user) {
                        await fetchProfile(session.user.id);
                    }
                    setLoading(false);
                }
            } catch (err) {
                console.error('❌ Auth initialization error:', err);
                if (isMounted) {
                    setError('Authentication failed');
                    setLoading(false);
                }
            }
        };

        initAuth();

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            console.log('🔄 Auth state changed:', event);
            if (isMounted) {
                setUser(session?.user ?? null);
                if (session?.user) {
                    await fetchProfile(session.user.id);
                } else {
                    setProfile(null);
                }
                setLoading(false);
            }
        });

        return () => {
            isMounted = false;
            subscription.unsubscribe();
        };
    }, []);

    const signIn = async (email: string, password: string) => {
        await secureSignIn(email, password);
    };

    const signUp = async (email: string, password: string) => {
        await secureSignUp(email, password);
    };

    const signOut = async () => {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        setProfile(null);
        setUser(null);
    };

    const updateProfile = async (updates: { full_name?: string; service_address?: string; phone?: string }) => {
        console.log('🔄 AuthContext.updateProfile called with:', updates);

        if (!user) {
            console.error('❌ No user logged in');
            throw new Error('No user logged in');
        }

        console.log('📝 Updating for user:', user.id);

        try {
            // Call the secure update function
            console.log('🔐 Calling secureUpdateProfile...');
            await secureUpdateProfile(updates);

            console.log('✅ secureUpdateProfile succeeded');
            console.log('🔄 Fetching updated profile...');
            await fetchProfile(user.id);
            console.log('✅ Profile fetched successfully');
        } catch (error) {
            console.error('❌ updateProfile error:', error);
            throw error;
        }
    };

    const refreshProfile = async () => {
        if (user) {
            await fetchProfile(user.id);
        }
    };

    // Show error state if initialization failed
    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="text-center">
                    <p className="text-red-600 font-bold mb-4">{error}</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-4 py-2 bg-nav-black text-white rounded-xl font-black"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <AuthContext.Provider value={{
            user,
            profile,
            loading,
            signIn,
            signUp,
            signOut,
            updateProfile,
            refreshProfile
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
