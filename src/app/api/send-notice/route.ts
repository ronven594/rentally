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
    addWorkingDays,
    type NoticeType,
} from "@/lib/legal-engine";
import { type NZRegion } from "@/lib/nz-holidays";
import { getNextWorkingDay, isNZWorkingDay, NZ_TIMEZONE } from "@/lib/date-utils";
import { toZonedTime } from "date-fns-tz";
import { startOfDay } from "date-fns";
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
    // Manual delivery options
    downloadOnly?: boolean;       // Generate PDF without saving record or sending email
    manualDelivery?: boolean;     // Save record without sending email
    deliveryMethod?: "hand" | "post" | "letterbox"; // For manual delivery OSD calculation
    // Test date override (ISO string) - uses this instead of real date for all calculations
    testDate?: string;
    // Field overrides from editable preview
    fieldOverrides?: Record<string, string>;
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
    /** Which specific rent due date this strike is for (RTA "separate occasion") */
    due_date_for: string | null;
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
        // Test mode: use test DATE but real TIME (so 5pm cutoff works correctly)
        let effectiveNow: Date;
        if (body.testDate) {
            const testD = new Date(body.testDate);
            const now = new Date();
            effectiveNow = new Date(
                testD.getFullYear(), testD.getMonth(), testD.getDate(),
                now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds()
            );
        } else {
            effectiveNow = new Date();
        }
        const sentTimestamp = effectiveNow.toISOString();
        const region = body.region || "Auckland";

        // Apply field overrides from editable preview
        const fo = body.fieldOverrides || {};
        const foNum = (key: string) => fo[key] ? parseFloat(fo[key]) : undefined;

        // Block duplicate strike for same due date (RTA Section 55(1)(aa) - separate occasions)
        if (body.noticeType === "S55_STRIKE" && body.rentDueDate) {
            const { data: existingStrike } = await supabaseAdmin
                .from("notices")
                .select("id")
                .eq("tenant_id", body.tenantId)
                .eq("is_strike", true)
                .eq("due_date_for", body.rentDueDate)
                .limit(1);

            if (existingStrike && existingStrike.length > 0) {
                return NextResponse.json(
                    { error: "A strike notice has already been issued for this rent due date. Each strike must be for a separate occasion (different due date) per RTA Section 55(1)(aa)." },
                    { status: 400 }
                );
            }
        }

        // Block same-day consecutive strikes
        if (body.noticeType === "S55_STRIKE" && body.strikeNumber && body.strikeNumber > 1) {
            const todayStr = format(new Date(), "yyyy-MM-dd");
            const { data: todayStrikes } = await supabaseAdmin
                .from("notices")
                .select("id")
                .eq("tenant_id", body.tenantId)
                .eq("is_strike", true)
                .gte("sent_at", `${todayStr}T00:00:00`)
                .lte("sent_at", `${todayStr}T23:59:59`)
                .limit(1);

            if (todayStrikes && todayStrikes.length > 0) {
                return NextResponse.json(
                    { error: "You must wait until tomorrow to send the next strike notice. Each strike must be on a separate day." },
                    { status: 400 }
                );
            }
        }

        // Handle downloadOnly mode: generate PDF and return it without saving or emailing
        if (body.downloadOnly) {
            if (body.noticeType !== "S55_STRIKE" && body.noticeType !== "S56_REMEDY") {
                return NextResponse.json(
                    { error: "PDF download only available for S55_STRIKE and S56_REMEDY notices" },
                    { status: 400 }
                );
            }

            const previewOSD = calculateOfficialServiceDate(sentTimestamp, region);
            const previewExpiry = body.noticeType === "S56_REMEDY"
                ? calculateRemedyExpiryDate(previewOSD) : undefined;

            // Look up previous strikes for PDF fields
            let dlPrevOSDs: string[] = [];
            if (body.noticeType === "S55_STRIKE" && body.strikeNumber && body.strikeNumber > 1) {
                const ninetyDaysAgo = format(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), "yyyy-MM-dd");
                const { data: prevStrikes } = await supabaseAdmin
                    .from("notices")
                    .select("official_service_date")
                    .eq("tenant_id", body.tenantId)
                    .eq("is_strike", true)
                    .gte("official_service_date", ninetyDaysAgo)
                    .order("official_service_date", { ascending: true });
                if (prevStrikes) {
                    dlPrevOSDs = prevStrikes.map(s => String(s.official_service_date).split("-").reverse().join("/"));
                }
            }

            // Calculate per-due-date unpaid for download preview
            let dlAmountUnpaid: number | undefined;
            if (body.noticeType === "S55_STRIKE" && body.rentDueDate) {
                const { data: dueDatePayments } = await supabaseAdmin
                    .from("payments")
                    .select("amount_paid")
                    .eq("tenant_id", body.tenantId)
                    .eq("due_date", body.rentDueDate);
                const paidForDueDate = dueDatePayments?.reduce((sum, p) => sum + (p.amount_paid || 0), 0) || 0;
                dlAmountUnpaid = (body.rentAmount || body.amountOwed || 0) - paidForDueDate;
                if (dlAmountUnpaid < 0) dlAmountUnpaid = 0;
            }

            // For remedy notices: query last payment and next rent due date
            let dlLastPaymentAmount: number | undefined;
            let dlLastPaymentDate: string | undefined;
            let dlNextRentDueDate: string | undefined;

            if (body.noticeType === "S56_REMEDY") {
                // Query payments with actual money applied (amount_paid > 0)
                const { data: paidPayments, error: payErr } = await supabaseAdmin
                    .from("payments")
                    .select("amount_paid, paid_date, due_date, status")
                    .eq("tenant_id", body.tenantId)
                    .gt("amount_paid", 0)
                    .order("due_date", { ascending: false })
                    .limit(1);

                console.log("=== DOWNLOADONLY REMEDY: Payment query ===");
                console.log("Tenant ID:", body.tenantId);
                console.log("Query error:", payErr?.message || "none");
                console.log("Paid payments:", JSON.stringify(paidPayments, null, 2));

                if (paidPayments && paidPayments.length > 0) {
                    const latest = paidPayments[0];
                    dlLastPaymentAmount = latest.amount_paid;
                    dlLastPaymentDate = latest.due_date; // Use due_date as the payment reference date
                    console.log("Last payment:", dlLastPaymentAmount, "for due date:", dlLastPaymentDate);
                }

                // Calculate next rent due date
                const { data: tenantData } = await supabaseAdmin
                    .from("tenants")
                    .select("frequency, rent_due_day, tracking_start_date")
                    .eq("id", body.tenantId)
                    .single();

                if (tenantData?.frequency && tenantData?.rent_due_day && tenantData?.tracking_start_date) {
                    const { findFirstDueDate, findNextDueDate } = await import("@/lib/date-utils");
                    const dueDateSettings = {
                        frequency: tenantData.frequency as "Weekly" | "Fortnightly" | "Monthly",
                        dueDay: tenantData.rent_due_day,
                    };
                    const trackStart = new Date(tenantData.tracking_start_date + "T12:00:00");
                    const firstDue = findFirstDueDate(trackStart, dueDateSettings);
                    const nextDue = findNextDueDate(effectiveNow, dueDateSettings, firstDue);
                    dlNextRentDueDate = format(nextDue, "yyyy-MM-dd");
                }
            }

            try {
                const pdfResult = await generateNoticePDF(body.noticeType, {
                    tenantName: fo.tenantName || body.tenantName,
                    tenantAddress: fo.tenantAddress || body.tenantAddress || body.propertyAddress,
                    propertyAddress: fo.propertyAddress || body.propertyAddress,
                    amountOwed: foNum("amountOwed") ?? body.amountOwed ?? 0,
                    rentAmount: foNum("rentAmount") ?? body.rentAmount,
                    amountUnpaidForDueDate: dlAmountUnpaid ?? body.rentAmount ?? body.amountOwed ?? 0,
                    rentDueDate: fo.rentDueDate || body.rentDueDate,
                    strikeNumber: body.strikeNumber as 1 | 2 | 3,
                    firstStrikeDate: dlPrevOSDs[0] || previewOSD.split("-").reverse().join("/"),
                    previousNotices: dlPrevOSDs.length > 0
                        ? dlPrevOSDs.map(d => ({ date: d }))
                        : body.previousNotices,
                    paymentDeadline: fo.paymentDeadline || previewExpiry,
                    lastPaymentAmount: foNum("lastPaymentAmount") ?? dlLastPaymentAmount,
                    lastPaymentDate: fo.lastPaymentDate || dlLastPaymentDate,
                    nextRentDueDate: fo.nextRentDueDate || dlNextRentDueDate,
                    landlordName: fo.landlordName || body.landlordName || "Landlord",
                    landlordPhone: fo.landlordPhone || body.landlordPhone,
                    landlordMobile: fo.landlordMobile || body.landlordMobile,
                    landlordEmail: fo.landlordEmail || body.landlordEmail,
                    landlordAddress: fo.landlordAddress || body.landlordAddress,
                    officialServiceDate: previewOSD,
                    testDate: body.testDate,
                });

                return new Response(Buffer.from(pdfResult.pdfBytes), {
                    headers: {
                        "Content-Type": "application/pdf",
                        "Content-Disposition": `attachment; filename="${pdfResult.filename}"`,
                    },
                });
            } catch (pdfError: any) {
                return NextResponse.json(
                    { error: "PDF generation failed", details: pdfError.message },
                    { status: 500 }
                );
            }
        }

        // Calculate Official Service Date based on delivery method
        let officialServiceDate: string;

        if (body.manualDelivery && body.deliveryMethod) {
            // Manual delivery: OSD depends on delivery method per RTA Section 136
            const nowNZ = toZonedTime(new Date(), NZ_TIMEZONE);
            const todayNZ = startOfDay(nowNZ);
            const hourNZ = nowNZ.getHours();

            switch (body.deliveryMethod) {
                case "hand": {
                    // Hand delivered: OSD = today if before 5 PM on working day, else next working day
                    if (hourNZ < 17 && isNZWorkingDay(todayNZ, region)) {
                        officialServiceDate = format(todayNZ, "yyyy-MM-dd");
                    } else {
                        officialServiceDate = format(getNextWorkingDay(todayNZ, region), "yyyy-MM-dd");
                    }
                    break;
                }
                case "letterbox": {
                    // Letterbox: OSD = today + 2 working days
                    const osd = addWorkingDays(todayNZ, 2, region);
                    officialServiceDate = format(osd, "yyyy-MM-dd");
                    break;
                }
                case "post": {
                    // Posted: OSD = today + 4 working days
                    const osd = addWorkingDays(todayNZ, 4, region);
                    officialServiceDate = format(osd, "yyyy-MM-dd");
                    break;
                }
                default:
                    officialServiceDate = calculateOfficialServiceDate(sentTimestamp, region);
            }
        } else {
            // Email delivery: standard 5 PM rule
            officialServiceDate = calculateOfficialServiceDate(sentTimestamp, region);
        }

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

        // Step 2a: Calculate per-due-date unpaid amount (for strike notices)
        let amountUnpaidForDueDate: number | undefined;
        if (isStrike && body.rentDueDate) {
            const { data: dueDatePayments } = await supabaseAdmin
                .from("payments")
                .select("amount_paid")
                .eq("tenant_id", body.tenantId)
                .eq("due_date", body.rentDueDate);

            const paidForDueDate = dueDatePayments?.reduce((sum, p) => sum + (p.amount_paid || 0), 0) || 0;
            amountUnpaidForDueDate = (body.rentAmount || body.amountOwed || 0) - paidForDueDate;
            if (amountUnpaidForDueDate < 0) amountUnpaidForDueDate = 0;
        }

        // Step 2b: Look up previous strikes from DB (authoritative source for PDF fields)
        let previousStrikeOSDs: string[] = [];
        let previousStrikeFilePaths: string[] = [];
        if (isStrike && body.strikeNumber && body.strikeNumber > 1) {
            const ninetyDaysAgo = format(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), "yyyy-MM-dd");
            const { data: prevStrikes } = await supabaseAdmin
                .from("notices")
                .select("official_service_date, file_path, strike_number")
                .eq("tenant_id", body.tenantId)
                .eq("is_strike", true)
                .gte("official_service_date", ninetyDaysAgo)
                .order("official_service_date", { ascending: true });

            if (prevStrikes) {
                previousStrikeOSDs = prevStrikes.map(s => {
                    const d = String(s.official_service_date); // yyyy-MM-dd from DB
                    return d.split("-").reverse().join("/");
                });
                previousStrikeFilePaths = prevStrikes
                    .map(s => s.file_path)
                    .filter((p): p is string => !!p);
            }
        }

        // Step 2c: For remedy notices, look up last payment and next rent due date
        let lastPaymentAmount: number | undefined;
        let lastPaymentDate: string | undefined;
        let nextRentDueDate: string | undefined;

        if (body.noticeType === "S56_REMEDY") {
            // Query payments with actual money applied (amount_paid > 0)
            const { data: paidPayments, error: payErr } = await supabaseAdmin
                .from("payments")
                .select("amount_paid, paid_date, due_date, status")
                .eq("tenant_id", body.tenantId)
                .gt("amount_paid", 0)
                .order("due_date", { ascending: false })
                .limit(1);

            console.log("=== REMEDY NOTICE: Payment query ===");
            console.log("Tenant ID:", body.tenantId);
            console.log("Query error:", payErr?.message || "none");
            console.log("Paid payments:", JSON.stringify(paidPayments, null, 2));

            if (paidPayments && paidPayments.length > 0) {
                const latest = paidPayments[0];
                lastPaymentAmount = latest.amount_paid;
                lastPaymentDate = latest.due_date; // Use due_date as the payment reference date
                console.log("Last payment:", lastPaymentAmount, "for due date:", lastPaymentDate);
            }

            const { data: tenantData } = await supabaseAdmin
                .from("tenants")
                .select("frequency, rent_due_day, tracking_start_date")
                .eq("id", body.tenantId)
                .single();

            // Calculate next rent due date after the notice date
            if (tenantData?.frequency && tenantData?.rent_due_day && tenantData?.tracking_start_date) {
                const { findFirstDueDate, findNextDueDate } = await import("@/lib/date-utils");
                const dueDateSettings = {
                    frequency: tenantData.frequency as "Weekly" | "Fortnightly" | "Monthly",
                    dueDay: tenantData.rent_due_day,
                };
                const trackStart = new Date(tenantData.tracking_start_date + "T12:00:00");
                const firstDue = findFirstDueDate(trackStart, dueDateSettings);
                const nextDue = findNextDueDate(effectiveNow, dueDateSettings, firstDue);
                nextRentDueDate = format(nextDue, "yyyy-MM-dd");
            }
        }

        // Step 2d: Build debt snapshot for remedy notices (captures SPECIFIC debt at time of notice)
        let debtSnapshot: {
            ledger_entry_ids: string[];
            due_dates: string[];
            total_amount_owed: number;
            unpaid_amounts: Record<string, number>;
        } | null = null;

        if (body.noticeType === "S56_REMEDY") {
            const { data: unpaidEntries } = await supabaseAdmin
                .from("payments")
                .select("id, due_date, amount, amount_paid, status")
                .eq("tenant_id", body.tenantId)
                .in("status", ["Unpaid", "Partial"]);

            debtSnapshot = {
                ledger_entry_ids: unpaidEntries?.map(e => e.id) || [],
                due_dates: unpaidEntries?.map(e => e.due_date) || [],
                total_amount_owed: unpaidEntries?.reduce((sum, e) => {
                    const unpaid = e.amount - (e.amount_paid || 0);
                    return sum + unpaid;
                }, 0) || 0,
                unpaid_amounts: Object.fromEntries(
                    unpaidEntries?.map(e => [
                        e.due_date,
                        e.amount - (e.amount_paid || 0)
                    ]) || []
                ),
            };
        }

        // Step 2e: Generate PDF notice using official templates
        let pdfData: { pdfBytes: Uint8Array; filename: string } | null = null;

        if (body.noticeType === "S55_STRIKE" || body.noticeType === "S56_REMEDY") {
            try {
                pdfData = await generateNoticePDF(
                    body.noticeType,
                    {
                        tenantName: fo.tenantName || body.tenantName,
                        tenantAddress: fo.tenantAddress || body.tenantAddress || body.propertyAddress,
                        propertyAddress: fo.propertyAddress || body.propertyAddress,
                        amountOwed: foNum("amountOwed") ?? body.amountOwed ?? 0,
                        rentAmount: foNum("rentAmount") ?? body.rentAmount,
                        amountUnpaidForDueDate: amountUnpaidForDueDate ?? body.rentAmount ?? body.amountOwed ?? 0,
                        rentDueDate: fo.rentDueDate || body.rentDueDate,
                        strikeNumber: body.strikeNumber as 1 | 2 | 3,
                        firstStrikeDate: previousStrikeOSDs[0] || officialServiceDate.split("-").reverse().join("/"),
                        previousNotices: previousStrikeOSDs.length > 0
                            ? previousStrikeOSDs.map(d => ({ date: d }))
                            : body.previousNotices,
                        paymentDeadline: fo.paymentDeadline || expiryDate || undefined,
                        lastPaymentAmount: foNum("lastPaymentAmount") ?? lastPaymentAmount,
                        lastPaymentDate: fo.lastPaymentDate || lastPaymentDate,
                        nextRentDueDate: fo.nextRentDueDate || nextRentDueDate,
                        landlordName: fo.landlordName || body.landlordName || "Landlord",
                        landlordPhone: fo.landlordPhone || body.landlordPhone,
                        landlordMobile: fo.landlordMobile || body.landlordMobile,
                        landlordEmail: fo.landlordEmail || body.landlordEmail,
                        landlordAddress: fo.landlordAddress || body.landlordAddress,
                        officialServiceDate,
                        testDate: body.testDate,
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
            due_date_for: isStrike ? (body.rentDueDate || null) : null,
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
                ...(body.noticeType === "S56_REMEDY" && debtSnapshot ? {
                    ledger_entry_ids: debtSnapshot.ledger_entry_ids,
                    due_dates: debtSnapshot.due_dates,
                    total_amount_owed: debtSnapshot.total_amount_owed,
                    unpaid_amounts: debtSnapshot.unpaid_amounts,
                } : {}),
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
            console.error("Notice record attempted:", JSON.stringify(noticeRecord, null, 2));
            return NextResponse.json(
                { error: "Failed to save notice to database", details: dbError.message, code: dbError.code, hint: dbError.hint },
                { status: 500 }
            );
        }

        // Step 7: Send email or mark as manually delivered
        let emailResult: { success: boolean; id?: string; error?: any };
        let emailSentAt: string | null = null;

        if (body.manualDelivery) {
            // Manual delivery: skip email, mark as sent immediately
            emailResult = { success: true, id: `manual_${body.deliveryMethod}` };

            const { error: updateError } = await supabaseAdmin
                .from("notices")
                .update({
                    email_sent: false,
                    email_sent_at: null,
                    email_id: null,
                    status: "sent",
                    metadata: {
                        ...noticeRecord.metadata,
                        deliveryMethod: body.deliveryMethod,
                        manualDelivery: true,
                    },
                })
                .eq("id", savedNotice.id);

            if (updateError) {
                console.error("Failed to update notice status:", updateError);
            }
        } else {
            // Email delivery
            if (pdfData) {
                // Fetch previous strike PDFs from storage for Strike 2/3
                const previousPdfAttachments: { filename: string; content: Buffer; contentType: string }[] = [];
                if (isStrike && body.strikeNumber && body.strikeNumber > 1 && previousStrikeFilePaths.length > 0) {
                    for (const filePath of previousStrikeFilePaths) {
                        try {
                            const { data: fileData, error: dlError } = await supabaseAdmin.storage
                                .from("notices")
                                .download(filePath);
                            if (fileData && !dlError) {
                                const buf = Buffer.from(await fileData.arrayBuffer());
                                const name = filePath.split("/").pop() || `previous_notice.pdf`;
                                previousPdfAttachments.push({
                                    filename: name,
                                    content: buf,
                                    contentType: "application/pdf",
                                });
                            }
                        } catch {
                            console.error("Failed to download previous strike PDF:", filePath);
                        }
                    }
                }

                emailResult = await sendNoticeEmailWithAttachment(
                    body.tenantEmail,
                    emailContent.subject,
                    emailContent.html,
                    {
                        filename: pdfData.filename,
                        content: Buffer.from(pdfData.pdfBytes),
                        contentType: "application/pdf",
                    },
                    previousPdfAttachments.length > 0 ? previousPdfAttachments : undefined
                );
            } else {
                const { sendNoticeEmail } = await import("@/lib/mail");
                emailResult = await sendNoticeEmail(
                    body.tenantEmail,
                    emailContent.subject,
                    emailContent.html
                );
            }

            // Step 8: Update notice with email delivery status
            emailSentAt = new Date().toISOString();
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
        }

        // Step 9: Update tenant record with notice info for client-side status calculation
        if (isStrike && body.strikeNumber) {
            try {
                // Fetch current sent_notices from tenant
                const { data: tenantData } = await supabaseAdmin
                    .from("tenants")
                    .select("sent_notices, remedy_notice_sent_at")
                    .eq("id", body.tenantId)
                    .single();

                const currentNotices = tenantData?.sent_notices || [];
                const strikeTypeMap: Record<number, string> = { 1: "STRIKE_1", 2: "STRIKE_2", 3: "STRIKE_3" };
                const newNotice = {
                    id: savedNotice.id,
                    type: strikeTypeMap[body.strikeNumber] || "STRIKE_1",
                    sentAt: sentTimestamp.split("T")[0],
                    officialServiceDate,
                    dueDateFor: body.rentDueDate || null,
                };

                await supabaseAdmin
                    .from("tenants")
                    .update({ sent_notices: [...currentNotices, newNotice] })
                    .eq("id", body.tenantId);
            } catch (syncErr) {
                console.error("Failed to sync sent_notices to tenant record:", syncErr);
                // Non-fatal: the notices table is the source of truth
            }
        }

        if (body.noticeType === "S56_REMEDY") {
            try {
                await supabaseAdmin
                    .from("tenants")
                    .update({ remedy_notice_sent_at: sentTimestamp.split("T")[0] })
                    .eq("id", body.tenantId);
            } catch (syncErr) {
                console.error("Failed to sync remedy_notice_sent_at:", syncErr);
            }
        }

        // Step 10: Return response
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
