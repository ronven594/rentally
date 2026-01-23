"use client";

import { useState, useEffect, useCallback } from "react";
import { format, differenceInCalendarDays, parseISO, isPast, isFuture } from "date-fns";
import { supabase } from "@/lib/supabaseClient";
import {
    calculateOfficialServiceDate,
    calculateRemedyExpiryDate,
    calculateTribunalDeadline,
    type NoticeType,
} from "@/lib/legal-engine";
import { type NZRegion } from "@/lib/nz-holidays";
import { Button } from "@/components/ui/button";
import { LegalConfirmationModal } from "./LegalConfirmationModal";
import {
    AlertTriangle,
    Calendar,
    Clock,
    Mail,
    Send,
    CheckCircle2,
    XCircle,
    AlertCircle,
    Loader2,
    Scale,
    FileText,
} from "lucide-react";

interface StrikeInfo {
    strike_count: number;
    first_strike_date: string | null;
    window_expiry_date: string | null;
    strikes: Array<{
        id: string;
        strike_number: number;
        official_service_date: string;
        sent_at: string;
        amount_owed: number;
        status: string;
    }>;
}

interface TimelineEvent {
    event_date: string;
    event_type: string;
    event_title: string;
    event_description: string;
    notice_id: string;
    is_deadline: boolean;
}

interface NoticePreviewProps {
    tenantId: string;
    tenantName: string;
    tenantEmail: string;
    propertyId: string;
    propertyAddress: string;
    region: NZRegion;
    noticeType: NoticeType;
    strikeNumber?: number;
    rentDueDate?: string;
    amountOwed?: number;
    breachDescription?: string;
    onSendSuccess?: (noticeId: string) => void;
    onClose?: () => void;
}

