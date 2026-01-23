/**
 * Application configuration
 * Safely exports environment variables to be used throughout the app.
 */

export const config = {
    twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID || '',
        authToken: process.env.TWILIO_AUTH_TOKEN || '',
        trialNumber: process.env.TWILIO_PHONE_NUMBER || '',
    },
    resend: {
        apiKey: process.env.RESEND_API_KEY || '',
    },
    supabase: {
        url: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    },
    isDev: process.env.NODE_ENV === 'development',
};

// Validation check to help in development
if (config.isDev) {
    const missing = [];
    if (!config.twilio.accountSid) missing.push('TWILIO_ACCOUNT_SID');
    if (!config.twilio.authToken) missing.push('TWILIO_AUTH_TOKEN');
    if (!config.twilio.trialNumber) missing.push('TWILIO_PHONE_NUMBER');
    if (!config.resend.apiKey) missing.push('RESEND_API_KEY');

    if (missing.length > 0) {
        console.warn(`⚠️ Configuration Warning: Missing environment variables: ${missing.join(', ')}`);
        console.warn('The app will use Development Mode mock services.');
    }
}
