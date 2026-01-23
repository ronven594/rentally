# Fix Summary: Automatic Strike Logging on Payment Toggle

## Problem
When toggling a tenant from "Unpaid" to "Paid", no strikes were being logged automatically, even when the payment was 5+ working days late.

## Root Cause
**File:** `src/app/rent-tracker/page.tsx` (Lines 187-239)

The `handleTogglePayment` function was:
1. ✅ Updating the payment status to "Paid"
2. ✅ Logging a "RENT_PAID" event to evidence_ledger
3. ❌ **NOT calling `isStrike()` to check if it should also log a strike**

The `isStrike()` function in `rent-logic.ts` has built-in automatic logging for strikes, but it was never being called from the toggle handler.

## The Missing Flow

### ❌ BEFORE (Broken):
```tsx
const handleTogglePayment = async (tenantId: string) => {
    // ... find tenant and property ...
    
    if (state.isUnpaid) {
        // Mark as paid
        const unpaidRecord = payments.find(p => p.tenantId === tenantId && p.status === "Unpaid");
        
        try {
            await supabase
                .from('payments')
                .update({
                    status: 'Paid',
                    paid_date: (testDate || new Date()).toISOString()
                })
                .eq('id', unpaidRecord.id);
            
            // Log RENT_PAID event
            await logToEvidenceLedger(...);
            
            // ❌ MISSING: No strike check!
            
            toast.success("Payment recorded!");
        } catch (err) {
            // ...
        }
    }
};
```

### ✅ AFTER (Fixed):
```tsx
const handleTogglePayment = async (tenantId: string) => {
    // ... find tenant and property ...
    
    if (state.isUnpaid) {
        // Mark as paid
        const unpaidRecord = payments.find(p => p.tenantId === tenantId && p.status === "Unpaid");
        
        try {
            const paidDate = (testDate || new Date()).toISOString();
            
            await supabase
                .from('payments')
                .update({
                    status: 'Paid',
                    paid_date: paidDate
                })
                .eq('id', unpaidRecord.id);
            
            // ✅ NEW: Check if this is a strike (5+ working days late)
            const wasStrike = isStrike(
                unpaidRecord.dueDate,
                paidDate,
                property.region,
                property.id,
                tenantId,
                testDate || undefined
            );
            
            console.log('💳 Payment Recorded:', {
                tenant: tenant.name,
                dueDate: unpaidRecord.dueDate,
                paidDate: paidDate,
                wasStrike,
                message: wasStrike 
                    ? '⚠️ STRIKE LOGGED - Payment was 5+ working days late' 
                    : '✅ No strike - Payment was within grace period'
            });
            
            // Log RENT_PAID event
            await logToEvidenceLedger(...);
            
            toast.success("Payment recorded!");
        } catch (err) {
            // ...
        }
    }
};
```

## How `isStrike()` Works

The `isStrike()` function in `rent-logic.ts` (lines 104-149):

1. **Calculates strike threshold:** Due date + 5 working days (excluding weekends and NZ holidays)
2. **Checks if payment is late:** Compares paid date to strike threshold
3. **Automatically logs to evidence_ledger** if it's a strike:
   ```tsx
   if (result && propertyId) {
       const strikeKey = `${propertyId}-${tenantId}-${dueDate}`;
       
       if (!loggedStrikes.has(strikeKey)) {
           loggedStrikes.add(strikeKey);
           
           // Automatic logging!
           logToEvidenceLedger(
               propertyId,
               tenantId || null,
               EVENT_TYPES.STRIKE_ISSUED,
               CATEGORIES.ARREARS,
               "Strike issued - Payment received after grace period",
               `Rent due ${dueDate}, paid ${paidDate}. Exceeded 5 working day grace period.`,
               { dueDate, paidDate, gracePeriodDays: 5 }
           );
       }
   }
   ```
4. **Returns `true` or `false`**

## Changes Made

