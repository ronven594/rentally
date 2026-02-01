import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkStrikeWindowStatus, checkTribunalWindowStatus, getActiveStrikes } from "@/lib/notice-expiry";

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
        return NextResponse.json(
            { error: "tenantId is required" },
            { status: 400 }
        );
    }

    try {
        // Get all strike notices for this tenant
        const { data: strikes, error: strikesError } = await supabaseAdmin
            .from("notices")
            .select("id, strike_number, official_service_date, sent_at, due_date_for, amount_owed")
            .eq("tenant_id", tenantId)
            .eq("is_strike", true)
            .order("official_service_date", { ascending: true });

        if (strikesError) {
            throw strikesError;
        }

        if (!strikes || strikes.length === 0) {
            return NextResponse.json({
                activeStrikeCount: 0,
                strikes: [],
                windowStatus: null,
                tribunalStatus: null,
            });
        }

        // Filter to active strikes within 90-day window
        const activeStrikes = getActiveStrikes(
            strikes.map(s => ({ ...s, officialServiceDate: s.official_service_date }))
        );

        // Get window status
        let windowStatus = null;
        let tribunalStatus = null;

        if (activeStrikes.length > 0) {
            windowStatus = checkStrikeWindowStatus(
                activeStrikes[0].officialServiceDate,
                activeStrikes.length
            );

            // If 3 strikes, check tribunal window
            if (activeStrikes.length >= 3) {
                const thirdStrike = activeStrikes[2];
                tribunalStatus = checkTribunalWindowStatus(thirdStrike.officialServiceDate);
            }
        }

        return NextResponse.json({
            activeStrikeCount: activeStrikes.length,
            strikes: activeStrikes,
            windowStatus,
            tribunalStatus,
        });
    } catch (error: any) {
        console.error("Check strike status error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to check strike status" },
            { status: 500 }
        );
    }
}
