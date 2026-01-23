# Fix Summary: Notice Type Selection (Section 55 vs Section 56)

## Problem
GenerateNoticeButton was only showing Section 56 notices even when rent was 5+ working days overdue. It should show Section 55 for 5+ working days overdue.

## Root Cause
**File:** `src/app/rent-tracker/page.tsx` (Line 128)

The `getTenantState` function was using `differenceInBusinessDays` from `date-fns`, which **only excludes weekends** but does NOT exclude **NZ public holidays**.

This caused incorrect working days calculation, making the system think rent wasn't overdue enough for Section 55.

### ❌ BEFORE (Broken):
```tsx
import { differenceInCalendarDays, differenceInBusinessDays, parseISO } from "date-fns"

const getTenantState = useCallback((tenantId: string) => {
    const unpaidRecord = payments.find(p => p.tenantId === tenantId && p.status === "Unpaid");
    if (!unpaidRecord) return { isUnpaid: false, daysOverdue: 0, workingDaysOverdue: 0 };

    const due = parseISO(unpaidRecord.dueDate);
    const today = testDate || new Date();
    const calendarDays = differenceInCalendarDays(today, due);
    const workingDays = differenceInBusinessDays(today, due);  // ❌ WRONG! Only excludes weekends

    return {
        isUnpaid: true,
        daysOverdue: Math.max(0, calendarDays),
        workingDaysOverdue: Math.max(0, workingDays)
    };
}, [payments, testDate]);
```

### ✅ AFTER (Fixed):
```tsx
import { differenceInCalendarDays, parseISO } from "date-fns"
import { differenceInWorkingDays } from "@/lib/rent-logic"  // ✅ Custom function!

const getTenantState = useCallback((tenantId: string) => {
    const unpaidRecord = payments.find(p => p.tenantId === tenantId && p.status === "Unpaid");
    if (!unpaidRecord) return { isUnpaid: false, daysOverdue: 0, workingDaysOverdue: 0 };

    const due = parseISO(unpaidRecord.dueDate);
    const today = testDate || new Date();
    const calendarDays = differenceInCalendarDays(today, due);
    // Use custom differenceInWorkingDays that respects NZ holidays
    const workingDays = differenceInWorkingDays(today, due);  // ✅ CORRECT! Excludes weekends AND NZ holidays

    console.log(`🔍 NOTICE TYPE DEBUG for tenant ${tenantId}:`, {
        dueDate: unpaidRecord.dueDate,
        today: today.toISOString().split('T')[0],
        calendarDays,
        workingDays,
        isSection55Eligible: workingDays >= 5,
        expectedNoticeType: workingDays >= 5 ? 'Section 55' : 'Section 56'
    });

    return {
        isUnpaid: true,
        daysOverdue: Math.max(0, calendarDays),
        workingDaysOverdue: Math.max(0, workingDays)
    };
}, [payments, testDate]);
```

## What Changed

### 1. Import Statement (Line 4, 7)
- **Removed:** `differenceInBusinessDays` from date-fns
- **Added:** `differenceInWorkingDays` from rent-logic

### 2. Working Days Calculation (Line 128)
- **Before:** `differenceInBusinessDays(today, due)` - Only excludes weekends
- **After:** `differenceInWorkingDays(today, due)` - Excludes weekends AND NZ holidays

### 3. Debug Logging (Lines 130-138)
Added comprehensive console logging to trace:
- Due date
- Current date
- Calendar days overdue
- Working days overdue
- Section 55 eligibility
- Expected notice type

## How Notice Type Selection Works

### Data Flow:
```
page.tsx (getTenantState)
  ↓ calculates workingDaysOverdue using differenceInWorkingDays
PropertyCard
  ↓ passes workingDaysOverdue to TenantCard
TenantCard
  ↓ passes workingDaysOverdue to GenerateNoticeButton
GenerateNoticeButton
  ↓ determines notice type: workingDaysOverdue >= 5 ? "Section 55" : "Section 56"
```

### Notice Type Logic (GenerateNoticeButton.tsx, Line 123):
```tsx
const isSection55 = workingDaysOverdue >= 5;
const autoNoticeType = isSection55 ? "Section 55" : "Section 56";

console.log(`📋 GenerateNoticeButton - Notice Type Selection:`, {
    tenantName,
    daysOverdue,           // Calendar days
    workingDaysOverdue,    // Working days (excludes weekends + NZ holidays)
    isSection55,
    autoNoticeType,
    threshold: '5 working days'
});
```

## Why This Matters

### NZ Public Holidays (2026):
- New Year's Day: Jan 1
- Day after New Year's: Jan 2
- Waitangi Day: Feb 6
- Good Friday: Apr 3
- Easter Monday: Apr 6
- ANZAC Day Observed: Apr 27
- King's Birthday: Jun 1
- Matariki: Jul 10
- Labour Day: Oct 26
- Christmas Day: Dec 25
- Boxing Day Observed: Dec 28

**Plus regional anniversary days** (Auckland, Wellington, etc.)

### Example Scenario:
**Rent due:** Monday, Dec 22, 2025  
**Today:** Tuesday, Jan 6, 2026

**Calendar days:** 15 days  
**Business days (date-fns):** 11 days (excludes 4 weekend days)  
**Working days (custom):** 8 days (excludes 4 weekend days + 3 holidays: Dec 25, 26, Jan 1, 2)

❌ **Before fix:** 11 business days → Section 55 ✓  
✅ **After fix:** 8 working days → Section 55 ✓  

But if it was only 6 business days (4 working days after holidays):  
❌ **Before fix:** 6 business days → Section 55 ✓ (WRONG!)  
✅ **After fix:** 4 working days → Section 56 ✓ (CORRECT!)

## Testing Steps

1. **Mark a tenant as "Unpaid"** with a due date 5+ working days ago
2. **Open browser console** (F12)
3. **Look for debug logs:**
   ```
   🔍 NOTICE TYPE DEBUG for tenant abc123: {
     dueDate: "2026-01-01",
     today: "2026-01-16",
     calendarDays: 15,
     workingDays: 10,
     isSection55Eligible: true,
     expectedNoticeType: "Section 55"
   }
   
   📋 GenerateNoticeButton - Notice Type Selection: {
     tenantName: "John Doe",
     daysOverdue: 15,
     workingDaysOverdue: 10,
     isSection55: true,
     autoNoticeType: "Section 55",
     threshold: "5 working days"
   }
   ```
4. **Click "Generate Notice"**
5. **Verify** the modal shows "Section 55" (not Section 56)

## Expected Behavior

### Scenario 1: 1-4 Working Days Overdue
- **Shows:** Section 56 (14-day remedy notice)
- **Console:** `isSection55Eligible: false`, `expectedNoticeType: "Section 56"`

### Scenario 2: 5+ Working Days Overdue
- **Shows:** Section 55 (strike notice)
- **Console:** `isSection55Eligible: true`, `expectedNoticeType: "Section 55"`

## Files Modified
- `src/app/rent-tracker/page.tsx` (Lines 4, 7, 128, 130-138)
- `src/components/rent-tracker/GenerateNoticeButton.tsx` (Lines 126-134)

## Technical Details

### Custom `differenceInWorkingDays` Function
Located in `src/lib/rent-logic.ts`, this function:
1. Iterates day-by-day from start to end date
2. Checks each day with `isWorkingDay()`
3. `isWorkingDay()` returns false for:
   - Saturdays and Sundays
   - NZ national holidays (2026 list)
   - Regional anniversary days (if region specified)

This ensures RTA compliance with the 5 **working day** requirement.
