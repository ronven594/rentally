/**
 * API Route: /api/send-notice
 *
 * Sends a tenant notice and saves it to the Supabase notices table.
 * All dates are calculated by legal-engine.ts TypeScript functions.
 *
 * Flow:
 * 1. Calculate dates using legal-engine.ts
 * 2. Generate PDF using official NZ Tenancy Services templates
 * 3. Save notice record to Supabase
 * 4. Send email with PDF attachment via Resend
 * 5. Update notice with email delivery status
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { format } from "date-fns";
import {
    calculateOfficialServiceDate,
    calculateRemedyExpiryDate,
    calculateTribunalDeadline,
    type NoticeType,
} from "@/lib/legal-engine";
import { type NZRegion } from "@/lib/nz-holidays";
import { sendNoticeEmailWithAttachment } from "@/lib/mail";
import { generateNoticePDF } from "@/lib/pdf-generator";

// Create Supabase client with service role for API routes
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface SendNoticeRequest {
    tenantId: string;
    propertyId: string;
    tenantEmail: string;
    tenantName: string;
    tenantAddress?: string;
    propertyAddress: string;
    region: NZRegion;
    noticeType: NoticeType;
    strikeNumber?: number; // 1, 2, or 3 for strike notices
    rentDueDate?: string;
    rentAmount?: number;
    amountOwed?: number;
    breachDescription?: string; // For S55A_SOCIAL or S56_REMEDY
    // Landlord details for PDF
    landlordName?: string;
    landlordPhone?: string;
    landlordMobile?: string;
    landlordEmail?: string;
    landlordAddress?: string;
    // Previous strike info for the PDF
    firstStrikeDate?: string;
    previousNotices?: { date: string }[];
}

interface NoticeRecord {
    tenant_id: string;
    property_id: string;
    notice_type: NoticeType;
    is_strike: boolean;
    strike_number: number | null;
    sent_at: string;
    official_service_date: string;
    expiry_date: string | null;
    tribunal_deadline: string | null;
    rent_due_date: string | null;
    amount_owed: number | null;
    email_sent: boolean;
    email_sent_at: string | null;
    email_id: string | null;
    recipient_email: string;
    subject: string;
    body_html: string;
    status: "draft" | "sent" | "delivered" | "failed";
    file_path: string | null;
    metadata: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
    try {
        const body: SendNoticeRequest = await request.json();

        // Validate required fields
        const requiredFields = ["tenantId", "propertyId", "tenantEmail", "tenantName", "propertyAddress", "noticeType"];
        for (const field of requiredFields) {
            if (!body[field as keyof SendNoticeRequest]) {
                return NextResponse.json(
                    { error: `${field} is required` },
                    { status: 400 }
                );
            }
        }

        // Validate strike number for strike notices
        if (body.noticeType === "S55_STRIKE" && (!body.strikeNumber || body.strikeNumber < 1 || body.strikeNumber > 3)) {
            return NextResponse.json(
                { error: "strikeNumber (1-3) is required for S55_STRIKE notices" },
                { status: 400 }
            );
        }

        // Step 1: Calculate all legal dates using TypeScript (NOT AI)
        const sentTimestamp = new Date().toISOString();
        const region = body.region || "Auckland";

        // Calculate Official Service Date (5PM rule + working day validation)
        const officialServiceDate = calculateOfficialServiceDate(sentTimestamp, region);

        // Calculate expiry date for remedy notices (14 days)
        const expiryDate = body.noticeType === "S56_REMEDY"
            ? calculateRemedyExpiryDate(officialServiceDate)
            : null;

        // Calculate tribunal deadline for 3rd strike (28 days)
        const tribunalDeadline = body.noticeType === "S55_STRIKE" && body.strikeNumber === 3
            ? calculateTribunalDeadline(officialServiceDate)
            : null;

        // Determine if this is a strike notice
        const isStrike = body.noticeType === "S55_STRIKE" || body.noticeType === "S55A_SOCIAL";

        // Step 2: Generate PDF notice using official templates
        let pdfData: { pdfBytes: Uint8Array; filename: string } | null = null;

        if (body.noticeType === "S55_STRIKE" || body.noticeType === "S56_REMEDY") {
            try {
                pdfData = await generateNoticePDF(
                    body.noticeType,
                    {
                        tenantName: body.tenantName,
                        tenantAddress: body.tenantAddress || body.propertyAddress,
                        propertyAddress: body.propertyAddress,
                        amountOwed: body.amountOwed || 0,
                        rentAmount: body.rentAmount,
                        rentDueDate: body.rentDueDate,
                        strikeNumber: body.strikeNumber as 1 | 2 | 3,
                        firstStrikeDate: body.firstStrikeDate,
                        previousNotices: body.previousNotices,
                        paymentDeadline: expiryDate || undefined,
                        landlordName: body.landlordName || "Landlord",
                        landlordPhone: body.landlordPhone,
                        landlordMobile: body.landlordMobile,
                        landlordEmail: body.landlordEmail,
                        landlordAddress: body.landlordAddress,
                        officialServiceDate,
                    }
                );
            } catch (pdfError) {
                console.error("PDF Generation Error:", pdfError);
                // Continue without PDF if generation fails
            }
        }

        // Step 3: Generate email cover note (the legal weight is in the PDF attachment)
        const emailContent = generateCoverNote({
            tenantName: body.tenantName,
            propertyAddress: body.propertyAddress,
            noticeType: body.noticeType,
            strikeNumber: body.strikeNumber,
            officialServiceDate,
            expiryDate,
            tribunalDeadline,
            hasPdfAttachment: !!pdfData,
        });

        // Step 4: Upload PDF to Supabase Storage
        let storagePath: string | null = null;

        if (pdfData) {
            try {
                // Generate unique filename with tenant ID and timestamp
                const timestamp = format(new Date(), "yyyyMMdd-HHmmss");
                const safeFilename = pdfData.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
                storagePath = `${body.tenantId}/${timestamp}_${safeFilename}`;

                const { error: uploadError } = await supabaseAdmin.storage
                    .from("notices")
                    .upload(storagePath, pdfData.pdfBytes, {
                        contentType: "application/pdf",
                        upsert: false,
                    });

                if (uploadError) {
                    console.error("Storage Upload Error:", uploadError);
                    // Continue without storage path if upload fails
                    storagePath = null;
                }
            } catch (storageError) {
                console.error("Storage Error:", storageError);
                storagePath = null;
            }
        }

        // Step 5: Prepare notice record for database
        const noticeRecord: NoticeRecord = {
            tenant_id: body.tenantId,
            property_id: body.propertyId,
            notice_type: body.noticeType,
            is_strike: isStrike,
            strike_number: isStrike ? body.strikeNumber || null : null,
            sent_at: sentTimestamp,
            official_service_date: officialServiceDate,
            expiry_date: expiryDate,
            tribunal_deadline: tribunalDeadline,
            rent_due_date: body.rentDueDate || null,
            amount_owed: body.amountOwed || null,
            email_sent: false,
            email_sent_at: null,
            email_id: null,
            recipient_email: body.tenantEmail,
            subject: emailContent.subject,
            body_html: emailContent.html,
            status: "draft",
            file_path: storagePath,
            metadata: {
                region,
                generatedAt: sentTimestamp,
            },
        };

        // Step 6: Save notice to database FIRST (before sending email)
        const { data: savedNotice, error: dbError } = await supabaseAdmin
            .from("notices")
            .insert(noticeRecord)
            .select()
            .single();

        if (dbError) {
            console.error("Database Error:", dbError);
            return NextResponse.json(
                { error: "Failed to save notice to database", details: dbError.message },
                { status: 500 }
            );
        }

        // Step 7: Send email via Resend (with PDF attachment if available)
        let emailResult;

        if (pdfData) {
            // Send with PDF attachment - the legal weight is in the PDF
            emailResult = await sendNoticeEmailWithAttachment(
                body.tenantEmail,
                emailContent.subject,
                emailContent.html,
                {
                    filename: pdfData.filename,
                    content: Buffer.from(pdfData.pdfBytes),
                    contentType: "application/pdf",
                }
            );
        } else {
            // Fallback to HTML-only email if PDF generation failed
            const { sendNoticeEmail } = await import("@/lib/mail");
            emailResult = await sendNoticeEmail(
                body.tenantEmail,
                emailContent.subject,
                emailContent.html
            );
        }

        // Step 8: Update notice with email delivery status
        const emailSentAt = new Date().toISOString();
        const { error: updateError } = await supabaseAdmin
            .from("notices")
            .update({
                email_sent: emailResult.success,
                email_sent_at: emailResult.success ? emailSentAt : null,
                email_id: emailResult.id || null,
                status: emailResult.success ? "sent" : "failed",
            })
            .eq("id", savedNotice.id);

        if (updateError) {
            console.error("Failed to update notice status:", updateError);
        }

        // Step 9: Return response
        return NextResponse.json({
            success: true,
            notice: {
                id: savedNotice.id,
                noticeType: body.noticeType,
                isStrike,
                strikeNumber: body.strikeNumber,
                filePath: storagePath,
            },
            dates: {
                sentAt: sentTimestamp,
                officialServiceDate,
                expiryDate,
                tribunalDeadline,
            },
            email: {
                sent: emailResult.success,
                sentAt: emailResult.success ? emailSentAt : null,
                id: emailResult.id,
                error: emailResult.error,
            },
            pdf: pdfData ? {
                generated: true,
                filename: pdfData.filename,
                storagePath: storagePath,
            } : {
                generated: false,
                storagePath: null,
                reason: "PDF generation not available for this notice type or failed",
            },
            legalContext: getLegalContext(body.noticeType, body.strikeNumber),
        });
    } catch (error: any) {
        console.error("Send Notice API Error:", error);
        return NextResponse.json(
            { error: error.message || "Internal server error" },
            { status: 500 }
        );
    }
}

/**
 * Generates a professional email cover note.
 * The legal weight is in the attached PDF, so this is a brief cover note.
 */
