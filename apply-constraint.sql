-- Quick-apply SQL for Strike Uniqueness Constraint
-- Copy/paste this into Supabase SQL Editor and run
-- https://supabase.com/dashboard/project/aojcpoichyxebxsnwitf/editor/sql

-- Clean duplicates (if any)
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
WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

-- Create unique index (acts as constraint)
-- This prevents duplicate strikes for same property/tenant/due date
CREATE UNIQUE INDEX IF NOT EXISTS unique_strike_per_payment
ON evidence_ledger (property_id, tenant_id, event_type, (metadata->>'dueDate'))
WHERE event_type = 'STRIKE_ISSUED';

-- Create performance index
CREATE INDEX IF NOT EXISTS idx_evidence_ledger_strikes
ON evidence_ledger (property_id, tenant_id, event_type)
WHERE event_type = 'STRIKE_ISSUED';

-- Verify
SELECT
    '✅ Constraint added successfully!' as status,
    (SELECT COUNT(*) FROM pg_indexes WHERE indexname = 'unique_strike_per_payment') as constraint_exists
;
