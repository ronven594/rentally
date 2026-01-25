/**
 * Tenant Status Engine - Kiwi Minimalism Edition
 *
 * Centralized status logic for consistent messaging across the dashboard.
 * All status text uses NZ colloquialisms for a friendly, local feel.
 */

import { PaymentFrequency } from "@/types";

export type TenantStatusType = 'sweet_as' | 'bit_behind' | 'arrears' | 'notice_required';

/**
 * Format frequency for display (lowercase, informal)
 * e.g., "Weekly" -> "week", "Fortnightly" -> "fortnight", "Monthly" -> "month"
 */
export function formatFrequencyLabel(frequency: PaymentFrequency): string {
    switch (frequency) {
        case "Weekly": return "week";
        case "Fortnightly": return "fortnight";
        case "Monthly": return "month";
        default: return "week";
    }
}

/**
 * Get the interval in days for a frequency (approximate for monthly)
 */
export function getFrequencyIntervalDays(frequency: PaymentFrequency): number {
    switch (frequency) {
        case "Weekly": return 7;
        case "Fortnightly": return 14;
        case "Monthly": return 30; // Approximate, actual calculation uses calendar months
        default: return 7;
    }
}

export interface TenantStatus {
    type: TenantStatusType;
    label: string;
    daysLate: number;
    color: string;
    textClass: string;
    badgeClass: string;
    showPulse: boolean;
    pulseColor: string;
    strikeGlow: 0 | 1 | 2;
    footerMessage: (name: string) => string;
    isUrgent: boolean;
}

/**
 * Get tenant status based on days late
 *
 * @param daysLate - Number of days the tenant is late (negative = paid ahead)
 * @returns TenantStatus object with all display properties
 */
export function getTenantStatus(daysLate: number): TenantStatus {
    // Sweet As - On time or ahead
    if (daysLate <= 0) {
        return {
            type: 'sweet_as',
            label: 'SWEET AS',
            daysLate: 0,
            color: '#008060',
            textClass: 'text-safe-green',
            badgeClass: 'bg-[#E3FBE3] text-[#008060]',
            showPulse: true,
            pulseColor: 'bg-safe-green',
            strikeGlow: 0,
            footerMessage: (name) => `${name} is consistently on time. Everything's choice.`,
            isUrgent: false,
        };
    }

    // A bit behind - 1-3 days late
    if (daysLate >= 1 && daysLate <= 3) {
        return {
            type: 'bit_behind',
            label: `A BIT BEHIND`,
            daysLate,
            color: '#DC2626',
            textClass: 'text-overdue-red italic',
            badgeClass: 'bg-rose-50 text-rose-600',
            showPulse: false,
            pulseColor: '',
            strikeGlow: 0,
            footerMessage: (name) => `${name} is ${daysLate} day${daysLate > 1 ? 's' : ''} behind. Keep an eye on it.`,
            isUrgent: false,
        };
    }

    // Behind - 4-13 days late (Strike 1 territory)
    if (daysLate >= 4 && daysLate <= 13) {
        return {
            type: 'arrears', // Keep technical type name for backward compatibility
            label: 'BEHIND',
            daysLate,
            color: '#DC2626',
            textClass: 'text-overdue-red font-black',
            badgeClass: 'bg-rose-100 text-rose-700 font-black',
            showPulse: true,
            pulseColor: 'bg-rose-500',
            strikeGlow: 1,
            footerMessage: (name) => `${name} is ${daysLate} days behind. Strike 1 notice may be warranted.`,
            isUrgent: true,
        };
    }

    // Notice Required - 14+ days late (Strike 2+ territory)
    return {
        type: 'notice_required',
        label: 'NOTICE REQUIRED',
        daysLate,
        color: '#991B1B',
        textClass: 'text-red-800 font-black',
        badgeClass: 'bg-red-600 text-white font-black animate-pulse',
        showPulse: true,
        pulseColor: 'bg-red-600',
        strikeGlow: 2,
        footerMessage: (name) => `${name} is ${daysLate} days overdue. 14-day notice is ready to send.`,
        isUrgent: true,
    };
}

