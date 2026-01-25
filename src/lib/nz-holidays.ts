/**
 * New Zealand Public Holidays Configuration
 *
 * This module provides dynamic holiday data for working day calculations.
 * Holidays are organized by year to prevent hardcoded date issues.
 */

export type NZRegion =
    | "Wellington"
    | "Auckland"
    | "Nelson"
    | "Taranaki"
    | "Otago"
    | "Southland"
    | "Hawke's Bay"
    | "Canterbury";

/**
 * NZ Holidays 2026 - Explicit constant for RTA compliance
 * Used for service date calculations and legal timeline verification
 */
export const NZ_HOLIDAYS_2026 = [
    "2026-01-01", // New Year's Day
    "2026-01-02", // Day after New Year's
    "2026-01-26", // Auckland Anniversary (observed)
    "2026-02-06", // Waitangi Day
    "2026-04-03", // Good Friday
    "2026-04-06", // Easter Monday
    "2026-04-27", // ANZAC Day (observed)
    "2026-06-01", // King's Birthday
    "2026-07-10", // Matariki
    "2026-10-26", // Labour Day
    "2026-12-25", // Christmas Day
    "2026-12-28", // Boxing Day (observed)
    // Note: Summer blackout Dec 25 - Jan 15 is handled separately in isNZWorkingDay
] as const;

export interface HolidayData {
    national: string[];
    regional: Record<NZRegion, string>;
}

// ============================================================================
// FLOATING HOLIDAY LOOKUP TABLES (Easter & Matariki)
// ============================================================================

/**
 * Easter dates by year (Good Friday and Easter Monday)
 * Easter is calculated using the lunar calendar and must be looked up
 */
const EASTER_DATES: Record<number, { goodFriday: string; easterMonday: string }> = {
    2026: { goodFriday: "2026-04-03", easterMonday: "2026-04-06" },
    2027: { goodFriday: "2027-04-02", easterMonday: "2027-04-05" },
    2028: { goodFriday: "2028-04-14", easterMonday: "2028-04-17" },
    2029: { goodFriday: "2029-03-30", easterMonday: "2029-04-02" },
    2030: { goodFriday: "2030-04-19", easterMonday: "2030-04-22" },
};

/**
 * Matariki dates by year
 * Matariki is based on the Māori lunar calendar and must be looked up
 */
const MATARIKI_DATES: Record<number, string> = {
    2026: "2026-07-10",
    2027: "2027-06-25",
    2028: "2028-07-14",
    2029: "2029-07-06",
    2030: "2030-06-21",
};

// ============================================================================
// DYNAMIC HOLIDAY CALCULATION FUNCTIONS
// ============================================================================

/**
 * Mondayizes a date if it falls on a weekend.
 * If the date is Saturday or Sunday, returns the following Monday.
 *
 * @param dateStr - Date in 'yyyy-MM-dd' format
 * @returns Mondayized date string
 */
function mondayize(dateStr: string): string {
    const date = new Date(dateStr + 'T00:00:00Z');
    const dayOfWeek = date.getUTCDay();

    if (dayOfWeek === 6) { // Saturday
        date.setUTCDate(date.getUTCDate() + 2);
    } else if (dayOfWeek === 0) { // Sunday
        date.setUTCDate(date.getUTCDate() + 1);
    }

    return date.toISOString().split('T')[0];
}

/**
 * Finds the Nth occurrence of a specific weekday in a month.
 *
 * @param year - Year
 * @param month - Month (1-12)
 * @param weekday - Day of week (0=Sunday, 1=Monday, etc.)
 * @param occurrence - Which occurrence (1=first, 2=second, etc.)
 * @returns Date string in 'yyyy-MM-dd' format
 */
function getNthWeekdayOfMonth(year: number, month: number, weekday: number, occurrence: number): string {
    const date = new Date(Date.UTC(year, month - 1, 1));
    let count = 0;

    while (date.getUTCMonth() === month - 1) {
        if (date.getUTCDay() === weekday) {
            count++;
            if (count === occurrence) {
                return date.toISOString().split('T')[0];
            }
        }
        date.setUTCDate(date.getUTCDate() + 1);
    }

    throw new Error(`Could not find ${occurrence}th occurrence of weekday ${weekday} in ${year}-${month}`);
}

/**
 * Calculates Auckland Anniversary Day (Monday closest to January 29).
 *
 * @param year - Year
 * @returns Date string in 'yyyy-MM-dd' format
 */
