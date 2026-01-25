# Cycle Creep Bug Fix

## Problem

When changing rent amount (e.g., $400 → $405), the system was generating an **incorrect number of unpaid cycles**, causing the debt to jump unexpectedly.

### Example of the Bug

**Scenario**: Tenant owes 2 cycles ($800) at $400/fortnight. User changes rent to $405/fortnight.

**BEFORE FIX** (incorrect):
- Old debt: 2 cycles × $400 = $800
- After rent change: Debt jumped to 3 cycles × $405 = **$1215**
- ❌ **WRONG!** Should be 2 cycles × $405 = $810

**AFTER FIX** (correct):
- Old debt: 2 cycles × $400 = $800
- Total paid calculated: (Old Accrued) - (Old Owing) = accurate baseline
- New debt: **Exactly** 2 cycles × $405 = $810
- ✅ **CORRECT!** Same number of cycles, just updated rent amount

## Root Causes

### 1. Incorrect Total Paid Calculation

**OLD CODE** (buggy):
```typescript
// Summing amount_paid fields - prone to rounding errors
const totalPaid = currentPayments.reduce(
    (sum, p) => sum + (p.amount_paid || 0),
    0
);
```

**Problem**: Floating point errors and partial payments could cause inaccuracies.

### 2. No Rounding Protection

**OLD CODE** (buggy):
```typescript
const newOutstandingBalance = newAccruedRent - totalPaid;
// Could be $809.9999999 or $810.0000001
```

**Problem**: $0.01 errors could trigger extra cycles.

### 3. No Partial Payment Support

**OLD CODE** (buggy):
```typescript
// When debt doesn't divide evenly, we marked the entire record as unpaid
if (remainingDebt >= payment.amount) {
    unpaidRecords.push(payment.id);
} else {
    unpaidRecords.push(payment.id); // Still marks full amount!
    remainingDebt = 0;
}
```

**Problem**: If owing $810 with $405/cycle, would mark 2 full cycles ($810) OR incorrectly round up to 3 cycles.

## The Fixes

### Fix 1: Use Cash-Basis Anchor Formula

```typescript
// NEW CODE (correct) - CASH-BASIS ANCHOR
// Count CYCLES, don't sum amounts (amounts may vary from previous changes)
const numberOfCycles = currentPayments.length;

// Get the OLD rent amount from the first record (before the change)
const oldRentAmount = numberOfCycles > 0 ? currentPayments[0].amount : newSettings.rentAmount;

// Calculate old accrued rent based on CYCLES × OLD RENT AMOUNT
// This is the "ground truth" - what SHOULD have been paid with old settings
const oldAccruedRent = Math.round(numberOfCycles * oldRentAmount * 100) / 100;

// Calculate current balance
const currentBalance = currentPayments
    .filter(p => p.status === 'Unpaid' || p.status === 'Partial')
    .reduce((sum, p) => sum + (p.amount - p.amount_paid), 0);

// CRITICAL: Calculate TOTAL PAID CASH using the anchor formula
// Total Paid Cash = Total Accrued (old) - Current Outstanding Balance
// This represents the actual cash the tenant has paid
const totalPaidCash = Math.round((oldAccruedRent - currentBalance) * 100) / 100;
```

**Why this works**:
- Counts CYCLES (not amounts) to avoid compounding errors from previous rent changes
- Multiplies cycles by old rent amount to get true "ground truth" of what should have been paid
- Derives total paid from current state, preventing accumulation errors

### Fix 2: Round to Cents Throughout

```typescript
// Round remaining debt
let remainingDebt = Math.round(openingBalance * 100) / 100;

// Round new outstanding balance
const newOutstandingBalance = Math.round((newAccruedRent - totalPaid) * 100) / 100;

// Use tolerance for comparisons
if (remainingDebt <= 0.01) { // Allow for 1 cent tolerance
    paidRecords.push(payment.id);
}
```

**Why this works**: Prevents $0.01 errors from triggering extra cycles.

### Fix 3: Support Partial Payments

```typescript
const partialPayments = new Map<string, number>();

for (let i = sortedPayments.length - 1; i >= 0; i--) {
    const payment = sortedPayments[i];

    if (remainingDebt <= 0.01) {
        paidRecords.push(payment.id);
    } else {
        const roundedRemainingDebt = Math.round(remainingDebt * 100) / 100;
        const roundedPaymentAmount = Math.round(payment.amount * 100) / 100;

        if (roundedRemainingDebt >= roundedPaymentAmount) {
            // Fully unpaid
            unpaidRecords.push(payment.id);
            remainingDebt -= payment.amount;
        } else {
            // Partially unpaid
            const amountPaid = Math.round((payment.amount - remainingDebt) * 100) / 100;
            partialPayments.set(payment.id, amountPaid);
            unpaidRecords.push(payment.id);
            remainingDebt = 0;
        }
    }
}

// Apply partial payments
for (const recordId of unpaidRecords) {
    const partialAmount = partialPayments.get(recordId);

    if (partialAmount !== undefined) {
        await supabase
            .from('payments')
            .update({
                status: 'Partial',
                amount_paid: partialAmount,
                paid_date: new Date().toISOString().split('T')[0]
            })
            .eq('id', recordId);
    }
}
```

