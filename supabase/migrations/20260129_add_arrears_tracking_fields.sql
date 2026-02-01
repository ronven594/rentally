-- ============================================================================
-- Add arrears tracking fields for opening balance / settings change support
-- ============================================================================
--
-- arrears_start_date: Calculated date when historical debt originated
--   (back-calculated from opening balance at creation time)
--
-- settings_effective_date: When current rent settings took effect
--   (reset on rent agreement changes; used as trackingStartDate for new rent)
--
-- carried_forward_balance: Frozen balance from before last settings change
--   (baked-in debt carried forward when rent agreement changes)

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS arrears_start_date DATE,
  ADD COLUMN IF NOT EXISTS settings_effective_date DATE,
  ADD COLUMN IF NOT EXISTS carried_forward_balance NUMERIC(10,2) DEFAULT 0;

-- Backfill settings_effective_date from tracking_start_date for existing tenants
UPDATE public.tenants
SET settings_effective_date = tracking_start_date
WHERE settings_effective_date IS NULL AND tracking_start_date IS NOT NULL;
