# Tracking Start Date & Opening Arrears

**Implementation Date**: 2026-01-24
**Purpose**: Eliminate ghost debt and enable proper rent tracking for tenants with pre-existing arrears

---

## Problem Statement

### The Ghost Debt Issue

When adding a tenant who moved in months ago (e.g., January 2), the system would:
1. Generate payments from the lease start date to today (e.g., 8 payments)
2. Mark all as "Unpaid"
3. Show $800 debt immediately (even though tenant is actually current)

**Root Cause**: The system couldn't distinguish between:
- **Historical debt** (from before we started tracking)
- **New debt** (from after we started tracking)

### The Section 55 Compliance Issue

If a tenant has existing arrears when you start using the app, the system needs to:
1. Track the opening balance
2. Calculate working days overdue from when you started tracking
3. Enable proper Section 55 strike notices based on real arrears, not ghost payments

---

## Solution: Tracking Start Date + Opening Arrears

### Concept

**Tracking Start Date**: When you started tracking this tenant in the app (defaults to today)
**Opening Arrears**: Any existing debt when you started tracking (defaults to $0)

### The Math

```
Total Arrears = Opening Arrears + Unpaid Entries After Tracking Start Date
```

### Example Scenarios

#### Scenario 1: New Tenant (All Good on Day 1)

- **Lease Start**: January 24, 2026
- **Tracking Start**: January 24, 2026 (today)
- **Opening Arrears**: $0

**Result**:
- Payments generated: Jan 24 onwards
- Total Arrears: $0
- Status: "All Good" ✅

---

#### Scenario 2: Existing Tenant (Moved in 3 weeks ago, currently paid up)

- **Lease Start**: January 2, 2026
- **Tracking Start**: January 24, 2026 (today)
- **Opening Arrears**: $0

**Result**:
- Payments generated: Jan 24 onwards (NOT Jan 2)
- Total Arrears: $0
- Status: "All Good" ✅

**Why this works**: We're only tracking rent from today forward. We don't care about historical payments.

---

#### Scenario 3: Existing Tenant with Debt

- **Lease Start**: January 2, 2026
- **Tracking Start**: January 24, 2026 (today)
- **Opening Arrears**: $400 (2 weeks behind)

**Result**:
- Payments generated: Jan 24 onwards
- Total Arrears: $400 (opening) + $0 (new unpaid) = $400
- Days Overdue: Calculated from Jan 24 (tracking start)
- Working Days Overdue: Calculated from Jan 24
- Status: "Behind" (if sufficient working days)

**Section 55 Compliance**: The system correctly tracks that they're behind from the tracking start date, enabling proper strike notice timing.

---

## Technical Implementation

### 1. Database Schema

**New Columns in `tenants` table**:

```sql
tracking_start_date DATE      -- When we started tracking (required, defaults to today)
opening_arrears     NUMERIC    -- Pre-existing debt (defaults to 0)
```

**Migration**: [20260124_add_tracking_fields.sql](../supabase/migrations/20260124_add_tracking_fields.sql)

---

### 2. Add Tenant Form

**Fields**:

1. **Lease Start** (optional)
   - Label: "Lease Start (Optional)"
   - Help Text: "When did the tenant originally move in? (for reference only)"
   - Purpose: Historical record keeping only

2. **Tracking Start** (required) ⭐
   - Label: "Tracking Start *"
   - Default: Today's date
   - Help Text: "When should rent tracking start? (defaults to today)"
   - Purpose: Math anchor for payment generation

3. **Opening Arrears** (optional)
   - Label: "Opening Arrears ($)"
   - Default: $0
   - Help Text: "Any existing debt when you started tracking (defaults to $0)"
   - Purpose: Include pre-existing debt in total arrears

**File**: [AddTenantDialog.tsx](../src/components/dashboard/AddTenantDialog.tsx)

---

### 3. Legal Engine Changes

**File**: [legal-engine.ts](../src/lib/legal-engine.ts)

**Key Changes**:

1. **Filter Ledger by Tracking Start Date**:
   ```typescript
   export function getValidLedger(ledger: LedgerEntry[], trackingStartDate: string): LedgerEntry[] {
       const floorDate = parseISO(trackingStartDate);
       return ledger.filter(entry => {
           const dueDate = parseISO(entry.dueDate);
           return isAfter(dueDate, floorDate) || isEqual(dueDate, floorDate);
       });
   }
   ```

