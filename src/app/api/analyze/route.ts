/**
 * API Route: /api/analyze
 *
 * Analyzes tenancy situation based on ledger data and behavior notes.
 * Returns structured JSON per the legal blueprint specification.
 *
 * IMPORTANT ARCHITECTURE:
 * - AI (Gemini) handles: Categorization of behavior notes, determining notice type
 * - TypeScript handles: ALL date calculations (5PM rule, working days, holidays, deadlines)
 * - The AI NEVER guesses or calculates dates - only the legal-engine.ts functions do that
 *
 * POST /api/analyze
 * Body: {
 *   tenantId: string,
 *   region?: NZRegion,
 *   ledger: LedgerEntry[],
 *   strikeHistory: StrikeRecord[],
 *   behaviorNotes?: BehaviorNote[]
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";
import {
    analyzeTenancySituation,
    calculateOfficialServiceDate,
    prepareStrikeNotice,
    canIssueStrikeNotice,
    type AnalysisInput,
    type LedgerEntry,
    type StrikeRecord,
    type BehaviorNote,
    type NoticeType,
} from "@/lib/legal-engine";
import { type NZRegion } from "@/lib/nz-holidays";
import { sendNoticeEmail } from "@/lib/mail";

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// Create Supabase client for database access
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * Fetches active strike count from the notices table using the RPC function.
 * This ensures we use database records rather than just in-memory data.
 */
async function getActiveStrikeCountFromDB(tenantId: string): Promise<{
    strikeCount: number;
    firstStrikeDate: string | null;
    windowExpiryDate: string | null;
    strikes: StrikeRecord[];
}> {
    try {
        const { data, error } = await supabaseAdmin
            .rpc("get_active_strike_count", { p_tenant_id: tenantId });

        if (error) {
            console.error("Error fetching strike count:", error);
            return {
                strikeCount: 0,
                firstStrikeDate: null,
                windowExpiryDate: null,
                strikes: [],
            };
        }

        if (data && data.length > 0) {
            const result = data[0];
            return {
                strikeCount: result.strike_count || 0,
                firstStrikeDate: result.first_strike_date,
                windowExpiryDate: result.window_expiry_date,
                strikes: (result.strikes || []).map((s: any) => ({
                    noticeId: s.id,
                    sentDate: s.sent_at,
                    officialServiceDate: s.official_service_date,
                    type: "S55_STRIKE" as NoticeType,
                    amountOwed: s.amount_owed,
                })),
            };
        }

        return {
            strikeCount: 0,
            firstStrikeDate: null,
            windowExpiryDate: null,
            strikes: [],
        };
    } catch (err) {
        console.error("Database error:", err);
        return {
            strikeCount: 0,
            firstStrikeDate: null,
            windowExpiryDate: null,
            strikes: [],
        };
    }
}

interface AnalyzeRequestBody {
    tenantId: string;
    tenantEmail?: string;
    tenantName?: string;
    propertyAddress?: string;
    propertyId?: string;
    region?: NZRegion;
    ledger: LedgerEntry[];
    strikeHistory?: StrikeRecord[]; // Optional - will fetch from DB if not provided
    behaviorNotes?: BehaviorNote[];
    sendNotice?: boolean;
    noticeType?: "S55_STRIKE" | "S55A_SOCIAL" | "S56_REMEDY";
    enableAICategorization?: boolean; // Flag to enable Gemini categorization
    useDBStrikeCount?: boolean; // Flag to fetch strike count from notices table
}

/**
 * AI Categorization using Gemini
 *
 * Uses AI to categorize behavior notes and determine appropriate notice types.
 * IMPORTANT: AI only categorizes - it does NOT calculate any dates.
 * All date calculations are done by legal-engine.ts TypeScript functions.
 */
