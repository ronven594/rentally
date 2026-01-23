/**
 * PDF Notice Generator
 *
 * Uses pdf-lib to load official NZ Tenancy Services PDF templates
 * and overlay tenant data at the correct positions.
 *
 * Templates:
 * - notice-of-overdue-rent.pdf (S55 Strike Notice)
 * - 14-day-Notice-to-remedy-rent-arrears-handwritten-letter-template.pdf (S56 Remedy Notice)
 */

import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { readFile } from "fs/promises";
import path from "path";
import { format } from "date-fns";

// Template paths
const TEMPLATES_DIR = path.join(process.cwd(), "_templates");
const STRIKE_NOTICE_TEMPLATE = "notice-of-overdue-rent.pdf";
const REMEDY_NOTICE_TEMPLATE = "14-day-Notice-to-remedy-rent-arrears-handwritten-letter-template.pdf";

// Text styling
const TEXT_COLOR = rgb(0, 0, 0); // Black
const FONT_SIZE = 11;
const SMALL_FONT_SIZE = 10;

interface StrikeNoticeData {
    date: string; // Notice date
    tenantName: string;
    tenantAddress: string;
    propertyAddress: string;
    rentDueDate: string;
    rentAmount: number;
    amountOwed: number;
    strikeNumber: 1 | 2 | 3;
    firstStrikeDate?: string; // Date of first strike (for 90-day window)
    previousNotices?: { date: string }[]; // Previous strike notice dates
    landlordName: string;
    landlordPhone?: string;
    landlordMobile?: string;
    landlordEmail?: string;
    landlordAddress?: string;
    deliveryDate: string;
    deliveryMethod: "email_before_5pm" | "email_after_5pm" | "mail" | "letterbox" | "hand_delivered";
}

interface RemedyNoticeData {
    date: string;
    tenantName: string;
    tenantAddress: string;
    propertyAddress: string;
    amountOwed: number;
    lastPaymentAmount?: number;
    lastPaymentDate?: string;
    paymentDeadline: string; // The 14-day expiry date
    nextRentDueDate?: string;
    landlordName: string;
    landlordPhone?: string;
    landlordEmail?: string;
    deliveryDate: string;
    deliveryMethod: "email_before_5pm" | "email_after_5pm" | "mail" | "letterbox" | "hand_delivered";
}

/**
 * Generates a Strike Notice PDF (S55) with tenant data overlaid on the template
 */