2. **Calculate Total Arrears**:
   ```typescript
   const ledgerArrears = calculateTotalArrears(ledger); // Unpaid after tracking start
   const totalArrears = openingArrears + ledgerArrears;
   ```

3. **Calculate Days Overdue**:
   ```typescript
   if (openingArrears > 0 && trackingStartDate) {
       // Opening arrears are considered overdue from the tracking start date
       const trackingStart = parseISO(trackingStartDate);
       daysArrears = Math.max(0, differenceInCalendarDays(currentDate, trackingStart));
   } else {
       daysArrears = calculateDaysInArrears(ledger, currentDate);
   }
   ```

4. **Calculate Working Days Overdue**:
   ```typescript
   if (openingArrears > 0 && trackingStartDate) {
       // Opening arrears: calculate working days from tracking start date
       workingDaysOverdue = calculateWorkingDaysOverdue(trackingStartDate, currentDate, region);
   } else {
       // Normal calculation: use oldest unpaid entry from ledger
       // ...
   }
   ```

---

### 4. Payment Generation

**File**: [rent-tracker/page.tsx](../src/app/rent-tracker/page.tsx)

**Change**:

```typescript
// OLD: Used lease_start_date
const generationStartDate = parseISO(tenant.startDate);

// NEW: Uses tracking_start_date (with fallback to lease_start_date)
const effectiveTrackingStart = tenant.trackingStartDate || tenant.startDate;
const generationStartDate = parseISO(effectiveTrackingStart);
```

**Result**: Payments are only generated from the tracking start date forward, not from historical lease start.

---

### 5. Rental Logic Hook

**File**: [useRentalLogic.ts](../src/hooks/useRentalLogic.ts)

**Interface Update**:

```typescript
export interface UseRentalLogicInput {
    tenantId: string;
    payments: RentPayment[];
    strikeHistory: StrikeRecord[];
    region?: NZRegion;
    currentDate?: Date;
    trackingStartDate?: string; // NEW: When we started tracking
    openingArrears?: number;    // NEW: Pre-existing debt
}
```

**Pass to Legal Engine**:

```typescript
const legalAnalysis = analyzeTenancySituation({
    tenantId: input.tenantId,
    region: input.region || 'Auckland',
    ledger,
    strikeHistory: input.strikeHistory,
    currentDate: input.currentDate,
    trackingStartDate: input.trackingStartDate,
    openingArrears: input.openingArrears || 0,
});
```

---

## Expected Behavior

### Day 1: New Tenant

**Input**:
- Tracking Start Date: January 24, 2026 (today)
- Opening Arrears: $0
- Rent: $200/week (due Thursdays)

**Expected**:
- Payments Generated: Jan 30 (first Thursday after Jan 24)
- Total Arrears: $0
- Status: "All Good" (Green)
- Property Card: "All Good"
- Tenant Card: "Paid to Jan 30"

✅ **No ghost debt!**

---

### Day 1: Existing Tenant (Paid Up)

**Input**:
- Lease Start: January 2, 2026 (3 weeks ago)
- Tracking Start Date: January 24, 2026 (today)
- Opening Arrears: $0
- Rent: $200/week (due Thursdays)

**Expected**:
- Payments Generated: Jan 30 (first Thursday after Jan 24)
- Total Arrears: $0
- Status: "All Good" (Green)
- Property Card: "All Good"
- Tenant Card: "Paid to Jan 30"

✅ **No ghost debt from before tracking start!**

---

### Day 1: Existing Tenant (Behind)

**Input**:
- Lease Start: January 2, 2026
- Tracking Start Date: January 24, 2026 (today)
- Opening Arrears: $400 (2 weeks behind)
- Rent: $200/week (due Thursdays)

**Expected**:
- Payments Generated: Jan 30 onwards
- Total Arrears: $400 (opening) + $0 (new) = $400
- Days Overdue: 0 days (just started tracking today)
- Working Days Overdue: 0 days
- Status: "Needs Look" (Amber)
- Property Card: "Needs Look"
- Tenant Card: "Payment Pending: $400.00 (0 days)"

**Next Day (Jan 25)**:
- Days Overdue: 1 day
- Working Days Overdue: 1 day (if working day)
- Status: "Needs Look" (Amber)

