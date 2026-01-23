-- Combined Migration: Core Schema
-- Properties, Tenants, Tenancies, Evidence Ledger

-- 1. Properties Table
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default now() not null,
  owner_id uuid references auth.users(id),
  address text not null,
  property_type text
);

-- 2. Tenants Table
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default now() not null,
  property_id uuid references public.properties(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  lease_start_date date,
  lease_end_date date,
  is_active boolean default true
);

-- 3. Tenancies Table
create table public.tenancies (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default now() not null,
  property_id uuid references public.properties(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete cascade,
  rent_amount numeric not null,
  rent_frequency text not null, -- e.g., 'Weekly', 'Fortnightly'
  rent_due_date date,
  is_active boolean default true
);

-- 4. Evidence Ledger Table
create table public.evidence_ledger (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default now() not null,
  property_id uuid references public.properties(id) on delete set null,
  tenant_id uuid references public.tenants(id) on delete set null,
  event_type text not null,
  category text not null,
  title text not null,
  description text,
  metadata jsonb default '{}'::jsonb,
  file_urls text[] default array[]::text[],
  source_table text,
  source_id uuid,
  is_redacted boolean default false
);

-- Enable RLS on all tables
alter table public.properties enable row level security;
alter table public.tenants enable row level security;
alter table public.tenancies enable row level security;
alter table public.evidence_ledger enable row level security;

-- Permissive Policies (Testing Only)
-- Note: In production, you should restrict these to auth.uid() = owner_id or similar.

-- Properties permissive policy
create policy "Allow all for authenticated users" on public.properties
for all to authenticated using (true) with check (true);

-- Tenants permissive policy
create policy "Allow all for authenticated users" on public.tenants
for all to authenticated using (true) with check (true);

-- Tenancies permissive policy
create policy "Allow all for authenticated users" on public.tenancies
for all to authenticated using (true) with check (true);

-- Evidence Ledger permissive policy
create policy "Allow all for authenticated users" on public.evidence_ledger
for all to authenticated using (true) with check (true);
