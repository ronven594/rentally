-- ============================================================================
-- Add due_date_for field to notices table for per-due-date strike tracking
-- ============================================================================
--
-- RTA Section 55(1)(aa) requires strikes to be for SEPARATE OCCASIONS.
-- "Separate occasion" = a different rent due date that went 5+ working days unpaid.
-- This column records which specific rent due date a strike notice is for,
-- preventing double-striking the same due date.

ALTER TABLE public.notices
  ADD COLUMN IF NOT EXISTS due_date_for DATE;

-- Index for quick lookup of strikes by tenant + due date
CREATE INDEX IF NOT EXISTS idx_notices_tenant_due_date_for
  ON public.notices (tenant_id, due_date_for)
  WHERE due_date_for IS NOT NULL;
