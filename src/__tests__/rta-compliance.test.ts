/**
 * RTA Compliance Tests
 *
 * Critical tests for New Zealand Residential Tenancies Act compliance.
 * These tests verify working day calculations, strike eligibility, and legal thresholds.
 */

import { parseISO } from 'date-fns';
import {
    calculateWorkingDaysOverdue,
    isNZWorkingDay,
    analyzeTenancySituation,
} from '@/lib/legal-engine';
import type { LedgerEntry, StrikeRecord } from '@/lib/legal-engine';
import { getActiveStrikes, calculateRentalLogic } from '@/hooks/useRentalLogic';
import type { RentPayment } from '@/types';

describe('RTA Compliance - Working Day Calculations', () => {
    it('Payment due Thursday - NOT strike-eligible on Monday (Working Day 2)', () => {
        const dueDate = '2026-01-15'; // Thursday
        const checkDate = parseISO('2026-01-19'); // Monday

        const workingDays = calculateWorkingDaysOverdue(dueDate, checkDate, 'Auckland');

        // Friday (16th) + Monday (19th) = 2 working days
        // Weekend (Sat 17th, Sun 18th) excluded
        expect(workingDays).toBe(2);
        expect(workingDays).toBeLessThan(5); // NOT eligible for strike notice
    });

    it('Payment due Thursday - IS strike-eligible on following Thursday (Working Day 5)', () => {
        const dueDate = '2026-01-15'; // Thursday
        const checkDate = parseISO('2026-01-22'); // Following Thursday

        const workingDays = calculateWorkingDaysOverdue(dueDate, checkDate, 'Auckland');

        // Fri(16), Mon(19), Tue(20), Wed(21), Thu(22) = 5 working days
        // Weekends excluded
        expect(workingDays).toBe(5);
        expect(workingDays).toBeGreaterThanOrEqual(5); // IS eligible!
    });

    it('Auckland Anniversary (Jan 26, 2026) is excluded from working days', () => {
        const anniversaryDate = parseISO('2026-01-26'); // Monday - Auckland Anniversary

        const isWorking = isNZWorkingDay(anniversaryDate, 'Auckland');

        expect(isWorking).toBe(false);
    });

    it('Payment due Saturday Jan 24 - First working day is Tuesday Jan 27', () => {
        const dueDate = '2026-01-24'; // Saturday
        const checkDate = parseISO('2026-01-27'); // Tuesday

        const workingDays = calculateWorkingDaysOverdue(dueDate, checkDate, 'Auckland');

        // Sat(24), Sun(25) = weekend (excluded)
        // Mon(26) = Auckland Anniversary (excluded)
        // Tue(27) = 1st working day
        expect(workingDays).toBe(1);
    });

    it('Summer blackout period excludes Dec 25 - Jan 15', () => {
        const dec26 = parseISO('2026-12-26'); // Saturday but also blackout
        const jan10 = parseISO('2027-01-10'); // Sunday but also blackout
        const jan15 = parseISO('2027-01-15'); // Thursday but last day of blackout

        expect(isNZWorkingDay(dec26, 'Auckland')).toBe(false); // Blackout + weekend
        expect(isNZWorkingDay(jan10, 'Auckland')).toBe(false); // Blackout (weekday excluded)
        expect(isNZWorkingDay(jan15, 'Auckland')).toBe(false); // Last day of blackout
    });
});

