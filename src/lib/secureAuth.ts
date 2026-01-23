import { supabase } from '@/lib/supabaseClient';
import { isValidEmail, isValidPassword, sanitizeInput } from './validation';
import { checkRateLimit } from './rateLimiter';

export async function secureSignIn(email: string, password: string) {
    // Input validation
    if (!isValidEmail(email)) {
        throw new Error('Invalid email format');
    }

    // Rate limiting (5 attempts per hour per email)
    const rateLimit = checkRateLimit(`login:${email}`, 5, 60 * 60 * 1000);
    if (!rateLimit.allowed) {
        const minutesLeft = Math.ceil(rateLimit.resetIn / 60000);
        throw new Error(`Too many login attempts. Try again in ${minutesLeft} minutes.`);
    }

    // Attempt login
    const { data, error } = await supabase.auth.signInWithPassword({
        email: email.toLowerCase().trim(),
        password
    });

    if (error) {
        console.error('Login failed:', error.message);
        throw new Error('Invalid email or password');
    }

    return data;
}

export async function secureSignUp(email: string, password: string) {
    // Input validation
    if (!isValidEmail(email)) {
        throw new Error('Invalid email format');
    }

    const passwordCheck = isValidPassword(password);
    if (!passwordCheck.valid) {
        throw new Error(passwordCheck.errors[0]);
    }

    // Rate limiting (3 signups per hour per IP)
    const rateLimit = checkRateLimit(`signup:${email}`, 3, 60 * 60 * 1000);
    if (!rateLimit.allowed) {
        const minutesLeft = Math.ceil(rateLimit.resetIn / 60000);
        throw new Error(`Too many signup attempts. Try again in ${minutesLeft} minutes.`);
    }

    // Attempt signup
    const { data, error } = await supabase.auth.signUp({
        email: email.toLowerCase().trim(),
        password,
        options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`
        }
    });

    if (error) {
        console.error('Signup failed:', error.message);
        throw new Error(error.message);
    }

    return data;
}

export async function secureUpdateProfile(updates: {
    full_name?: string;
    service_address?: string;
    phone?: string | null;
}) {
    console.log('🔐 secureUpdateProfile called');

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        console.error('❌ Not authenticated');
        throw new Error('Not authenticated');
    }

    console.log('👤 User authenticated:', user.id);

    // Sanitize all text inputs
    const sanitized: any = {};

    if (updates.full_name !== undefined) {
        sanitized.full_name = sanitizeInput(updates.full_name);
        console.log('📝 Sanitized name:', sanitized.full_name);
        if (sanitized.full_name.length < 2) {
            throw new Error('Name must be at least 2 characters');
        }
    }

    if (updates.service_address !== undefined) {
        sanitized.service_address = sanitizeInput(updates.service_address);
        console.log('📝 Sanitized address:', sanitized.service_address);
        if (sanitized.service_address.length < 10) {
            throw new Error('Address must be at least 10 characters');
        }
    }

    if (updates.phone !== undefined) {
        if (updates.phone) {
            const cleanPhone = updates.phone.replace(/\s/g, '');
            if (!/^(\+64|0)[2-9]\d{7,9}$/.test(cleanPhone)) {
                throw new Error('Invalid NZ phone number format');
            }
            sanitized.phone = cleanPhone;
        } else {
            sanitized.phone = null;
        }
        console.log('📝 Sanitized phone:', sanitized.phone);
    }

    console.log('💾 Updating database with:', sanitized);

    // Update profile
    const { data, error } = await supabase
        .from('user_profiles')
        .update(sanitized)
        .eq('user_id', user.id)
        .select();

    if (error) {
        console.error('❌ Supabase update error:', error);
        throw error;
    }

    console.log('✅ Database updated successfully:', data);
    return data;
}