function generateCoverNote(params: {
    tenantName: string;
    propertyAddress: string;
    noticeType: NoticeType;
    strikeNumber?: number;
    officialServiceDate: string;
    expiryDate: string | null;
    tribunalDeadline: string | null;
    hasPdfAttachment: boolean;
}): { subject: string; html: string } {
    const {
        tenantName,
        propertyAddress,
        noticeType,
        strikeNumber,
        officialServiceDate,
        expiryDate,
        hasPdfAttachment,
    } = params;

    // Format dates for display
    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return "N/A";
        return format(new Date(dateStr), "EEEE, d MMMM yyyy");
    };

    // Generate subject line
    let subject: string;
    switch (noticeType) {
        case "S55_STRIKE":
            subject = `Strike ${strikeNumber} Notice - Rent Arrears - ${propertyAddress}`;
            break;
        case "S55_21DAYS":
            subject = `Notice of Serious Rent Arrears - ${propertyAddress}`;
            break;
        case "S55A_SOCIAL":
            subject = `Anti-Social Behaviour Notice (Strike ${strikeNumber}) - ${propertyAddress}`;
            break;
        case "S56_REMEDY":
            subject = `14-Day Notice to Remedy - ${propertyAddress}`;
            break;
        default:
            subject = `Tenancy Notice - ${propertyAddress}`;
    }

    // Generate HTML cover note
    const noticeTypeDescription = getNoticeTypeDescription(noticeType, strikeNumber);
    const attachmentNote = hasPdfAttachment
        ? `<p style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 12px; border-radius: 6px; margin: 20px 0;">
            <strong>📎 Important:</strong> Please find the official notice document attached to this email as a PDF.
            This PDF contains the formal legal notice and should be kept for your records.
           </p>`
        : "";

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${subject}</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="border-bottom: 3px solid #1e40af; padding-bottom: 15px; margin-bottom: 20px;">
        <h2 style="margin: 0; color: #1e40af;">${noticeTypeDescription}</h2>
        <p style="margin: 5px 0 0 0; color: #6b7280; font-size: 14px;">${propertyAddress}</p>
    </div>

    <p>Dear <strong>${tenantName}</strong>,</p>

    <p>Please be advised that a formal tenancy notice has been issued regarding the property at <strong>${propertyAddress}</strong>.</p>

    ${attachmentNote}

    <div style="background: #f9fafb; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #374151; font-size: 14px; text-transform: uppercase;">Key Dates</h3>
        <p style="margin: 8px 0;"><strong>Official Service Date:</strong> ${formatDate(officialServiceDate)}</p>
        ${expiryDate ? `<p style="margin: 8px 0;"><strong>Remedy Deadline:</strong> ${formatDate(expiryDate)} <span style="color: #6b7280;">(by 11:59 PM)</span></p>` : ""}
    </div>

    <p>If you have any questions regarding this notice, please contact your landlord or property manager.</p>

    <p>For more information about your rights and obligations as a tenant, visit
       <a href="https://www.tenancy.govt.nz" style="color: #2563eb;">tenancy.govt.nz</a>
       or call 0800 TENANCY (0800 836 262).
    </p>

    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280;">
        <p>This email was sent via the Landlord Compliance System in accordance with Section 190 of the Residential Tenancies Act 1986.</p>
    </div>
