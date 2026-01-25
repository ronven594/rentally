# Section 56: Debt-Specific Remedy Tracking

## Overview

A **14-Day Notice to Remedy (Section 56)** is legally valid **ONLY for the specific debt** it was issued for. If that specific debt is paid, the notice is "spent" or "remedied" - even if new debt has appeared since the notice was issued.

## The Problem (Before Implementation)

**Incorrect Behavior:**
```typescript
// OLD LOGIC - WRONG
isEligibleSection56 = expiryDatePassed && totalBalanceDue > 0;
```

**Issue:** If a tenant:
1. Owes $900 (due Jan 15)
2. Gets S56 notice on Jan 20 for that $900
3. Pays the $900 on Jan 25 (remedied the breach)
4. Then owes NEW $900 (due Feb 15)

The old logic would show "Ready for Tribunal" because `totalBalanceDue > 0`, but this is **legally incorrect**. The original notice was for the Jan debt, which has been paid. The Feb debt is NEW and requires a NEW notice.

## The Solution (Current Implementation)

### 1. Snapshot the Debt When Creating S56 Notice

When creating a 14-Day Notice to Remedy, capture the **specific debt** in `metadata`:

```typescript
import { createS56Metadata } from '@/hooks/useRentalLogic';

// Get unpaid ledger entries at time of notice creation
const unpaidLedger = payments.filter(p =>
    p.status === 'Unpaid' || p.status === 'Partial'
);

// Create metadata snapshot
const metadata = createS56Metadata(unpaidLedger.map(p => ({
    id: p.id,
    dueDate: p.dueDate,
    amount: p.amount,
    amountPaid: p.amount_paid || 0,
    status: p.status,
})));

// Store in database
await supabase.from('notices').insert({
    tenant_id: tenantId,
    property_id: propertyId,
    notice_type: 'S56_REMEDY',
    official_service_date: serviceDate,
    expiry_date: expiryDate,
    amount_owed: metadata.total_amount_owed,
    metadata: metadata,  // ← CRITICAL: Store debt snapshot
    // ... other fields
});
```

### 2. Metadata Structure

The `metadata` JSONB column contains:

```typescript
interface S56NoticeMetadata {
    // IDs of specific ledger entries that were unpaid
    ledger_entry_ids: string[];          // ["uuid-1", "uuid-2"]

    // Specific due dates that were unpaid
    due_dates: string[];                 // ["2026-01-15", "2026-01-22"]

    // Total amount owed at time of notice
    total_amount_owed: number;           // 1800.00

    // Amount owed per due date
    unpaid_amounts: Record<string, number>; // {"2026-01-15": 900.00}
}
```

**Example:**
```json
{
  "ledger_entry_ids": ["abc-123", "def-456"],
  "due_dates": ["2026-01-15", "2026-01-22"],
  "total_amount_owed": 1800.00,
  "unpaid_amounts": {
    "2026-01-15": 900.00,
    "2026-01-22": 900.00
  }
}
```

### 3. Check if Specific Debt Was Remedied

The logic in `useRentalLogic` now:

1. Finds the most recent S56 notice
2. Extracts the `metadata` containing specific debt snapshot
3. Calculates payments made **AFTER** notice date on those **SPECIFIC** ledger entries
4. Determines if the specific debt has been paid

```typescript
// Get specific ledger entries from notice metadata
const specificEntries = ledger.filter(entry =>
    metadata.ledger_entry_ids.includes(entry.id)
);

// Calculate payments made AFTER notice date
let totalPaidOnSpecificDebt = 0;
specificEntries.forEach(entry => {
    if (entry.paidDate) {
        const paymentDate = parseISO(entry.paidDate);
        if (isAfter(paymentDate, noticeDate)) {
            totalPaidOnSpecificDebt += entry.amountPaid;
        }
    }
});

// Check if specific debt is remedied
const specificDebtRemaining = metadata.total_amount_owed - totalPaidOnSpecificDebt;
isEligibleSection56 = specificDebtRemaining > 0.01; // Allow rounding tolerance
```

## UI Behavior

### Scenario 1: Old Debt Remedied, New Debt Exists

