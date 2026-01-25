# Balance Drift Bug Fix

## Problem

When changing rent amount (e.g., $405 → $400), the outstanding balance would **drift incorrectly** because the system wasn't preserving the **Total Paid to Date**.

### Example of the Bug

**Scenario**: Tenant has paid $1620 over 4 fortnightly periods at $405/fortnight. User changes rent to $400/fortnight.

**BEFORE FIX** (incorrect):
- System calculated: `currentBalance = $0` (tenant was paid up)
- After regeneration: Balance jumped to **$1200**
- ❌ **WRONG!** This created phantom debt out of nowhere

**AFTER FIX** (correct):
- System calculates:
  - Total Paid: $1620
  - Old Accrued: 4 periods × $405 = $1620
  - New Accrued: 4 periods × $400 = $1600
  - New Outstanding: $1600 - $1620 = **-$20** (tenant has $20 credit!)
- ✅ **CORRECT!** Tenant overpaid when rent was higher

## Root Cause

The ledger regenerator was only tracking **unpaid balance** but not **total paid**:

```typescript
// OLD CODE (BUGGY)
const currentBalance = currentPayments
    .filter(p => p.status === 'Unpaid')
    .reduce((sum, p) => sum + (p.amount - p.amount_paid), 0);

// Problem: When all records are Paid, currentBalance = $0
// After regeneration with new rent, we lose track of what was paid!
```

## The Fix

### Step 1: Track Total Paid

```typescript
// NEW CODE (FIXED)
// Calculate TOTAL PAID (across ALL records, not just unpaid ones)
const totalPaid = currentPayments.reduce(
    (sum, p) => sum + (p.amount_paid || 0),
    0
);

// Calculate old accrued rent
const oldAccruedRent = currentPayments.reduce(
    (sum, p) => sum + p.amount,
    0
);

// Calculate current unpaid balance
const currentBalance = currentPayments
    .filter(p => p.status === 'Unpaid' || p.status === 'Partial')
    .reduce((sum, p) => sum + (p.amount - p.amount_paid), 0);
```

### Step 2: Calculate New Accrued Rent

```typescript
// After generating new records with new rent amount
const newAccruedRent = insertedPayments.reduce(
    (sum, p) => sum + p.amount,
    0
);
```

### Step 3: Calculate New Outstanding Balance

```typescript
// CRITICAL FORMULA:
// New Outstanding = New Accrued Rent - Total Paid
const newOutstandingBalance = newAccruedRent - totalPaid;
```

### Step 4: Handle Credits

```typescript
if (newOutstandingBalance <= 0) {
    // Tenant has credit or is paid up
    // Mark ALL new records as Paid
    console.log('Tenant has credit or is paid up');

    // Mark all records as fully paid
    for (const record of insertedPayments) {
        await supabase
            .from('payments')
            .update({
                status: 'Paid',
                amount_paid: record.amount,
                paid_date: currentDate
            })
            .eq('id', record.id);
    }
}
```

### Step 5: Ghost Record Detection

```typescript
// Verify deletion - check for ghost records
const { data: ghostCheck } = await supabaseClient
    .from('payments')
    .select('id, due_date, amount')
    .eq('tenant_id', tenantId)
    .gte('due_date', trackingStartDate);

if (ghostCheck && ghostCheck.length > 0) {
    throw new Error(`Ghost records detected: ${ghostCheck.length} records remain after deletion`);
}
```

## Examples

### Example 1: Rent Increase ($400 → $405)

**Initial State**:
- Tracking start: Nov 1
- 4 periods paid: Nov 7, Nov 21, Dec 5, Dec 19
- Total paid: 4 × $400 = $1600
- Balance: $0 (paid up)

**After Rent Change to $405**:
- New accrued: 4 × $405 = $1620
- Total paid: $1600 (unchanged)
- New balance: $1620 - $1600 = **$20 owing** ✅

**Result**: Tenant now owes $20 (one $405 period minus the $400 they paid)

### Example 2: Rent Decrease ($405 → $400)

**Initial State**:
- Tracking start: Nov 1
- 4 periods paid: Nov 7, Nov 21, Dec 5, Dec 19
- Total paid: 4 × $405 = $1620
- Balance: $0 (paid up)

**After Rent Change to $400**:
- New accrued: 4 × $400 = $1600
- Total paid: $1620 (unchanged)
- New balance: $1600 - $1620 = **-$20 (credit!)** ✅

**Result**: Tenant has $20 credit (they overpaid when rent was higher)

### Example 3: Rent Change with Existing Debt

**Initial State**:
- Tracking start: Nov 1
- 4 periods: Nov 7, Nov 21, Dec 5, Dec 19
- Rent: $400
- Total accrued: $1600
- Total paid: $1000
- Balance: $600 owing

**After Rent Change to $450**:
- New accrued: 4 × $450 = $1800
- Total paid: $1000 (unchanged)
- New balance: $1800 - $1000 = **$800 owing** ✅

**Result**: Debt increased by $200 (4 periods × $50 increase)

## Verification

The fix includes comprehensive logging:

```typescript
console.log('🧮 Balance recalculation:', {
    oldAccruedRent,
    newAccruedRent,
    totalPaid,
    oldOutstanding: currentBalance,
    newOutstanding: newOutstandingBalance,
    difference: newOutstandingBalance - currentBalance,
    interpretation: newOutstandingBalance < 0
        ? `Tenant has CREDIT of $${Math.abs(newOutstandingBalance).toFixed(2)}`
        : newOutstandingBalance === 0
        ? 'Tenant is paid up'
        : `Tenant owes $${newOutstandingBalance.toFixed(2)}`
});
```

## Testing

To test the fix:

1. Create a tenant with $400 fortnightly, track from Nov 1
2. Make 4 payments (fully paid up)
3. Change rent to $405
4. Check balance: Should show **$20 owing**
5. Change rent to $400
6. Check balance: Should show **$0 owing** (back to paid up)
7. Change rent to $450
8. Check balance: Should show **$200 owing**

## Files Modified

- `src/lib/ledger-regenerator.ts` - Added total paid tracking and new balance calculation

## Formula Summary

```
Total Paid = SUM(all records.amount_paid)
Old Accrued Rent = SUM(old records.amount)
New Accrued Rent = SUM(new records.amount)

New Outstanding Balance = New Accrued Rent - Total Paid

If New Outstanding <= 0:
    Mark all records as Paid (tenant has credit or is paid up)
Else:
    Use AI Resolver to redistribute debt across most recent periods
```

## Key Insights

1. **Total Paid is Immutable** - What the tenant has paid doesn't change when settings change
2. **Accrued Rent Changes** - What they "should have paid" recalculates with new rent
3. **Balance = Accrued - Paid** - Simple, correct formula that prevents drift
4. **Credits are Valid** - If rent decreases, tenant may have overpaid (this is correct!)
5. **Ghost Records Must Die** - Verify deletion before creating new records
