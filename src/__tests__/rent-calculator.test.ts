/**
 * Rent Calculator Tests
 *
 * These tests verify the deterministic rent calculation engine.
 * Each test case uses the formula:
 *   Balance = (Cycles × Rent) + Opening Arrears - Payments
 *
 * Run with: npx jest src/__tests__/rent-calculator.test.ts
 */

import { calculateRentState, type RentSettings, type Payment } from '../lib/rent-calculator';
import { formatDateISO } from '../lib/date-utils';

// Helper to create a date for testing
function testDate(dateStr: string): Date {
    return new Date(dateStr + 'T12:00:00.000Z'); // Noon UTC to avoid timezone issues
}

// Helper to format result for debugging
function debugResult(result: ReturnType<typeof calculateRentState>) {
    return {
        currentBalance: result.currentBalance,
        totalRentDue: result.totalRentDue,
        totalPayments: result.totalPayments,
        openingArrears: result.openingArrears,
        cyclesElapsed: result.cyclesElapsed,
        cyclesPaidInFull: result.cyclesPaidInFull,
        cyclesUnpaid: result.cyclesUnpaid,
        daysOverdue: result.daysOverdue,
        paidUntilDate: result.paidUntilDate ? formatDateISO(result.paidUntilDate) : null,
        firstDueDate: formatDateISO(result.firstDueDate),
        nextDueDate: formatDateISO(result.nextDueDate),
        oldestUnpaidDueDate: result.oldestUnpaidDueDate ? formatDateISO(result.oldestUnpaidDueDate) : null,
    };
}

