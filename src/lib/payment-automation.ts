import { addDays, addMonths, isAfter, format, getDay, setDate, startOfDay } from "date-fns";
import { PaymentFrequency } from "@/types";

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
 * Find the next monthly due date on or after a given date
 * @param startDate - The date to start from
 * @param dayOfMonth - Day of month (1-28)
 * @returns The next occurrence of that day of month
 */
export function findNextMonthlyDueDate(startDate: Date, dayOfMonth: number): Date {
    const normalizedStart = startOfDay(startDate);
    const currentDayOfMonth = normalizedStart.getDate();

    // If current day is before or on the due day this month, use this month
    // Otherwise, use next month
    let result: Date;
    if (currentDayOfMonth <= dayOfMonth) {
        result = setDate(normalizedStart, dayOfMonth);
    } else {
        // Move to next month, then set the day
        result = setDate(addMonths(normalizedStart, 1), dayOfMonth);
    }

    console.log('🔍 findNextMonthlyDueDate DEBUG:', {
        startDate: format(startDate, 'yyyy-MM-dd'),
        dayOfMonth,
        currentDayOfMonth,
        resultDate: format(result, 'yyyy-MM-dd')
    });

    return result;
}

/**
 * Calculate all rent due dates from a start point to today
 * @param frequency - "Weekly", "Fortnightly", or "Monthly"
 * @param rentDueDay - Day of week (for Weekly/Fortnightly) or day of month as string (for Monthly)
 * @param today - Current date (or test date override)
 * @param generationStartDate - Optional start date for generation
 * @returns Array of ISO date strings for all due dates
 */
export function calculateDueDates(
    frequency: PaymentFrequency,
    rentDueDay: string,
    today: Date = new Date(),
    generationStartDate?: Date
): string[] {
    const dueDates: string[] = [];
    const startSearchingFrom = generationStartDate || today;

    console.log('📅 CALCULATING DUE DATES:', {
        generationStartDate: generationStartDate ? format(generationStartDate, 'yyyy-MM-dd') : 'Using Today',
        startSearchingFrom: format(startSearchingFrom, 'yyyy-MM-dd'),
        today: format(today, 'yyyy-MM-dd'),
        rentDueDay,
        frequency
    });

    let currentDueDate: Date;

    // Determine first due date based on frequency
    if (frequency === "Monthly") {
        const dayOfMonth = parseInt(rentDueDay, 10) || 1;
        currentDueDate = findNextMonthlyDueDate(startSearchingFrom, dayOfMonth);
    } else {
        currentDueDate = findNextDueDay(startSearchingFrom, rentDueDay);
    }

    const todayObj = today instanceof Date ? today : new Date(today);
    const todayTime = startOfDay(todayObj).getTime();

    // Safety limit: 100 iterations
    let iterations = 0;
    while (iterations < 100) {
        iterations++;

        dueDates.push(format(currentDueDate, "yyyy-MM-dd"));

        // Check if we've reached today or future
        const currentTime = startOfDay(currentDueDate).getTime();
        if (currentTime >= todayTime) {
            break;
        }

        // Advance to next period based on frequency
        if (frequency === "Monthly") {
            currentDueDate = addMonths(currentDueDate, 1);
        } else if (frequency === "Fortnightly") {
            currentDueDate = addDays(currentDueDate, 14);
        } else {
            currentDueDate = addDays(currentDueDate, 7);
        }

        // Fail-safe: don't generate more than 1 year into future
        if (isAfter(currentDueDate, addDays(todayObj, 366))) {
            break;
        }
    }

    console.log('📅 RESULTING DUE DATES:', dueDates);
    return dueDates;
}

/**
 * Get the interval for advancing to the next payment period
 * @param frequency - Payment frequency
 * @param currentDate - Current date to calculate from (for Monthly)
 * @returns Object with method to get next date
 */
export function getNextPaymentDate(frequency: PaymentFrequency, currentDate: Date): Date {
    switch (frequency) {
        case "Monthly":
            return addMonths(currentDate, 1);
        case "Fortnightly":
            return addDays(currentDate, 14);
        case "Weekly":
        default:
            return addDays(currentDate, 7);
    }
}

/**
 * Calculate due dates with lease end date consideration
 */
export function calculateDueDatesWithEndDate(
    _leaseStartDate: string | undefined,
    frequency: PaymentFrequency,
    rentDueDay: string,
    today: Date = new Date(),
    _leaseEndDate?: string,
    generationStartDate?: Date
): string[] {
    return calculateDueDates(frequency, rentDueDay, today, generationStartDate);
}

/**
 * Check if a payment record should be generated for a due date
 */
export function shouldGeneratePayment(
    dueDate: string,
    existingPayments: string[]
): boolean {
    return !existingPayments.includes(dueDate);
}
