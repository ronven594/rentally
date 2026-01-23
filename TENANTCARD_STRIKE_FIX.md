# TenantCard Strike Pill Bar Fix

**Date**: 2026-01-17
**Status**: ✅ **FIXED** (Updated with testDate support)

---

## 🐛 THE BUGS

### Bug #1: Multiple Unpaid Payments Not Counted

The strike pill bars were only filling the **first bar** even when multiple tenants had multiple unpaid payments that qualified as strikes.

### Bug #2: Test Date Override Not Working ⭐ **CRITICAL**

When using the test date override feature, strike calculations were still using the **current real date** instead of the test date. This made it impossible to test future scenarios or simulate late payments.

### Problem Description (Bug #1)

The strike pill bars in TenantCard were only filling the **first bar** when multiple tenants had unpaid payments that qualified as strikes. The original logic was flawed:

```typescript
// ❌ BEFORE - BUGGY LOGIC
{[1, 2, 3].map((i) => {
    const recordedStrikes = tenant.strikeHistory?.length || 0;
    let isFill = false;

    // 1. If this bar index is less than or equal to strikes already issued
    if (i <= recordedStrikes) {
        isFill = true;
    }
    // 2. If this is the NEXT bar and the tenant has reached the 5-day threshold
    else if (i === recordedStrikes + 1 && workingDaysOverdue >= 5) {
        isFill = true;
    }

    return (
        <div key={i} className={isFill ? "bg-[#E51C00]" : "bg-gray-200"} />
    );
})}
```

### Root Causes

1. **Oversimplified check**: Used `workingDaysOverdue >= 5` which only checks if the **earliest unpaid payment** is 5+ days late
2. **Single pending strike assumption**: Logic assumed only ONE pending strike max (`i === recordedStrikes + 1`)
3. **Ignored multiple unpaid payments**: If tenant had 2-3 unpaid payments that ALL qualified as strikes, only showed 1 pending strike

### Example Bug Scenario

**Tenant has:**
- 0 recorded strikes in database
- 2 unpaid payments:
  - Payment 1: Due 20 days ago (qualifies as strike)
  - Payment 2: Due 8 days ago (qualifies as strike)

**Expected**: Show 2 red bars (both payments are strikes)
**Actual**: Only showed 1 red bar (only checked earliest payment)

### Root Cause (Bug #2)

The `isStrike()` function accepts a `todayOverride` parameter for testing, but:
1. TenantCard interface didn't include `testDate` prop
2. PropertyCard wasn't passing `testDate` to TenantCard
3. TenantCard wasn't using `testDate` when calling `isStrike()`

**Result**: Strike calculations always used `new Date()` instead of the test date, making the test date feature non-functional for strike visualization.

---

## ✅ THE FIX

### Fix #1: Count All Unpaid Payments as Strikes

### New Approach

Instead of checking `workingDaysOverdue >= 5` (which is just one boolean), we now:

1. **Get recorded strikes** from `tenant.strikeHistory` (already logged to database)
2. **Calculate pending strikes** by checking ALL unpaid payments with `isStrike()` function
3. **Sum them** to get total strike count
4. **Fill bars** based on total count

### Implementation

**Files Changed**:
- [src/components/dashboard/TenantCard.tsx](src/components/dashboard/TenantCard.tsx)
- [src/components/dashboard/PropertyCard.tsx](src/components/dashboard/PropertyCard.tsx)

**Added imports** (TenantCard.tsx):
```typescript
import { useState, useMemo } from "react"
import { getRTAStatus, RTAStatus, isStrike } from "@/lib/rent-logic"
```

**Added testDate prop** (TenantCard.tsx lines 12-23):
```typescript
interface TenantCardProps {
    tenant: Tenant;
    // ... other props
    testDate?: Date; // Override current date for testing/simulations
    onRecordPayment: (tenantId: string, amount: number) => Promise<void>;
    onSettings: () => void;
}
```

