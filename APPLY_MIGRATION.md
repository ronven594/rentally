# Apply Database Migration - Strike Uniqueness Constraint

## ⚠️ CRITICAL: This migration MUST be applied for the refactor to work correctly

The refactor removed module-level state and now relies on database constraints to prevent duplicate strikes.

---

## Option 1: Supabase Web Dashboard (RECOMMENDED - 2 minutes)

### Steps:

1. **Open Supabase Dashboard**
   - Go to: https://supabase.com/dashboard/project/aojcpoichyxebxsnwitf
   - Navigate to: **SQL Editor** (left sidebar)

2. **Create New Query**
   - Click "New query"
   - Copy/paste the SQL below
   - Click "Run" (or press Ctrl+Enter)

3. **SQL to Run:**

```sql
-- ==========================================
-- STRIKE DEDUPLICATION CONSTRAINT
-- ==========================================

-- Step 1: Check for duplicates
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

-- If duplicates found, clean them up (keep earliest)
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

-- Add uniqueness constraint
ALTER TABLE evidence_ledger
ADD CONSTRAINT unique_strike_per_payment
UNIQUE (property_id, tenant_id, event_type, (metadata->>'dueDate'));

-- Create performance index
CREATE INDEX IF NOT EXISTS idx_evidence_ledger_strikes
ON evidence_ledger (property_id, tenant_id, event_type)
WHERE event_type = 'STRIKE_ISSUED';

-- Verify
SELECT
    'unique_strike_per_payment'::text as constraint_name,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'unique_strike_per_payment'
        ) THEN '✅ Successfully added'
        ELSE '❌ Failed to add'
    END as status;
```

4. **Expected Output:**
   ```
   constraint_name                | status
   -------------------------------+---------------------
   unique_strike_per_payment      | ✅ Successfully added
   ```

---

## Option 2: Supabase CLI (Alternative)

If you prefer command line:

```bash
# Navigate to project
cd /c/Users/ronlad/Desktop/landlord

# Apply just the new migration
npx supabase db execute --file supabase/migrations/20260117_add_strike_uniqueness_constraint.sql

# Or apply via psql if you have credentials
```

---

## Option 3: Direct SQL File (Backup)

If both above fail, the migration file is already created at:
`supabase/migrations/20260117_add_strike_uniqueness_constraint.sql`

You can execute it using any PostgreSQL client with your Supabase credentials.

---

## 🧪 VERIFICATION

After applying, test with this query in Supabase SQL Editor:

```sql
-- Try to insert duplicate strike (should fail)
INSERT INTO evidence_ledger (property_id, tenant_id, event_type, category, title, description, metadata)
VALUES (
    'test-property-123',
    'test-tenant-456',
    'STRIKE_ISSUED',
    'ARREARS',
    'Test duplicate strike',
    'This should fail if constraint works',
    '{"dueDate": "2026-01-01", "paidDate": "2026-01-10"}'::jsonb
);

-- Run twice - second insert should fail with:
-- ERROR: duplicate key value violates unique constraint "unique_strike_per_payment"

-- Clean up test
DELETE FROM evidence_ledger
WHERE property_id = 'test-property-123'
  AND tenant_id = 'test-tenant-456';
```

Expected result: **Second insert fails** with constraint violation ✅

---

## 🚨 TROUBLESHOOTING

### Error: "constraint already exists"
```sql
-- Safe - constraint already applied
SELECT 'Already applied ✅' as status;
```

### Error: "syntax error near '(metadata'"
Your PostgreSQL version might not support functional unique constraints. Use alternative:

```sql
-- Simpler constraint (per-day deduplication)
ALTER TABLE evidence_ledger
ADD CONSTRAINT unique_strike_per_tenant_per_day
UNIQUE (property_id, tenant_id, event_type, DATE(created_at));
```

### Error: "column metadata does not exist"
Check your evidence_ledger schema:

```sql
\d evidence_ledger
-- Ensure 'metadata' column exists and is type JSONB
```

---

## ✅ SUCCESS CHECKLIST

After running the migration:

- [ ] No SQL errors in Supabase dashboard
- [ ] Verification query shows "✅ Successfully added"
- [ ] Test duplicate insert fails with constraint error
- [ ] Application still runs without errors
- [ ] Strike logging works correctly

---

## 📞 IF MIGRATION FAILS

If you encounter issues:

1. **Capture error message** from Supabase SQL Editor
2. **Check schema**: Run `SELECT * FROM evidence_ledger LIMIT 1;`
3. **Review metadata structure**: Ensure `metadata->>'dueDate'` exists
4. **Use simpler constraint** (see troubleshooting above)

---

## 🔄 ROLLBACK (if needed)

If something breaks:

```sql
-- Remove the constraint
ALTER TABLE evidence_ledger
DROP CONSTRAINT IF EXISTS unique_strike_per_payment;

-- Remove the index
DROP INDEX IF EXISTS idx_evidence_ledger_strikes;
```

Then revert the code changes in `rent-logic.ts`.

---

**Status**: ⏳ **PENDING APPLICATION**

Once applied, update this file to: ✅ **APPLIED**

**Applied by**: _____________
**Date**: _____________
**Time**: _____________
