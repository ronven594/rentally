import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioNumber = process.env.TWILIO_PHONE_NUMBER;

// Initialize client lazily or handle missing keys gracefully for dev
const client = accountSid && authToken ? twilio(accountSid, authToken) : null;

/**
 * Sends an SMS message.
 * In development mode, messages are logged to the console instead of being sent.
 */
export async function sendSMS(to: string, message: string) {
    const isDev = process.env.NODE_ENV === 'development';

    if (isDev) {
        console.log('📱 [DEVELOPMENT SMS]');
        console.log(`TO: ${to}`);
        console.log(`MESSAGE: ${message}`);
        console.log('-------------------');
        return { success: true, mode: 'development' };
    }

    if (!client || !twilioNumber) {
        const error = 'Twilio SID, Token, or Trial Number is missing in environment variables.';
        console.error(`❌ SMS Error: ${error}`);
        throw new Error(error);
    }

    try {
        const response = await client.messages.create({
            body: message,
            from: twilioNumber,
            to: to
        });

        console.log(`✅ SMS Sent! SID: ${response.sid}`);
        return { success: true, sid: response.sid };
    } catch (error: any) {
        console.error('❌ Twilio SMS Error:', error.message);
        throw error;
    }
}
