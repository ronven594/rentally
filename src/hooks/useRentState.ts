/**
 * useRentState Hook
 *
 * React hook that provides deterministic rent state calculation.
 * This hook wraps calculateRentState() with memoization for performance.
 *
 * CRITICAL: This is the preferred way to get rent balance in React components.
 * It ensures consistent calculations across the entire app.
 *
 * @example
 * ```tsx
 * const rentState = useRentState(settings, payments, testDate);
 *
 * if (rentState) {
 *   console.log('Balance:', rentState.currentBalance);
 *   console.log('Days overdue:', rentState.daysOverdue);
 *   console.log('Paid until:', rentState.paidUntilDate);
 * }
 * ```
 */

import { useMemo } from 'react';
import {
    calculateRentState,
    toRentSettings,
    toPayments,
    type RentSettings,
    type Payment,
    type RentCalculationResult,
    type PaymentFrequency
} from '@/lib/rent-calculator';

// ============================================================================
// TYPES
// ============================================================================

export interface UseRentStateInput {
    /** Payment frequency: Weekly, Fortnightly, or Monthly */
    frequency: PaymentFrequency;
    /** Rent amount per cycle */
    rentAmount: number;
    /** Day rent is due: "Monday"-"Sunday" for weekly/fortnightly, "1"-"31" for monthly */
    rentDueDay: string;
    /** When tracking started (ISO date string YYYY-MM-DD) */
    trackingStartDate?: string;
    /** Opening balance/arrears when tracking started */
    openingArrears?: number;
}

export interface UseRentStatePayment {
    /** Payment ID */
    id: string;
    /** Payment amount */
    amount_paid?: number;
    /** Alternative: full amount field */
    amount?: number;
    /** Payment date */
    paidDate?: string;
    /** Alternative: date field */
    date?: string;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook that calculates rent state with memoization.
 *
 * @param settings - Rent settings (or null if not available)
 * @param payments - Payment records (or null if not available)
 * @param testDate - Optional test date override for simulation
 * @returns RentCalculationResult or null if inputs are invalid
 */
export function useRentState(
    settings: RentSettings | UseRentStateInput | null,
    payments: Payment[] | UseRentStatePayment[] | null,
    testDate?: Date | null
): RentCalculationResult | null {
    // Create stable dependency string for settings
    const settingsKey = settings
        ? `${settings.frequency}|${settings.rentAmount}|${settings.rentDueDay}|${settings.trackingStartDate || ''}|${settings.openingArrears || 0}`
        : '';

    // Create stable dependency string for payments
    const paymentsKey = payments
        ? payments
            .map(p => {
                const amount = 'amount_paid' in p ? (p.amount_paid || p.amount || 0) : p.amount;
                const date = 'paidDate' in p ? (p.paidDate || (p as any).date || '') : p.date;
                return `${p.id}:${amount}:${date}`;
            })
            .sort()
            .join('|')
        : '';

    // Create stable dependency string for test date
    const testDateKey = testDate?.toISOString() || '';

    return useMemo(() => {
        if (!settings || !payments) {
            return null;
        }

        // Convert to RentSettings if needed
        const rentSettings: RentSettings = 'trackingStartDate' in settings && typeof settings.trackingStartDate === 'string'
            ? {
                frequency: settings.frequency,
                rentAmount: settings.rentAmount,
                rentDueDay: settings.frequency === 'Monthly'
                    ? parseInt(settings.rentDueDay as string, 10) || 1
                    : settings.rentDueDay,
                trackingStartDate: settings.trackingStartDate,
                openingArrears: settings.openingArrears || 0
            }
            : toRentSettings(settings as UseRentStateInput);

        // Convert to Payment array if needed
        const paymentArray: Payment[] = payments.length > 0 && 'amount_paid' in payments[0]
            ? toPayments(payments as UseRentStatePayment[])
            : payments as Payment[];

        return calculateRentState(rentSettings, paymentArray, testDate);
    }, [settingsKey, paymentsKey, testDateKey]);
}

/**
 * Hook that calculates rent state from a tenant object and payment records.
 *
 * This is a convenience wrapper for common use cases where you have:
 * - A tenant object with frequency, rentAmount, rentDueDay, etc.
 * - An array of payment records from the database
 *
 * @param tenant - Tenant object (or null)
 * @param payments - Payment records (or null)
 * @param testDate - Optional test date override
 * @returns RentCalculationResult or null if inputs are invalid
 */
export function useRentStateFromTenant(
    tenant: {
        frequency: PaymentFrequency;
        rentAmount: number;
        rentDueDay: string;
        trackingStartDate?: string;
        openingArrears?: number;
    } | null,
    payments: Array<{
        id: string;
        amount_paid?: number;
        amount?: number;
        paidDate?: string;
        status?: string;
    }> | null,
    testDate?: Date | null
): RentCalculationResult | null {
    // Create stable dependency string for tenant
    const tenantKey = tenant
        ? `${tenant.frequency}|${tenant.rentAmount}|${tenant.rentDueDay}|${tenant.trackingStartDate || ''}|${tenant.openingArrears || 0}`
        : '';

    // Create stable dependency string for payments
    // Only include actual payments (with amount_paid > 0 and a paidDate)
    const paymentsKey = payments
        ? payments
            .filter(p => (p.amount_paid || 0) > 0 && p.paidDate)
            .map(p => `${p.id}:${p.amount_paid}:${p.paidDate}`)
            .sort()
            .join('|')
        : '';

    // Create stable dependency string for test date
    const testDateKey = testDate?.toISOString() || '';

    return useMemo(() => {
        if (!tenant) {
            return null;
        }

        // Convert tenant to RentSettings
        const settings = toRentSettings(tenant);

        // Convert payments - only include actual payments (not unpaid records)
        const paymentArray = toPayments(payments || []);

        return calculateRentState(settings, paymentArray, testDate);
    }, [tenantKey, paymentsKey, testDateKey]);
}

// ============================================================================
// EXPORTS
// ============================================================================

export { calculateRentState, toRentSettings, toPayments };
export type { RentSettings, Payment, RentCalculationResult, PaymentFrequency };
