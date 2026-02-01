/**
 * PDF Notice Generator
 *
 * Uses pdf-lib to load official NZ Tenancy Services PDF templates
 * and fill their form fields programmatically.
 *
 * Templates:
 * - notice-of-overdue-rent.pdf (S55 Strike Notice) — 22 form fields
 * - 14-day-Notice-to-remedy-rent-arrears-handwritten-letter-template.pdf (S56 Remedy Notice) — 21 form fields
 */

import { PDFDocument, PDFFont, rgb, StandardFonts } from "pdf-lib";
import { readFile } from "fs/promises";
import path from "path";
import { format } from "date-fns";

/**
 * Calculate the largest font size that fits text within a given width.
 * Steps down by 0.5pt until it fits, with a minimum floor.
 */
function fontSizeToFit(
    text: string,
    font: PDFFont,
    maxWidth: number,
    maxSize: number = 10,
    minSize: number = 4,
): number {
    let size = maxSize;
    while (size > minSize) {
        if (font.widthOfTextAtSize(text, size) <= maxWidth) return size;
        size -= 0.5;
    }
    return minSize;
}

// Template paths
const TEMPLATES_DIR = path.join(process.cwd(), "_templates");
const STRIKE_NOTICE_TEMPLATE = "notice-of-overdue-rent.pdf";
const REMEDY_NOTICE_TEMPLATE = "14-day-Notice-to-remedy-rent-arrears-handwritten-letter-template.pdf";

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
 * Generates a Strike Notice PDF (S55) by filling template form fields
 *
 * Field mapping (from labeled template inspection):
 *   Page 1: Text01=Date, Text02=Tenant name, Text03=Tenancy address,
 *           Text04=Rent due date, Text05=Rent amount, Text06=Amount owed,
 *           Text07=first/second/third, Text08=90-day start date,
 *           Text09=First notice date, Text10=Second notice date,
 *           Text11="first" or "first and second",
 *           Check Box05=Third strike tick
 *   Page 2: Text12=Phone, Text13=Mobile, Text14=Email, Text15=Address,
 *           Text16=Landlord name, Text20=Delivery date,
 *           Check Box01=mail, Check Box02=letterbox,
 *           Check Box03=email after 5pm, Check Box04=hand/email before 5pm
 */
export async function generateStrikeNoticePDF(data: StrikeNoticeData): Promise<Uint8Array> {
    const templatePath = path.join(TEMPLATES_DIR, STRIKE_NOTICE_TEMPLATE);
    const templateBytes = await readFile(templatePath);
    const pdfDoc = await PDFDocument.load(templateBytes);
    const form = pdfDoc.getForm();

    // Page 1 fields
    form.getTextField("Text01").setText(data.date);
    form.getTextField("Text02").setText(data.tenantName);
    form.getTextField("Text03").setText(data.propertyAddress);
    form.getTextField("Text04").setText(data.rentDueDate);
    form.getTextField("Text05").setText(data.rentAmount.toFixed(2));
    form.getTextField("Text06").setText(data.amountOwed.toFixed(2));

    const strikeText = data.strikeNumber === 1 ? "first" : data.strikeNumber === 2 ? "second" : "third";
    form.getTextField("Text07").setText(strikeText);

    if (data.firstStrikeDate) {
        form.getTextField("Text08").setText(data.firstStrikeDate);
    }

    // Previous notices - Strike 1 gets "N/A" since there are no previous notices
    if (data.strikeNumber === 1) {
        form.getTextField("Text09").setText("N/A");
        form.getTextField("Text10").setText("N/A");
        form.getTextField("Text11").setText("N/A");
    } else {
        if (data.previousNotices && data.previousNotices.length > 0) {
            if (data.previousNotices[0]) {
                form.getTextField("Text09").setText(data.previousNotices[0].date);
            }
            if (data.previousNotices[1]) {
                form.getTextField("Text10").setText(data.previousNotices[1].date);
            }
        }

        // "I enclose a copy of the [first / first and second] notice"
        if (data.strikeNumber === 2) {
            form.getTextField("Text11").setText("first");
        } else if (data.strikeNumber === 3) {
            form.getTextField("Text11").setText("first and second");
        }
    }

    // Embed font for auto-sizing and N/A drawing
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // "Tick if applicable" checkbox for third strike declaration
    // AUDIT: Check Box01 is on Page 0 (y=142.6) = third-strike tick
    if (data.strikeNumber === 3) {
        form.getCheckBox("Check Box01").check();
    } else {
        // Draw "N/A" on page 0 near Check Box01 for Strike 1/2
        const cb1 = form.getCheckBox("Check Box01");
        const cb1Widget = cb1.acroField.getWidgets()[0];
        if (cb1Widget) {
            const rect = cb1Widget.getRectangle();
            const page0 = pdfDoc.getPages()[0];
            page0.drawText("N/A", {
                x: rect.x + 2,
                y: rect.y + 2,
                size: 9,
                font: helvetica,
                color: rgb(0.3, 0.3, 0.3),
            });
        }
    }

    // Page 2 fields
    if (data.landlordPhone) {
        form.getTextField("Text12").setText(data.landlordPhone);
    }
    if (data.landlordMobile) {
        form.getTextField("Text13").setText(data.landlordMobile);
    }
    if (data.landlordEmail) {
        const emailField = form.getTextField("Text14");
        // AUDIT: Text14 width = 417.5pt — auto-fit font size
        emailField.setFontSize(fontSizeToFit(data.landlordEmail, helvetica, 410));
        emailField.setText(data.landlordEmail);
    }
    if (data.landlordAddress) {
        const addrField = form.getTextField("Text15");
        // AUDIT: Text15 width = 417.5pt
        addrField.setFontSize(fontSizeToFit(data.landlordAddress, helvetica, 410));
        addrField.setText(data.landlordAddress);
    }
    form.getTextField("Text16").setText(data.landlordName);
    form.getTextField("Text20").setText(data.deliveryDate);

    // Delivery method checkboxes (all on Page 1)
    // AUDIT: CB02=mail(y=447), CB03=letterbox(y=423), CB04=email after 5pm(y=396), CB05=email before 5pm/hand(y=365)
    const deliveryCheckboxMap: Record<string, string> = {
        mail: "Check Box02",
        letterbox: "Check Box03",
        email_after_5pm: "Check Box04",
        email_before_5pm: "Check Box05",
        hand_delivered: "Check Box05",
    };
    const checkboxName = deliveryCheckboxMap[data.deliveryMethod];
    if (checkboxName) {
        form.getCheckBox(checkboxName).check();
    }

    // Flatten so fields render as static text in all viewers
    form.flatten();

    const pdfBytes = await pdfDoc.save();
    return pdfBytes;
}