**Added strike calculation** (lines 60-73):
```typescript
// Calculate total strikes: recorded strikes + pending strikes from unpaid payments
const totalStrikeCount = useMemo(() => {
    const recordedStrikes = tenant.strikeHistory?.length || 0;

    // Count unpaid payments that qualify as strikes (5+ working days late)
    const unpaidPayments = payments.filter(p =>
        p.tenantId === tenant.id &&
        !p.paidDate &&
        p.status !== 'Paid'
    );

    // Check how many unpaid payments qualify as strikes
    // ✅ FIX: Pass testDate as todayOverride for proper test date support
    const pendingStrikes = unpaidPayments.filter(p =>
        isStrike(p.dueDate, undefined, tenant.region, testDate)
    ).length;

    // Total is recorded + pending (but cap at 3 for display)
    return Math.min(recordedStrikes + pendingStrikes, 3);
}, [tenant.strikeHistory, payments, tenant.id, tenant.region, testDate]); // ✅ Added testDate dependency
```

### Fix #2: Support Test Date Override

**Pass testDate from PropertyCard to TenantCard** (PropertyCard.tsx line 155):
```typescript
<TenantCard
    key={tenant.id}
    tenant={tenant}
    // ... other props
    testDate={testDate} // ✅ Pass test date through
    onRecordPayment={onRecordPayment}
    onSettings={() => onManageTenant(tenant.id)}
/>
```

**Simplified pill bar rendering** (lines 130-146):
```typescript
<div className="flex gap-2.5">
    {[1, 2, 3].map((i) => {
        // Fill the bar if this position is <= total strike count
        const isFill = i <= totalStrikeCount;

        return (
            <div key={i} className={cn(
                "flex-1 h-2 rounded-full transition-all duration-300",
                isFill ? "bg-[#E51C00] shadow-[0_0_8px_rgba(229,28,0,0.3)]" : "bg-gray-200"
            )} />
        );
    })}
</div>
```

**Updated counter display** (line 111):
```typescript
<span className={cn(
    "text-[11px] font-black",
    totalStrikeCount > 0 ? "text-[#D72C0D]" : "text-gray-300"
)}>
    {totalStrikeCount} / 3
</span>
```

---

## 🧪 HOW IT WORKS

### Strike Calculation Logic

1. **Recorded Strikes** (from database):
   - Fetched from `evidence_ledger` table where `event_type = 'STRIKE_ISSUED'`
   - Stored in `tenant.strikeHistory` array
   - These are strikes that were already logged when payments were recorded late

2. **Pending Strikes** (from current unpaid payments):
   - Filter payments for this tenant: `p.tenantId === tenant.id`
   - Only unpaid: `!p.paidDate && p.status !== 'Paid'`
   - Check each against `isStrike()` function from [rent-logic.ts](src/lib/rent-logic.ts)
   - `isStrike()` checks if payment is 5+ **working days** late (excluding weekends + NZ holidays)
   - **Uses testDate if provided** - allows testing future scenarios and simulations

3. **Total Count**:
   - `totalStrikeCount = recordedStrikes + pendingStrikes`
   - Capped at 3 for display (3 strikes = termination eligible)

### Visual Representation

```
Scenario 1: No strikes
┌─────────┬─────────┬─────────┐
│  Gray   │  Gray   │  Gray   │  0 / 3
└─────────┴─────────┴─────────┘

Scenario 2: 1 recorded strike
┌─────────┬─────────┬─────────┐
│   Red   │  Gray   │  Gray   │  1 / 3
└─────────┴─────────┴─────────┘

Scenario 3: 1 recorded + 1 pending strike
┌─────────┬─────────┬─────────┐
│   Red   │   Red   │  Gray   │  2 / 3
└─────────┴─────────┴─────────┘

Scenario 4: 0 recorded + 3 pending strikes
┌─────────┬─────────┬─────────┐
│   Red   │   Red   │   Red   │  3 / 3
└─────────┴─────────┴─────────┘
```

---

## 🎯 BENEFITS