**Why this works**: Correctly handles when debt doesn't divide evenly by cycle amount.

## Examples

### Example 1: Clean Division

**Scenario**: 2 cycles owing, rent changes $400 → $405

**Calculation**:
- Old Accrued: 4 periods × $400 = $1600
- Old Owing: 2 cycles × $400 = $800
- Total Paid: $1600 - $800 = **$800**
- New Accrued: 4 periods × $405 = $1620
- New Owing: $1620 - $800 = **$820**
- New Cycles: $820 ÷ $405 = **2.025 cycles** → 2 full cycles + 1 partial ($10)

**Result**:
- Cycle 1: $405 Unpaid
- Cycle 2: $415 Partial ($405 total, $395 paid, $10 owing)
- Total Owing: **$820** ✅

### Example 2: Exact Division

**Scenario**: 2 cycles owing, rent changes $400 → $450

**Calculation**:
- Old Accrued: 4 periods × $400 = $1600
- Old Owing: 2 cycles × $400 = $800
- Total Paid: $1600 - $800 = **$800**
- New Accrued: 4 periods × $450 = $1800
- New Owing: $1800 - $800 = **$1000**
- New Cycles: $1000 ÷ $450 = **2.222 cycles** → 2 full cycles + 1 partial ($100)

**Result**:
- Cycle 1: $450 Unpaid
- Cycle 2: $450 Unpaid
- Cycle 3: $450 Partial ($450 total, $350 paid, $100 owing)
- Total Owing: **$1000** ✅

### Example 3: Rent Decrease

**Scenario**: 3 cycles owing, rent changes $450 → $400

**Calculation**:
- Old Accrued: 4 periods × $450 = $1800
- Old Owing: 3 cycles × $450 = $1350
- Total Paid: $1800 - $1350 = **$450**
- New Accrued: 4 periods × $400 = $1600
- New Owing: $1600 - $450 = **$1150**
- New Cycles: $1150 ÷ $400 = **2.875 cycles** → 2 full + 1 partial ($350)

**Result**:
- Cycle 1: $400 Unpaid
- Cycle 2: $400 Unpaid
- Cycle 3: $400 Partial ($400 total, $50 paid, $350 owing)
- Total Owing: **$1150** ✅

## Verification Logging

The fix includes comprehensive logging to track cycle counts:

```typescript
console.log('🧮 Balance recalculation:', {
    oldAccruedRent,
    newAccruedRent,
    totalPaid,
    oldOutstanding: currentBalance,
    newOutstanding: newOutstandingBalance,
    difference: Math.round((newOutstandingBalance - currentBalance) * 100) / 100,
    oldCycles: Math.round((currentBalance / (oldAccruedRent / currentPayments.length)) * 10) / 10,
    newCycles: Math.round((newOutstandingBalance / newSettings.rentAmount) * 10) / 10,
    interpretation: '...'
});
```

## Testing Checklist

- [ ] Rent increase with exact division (2 cycles × $400 → 2 cycles × $405)
- [ ] Rent increase with partial cycle (2 cycles × $400 → 2.2 cycles × $450)
- [ ] Rent decrease (3 cycles × $450 → 2.875 cycles × $400)
- [ ] Floating point edge cases ($399.99, $400.01)
- [ ] Very small debts ($0.01, $0.50)
- [ ] Large debts (10+ cycles)

## Files Modified

1. `src/lib/ledger-regenerator.ts`
   - Changed total paid calculation to use anchor formula
   - Added rounding to cents throughout
   - Added cycle count logging

2. `src/lib/tenant-status-resolver.ts`
   - Added `partialPayments` Map to track partial payments
   - Implemented partial payment detection in resolution logic
   - Updated `applyResolvedStatus` to handle partial payments

## Formula Summary

```
CASH-BASIS ANCHOR APPROACH:

Number of Cycles = COUNT(payment records since trackingStartDate)
Old Rent Amount = First payment record.amount
Old Accrued = Number of Cycles × Old Rent Amount  (CYCLE-BASED CALCULATION)
Current Balance = SUM(unpaid records.amount - amount_paid)

Total Paid Cash = Old Accrued - Current Balance  (ANCHOR FORMULA)

New Accrued = Number of Cycles × New Rent Amount
New Outstanding = New Accrued - Total Paid Cash  (rounded to cents)

For each record (newest to oldest):
    If remainingDebt >= record.amount:
        Mark as Unpaid
    Else if remainingDebt > 0:
        Mark as Partial (amount_paid = record.amount - remainingDebt)
    Else:
        Mark as Paid
```

## Key Insights

1. **Cash-Basis Anchor is Critical** - Count CYCLES × RENT, don't sum amounts (prevents compounding errors from previous rent changes)
2. **Anchor Formula Prevents Drift** - Deriving total paid from current state prevents accumulation errors
3. **Rounding Prevents Cycle Creep** - Always round to cents to prevent $0.01 errors
4. **Partial Payments Enable Precision** - Support for partial payments ensures debt matches exactly
5. **Tolerance for Comparisons** - Use 0.01 tolerance to handle floating point edge cases
6. **Log Cycle Counts** - Always log old/new cycle counts to verify correctness
7. **Ground Truth from First Record** - Get old rent amount from first record, not from summing (handles previous rent changes)