/**
 * Generates a 14-Day Remedy Notice PDF (S56) by filling template form fields
 *
 * Field mapping (from labeled template inspection):
 *   Text01=Date, Text02=Tenant name, Text03=Tenant address,
 *   Text04=Dear [name], Text05=Tenancy at [address],
 *   Text05a=Amount owed, Text06=Last payment amount, Text07=Last payment date,
 *   Text08=Total to pay, Text09=Payment deadline, Text10=Next rent due date,
 *   Text11=Phone, Text12=Email, Text13=Landlord name,
 *   Text19=Delivery day, Text20=Delivery month, Text21=Delivery year,
 *   Check Box01=mail, Check Box02=letterbox,
 *   Check Box03=email after 5pm, Check Box04=hand/email before 5pm
 */
export async function generateRemedyNoticePDF(data: RemedyNoticeData): Promise<Uint8Array> {
    const templatePath = path.join(TEMPLATES_DIR, REMEDY_NOTICE_TEMPLATE);
    const templateBytes = await readFile(templatePath);
    const pdfDoc = await PDFDocument.load(templateBytes);
    const form = pdfDoc.getForm();

    form.getTextField("Text01").setText(data.date);
    form.getTextField("Text02").setText(data.tenantName);
    form.getTextField("Text03").setText(data.tenantAddress);
    form.getTextField("Text04").setText(data.tenantName);
    form.getTextField("Text05").setText(data.propertyAddress);
    form.getTextField("Text05a").setText(data.amountOwed.toFixed(2));

    if (data.lastPaymentAmount !== undefined && data.lastPaymentAmount > 0) {
        form.getTextField("Text06").setText(data.lastPaymentAmount.toFixed(2));
    } else {
        form.getTextField("Text06").setText("N/A");
    }
    if (data.lastPaymentDate) {
        form.getTextField("Text07").setText(data.lastPaymentDate);
    } else {
        form.getTextField("Text07").setText("N/A");
    }

    form.getTextField("Text08").setText(data.amountOwed.toFixed(2));
    form.getTextField("Text09").setText(data.paymentDeadline);

    if (data.nextRentDueDate) {
        form.getTextField("Text10").setText(data.nextRentDueDate);
    }

    // Embed font for auto-sizing
    const helveticaR = await pdfDoc.embedFont(StandardFonts.Helvetica);

    if (data.landlordPhone) {
        // AUDIT: Text11 width = 123.8pt
        const phoneField = form.getTextField("Text11");
        phoneField.setFontSize(fontSizeToFit(data.landlordPhone, helveticaR, 120));
        phoneField.setText(data.landlordPhone);
    }
    if (data.landlordEmail) {
        // AUDIT: Text12 width = 86.8pt — narrow field, needs aggressive auto-fit
        const emailField = form.getTextField("Text12");
        emailField.setFontSize(fontSizeToFit(data.landlordEmail, helveticaR, 83));
        emailField.setText(data.landlordEmail);
    }
    form.getTextField("Text13").setText(data.landlordName);

    // Delivery date split into DD / MM / YYYY
    const [day, month, year] = data.deliveryDate.split("/");
    if (day && month && year) {
        form.getTextField("Text19").setText(day);
        form.getTextField("Text20").setText(month);
        form.getTextField("Text21").setText(year);
    } else {
        form.getTextField("Text19").setText(data.deliveryDate);
    }

    // Delivery method checkboxes
    const deliveryCheckboxMap: Record<string, string> = {
        mail: "Check Box01",
        letterbox: "Check Box02",
        email_after_5pm: "Check Box03",
        email_before_5pm: "Check Box04",
        hand_delivered: "Check Box04",
    };
    const checkboxName = deliveryCheckboxMap[data.deliveryMethod];
    if (checkboxName) {
        form.getCheckBox(checkboxName).check();
    }

    form.flatten();

    const pdfBytes = await pdfDoc.save();
    return pdfBytes;
}