**State:**
- S56 notice issued Jan 20 for $900 (due Jan 15)
- Tenant paid $900 on Jan 25 ✓ (remedied)
- New debt: $900 (due Feb 15) ✗

**UI Display:**
- ✅ **SEND_14_DAY_REMEDY** button available (for new debt)
- ❌ **APPLY_TERMINATION** button NOT available (old notice was remedied)
- Message: "Previous notice remedied. New debt requires new notice."

### Scenario 2: Old Debt Still Unpaid

**State:**
- S56 notice issued Jan 20 for $900 (due Jan 15)
- 14-day expiry passed (Feb 4)
- Tenant still owes $900 ✗

**UI Display:**
- ❌ **SEND_14_DAY_REMEDY** button NOT available (don't send duplicate)
- ✅ **APPLY_TERMINATION** button available (unremedied breach)
- Message: "14-Day Notice expired. Ready for Tribunal."

### Scenario 3: Partial Payment of Specific Debt

**State:**
- S56 notice issued Jan 20 for $1800 (Jan 15 + Jan 22)
- Tenant paid $900 on Jan 25 (partial)
- Still owes $900 from the specific debt ✗

**UI Display:**
- ❌ **SEND_14_DAY_REMEDY** button NOT available
- ✅ **APPLY_TERMINATION** button available (specific debt not fully remedied)
- Message: "14-Day Notice expired. Partial payment received but debt remains."

## Database Schema

### notices.metadata Column

For S56_REMEDY notices, the metadata column **MUST** contain the debt snapshot:

```sql
-- Example insert
INSERT INTO notices (
    tenant_id,
    property_id,
    notice_type,
    official_service_date,
    expiry_date,
    amount_owed,
    metadata
) VALUES (
    'tenant-uuid',
    'property-uuid',
    'S56_REMEDY',
    '2026-01-20',
    '2026-02-03',
    1800.00,
    '{
        "ledger_entry_ids": ["entry-1", "entry-2"],
        "due_dates": ["2026-01-15", "2026-01-22"],
        "total_amount_owed": 1800.00,
        "unpaid_amounts": {"2026-01-15": 900.00, "2026-01-22": 900.00}
    }'::jsonb
);
```

### Querying Section 56 Status

```sql
-- Check if specific debt was remedied
WITH notice_metadata AS (
    SELECT
        id,
        official_service_date,
        metadata->>'total_amount_owed' AS original_debt,
        metadata->'ledger_entry_ids' AS entry_ids
    FROM notices
    WHERE tenant_id = 'tenant-uuid'
      AND notice_type = 'S56_REMEDY'
    ORDER BY official_service_date DESC
    LIMIT 1
)
-- Would need to join with payments to calculate if remedied
SELECT * FROM notice_metadata;
```

## TypeScript Types

```typescript
// Import types
import type { S56NoticeMetadata } from '@/lib/legal-engine';

// Create metadata snapshot
import { createS56Metadata } from '@/hooks/useRentalLogic';

// Use in StrikeRecord
interface StrikeRecord {
    noticeId: string;
    officialServiceDate: string;
    type: NoticeType;
    metadata?: S56NoticeMetadata;  // ← For S56 notices
}
```

## Migration Path

### For Existing S56 Notices (Without Metadata)

The code includes backwards compatibility:

```typescript
if (metadata && metadata.ledger_entry_ids && metadata.total_amount_owed) {
    // NEW LOGIC: Check specific debt
    // ...
} else {
    // FALLBACK: Old logic for notices created before metadata
    isEligibleSection56 = totalBalanceDue > 0;
}
```

**Recommendation:** Re-issue any active S56 notices with proper metadata snapshots.

## Legal Compliance Notes

1. **RTA Section 56** requires the breach to be remedied within 14 days
2. The breach is **specific** to the debt mentioned in the notice
3. Paying that specific debt = remedied breach (notice "spent")
4. New debt = new breach = requires new notice
5. Cannot apply for termination based on a remedied notice

## Testing

Test cases included in `src/__tests__/rta-compliance.test.ts`:

```typescript
it('Section 56: Specific debt remedied should not allow tribunal', () => {
    // Issue S56 for $900 debt
    // Pay that specific $900
    // Incur NEW $900 debt
    // Verify: isEligibleSection56 = false
});

it('Section 56: Specific debt unpaid should allow tribunal', () => {
    // Issue S56 for $900 debt
    // Wait 14+ days
    // Verify: isEligibleSection56 = true
});
```

## Financial Math: Cents-Based Integer Arithmetic

### The Problem: Floating Point Precision

JavaScript has a famous floating point bug:

```javascript
// JavaScript floating point arithmetic is BROKEN for money
0.1 + 0.2 === 0.3  // false (actually 0.30000000000000004)

// This causes real bugs in financial calculations:
const paid = 900.00;
const owed = 900.00;
const remaining = owed - paid;  // Might be 0.0000000001 instead of 0

if (remaining > 0.01) {
    // BUG: Might trigger incorrectly due to floating point error
    console.log("Debt still owed");
}
```

### The Solution: Integer Cents Arithmetic

Instead of comparing dollar amounts directly, convert to **integer cents**:

```typescript
/**
 * Compares two monetary amounts using cents-based integer math.
 * Avoids floating point precision errors.
 */
function moneyEquals(amount1: number, amount2: number): boolean {
    const cents1 = Math.round(amount1 * 100);
    const cents2 = Math.round(amount2 * 100);
    return cents1 === cents2;
}

function moneyGreaterThan(amount1: number, amount2: number): boolean {
    const cents1 = Math.round(amount1 * 100);
    const cents2 = Math.round(amount2 * 100);
    return cents1 > cents2;
}

function moneyIsZero(amount: number): boolean {
    return Math.abs(Math.round(amount * 100)) === 0;
}
```

### Usage in Section 56 Logic

**Before (Risky):**
```typescript
// BAD: Floating point comparison
const specificDebtRemaining = metadata.total_amount_owed - totalPaidOnSpecificDebt;
isEligibleSection56 = specificDebtRemaining > 0.01;  // Unreliable!
```

**After (Safe):**
```typescript
// GOOD: Integer cents comparison
const specificDebtRemaining = metadata.total_amount_owed - totalPaidOnSpecificDebt;
isEligibleSection56 = moneyGreaterThan(specificDebtRemaining, 0);
```

### Why This Matters

**Scenario:** Tenant owes $900.00, pays $900.00

**Before Fix:**
- `remaining = 900.00 - 900.00 = 0.00000000001` (floating point error)
- `remaining > 0.01` → `false` ✓ (lucky - works by coincidence)
- `remaining > 0` → `true` ❌ (BUG - shows debt still owed!)

**After Fix:**
- `remainingCents = 90000 - 90000 = 0` (exact integer math)
- `moneyGreaterThan(remaining, 0)` → `false` ✓ (always correct)

### Real-World Example

```typescript
// Tenant pays $1800.00 in three installments
const payment1 = 600.00;
const payment2 = 600.00;
const payment3 = 600.00;
const totalPaid = payment1 + payment2 + payment3;  // 1800.0000000000002 (!)

const owed = 1800.00;

// BAD: Floating point comparison
if (totalPaid === owed) {
    // Never executes due to 0.0000000002 difference!
}

// GOOD: Cents-based comparison
if (moneyEquals(totalPaid, owed)) {
    // Always works correctly ✓
}
```

### Future Enhancement

For maximum precision in production, consider storing all amounts as **integer cents** in the database:

```typescript
// Instead of storing $18.50 as 18.50 (float)
// Store as 1850 (integer cents)

interface Payment {
    amount_cents: number;  // 90000 = $900.00
}

// Convert for display
function formatMoney(cents: number): string {
    const dollars = cents / 100;
    return `$${dollars.toFixed(2)}`;
}
```

This eliminates floating point errors entirely at the database level.

## Summary

✅ **Correct Implementation:**
- S56 notice snapshots specific debt in `metadata`
- Eligibility checks if **specific debt** was paid
- UI suggests new notice when old debt remedied but new debt exists
- Uses **cents-based integer arithmetic** to avoid floating point bugs
- Legally compliant with RTA Section 56

❌ **Incorrect Implementation:**
- Checking `totalBalanceDue > 0` without debt specificity
- Showing tribunal eligibility when notice was remedied
- Not distinguishing between old debt and new debt
- Using `amount > 0.01` floating point comparisons (unreliable)
