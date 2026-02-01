import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRemedyNoticeStatus, type S56NoticeMetadata } from "@/lib/notice-expiry";

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    const noticeId = searchParams.get("noticeId");

    if (!tenantId || !noticeId) {
        return NextResponse.json(
            { error: "tenantId and noticeId are required" },
            { status: 400 }
        );
    }

    try {
        // Get the notice record
        const { data: notice, error: noticeError } = await supabaseAdmin
            .from("notices")
            .select("*")
            .eq("id", noticeId)
            .eq("tenant_id", tenantId)
            .eq("notice_type", "S56_REMEDY")
            .single();

        if (noticeError || !notice) {
            return NextResponse.json(
                { error: "Notice not found" },
                { status: 404 }
            );
        }

        // Extract metadata
        const metadata = notice.metadata as S56NoticeMetadata;

        if (!metadata?.due_dates || !metadata?.total_amount_owed) {
            return NextResponse.json(
                { error: "Notice missing debt snapshot metadata" },
                { status: 400 }
            );
        }

        // Check status
        const status = await checkRemedyNoticeStatus(
            notice.expiry_date,
            metadata,
            tenantId,
            supabaseAdmin
        );

        return NextResponse.json({
            noticeId: notice.id,
            sentAt: notice.sent_at,
            officialServiceDate: notice.official_service_date,
            expiryDate: notice.expiry_date,
            status,
        });
    } catch (error: any) {
        console.error("Check remedy status error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to check remedy status" },
            { status: 500 }
        );
    }
}