describe('RTA Compliance - Tribunal Eligibility', () => {
    it('21+ calendar days triggers immediate tribunal eligibility (Section 55(1)(a))', () => {
        const ledger: LedgerEntry[] = [
            {
                id: '1',
                tenantId: 'test-tenant',
                dueDate: '2026-01-01',
                amount: 500,
                amountPaid: 0,
                status: 'Unpaid',
            },
        ];

        const result = analyzeTenancySituation({
            tenantId: 'test-tenant',
            region: 'Auckland',
            ledger,
            strikeHistory: [],
            currentDate: parseISO('2026-01-22'), // 21 days later
        });

        expect(result.status).toBe('TRIBUNAL_ELIGIBLE');
        expect(result.analysis.daysArrears).toBeGreaterThanOrEqual(21);
    });

    it('3 strikes within 90 days triggers tribunal eligibility (Section 55(1)(aa))', () => {
        const ledger: LedgerEntry[] = [
            {
                id: '1',
                tenantId: 'test-tenant',
                dueDate: '2026-01-01',
                amount: 500,
                amountPaid: 0,
                status: 'Unpaid',
            },
        ];

        const strikeHistory: StrikeRecord[] = [
            {
                noticeId: 'strike-1',
                sentDate: '2026-01-10T10:00:00Z',
                officialServiceDate: '2026-01-10',
                type: 'S55_STRIKE',
                rentDueDate: '2026-01-01',
                amountOwed: 500,
            },
            {
                noticeId: 'strike-2',
                sentDate: '2026-01-20T10:00:00Z',
                officialServiceDate: '2026-01-20',
                type: 'S55_STRIKE',
                rentDueDate: '2026-01-08',
                amountOwed: 500,
            },
            {
                noticeId: 'strike-3',
                sentDate: '2026-02-01T10:00:00Z',
                officialServiceDate: '2026-02-01',
                type: 'S55_STRIKE',
                rentDueDate: '2026-01-15',
                amountOwed: 500,
            },
        ];

        const result = analyzeTenancySituation({
            tenantId: 'test-tenant',
            region: 'Auckland',
            ledger,
            strikeHistory,
            currentDate: parseISO('2026-02-02'),
        });

        expect(result.status).toBe('TRIBUNAL_ELIGIBLE');
        expect(result.analysis.strikeCount).toBe(3);
        expect(result.analysis.isWithin90Days).toBe(true);
    });
});

describe('RTA Compliance - Strike Eligibility', () => {
    it('5 working days overdue enables strike notice (Section 55)', () => {
        const ledger: LedgerEntry[] = [
            {
                id: '1',
                tenantId: 'test-tenant',
                dueDate: '2026-01-15', // Thursday
                amount: 500,
                amountPaid: 0,
                status: 'Unpaid',
            },
        ];

        const result = analyzeTenancySituation({
            tenantId: 'test-tenant',
            region: 'Auckland',
            ledger,
            strikeHistory: [],
            currentDate: parseISO('2026-01-22'), // Following Thursday = 5 working days
        });

        expect(result.analysis.workingDaysOverdue).toBe(5);
        expect(result.status).toBe('ACTION_REQUIRED');
    });

    it('Less than 5 working days does NOT enable strike notice', () => {
        const ledger: LedgerEntry[] = [
            {
                id: '1',
                tenantId: 'test-tenant',
                dueDate: '2026-01-15', // Thursday
                amount: 500,
                amountPaid: 0,
                status: 'Unpaid',
            },
        ];

        const result = analyzeTenancySituation({
            tenantId: 'test-tenant',
            region: 'Auckland',
            ledger,
            strikeHistory: [],
            currentDate: parseISO('2026-01-19'), // Monday = 2 working days
        });

        expect(result.analysis.workingDaysOverdue).toBe(2);
        expect(result.status).toBe('COMPLIANT'); // NOT ready for strike notice
    });
});

