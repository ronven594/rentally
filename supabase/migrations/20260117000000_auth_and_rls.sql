-- Step 1: Create user_profiles table
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  full_name TEXT,
  service_address TEXT,
  phone TEXT,
  email TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row-Level Security
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_profiles
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own profile') THEN
    CREATE POLICY "Users can view own profile" ON public.user_profiles FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can update own profile') THEN
    CREATE POLICY "Users can update own profile" ON public.user_profiles FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert own profile') THEN
    CREATE POLICY "Users can insert own profile" ON public.user_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Automatically create profile when user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Step 2: Link existing tables to users
-- Add user_id to properties if not exists
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- Migrate existing owner_id to user_id if any (syncing names)
UPDATE public.properties SET user_id = owner_id WHERE user_id IS NULL AND owner_id IS NOT NULL;

-- Enable RLS on properties
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

-- RLS Policies for properties
-- Remove existing permissive policies first
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.properties;
DROP POLICY IF EXISTS "Users can view their own properties" ON public.properties;
DROP POLICY IF EXISTS "Authenticated users can insert properties" ON public.properties;
DROP POLICY IF EXISTS "Users can update their own properties" ON public.properties;
DROP POLICY IF EXISTS "Users can delete their own properties" ON public.properties;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own properties') THEN
    CREATE POLICY "Users can view own properties" ON public.properties FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert own properties') THEN
    CREATE POLICY "Users can insert own properties" ON public.properties FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can update own properties') THEN
    CREATE POLICY "Users can update own properties" ON public.properties FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can delete own properties') THEN
    CREATE POLICY "Users can delete own properties" ON public.properties FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;

-- Step 3: Enable RLS on tenants, payments, evidence_ledger
-- Tenants
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.tenants;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own tenants') THEN
    CREATE POLICY "Users can view own tenants" ON public.tenants FOR SELECT USING (EXISTS (SELECT 1 FROM public.properties WHERE properties.id = tenants.property_id AND properties.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert own tenants') THEN
    CREATE POLICY "Users can insert own tenants" ON public.tenants FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.properties WHERE properties.id = tenants.property_id AND properties.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can update own tenants') THEN
    CREATE POLICY "Users can update own tenants" ON public.tenants FOR UPDATE USING (EXISTS (SELECT 1 FROM public.properties WHERE properties.id = tenants.property_id AND properties.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can delete own tenants') THEN
    CREATE POLICY "Users can delete own tenants" ON public.tenants FOR DELETE USING (EXISTS (SELECT 1 FROM public.properties WHERE properties.id = tenants.property_id AND properties.user_id = auth.uid()));
  END IF;
END $$;

-- Payments
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own payments') THEN
    CREATE POLICY "Users can view own payments" ON public.payments FOR SELECT USING (EXISTS (SELECT 1 FROM public.properties WHERE properties.id = payments.property_id AND properties.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert own payments') THEN
    CREATE POLICY "Users can insert own payments" ON public.payments FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.properties WHERE properties.id = payments.property_id AND properties.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can update own payments') THEN
    CREATE POLICY "Users can update own payments" ON public.payments FOR UPDATE USING (EXISTS (SELECT 1 FROM public.properties WHERE properties.id = payments.property_id AND properties.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can delete own payments') THEN
    CREATE POLICY "Users can delete own payments" ON public.payments FOR DELETE USING (EXISTS (SELECT 1 FROM public.properties WHERE properties.id = payments.property_id AND properties.user_id = auth.uid()));
  END IF;
END $$;

-- Evidence Ledger
ALTER TABLE public.evidence_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.evidence_ledger;
DROP POLICY IF EXISTS "Users can view their own evidence logs" ON public.evidence_ledger;
DROP POLICY IF EXISTS "Users can create evidence logs" ON public.evidence_ledger;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own evidence_ledger') THEN
    CREATE POLICY "Users can view own evidence_ledger" ON public.evidence_ledger FOR SELECT USING (EXISTS (SELECT 1 FROM public.properties WHERE properties.id = evidence_ledger.property_id AND properties.user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert own evidence_ledger') THEN
    CREATE POLICY "Users can insert own evidence_ledger" ON public.evidence_ledger FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.properties WHERE properties.id = evidence_ledger.property_id AND properties.user_id = auth.uid()));
  END IF;
END $$;