/**
 * Get the most urgent tenant status from a list
 */
export function getMostUrgentStatus(statuses: TenantStatus[]): TenantStatus | null {
    if (statuses.length === 0) return null;

    // Priority: notice_required > arrears > bit_behind > sweet_as
    const priority: TenantStatusType[] = ['notice_required', 'arrears', 'bit_behind', 'sweet_as'];

    for (const type of priority) {
        const found = statuses.find(s => s.type === type);
        if (found) return found;
    }

    return statuses[0];
}

/**
 * Get property-level status based on all tenants
 */
export function getPropertyStatus(tenantStatuses: TenantStatus[]): {
    status: 'safe' | 'warning' | 'overdue' | 'neutral';
    text: string;
    isOverdue: boolean;
} {
    if (tenantStatuses.length === 0) {
        return { status: 'neutral', text: 'NO TENANTS', isOverdue: false };
    }

    const hasNoticeRequired = tenantStatuses.some(s => s.type === 'notice_required');
    const hasArrears = tenantStatuses.some(s => s.type === 'arrears');
    const hasBitBehind = tenantStatuses.some(s => s.type === 'bit_behind');

    if (hasNoticeRequired) {
        return { status: 'overdue', text: 'ACTION NEEDED', isOverdue: true };
    }

    if (hasArrears) {
        return { status: 'overdue', text: 'BEHIND', isOverdue: true };
    }

    if (hasBitBehind) {
        return { status: 'warning', text: 'MONITOR', isOverdue: false };
    }

    return { status: 'safe', text: 'SWEET AS', isOverdue: false };
}

/**
 * RTA Severity Levels (for visual consistency across PropertyCard, TenantCard, StatusBadge)
 */
/**
 * Kiwi-friendly Status Helper with 4-Phase Visual Escalation
 *
 * Phase 1: "All Good" (Green) - No arrears
 * Phase 2: "Caution" (Glowing Amber Border) - 1 calendar day to 4 working days overdue
 * Phase 3: "Strike Warning" (Solid Amber) - 5+ working days OR 1-2 active strikes
 * Phase 4: "Termination Eligible" (Solid Red) - 3 strikes OR 21+ calendar days
 */
export interface KiwiStatus {
    label: string;
    color: string; // Hex color for dots/badges
    severity: 'safe' | 'caution' | 'warning' | 'critical';
    actionText: string;
}

export function getKiwiStatus(
    daysArrears: number,
    workingDaysOverdue: number,
    totalArrears: number,
    activeStrikeCount: number = 0
): KiwiStatus {
    // PHASE 4: TERMINATION ELIGIBLE (Solid Red)
    // Trigger: 3 active strikes OR 21+ calendar days overdue
    if (activeStrikeCount >= 3 || daysArrears >= 21) {
        return {
            label: "Termination Eligible",
            color: "#DC2626", // Red-600
            severity: 'critical',
            actionText: "Termination Eligible"
        };
    }

    // PHASE 3: STRIKE WARNING (Solid Amber)
    // Trigger: 5+ working days overdue OR 1-2 active strikes
    if (workingDaysOverdue >= 5 || (activeStrikeCount >= 1 && activeStrikeCount <= 2)) {
        return {
            label: "Strike Warning",
            color: "#F59E0B", // Amber-500
            severity: 'warning',
            actionText: activeStrikeCount > 0 ? `${activeStrikeCount} Strike${activeStrikeCount > 1 ? 's' : ''} Active` : "Strike Notice Ready"
        };
    }

    // PHASE 2: CAUTION (Glowing Amber Border)
    // Trigger: 1 calendar day overdue but less than 5 working days
    if (totalArrears > 0 && daysArrears >= 1 && workingDaysOverdue < 5) {
        return {
            label: "Caution",
            color: "#F59E0B", // Amber-500 (same as warning, but different styling)
            severity: 'caution',
            actionText: "Payment Pending"
        };
    }

    // PHASE 1: ALL GOOD (Green)
    // Trigger: No arrears
    return {
        label: "All Good",
        color: "#008060", // Green-700
        severity: 'safe',
        actionText: "Up to Date"
    };
}

