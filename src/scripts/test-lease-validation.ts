/**
 * Test Script: Lease Start Date Validation
 *
 * Verifies that the legal engine correctly filters out pre-lease debt
 * and calculates status based ONLY on valid debt.
 * 
 * Run with: npx ts-node --compiler-options '{"module":"CommonJS"}' src/scripts/test-lease-validation.ts
 */

import { analyzeTenancySituation, AnalysisInput, LedgerEntry } from "../lib/legal-engine";
import { format, parseISO } from "date-fns";

console.log("=".repeat(70));
console.log("LEASE FLOOR VALIDATION TEST");
console.log("=".repeat(70));

// Setup Common Data
const TENANT_ID = "test-tenant-1";
const LEASE_START = "2026-01-02"; // Jan 2, 2026

// Ledger with GHOST ENTRY from Dec 2025
const ledger: LedgerEntry[] = [
    // GHOST ENTRY (Should be ignored)
    {
        id: "ghost-1",
        tenantId: TENANT_ID,
        dueDate: "2025-12-25",
        amount: 200,
        status: "Unpaid"
    },
    // Valid Entry 1
    {
        id: "rent-1",
        tenantId: TENANT_ID,
        dueDate: "2026-01-08",
        amount: 200,
        status: "Unpaid"
    },
    // Valid Entry 2
    {
        id: "rent-2",
        tenantId: TENANT_ID,
        dueDate: "2026-01-15",
        amount: 200,
        status: "Unpaid"
    },
    // Valid Entry 3
    {
        id: "rent-3",
        tenantId: TENANT_ID,
        dueDate: "2026-01-22",
        amount: 200,
        status: "Unpaid"
    },
    // Valid Entry 4
    {
        id: "rent-4",
        tenantId: TENANT_ID,
        dueDate: "2026-01-29",
        amount: 200,
        status: "Unpaid"
    }
];

function runTest(testDate: string, expectedAmount: number) {
    console.log(`\n📅 Testing Date: ${testDate}`);
    const input: AnalysisInput = {
        tenantId: TENANT_ID,
        ledger: ledger, // Pass full ledger including ghost entry
        strikeHistory: [],
        currentDate: parseISO(testDate),
        leaseStartDate: LEASE_START // STRICT FILTER
    };

    const result = analyzeTenancySituation(input);
    const { daysArrears, workingDaysOverdue, noticeType } = result.analysis;
    const status = result.status;

    // Manually calculate total arrears from the engine results if possible, 
    // but the engine returns days/status. We can check the internal logic by inference.
    // However, analyzeTenancySituation doesn't return total money amount directly in AnalysisResult (it returns days).
    // But we can check if the status aligns with the expected AMOUNT context.

    // To verify amounts, we should also manually call the filter helper or just trust the status derived from it.
    // The user's prompt emphasizes: "your ledger generation to include this validation"
    // Our fix was in analyzeTenancySituation, so the STATUS should reflect the correct start date.

    console.log(`   Status: ${status}`);
    console.log(`   Days Arrears: ${daysArrears}`);
    console.log(`   Working Days Overdue: ${workingDaysOverdue}`);
    console.log(`   Notice Type: ${noticeType}`);

    if (testDate === "2026-01-09") {
        // Expected: $200 (1 week), 1 day overdue. Status: PENDING
        if (daysArrears === 1 && status === "PENDING") {
            console.log("✅ Jan 9 Check PASS");
        } else {
            console.log("❌ Jan 9 Check FAIL");
        }
    }

    if (testDate === "2026-01-22") {
        // Expected: $400. Jan 8 is 14 days ago (10 working days?). 
        // 2 weeks overdue. 
        // Status: ACTION_REQUIRED (Strike 1) ??
        // Jan 8 + 5 working days = Strike eligible.
        if (workingDaysOverdue >= 5) {
            console.log("✅ Jan 22 Check PASS (Strike Eligible)");
        } else {
            console.log("❌ Jan 22 Check FAIL");
        }
    }

    if (testDate === "2026-01-29") {
        // The user said: "Actual Arrears on Jan 29: 21 Calendar days since Jan 8."
        // Jan 8 to Jan 29 is exactly 21 days.
        // So daysArrears should be 21.
        // Status should be TRIBUNAL_ELIGIBLE.
        if (daysArrears === 21 && status === "TRIBUNAL_ELIGIBLE") {
            console.log("✅ Jan 29 Check PASS (Tribunal Eligible)");
        } else {
            console.log(`❌ Jan 29 Check FAIL - Got Days: ${daysArrears}, Status: ${status}`);
        }
    }
}

// Run Scenarios
runTest("2026-01-09", 200);
runTest("2026-01-22", 400);
runTest("2026-01-29", 600);