**After 5 Working Days (Jan 31)**:
- Days Overdue: 7 calendar days
- Working Days Overdue: 5 working days
- Status: "Behind" (Red) - Strike Notice Ready
- Banner: "Action Advised: Section 55 Strike Notice 1 Ready"

✅ **Proper Section 55 compliance from tracking start date!**

---

## Debug Logging

**Console Output (useRentalLogic.ts)**:

```javascript
🔍 useRentalLogic DEBUG TRACE: {
  trackingStartDate: '2026-01-24',
  openingArrears: 400,
  rawLedgerCount: 1,
  rawLedgerEntries: [
    { dueDate: '2026-01-30', amount: 200, status: 'Unpaid', amountPaid: 0 }
  ]
}

🔍 Legal Engine Output: {
  filteredTotalArrears: 400,
  daysArrears: 0,
  workingDaysOverdue: 0,
  openingArrearsIncluded: 400,
  expectedFilteredCount: 'Should exclude entries before 2026-01-24'
}
```

---

## Migration Instructions

### For Existing Users

When you run the migration, existing tenants will:
1. Have `tracking_start_date` set to their `lease_start_date` (or `created_at` if no lease start)
2. Have `opening_arrears` set to `0`

**What this means**:
- No behavior change for existing tenants
- New tenants benefit from the improved logic immediately

### For New Deployments

1. Run the migration: `supabase db reset` or apply via Supabase dashboard
2. All new tenants will have proper tracking start date and opening arrears fields

---

## FAQs

### Q: What if I don't fill in "Opening Arrears"?

**A**: It defaults to $0, which is correct for most cases (tenant starting fresh or is currently paid up).

---

### Q: Should I use "Lease Start" or "Tracking Start"?

**A**:
- **Lease Start**: Optional, for record-keeping only (when tenant originally moved in)
- **Tracking Start**: Required, for calculations (when you started tracking rent in this app)

For most new tenants, they'll be the same date (today). For existing tenants you're importing, they'll be different.

---

### Q: What if the tenant has been here for months and I owe them a refund?

**A**: Use a negative "Opening Arrears" value (e.g., `-$200` if you owe them $200). The math still works.

---

### Q: Can I change the Tracking Start Date after creation?

**A**: Yes, you can edit it in the "Manage Tenant" dialog (though this feature isn't implemented yet). For now, delete and re-add the tenant if needed.

---

### Q: What about Section 56 (14-Day Notice to Remedy)?

**A**: Works the same way. If there are opening arrears > $0, the first day counts as the tracking start date. Section 56 notice becomes available immediately (Day 1+).

---

## Files Changed

| File | Change |
|------|--------|
| [types/index.ts](../src/types/index.ts) | Added `trackingStartDate` and `openingArrears` to `Tenant` interface |
| [legal-engine.ts](../src/lib/legal-engine.ts) | Updated to filter ledger by `trackingStartDate` and include `openingArrears` in total |
| [useRentalLogic.ts](../src/hooks/useRentalLogic.ts) | Updated interface and pass new fields to legal engine |
| [AddTenantDialog.tsx](../src/components/dashboard/AddTenantDialog.tsx) | Added 3 new form fields (Lease Start, Tracking Start, Opening Arrears) |
| [rent-tracker/page.tsx](../src/app/rent-tracker/page.tsx) | Updated payment generation to use `trackingStartDate` |
| [20260124_add_tracking_fields.sql](../supabase/migrations/20260124_add_tracking_fields.sql) | Database migration for new columns |

---

## Testing Checklist

- [ ] Create new tenant with tracking start = today, opening arrears = 0 → Should show "All Good"
- [ ] Create new tenant with tracking start = today, opening arrears = $400 → Should show "Needs Look" with $400
- [ ] Create existing tenant (lease start 3 weeks ago), tracking start = today, opening arrears = 0 → Should show "All Good" (no ghost debt)
- [ ] Create existing tenant (lease start 3 weeks ago), tracking start = today, opening arrears = $400 → Should show "Needs Look" with $400
- [ ] Wait 5 working days with opening arrears > 0 → Should show "Behind" with Strike Notice Ready
- [ ] Record payment on tenant with opening arrears → Should reduce total arrears correctly

---

## Summary

**Before**: Ghost debt from historical payments, confusing arrears calculations

**After**: Clean slate tracking from today (or specified date), proper Section 55 compliance for pre-existing debt

**Result**: No more $800 ghost debt on Day 1! 🎉