export function NoticePreview({
    tenantId,
    tenantName,
    tenantEmail,
    propertyId,
    propertyAddress,
    region,
    noticeType,
    strikeNumber,
    rentDueDate,
    amountOwed,
    breachDescription,
    onSendSuccess,
    onClose,
}: NoticePreviewProps) {
    const [strikeInfo, setStrikeInfo] = useState<StrikeInfo | null>(null);
    const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sentNoticeId, setSentNoticeId] = useState<string | null>(null);

    // Calculate preview dates
    const previewSentTime = new Date().toISOString();
    const previewOSD = calculateOfficialServiceDate(previewSentTime, region);
    const previewExpiryDate = noticeType === "S56_REMEDY"
        ? calculateRemedyExpiryDate(previewOSD)
        : null;
    const previewTribunalDeadline = noticeType === "S55_STRIKE" && strikeNumber === 3
        ? calculateTribunalDeadline(previewOSD)
        : null;

    // Fetch strike count and timeline
    const fetchStrikeInfo = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            // Call the RPC function to get active strike count
            const { data: strikeData, error: strikeError } = await supabase
                .rpc("get_active_strike_count", { p_tenant_id: tenantId });

            if (strikeError) {
                console.error("Strike count error:", strikeError);
                // Don't throw - just set empty data
                setStrikeInfo({
                    strike_count: 0,
                    first_strike_date: null,
                    window_expiry_date: null,
                    strikes: [],
                });
            } else if (strikeData && strikeData.length > 0) {
                setStrikeInfo(strikeData[0]);
            } else {
                setStrikeInfo({
                    strike_count: 0,
                    first_strike_date: null,
                    window_expiry_date: null,
                    strikes: [],
                });
            }

            // Get timeline
            const { data: timelineData, error: timelineError } = await supabase
                .rpc("get_notice_timeline", { p_tenant_id: tenantId });

            if (!timelineError && timelineData) {
                setTimeline(timelineData);
            }
        } catch (err: any) {
            console.error("Error fetching data:", err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [tenantId]);

    useEffect(() => {
        fetchStrikeInfo();
    }, [fetchStrikeInfo]);

    // Send notice handler
    const handleSendNotice = async () => {
        try {
            setSending(true);
            setError(null);

            const response = await fetch("/api/send-notice", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    tenantId,
                    propertyId,
                    tenantEmail,
                    tenantName,
                    propertyAddress,
                    region,
                    noticeType,
                    strikeNumber,
                    rentDueDate,
                    amountOwed,
                    breachDescription,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Failed to send notice");
            }

            setSentNoticeId(data.notice.id);
            onSendSuccess?.(data.notice.id);

            // Refresh data
            await fetchStrikeInfo();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSending(false);
        }
    };

    // Determine warning level
    const currentStrikeCount = strikeInfo?.strike_count || 0;
    const effectiveStrikeNumber = strikeNumber || currentStrikeCount + 1;
    const isThirdStrike = effectiveStrikeNumber === 3;
    const isAboutToBeThirdStrike = currentStrikeCount === 2 && noticeType === "S55_STRIKE";

    // Calculate days remaining in window
    const daysRemainingInWindow = strikeInfo?.window_expiry_date
        ? differenceInCalendarDays(parseISO(strikeInfo.window_expiry_date), new Date())
        : null;

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                <span className="ml-2 text-slate-500">Loading notice preview...</span>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden max-w-2xl w-full">
            {/* Header */}
            <div className={`px-6 py-4 ${
                isThirdStrike || isAboutToBeThirdStrike
                    ? "bg-gradient-to-r from-red-600 to-red-700"
                    : noticeType === "S55_21DAYS"
                    ? "bg-gradient-to-r from-orange-600 to-orange-700"
                    : "bg-gradient-to-r from-slate-700 to-slate-800"
            }`}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <FileText className="w-6 h-6 text-white" />
                        <div>
                            <h2 className="text-lg font-bold text-white">
                                {getNoticeTitle(noticeType, effectiveStrikeNumber)}
                            </h2>
                            <p className="text-sm text-white/80">{propertyAddress}</p>
                        </div>
                    </div>
                    {isAboutToBeThirdStrike && (
                        <div className="flex items-center gap-2 bg-white/20 px-3 py-1.5 rounded-full">
                            <AlertTriangle className="w-4 h-4 text-yellow-300" />
                            <span className="text-xs font-bold text-white">3RD STRIKE WARNING</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Third Strike Warning Banner */}
            {isAboutToBeThirdStrike && (
                <div className="bg-red-50 border-b border-red-200 px-6 py-4">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="font-bold text-red-800">High Priority: This will be the tenant's 3rd strike</p>
                            <p className="text-sm text-red-700 mt-1">
                                After sending this notice, you will be eligible to apply to the Tenancy Tribunal
                                for termination within 28 days.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Current Strike Status */}
            {noticeType === "S55_STRIKE" && (
                <div className="px-6 py-4 border-b border-slate-100">
                    <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
                        Current Strike Status
                    </h3>
                    <div className="flex items-center gap-4">
                        <div className="flex gap-1">
                            {[1, 2, 3].map((num) => (
                                <div
                                    key={num}
                                    className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
                                        num <= currentStrikeCount
                                            ? "bg-red-500 text-white"
                                            : num === effectiveStrikeNumber
                                            ? "bg-red-100 text-red-600 border-2 border-red-300 border-dashed"
                                            : "bg-slate-100 text-slate-400"
                                    }`}
                                >
                                    {num}
                                </div>
                            ))}
                        </div>
                        <div className="text-sm text-slate-600">
                            <span className="font-semibold">{currentStrikeCount} of 3</span> strikes issued
                            {daysRemainingInWindow !== null && daysRemainingInWindow > 0 && (
                                <span className="text-slate-400 ml-2">
                                    ({daysRemainingInWindow} days left in window)
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Timeline Preview */}
            <div className="px-6 py-4 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    Legal Timeline
                </h3>
                <div className="space-y-3">
                    {/* Preview of new notice dates */}
                    <TimelineItem
                        icon={<Send className="w-4 h-4" />}
                        title="Notice Sent"
                        date={format(new Date(), "EEEE, d MMMM yyyy")}
                        time={format(new Date(), "h:mm a")}
                        status="preview"
                        description="Email will be sent now"
                    />
                    <TimelineItem
                        icon={<CheckCircle2 className="w-4 h-4" />}
                        title="Official Service Date"
                        date={format(parseISO(previewOSD), "EEEE, d MMMM yyyy")}
                        status="preview"
                        description="Legal service date (5PM rule applied)"
                        highlight
                    />
                    {previewExpiryDate && (
                        <TimelineItem
                            icon={<Clock className="w-4 h-4" />}
                            title="Remedy Deadline"
                            date={format(parseISO(previewExpiryDate), "EEEE, d MMMM yyyy")}
                            status="deadline"
                            description="14-day remedy period expires"
                        />
                    )}
                    {previewTribunalDeadline && (
                        <TimelineItem
                            icon={<Scale className="w-4 h-4" />}
                            title="Tribunal Filing Deadline"
                            date={format(parseISO(previewTribunalDeadline), "EEEE, d MMMM yyyy")}
                            status="deadline"
                            description="28-day window to file with Tribunal"
                        />
                    )}

                    {/* Existing timeline events */}
                    {timeline.length > 0 && (
                        <>
                            <div className="border-t border-dashed border-slate-200 my-3 pt-3">
                                <p className="text-xs text-slate-400 font-medium">Previous Notices</p>
                            </div>
                            {timeline.slice(0, 5).map((event, idx) => (
                                <TimelineItem
                                    key={idx}
                                    icon={event.is_deadline ? <Clock className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
                                    title={event.event_title}
                                    date={format(parseISO(event.event_date), "d MMM yyyy")}
                                    status={isPast(parseISO(event.event_date)) ? "past" : "upcoming"}
                                    description={event.event_description}
                                />
                            ))}
                        </>
                    )}
                </div>
            </div>

            {/* Notice Details */}
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
                <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
                    Notice Details
                </h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <span className="text-slate-500">Tenant:</span>
                        <p className="font-medium text-slate-900">{tenantName}</p>
                    </div>
                    <div>
                        <span className="text-slate-500">Email:</span>
                        <p className="font-medium text-slate-900">{tenantEmail}</p>
                    </div>
                    {rentDueDate && (
                        <div>
                            <span className="text-slate-500">Rent Due Date:</span>
                            <p className="font-medium text-slate-900">{rentDueDate}</p>
                        </div>
                    )}
                    {amountOwed !== undefined && amountOwed > 0 && (
                        <div>
                            <span className="text-slate-500">Amount Owed:</span>
                            <p className="font-bold text-red-600 text-lg">${amountOwed.toFixed(2)}</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Error Display */}
            {error && (
                <div className="px-6 py-3 bg-red-50 border-b border-red-100">
                    <div className="flex items-center gap-2 text-red-700">
                        <XCircle className="w-4 h-4" />
                        <span className="text-sm">{error}</span>
                    </div>
                </div>
            )}

            {/* Success Display */}
            {sentNoticeId && (
                <div className="px-6 py-3 bg-green-50 border-b border-green-100">
                    <div className="flex items-center gap-2 text-green-700">
                        <CheckCircle2 className="w-4 h-4" />
                        <span className="text-sm font-medium">Notice sent successfully!</span>
                    </div>
                </div>
            )}

            {/* Actions */}
            <div className="px-6 py-4 bg-white flex items-center justify-between">
                <div className="text-xs text-slate-400">
                    <AlertCircle className="w-3 h-3 inline mr-1" />
                    Dates calculated by NZ legal engine (not AI)
                </div>
                <div className="flex gap-3">
                    {onClose && (
                        <Button
                            variant="ghost"
                            onClick={onClose}
                            disabled={sending}
                        >
                            Cancel
                        </Button>
                    )}
                    <Button
                        onClick={handleSendNotice}
                        disabled={sending || !!sentNoticeId}
                        className={`${
                            isAboutToBeThirdStrike
                                ? "bg-red-600 hover:bg-red-700"
                                : "bg-slate-900 hover:bg-slate-800"
                        } text-white font-bold`}
                    >
                        {sending ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Sending...
                            </>
                        ) : sentNoticeId ? (
                            <>
                                <CheckCircle2 className="w-4 h-4 mr-2" />
                                Sent
                            </>
                        ) : (
                            <>
                                <Send className="w-4 h-4 mr-2" />
                                Send Notice
                            </>
                        )}
                    </Button>
                </div>
            </div>
        </div>
    );
}

// Helper component for timeline items
function TimelineItem({
    icon,
    title,
    date,
    time,
    status,
    description,
    highlight,
}: {
    icon: React.ReactNode;
    title: string;
    date: string;
    time?: string;
    status: "preview" | "past" | "upcoming" | "deadline";
    description?: string;
    highlight?: boolean;
}) {
    const statusStyles = {
        preview: "bg-blue-50 border-blue-200 text-blue-700",
        past: "bg-slate-50 border-slate-200 text-slate-500",
        upcoming: "bg-green-50 border-green-200 text-green-700",
        deadline: "bg-amber-50 border-amber-200 text-amber-700",
    };

    return (
        <div className={`flex items-start gap-3 p-3 rounded-lg border ${statusStyles[status]} ${highlight ? "ring-2 ring-blue-300" : ""}`}>
            <div className="flex-shrink-0 mt-0.5">{icon}</div>
            <div className="flex-grow min-w-0">
                <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">{title}</span>
                    {status === "preview" && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Preview</span>
                    )}
                </div>
                <p className="text-sm font-medium">{date}{time && ` at ${time}`}</p>
                {description && <p className="text-xs opacity-75 mt-0.5">{description}</p>}
            </div>
        </div>
    );
}

// Helper function for notice titles
function getNoticeTitle(noticeType: NoticeType, strikeNumber: number): string {
    switch (noticeType) {
        case "S55_STRIKE":
            return `Strike ${strikeNumber} Notice - Rent Arrears`;
        case "S55_21DAYS":
            return "21-Day Arrears Notice";
        case "S55A_SOCIAL":
            return `Anti-Social Behaviour Notice (Strike ${strikeNumber})`;
        case "S56_REMEDY":
            return "14-Day Notice to Remedy";
        default:
            return "Tenancy Notice";
    }
}
