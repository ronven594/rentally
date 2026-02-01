import { parseISO, differenceInCalendarDays } from "date-fns";
import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Metadata stored when a 14-day remedy notice is sent.
 * Used to check if the SPECIFIC debt from the notice was paid.
 */
export interface S56NoticeMetadata {
    ledger_entry_ids: string[];
    due_dates: string[];
    total_amount_owed: number;
    unpaid_amounts: Record<string, number>;
}

export interface RemedyNoticeStatus {
    isExpired: boolean;
    isRemedied: boolean;
    daysRemaining: number | null;
    daysOverdue: number | null;
    canApplyToTribunal: boolean;
    amountRequired: number;
    amountPaidTowardNotice: number;
    expiryDate: string;
}

export interface StrikeWindowStatus {
    isExpired: boolean;
    daysRemaining: number | null;
    windowExpiryDate: string;
    activeStrikeCount: number;
}

export interface TribunalWindowStatus {
    isOpen: boolean;
    daysRemaining: number | null;
    deadlineDate: string;
}

/**
 * Check if a 14-day remedy notice has been remedied.
 *
 * CRITICAL: A remedy notice is debt-specific. We check if the SPECIFIC debt
 * mentioned in the notice has been paid, not whether current balance is zero.
 *
 * Example: Notice sent for $400 owed. Later $400 more accrues. Tenant pays $400.
 * Result: REMEDIED - because the original $400 was paid. New debt is separate.
 */
export async function checkRemedyNoticeStatus(
    noticeExpiryDate: string,
    noticeMetadata: S56NoticeMetadata,
    tenantId: string,
    supabase: SupabaseClient,
    currentDate: Date = new Date()
): Promise<RemedyNoticeStatus> {
    const expiry = parseISO(noticeExpiryDate);
    const daysDiff = differenceInCalendarDays(currentDate, expiry);

    // Query current payment status for the SPECIFIC due dates from the notice
    const { data: payments } = await supabase
        .from("payments")
        .select("due_date, amount, amount_paid")
        .eq("tenant_id", tenantId)
        .in("due_date", noticeMetadata.due_dates);

    // Calculate how much has been paid toward the notice's specific debts
    let amountPaidTowardNotice = 0;
    for (const dueDate of noticeMetadata.due_dates) {
        const payment = payments?.find(p => p.due_date === dueDate);
        if (payment) {
            amountPaidTowardNotice += payment.amount_paid || 0;
        }
    }

    // Remedied if paid >= amount owed at time of notice
    const isRemedied = amountPaidTowardNotice >= noticeMetadata.total_amount_owed;
    const isExpired = daysDiff > 0;

    return {
        isExpired,
        isRemedied,
        daysRemaining: isExpired ? null : Math.abs(daysDiff),
        daysOverdue: isExpired ? daysDiff : null,
        canApplyToTribunal: isExpired && !isRemedied,
        amountRequired: noticeMetadata.total_amount_owed,
        amountPaidTowardNotice,
        expiryDate: noticeExpiryDate,
    };
}

/**
 * Check if the 90-day strike window has expired.
 *
 * Per RTA Section 55(1)(aa): Strikes are only valid within a 90-day window
 * starting from the Official Service Date of the first strike.
 *
 * If 90 days pass without reaching 3 strikes, the window resets.
 * Any new strike after expiry starts a fresh 90-day window.
 */
export function checkStrikeWindowStatus(
    firstStrikeOSD: string,
    activeStrikeCount: number,
    currentDate: Date = new Date()
): StrikeWindowStatus {
    const firstStrike = parseISO(firstStrikeOSD);
    const windowEnd = new Date(firstStrike);
    windowEnd.setDate(windowEnd.getDate() + 90);

    const daysDiff = differenceInCalendarDays(windowEnd, currentDate);
    const isExpired = daysDiff < 0;

    return {
        isExpired,
        daysRemaining: isExpired ? null : daysDiff,
        windowExpiryDate: windowEnd.toISOString().split('T')[0],
        activeStrikeCount: isExpired ? 0 : activeStrikeCount,
    };
}

/**
 * Check if the 28-day tribunal filing window is still open after 3rd strike.
 *
 * Per RTA: Landlord must apply to Tribunal within 28 days of the 3rd strike OSD.
 */
export function checkTribunalWindowStatus(
    thirdStrikeOSD: string,
    currentDate: Date = new Date()
): TribunalWindowStatus {
    const thirdStrike = parseISO(thirdStrikeOSD);
    const deadline = new Date(thirdStrike);
    deadline.setDate(deadline.getDate() + 28);

    const daysDiff = differenceInCalendarDays(deadline, currentDate);

    return {
        isOpen: daysDiff >= 0,
        daysRemaining: daysDiff >= 0 ? daysDiff : null,
        deadlineDate: deadline.toISOString().split('T')[0],
    };
}

/**
 * Filter strikes to only those within the active 90-day window.
 *
 * Used when displaying strike count - expired strikes should not count.
 */
export function getActiveStrikes<T extends { officialServiceDate: string }>(
    strikes: T[],
    currentDate: Date = new Date()
): T[] {
    if (strikes.length === 0) return [];

    // Sort by OSD ascending
    const sorted = [...strikes].sort((a, b) =>
        a.officialServiceDate.localeCompare(b.officialServiceDate)
    );

    const firstStrikeOSD = sorted[0].officialServiceDate;
    const windowStatus = checkStrikeWindowStatus(firstStrikeOSD, sorted.length, currentDate);

    // If window expired, no strikes are active
    if (windowStatus.isExpired) return [];

    // Return all strikes within the window
    return sorted.filter(strike => {
        const strikeDate = parseISO(strike.officialServiceDate);
        const firstDate = parseISO(firstStrikeOSD);
        const daysDiff = differenceInCalendarDays(strikeDate, firstDate);
        return daysDiff >= 0 && daysDiff <= 90;
    });
}