/**
 * Generates the appropriate notice PDF based on notice type
 */
/** Convert yyyy-MM-dd to dd/MM/yyyy (no timezone issues) */
function toNZDateStatic(isoDate: string | undefined): string | undefined {
    if (!isoDate) return undefined;
    if (isoDate.includes("/")) return isoDate;
    const parts = isoDate.split("-");
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return isoDate;
}

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
        /** Per-due-date unpaid amount for strikes (rent for that specific due date minus partial payments) */
        amountUnpaidForDueDate?: number;
        testDate?: string; // ISO string override for all date fields
    }
): Promise<{ pdfBytes: Uint8Array; filename: string }> {
    // CRITICAL: If testDate is ISO from NZ timezone, new Date() shifts day backwards
    // (e.g. Feb 13 00:00 NZDT → Feb 12 11:00 UTC). Parse date portion only.
    let effectiveNow: Date;
    if (data.testDate) {
        const dateOnly = data.testDate.substring(0, 10); // "yyyy-MM-dd"
        const [y, m, d] = dateOnly.split("-").map(Number);
        effectiveNow = new Date(y, m - 1, d, 12, 0, 0); // noon local avoids edge cases
    } else {
        effectiveNow = new Date();
    }
    const today = format(effectiveNow, "dd/MM/yyyy");
    // Delivery date = OSD (the official service date), not the notice date
    const deliveryDate = toNZDateStatic(data.officialServiceDate) || today;

    const toNZDate = toNZDateStatic;

    // Determine delivery method based on whether OSD = today (before 5pm) or tomorrow (after 5pm)
    // If OSD is same as notice date, it was sent before 5pm; if OSD is later, it was after 5pm
    const noticeDateStr = format(effectiveNow, "yyyy-MM-dd");
    const deliveryMethod: StrikeNoticeData["deliveryMethod"] =
        data.officialServiceDate === noticeDateStr ? "email_before_5pm" : "email_after_5pm";

    if (noticeType === "S55_STRIKE") {
        const strikeData: StrikeNoticeData = {
            date: today,
            tenantName: data.tenantName,
            tenantAddress: data.tenantAddress,
            propertyAddress: data.propertyAddress,
            rentDueDate: toNZDate(data.rentDueDate) || today,
            rentAmount: data.rentAmount || data.amountOwed,
            amountOwed: data.amountUnpaidForDueDate ?? data.rentAmount ?? data.amountOwed,
            strikeNumber: data.strikeNumber || 1,
            firstStrikeDate: data.firstStrikeDate,
            previousNotices: data.previousNotices,
            landlordName: data.landlordName,
            landlordPhone: data.landlordPhone,
            landlordMobile: data.landlordMobile,
            landlordEmail: data.landlordEmail,
            landlordAddress: data.landlordAddress,
            deliveryDate,
            deliveryMethod,
        };

        const pdfBytes = await generateStrikeNoticePDF(strikeData);
        return {
            pdfBytes,
            filename: `Strike_${data.strikeNumber || 1}_Notice_${data.tenantName.replace(/\s+/g, "_")}_${format(effectiveNow, "yyyy-MM-dd")}.pdf`,
        };
    } else {
        const remedyData: RemedyNoticeData = {
            date: today,
            tenantName: data.tenantName,
            tenantAddress: data.tenantAddress,
            propertyAddress: data.propertyAddress,
            amountOwed: data.amountOwed,
            lastPaymentAmount: data.lastPaymentAmount,
            lastPaymentDate: toNZDate(data.lastPaymentDate),
            paymentDeadline: toNZDate(data.paymentDeadline) || toNZDate(data.officialServiceDate) || today,
            nextRentDueDate: toNZDate(data.nextRentDueDate),
            landlordName: data.landlordName,
            landlordPhone: data.landlordPhone,
            landlordEmail: data.landlordEmail,
            deliveryDate,
            deliveryMethod,
        };

        const pdfBytes = await generateRemedyNoticePDF(remedyData);
        return {
            pdfBytes,
            filename: `14_Day_Remedy_Notice_${data.tenantName.replace(/\s+/g, "_")}_${format(effectiveNow, "yyyy-MM-dd")}.pdf`,
        };
    }
}

/**
 * Converts PDF bytes to base64 for email attachment
 */
export function pdfToBase64(pdfBytes: Uint8Array): string {
    return Buffer.from(pdfBytes).toString("base64");
}
