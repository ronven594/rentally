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
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                {/* Logo/Brand */}
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-black text-slate-900 tracking-tight">
                        Landlord Manager
                    </h1>
                    <p className="text-sm text-slate-500 mt-2">
                        NZ RTA-compliant rent tracking
                    </p>
                </div>

                {/* Auth Card */}
                <div className="bg-white rounded-2xl shadow-lg border border-slate-100 p-8">
                    {/* Toggle Sign In / Sign Up */}
                    <div className="flex gap-2 mb-6">
                        <button
                            type="button"
                            onClick={() => setIsSignUp(false)}
                            className={`flex-1 py-2 px-4 rounded-xl text-sm font-bold uppercase tracking-widest transition-all ${!isSignUp
                                    ? 'bg-slate-900 text-white'
                                    : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                                }`}
                        >
                            Sign In
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsSignUp(true)}
                            className={`flex-1 py-2 px-4 rounded-xl text-sm font-bold uppercase tracking-widest transition-all ${isSignUp
                                    ? 'bg-slate-900 text-white'
                                    : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                                }`}
                        >
                            Sign Up
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* Email Input */}
                        <div>
                            <label className="text-xs font-black uppercase text-slate-400 tracking-widest mb-2 block">
                                Email
                            </label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="landlord@example.com"
                                    required
                                    className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                                />
                            </div>
                        </div>

                        {/* Password Input */}
                        <div>
                            <label className="text-xs font-black uppercase text-slate-400 tracking-widest mb-2 block">
                                Password
                            </label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••••••"
                                    required
                                    className="w-full pl-11 pr-11 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                                >
                                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>
                        </div>

                        {/* Password Requirements (Sign Up Only) */}
                        {isSignUp && password && (
                            <div className="bg-slate-50 rounded-xl p-4 space-y-2">
                                <p className="text-xs font-black uppercase text-slate-600 tracking-widest mb-2">
                                    Password Requirements:
                                </p>
                                {passwordValidation?.errors.map((error, i) => (
                                    <div key={i} className="flex items-center gap-2 text-xs text-slate-600">
                                        <AlertCircle className="w-3 h-3 text-amber-500" />
                                        {error}
                                    </div>
                                ))}
                                {passwordValidation?.valid && (
                                    <div className="flex items-center gap-2 text-xs text-emerald-600 font-bold">
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
                            className="w-full py-3 bg-slate-900 hover:bg-black text-white font-black uppercase tracking-widest text-sm rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
                        </button>
                    </form>

                    {/* Helper Text */}
                    <div className="mt-6 text-center">
                        <p className="text-xs text-slate-500">
                            {isSignUp ? (
                                <>
                                    By signing up, you agree to comply with NZ RTA regulations
                                </>
                            ) : (
                                <>
                                    Forgot your password?{' '}
                                    <button className="text-emerald-600 hover:text-emerald-700 font-bold">
                                        Reset it
                                    </button>
                                </>
                            )}
                        </p>
                    </div>
                </div>

                {/* Security Badge */}
                <div className="mt-6 text-center">
                    <p className="text-xs text-slate-400 flex items-center justify-center gap-2">
                        <Lock className="w-3 h-3" />
                        Protected by rate limiting and encryption
                    </p>
                </div>
            </div>
        </div>
    );
}