describe('RTA Compliance - Holiday Edge Cases', () => {
    it('Handles multiple consecutive holidays correctly', () => {
        // New Year period: Dec 31 (Wed), Jan 1 (Thu holiday), Jan 2 (Fri holiday)
        const dec31 = parseISO('2025-12-31'); // Wednesday
        const jan1 = parseISO('2026-01-01');  // Thursday - New Year's Day
        const jan2 = parseISO('2026-01-02');  // Friday - Day after New Year's

        expect(isNZWorkingDay(dec31, 'Auckland')).toBe(false); // Summer blackout
        expect(isNZWorkingDay(jan1, 'Auckland')).toBe(false);  // Holiday + blackout
        expect(isNZWorkingDay(jan2, 'Auckland')).toBe(false);  // Holiday + blackout
    });

    it('Waitangi Day (Feb 6, 2026) is excluded', () => {
        const waitangiDay = parseISO('2026-02-06'); // Friday

        const isWorking = isNZWorkingDay(waitangiDay, 'Auckland');

        expect(isWorking).toBe(false);
    });

    it('ANZAC Day Observed (Apr 27, 2026) is excluded', () => {
        const anzacDay = parseISO('2026-04-27'); // Monday (observed)

        const isWorking = isNZWorkingDay(anzacDay, 'Auckland');

        expect(isWorking).toBe(false);
    });
});

describe('RTA Compliance - Strike Memory (90-Day Rolling Window)', () => {
    it('Active strikes persist for 90 days even when rent is paid', () => {
        const strikeHistory: StrikeRecord[] = [
            {
                noticeId: 'strike-1',
                sentDate: '2026-01-10T10:00:00Z',
                officialServiceDate: '2026-01-10',
                type: 'S55_STRIKE',
                rentDueDate: '2026-01-01',
                amountOwed: 500,
            },
            {
                noticeId: 'strike-2',
                sentDate: '2026-02-10T10:00:00Z',
                officialServiceDate: '2026-02-10',
                type: 'S55_STRIKE',
                rentDueDate: '2026-02-01',
                amountOwed: 500,
            },
        ];

        // Check 30 days after second strike
        const currentDate = parseISO('2026-03-12');
        const activeCount = getActiveStrikes(strikeHistory, currentDate);

        // Both strikes should still be active (within 90 days)
        expect(activeCount).toBe(2);
    });

    it('Strikes expire after 90 days', () => {
        const strikeHistory: StrikeRecord[] = [
            {
                noticeId: 'strike-1',
                sentDate: '2026-01-01T10:00:00Z',
                officialServiceDate: '2026-01-01',
                type: 'S55_STRIKE',
                rentDueDate: '2025-12-25',
                amountOwed: 500,
            },
        ];

        // Check exactly 91 days after strike (outside window)
        const currentDate = parseISO('2026-04-02'); // 91 days later
        const activeCount = getActiveStrikes(strikeHistory, currentDate);

        // Strike should be expired (> 90 days)
        expect(activeCount).toBe(0);
    });

    it('Only counts S55_STRIKE notices, not S56_REMEDY notices', () => {
        const strikeHistory: StrikeRecord[] = [
            {
                noticeId: 'strike-1',
                sentDate: '2026-01-10T10:00:00Z',
                officialServiceDate: '2026-01-10',
                type: 'S55_STRIKE',
                rentDueDate: '2026-01-01',
                amountOwed: 500,
            },
            {
                noticeId: 'remedy-1',
                sentDate: '2026-01-15T10:00:00Z',
                officialServiceDate: '2026-01-15',
                type: 'S56_REMEDY',
                rentDueDate: '2026-01-01',
                amountOwed: 500,
            },
        ];

        const currentDate = parseISO('2026-02-01');
        const activeCount = getActiveStrikes(strikeHistory, currentDate);

        // Should only count the S55_STRIKE, not the S56_REMEDY
        expect(activeCount).toBe(1);
    });

    it('Strikes on day 90 boundary are still active', () => {
        const strikeHistory: StrikeRecord[] = [
            {
                noticeId: 'strike-1',
                sentDate: '2026-01-01T10:00:00Z',
                officialServiceDate: '2026-01-01',
                type: 'S55_STRIKE',
                rentDueDate: '2025-12-25',
                amountOwed: 500,
            },
        ];

        // Check exactly 90 days after strike (last day of window)
        const currentDate = parseISO('2026-04-01'); // Exactly 90 days later
        const activeCount = getActiveStrikes(strikeHistory, currentDate);

        // Strike should still be active on day 90
        expect(activeCount).toBe(1);
    });
});

