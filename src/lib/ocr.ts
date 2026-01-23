import Tesseract from 'tesseract.js';

export interface ExtractedReceiptData {
    vendor?: string;
    amount?: number;
    gst?: number;
    rawText: string;
    confidence: number;
}

/**
 * Extracts receipt data from an image file using Tesseract OCR
 */
export async function extractReceiptData(imageFile: File): Promise<ExtractedReceiptData> {
    try {
        // Initialize Tesseract and process image
        const { data: { text, confidence } } = await Tesseract.recognize(
            imageFile,
            'eng',
            {
                logger: (m) => {
                    if (m.status === 'recognizing text') {
                        console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
                    }
                }
            }
        );

        // Extract vendor (first non-empty line or header before "Tax Invoice")
        const vendor = extractVendor(text);

        // Extract total amount (look for $ followed by numbers, prioritize "Total" line)
        const amount = extractAmount(text);

        // Extract GST (look for "GST" keyword or calculate 15% from total)
        const gst = extractGST(text, amount);

        return {
            vendor,
            amount,
            gst,
            rawText: text,
            confidence: confidence / 100
        };
    } catch (error) {
        console.error('OCR extraction failed:', error);
        return {
            rawText: '',
            confidence: 0
        };
    }
}

/**
 * Extract vendor name from OCR text
 * Strategy: First non-empty line OR text before "Tax Invoice"
 */
function extractVendor(text: string): string | undefined {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    if (lines.length === 0) return undefined;

    // Look for text before "Tax Invoice" or "Invoice"
    const invoiceIndex = lines.findIndex(l =>
        l.toLowerCase().includes('tax invoice') ||
        l.toLowerCase().includes('invoice') ||
        l.toLowerCase().includes('receipt')
    );

    if (invoiceIndex > 0) {
        // Return the line before "Invoice" (usually the vendor)
        return lines[invoiceIndex - 1];
    }

    // Otherwise return the first substantial line (> 3 chars)
    const substantialLine = lines.find(l => l.length > 3);
    return substantialLine;
}

/**
 * Extract total amount from OCR text
 * Pattern: $XX.XX, prioritize lines with "Total" keyword
 */
function extractAmount(text: string): number | undefined {
    // Pattern to match dollar amounts
    const amountPattern = /\$\s*(\d+\.?\d{0,2})/g;

    const lines = text.split('\n');
    let amounts: number[] = [];
    let totalLineAmount: number | undefined;

    // First pass: look for "Total" line
    for (const line of lines) {
        if (line.toLowerCase().includes('total')) {
            const match = amountPattern.exec(line);
            if (match) {
                totalLineAmount = parseFloat(match[1]);
                break;
            }
        }
    }

    if (totalLineAmount) return totalLineAmount;

    // Second pass: collect all amounts and return the largest
    const allMatches = text.matchAll(amountPattern);
    for (const match of allMatches) {
        amounts.push(parseFloat(match[1]));
    }

    if (amounts.length === 0) return undefined;

    // Return the largest amount (likely the total)
    return Math.max(...amounts);
}

/**
 * Extract GST from OCR text
 * Pattern: "GST" keyword + amount, or calculate 15% from total
 */
function extractGST(text: string, totalAmount?: number): number | undefined {
    // Look for explicit GST amount
    const gstPattern = /GST[:\s]*\$?\s*(\d+\.?\d{0,2})/i;
    const match = text.match(gstPattern);

    if (match) {
        return parseFloat(match[1]);
    }

    // If no explicit GST but we have total, calculate 15% (NZ GST rate: 3/23 of total)
    if (totalAmount && totalAmount > 0) {
        return (totalAmount * 3) / 23;
    }

    return undefined;
}