function getAucklandAnniversary(year: number): string {
    // Jan 29 is the traditional date
    const jan29 = new Date(Date.UTC(year, 0, 29));
    const dayOfWeek = jan29.getUTCDay();

    // If Jan 29 is already Monday, use it
    if (dayOfWeek === 1) {
        return jan29.toISOString().split('T')[0];
    }

    // If Jan 29 is Tue-Thu, use the Monday before
    if (dayOfWeek >= 2 && dayOfWeek <= 4) {
        const daysBack = dayOfWeek - 1;
        jan29.setUTCDate(jan29.getUTCDate() - daysBack);
        return jan29.toISOString().split('T')[0];
    }

    // If Jan 29 is Fri-Sun, use the Monday after
    const daysForward = dayOfWeek === 5 ? 3 : dayOfWeek === 6 ? 2 : 1;
    jan29.setUTCDate(jan29.getUTCDate() + daysForward);
    return jan29.toISOString().split('T')[0];
}

/**
 * Dynamically calculates all NZ national holidays for a given year.
 * Uses algorithmic patterns for most holidays and lookup tables for Easter/Matariki.
 *
 * @param year - Year to calculate holidays for
 * @returns Array of holiday date strings
 */
function calculateNationalHolidays(year: number): string[] {
    const holidays: string[] = [];

    // New Year's Day (Jan 1) - Mondayized
    holidays.push(mondayize(`${year}-01-01`));

    // Day after New Year's (Jan 2) - Mondayized
    holidays.push(mondayize(`${year}-01-02`));

    // Waitangi Day (Feb 6) - Mondayized since 2014
    holidays.push(mondayize(`${year}-02-06`));

    // Easter (lookup table required)
    const easter = EASTER_DATES[year];
    if (easter) {
        holidays.push(easter.goodFriday);
        holidays.push(easter.easterMonday);
    } else {
        console.warn(`⚠️ No Easter data for ${year}. Please update EASTER_DATES lookup table.`);
    }

    // ANZAC Day (Apr 25) - Mondayized since 2014
    holidays.push(mondayize(`${year}-04-25`));

    // King's Birthday - 1st Monday in June
    holidays.push(getNthWeekdayOfMonth(year, 6, 1, 1));

    // Matariki (lookup table required)
    const matariki = MATARIKI_DATES[year];
    if (matariki) {
        holidays.push(matariki);
    } else {
        console.warn(`⚠️ No Matariki data for ${year}. Please update MATARIKI_DATES lookup table.`);
    }

    // Labour Day - 4th Monday in October
    holidays.push(getNthWeekdayOfMonth(year, 10, 1, 4));

    // Christmas Day (Dec 25) - Mondayized
    holidays.push(mondayize(`${year}-12-25`));

    // Boxing Day (Dec 26) - Mondayized
    holidays.push(mondayize(`${year}-12-26`));

    return holidays.sort();
}

/**
 * Calculates regional anniversary days for a given year.
 *
 * @param year - Year to calculate for
 * @returns Record of regional holidays
 */
function calculateRegionalHolidays(year: number): Record<NZRegion, string> {
    return {
        "Auckland": getAucklandAnniversary(year),
        "Wellington": getNthWeekdayOfMonth(year, 1, 1, 3), // 3rd Monday in January
        "Nelson": getNthWeekdayOfMonth(year, 2, 1, 1), // 1st Monday in February
        "Taranaki": getNthWeekdayOfMonth(year, 3, 1, 2), // 2nd Monday in March
        "Otago": getNthWeekdayOfMonth(year, 3, 1, 3), // 3rd Monday in March (approx)
        "Southland": getNthWeekdayOfMonth(year, 4, 1, 1), // Easter Monday week (approx)
        "Hawke's Bay": getNthWeekdayOfMonth(year, 10, 1, 3), // Friday before Labour Day (approx)
        "Canterbury": getNthWeekdayOfMonth(year, 11, 1, 2), // 2nd Friday after 1st Tuesday in November (approx)
    };
}

/**
 * NZ Public Holidays by year (LEGACY - kept for validation).
 * Dynamic calculation is now preferred via calculateNationalHolidays().
 * Add new years as needed to keep the system functional.
 */
