import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Sends a professional notice email using Resend.
 * Includes a development mode check to prevent real emails from being sent during testing.
 */
export async function sendNoticeEmail(to: string, subject: string, body: string) {
    const isDev = process.env.NODE_ENV === 'development';

    if (isDev) {
        console.log('✉️ [DEVELOPMENT MODE: MAIL LOG]');
        console.log(`To: ${to}`);
        console.log(`Subject: ${subject}`);
        console.log(`Body: ${body}`);
        console.log('-------------------------------');
        return { success: true, mode: 'development' };
    }

    if (!process.env.RESEND_API_KEY) {
        console.error('❌ Configuration Error: RESEND_API_KEY is missing.');
        return { success: false, error: 'API Key missing' };
    }

    try {
        const { data, error } = await resend.emails.send({
            from: 'Landlord App <onboarding@resend.dev>', // Resend default for unverified domains
            to: [to],
            subject: subject,
            html: body, // Converting the 'body' string to HTML content
        });

        if (error) {
            console.error('❌ Resend Error:', error);
            return { success: false, error };
        }

        console.log(`✅ Email sent successfully! ID: ${data?.id}`);
        return { success: true, id: data?.id };
    } catch (err: any) {
        console.error('❌ Mail Service Exception:', err.message);
        return { success: false, error: err.message };
    }
}