export async function generateStrikeNoticePDF(data: StrikeNoticeData): Promise<Uint8Array> {
    // Load the template
    const templatePath = path.join(TEMPLATES_DIR, STRIKE_NOTICE_TEMPLATE);
    const templateBytes = await readFile(templatePath);
    const pdfDoc = await PDFDocument.load(templateBytes);

    // Get the first page
    const pages = pdfDoc.getPages();
    const page1 = pages[0];
    const page2 = pages.length > 1 ? pages[1] : null;

    // Embed font
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Page dimensions (A4)
    const { height } = page1.getSize();

    // Helper to draw text at specific coordinates
    // Note: PDF coordinates start from bottom-left, so we use (height - y) for top-down positioning
    const drawText = (page: typeof page1, text: string, x: number, y: number, options?: { size?: number; bold?: boolean }) => {
        page.drawText(text, {
            x,
            y: height - y,
            size: options?.size || FONT_SIZE,
            font: options?.bold ? boldFont : font,
            color: TEXT_COLOR,
        });
    };

    // === PAGE 1: Main Notice Content ===

    // Date field (top of form)
    drawText(page1, data.date, 75, 107);

    // Tenant name (Dear [tenant])
    drawText(page1, data.tenantName, 165, 130);

    // Tenancy address
    drawText(page1, data.propertyAddress, 175, 152);

    // Rent due date (This notice is to advise you that on [date])
    drawText(page1, data.rentDueDate, 245, 175);

    // Rent amount (your regular rent of $[amount] was due)
    drawText(page1, data.rentAmount.toFixed(2), 445, 175);

    // Amount owed (The amount of rent... that has remained unpaid is $[amount])
    drawText(page1, data.amountOwed.toFixed(2), 52, 248);

    // Strike number (first, second, or third)
    const strikeText = data.strikeNumber === 1 ? "first" : data.strikeNumber === 2 ? "second" : "third";
    drawText(page1, strikeText, 190, 270);

    // 90-day period start date
    if (data.firstStrikeDate) {
        drawText(page1, data.firstStrikeDate, 105, 295);
    }

    // Previous notices section (if applicable)
    if (data.previousNotices && data.previousNotices.length > 0) {
        // First notice date
        if (data.previousNotices[0]) {
            drawText(page1, data.previousNotices[0].date, 115, 380);
        }
        // Second notice date
        if (data.previousNotices[1]) {
            drawText(page1, data.previousNotices[1].date, 120, 402);
        }
    }

    // Third strike checkbox (tick if this is the third strike)
    if (data.strikeNumber === 3) {
        // Draw a checkmark in the checkbox area
        drawText(page1, "✓", 55, 465, { size: 14, bold: true });
    }

    // === PAGE 2: Contact Details and Delivery ===
    if (page2) {
        const { height: h2 } = page2.getSize();
        const drawText2 = (text: string, x: number, y: number, options?: { size?: number; bold?: boolean }) => {
            page2.drawText(text, {
                x,
                y: h2 - y,
                size: options?.size || FONT_SIZE,
                font: options?.bold ? boldFont : font,
                color: TEXT_COLOR,
            });
        };

        // Contact details
        if (data.landlordPhone) {
            drawText2(data.landlordPhone, 80, 52);
        }
        if (data.landlordMobile) {
            drawText2(data.landlordMobile, 420, 52);
        }
        if (data.landlordEmail) {
            drawText2(data.landlordEmail, 80, 75);
        }
        if (data.landlordAddress) {
            drawText2(data.landlordAddress, 80, 98);
        }

        // Landlord name (Yours sincerely)
        drawText2(data.landlordName, 55, 142);

        // Delivery date
        drawText2(data.deliveryDate, 110, 197);

        // Delivery method checkboxes
        const checkmarkY = {
            mail: 230,
            letterbox: 250,
            email_after_5pm: 280,
            email_before_5pm: 310,
            hand_delivered: 310,
        };

        // Draw checkmark for selected delivery method
        const methodY = checkmarkY[data.deliveryMethod];
        if (methodY) {
            drawText2("✓", 55, methodY, { size: 14, bold: true });
        }
    }

    // Save and return the modified PDF
    const pdfBytes = await pdfDoc.save();
    return pdfBytes;
}

/**
 * Generates a 14-Day Remedy Notice PDF (S56) with tenant data overlaid
 */
export async function generateRemedyNoticePDF(data: RemedyNoticeData): Promise<Uint8Array> {
    // Load the template
    const templatePath = path.join(TEMPLATES_DIR, REMEDY_NOTICE_TEMPLATE);
    const templateBytes = await readFile(templatePath);
    const pdfDoc = await PDFDocument.load(templateBytes);

    // Get the first page
    const pages = pdfDoc.getPages();
    const page1 = pages[0];

    // Embed font
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const { height } = page1.getSize();

    const drawText = (text: string, x: number, y: number, options?: { size?: number; bold?: boolean }) => {
        page1.drawText(text, {
            x,
            y: height - y,
            size: options?.size || FONT_SIZE,
            font: options?.bold ? boldFont : font,
            color: TEXT_COLOR,
        });
    };

    // Date
    drawText(data.date, 70, 52);

    // Tenant name and address
    drawText(data.tenantName, 110, 75);
    drawText(data.tenantAddress, 115, 90);

    // Dear [tenant name]
    drawText(data.tenantName, 70, 118);

    // Tenancy at: [property address]
    drawText(data.propertyAddress, 100, 138);

    // Amount owed (Your rent is behind by $[amount])
    drawText(data.amountOwed.toFixed(2), 175, 162);

    // Last payment amount and date
    if (data.lastPaymentAmount !== undefined) {
        drawText(data.lastPaymentAmount.toFixed(2), 205, 182);
    }
    if (data.lastPaymentDate) {
        drawText(data.lastPaymentDate, 330, 182);
    }

    // Payment deadline (Please pay $[amount] by [date])
    drawText(data.amountOwed.toFixed(2), 105, 205);
    drawText(data.paymentDeadline, 215, 205);

    // Next rent due date
    if (data.nextRentDueDate) {
        drawText(data.nextRentDueDate, 265, 228);
    }

    // Contact details
    if (data.landlordPhone) {
        drawText(data.landlordPhone, 160, 250);
    }
    if (data.landlordEmail) {
        drawText(data.landlordEmail, 330, 250);
    }

    // Landlord name
    drawText(data.landlordName, 55, 330);

    // Delivery date (format: DD/MM/YYYY)
    const [day, month, year] = data.deliveryDate.split("/");
    if (day && month && year) {
        drawText(day, 70, 378);
        drawText(month, 95, 378);
        drawText(year, 115, 378);
    } else {
        drawText(data.deliveryDate, 70, 378);
    }

    // Delivery method checkboxes
    const checkmarkPositions = {
        mail: 408,
        letterbox: 428,
        email_after_5pm: 460,
        email_before_5pm: 490,
        hand_delivered: 490,
    };

    const methodY = checkmarkPositions[data.deliveryMethod];
    if (methodY) {
        drawText("✓", 55, methodY, { size: 14, bold: true });
    }

    const pdfBytes = await pdfDoc.save();
    return pdfBytes;
}

