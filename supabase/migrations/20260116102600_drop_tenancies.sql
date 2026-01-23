-- Migration: Drop redundant tenancies table
-- All functionality has been moved to the public.tenants table (e.g., property_id, weekly_rent)
-- This table was never used in the application code.

drop table if exists public.tenancies;
