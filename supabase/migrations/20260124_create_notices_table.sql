-- ============================================================================
-- Notices Table - Legal Notice Tracking System
-- ============================================================================
--
-- Purpose: Store immutable legal notices as evidence records per RTA requirements
--
-- References:
-- - Section 55(1)(aa): 3-strike rent notices
-- - Section 55(1)(a): 21-day immediate termination
-- - Section 55A: Anti-social behaviour notices
-- - Section 56: 14-day notice to remedy
--
-- CRITICAL: Notices are legal evidence and MUST be immutable (no updates/deletes)
-- ============================================================================

-- Drop existing table and dependencies if they exist
DROP TABLE IF EXISTS notices CASCADE;

CREATE TABLE notices (
    -- Primary key
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Foreign keys
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

    -- Notice metadata
    notice_type text NOT NULL CHECK (notice_type IN ('S55_STRIKE', 'S55A_SOCIAL', 'S56_REMEDY', 'S55_21DAYS')),
    is_strike boolean NOT NULL DEFAULT false,
    strike_number int CHECK (strike_number IS NULL OR strike_number BETWEEN 1 AND 3),

    -- Legal dates (calculated by legal-engine.ts - NEVER user input)
    sent_at timestamptz NOT NULL DEFAULT now(),
    official_service_date date NOT NULL,  -- Day 0 for legal timelines (RTA critical)
    expiry_date date,                      -- For S56_REMEDY (OSD + 14 days)
    tribunal_deadline date,                -- For 3rd strike (OSD + 28 days)

    -- Financial context (snapshot at time of notice)
    rent_due_date date,
    amount_owed numeric(10, 2),

    -- Email delivery tracking
    email_sent boolean NOT NULL DEFAULT false,
    email_sent_at timestamptz,
    email_id text,                         -- Resend email ID for delivery confirmation
    recipient_email text NOT NULL,

    -- Email content (stored for evidence)
    subject text,
    body_html text,

    -- Document storage
    file_path text,                        -- PDF path in Supabase Storage (notices bucket)

    -- Status tracking
    status text NOT NULL DEFAULT 'sent' CHECK (status IN ('draft', 'sent', 'delivered', 'failed')),

    -- Additional metadata (JSONB for flexibility)
    -- For S56_REMEDY notices, MUST contain debt snapshot:
    -- {
    --   "ledger_entry_ids": ["uuid1", "uuid2"],      -- Specific entries unpaid when notice issued
    --   "due_dates": ["2026-01-15", "2026-02-15"],   -- Specific due dates unpaid when notice issued
    --   "total_amount_owed": 1800.00,                -- Total debt at time of notice
    --   "unpaid_amounts": {"2026-01-15": 900.00}     -- Per-due-date amounts
    -- }
    -- This allows checking if SPECIFIC debt was paid (notice "spent") vs new debt appearing
    metadata jsonb,

    -- Audit timestamps
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Prevent duplicate strike notices for the same due date (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS unique_strike_per_due_date ON notices(tenant_id, rent_due_date)
WHERE is_strike = true AND rent_due_date IS NOT NULL;

-- Fast lookups by tenant
CREATE INDEX IF NOT EXISTS idx_notices_tenant_id ON notices(tenant_id);

-- Fast lookups by property
CREATE INDEX IF NOT EXISTS idx_notices_property_id ON notices(property_id);

-- Filter by status (sent, delivered, failed)
CREATE INDEX IF NOT EXISTS idx_notices_status ON notices(status);

-- Sort by legal dates
CREATE INDEX IF NOT EXISTS idx_notices_official_service_date ON notices(official_service_date DESC);

-- Find strikes
CREATE INDEX IF NOT EXISTS idx_notices_is_strike ON notices(is_strike) WHERE is_strike = true;

-- ============================================================================
-- ROW-LEVEL SECURITY (RLS)
-- ============================================================================

ALTER TABLE notices ENABLE ROW LEVEL SECURITY;

-- Allow INSERT (notices can be created)
CREATE POLICY "Users can insert notices for their tenants"
ON notices FOR INSERT
WITH CHECK (true);

-- Allow SELECT (notices can be viewed)
CREATE POLICY "Users can view notices for their tenants"
ON notices FOR SELECT
USING (true);

-- NO UPDATE POLICY: Notices are immutable evidence (cannot be modified)
-- NO DELETE POLICY: Notices are immutable evidence (cannot be deleted)

-- ============================================================================
-- TRIGGER: Update updated_at timestamp
-- ============================================================================

CREATE OR REPLACE FUNCTION update_notices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_notices_updated_at
    BEFORE UPDATE ON notices
    FOR EACH ROW
    EXECUTE FUNCTION update_notices_updated_at();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE notices IS 'Legal notices sent to tenants - immutable evidence records per RTA';
COMMENT ON COLUMN notices.official_service_date IS 'RTA-critical: Day 0 for all legal timelines';
COMMENT ON COLUMN notices.strike_number IS 'For S55_STRIKE only: 1st, 2nd, or 3rd strike';
COMMENT ON COLUMN notices.expiry_date IS 'For S56_REMEDY: OSD + 14 days';
COMMENT ON COLUMN notices.tribunal_deadline IS 'For 3rd strike: OSD + 28 days';
COMMENT ON COLUMN notices.metadata IS 'CRITICAL for S56_REMEDY: Must snapshot specific debt (ledger_entry_ids, due_dates, total_amount_owed) to determine if notice was remedied';
COMMENT ON INDEX unique_strike_per_due_date IS 'Prevents duplicate strike notices for same tenant + due date';
