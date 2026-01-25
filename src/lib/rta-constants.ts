/**
 * RTA (Residential Tenancies Act 1986) Legal Constants
 *
 * Single source of truth for all legal compliance thresholds.
 * These values are defined by NZ tenancy law and must NOT be changed without legal review.
 *
 * References:
 * - Section 55(1)(a): 21 days in arrears
 * - Section 55(1)(aa): 3 strikes within 90 days
 * - Section 56: 14-day notice to remedy
 */

// ============================================================================
// CALENDAR DAY THRESHOLDS
// ============================================================================

/** Day 1 calendar day late: "Payment Pending" UI trigger */
export const LATE_THRESHOLD_DAYS = 1;

/** Day 1 calendar day late: Section 56 Notice availability */
export const REMEDY_NOTICE_ELIGIBLE_DAYS = 1;

/** 21+ calendar days in arrears: Section 55(1)(a) immediate tribunal eligibility */
export const TERMINATION_ELIGIBLE_DAYS = 21;

// ============================================================================
// WORKING DAY THRESHOLDS (RTA Critical)
// ============================================================================

/** 5+ working days overdue: Section 55(1)(aa) strike notice eligibility */
export const STRIKE_NOTICE_WORKING_DAYS = 5;

// ============================================================================
// NOTICE PERIODS
// ============================================================================

/** 14 calendar days: Section 56 remedy period given to tenant */
export const NOTICE_REMEDY_PERIOD = 14;

/** 90 calendar days: Strike window for 3-strike rule */
export const STRIKE_EXPIRY_DAYS = 90;

/** 28 calendar days: Tribunal filing window after 3rd strike */
export const TRIBUNAL_FILING_WINDOW_DAYS = 28;

// ============================================================================
// SERVICE CONFIGURATION
// ============================================================================

/**
 * Email service buffer days: 0 days
 * Assumes agreement for email service before 5pm = same-day Official Service Date (OSD)
 */
export const SERVICE_BUFFER_EMAIL = 0;

/** 5 PM cutoff hour for same-day email service */
export const SERVICE_CUTOFF_HOUR = 17;

// ============================================================================
// STRIKE THRESHOLDS
// ============================================================================

/** Maximum strikes before tribunal eligibility */
export const MAX_STRIKES = 3;

/** Minimum strikes to show StrikeBar component */
export const MIN_STRIKES_FOR_DISPLAY = 1;
