# Fix Summary: Section 55 Notice - All Overdue Dates

## Problem
Section 55 notices only showed a single overdue date instead of all unpaid payment dates.

**Before:**
```
* Dates for which the rent was/is overdue: 2026-01-30
```

**After (with 3 unpaid payments):**
```
* Dates for which the rent was/is overdue: 2026-01-07, 2026-01-14, 2026-01-30
```

## Root Cause
**File:** `src/components/rent-tracker/GenerateNoticeButton.tsx` (Line 177)

The `generateSection55Notice` call was passing:
```tsx
rentOverdueDates: [sentDate]  // ❌ Only one date
```

Even though the function signature accepts an array and the template correctly joins them:
```tsx
// In rent-logic.ts, line 411
* Dates for which the rent was/is overdue: ${rentOverdueDates.join(', ') || 'Current arrears period'}
```

## Solution Implemented

### 1. Calculate Unpaid Payment Dates (PropertyCard.tsx)
**Lines 152-153:**

```tsx
// unpaidPaymentDates = array of all unpaid payment due dates for Section 55 notice
const unpaidDates = tenantPayments.map(p => p.dueDate).sort();
```

**How it works:**
- Filters payments for tenant where `status === "Unpaid"`
- Maps to extract just the `dueDate` field
- Sorts chronologically (earliest first)

**Example:**
```tsx
tenantPayments = [
  { dueDate: "2026-01-30", amount: 500, status: "Unpaid" },
  { dueDate: "2026-01-14", amount: 500, status: "Unpaid" },
  { dueDate: "2026-01-07", amount: 500, status: "Unpaid" }
]

unpaidDates = ["2026-01-07", "2026-01-14", "2026-01-30"]
```

### 2. Pass Through Component Hierarchy

**PropertyCard → TenantCard:**
```tsx
<TenantCard
    unpaidPaymentDates={unpaidDates}  // ✅ Pass array
    ...
/>
```

**TenantCard → GenerateNoticeButton:**
```tsx
<GenerateNoticeButton
    unpaidPaymentDates={unpaidPaymentDates}  // ✅ Pass through
    ...
/>
```

### 3. Use in Notice Generation (GenerateNoticeButton.tsx)
**Line 175:**

**BEFORE:**
```tsx
rentOverdueDates: [sentDate],  // ❌ Single date
```

**AFTER:**
```tsx
rentOverdueDates: unpaidPaymentDates.length > 0 ? unpaidPaymentDates : [sentDate],  // ✅ All dates
```

**Fallback logic:**
- If `unpaidPaymentDates` has values → use them
- If empty (shouldn't happen) → fallback to `[sentDate]`

## Notice Template Output

### Example 1: Single Unpaid Payment
**Payments:**
- Jan 30: $500 (Unpaid)

**Notice shows:**
```
* Dates for which the rent was/is overdue: 2026-01-30
```

### Example 2: Multiple Unpaid Payments
**Payments:**
- Jan 7: $500 (Unpaid)
- Jan 14: $500 (Unpaid)
- Jan 30: $500 (Unpaid)

**Notice shows:**
```
* Dates for which the rent was/is overdue: 2026-01-07, 2026-01-14, 2026-01-30
```

### Example 3: Many Unpaid Payments
**Payments:**
- Dec 15: $500 (Unpaid)
- Jan 1: $500 (Unpaid)
- Jan 15: $500 (Unpaid)
- Jan 30: $500 (Unpaid)
- Feb 15: $500 (Unpaid)

**Notice shows:**
```
* Dates for which the rent was/is overdue: 2025-12-15, 2026-01-01, 2026-01-15, 2026-01-30, 2026-02-15
```

## Debug Logging Added

When calculating arrears, the console now shows:

```
💰 Arrears Calculation for John Doe: {
  unpaidPayments: 3,
  overdueAmount: 500,
  totalArrears: 1500,
  unpaidPaymentDates: ["2026-01-07", "2026-01-14", "2026-01-30"],  // ✅ NEW
  breakdown: [
    { dueDate: "2026-01-07", amount: 500 },
    { dueDate: "2026-01-14", amount: 500 },
    { dueDate: "2026-01-30", amount: 500 }
  ]
}
```

## Testing Steps

### Test 1: Single Unpaid Payment
1. Mark tenant unpaid once
2. Generate Section 55 notice
3. **Expected:** Shows single date
   ```
   * Dates for which the rent was/is overdue: 2026-01-30
   ```

### Test 2: Multiple Unpaid Payments
1. Mark tenant unpaid 3 times (or use "Record Missed Rent")
2. Open console (F12)
3. **Expected:**
   ```
   💰 Arrears Calculation:
   unpaidPaymentDates: ["2026-01-07", "2026-01-14", "2026-01-30"]
   ```
4. Generate Section 55 notice
5. **Expected:** Shows all dates comma-separated
   ```
   * Dates for which the rent was/is overdue: 2026-01-07, 2026-01-14, 2026-01-30
   ```

### Test 3: Verify Sorting
1. Create unpaid payments in random order:
   - Record Jan 30
   - Record Jan 7
   - Record Jan 14
2. Generate notice
3. **Expected:** Dates shown in chronological order (Jan 7, Jan 14, Jan 30)

## Files Modified

### Modified Files
- `src/components/dashboard/PropertyCard.tsx` (Lines 152-153, 157, 169)
- `src/components/dashboard/TenantCard.tsx` (Lines 17, 33, 150)
- `src/components/rent-tracker/GenerateNoticeButton.tsx` (Lines 39, 61, 175)

### Changes Summary
1. **PropertyCard:** Calculate `unpaidDates` array from payments
2. **TenantCard:** Accept and pass through `unpaidPaymentDates` prop
3. **GenerateNoticeButton:** Accept `unpaidPaymentDates` and use in Section 55 notice

## Important Notes

### Date Format
Dates are stored as ISO strings (YYYY-MM-DD) in the database and passed as-is to the notice template. The `generateSection55Notice` function formats them for display using `date-fns`:

```tsx
const dueDateFormatted = format(parseISO(dueDate), 'd MMMM yyyy');
// "2026-01-30" → "30 January 2026"
```

### Sorting
The dates are sorted chronologically (earliest first) using JavaScript's default string sort, which works correctly for ISO date strings:

```tsx
["2026-01-30", "2026-01-07", "2026-01-14"].sort()
// → ["2026-01-07", "2026-01-14", "2026-01-30"]
```

### Section 56 Not Affected
Section 56 notices don't use `rentOverdueDates` - they show total arrears amount instead. This change only affects Section 55 notices.

### Empty Array Fallback
If `unpaidPaymentDates` is empty (shouldn't happen if notice is being generated), it falls back to `[sentDate]` to ensure the notice always shows at least one date.

## Benefits

1. **Accurate Compliance:** Shows all overdue dates as required by RTA
2. **Better Evidence:** Complete record of all missed payments in notice
3. **Tribunal Ready:** Provides full payment history for tribunal applications
4. **Automatic:** No manual input needed - pulls from payments table
5. **Scalable:** Works with any number of unpaid payments

## Related Features

This fix works seamlessly with:
- **Record Missed Rent:** All recorded missed payments appear in the list
- **Paid/Unpaid Toggle:** Toggled unpaid payments appear in the list
- **Arrears Calculation:** Same data source ensures consistency
- **Evidence Ledger:** Dates match logged events