describe('Rent Calculator - Deterministic Calculation', () => {
    // =========================================================================
    // EXAMPLE 1: New tenant, no payments
    // =========================================================================
    describe('Example 1: New tenant, no payments', () => {
        /**
         * SCENARIO:
         * - Frequency: Weekly
         * - Rent: $400
         * - Due day: Wednesday
         * - Tracking start: Monday 6 Jan 2025
         * - Opening arrears: $0
         * - Payments: []
         * - Effective date: Thursday 16 Jan 2025
         *
         * EXPECTED:
         * - First due date: Wed 8 Jan (first Wednesday on/after 6 Jan)
         * - Cycles elapsed: 2 (8 Jan, 15 Jan)
         * - Total rent due: $800
         * - Total payments: $0
         * - Current balance: $800
         * - Cycles paid: 0
         * - Paid until: null
         * - Days overdue: 8 (from 8 Jan to 16 Jan)
         */
        const settings: RentSettings = {
            frequency: 'Weekly',
            rentAmount: 400,
            rentDueDay: 'Wednesday',
            trackingStartDate: '2025-01-06',
            openingArrears: 0
        };

        const payments: Payment[] = [];
        const effectiveDate = testDate('2025-01-16');

        it('should calculate correct first due date (Ground Zero)', () => {
            const result = calculateRentState(settings, payments, effectiveDate);
            console.log('Example 1 result:', debugResult(result));

            // First Wednesday on/after Jan 6 (Monday) is Jan 8
            expect(formatDateISO(result.firstDueDate)).toBe('2025-01-08');
        });

        it('should calculate correct cycles elapsed', () => {
            const result = calculateRentState(settings, payments, effectiveDate);

            // Jan 8 (cycle 1) and Jan 15 (cycle 2) have both passed by Jan 16
            expect(result.cyclesElapsed).toBe(2);
        });

        it('should calculate correct total rent due', () => {
            const result = calculateRentState(settings, payments, effectiveDate);

            // 2 cycles × $400 = $800
            expect(result.totalRentDue).toBe(800);
        });

        it('should calculate correct current balance', () => {
            const result = calculateRentState(settings, payments, effectiveDate);

            // $800 + $0 opening - $0 payments = $800
            expect(result.currentBalance).toBe(800);
        });

        it('should calculate correct cycles paid', () => {
            const result = calculateRentState(settings, payments, effectiveDate);

            expect(result.cyclesPaidInFull).toBe(0);
            expect(result.cyclesUnpaid).toBe(2);
        });

        it('should have null paid until date', () => {
            const result = calculateRentState(settings, payments, effectiveDate);

            expect(result.paidUntilDate).toBeNull();
        });

        it('should calculate correct days overdue', () => {
            const result = calculateRentState(settings, payments, effectiveDate);

            // Days from Jan 8 to Jan 16 = 8 days
            expect(result.daysOverdue).toBe(8);
        });

        it('should identify oldest unpaid due date', () => {
            const result = calculateRentState(settings, payments, effectiveDate);

            expect(result.oldestUnpaidDueDate).not.toBeNull();
            expect(formatDateISO(result.oldestUnpaidDueDate!)).toBe('2025-01-08');
        });
    });

    // =========================================================================
    // EXAMPLE 2: Tenant with opening arrears and partial payment
    // =========================================================================
    describe('Example 2: Tenant with opening arrears and partial payment', () => {
        /**
         * SCENARIO:
         * - Frequency: Weekly
         * - Rent: $400
         * - Due day: Wednesday
         * - Tracking start: Mon 6 Jan 2025
         * - Opening arrears: $600
         * - Payments: [$1000 on 10 Jan]
         * - Effective date: Thu 16 Jan 2025
         *
         * EXPECTED:
         * - Total rent due: $800 (2 cycles)
         * - Opening arrears: $600
         * - Total payments: $1000
         * - Current balance: $800 + $600 - $1000 = $400
         * - Payments for rent: $1000 - $600 = $400 (after clearing opening)
         * - Cycles paid: floor($400/$400) = 1
         * - Paid until: Wed 8 Jan (the first cycle's due date)
         * - Days overdue: 1 (from 15 Jan to 16 Jan)
         */
        const settings: RentSettings = {
            frequency: 'Weekly',
            rentAmount: 400,
            rentDueDay: 'Wednesday',
            trackingStartDate: '2025-01-06',
            openingArrears: 600
        };

        const payments: Payment[] = [
            { id: 'p1', amount: 1000, date: '2025-01-10' }
        ];
        const effectiveDate = testDate('2025-01-16');

        it('should calculate correct total rent due', () => {
            const result = calculateRentState(settings, payments, effectiveDate);
            console.log('Example 2 result:', debugResult(result));

            expect(result.totalRentDue).toBe(800);
        });

        it('should calculate correct current balance', () => {
            const result = calculateRentState(settings, payments, effectiveDate);

            // $800 + $600 - $1000 = $400
            expect(result.currentBalance).toBe(400);
        });

        it('should calculate correct cycles paid (after opening arrears)', () => {
            const result = calculateRentState(settings, payments, effectiveDate);

            // $1000 - $600 opening = $400 for rent
            // floor($400 / $400) = 1 cycle paid
            expect(result.cyclesPaidInFull).toBe(1);
            expect(result.cyclesUnpaid).toBe(1);
        });

        it('should calculate correct paid until date', () => {
            const result = calculateRentState(settings, payments, effectiveDate);

            // Paid until the first cycle's due date (Jan 8)
            expect(result.paidUntilDate).not.toBeNull();
            expect(formatDateISO(result.paidUntilDate!)).toBe('2025-01-08');
        });

        it('should calculate correct days overdue', () => {
            const result = calculateRentState(settings, payments, effectiveDate);

            // Oldest unpaid is cycle 2 (Jan 15)
            // Days from Jan 15 to Jan 16 = 1 day
            expect(result.daysOverdue).toBe(1);
        });

        it('should identify oldest unpaid due date as second cycle', () => {
            const result = calculateRentState(settings, payments, effectiveDate);

            // First cycle is paid, so oldest unpaid is Jan 15 (second Wednesday)
            expect(result.oldestUnpaidDueDate).not.toBeNull();
            expect(formatDateISO(result.oldestUnpaidDueDate!)).toBe('2025-01-15');
        });
    });

    // =========================================================================
    // EXAMPLE 3: Tenant paid ahead (credit)
    // =========================================================================
    describe('Example 3: Tenant paid ahead (credit)', () => {
        /**
         * SCENARIO:
         * - Frequency: Weekly
         * - Rent: $400
         * - Tracking start: Mon 6 Jan 2025
         * - Opening arrears: $0
         * - Payments: [$2000 on 5 Jan]
         * - Effective date: Thu 16 Jan 2025
         *
         * EXPECTED:
         * - Total rent due: $800
         * - Current balance: $800 - $2000 = -$1200 (credit)
         * - Cycles paid: floor($2000/$400) = 5
         * - Paid until: effective date (can't be future)
         * - Days overdue: 0
         */
        const settings: RentSettings = {
            frequency: 'Weekly',
            rentAmount: 400,
            rentDueDay: 'Wednesday',
            trackingStartDate: '2025-01-06',
            openingArrears: 0
        };

        const payments: Payment[] = [
            { id: 'p1', amount: 2000, date: '2025-01-05' }
        ];
        const effectiveDate = testDate('2025-01-16');

        it('should calculate negative balance (credit)', () => {
            const result = calculateRentState(settings, payments, effectiveDate);
            console.log('Example 3 result:', debugResult(result));

            // $800 - $2000 = -$1200
            expect(result.currentBalance).toBe(-1200);
            expect(result.hasCredit).toBe(true);
            expect(result.creditAmount).toBe(1200);
        });

        it('should calculate correct cycles paid', () => {
            const result = calculateRentState(settings, payments, effectiveDate);

            // floor($2000 / $400) = 5 cycles worth
            expect(result.cyclesPaidInFull).toBe(5);
        });

        it('should cap paid until date at effective date', () => {
            const result = calculateRentState(settings, payments, effectiveDate);

            // Paid until can't be in the future, so capped at effective date
            expect(result.paidUntilDate).not.toBeNull();
            expect(formatDateISO(result.paidUntilDate!)).toBe('2025-01-16');
        });

        it('should have zero days overdue', () => {
            const result = calculateRentState(settings, payments, effectiveDate);

            expect(result.daysOverdue).toBe(0);
            expect(result.isOverdue).toBe(false);
        });

        it('should have null oldest unpaid due date', () => {
            const result = calculateRentState(settings, payments, effectiveDate);

            expect(result.oldestUnpaidDueDate).toBeNull();
        });
    });

    // =========================================================================
    // ADDITIONAL EDGE CASES
    // =========================================================================
    describe('Edge Cases', () => {
        describe('Before first due date', () => {
            /**
             * SCENARIO: Effective date is before first due date
             * - Tracking start: Mon 6 Jan 2025
             * - First due: Wed 8 Jan 2025
             * - Effective date: Tue 7 Jan 2025
             *
             * EXPECTED:
             * - Cycles elapsed: 0
             * - Balance: $0 (no rent due yet)
             */
            it('should have zero cycles if before first due date', () => {
                const settings: RentSettings = {
                    frequency: 'Weekly',
                    rentAmount: 400,
                    rentDueDay: 'Wednesday',
                    trackingStartDate: '2025-01-06',
                    openingArrears: 0
                };

                const result = calculateRentState(settings, [], testDate('2025-01-07'));
                console.log('Before first due date result:', debugResult(result));

                expect(result.cyclesElapsed).toBe(0);
                expect(result.totalRentDue).toBe(0);
                expect(result.currentBalance).toBe(0);
                expect(result.isOverdue).toBe(false);
            });

            it('should still show balance if opening arrears exist', () => {
                const settings: RentSettings = {
                    frequency: 'Weekly',
                    rentAmount: 400,
                    rentDueDay: 'Wednesday',
                    trackingStartDate: '2025-01-06',
                    openingArrears: 500
                };

                const result = calculateRentState(settings, [], testDate('2025-01-07'));

                expect(result.cyclesElapsed).toBe(0);
                expect(result.totalRentDue).toBe(0);
                expect(result.currentBalance).toBe(500); // Opening arrears
                expect(result.isOverdue).toBe(true);
            });
        });

        describe('Monthly frequency', () => {
            /**
             * SCENARIO: Monthly rent on the 15th
             * - Tracking start: Jan 1, 2025
             * - Due day: 15
             * - Effective date: Feb 20, 2025
             *
             * EXPECTED:
             * - First due: Jan 15
             * - Cycles elapsed: 2 (Jan 15, Feb 15)
             */
            it('should handle monthly frequency correctly', () => {
                const settings: RentSettings = {
                    frequency: 'Monthly',
                    rentAmount: 2000,
                    rentDueDay: 15,
                    trackingStartDate: '2025-01-01',
                    openingArrears: 0
                };

                const result = calculateRentState(settings, [], testDate('2025-02-20'));
                console.log('Monthly frequency result:', debugResult(result));

                expect(formatDateISO(result.firstDueDate)).toBe('2025-01-15');
                expect(result.cyclesElapsed).toBe(2);
                expect(result.totalRentDue).toBe(4000);
                expect(result.currentBalance).toBe(4000);
            });

            it('should handle month-end day snapping (31st on Feb)', () => {
                const settings: RentSettings = {
                    frequency: 'Monthly',
                    rentAmount: 2000,
                    rentDueDay: 31,
                    trackingStartDate: '2025-01-01',
                    openingArrears: 0
                };

                const result = calculateRentState(settings, [], testDate('2025-03-15'));

                // Jan 31, Feb 28 (snapped), Mar has not passed yet
                expect(formatDateISO(result.firstDueDate)).toBe('2025-01-31');
                expect(result.cyclesElapsed).toBe(2);
            });
        });

        describe('Fortnightly frequency', () => {
            it('should handle fortnightly correctly', () => {
                const settings: RentSettings = {
                    frequency: 'Fortnightly',
                    rentAmount: 800,
                    rentDueDay: 'Friday',
                    trackingStartDate: '2025-01-06', // Monday
                    openingArrears: 0
                };

                // First Friday on/after Jan 6 is Jan 10
                // Second due date is Jan 24 (2 weeks later)
                const result = calculateRentState(settings, [], testDate('2025-01-25'));
                console.log('Fortnightly result:', debugResult(result));

                expect(formatDateISO(result.firstDueDate)).toBe('2025-01-10');
                expect(result.cyclesElapsed).toBe(2); // Jan 10 and Jan 24
                expect(result.totalRentDue).toBe(1600);
            });
        });

        describe('Tracking starts on due day', () => {
            it('should count first due date correctly when tracking starts on due day', () => {
                const settings: RentSettings = {
                    frequency: 'Weekly',
                    rentAmount: 400,
                    rentDueDay: 'Wednesday',
                    trackingStartDate: '2025-01-08', // Already Wednesday
                    openingArrears: 0
                };

                const result = calculateRentState(settings, [], testDate('2025-01-08'));
                console.log('Tracking starts on due day result:', debugResult(result));

                // First due is same day (Jan 8)
                expect(formatDateISO(result.firstDueDate)).toBe('2025-01-08');
                // On the due date, that cycle has elapsed
                expect(result.cyclesElapsed).toBe(1);
                expect(result.currentBalance).toBe(400);
            });
        });

        describe('Exact payment clears balance', () => {
            it('should show zero balance when payment equals total due', () => {
                const settings: RentSettings = {
                    frequency: 'Weekly',
                    rentAmount: 400,
                    rentDueDay: 'Wednesday',
                    trackingStartDate: '2025-01-06',
                    openingArrears: 0
                };

                // Exact payment for 2 cycles
                const payments: Payment[] = [
                    { id: 'p1', amount: 800, date: '2025-01-16' }
                ];

                const result = calculateRentState(settings, payments, testDate('2025-01-16'));

                expect(result.currentBalance).toBe(0);
                expect(result.isOverdue).toBe(false);
                expect(result.cyclesPaidInFull).toBe(2);
            });
        });

        describe('Multiple payments', () => {
            it('should sum multiple payments correctly', () => {
                const settings: RentSettings = {
                    frequency: 'Weekly',
                    rentAmount: 400,
                    rentDueDay: 'Wednesday',
                    trackingStartDate: '2025-01-06',
                    openingArrears: 0
                };

                const payments: Payment[] = [
                    { id: 'p1', amount: 200, date: '2025-01-10' },
                    { id: 'p2', amount: 200, date: '2025-01-12' },
                    { id: 'p3', amount: 400, date: '2025-01-15' }
                ];

                const result = calculateRentState(settings, payments, testDate('2025-01-16'));

                expect(result.totalPayments).toBe(800);
                expect(result.currentBalance).toBe(0);
                expect(result.cyclesPaidInFull).toBe(2);
            });
        });
    });
});
