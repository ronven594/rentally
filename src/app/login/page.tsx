"use client"

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Eye, EyeOff, Mail, Lock, AlertCircle, CheckCircle } from 'lucide-react';
import { isValidPassword } from '@/lib/validation';

export default function LoginPage() {
    const [isSignUp, setIsSignUp] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const { signIn, signUp } = useAuth();
    const router = useRouter();

    // Real-time password validation for signup
    const passwordValidation = isSignUp ? isValidPassword(password) : null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            if (isSignUp) {
                await signUp(email, password);
                toast.success('Account created! Please check your email to verify.');
            } else {
                await signIn(email, password);
                toast.success('Welcome back!');
                router.push('/');
            }
        } catch (error: any) {
            toast.error(error.message || 'Authentication failed');
            console.error('Auth error:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#0B0E11] flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                {/* Logo/Brand */}
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-black text-white tracking-tight">
                        Landlord Manager
                    </h1>
                    <p className="text-sm text-white/50 mt-2">
                        NZ RTA-compliant rent tracking
                    </p>
                </div>

                {/* Auth Card - Glass Style */}
                <div className="bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-8">
                    {/* Toggle Sign In / Sign Up */}
                    <div className="flex gap-2 mb-6">
                        <button
                            type="button"
                            onClick={() => setIsSignUp(false)}
                            className={`flex-1 py-2 px-4 rounded-xl text-sm font-bold uppercase tracking-widest transition-all ${!isSignUp
                                    ? 'bg-[#00FFBB] text-[#0B0E11] shadow-[0_0_15px_rgba(0,255,187,0.3)]'
                                    : 'bg-white/5 text-white/50 hover:bg-white/10'
                                }`}
                        >
                            Sign In
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsSignUp(true)}
                            className={`flex-1 py-2 px-4 rounded-xl text-sm font-bold uppercase tracking-widest transition-all ${isSignUp
                                    ? 'bg-[#00FFBB] text-[#0B0E11] shadow-[0_0_15px_rgba(0,255,187,0.3)]'
                                    : 'bg-white/5 text-white/50 hover:bg-white/10'
                                }`}
                        >
                            Sign Up
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* Email Input */}
                        <div>
                            <label className="text-xs font-black uppercase text-white/40 tracking-widest mb-2 block">
                                Email
                            </label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30" />
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="landlord@example.com"
                                    required
                                    className="w-full pl-11 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm font-medium text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#00FFBB]/50 focus:border-[#00FFBB]/30 transition-all"
                                />
                            </div>
                        </div>

                        {/* Password Input */}
                        <div>
                            <label className="text-xs font-black uppercase text-white/40 tracking-widest mb-2 block">
                                Password
                            </label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30" />
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••••••"
                                    required
                                    className="w-full pl-11 pr-11 py-3 bg-white/5 border border-white/10 rounded-xl text-sm font-medium text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#00FFBB]/50 focus:border-[#00FFBB]/30 transition-all"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                                >
                                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>
                        </div>

                        {/* Password Requirements (Sign Up Only) */}
                        {isSignUp && password && (
                            <div className="bg-white/5 rounded-xl p-4 space-y-2 border border-white/10">
                                <p className="text-xs font-black uppercase text-white/60 tracking-widest mb-2">
                                    Password Requirements:
                                </p>
                                {passwordValidation?.errors.map((error, i) => (
                                    <div key={i} className="flex items-center gap-2 text-xs text-white/60">
                                        <AlertCircle className="w-3 h-3 text-[#FFB800]" />
                                        {error}
                                    </div>
                                ))}
                                {passwordValidation?.valid && (
                                    <div className="flex items-center gap-2 text-xs text-[#00FFBB] font-bold">
                                        <CheckCircle className="w-3 h-3" />
                                        Password meets all requirements
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={loading || (isSignUp && !passwordValidation?.valid)}
                            className="w-full py-3 bg-[#00FFBB] hover:shadow-[0_0_20px_rgba(0,255,187,0.4)] text-[#0B0E11] font-black uppercase tracking-widest text-sm rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
                        </button>
                    </form>

                    {/* Helper Text */}
                    <div className="mt-6 text-center">
                        <p className="text-xs text-white/40">
                            {isSignUp ? (
                                <>
                                    By signing up, you agree to comply with NZ RTA regulations
                                </>
                            ) : (
                                <>
                                    Forgot your password?{' '}
                                    <button className="text-[#00FFBB] hover:text-[#00FFBB]/80 font-bold">
                                        Reset it
                                    </button>
                                </>
                            )}
                        </p>
                    </div>
                </div>

                {/* Security Badge */}
                <div className="mt-6 text-center">
                    <p className="text-xs text-white/30 flex items-center justify-center gap-2">
                        <Lock className="w-3 h-3" />
                        Protected by rate limiting and encryption
                    </p>
                </div>
            </div>
        </div>
    );
}
