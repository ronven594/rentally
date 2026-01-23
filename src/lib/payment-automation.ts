import { parseISO, addDays, addWeeks, isBefore, isAfter, format, getDay } from "date-fns";

/**
 * Day of week mapping for rent due days
 */
const DAY_OF_WEEK_MAP: Record<string, number> = {
    "Sunday": 0,
    "Monday": 1,
    "Tuesday": 2,
    "Wednesday": 3,
    "Thursday": 4,
    "Friday": 5,
    "Saturday": 6
};

/**
 * Find the next occurrence of a specific day of week on or after a given date
 * @param startDate - The date to start from
 * @param targetDayName - Name of the day (e.g., "Sunday", "Monday")
 * @returns The next occurrence of that day
 */
export function findNextDueDay(startDate: Date, targetDayName: string): Date {
    const targetDay = DAY_OF_WEEK_MAP[targetDayName];
    if (targetDay === undefined) {
        throw new Error(`Invalid day name: ${targetDayName}`);
    }

    const currentDay = getDay(startDate);

    // Calculate days to add using modulo to handle week wraparound
    // Formula: (targetDay - currentDay + 7) % 7
    // If result is 0, target day is today, so use 0 (not 7)
    let daysToAdd = (targetDay - currentDay + 7) % 7;

    console.log('🔍 Intermediate calculation:', {
        formula: `(${targetDay} - ${currentDay} + 7) % 7`,
        rawResult: (targetDay - currentDay + 7) % 7,
        daysToAdd: daysToAdd,
        willAddToDate: format(startDate, 'yyyy-MM-dd'),
        expectedResult: format(addDays(startDate, daysToAdd), 'yyyy-MM-dd (EEEE)')
    });

    const result = addDays(startDate, daysToAdd);

    console.log('🔍 findNextDueDay DEBUG:', {
        startDate: format(startDate, 'yyyy-MM-dd (EEEE)'),
        targetDayName,
        startDayNumber: currentDay,
        targetDayNumber: targetDay,
        daysToAdd,
        resultDate: format(result, 'yyyy-MM-dd (EEEE)')
    });

    return result;
}

/**
 * Calculate all rent due dates from lease start to today
 * @param leaseStartDate - ISO string of lease start date
 * @param frequency - "Weekly" or "Fortnightly"
 * @param rentDueDay - Day of week when rent is due (e.g., "Sunday")
 * @param today - Current date (or test date override)
 * @returns Array of ISO date strings for all due dates
 */
export function calculateDueDates(
    frequency: "Weekly" | "Fortnightly",
    rentDueDay: string,
    today: Date = new Date(),
    generationStartDate?: Date
): string[] {
    const dueDates: string[] = [];

    // CRITICAL: Payments ALWAYS start from Today (or the next available due date from today)
    // lease_start_date is ignored for calculations.
    const startSearchingFrom = generationStartDate || today;

    // User requested debug log
    console.log('📅 CALCULATING DUE DATES (Simplified):', {
        generationStartDate: generationStartDate ? format(generationStartDate, 'yyyy-MM-dd') : 'Using Today',
        startSearchingFrom: format(startSearchingFrom, 'yyyy-MM-dd'),
        today: format(today, 'yyyy-MM-dd'),
        rentDueDay,
        frequency
    });

    // Find first due date on or after the determined start point
    let currentDueDate = findNextDueDay(startSearchingFrom, rentDueDay);

    // Calculate interval based on frequency
    const intervalDays = frequency === "Weekly" ? 7 : 14;

    // Generate all due dates up to and INCLUDING the next upcoming due date
    const todayObj = today instanceof Date ? today : new Date(today);
    const todayTime = new Date(todayObj.getFullYear(), todayObj.getMonth(), todayObj.getDate()).getTime();

    // Safety limit: 100 iterations or ~2 years for Weekly
    let iterations = 0;
    while (iterations < 100) {
        iterations++;

        // Ensure we record the due date
        dueDates.push(format(currentDueDate, "yyyy-MM-dd"));

        // Check if we've reached our goal: 
        // We have at least one payment that is TODAY or in the FUTURE
        const currentTime = new Date(currentDueDate.getFullYear(), currentDueDate.getMonth(), currentDueDate.getDate()).getTime();
        if (currentTime >= todayTime) {
            break;
        }

        // Advance to next period
        currentDueDate = addDays(currentDueDate, intervalDays);

        // Fail-safe: don't generate more than 1 year into future
        if (isAfter(currentDueDate, addDays(todayObj, 366))) {
            break;
        }
    }

    console.log('📅 RESULTING DUE DATES:', dueDates);
    return dueDates;
}

/**
 * Calculate due dates with lease end date consideration
 * @param leaseStartDate - ISO string of lease start date
 * @param frequency - "Weekly" or "Fortnightly"
 * @param rentDueDay - Day of week when rent is due
 * @param today - Current date (or test date override)
 * @param leaseEndDate - Optional ISO string of lease end date
 * @returns Array of ISO date strings for all due dates
 */
export function calculateDueDatesWithEndDate(
    leaseStartDate: string | undefined, // Ignored
    frequency: "Weekly" | "Fortnightly",
    rentDueDay: string,
    today: Date = new Date(),
    leaseEndDate?: string, // Ignored
    generationStartDate?: Date
): string[] {
    return calculateDueDates(frequency, rentDueDay, today, generationStartDate);
}

/**
 * Check if a payment record should be generated for a due date
 * @param dueDate - The due date to check
 * @param existingPayments - Array of existing payment due dates for this tenant
 * @returns true if payment should be generated, false if duplicate
 */
export function shouldGeneratePayment(
    dueDate: string,
    existingPayments: string[]
): boolean {
    return !existingPayments.includes(dueDate);
}
