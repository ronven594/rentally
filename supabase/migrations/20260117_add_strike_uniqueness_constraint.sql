-- Migration: Add uniqueness constraint for strike deduplication
-- Date: 2026-01-17
-- Purpose: Prevent duplicate strike logging after removing module-level Set

-- Step 1: Check for existing duplicates (for information only)
DO $$
DECLARE
    duplicate_count INT;
BEGIN
    SELECT COUNT(*) INTO duplicate_count
    FROM (
        SELECT
            property_id,
            tenant_id,
            event_type,
            metadata->>'dueDate' as due_date,
            COUNT(*) as count
        FROM evidence_ledger
        WHERE event_type = 'STRIKE_ISSUED'
        GROUP BY property_id, tenant_id, event_type, metadata->>'dueDate'
        HAVING COUNT(*) > 1
    ) duplicates;

    IF duplicate_count > 0 THEN
        RAISE NOTICE 'Found % groups of duplicate strikes', duplicate_count;
    ELSE
        RAISE NOTICE 'No duplicate strikes found - safe to add constraint';
    END IF;
END $$;

-- Step 2: Clean up any existing duplicates (keep earliest entry)
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
-- This prevents duplicate strikes for the same property/tenant/due date
ALTER TABLE evidence_ledger
ADD CONSTRAINT unique_strike_per_payment
UNIQUE (property_id, tenant_id, event_type, (metadata->>'dueDate'));

-- Step 4: Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_evidence_ledger_strikes
ON evidence_ledger (property_id, tenant_id, event_type)
WHERE event_type = 'STRIKE_ISSUED';

-- Verification: Check constraint was added
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'unique_strike_per_payment'
    ) THEN
        RAISE NOTICE '✅ Constraint "unique_strike_per_payment" added successfully';
    ELSE
        RAISE EXCEPTION '❌ Failed to add constraint';
    END IF;
END $$;
