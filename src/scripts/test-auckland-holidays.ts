
import { addWorkingDays, isWorkingDay } from "../lib/rent-logic";
import { parseISO, format, addDays } from "date-fns";

console.log("--- STARTING AUCKLAND HOLIDAY CHECK ---");

// Verification: "If an Auckland property is toggled 'Unpaid' on Friday, Jan 23rd, 2026, 
// the 5th working day should be Tuesday, Feb 3rd"

const startDate = parseISO("2026-01-23"); // Friday
console.log(`Start Date: ${format(startDate, 'EEE dd MMM yyyy')}`);

// Calculate 5th working day for Auckland
const fifthWorkingDay = addWorkingDays(startDate, 5, "Auckland");
console.log(`5th Working Day (Auckland): ${format(fifthWorkingDay, 'EEE dd MMM yyyy')}`);

// Expected: Tuesday, Feb 3rd
const expectedDate = "2026-02-03";
const actualDateStr = format(fifthWorkingDay, 'yyyy-MM-dd');

console.log(`\nExpected: Tue 03 Feb 2026`);
console.log(`Actual: ${format(fifthWorkingDay, 'EEE dd MMM yyyy')}`);

if (actualDateStr === expectedDate) {
    console.log("✅ AUCKLAND SCENARIO CORRECT");
} else {
    console.log(`❌ AUCKLAND SCENARIO FAILED. Expected ${expectedDate}, got ${actualDateStr}`);
}

// Let's trace through the days
console.log("\n--- DAY-BY-DAY TRACE ---");
let currentDate = new Date(startDate);
let workingDayCount = 0;

for (let i = 0; i < 15; i++) {
    currentDate = addDays(currentDate, 1);
    const isWorking = isWorkingDay(currentDate, "Auckland");
    if (isWorking) {
        workingDayCount++;
        console.log(`${format(currentDate, 'EEE dd MMM yyyy')} - Working Day #${workingDayCount}`);
    } else {
        console.log(`${format(currentDate, 'EEE dd MMM yyyy')} - SKIP (Weekend/Holiday)`);
    }

    if (workingDayCount === 5) {
        console.log(`\n5th Working Day Reached: ${format(currentDate, 'EEE dd MMM yyyy')}`);
        break;
    }
}

console.log("\n--- CHECK COMPLETE ---");
