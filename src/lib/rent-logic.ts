import { format, getDay } from "date-fns";
import { type NZRegion, isNZHoliday } from './nz-holidays';

/**
 * Basic working day utility - useful for determining if a day is a standard 
 * NZ business day (excludes weekends and public holidays).
 */
export function isWorkingDay(date: Date, region?: NZRegion): boolean {
    const dayOfWeek = getDay(date);
    if (dayOfWeek === 0 || dayOfWeek === 6) return false;
    const dateStr = format(date, 'yyyy-MM-dd');
    return !isNZHoliday(dateStr, region);
}
