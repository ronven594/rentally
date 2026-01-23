-- Create the properties table
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default now() not null,
  owner_id uuid references auth.users(id),
  address text not null,
  property_type text -- examples: 'house', 'apartment', 'unit'
);

-- Enable Row Level Security
alter table public.properties enable row level security;

-- Policies
-- 1. View Policy: Users can see only their own properties
create policy "Users can view their own properties"
on public.properties
for select
to authenticated
using ( auth.uid() = owner_id );

-- 2. Insert Policy: Authenticated users can insert properties
-- Note: We typically want to ensure they set themselves as the owner
create policy "Authenticated users can insert properties"
on public.properties
for insert
to authenticated
with check ( auth.role() = 'authenticated' );

-- 3. Update Policy: Users can update only their own properties
create policy "Users can update their own properties"
on public.properties
for update
to authenticated
using ( auth.uid() = owner_id )
with check ( auth.uid() = owner_id );

-- 4. Delete Policy: Users can delete only their own properties
create policy "Users can delete their own properties"
on public.properties
for delete
to authenticated
using ( auth.uid() = owner_id );