| Benefit | Description |
|---------|-------------|
| **Accurate representation** | Shows ALL strikes (recorded + pending) not just one |
| **Uses proper strike logic** | Leverages `isStrike()` from rent-logic.ts (5 working days) |
| **Real-time updates** | `useMemo` recalculates when payments or strike history changes |
| **Simpler code** | Reduced from 15 lines to 6 lines in render logic |
| **Performance** | Memoized calculation prevents unnecessary recalculations |

---

## 📊 IMPACT

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Lines in pill bar logic | 15 | 6 | -60% |
| Strike calculation accuracy | ❌ Only first | ✅ All strikes | **FIXED** |
| Accounts for multiple unpaid | ❌ No | ✅ Yes | **FIXED** |
| Uses isStrike() function | ❌ No | ✅ Yes | **CONSISTENT** |
| Code complexity | High | Low | **SIMPLIFIED** |

---

## 🧪 TESTING CHECKLIST

Test these scenarios to verify the fix:

### Basic Scenarios
- [ ] Tenant with 0 strikes: All bars gray
- [ ] Tenant with 1 recorded strike: 1 red bar
- [ ] Tenant with 2 recorded strikes: 2 red bars
- [ ] Tenant with 3 recorded strikes: 3 red bars

### Pending Strike Scenarios
- [ ] Tenant with 0 recorded + 1 unpaid payment (5+ working days late): 1 red bar
- [ ] Tenant with 0 recorded + 2 unpaid payments (both 5+ days late): 2 red bars
- [ ] Tenant with 1 recorded + 1 unpaid payment (5+ days late): 2 red bars
- [ ] Tenant with 1 recorded + 2 unpaid payments (both 5+ days late): 3 red bars

### Edge Cases
- [ ] Tenant with unpaid payment < 5 working days late: Shows only recorded strikes
- [ ] Multiple tenants on same property: Each shows correct strike count
- [ ] Weekend/holiday calculations: Uses working days (excludes weekends/NZ holidays)
- [ ] Test date override: Pill bars update when test date changes

### UI Behavior
- [ ] Red bars have correct styling (`bg-[#E51C00]` with shadow)
- [ ] Counter shows correct format: "X / 3"
- [ ] Counter text is red when strikes > 0, gray when 0
- [ ] Smooth transitions when strike count changes

---

## 🔗 RELATED FILES

1. **[src/lib/rent-logic.ts](src/lib/rent-logic.ts)** - Contains `isStrike()` function
   - Line 115-132: Synchronous strike check for UI
   - Line 149-185: Async version with evidence logging

2. **[src/app/rent-tracker/page.tsx](src/app/rent-tracker/page.tsx)** - Fetches strike history
   - Line 61-83: Fetches strikes from evidence_ledger
   - Line 728-736: Termination eligibility check

3. **[src/components/dashboard/PropertyCard.tsx](src/components/dashboard/PropertyCard.tsx)** - Passes data to TenantCard
   - Line 145-151: Passes payments array to TenantCard

---

## ✅ VERIFICATION

Run these checks:

```bash
# 1. TypeScript compiles
npx tsc --noEmit --skipLibCheck

# 2. No linting errors
npm run lint

# 3. Development server starts
npm run dev
```

Expected results:
- ✅ No TypeScript errors
- ✅ TenantCard imports `isStrike` correctly
- ✅ useMemo dependencies are correct
- ✅ Page loads without console errors

---

## 🎉 SUCCESS!

Both strike pill bar bugs are now fixed:

1. ✅ **All strikes shown** - Not just the first one
2. ✅ **Multiple unpaid payments** - Each strike-qualifying payment shows a bar
3. ✅ **Consistent logic** - Uses same `isStrike()` function as rent-logic.ts
4. ✅ **Real-time updates** - Recalculates when data changes
5. ✅ **Simpler code** - 60% less code, easier to maintain
6. ✅ **Test date support** - Strike calculations respect test date override
7. ✅ **Proper data flow** - testDate passed from rent-tracker → PropertyCard → TenantCard

The tenant cards now accurately reflect strike status for RTA compliance AND support test date simulations!

---

**Next Step**: Test in the UI with multiple tenants and various payment scenarios to confirm all cases work correctly.
