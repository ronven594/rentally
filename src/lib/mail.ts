import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Email attachment interface
 */
export interface EmailAttachment {
    filename: string;
    content: Buffer | string; // Buffer for binary, base64 string also supported
    contentType?: string;
}

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
            from: 'Rentally <noreply@rentally.co.nz>', // Resend default for unverified domains
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

/**
 * Sends a notice email with PDF attachment using Resend.
 * The PDF contains the official legal notice while the email body is a cover note.
 *
 * @param to - Recipient email address
 * @param subject - Email subject line
 * @param coverNote - HTML cover note for the email body
 * @param attachment - PDF attachment with filename and content
 */
export async function sendNoticeEmailWithAttachment(
    to: string,
    subject: string,
    coverNote: string,
    attachment: EmailAttachment,
    additionalAttachments?: EmailAttachment[]
) {
    const isDev = process.env.NODE_ENV === 'development';
    const allAttachments = [attachment, ...(additionalAttachments || [])];

    if (isDev) {
        console.log('✉️ [DEVELOPMENT MODE: MAIL LOG WITH ATTACHMENT]');
        console.log(`To: ${to}`);
        console.log(`Subject: ${subject}`);
        console.log(`Cover Note: ${coverNote.substring(0, 200)}...`);
        allAttachments.forEach(a => {
            console.log(`Attachment: ${a.filename} (${typeof a.content === 'string' ? a.content.length : a.content.length} bytes)`);
        });
        console.log('-------------------------------');
        return { success: true, mode: 'development', attachmentFilename: attachment.filename };
    }

    if (!process.env.RESEND_API_KEY) {
        console.error('❌ Configuration Error: RESEND_API_KEY is missing.');
        return { success: false, error: 'API Key missing' };
    }

    try {
        const resendAttachments = allAttachments.map(a => ({
            filename: a.filename,
            content: Buffer.isBuffer(a.content)
                ? a.content.toString('base64')
                : a.content,
            contentType: a.contentType || 'application/pdf',
        }));

        const { data, error } = await resend.emails.send({
            from: 'Rentally <noreply@rentally.co.nz>',
            to: [to],
            subject: subject,
            html: coverNote,
            attachments: resendAttachments,
        });

        if (error) {
            console.error('❌ Resend Error:', error);
            return { success: false, error };
        }

        console.log(`✅ Email with ${allAttachments.length} attachment(s) sent successfully! ID: ${data?.id}`);
        return { success: true, id: data?.id, attachmentFilename: attachment.filename };
    } catch (err: any) {
        console.error('❌ Mail Service Exception:', err.message);
        return { success: false, error: err.message };
    }
}
