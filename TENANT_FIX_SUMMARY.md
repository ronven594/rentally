# Fix Summary: Tenant Frequency and Due Day Fields

## Problem
`rent_frequency` and `rent_due_day` were saving to Supabase successfully, but when refreshing the page and opening ManageTenantDialog, the fields reset to "Weekly" and "Wednesday" instead of showing the saved values.

## Root Cause
**File:** `src/app/rent-tracker/page.tsx` (Lines 70, 73)

The tenant mapping was **hardcoding** default values instead of reading from the database:

### ❌ BEFORE (Broken):
```tsx
tenants: (p.tenants || []).map((t: any) => ({
    id: t.id,
    name: `${t.first_name} ${t.last_name}`,
    email: t.email,
    phone: t.phone,
    rentAmount: t.weekly_rent || 0,
    weekly_rent: t.weekly_rent,
    tenant_address: t.tenant_address,
    frequency: "Weekly",              // ❌ HARDCODED!
    startDate: t.lease_start_date,
    leaseEndDate: t.lease_end_date,
    rentDueDay: "Wednesday",          // ❌ HARDCODED!
    strikeHistory: []
}))
```

### ✅ AFTER (Fixed):
```tsx
tenants: (p.tenants || []).map((t: any) => ({
    id: t.id,
    name: `${t.first_name} ${t.last_name}`,
    email: t.email,
    phone: t.phone,
    rentAmount: t.weekly_rent || 0,
    weekly_rent: t.weekly_rent,
    tenant_address: t.tenant_address,
    frequency: t.rent_frequency || "Weekly",      // ✅ Read from DB!
    startDate: t.lease_start_date,
    leaseEndDate: t.lease_end_date,
    rentDueDay: t.rent_due_day || "Wednesday",    // ✅ Read from DB!
    strikeHistory: []
}))
```

## What Changed
- Line 70: `frequency: "Weekly"` → `frequency: t.rent_frequency || "Weekly"`
- Line 73: `rentDueDay: "Wednesday"` → `rentDueDay: t.rent_due_day || "Wednesday"`

## Why This Works
1. **Data Flow:**
   - Supabase query: `.select('*, tenants(*)')` already fetches ALL tenant columns including `rent_frequency` and `rent_due_day`
   - The mapping now correctly reads these fields from the database response
   - ManageTenantDialog was already correctly using `tenant.frequency` and `tenant.rentDueDay` (lines 58-59)

2. **Fallback Values:**
   - Still defaults to "Weekly" and "Wednesday" if the database fields are null/undefined
   - Ensures backward compatibility with existing tenants

## Testing Steps

1. **Refresh the page** (the dev server should auto-reload)
2. Open ManageTenantDialog for a tenant you previously updated
3. Verify the "Frequency" and "Due Day" fields show the saved values (not defaults)
4. Change them to different values and save
5. Refresh the page again
6. Verify the new values persist

## Expected Behavior

### Before Fix:
- Save "Fortnightly" and "Friday" → Refresh → Shows "Weekly" and "Wednesday" ❌

### After Fix:
- Save "Fortnightly" and "Friday" → Refresh → Shows "Fortnightly" and "Friday" ✅

## Files Modified
- `src/app/rent-tracker/page.tsx` (Lines 70, 73)

## No Migration Needed
The database columns already exist and data is already being saved correctly. This was purely a frontend data loading issue.
