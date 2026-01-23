
import { calculateServiceDate, calculateRemedyDeadline } from "../lib/rent-logic";
import { parseISO, format } from "date-fns";

console.log("--- STARTING SERVICE TIME CHECK ---");

// The verification task:
// "If I serve a 'Letterbox' notice on Friday, Jan 16th, the 2-working-day buffer means it is served on Tuesday, Jan 20th. 
// The 14-day clock starts Wednesday, Jan 21st."

// Note: 2026-01-16 is indeed a Friday.
// Monday 19th and Tuesday 20th are the 2 working days? 
// Actually, +2 Working Days from Friday:
// Day 1 = Monday
// Day 2 = Tuesday
// So Service Date should be Tuesday Jan 20.
// Remedy Deadline = Service Date + 14 Days = Feb 3rd?

const sentDate = "2026-01-16T12:00:00.000Z";
console.log(`Sent Date: ${format(parseISO(sentDate), 'EEE dd MMM yyyy')}`);

const serviceDateISO = calculateServiceDate("Letterbox", sentDate, false);
const serviceDate = parseISO(serviceDateISO);
console.log(`Calculated Service Date: ${format(serviceDate, 'EEE dd MMM yyyy')}`);

const expectedServiceDate = "Tue 20 Jan 2026";
const actualServiceString = format(serviceDate, 'EEE dd MMM yyyy');

if (actualServiceString === expectedServiceDate) {
    console.log("✅ Service Date Math CORRECT");
} else {
    console.log(`❌ Service Date Math FAILED. Expected ${expectedServiceDate}, got ${actualServiceString}`);
}

const remedyDateISO = calculateRemedyDeadline(serviceDateISO);
const remedyDate = parseISO(remedyDateISO);
console.log(`Calculated Remedy Deadline (14 days after service): ${format(remedyDate, 'EEE dd MMM yyyy')}`);

// 20th + 14 days = 3rd Feb?
// Jan has 31 days.
// 20 + 14 = 34. 34 - 31 = 3rd Feb.
console.log("--- CHECK COMPLETE ---");
