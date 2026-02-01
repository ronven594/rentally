"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { format, differenceInCalendarDays, parseISO, isPast, isFuture } from "date-fns";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/contexts/AuthContext";
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
    Download,
    Truck,
    Mailbox,
    Hand,
    Pencil,
    ChevronDown,
    ChevronUp,
    RefreshCw,
    Eye,
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
    rentAmount?: number;
    breachDescription?: string;
    onSendSuccess?: (noticeId: string) => void;
    onClose?: () => void;
    testDate?: Date;
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
    rentAmount,
    breachDescription,
    onSendSuccess,
    onClose,
    testDate,
}: NoticePreviewProps) {
    const { profile } = useAuth();
    const [strikeInfo, setStrikeInfo] = useState<StrikeInfo | null>(null);
    const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sentNoticeId, setSentNoticeId] = useState<string | null>(null);
    const [showConfirmationModal, setShowConfirmationModal] = useState(false);
    const [showDeliveryPicker, setShowDeliveryPicker] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [showFieldEditor, setShowFieldEditor] = useState(false);
    const [fieldOverrides, setFieldOverrides] = useState<Record<string, string>>({});
    const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);
    const [previewOutdated, setPreviewOutdated] = useState(false);
    const prevUrlRef = useRef<string | null>(null);

    // Initialize field overrides from props
    useEffect(() => {
        const defaults: Record<string, string> = {
            tenantName: tenantName || "",
            propertyAddress: propertyAddress || "",
            landlordName: profile?.full_name || "",
            landlordPhone: profile?.phone || "",
            landlordEmail: profile?.email || "",
        };
        if (noticeType === "S55_STRIKE") {
            defaults.rentDueDate = rentDueDate || "";
            defaults.rentAmount = rentAmount?.toFixed(2) || "";
            defaults.amountOwed = amountOwed?.toFixed(2) || "";
            defaults.landlordMobile = "";
            defaults.landlordAddress = profile?.service_address || "";
        } else if (noticeType === "S56_REMEDY") {
            defaults.tenantAddress = propertyAddress || "";
            defaults.amountOwed = amountOwed?.toFixed(2) || "";
        }
        setFieldOverrides(defaults);
    }, [tenantName, propertyAddress, rentDueDate, rentAmount, amountOwed, noticeType, profile]);

    const updateField = (key: string, value: string) => {
        setFieldOverrides(prev => ({ ...prev, [key]: value }));
        setPreviewOutdated(true);
    };

    // Build shared request body for all API calls
    const buildRequestBody = useCallback((extra: Record<string, unknown> = {}) => ({
        tenantId,
        propertyId,
        tenantEmail,
        tenantName,
        propertyAddress,
        region,
        noticeType,
        strikeNumber,
        rentDueDate,
        rentAmount,
        amountOwed,
        breachDescription,
        landlordName: profile?.full_name || undefined,
        landlordPhone: profile?.phone || undefined,
        landlordEmail: profile?.email || undefined,
        landlordAddress: profile?.service_address || undefined,
        testDate: testDate ? format(testDate, "yyyy-MM-dd") : undefined,
        fieldOverrides,
        firstStrikeDate: strikeInfo?.first_strike_date || undefined,
        previousNotices: strikeInfo?.strikes
            ?.filter(s => s.strike_number < (strikeNumber || 0))
            .map(s => ({ date: format(parseISO(s.official_service_date), "dd/MM/yyyy") })) || undefined,
        ...extra,
    }), [tenantId, propertyId, tenantEmail, tenantName, propertyAddress, region, noticeType, strikeNumber, rentDueDate, rentAmount, amountOwed, breachDescription, profile, testDate, fieldOverrides, strikeInfo]);

    // Generate PDF preview
    const generatePreview = useCallback(async () => {
        if (noticeType !== "S55_STRIKE" && noticeType !== "S56_REMEDY") return;
        setIsLoadingPreview(true);
        try {
            const response = await fetch("/api/send-notice", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(buildRequestBody({ downloadOnly: true })),
            });
            if (!response.ok) return;
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            // Revoke previous URL
            if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
            prevUrlRef.current = url;
            setPdfPreviewUrl(url);
            setPreviewOutdated(false);
        } catch (err) {
            console.error("Preview generation failed:", err);
        } finally {
            setIsLoadingPreview(false);
        }
    }, [buildRequestBody, noticeType]);

    // Auto-generate preview once strike info is loaded
    useEffect(() => {
        if (!loading && (noticeType === "S55_STRIKE" || noticeType === "S56_REMEDY")) {
            generatePreview();
        }
    }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

    // Cleanup blob URL on unmount
    useEffect(() => {
        return () => {
            if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
        };
    }, []);

    // Calculate preview dates (use testDate if provided for testing future scenarios)
    const previewSentTime = (testDate || new Date()).toISOString();
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
                body: JSON.stringify(buildRequestBody()),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.details ? `${data.error}: ${data.details}` : data.error || "Failed to send notice");
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

    // Download PDF only (no DB record, no email)
    const handleDownloadPDF = async () => {
        try {
            setDownloading(true);
            setError(null);

            const response = await fetch("/api/send-notice", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(buildRequestBody({ downloadOnly: true })),
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || "Failed to generate PDF");
            }

            // Response is PDF binary when downloadOnly=true
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `Notice_${tenantName.replace(/\s+/g, "_")}_${format(new Date(), "yyyy-MM-dd")}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setDownloading(false);
        }
    };

    // Mark as manually sent with a specific delivery method
    const handleManualSend = async (deliveryMethod: "hand" | "post" | "letterbox") => {
        try {
            setSending(true);
            setError(null);

            const response = await fetch("/api/send-notice", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(buildRequestBody({ manualDelivery: true, deliveryMethod })),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.details ? `${data.error}: ${data.details}` : data.error || "Failed to record notice");
            }

            setSentNoticeId(data.notice.id);
            setShowDeliveryPicker(false);
            onSendSuccess?.(data.notice.id);
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
                    {currentStrikeCount > 0 && currentStrikeCount < 3 && daysRemainingInWindow !== null && (
                        <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                            <p className="text-xs text-blue-700">
                                <strong>Window Reset:</strong> If no new strikes are issued, the strike window will reset in {daysRemainingInWindow} days (on {strikeInfo?.window_expiry_date ? format(parseISO(strikeInfo.window_expiry_date), 'd MMM yyyy') : 'N/A'}). After this date, any new strikes will start a fresh 90-day window.
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* PDF Preview */}
            {(noticeType === "S55_STRIKE" || noticeType === "S56_REMEDY") && (
                <div className="px-6 py-4 border-b border-slate-100">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                            <Eye className="w-4 h-4" />
                            PDF Preview
                        </h3>
                        <div className="flex items-center gap-2">
                            {previewOutdated && !isLoadingPreview && (
                                <span className="text-[10px] text-amber-600 font-medium">Fields changed</span>
                            )}
                            <button
                                onClick={generatePreview}
                                disabled={isLoadingPreview}
                                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 disabled:text-slate-400 transition-colors"
                            >
                                <RefreshCw className={`w-3 h-3 ${isLoadingPreview ? "animate-spin" : ""}`} />
                                {isLoadingPreview ? "Generating..." : "Refresh"}
                            </button>
                        </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 overflow-hidden bg-slate-100" style={{ height: "400px" }}>
                        {isLoadingPreview && !pdfPreviewUrl ? (
                            <div className="flex flex-col items-center justify-center h-full gap-2">
                                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                                <span className="text-sm text-slate-500">Generating preview...</span>
                            </div>
                        ) : pdfPreviewUrl ? (
                            <iframe
                                src={pdfPreviewUrl}
                                width="100%"
                                height="100%"
                                title="Notice PDF Preview"
                                className="border-0"
                            />
                        ) : (
                            <div className="flex items-center justify-center h-full text-sm text-slate-400">
                                Preview not available
                            </div>
                        )}
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
                            description="Tenant must remedy by 11:59 PM on this date"
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

            {/* Editable PDF Fields */}
            {(noticeType === "S55_STRIKE" || noticeType === "S56_REMEDY") && (
                <div className="border-b border-slate-100">
                    <button
                        onClick={() => setShowFieldEditor(!showFieldEditor)}
                        className="w-full px-6 py-3 flex items-center justify-between text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
                    >
                        <div className="flex items-center gap-2">
                            <Pencil className="w-4 h-4" />
                            <span>Edit PDF Fields</span>
                        </div>
                        {showFieldEditor ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>

                    {showFieldEditor && (
                        <div className="px-6 pb-4 space-y-4">
                            {/* Tenant & Property */}
                            <FieldGroup title="Tenant & Property">
                                <FieldInput label="Tenant Name" value={fieldOverrides.tenantName} onChange={v => updateField("tenantName", v)} />
                                {noticeType === "S56_REMEDY" && (
                                    <FieldInput label="Tenant Address" value={fieldOverrides.tenantAddress} onChange={v => updateField("tenantAddress", v)} />
                                )}
                                <FieldInput label="Property Address" value={fieldOverrides.propertyAddress} onChange={v => updateField("propertyAddress", v)} />
                            </FieldGroup>

                            {/* Rent Details */}
                            <FieldGroup title="Rent Details">
                                {noticeType === "S55_STRIKE" && (
                                    <>
                                        <FieldInput label="Rent Due Date" value={fieldOverrides.rentDueDate} onChange={v => updateField("rentDueDate", v)} placeholder="dd/MM/yyyy" />
                                        <FieldInput label="Rent Amount" value={fieldOverrides.rentAmount} onChange={v => updateField("rentAmount", v)} prefix="$" />
                                    </>
                                )}
                                <FieldInput label="Amount Owed" value={fieldOverrides.amountOwed} onChange={v => updateField("amountOwed", v)} prefix="$" />
                            </FieldGroup>

                            {/* Payment Info (Remedy only) */}
                            {noticeType === "S56_REMEDY" && (
                                <FieldGroup title="Payment Info">
                                    <FieldInput label="Last Payment Amount" value={fieldOverrides.lastPaymentAmount} onChange={v => updateField("lastPaymentAmount", v)} prefix="$" placeholder="Auto-detected" />
                                    <FieldInput label="Last Payment Date" value={fieldOverrides.lastPaymentDate} onChange={v => updateField("lastPaymentDate", v)} placeholder="dd/MM/yyyy" />
                                    <FieldInput label="Payment Deadline" value={fieldOverrides.paymentDeadline} onChange={v => updateField("paymentDeadline", v)} placeholder="Auto-calculated" />
                                    <FieldInput label="Next Rent Due Date" value={fieldOverrides.nextRentDueDate} onChange={v => updateField("nextRentDueDate", v)} placeholder="Auto-calculated" />
                                </FieldGroup>
                            )}

                            {/* Landlord Details */}
                            <FieldGroup title="Landlord Details">
                                <FieldInput label="Landlord Name" value={fieldOverrides.landlordName} onChange={v => updateField("landlordName", v)} />
                                <FieldInput label="Phone" value={fieldOverrides.landlordPhone} onChange={v => updateField("landlordPhone", v)} />
                                {noticeType === "S55_STRIKE" && (
                                    <FieldInput label="Mobile" value={fieldOverrides.landlordMobile} onChange={v => updateField("landlordMobile", v)} />
                                )}
                                <FieldInput label="Email" value={fieldOverrides.landlordEmail} onChange={v => updateField("landlordEmail", v)} />
                                {noticeType === "S55_STRIKE" && (
                                    <FieldInput label="Address" value={fieldOverrides.landlordAddress} onChange={v => updateField("landlordAddress", v)} />
                                )}
                            </FieldGroup>

                            <p className="text-[10px] text-slate-400">
                                Empty fields will use auto-calculated values. Dates should be in dd/MM/yyyy format.
                            </p>
                        </div>
                    )}
                </div>
            )}

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

            {/* Delivery Method Picker */}
            {showDeliveryPicker && !sentNoticeId && (
                <div className="px-6 py-4 border-b border-slate-100 bg-amber-50">
                    <h3 className="text-sm font-semibold text-slate-700 mb-3">How was this notice delivered?</h3>
                    <p className="text-xs text-slate-500 mb-3">OSD depends on delivery method (RTA Section 136)</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <button
                            onClick={() => handleManualSend("hand")}
                            disabled={sending}
                            className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-left transition-colors"
                        >
                            <Hand className="w-4 h-4 text-green-600 shrink-0" />
                            <div>
                                <p className="text-sm font-semibold text-slate-800">Hand Delivered</p>
                                <p className="text-[10px] text-slate-500">OSD = today (before 5 PM)</p>
                            </div>
                        </button>
                        <button
                            onClick={() => handleManualSend("letterbox")}
                            disabled={sending}
                            className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-left transition-colors"
                        >
                            <Mailbox className="w-4 h-4 text-blue-600 shrink-0" />
                            <div>
                                <p className="text-sm font-semibold text-slate-800">Letterbox</p>
                                <p className="text-[10px] text-slate-500">OSD = today + 2 working days</p>
                            </div>
                        </button>
                        <button
                            onClick={() => handleManualSend("post")}
                            disabled={sending}
                            className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-left transition-colors"
                        >
                            <Truck className="w-4 h-4 text-orange-600 shrink-0" />
                            <div>
                                <p className="text-sm font-semibold text-slate-800">Posted</p>
                                <p className="text-[10px] text-slate-500">OSD = today + 4 working days</p>
                            </div>
                        </button>
                    </div>
                    <button
                        onClick={() => setShowDeliveryPicker(false)}
                        className="mt-2 text-xs text-slate-400 hover:text-slate-600"
                    >
                        Cancel
                    </button>
                </div>
            )}

            {/* Actions */}
            <div className="px-6 py-4 bg-white">
                <div className="flex items-center justify-between mb-3">
                    <div className="text-xs text-slate-400">
                        <AlertCircle className="w-3 h-3 inline mr-1" />
                        Dates calculated by NZ legal engine (not AI)
                    </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                    {onClose && (
                        <Button
                            variant="ghost"
                            onClick={onClose}
                            disabled={sending || downloading}
                            className="sm:order-1"
                        >
                            Cancel
                        </Button>
                    )}

                    {/* Download PDF Only */}
                    {!sentNoticeId && (noticeType === "S55_STRIKE" || noticeType === "S56_REMEDY") && (
                        <Button
                            variant="outline"
                            onClick={handleDownloadPDF}
                            disabled={sending || downloading || !!sentNoticeId}
                            className="sm:order-2 text-slate-700 border-slate-300"
                        >
                            {downloading ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                                <Download className="w-4 h-4 mr-2" />
                            )}
                            Download PDF
                        </Button>
                    )}

                    {/* Download & Mark as Sent (manual delivery) */}
                    {!sentNoticeId && (noticeType === "S55_STRIKE" || noticeType === "S56_REMEDY") && (
                        <Button
                            variant="outline"
                            onClick={() => {
                                setShowDeliveryPicker(!showDeliveryPicker);
                            }}
                            disabled={sending || downloading || !!sentNoticeId}
                            className="sm:order-3 text-slate-700 border-slate-300"
                        >
                            <Truck className="w-4 h-4 mr-2" />
                            Manual Send
                        </Button>
                    )}

                    {/* Send via Email */}
                    <Button
                        onClick={() => setShowConfirmationModal(true)}
                        disabled={sending || downloading || !!sentNoticeId}
                        className={`sm:order-4 flex-1 ${
                            isAboutToBeThirdStrike
                                ? "bg-overdue-red hover:bg-overdue-red/90"
                                : "bg-nav-black hover:bg-black"
                        } text-white font-black`}
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
                                Send via Email
                            </>
                        )}
                    </Button>
                </div>
            </div>

            {/* Legal Confirmation Modal */}
            <LegalConfirmationModal
                isOpen={showConfirmationModal}
                onClose={() => setShowConfirmationModal(false)}
                onConfirm={() => {
                    setShowConfirmationModal(false);
                    handleSendNotice();
                }}
                isLoading={sending}
                noticeType={getNoticeTitle(noticeType, effectiveStrikeNumber)}
                tenantName={tenantName}
            />
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

// Helper components for field editor
function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{title}</h4>
            <div className="grid grid-cols-2 gap-2">{children}</div>
        </div>
    );
}

function FieldInput({
    label, value, onChange, prefix, placeholder,
}: {
    label: string; value: string | undefined; onChange: (v: string) => void; prefix?: string; placeholder?: string;
}) {
    return (
        <div>
            <label className="text-[11px] text-slate-500 block mb-0.5">{label}</label>
            <div className="flex items-center">
                {prefix && <span className="text-xs text-slate-400 mr-1">{prefix}</span>}
                <input
                    type="text"
                    value={value || ""}
                    onChange={e => onChange(e.target.value)}
                    placeholder={placeholder}
                    className="w-full text-sm px-2 py-1 border border-slate-200 rounded bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
                />
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
