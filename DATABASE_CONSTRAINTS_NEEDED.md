# Database Constraints Required for Strike Deduplication

## Overview
After refactoring `rent-logic.ts` to remove module-level state, we now rely on **database-level uniqueness constraints** to prevent duplicate strike logging instead of in-memory Sets.

## Required Constraint

### Evidence Ledger Table

Add a unique constraint to the `evidence_ledger` table to prevent duplicate strike entries:

```sql
-- Prevent duplicate strikes for the same tenant/property/date/event combination
ALTER TABLE evidence_ledger
ADD CONSTRAINT unique_strike_per_payment
UNIQUE (property_id, tenant_id, event_type, metadata->>'dueDate');
```

### Explanation

- **property_id**: The property where the strike occurred
- **tenant_id**: The tenant who received the strike
- **event_type**: The type of event (e.g., 'STRIKE_ISSUED')
- **metadata->>'dueDate'**: The due date of the payment (extracted from JSONB metadata field)

This ensures that only ONE strike can be logged per tenant/property/due date combination.

### Alternative Constraint (Simpler)

If the metadata extraction is problematic, use created_at truncation:

```sql
-- Prevent duplicate strikes within the same day
ALTER TABLE evidence_ledger
ADD CONSTRAINT unique_strike_per_tenant_per_day
UNIQUE (property_id, tenant_id, event_type, DATE(created_at));
```

## Migration Script

### For Supabase

Run this in the Supabase SQL Editor:

```sql
-- Step 1: Check for existing duplicates
SELECT
    property_id,
    tenant_id,
    event_type,
    metadata->>'dueDate' as due_date,
    COUNT(*) as duplicate_count
FROM evidence_ledger
WHERE event_type = 'STRIKE_ISSUED'
GROUP BY property_id, tenant_id, event_type, metadata->>'dueDate'
HAVING COUNT(*) > 1;

-- Step 2: Clean up duplicates (keep earliest entry)
WITH duplicates AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY property_id, tenant_id, event_type, metadata->>'dueDate'
            ORDER BY created_at ASC
        ) as rn
    FROM evidence_ledger
    WHERE event_type = 'STRIKE_ISSUED'
)
DELETE FROM evidence_ledger
WHERE id IN (
    SELECT id FROM duplicates WHERE rn > 1
);

-- Step 3: Add the unique constraint
ALTER TABLE evidence_ledger
ADD CONSTRAINT unique_strike_per_payment
UNIQUE (property_id, tenant_id, event_type, (metadata->>'dueDate'));
```

## Error Handling

When the constraint is in place, duplicate insert attempts will fail with:

```
ERROR: duplicate key value violates unique constraint "unique_strike_per_payment"
```

The code handles this gracefully:

```typescript
try {
    await logToEvidenceLedger(...);
} catch (err) {
    console.error("❌ Failed to log strike:", err);
    // Strike detection still succeeds - duplicate constraint prevents double-logging
}
```

## Benefits

1. **Thread-safe**: No race conditions from multiple requests
2. **Stateless**: Works in serverless/edge environments
3. **Persistent**: Deduplication survives server restarts
4. **Auditable**: Database enforces consistency

## Testing

After applying the constraint, test with:

```typescript
// Try logging the same strike twice
await isStrikeWithLogging(
    "2026-01-01",
    "2026-01-10",
    "Wellington",
    "property-123",
    "tenant-456"
);

await isStrikeWithLogging(
    "2026-01-01",
    "2026-01-10",
    "Wellington",
    "property-123",
    "tenant-456"
);

// Second call should fail gracefully (logged to console, not thrown)
// Only one strike entry should exist in evidence_ledger
```

## Rollback Plan

If issues arise, remove the constraint:

```sql
ALTER TABLE evidence_ledger
DROP CONSTRAINT IF EXISTS unique_strike_per_payment;
```

## Next Steps

1. Apply the constraint in Supabase (run SQL above)
2. Test in development environment
3. Monitor error logs for constraint violations
4. If successful, document in codebase README

---

**Date Created**: 2026-01-17
**Related Files**:
- `src/lib/rent-logic.ts` (strike detection logic)
- `src/services/evidenceLedger.ts` (logging service)
- `src/app/rent-tracker/page.tsx` (payment recording)
