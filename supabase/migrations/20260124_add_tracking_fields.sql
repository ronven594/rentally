-- Migration: Add tracking_start_date and opening_arrears to tenants table
-- These fields enable proper tracking of when we started monitoring rent and any pre-existing debt

-- Add tracking_start_date column (when we started tracking this tenant)
alter table public.tenants add column if not exists tracking_start_date date;

-- Add opening_arrears column (any existing debt when we started tracking)
alter table public.tenants add column if not exists opening_arrears numeric default 0;

-- Add helpful comments
comment on column public.tenants.tracking_start_date is 'The date when we started tracking rent for this tenant in the system (defaults to today for new tenants)';
comment on column public.tenants.opening_arrears is 'Any existing rent arrears when we started tracking this tenant (defaults to 0)';

-- For existing tenants without tracking_start_date, default to their lease_start_date or created_at
update public.tenants
set tracking_start_date = coalesce(lease_start_date, created_at::date, current_date)
where tracking_start_date is null;

-- For existing tenants, set opening_arrears to 0 if null
update public.tenants
set opening_arrears = 0
where opening_arrears is null;
