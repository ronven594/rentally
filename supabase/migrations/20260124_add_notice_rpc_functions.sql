-- ============================================================================
-- RPC Functions for Notice System
-- ============================================================================
--
-- Purpose: Provide efficient database-level functions for:
-- 1. Counting active strikes within 90-day window
-- 2. Fetching notice timeline for UI display
--
-- References:
-- - Section 55(1)(aa): 3 strikes within 90 days triggers tribunal eligibility
-- ============================================================================

-- Drop existing functions if they exist (CASCADE removes all versions)
DROP FUNCTION IF EXISTS get_active_strike_count CASCADE;
DROP FUNCTION IF EXISTS get_notice_timeline CASCADE;
DROP FUNCTION IF EXISTS get_first_strike_window CASCADE;
DROP FUNCTION IF EXISTS check_duplicate_strike CASCADE;

-- ============================================================================
-- FUNCTION: get_active_strike_count
-- ============================================================================
--
-- Returns the number of active strikes within the 90-day window from first strike.
--
-- Algorithm:
-- 1. Find the first strike's Official Service Date (OSD)
-- 2. Calculate 90-day window from first strike OSD
-- 3. Count all strikes within that window
--
-- @param p_tenant_id - UUID of the tenant
-- @param p_reference_date - Optional reference date (defaults to today)
-- @returns Integer count of active strikes
--
CREATE OR REPLACE FUNCTION get_active_strike_count(
    p_tenant_id uuid,
    p_reference_date date DEFAULT CURRENT_DATE
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_first_strike_osd date;
    v_strike_count int;
    v_window_end date;
BEGIN
    -- Find the first strike's Official Service Date
    SELECT official_service_date INTO v_first_strike_osd
    FROM notices
    WHERE tenant_id = p_tenant_id
      AND is_strike = true
      AND status = 'sent'
    ORDER BY official_service_date ASC
    LIMIT 1;

    -- If no strikes exist, return 0
    IF v_first_strike_osd IS NULL THEN
        RETURN 0;
    END IF;

    -- Calculate 90-day window end date
    v_window_end := v_first_strike_osd + INTERVAL '90 days';

    -- Count strikes within the 90-day window from first strike
    SELECT COUNT(*)::int INTO v_strike_count
    FROM notices
    WHERE tenant_id = p_tenant_id
      AND is_strike = true
      AND status = 'sent'
      AND official_service_date >= v_first_strike_osd
      AND official_service_date <= v_window_end
      AND official_service_date <= p_reference_date;  -- Don't count future strikes

    RETURN v_strike_count;
END;
$$;

COMMENT ON FUNCTION get_active_strike_count IS 'Returns count of strikes within 90-day window for RTA compliance (Section 55(1)(aa))';

-- ============================================================================
-- FUNCTION: get_notice_timeline
-- ============================================================================
--
-- Returns chronological timeline of all notices for a tenant.
-- Used for UI display and legal evidence review.
--
-- @param p_tenant_id - UUID of the tenant
-- @returns Table of notice details ordered by OSD descending
--
CREATE OR REPLACE FUNCTION get_notice_timeline(p_tenant_id uuid)
RETURNS TABLE (
    notice_id uuid,
    notice_type text,
    is_strike boolean,
    sent_at timestamptz,
    official_service_date date,
    expiry_date date,
    tribunal_deadline date,
    strike_number int,
    amount_owed numeric,
    rent_due_date date,
    status text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        notices.id,
        notices.notice_type,
        notices.is_strike,
        notices.sent_at,
        notices.official_service_date,
        notices.expiry_date,
        notices.tribunal_deadline,
        notices.strike_number,
        notices.amount_owed,
        notices.rent_due_date,
        notices.status
    FROM notices
    WHERE tenant_id = p_tenant_id
      AND status IN ('sent', 'delivered')  -- Exclude drafts and failed
    ORDER BY official_service_date DESC;
END;
$$;

COMMENT ON FUNCTION get_notice_timeline IS 'Returns chronological timeline of all notices for a tenant for UI display';

-- ============================================================================
-- FUNCTION: get_first_strike_window
-- ============================================================================
--
-- Returns the first strike OSD and 90-day window expiry date.
-- Used to display when the strike window will reset.
--
-- @param p_tenant_id - UUID of the tenant
-- @returns Table with first_strike_osd and window_expiry_date
--
CREATE OR REPLACE FUNCTION get_first_strike_window(p_tenant_id uuid)
RETURNS TABLE (
    first_strike_osd date,
    window_expiry_date date,
    days_until_expiry int
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_first_strike_osd date;
BEGIN
    -- Find the first strike OSD
    SELECT official_service_date INTO v_first_strike_osd
    FROM notices
    WHERE tenant_id = p_tenant_id
      AND is_strike = true
      AND status = 'sent'
    ORDER BY official_service_date ASC
    LIMIT 1;

    -- If no strikes, return nulls
    IF v_first_strike_osd IS NULL THEN
        RETURN;
    END IF;

    -- Return window details
    RETURN QUERY
    SELECT
        v_first_strike_osd AS first_strike_osd,
        (v_first_strike_osd + INTERVAL '90 days')::date AS window_expiry_date,
        (v_first_strike_osd + INTERVAL '90 days' - CURRENT_DATE)::int AS days_until_expiry;
END;
$$;

COMMENT ON FUNCTION get_first_strike_window IS 'Returns first strike OSD and 90-day window expiry information';

-- ============================================================================
-- FUNCTION: check_duplicate_strike
-- ============================================================================
--
-- Checks if a strike notice already exists for a given tenant and due date.
-- Used to prevent duplicate strikes before sending notice.
--
-- @param p_tenant_id - UUID of the tenant
-- @param p_rent_due_date - Due date to check
-- @returns Boolean: true if duplicate exists
--
CREATE OR REPLACE FUNCTION check_duplicate_strike(
    p_tenant_id uuid,
    p_rent_due_date date
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_exists boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM notices
        WHERE tenant_id = p_tenant_id
          AND rent_due_date = p_rent_due_date
          AND is_strike = true
          AND status = 'sent'
    ) INTO v_exists;

    RETURN v_exists;
END;
$$;

COMMENT ON FUNCTION check_duplicate_strike IS 'Checks if a strike notice already exists for a tenant/due date combination';