async function categorizeBehaviorWithAI(
    behaviorNotes: BehaviorNote[],
    ledgerSummary: { daysArrears: number; workingDaysOverdue: number; totalOwed: number }
): Promise<{
    recommendedNoticeType: NoticeType | null;
    behaviorAnalysis: {
        isAntiSocial: boolean;
        severity: "low" | "medium" | "high";
        categories: string[];
        reasoning: string;
    };
    rentAnalysis: {
        shouldIssueStrike: boolean;
        reasoning: string;
    };
}> {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `You are a legal assistant for NZ tenancy law. Analyze the following tenant situation and categorize it.

BEHAVIOR NOTES:
${behaviorNotes.length > 0 ? behaviorNotes.map(n => `- ${n.date}: ${n.description}`).join("\n") : "No behavior notes recorded."}

RENT SITUATION:
- Days in arrears: ${ledgerSummary.daysArrears}
- Working days overdue: ${ledgerSummary.workingDaysOverdue}
- Total amount owed: $${ledgerSummary.totalOwed.toFixed(2)}

Based on the Residential Tenancies Act 1986, categorize this situation.

IMPORTANT: DO NOT calculate any dates. Only categorize the behavior and determine the appropriate notice type.

Return ONLY valid JSON in this exact format (no markdown, no code blocks):
{
  "recommendedNoticeType": "S55_STRIKE" | "S55A_SOCIAL" | "S56_REMEDY" | "S55_21DAYS" | null,
  "behaviorAnalysis": {
    "isAntiSocial": true/false,
    "severity": "low" | "medium" | "high",
    "categories": ["noise", "damage", "harassment", etc.],
    "reasoning": "Brief explanation"
  },
  "rentAnalysis": {
    "shouldIssueStrike": true/false,
    "reasoning": "Brief explanation based on working days overdue (5+ required for strike)"
  }
}

Notice Type Guidelines:
- S55_STRIKE: Rent 5+ working days overdue
- S55_21DAYS: Rent 21+ calendar days in arrears (immediate tribunal)
- S55A_SOCIAL: Anti-social behavior warranting strike
- S56_REMEDY: General breach requiring 14-day remedy notice
- null: No action required`;

        const result = await model.generateContent(prompt);
        const response = result.response.text();

        // Parse JSON from response (handle potential markdown wrapping)
        let jsonStr = response.trim();
        if (jsonStr.startsWith("```")) {
            jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```$/g, "").trim();
        }

        const parsed = JSON.parse(jsonStr);
        return parsed;
    } catch (error) {
        console.error("AI Categorization Error:", error);
        // Return default analysis if AI fails
        return {
            recommendedNoticeType: ledgerSummary.workingDaysOverdue >= 5 ? "S55_STRIKE" : null,
            behaviorAnalysis: {
                isAntiSocial: false,
                severity: "low",
                categories: [],
                reasoning: "AI categorization unavailable - using rule-based fallback",
            },
            rentAnalysis: {
                shouldIssueStrike: ledgerSummary.workingDaysOverdue >= 5,
                reasoning: `Rule-based: ${ledgerSummary.workingDaysOverdue} working days overdue`,
            },
        };
    }
}

export async function POST(request: NextRequest) {
    try {
        const body: AnalyzeRequestBody = await request.json();

        // Validate required fields
        if (!body.tenantId) {
            return NextResponse.json(
                { error: "tenantId is required" },
                { status: 400 }
            );
        }

        if (!body.ledger || !Array.isArray(body.ledger)) {
            return NextResponse.json(
                { error: "ledger array is required" },
                { status: 400 }
            );
        }

        // Fetch strike history from database if requested or not provided
        let strikeHistory = body.strikeHistory || [];
        let dbStrikeInfo = null;

        if (body.useDBStrikeCount || !body.strikeHistory || body.strikeHistory.length === 0) {
            dbStrikeInfo = await getActiveStrikeCountFromDB(body.tenantId);
            if (dbStrikeInfo.strikes.length > 0) {
                strikeHistory = dbStrikeInfo.strikes;
            }
        }

        // Prepare analysis input
        const analysisInput: AnalysisInput = {
            tenantId: body.tenantId,
            region: body.region,
            ledger: body.ledger,
            strikeHistory: strikeHistory,
            behaviorNotes: body.behaviorNotes,
        };

        // Run TypeScript-based date analysis (NEVER uses AI for dates)
        const result = analyzeTenancySituation(analysisInput);

        // Enhance result with database strike info if available
        if (dbStrikeInfo) {
            result.analysis.strikeCount = dbStrikeInfo.strikeCount;
            result.analysis.firstStrikeOSD = dbStrikeInfo.firstStrikeDate || undefined;
            result.analysis.windowExpiryDate = dbStrikeInfo.windowExpiryDate || undefined;
        }

        // Optionally run AI categorization for behavior notes
        let aiCategorization = null;
        if (body.enableAICategorization && process.env.GEMINI_API_KEY) {
            aiCategorization = await categorizeBehaviorWithAI(
                body.behaviorNotes || [],
                {
                    daysArrears: result.analysis.daysArrears,
                    workingDaysOverdue: result.analysis.workingDaysOverdue,
                    totalOwed: body.ledger
                        .filter(e => e.status === "Unpaid" || e.status === "Partial")
                        .reduce((sum, e) => sum + (e.amount - (e.amountPaid || 0)), 0),
                }
            );
        }

        // If sendNotice flag is set and action is required, send notice email
        if (body.sendNotice && result.status === "ACTION_REQUIRED" && body.tenantEmail) {
            const canIssue = canIssueStrikeNotice(
                body.ledger,
                body.strikeHistory || [],
                body.region
            );

            if (canIssue.canIssue) {
                const sentTimestamp = new Date().toISOString();
                const strikeCount = result.analysis.strikeCount + 1;

                // Find the oldest unpaid entry for the notice
                const unpaidEntries = body.ledger
                    .filter(e => e.status === "Unpaid" || e.status === "Partial")
                    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

                if (unpaidEntries.length > 0) {
                    const oldestUnpaid = unpaidEntries[0];
                    const amountOwed = oldestUnpaid.amount - (oldestUnpaid.amountPaid || 0);

                    // Prepare strike notice with calculated dates
                    const strikeNotice = prepareStrikeNotice(
                        sentTimestamp,
                        body.region || "Auckland",
                        strikeCount,
                        oldestUnpaid.dueDate,
                        amountOwed
                    );

                    // Generate email content
                    const emailSubject = `Strike ${strikeCount} Notice - Rent Arrears`;
                    const emailBody = generateStrikeNoticeEmail({
                        tenantName: body.tenantName || "Tenant",
                        propertyAddress: body.propertyAddress || "Property",
                        strikeNumber: strikeCount,
                        rentDueDate: oldestUnpaid.dueDate,
                        amountOwed,
                        officialServiceDate: strikeNotice.officialServiceDate,
                        remedyExpiryDate: strikeNotice.remedyExpiryDate,
                    });

                    // Send email via Resend
                    const emailResult = await sendNoticeEmail(
                        body.tenantEmail,
                        emailSubject,
                        emailBody
                    );

                    // Update result with sent notice details
                    return NextResponse.json({
                        ...result,
                        noticeSent: true,
                        noticeDetails: {
                            strikeNumber: strikeCount,
                            sentTimestamp,
                            officialServiceDate: strikeNotice.officialServiceDate,
                            remedyExpiryDate: strikeNotice.remedyExpiryDate,
                            emailResult,
                            newStrikeRecord: strikeNotice,
                        },
                        dates: {
                            ...result.dates,
                            sentDate: sentTimestamp,
                            officialServiceDate: strikeNotice.officialServiceDate,
                            remedyExpiryDate: strikeNotice.remedyExpiryDate,
                        },
                    });
                }
            } else {
                return NextResponse.json({
                    ...result,
                    noticeSent: false,
                    noticeError: canIssue.reason,
                });
            }
        }

        // Return result with optional AI categorization
        // IMPORTANT: All dates in the response are calculated by TypeScript, NOT AI
        return NextResponse.json({
            ...result,
            ...(aiCategorization && {
                aiCategorization: {
                    ...aiCategorization,
                    disclaimer: "AI provides categorization only. All dates are calculated by TypeScript legal engine.",
                },
            }),
        });
    } catch (error: any) {
        console.error("Analysis API Error:", error);
        return NextResponse.json(
            { error: error.message || "Internal server error" },
            { status: 500 }
        );
    }
}

/**
 * GET endpoint for calculating service date only
 * Useful for previewing when a notice would be officially served
 *
 * GET /api/analyze?timestamp=2026-01-23T17:05:00Z&region=Auckland
 */
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const timestamp = searchParams.get("timestamp");
    const region = searchParams.get("region") as NZRegion | null;

    if (!timestamp) {
        return NextResponse.json(
            { error: "timestamp query parameter is required" },
            { status: 400 }
        );
    }

    try {
        const officialServiceDate = calculateOfficialServiceDate(timestamp, region || undefined);

        return NextResponse.json({
            sentTimestamp: timestamp,
            region: region || "Not specified",
            officialServiceDate,
        });
    } catch (error: any) {
        return NextResponse.json(
            { error: error.message || "Invalid timestamp format" },
            { status: 400 }
        );
    }
}

/**
 * Generates HTML email content for a strike notice
 */
function generateStrikeNoticeEmail(params: {
    tenantName: string;
    propertyAddress: string;
    strikeNumber: number;
    rentDueDate: string;
    amountOwed: number;
    officialServiceDate: string;
    remedyExpiryDate: string;
}): string {
    const {
        tenantName,
        propertyAddress,
        strikeNumber,
        rentDueDate,
        amountOwed,
        officialServiceDate,
        remedyExpiryDate,
    } = params;

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Strike ${strikeNumber} Notice - Rent Arrears</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #dc2626; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
        .important { background: #fef2f2; border-left: 4px solid #dc2626; padding: 15px; margin: 15px 0; }
        .details { background: white; padding: 15px; border-radius: 4px; margin: 15px 0; }
        .footer { font-size: 12px; color: #6b7280; margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb; }
        h1 { margin: 0; font-size: 24px; }
        h2 { color: #dc2626; }
        .amount { font-size: 24px; font-weight: bold; color: #dc2626; }
    </style>
</head>
<body>
    <div class="header">
        <h1>⚠️ STRIKE ${strikeNumber} NOTICE</h1>
        <p>Residential Tenancies Act 1986, Section 55(1)(aa)</p>
    </div>

    <div class="content">
        <p>Dear <strong>${tenantName}</strong>,</p>

        <p>This is a formal notice that your rent payment is overdue. This notice constitutes <strong>Strike ${strikeNumber} of 3</strong> under the Residential Tenancies Act 1986.</p>

        <div class="details">
            <h3>Payment Details</h3>
            <p><strong>Property:</strong> ${propertyAddress}</p>
            <p><strong>Rent Due Date:</strong> ${rentDueDate}</p>
            <p><strong>Amount Outstanding:</strong> <span class="amount">$${amountOwed.toFixed(2)}</span></p>
        </div>

        <div class="important">
            <h3>⚠️ Important Legal Information</h3>
            <p><strong>Official Service Date:</strong> ${officialServiceDate}</p>
            <p><strong>Remedy Deadline:</strong> ${remedyExpiryDate}</p>
            <p>You have <strong>14 days</strong> from the Official Service Date to pay the outstanding rent.</p>
        </div>

        <h2>What This Means</h2>
        <p>Under Section 55(1)(aa) of the Residential Tenancies Act 1986:</p>
        <ul>
            <li>This is <strong>Strike ${strikeNumber}</strong> for rent being 5+ working days overdue.</li>
            <li>If <strong>3 strikes</strong> are issued within a <strong>90-day period</strong>, the landlord may apply to the Tenancy Tribunal for termination of the tenancy.</li>
            ${strikeNumber >= 3 ? '<li><strong>This is your 3rd strike. Tribunal application may now proceed.</strong></li>' : ''}
        </ul>

        <h2>Action Required</h2>
        <p>Please pay the outstanding amount of <strong>$${amountOwed.toFixed(2)}</strong> immediately to avoid further action.</p>

        <div class="footer">
            <p>This notice was sent in accordance with Section 190 of the Residential Tenancies Act 1986.</p>
            <p>For more information about your rights and obligations, visit <a href="https://www.tenancy.govt.nz">tenancy.govt.nz</a></p>
        </div>
    </div>
</body>
</html>
    `.trim();
}
