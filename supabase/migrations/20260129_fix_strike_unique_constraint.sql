-- Fix: The unique constraint was on rent_due_date (general context field)
-- but should be on due_date_for (the per-occasion strike tracking field).
-- rent_due_date is a general field set for all notice types.
-- due_date_for is the specific field for "which rent due date is this strike for?"

-- Drop the old constraint
DROP INDEX IF EXISTS unique_strike_per_due_date;

-- Create the correct constraint on due_date_for
CREATE UNIQUE INDEX IF NOT EXISTS unique_strike_per_due_date
  ON notices(tenant_id, due_date_for)
  WHERE is_strike = true AND due_date_for IS NOT NULL;