</body>
</html>
    `.trim();

    return { subject, html };
}

/**
 * Gets a human-readable description of the notice type
 */
function getNoticeTypeDescription(noticeType: NoticeType, strikeNumber?: number): string {
    switch (noticeType) {
        case "S55_STRIKE":
            return `Strike ${strikeNumber} Notice - Overdue Rent`;
        case "S55_21DAYS":
            return "Notice of Serious Rent Arrears (21+ Days)";
        case "S55A_SOCIAL":
            return `Anti-Social Behaviour Notice (Strike ${strikeNumber})`;
        case "S56_REMEDY":
            return "14-Day Notice to Remedy";
        default:
            return "Tenancy Notice";
    }
}

/**
 * Legacy function - generates full email content for fallback when PDF is not available
 */
function generateNoticeEmail(params: {
    tenantName: string;
    propertyAddress: string;
    noticeType: NoticeType;
    strikeNumber?: number;
    rentDueDate?: string;
    amountOwed?: number;
    officialServiceDate: string;
    expiryDate: string | null;
    tribunalDeadline: string | null;
    breachDescription?: string;
}): { subject: string; html: string } {
    const {
        tenantName,
        propertyAddress,
        noticeType,
        strikeNumber,
        rentDueDate,
        amountOwed,
        officialServiceDate,
        expiryDate,
        tribunalDeadline,
        breachDescription,
    } = params;

    // Format dates for display
    const fmtDate = (dateStr: string | null) => {
        if (!dateStr) return "N/A";
        return format(new Date(dateStr), "EEEE, d MMMM yyyy");
    };

    switch (noticeType) {
        case "S55_STRIKE":
            return {
                subject: `Strike ${strikeNumber} Notice - Rent Arrears - ${propertyAddress}`,
                html: generateStrikeNoticeHtml({
                    tenantName,
                    propertyAddress,
                    strikeNumber: strikeNumber || 1,
                    rentDueDate: rentDueDate || "Not specified",
                    amountOwed: amountOwed || 0,
                    officialServiceDate: fmtDate(officialServiceDate),
                    tribunalDeadline: fmtDate(tribunalDeadline),
                }),
            };

        case "S55_21DAYS":
            return {
                subject: `Notice of Serious Rent Arrears - ${propertyAddress}`,
                html: generate21DaysNoticeHtml({
                    tenantName,
                    propertyAddress,
                    amountOwed: amountOwed || 0,
                    officialServiceDate: fmtDate(officialServiceDate),
                }),
            };

        case "S55A_SOCIAL":
            return {
                subject: `Anti-Social Behaviour Notice (Strike ${strikeNumber}) - ${propertyAddress}`,
                html: generateSocialNoticeHtml({
                    tenantName,
                    propertyAddress,
                    strikeNumber: strikeNumber || 1,
                    breachDescription: breachDescription || "Anti-social behaviour",
                    officialServiceDate: fmtDate(officialServiceDate),
                }),
            };

        case "S56_REMEDY":
            return {
                subject: `14-Day Notice to Remedy - ${propertyAddress}`,
                html: generateRemedyNoticeHtml({
                    tenantName,
                    propertyAddress,
                    breachDescription: breachDescription || "Breach of tenancy agreement",
                    officialServiceDate: fmtDate(officialServiceDate),
                    expiryDate: fmtDate(expiryDate),
                }),
            };

        default:
            return {
                subject: `Tenancy Notice - ${propertyAddress}`,
                html: `<p>Notice for ${tenantName}</p>`,
            };
    }
}

/**
 * Strike Notice HTML Template (S55_STRIKE)
 */
function generateStrikeNoticeHtml(params: {
    tenantName: string;
    propertyAddress: string;
    strikeNumber: number;
    rentDueDate: string;
    amountOwed: number;
    officialServiceDate: string;
    tribunalDeadline: string | null;
}): string {
    const { tenantName, propertyAddress, strikeNumber, rentDueDate, amountOwed, officialServiceDate, tribunalDeadline } = params;

    const isThirdStrike = strikeNumber === 3;
    const headerColor = isThirdStrike ? "#991b1b" : "#dc2626";
    const urgencyBadge = isThirdStrike
        ? '<span style="background:#991b1b;color:white;padding:4px 12px;border-radius:4px;font-size:12px;font-weight:bold;margin-left:10px;">FINAL STRIKE</span>'
        : "";

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Strike ${strikeNumber} Notice</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: ${headerColor}; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 24px;">STRIKE ${strikeNumber} OF 3 ${urgencyBadge}</h1>
        <p style="margin: 10px 0 0 0; opacity: 0.9;">Notice of Overdue Rent</p>
        <p style="margin: 5px 0 0 0; font-size: 12px; opacity: 0.8;">Residential Tenancies Act 1986, Section 55(1)(aa)</p>
    </div>

    <div style="background: #f9fafb; padding: 25px; border: 1px solid #e5e7eb; border-top: none;">
        <p>Dear <strong>${tenantName}</strong>,</p>

        <p>This is a formal notice that your rent payment is <strong>overdue by 5 or more working days</strong>. This notice constitutes <strong>Strike ${strikeNumber} of 3</strong> under the Residential Tenancies Act 1986.</p>

        <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e5e7eb;">
            <h3 style="margin-top: 0; color: #374151;">Payment Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;"><strong>Property:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${propertyAddress}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;"><strong>Rent Due Date:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${rentDueDate}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0;"><strong>Amount Outstanding:</strong></td>
                    <td style="padding: 8px 0; font-size: 20px; font-weight: bold; color: #dc2626;">$${amountOwed.toFixed(2)}</td>
                </tr>
            </table>
        </div>

        <div style="background: #fef2f2; border-left: 4px solid #dc2626; padding: 15px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #991b1b;">Important Legal Dates</h3>
            <p style="margin: 5px 0;"><strong>Official Service Date:</strong> ${officialServiceDate}</p>
            ${isThirdStrike && tribunalDeadline ? `<p style="margin: 5px 0;"><strong>Tribunal Filing Deadline:</strong> ${tribunalDeadline}</p>` : ""}
        </div>

        <h3 style="color: #dc2626;">What This Means</h3>
        <ul style="padding-left: 20px;">
            <li>This is <strong>Strike ${strikeNumber}</strong> for rent being 5+ working days overdue.</li>
            <li>If <strong>3 strikes</strong> are issued within a <strong>90-day period</strong>, the landlord may apply to the Tenancy Tribunal for termination of the tenancy.</li>
            ${isThirdStrike ? '<li style="color: #991b1b; font-weight: bold;">This is your 3rd strike. The landlord may now apply to the Tenancy Tribunal for termination.</li>' : ""}
        </ul>

        <h3 style="color: #374151;">Action Required</h3>
        <p>Please pay the outstanding amount of <strong>$${amountOwed.toFixed(2)}</strong> immediately to avoid further action.</p>

        <div style="font-size: 12px; color: #6b7280; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            <p>This notice was sent in accordance with Section 190 of the Residential Tenancies Act 1986.</p>
            <p>For more information about your rights and obligations, visit <a href="https://www.tenancy.govt.nz" style="color: #2563eb;">tenancy.govt.nz</a></p>
        </div>
    </div>
</body>
</html>
    `.trim();
}

