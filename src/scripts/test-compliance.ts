import { calculateRemedyDeadline, getTribunalFilingDeadline, canIssueSection56Notice } from '../lib/rent-logic';
import { format, parseISO } from 'date-fns';

function runTests() {
    console.log("--- RTA Compliance Tests ---");

    // 1. Remedy Deadline (+15 days)
    const serviceDate = "2026-01-01T10:00:00Z";
    const remedyDeadline = calculateRemedyDeadline(serviceDate);
    const expectedRemedy = "2026-01-16T10:00:00Z";
    console.log(`Test 1: Remedy Deadline (+15 days)`);
    console.log(`- Service Date: ${serviceDate}`);
    console.log(`- Result:       ${remedyDeadline}`);
    console.log(`- Expected:     ${expectedRemedy}`);
    console.log(remedyDeadline === expectedRemedy ? "✅ PASS" : "❌ FAIL");

    // 2. Tribunal Filing Deadline (+28 days)
    const thirdNoticeDate = "2026-02-01T10:00:00Z";
    const filingDeadline = getTribunalFilingDeadline(thirdNoticeDate);
    const expectedFiling = "2026-03-01T10:00:00Z"; // Feb has 28 days in 2026
    console.log(`\nTest 2: Tribunal Filing Deadline (+28 days)`);
    console.log(`- 3rd Notice Date: ${thirdNoticeDate}`);
    console.log(`- Result:          ${filingDeadline}`);
    console.log(`- Expected:        ${expectedFiling}`);
    console.log(filingDeadline === expectedFiling ? "✅ PASS" : "❌ FAIL");

    // 3. Section 56 Eligibility (1 day overdue)
    const dueDate = "2026-01-10T00:00:00Z";
    const canIssue = canIssueSection56Notice(dueDate); // Assuming current date is > 2026-01-10
    console.log(`\nTest 3: Section 56 Eligibility (1 day overdue)`);
    console.log(`- Due Date: ${dueDate}`);
    console.log(`- Result:   ${canIssue}`);
    console.log(canIssue === true ? "✅ PASS" : "❌ FAIL");
}

runTests();