const HOLIDAYS_BY_YEAR: Record<number, HolidayData> = {
    2026: {
        national: [
            "2026-01-01", // New Year's Day
            "2026-01-02", // Day after New Year's
            "2026-02-06", // Waitangi Day
            "2026-04-03", // Good Friday
            "2026-04-06", // Easter Monday
            "2026-04-27", // ANZAC Day Observed
            "2026-06-01", // King's Birthday
            "2026-07-10", // Matariki
            "2026-10-26", // Labour Day
            "2026-12-25", // Christmas Day
            "2026-12-28", // Boxing Day Observed
        ],
        regional: {
            "Wellington": "2026-01-19",
            "Auckland": "2026-01-26",
            "Nelson": "2026-02-02",
            "Taranaki": "2026-03-09",
            "Otago": "2026-03-23",
            "Southland": "2026-04-07",
            "Hawke's Bay": "2026-10-23",
            "Canterbury": "2026-11-13",
        }
    },
    2027: {
        national: [
            "2027-01-01", // New Year's Day
            "2027-01-04", // Day after New Year's (Mondayised)
            "2027-02-08", // Waitangi Day (Mondayised)
            "2027-04-02", // Good Friday
            "2027-04-05", // Easter Monday
            "2027-04-26", // ANZAC Day (Mondayised)
            "2027-06-07", // King's Birthday
            "2027-07-02", // Matariki
            "2027-10-25", // Labour Day
            "2027-12-27", // Christmas Day (Mondayised)
            "2027-12-28", // Boxing Day (Mondayised)
        ],
        regional: {
            "Wellington": "2027-01-25",
            "Auckland": "2027-02-01",
            "Nelson": "2027-02-01",
            "Taranaki": "2027-03-08",
            "Otago": "2027-03-22",
            "Southland": "2027-04-06",
            "Hawke's Bay": "2027-10-22",
            "Canterbury": "2027-11-12",
        }
    },
    2028: {
        national: [
            "2028-01-03", // New Year's Day (Mondayised)
            "2028-01-04", // Day after New Year's (Mondayised)
            "2028-02-07", // Waitangi Day (Mondayised)
            "2028-04-14", // Good Friday
            "2028-04-17", // Easter Monday
            "2028-04-25", // ANZAC Day
            "2028-06-05", // King's Birthday
            "2028-06-21", // Matariki
            "2028-10-23", // Labour Day
            "2028-12-25", // Christmas Day
            "2028-12-26", // Boxing Day
        ],
        regional: {
            "Wellington": "2028-01-24",
            "Auckland": "2028-01-31",
            "Nelson": "2028-01-31",
            "Taranaki": "2028-03-13",
            "Otago": "2028-03-20",
            "Southland": "2028-04-04",
            "Hawke's Bay": "2028-10-20",
            "Canterbury": "2028-11-10",
        }
    }
};

/**
 * Retrieves NZ holiday data for a specific year.
 * Falls back to 2026 data if year not found (with console warning).
 *
 * @param year - The year to get holidays for (defaults to current year)
 * @returns Holiday data including national and regional holidays
 */
export function getNZHolidays(year?: number): HolidayData {
    const targetYear = year || new Date().getFullYear();

    if (HOLIDAYS_BY_YEAR[targetYear]) {
        return HOLIDAYS_BY_YEAR[targetYear];
    }

    // Fallback to 2026 with warning
    console.warn(
        `⚠️ No holiday data for year ${targetYear}. ` +
        `Falling back to 2026 data. ` +
        `Please update lib/nz-holidays.ts with ${targetYear} holidays.`
    );

    return HOLIDAYS_BY_YEAR[2026];
}

/**
 * Checks if a specific date string is a NZ public holiday.
 *
 * @param dateStr - Date in 'yyyy-MM-dd' format
 * @param region - Optional NZ region for regional anniversary days
 * @returns True if the date is a public holiday
 */
export function isNZHoliday(dateStr: string, region?: NZRegion): boolean {
    const year = parseInt(dateStr.substring(0, 4), 10);
    const holidays = getNZHolidays(year);

    // Check national holidays
    if (holidays.national.includes(dateStr)) {
        return true;
    }

    // Check regional holiday
    if (region && holidays.regional[region] === dateStr) {
        return true;
    }

    return false;
}

/**
 * Gets all holidays for a specific year (combined national + regional).
 * Useful for debugging and tribunal evidence summaries.
 *
 * @param year - The year to get holidays for
 * @param region - Optional region to include regional holiday
 * @returns Array of holiday date strings
 */
export function getAllHolidays(year: number, region?: NZRegion): string[] {
    const holidays = getNZHolidays(year);
    const allHolidays = [...holidays.national];

    if (region && holidays.regional[region]) {
        allHolidays.push(holidays.regional[region]);
    }

    return allHolidays.sort();
}