/**
 * 21-Day Arrears Notice HTML Template (S55_21DAYS)
 */
function generate21DaysNoticeHtml(params: {
    tenantName: string;
    propertyAddress: string;
    amountOwed: number;
    officialServiceDate: string;
}): string {
    const { tenantName, propertyAddress, amountOwed, officialServiceDate } = params;

    return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>21-Day Arrears Notice</title></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #7c2d12; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 24px;">NOTICE OF SERIOUS RENT ARREARS</h1>
        <p style="margin: 10px 0 0 0; opacity: 0.9;">21+ Calendar Days Overdue</p>
        <p style="margin: 5px 0 0 0; font-size: 12px; opacity: 0.8;">Residential Tenancies Act 1986, Section 55(1)(a)</p>
    </div>

    <div style="background: #f9fafb; padding: 25px; border: 1px solid #e5e7eb; border-top: none;">
        <p>Dear <strong>${tenantName}</strong>,</p>

        <div style="background: #fef2f2; border: 2px solid #dc2626; padding: 20px; margin: 20px 0; border-radius: 8px;">
            <p style="margin: 0; font-weight: bold; color: #991b1b;">Your rent is now 21 or more calendar days in arrears.</p>
            <p style="margin: 10px 0 0 0;">Under Section 55(1)(a) of the Residential Tenancies Act 1986, the landlord may immediately apply to the Tenancy Tribunal for termination of your tenancy.</p>
        </div>

        <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e5e7eb;">
            <p><strong>Property:</strong> ${propertyAddress}</p>
            <p><strong>Total Amount Owed:</strong> <span style="font-size: 24px; font-weight: bold; color: #dc2626;">$${amountOwed.toFixed(2)}</span></p>
            <p><strong>Official Service Date:</strong> ${officialServiceDate}</p>
        </div>

        <h3>Immediate Action Required</h3>
        <p>Pay the full outstanding amount immediately to prevent Tribunal proceedings.</p>

        <div style="font-size: 12px; color: #6b7280; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            <p>For information about your rights, visit <a href="https://www.tenancy.govt.nz" style="color: #2563eb;">tenancy.govt.nz</a></p>
        </div>
    </div>
</body>
</html>
    `.trim();
}

/**
 * Anti-Social Behaviour Notice HTML Template (S55A_SOCIAL)
 */
function generateSocialNoticeHtml(params: {
    tenantName: string;
    propertyAddress: string;
    strikeNumber: number;
    breachDescription: string;
    officialServiceDate: string;
}): string {
    const { tenantName, propertyAddress, strikeNumber, breachDescription, officialServiceDate } = params;

    return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Anti-Social Behaviour Notice</title></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #7c3aed; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 24px;">ANTI-SOCIAL BEHAVIOUR NOTICE</h1>
        <p style="margin: 10px 0 0 0; opacity: 0.9;">Strike ${strikeNumber} of 3</p>
        <p style="margin: 5px 0 0 0; font-size: 12px; opacity: 0.8;">Residential Tenancies Act 1986, Section 55A</p>
    </div>

    <div style="background: #f9fafb; padding: 25px; border: 1px solid #e5e7eb; border-top: none;">
        <p>Dear <strong>${tenantName}</strong>,</p>

        <p>This is a formal notice regarding anti-social behaviour at the property.</p>

        <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e5e7eb;">
            <p><strong>Property:</strong> ${propertyAddress}</p>
            <p><strong>Behaviour Description:</strong></p>
            <p style="background: #f3f4f6; padding: 15px; border-radius: 4px;">${breachDescription}</p>
            <p><strong>Official Service Date:</strong> ${officialServiceDate}</p>
        </div>

        <p>This notice counts as <strong>Strike ${strikeNumber} of 3</strong> toward potential termination under Section 55A.</p>

        <div style="font-size: 12px; color: #6b7280; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            <p>For information about your rights, visit <a href="https://www.tenancy.govt.nz" style="color: #2563eb;">tenancy.govt.nz</a></p>
        </div>
    </div>
</body>
</html>
    `.trim();
}

