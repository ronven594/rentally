-- =====================================================================
-- Ledger Regeneration Trigger
-- =====================================================================
-- Automatically regenerates payment ledger when tenant settings change.
-- This ensures the payment history always reflects current settings
-- "as if they had always been in place."
--
-- Triggers on:
-- - weekly_rent (rent amount) change
-- - rent_frequency change
-- - rent_due_day change
-- =====================================================================

-- Function to detect if settings changed and trigger regeneration
CREATE OR REPLACE FUNCTION trigger_ledger_regeneration()
RETURNS TRIGGER AS $$
DECLARE
  settings_changed BOOLEAN;
BEGIN
  -- Check if any of the critical settings changed
  settings_changed := (
    OLD.weekly_rent IS DISTINCT FROM NEW.weekly_rent OR
    OLD.rent_frequency IS DISTINCT FROM NEW.rent_frequency OR
    OLD.rent_due_day IS DISTINCT FROM NEW.rent_due_day
  );

  IF settings_changed THEN
    -- Log the change
    RAISE NOTICE 'Tenant settings changed for tenant_id: %. Triggering ledger regeneration.', NEW.id;

    -- Call Edge Function to regenerate ledger
    -- NOTE: This requires pg_net extension for HTTP requests
    -- Alternative: Use a client-side listener instead

    -- For now, we'll use a simplified approach:
    -- Insert a record into a regeneration_queue table
    -- that the client or a scheduled job can process
    INSERT INTO ledger_regeneration_queue (
      tenant_id,
      old_rent_amount,
      new_rent_amount,
      old_frequency,
      new_frequency,
      old_due_day,
      new_due_day,
      triggered_at
    ) VALUES (
      NEW.id,
      OLD.weekly_rent,
      NEW.weekly_rent,
      OLD.rent_frequency,
      NEW.rent_frequency,
      OLD.rent_due_day,
      NEW.rent_due_day,
      NOW()
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the regeneration queue table
CREATE TABLE IF NOT EXISTS ledger_regeneration_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  old_rent_amount NUMERIC,
  new_rent_amount NUMERIC,
  old_frequency TEXT,
  new_frequency TEXT,
  old_due_day TEXT,
  new_due_day TEXT,
  triggered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT
);

-- Index for efficient querying
CREATE INDEX IF NOT EXISTS idx_regeneration_queue_status
  ON ledger_regeneration_queue(status, triggered_at);

-- Create the trigger
DROP TRIGGER IF EXISTS on_tenant_settings_change ON tenants;
CREATE TRIGGER on_tenant_settings_change
  AFTER UPDATE ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION trigger_ledger_regeneration();

-- =====================================================================
-- Alternative: Direct HTTP call to Edge Function (requires pg_net)
-- =====================================================================
-- Uncomment this if you have pg_net extension enabled:
--
-- CREATE OR REPLACE FUNCTION trigger_ledger_regeneration_http()
-- RETURNS TRIGGER AS $$
-- DECLARE
--   settings_changed BOOLEAN;
--   edge_function_url TEXT;
-- BEGIN
--   settings_changed := (
--     OLD.weekly_rent IS DISTINCT FROM NEW.weekly_rent OR
--     OLD.rent_frequency IS DISTINCT FROM NEW.rent_frequency OR
--     OLD.rent_due_day IS DISTINCT FROM NEW.rent_due_day
--   );
--
--   IF settings_changed THEN
--     edge_function_url := current_setting('app.supabase_url') || '/functions/v1/regenerate-ledger';
--
--     PERFORM net.http_post(
--       url := edge_function_url,
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer ' || current_setting('app.supabase_anon_key')
--       ),
--       body := jsonb_build_object(
--         'record', row_to_json(NEW)
--       )
--     );
--   END IF;
--
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;

COMMENT ON TABLE ledger_regeneration_queue IS
  'Queue for tenant ledger regeneration requests. Processed by client-side hook or scheduled job.';

COMMENT ON FUNCTION trigger_ledger_regeneration() IS
  'Trigger function that detects tenant setting changes and queues ledger regeneration.';
