-- Migration: Add tenant_address column to tenants table
alter table public.tenants add column if not exists tenant_address text;

comment on column public.tenants.tenant_address is 'The physical address where the tenant can be served notices.';
