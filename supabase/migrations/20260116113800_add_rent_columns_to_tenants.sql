-- Migration: Add missing rent columns to tenants table
-- These were intended to be moved from the tenancies table
alter table public.tenants add column if not exists weekly_rent numeric;
alter table public.tenants add column if not exists rent_frequency text default 'Weekly';
alter table public.tenants add column if not exists rent_due_day text default 'Wednesday';

comment on column public.tenants.weekly_rent is 'The weekly rent amount for the tenant.';
comment on column public.tenants.rent_frequency is 'How often rent is due (e.g., Weekly, Fortnightly).';
comment on column public.tenants.rent_due_day is 'The day of the week rent is due.';
