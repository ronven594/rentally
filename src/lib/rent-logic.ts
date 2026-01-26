/**
 * Rent Logic - Compatibility Shim
 *
 * DEPRECATED: This file is maintained for backwards compatibility.
 * New code should import directly from:
 * - date-utils.ts for date utilities (isNZWorkingDay, addWorkingDays, etc.)
 * - legal-engine.ts for RTA compliance functions (calculateTribunalDeadline, etc.)
 *
 * This file re-exports commonly used functions from those modules.
 */

// Re-export date utilities from date-utils
export {
    isNZWorkingDay,
    isNZWorkingDay as isWorkingDay, // Alias for backwards compatibility
    addWorkingDays,
    getNextWorkingDay,
    countWorkingDaysBetween
} from "./date-utils";

// Re-export RTA functions from legal-engine
export {
    calculateTribunalDeadline,
    calculateTribunalDeadline as getTribunalFilingDeadline, // Alias for backwards compatibility
    calculateRemedyExpiryDate,
    calculateRemedyExpiryDate as calculateRemedyDeadline, // Alias for backwards compatibility
    calculateOfficialServiceDate,
    calculateServiceDate,
    canIssueStrikeNotice as canIssueSection56Notice,
    getValidStrikesInWindow
} from "./legal-engine";

/**
 * Helper to determine payment status - kept here for backwards compatibility
 *
 * @param dueDate - Due date string (YYYY-MM-DD or similar)
 * @param paidDate - Paid date string (YYYY-MM-DD or null/undefined)
 * @param today - Current date for comparison (defaults to now)
 * @returns Status string: "Paid", "Late", "Unpaid", or "Pending"
 */
export function getPaymentStatus(dueDate: string, paidDate?: string | null, today: Date = new Date()): string {
    const dueDateObj = new Date(dueDate);

    // If paid, determine if it was late
    if (paidDate) {
        const paidDateObj = new Date(paidDate);
        return paidDateObj > dueDateObj ? "Late" : "Paid";
    }

    // Not paid - check if overdue (due date is in the past)
    if (dueDateObj < today) {
        return "Unpaid";
    }

    return "Pending";
}

/**
 * Helper to check if a payment qualifies as a strike - kept for backwards compatibility
 *
 * @param dueDate - Due date string (YYYY-MM-DD or similar)
 * @param paidDate - Paid date string (YYYY-MM-DD or null/undefined)
 * @param today - Current date for comparison (defaults to now)
 * @returns true if the payment is overdue and unpaid
 */
export function isStrike(dueDate: string, paidDate?: string | null, today: Date = new Date()): boolean {
    // A strike can be issued if payment is 5+ working days overdue
    // For simplicity, this returns true if the payment is unpaid and overdue
    // Real strike eligibility should use legal-engine.ts functions
    const status = getPaymentStatus(dueDate, paidDate, today);
    return status === "Unpaid";
}