describe('RTA Compliance - Non-Destructive Ledger Processing', () => {
    it('Tenant fully paid with 2 active strikes: Status=CLEAR, activeStrikeCount=2', () => {
        // Tenant received 2 strikes 30 and 60 days ago, but has since paid all rent
        const payments: RentPayment[] = [
            {
                id: '1',
                tenantId: 'test-tenant',
                dueDate: '2026-01-01',
                paidDate: '2026-01-20',
                amount: 500,
                amount_paid: 500,
                status: 'Paid', // PAID
            },
            {
                id: '2',
                tenantId: 'test-tenant',
                dueDate: '2026-02-01',
                paidDate: '2026-02-15',
                amount: 500,
                amount_paid: 500,
                status: 'Paid', // PAID
            },
        ];

        const strikeHistory: StrikeRecord[] = [
            {
                noticeId: 'strike-1',
                sentDate: '2026-01-10T10:00:00Z',
                officialServiceDate: '2026-01-10',
                type: 'S55_STRIKE',
                rentDueDate: '2026-01-01',
                amountOwed: 500,
            },
            {
                noticeId: 'strike-2',
                sentDate: '2026-02-10T10:00:00Z',
                officialServiceDate: '2026-02-10',
                type: 'S55_STRIKE',
                rentDueDate: '2026-02-01',
                amountOwed: 500,
            },
        ];

        const result = calculateRentalLogic({
            tenantId: 'test-tenant',
            payments,
            strikeHistory,
            region: 'Auckland',
            currentDate: parseISO('2026-03-01'),
        });

        // Status should be CLEAR (no unpaid rent)
        expect(result.status).toBe('CLEAR');
        expect(result.totalBalanceDue).toBe(0);
        expect(result.daysOverdue).toBe(0);

        // BUT activeStrikeCount should still be 2 (strike memory)
        expect(result.activeStrikeCount).toBe(2);
    });

    it('Full ledger history is preserved for legal analysis', () => {
        // Payment history with both paid and unpaid entries
        const payments: RentPayment[] = [
            {
                id: '1',
                tenantId: 'test-tenant',
                dueDate: '2025-12-01',
                paidDate: '2025-12-05',
                amount: 500,
                amount_paid: 500,
                status: 'Paid',
            },
            {
                id: '2',
                tenantId: 'test-tenant',
                dueDate: '2026-01-01',
                paidDate: '2026-01-10',
                amount: 500,
                amount_paid: 500,
                status: 'Paid',
            },
            {
                id: '3',
                tenantId: 'test-tenant',
                dueDate: '2026-02-01',
                amount: 500,
                amount_paid: 0,
                status: 'Unpaid', // Currently unpaid
            },
        ];

        const result = calculateRentalLogic({
            tenantId: 'test-tenant',
            payments,
            strikeHistory: [],
            region: 'Auckland',
            currentDate: parseISO('2026-02-10'),
        });

        // Should correctly calculate based on only the unpaid entry
        expect(result.totalBalanceDue).toBe(500);
        expect(result.daysOverdue).toBe(9); // Feb 10 - Feb 1 = 9 days

        // Working days calculation should have access to full history
        expect(result.workingDaysOverdue).toBeGreaterThan(0);
    });

    it('Partial payments are correctly tracked', () => {
        const payments: RentPayment[] = [
            {
                id: '1',
                tenantId: 'test-tenant',
                dueDate: '2026-01-01',
                amount: 500,
                amount_paid: 300, // Partial payment
                status: 'Partial',
            },
        ];

        const result = calculateRentalLogic({
            tenantId: 'test-tenant',
            payments,
            strikeHistory: [],
            region: 'Auckland',
            currentDate: parseISO('2026-01-10'),
        });

        // Should correctly calculate remaining balance
        expect(result.totalBalanceDue).toBe(200); // 500 - 300
        expect(result.status).toBe('PENDING'); // 9 days overdue (< 5 working days)
    });
});
