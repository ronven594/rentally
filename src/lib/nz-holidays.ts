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

export interface HolidayData {
    national: string[];
    regional: Record<NZRegion, string>;
}

/**
 * NZ Public Holidays by year.
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
