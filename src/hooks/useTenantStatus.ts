/**
 * useTenantStatus - Unified hook for tenant status determination
 *
 * This hook replaces scattered status calculations across TenantCard.tsx,
 * useRentalLogic.ts, and status-engine.ts with a single call to
 * calculateTenantStatus().
 *
 * Usage:
 *   const status = useTenantStatus(settings, payments, sentNotices, remedyNoticeSentAt, region, testDate);
 *   if (!status) return <Loading />;
 *   // status.severity.tierName, status.strikes, status.notices, etc.
 */

import { useMemo } from "react";
import {
    calculateTenantStatus,
    type TenantStatusResult
} from "@/lib/status-calculator";
import { toRentSettings, toPayments, type RentSettings, type Payment } from "@/lib/rent-calculator";
import type { StrikeNotice, Tenant, PaymentHistoryEntry } from "@/types";
import type { NZRegion } from "@/lib/nz-holidays";

/**
 * Calculate complete tenant status from raw settings, payments, and notices.
 *
 * @param settings - RentSettings (use toRentSettings() to convert from tenant)
 * @param payments - Payment[] (use toPayments() to convert from history)
 * @param sentNotices - StrikeNotice[] from tenant record
 * @param remedyNoticeSentAt - ISO date of remedy notice (optional)
 * @param region - NZ region for regional holidays
 * @param testDate - Optional test date override for simulation
 * @returns TenantStatusResult or null if inputs are missing
 */
export function useTenantStatus(
    settings: RentSettings | null,
    payments: Payment[] | null,
    sentNotices: StrikeNotice[] | null,
    remedyNoticeSentAt?: string | null,
    region?: NZRegion,
    testDate?: Date | null
): TenantStatusResult | null {
    return useMemo(() => {
        if (!settings || !payments || sentNotices === null || sentNotices === undefined) {
            return null;
        }
        return calculateTenantStatus(
            settings,
            payments,
            sentNotices,
            remedyNoticeSentAt,
            region,
            testDate
        );
    }, [settings, payments, sentNotices, remedyNoticeSentAt, region, testDate]);
}

/**
 * Convenience hook that accepts a raw Tenant object and derives status.
 *
 * This is the simplest way to get tenant status in a component:
 *   const status = useTenantStatusFromTenant(tenant, testDate);
 */
export function useTenantStatusFromTenant(
    tenant: Tenant | null,
    testDate?: Date | null
): TenantStatusResult | null {
    return useMemo(() => {
        if (!tenant || !tenant.frequency || !tenant.rentAmount || !tenant.rentDueDay) {
            return null;
        }

        const settings = toRentSettings({
            frequency: tenant.frequency,
            rentAmount: tenant.rentAmount,
            rentDueDay: tenant.rentDueDay,
            trackingStartDate: tenant.trackingStartDate,
            openingArrears: tenant.openingArrears,
            arrearsStartDate: tenant.arrearsStartDate
        });

        const payments = toPayments(
            (tenant.paymentHistory || []).map(entry => ({
                id: entry.id,
                amount_paid: entry.amount,
                paidDate: entry.date
            }))
        );

        const sentNotices = tenant.sentNotices || [];
        const region = tenant.region as NZRegion | undefined;

        return calculateTenantStatus(
            settings,
            payments,
            sentNotices,
            tenant.remedyNoticeSentAt,
            region,
            testDate
        );
    }, [tenant, testDate]);
}
