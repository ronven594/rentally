# Tenant Field Persistence Debug Report

## Issue
`rent_frequency` and `rent_due_day` fields are not persisting to the database when updating tenants via `ManageTenantDialog`.

## Current Code Analysis

### 1. ManageTenantDialog (Lines 66-77)
**Status: ✅ CORRECT**

```tsx
const handleSave = () => {
    onUpdate(tenant.id, {
        name: `${firstName} ${lastName}`.trim(),
        email,
        phone,
        rentAmount: Number(amount),
        frequency,              // ✅ Sending frequency
        rentDueDay,             // ✅ Sending rentDueDay
        tenant_address: address,
        startDate: leaseStartDate,
        leaseEndDate: leaseEndDate
    });
```

**What's being sent:**
- `frequency`: "Weekly" | "Fortnightly" (from state)
- `rentDueDay`: "Monday" | "Tuesday" | ... | "Sunday" (from state)

---

### 2. handleUpdateTenant Mapping (Lines 362-363)
**Status: ✅ CORRECT**

```tsx
// Add other standard fields if they exist in schema
if (updates.frequency !== undefined) (dbUpdates as any).rent_frequency = updates.frequency;
if (updates.rentDueDay !== undefined) (dbUpdates as any).rent_due_day = updates.rentDueDay;
```

**Field Mapping:**
- UI `frequency` → DB `rent_frequency`
- UI `rentDueDay` → DB `rent_due_day`

---

### 3. Supabase Update Call (Lines 370-374)
**Status: ✅ CORRECT**

```tsx
const { error, data } = await supabase
    .from('tenants')
    .update(dbUpdates)
    .eq('id', tenantId)
    .select(); // select to see what was updated
```

---

### 4. Debug Logging (Lines 365-385)
**Status: ✅ PRESENT**

```tsx
console.log("DEBUG: Tenant update starting for ID:", tenantId);
console.log("DEBUG: Cumulative updates object:", updates);
console.log("DEBUG: Final dbUpdates sent to Supabase:", dbUpdates);

if (error) {
    console.error("DEBUG: Supabase Update Error:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
    });
    throw error;
}
console.log("DEBUG: Supabase Update Success, data returned:", data);
```

---

## Diagnosis

The code is **correctly structured**. The issue is likely one of the following:

### Most Likely Causes:

#### 1. **Database Columns Don't Exist** ⚠️
The `rent_frequency` and `rent_due_day` columns may not exist in the `tenants` table.

**How to verify:**
```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'tenants' 
AND column_name IN ('rent_frequency', 'rent_due_day');
```

**Expected result:**
```
column_name    | data_type
---------------+-----------
rent_frequency | text
rent_due_day   | text
```

If these columns don't exist, Supabase will **silently ignore** them in the update.

---

#### 2. **RLS Policy Blocking Updates** ⚠️
Row Level Security policies might not allow updates to these specific columns.

**How to verify:**
Check the RLS policies on the `tenants` table:
```sql
SELECT * FROM pg_policies WHERE tablename = 'tenants';
```

---

#### 3. **Type Mismatch** ⚠️
The columns might exist but expect a different data type (e.g., `enum` instead of `text`).

---

## What to Check Next

### Step 1: Check Console Logs
When you save a tenant, check the browser console for:

```
DEBUG: Cumulative updates object: { 
  frequency: "Weekly", 
  rentDueDay: "Wednesday",
  ...
}

DEBUG: Final dbUpdates sent to Supabase: {
  rent_frequency: "Weekly",
  rent_due_day: "Wednesday",
  ...
}
```

**If you see these fields in the logs**, the frontend is working correctly.

---

### Step 2: Check Supabase Response
Look for:

```
DEBUG: Supabase Update Success, data returned: [...]
```

**If the returned data doesn't include `rent_frequency` or `rent_due_day`**, the database is not persisting them.

---

### Step 3: Check for Errors
Look for:

```
DEBUG: Supabase Update Error: {
  message: "...",
  hint: "...",
  code: "..."
}
```

Common error codes:
- `42703`: Column does not exist
- `42501`: Insufficient privilege (RLS policy)
- `23514`: Check constraint violation (wrong enum value)

---

## Recommended Fix

### If columns don't exist:

Run this migration in Supabase SQL Editor:

```sql
-- Add rent_frequency column
ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS rent_frequency TEXT 
DEFAULT 'Weekly' 
CHECK (rent_frequency IN ('Weekly', 'Fortnightly'));

-- Add rent_due_day column
ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS rent_due_day TEXT 
DEFAULT 'Wednesday'
CHECK (rent_due_day IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'));

-- Update RLS policy to allow updates to these columns (if needed)
-- This depends on your existing policy structure
```

---

### If RLS is blocking:

Update your RLS policy to allow updates to these columns:

```sql
-- Example: Allow authenticated users to update their own tenant records
CREATE POLICY "Users can update tenant details"
ON tenants
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
```

---

## Testing Steps

1. Open the rent tracker page
2. Click "Manage" on a tenant
3. Change the "Frequency" to "Fortnightly"
4. Change the "Due Day" to "Friday"
5. Click "Save Changes"
6. Open browser console (F12)
7. Look for the DEBUG logs
8. Share the output with me

---

## Current Code Status

| Component | Status | Notes |
|-----------|--------|-------|
| ManageTenantDialog UI | ✅ | Correctly sends `frequency` and `rentDueDay` |
| handleUpdateTenant mapping | ✅ | Correctly maps to `rent_frequency` and `rent_due_day` |
| Supabase update call | ✅ | Correctly sends mapped fields |
| Debug logging | ✅ | Comprehensive logs in place |
| Database schema | ❓ | **NEEDS VERIFICATION** |
| RLS policies | ❓ | **NEEDS VERIFICATION** |

---

## Next Steps

1. Test the update and check console logs
2. Verify database schema has the columns
3. If columns are missing, run the migration above
4. If RLS is blocking, update the policy
5. Re-test and confirm persistence