/**
 * Generates the appropriate notice PDF based on notice type
 */
export async function generateNoticePDF(
    noticeType: "S55_STRIKE" | "S56_REMEDY",
    data: {
        tenantName: string;
        tenantAddress: string;
        propertyAddress: string;
        amountOwed: number;
        rentAmount?: number;
        rentDueDate?: string;
        strikeNumber?: 1 | 2 | 3;
        firstStrikeDate?: string;
        previousNotices?: { date: string }[];
        paymentDeadline?: string;
        lastPaymentAmount?: number;
        lastPaymentDate?: string;
        nextRentDueDate?: string;
        landlordName: string;
        landlordPhone?: string;
        landlordMobile?: string;
        landlordEmail?: string;
        landlordAddress?: string;
        officialServiceDate: string;
    }
): Promise<{ pdfBytes: Uint8Array; filename: string }> {
    const today = format(new Date(), "dd/MM/yyyy");
    const deliveryDate = format(new Date(), "dd/MM/yyyy");

    if (noticeType === "S55_STRIKE") {
        const strikeData: StrikeNoticeData = {
            date: today,
            tenantName: data.tenantName,
            tenantAddress: data.tenantAddress,
            propertyAddress: data.propertyAddress,
            rentDueDate: data.rentDueDate || today,
            rentAmount: data.rentAmount || data.amountOwed,
            amountOwed: data.amountOwed,
            strikeNumber: data.strikeNumber || 1,
            firstStrikeDate: data.firstStrikeDate,
            previousNotices: data.previousNotices,
            landlordName: data.landlordName,
            landlordPhone: data.landlordPhone,
            landlordMobile: data.landlordMobile,
            landlordEmail: data.landlordEmail,
            landlordAddress: data.landlordAddress,
            deliveryDate,
            deliveryMethod: "email_before_5pm", // Default for email delivery
        };

        const pdfBytes = await generateStrikeNoticePDF(strikeData);
        return {
            pdfBytes,
            filename: `Strike_${data.strikeNumber || 1}_Notice_${data.tenantName.replace(/\s+/g, "_")}_${format(new Date(), "yyyy-MM-dd")}.pdf`,
        };
    } else {
        const remedyData: RemedyNoticeData = {
            date: today,
            tenantName: data.tenantName,
            tenantAddress: data.tenantAddress,
            propertyAddress: data.propertyAddress,
            amountOwed: data.amountOwed,
            lastPaymentAmount: data.lastPaymentAmount,
            lastPaymentDate: data.lastPaymentDate,
            paymentDeadline: data.paymentDeadline || data.officialServiceDate,
            nextRentDueDate: data.nextRentDueDate,
            landlordName: data.landlordName,
            landlordPhone: data.landlordPhone,
            landlordEmail: data.landlordEmail,
            deliveryDate,
            deliveryMethod: "email_before_5pm",
        };

        const pdfBytes = await generateRemedyNoticePDF(remedyData);
        return {
            pdfBytes,
            filename: `14_Day_Remedy_Notice_${data.tenantName.replace(/\s+/g, "_")}_${format(new Date(), "yyyy-MM-dd")}.pdf`,
        };
    }
}

/**
 * Converts PDF bytes to base64 for email attachment
 */
export function pdfToBase64(pdfBytes: Uint8Array): string {
    return Buffer.from(pdfBytes).toString("base64");
}