/**
 * 14-Day Remedy Notice HTML Template (S56_REMEDY)
 */
function generateRemedyNoticeHtml(params: {
    tenantName: string;
    propertyAddress: string;
    breachDescription: string;
    officialServiceDate: string;
    expiryDate: string;
}): string {
    const { tenantName, propertyAddress, breachDescription, officialServiceDate, expiryDate } = params;

    return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>14-Day Notice to Remedy</title></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #ea580c; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 24px;">14-DAY NOTICE TO REMEDY</h1>
        <p style="margin: 10px 0 0 0; opacity: 0.9;">Breach of Tenancy Agreement</p>
        <p style="margin: 5px 0 0 0; font-size: 12px; opacity: 0.8;">Residential Tenancies Act 1986, Section 56</p>
    </div>

    <div style="background: #f9fafb; padding: 25px; border: 1px solid #e5e7eb; border-top: none;">
        <p>Dear <strong>${tenantName}</strong>,</p>

        <p>You are required to remedy the following breach of your tenancy agreement within <strong>14 days</strong>.</p>

        <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e5e7eb;">
            <p><strong>Property:</strong> ${propertyAddress}</p>
            <p><strong>Breach Description:</strong></p>
            <p style="background: #fef3c7; padding: 15px; border-radius: 4px; border-left: 4px solid #f59e0b;">${breachDescription}</p>
        </div>

        <div style="background: #fef2f2; border-left: 4px solid #dc2626; padding: 15px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #991b1b;">Important Dates</h3>
            <p style="margin: 5px 0;"><strong>Official Service Date:</strong> ${officialServiceDate}</p>
            <p style="margin: 5px 0;"><strong>Remedy Deadline:</strong> ${expiryDate} <span style="color: #6b7280;">(by 11:59 PM)</span></p>
        </div>

        <p>If the breach is not remedied by 11:59 PM on the deadline, the landlord may apply to the Tenancy Tribunal.</p>

        <div style="font-size: 12px; color: #6b7280; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            <p>For information about your rights, visit <a href="https://www.tenancy.govt.nz" style="color: #2563eb;">tenancy.govt.nz</a></p>
        </div>
    </div>
</body>
</html>
    `.trim();
}

/**
 * Returns legal context information for the notice type
 */
function getLegalContext(noticeType: NoticeType, strikeNumber?: number) {
    switch (noticeType) {
        case "S55_STRIKE":
            return {
                citation: "Residential Tenancies Act 1986, Section 55(1)(aa)",
                requirement: "Rent must be 5 working days overdue for a strike notice.",
                nextStep: strikeNumber === 3
                    ? "Landlord may apply to Tenancy Tribunal within 28 days."
                    : `Await payment or issue Strike ${(strikeNumber || 0) + 1} if rent remains unpaid.`,
            };
        case "S55_21DAYS":
            return {
                citation: "Residential Tenancies Act 1986, Section 55(1)(a)",
                requirement: "Rent is 21+ calendar days in arrears.",
                nextStep: "Landlord may immediately apply to Tenancy Tribunal.",
            };
        case "S55A_SOCIAL":
            return {
                citation: "Residential Tenancies Act 1986, Section 55A",
                requirement: "Anti-social behaviour warranting formal notice.",
                nextStep: strikeNumber === 3
                    ? "Landlord may apply to Tenancy Tribunal within 28 days."
                    : "Monitor behaviour and document any further incidents.",
            };
        case "S56_REMEDY":
            return {
                citation: "Residential Tenancies Act 1986, Section 56",
                requirement: "General breach requiring 14-day remedy period.",
                nextStep: "Wait 14 days for remedy, then apply to Tribunal if unresolved.",
            };
        default:
            return {
                citation: "Residential Tenancies Act 1986",
                requirement: "Tenancy notice",
                nextStep: "Review notice requirements.",
            };
    }
}