### 1. Import Statement (Line 11)
```tsx
// BEFORE
import { checkTerminationEligibility, differenceInWorkingDays } from "@/lib/rent-logic"

// AFTER
import { checkTerminationEligibility, differenceInWorkingDays, isStrike } from "@/lib/rent-logic"
```

### 2. Payment Toggle Handler (Lines 206-239)
- Extract `paidDate` to a variable for reuse
- Call `isStrike()` with all required parameters
- Add debug logging to show strike detection results
- `isStrike()` automatically logs to evidence_ledger if true

## Debug Logging Added

When you toggle a payment to "Paid", you'll now see:

### Example 1: Payment within grace period (No Strike)
```
💳 Payment Recorded: {
  tenant: "John Doe",
  dueDate: "2026-01-15",
  paidDate: "2026-01-17",
  wasStrike: false,
  message: "✅ No strike - Payment was within grace period"
}
```

### Example 2: Payment 5+ working days late (Strike!)
```
💳 Payment Recorded: {
  tenant: "Jane Smith",
  dueDate: "2026-01-01",
  paidDate: "2026-01-16",
  wasStrike: true,
  message: "⚠️ STRIKE LOGGED - Payment was 5+ working days late"
}
```

When `wasStrike: true`, the `isStrike()` function has already logged a STRIKE_ISSUED event to evidence_ledger automatically.

## Testing Steps

### Test 1: Payment within grace period
1. Mark a tenant as "Unpaid" with due date = today
2. Immediately mark as "Paid"
3. Open console (F12)
4. **Expected:** `wasStrike: false`, message shows "No strike"
5. Check evidence_ledger - should have RENT_PAID but NOT STRIKE_ISSUED

### Test 2: Payment 5+ working days late
1. Mark a tenant as "Unpaid" with due date = 10 days ago
2. Mark as "Paid"
3. Open console (F12)
4. **Expected:** `wasStrike: true`, message shows "STRIKE LOGGED"
5. Check evidence_ledger - should have BOTH:
   - RENT_PAID event
   - STRIKE_ISSUED event
6. Refresh page
7. **Expected:** Strike history loads, tenant shows in termination eligibility check

### Test 3: Using test date override
1. Set test date to 2026-02-15
2. Mark tenant as "Unpaid" with due date = 2026-01-15
3. Mark as "Paid"
4. **Expected:** `wasStrike: true` (30 days late)
5. Strike logged with correct dates

## Files Modified
- `src/app/rent-tracker/page.tsx` (Lines 11, 206-239)

## How to Verify Strikes Are Logged

### Option 1: Browser Console
Look for the 💳 Payment Recorded log with `wasStrike: true`

### Option 2: Supabase Dashboard
```sql
SELECT * FROM evidence_ledger 
WHERE event_type = 'STRIKE_ISSUED' 
ORDER BY created_at DESC;
```

### Option 3: Refresh Rent Tracker
After logging a strike:
1. Refresh the page
2. Check console for:
   ```
   📊 Strike History Loaded: {
     totalStrikes: 1,
     tenantsWithStrikes: 1,
     ...
   }
   ```
3. Check tenant card for termination eligibility

## Important Notes

### Strike Deduplication
The `isStrike()` function uses a `loggedStrikes` Set to prevent duplicate logging:
```tsx
const strikeKey = `${propertyId}-${tenantId}-${dueDate}`;
if (!loggedStrikes.has(strikeKey)) {
    loggedStrikes.add(strikeKey);
    // Log to evidence_ledger
}
```

This means if you toggle Paid → Unpaid → Paid for the same due date, it will only log ONE strike.

### Working Days Calculation
Strikes are based on **working days** (excluding weekends and NZ holidays), not calendar days:
- Due: Monday, Jan 1
- 5 working days later: Monday, Jan 8 (skips weekend)
- If paid on Jan 9 or later → Strike

### Test Date Support
The fix respects the test date override, so you can simulate late payments without waiting for real time to pass.
