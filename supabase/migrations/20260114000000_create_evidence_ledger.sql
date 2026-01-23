-- Create the evidence_ledger table
create table public.evidence_ledger (
  id uuid not null default gen_random_uuid(),
  created_at timestamp with time zone not null default now(),
  property_id uuid references public.properties(id),
  tenant_id uuid references public.tenants(id),
  event_type text not null check (event_type in ('RENT_MISSED', 'STRIKE_ISSUED', 'NOTICE_SENT', 'TAX_RECEIPT_UPLOADED', 'HH_INSPECTION')),
  category text not null check (category in ('ARREARS', 'TAX', 'HEALTHY_HOMES', 'MAINTENANCE', 'GENERAL')),
  title text not null,
  description text,
  metadata jsonb default '{}'::jsonb,
  file_urls text[] default array[]::text[],
  source_table text not null,
  source_id uuid not null,
  is_redacted boolean not null default false,
  
  constraint evidence_ledger_pkey primary key (id)
);

-- Indexes for fast searching
create index evidence_ledger_property_id_idx on public.evidence_ledger(property_id);
create index evidence_ledger_tenant_id_idx on public.evidence_ledger(tenant_id);
create index evidence_ledger_category_idx on public.evidence_ledger(category);
create index evidence_ledger_created_at_idx on public.evidence_ledger(created_at desc);

-- Enable Row Level Security
alter table public.evidence_ledger enable row level security;

-- Policies
-- 1. View Policy: Users can see logs for properties they own
-- (Assuming auth.uid() links to properties table owner_id or similar. 
--  Adjust the USING clause based on your specific ownership schema)
create policy "Users can view their own evidence logs"
on public.evidence_ledger
for select
to authenticated
using (
  exists (
    select 1 from public.properties
    where properties.id = evidence_ledger.property_id
    and properties.owner_id = auth.uid()
  )
);

-- 2. Insert Policy: Users can create logs for their properties
create policy "Users can create evidence logs"
on public.evidence_ledger
for insert
to authenticated
with check (
  exists (
    select 1 from public.properties
    where properties.id = evidence_ledger.property_id
    and properties.owner_id = auth.uid()
  )
);

-- 3. Immutability: NO UPDATE or DELETE policies are created. 
--    This effectively makes the table append-only for standard users via the API.