/**
 * RTA Severity type matching 4-Phase Visual Escalation
 * - safe: Phase 1 (All Good - Green)
 * - caution: Phase 2 (Caution - Glowing Amber Border)
 * - warning: Phase 3 (Strike Warning - Solid Amber)
 * - critical: Phase 4 (Termination Eligible - Solid Red)
 */
export type RTASeverity = 'safe' | 'caution' | 'warning' | 'critical';

/**
 * Get RTA severity level from tenant legal status.
 * Use this to ensure PropertyCard dots and TenantCard colors are perfectly synchronized.
 */
export function getRTASeverity(daysOverdue: number, workingDaysOverdue: number, totalArrears: number = 0, activeStrikeCount: number = 0): RTASeverity {
    return getKiwiStatus(daysOverdue, workingDaysOverdue, totalArrears, activeStrikeCount).severity;
}

/**
 * Get smart obligation message for the dashboard banner
 * CRITICAL: daysLate parameter represents WORKING DAYS (not calendar days)
 */
export interface ObligationMessage {
    type: 'action' | 'reconcile' | 'monitor' | 'none';
    message: string;
    tenantName: string;
    propertyAddress: string;
    daysLate: number; // Working days overdue (or calendar days for Monitor phase)
    calendarDays?: number; // Calendar days overdue (for Monitor phase display)
    urgency: 'critical' | 'high' | 'monitor' | 'none';
}

export function getObligationMessages(
    tenants: Array<{ name: string; propertyAddress: string; daysLate: number; calendarDays?: number }>
): ObligationMessage[] {
    const messages: ObligationMessage[] = [];

    // Sort by urgency (most working days late first)
    const sorted = [...tenants].sort((a, b) => b.daysLate - a.daysLate);

    for (const tenant of sorted) {
        // 10+ working days: Strike 2/3 territory
        if (tenant.daysLate >= 10) {
            messages.push({
                type: 'action',
                message: `ACTION REQUIRED: SECTION 55 STRIKE NOTICE READY`,
                tenantName: tenant.name,
                propertyAddress: tenant.propertyAddress,
                daysLate: tenant.daysLate,
                calendarDays: tenant.calendarDays,
                urgency: 'critical',
            });
            // 5-9 working days: Strike 1 territory
        } else if (tenant.daysLate >= 5) {
            messages.push({
                type: 'reconcile',
                message: `RECONCILE: ${tenant.name.toUpperCase()} IS ${tenant.daysLate} WORKING DAYS BEHIND`,
                tenantName: tenant.name,
                propertyAddress: tenant.propertyAddress,
                daysLate: tenant.daysLate,
                calendarDays: tenant.calendarDays,
                urgency: 'high',
            });
            // 1-4 working days: Monitor phase
        } else if (tenant.daysLate >= 1 || (tenant.calendarDays && tenant.calendarDays >= 1)) {
            const displayDays = tenant.calendarDays || tenant.daysLate;
            messages.push({
                type: 'monitor',
                message: `PAYMENT PENDING: ${tenant.name.toUpperCase()} IS ${displayDays} DAY${displayDays !== 1 ? 'S' : ''} OVERDUE`,
                tenantName: tenant.name,
                propertyAddress: tenant.propertyAddress,
                daysLate: tenant.daysLate,
                calendarDays: tenant.calendarDays,
                urgency: 'monitor',
            });
        }
    }

    return messages;
}
