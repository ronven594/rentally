# Fix Summary: "3 Strikes in 90 Days" Termination Warning

## Problem
The "Termination Eligible" warning wasn't appearing for tenants with 3 strikes within 90 days.

## Root Cause
**File:** `src/app/rent-tracker/page.tsx` (Line 74)

The `strikeHistory` was **hardcoded to an empty array** for all tenants, even though strikes were being logged to the `evidence_ledger` table.

### The Disconnect:
1. ✅ **Strikes ARE being logged** - When rent is paid 5+ working days late, `isStrike()` in `rent-logic.ts` logs to `evidence_ledger` with `event_type: 'STRIKE_ISSUED'`
2. ❌ **Strikes NOT being loaded** - The rent tracker page never fetched these strikes from the database
3. ❌ **Empty array passed to checker** - `checkTerminationEligibility()` always received `[]` and returned `false`

### ❌ BEFORE (Broken):
```tsx
const mappedProperties: Property[] = (data || []).map(p => ({
    // ...
    tenants: (p.tenants || []).map((t: any) => ({
        id: t.id,
        name: `${t.first_name} ${t.last_name}`,
        // ... other fields ...
        strikeHistory: []  // ❌ ALWAYS EMPTY!
    }))
}));
```

### ✅ AFTER (Fixed):
```tsx
// Fetch strike history for all tenants from evidence ledger
const { data: strikeData, error: strikeError } = await supabase
    .from('evidence_ledger')
    .select('tenant_id, created_at, summary, metadata')
    .eq('event_type', 'STRIKE_ISSUED')
    .order('created_at', { ascending: true });

// Group strikes by tenant_id
const strikesByTenant = new Map<string, { date: string; reason: string; serviceDate?: string }[]>();
(strikeData || []).forEach(strike => {
    if (!strike.tenant_id) return;
    if (!strikesByTenant.has(strike.tenant_id)) {
        strikesByTenant.set(strike.tenant_id, []);
    }
    strikesByTenant.get(strike.tenant_id)!.push({
        date: strike.created_at,
        reason: strike.summary || 'Strike issued',
        serviceDate: strike.metadata?.serviceDate
    });
});

console.log('📊 Strike History Loaded:', {
    totalStrikes: strikeData?.length || 0,
    tenantsWithStrikes: strikesByTenant.size,
    strikesByTenant: Object.fromEntries(strikesByTenant)
});

const mappedProperties: Property[] = (data || []).map(p => ({
    // ...
    tenants: (p.tenants || []).map((t: any) => {
        const strikes = strikesByTenant.get(t.id) || [];  // ✅ FETCH FROM DB!
        return {
            id: t.id,
            name: `${t.first_name} ${t.last_name}`,
            // ... other fields ...
            strikeHistory: strikes  // ✅ POPULATED!
        };
    })
}));
```

## How It Works Now

### 1. Strike Logging (Already Working)
When rent is paid 5+ working days late, `isStrike()` logs to evidence_ledger:
```tsx
// In rent-logic.ts, line 129
logToEvidenceLedger(
    propertyId,
    tenantId || null,
    EVENT_TYPES.STRIKE_ISSUED,  // ← This is the key
    CATEGORIES.ARREARS,
    "Strike issued - Payment received after grace period",
    `Rent due ${dueDate}, paid ${paidDate}. Exceeded 5 working day grace period.`,
    { dueDate, paidDate, gracePeriodDays: 5 }
)
```

### 2. Strike Fetching (NEW - Fixed)
On page load, fetch all strikes from evidence_ledger:
```tsx
// In page.tsx, line 55
const { data: strikeData } = await supabase
    .from('evidence_ledger')
    .select('tenant_id, created_at, summary, metadata')
    .eq('event_type', 'STRIKE_ISSUED')  // ← Filter for strikes only
    .order('created_at', { ascending: true });
```

### 3. Strike Grouping (NEW - Fixed)
Group strikes by tenant_id:
```tsx
// In page.tsx, line 67
const strikesByTenant = new Map();
strikeData.forEach(strike => {
    if (!strikesByTenant.has(strike.tenant_id)) {
        strikesByTenant.set(strike.tenant_id, []);
    }
    strikesByTenant.get(strike.tenant_id).push({
        date: strike.created_at,
        reason: strike.summary,
        serviceDate: strike.metadata?.serviceDate
    });
});
```

### 4. Termination Check (Already Working)
Check if 3 strikes exist within 90 days:
```tsx
// In rent-logic.ts, line 228
export function checkTerminationEligibility(strikeHistory: { date: string }[]): boolean {
    if (strikeHistory.length < 3) return false;
    
    const storedStrikes = [...strikeHistory].sort((a, b) => 
        new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    
    for (let i = 0; i <= storedStrikes.length - 3; i++) {
        const newest = parseISO(storedStrikes[i].date);
        const oldestOfThree = parseISO(storedStrikes[i + 2].date);
        const diff = differenceInCalendarDays(newest, oldestOfThree);
        
        if (Math.abs(diff) <= 90) {
            return true;  // ← 3 strikes within 90 days!
        }
    }
    
    return false;
}
```

### 5. UI Display (Already Working)
Show "Termination Eligible" badge:
```tsx
// In TenantCard.tsx, line 75
{isTerminationEligible ? "Termination Eligible" : isStrikeRisk ? "Action Required" : "Unpaid"}
```

## Debug Logging Added

### 1. Strike History Loading (page.tsx, line 80)
```
📊 Strike History Loaded: {
  totalStrikes: 5,
  tenantsWithStrikes: 2,
  strikesByTenant: {
    "tenant-123": [
      { date: "2025-12-01T...", reason: "Strike issued - Payment received after grace period" },
      { date: "2025-12-15T...", reason: "Strike issued - Payment received after grace period" },
      { date: "2026-01-05T...", reason: "Strike issued - Payment received after grace period" }
    ]
  }
}
```

### 2. Termination Eligibility Check (page.tsx, line 419)
```
⚠️ TERMINATION ELIGIBILITY CHECK for John Doe: {
  tenantId: "tenant-123",
  strikeCount: 3,
  strikes: [
    { date: "2025-12-01T...", reason: "Strike issued..." },
    { date: "2025-12-15T...", reason: "Strike issued..." },
    { date: "2026-01-05T...", reason: "Strike issued..." }
  ],
  isTerminationEligible: true,
  calculation: "3+ strikes - checking 90-day window"
}
```

## Testing Steps

### Scenario 1: Tenant with NO strikes
1. Open browser console (F12)
2. Look for logs:
   ```
   ⚠️ TERMINATION ELIGIBILITY CHECK for Jane Smith: {
     strikeCount: 0,
     isTerminationEligible: false,
     calculation: "Only 0 strikes - need 3 minimum"
   }
   ```
3. **Expected:** No "Termination Eligible" badge

### Scenario 2: Tenant with 1-2 strikes
1. Look for logs:
   ```
   ⚠️ TERMINATION ELIGIBILITY CHECK for Bob Jones: {
     strikeCount: 2,
     isTerminationEligible: false,
     calculation: "Only 2 strikes - need 3 minimum"
   }
   ```
2. **Expected:** No "Termination Eligible" badge

### Scenario 3: Tenant with 3+ strikes within 90 days
1. Look for logs:
   ```
   ⚠️ TERMINATION ELIGIBILITY CHECK for John Doe: {
     strikeCount: 3,
     strikes: [
       { date: "2025-12-01", ... },
       { date: "2025-12-15", ... },
       { date: "2026-01-05", ... }
     ],
     isTerminationEligible: true,
     calculation: "3+ strikes - checking 90-day window"
   }
   ```
2. **Expected:** "Termination Eligible" badge appears (red, pulsing)

### Scenario 4: Tenant with 3+ strikes but NOT within 90 days
1. Look for logs:
   ```
   ⚠️ TERMINATION ELIGIBILITY CHECK for Old Tenant: {
     strikeCount: 3,
     strikes: [
       { date: "2025-01-01", ... },  // Too old
       { date: "2025-03-01", ... },  // Too old
       { date: "2026-01-05", ... }
     ],
     isTerminationEligible: false,
     calculation: "3+ strikes - checking 90-day window"
   }
   ```
2. **Expected:** No "Termination Eligible" badge (strikes too spread out)

## How to Create Test Strikes

To test this feature, you need to create strikes in the evidence_ledger:

### Option 1: Pay rent late (5+ working days)
1. Mark a tenant as "Unpaid" with a due date 5+ working days ago
2. Mark them as "Paid"
3. The `isStrike()` function will automatically log a strike

### Option 2: Manually insert strikes (for testing)
```sql
INSERT INTO evidence_ledger (
    property_id,
    tenant_id,
    event_type,
    category,
    summary,
    details,
    metadata,
    created_at
) VALUES
    ('your-property-id', 'your-tenant-id', 'STRIKE_ISSUED', 'ARREARS', 
     'Strike issued - Payment received after grace period', 
     'Rent due 2025-12-01, paid 2025-12-10. Exceeded 5 working day grace period.',
     '{"dueDate": "2025-12-01", "paidDate": "2025-12-10"}',
     '2025-12-10T10:00:00Z'),
    ('your-property-id', 'your-tenant-id', 'STRIKE_ISSUED', 'ARREARS', 
     'Strike issued - Payment received after grace period', 
     'Rent due 2025-12-15, paid 2025-12-24. Exceeded 5 working day grace period.',
     '{"dueDate": "2025-12-15", "paidDate": "2025-12-24"}',
     '2025-12-24T10:00:00Z'),
    ('your-property-id', 'your-tenant-id', 'STRIKE_ISSUED', 'ARREARS', 
     'Strike issued - Payment received after grace period', 
     'Rent due 2026-01-05, paid 2026-01-14. Exceeded 5 working day grace period.',
     '{"dueDate": "2026-01-05", "paidDate": "2026-01-14"}',
     '2026-01-14T10:00:00Z');
```

Then refresh the rent tracker page.

## Files Modified
- `src/app/rent-tracker/page.tsx` (Lines 55-83, 419-429)

## UI Components (Already Existed)

### TenantCard Badge (line 75)
```tsx
{isTerminationEligible ? "Termination Eligible" : isStrikeRisk ? "Action Required" : "Unpaid"}
```

### GenerateNoticeButton Alert (line 279)
Shows tribunal filing deadline when termination eligible.

## Technical Details

### Evidence Ledger Schema
```sql
CREATE TABLE evidence_ledger (
    id UUID PRIMARY KEY,
    property_id UUID REFERENCES properties(id),
    tenant_id UUID REFERENCES tenants(id),
    event_type TEXT,  -- 'STRIKE_ISSUED', 'RENT_PAID', etc.
    category TEXT,    -- 'ARREARS', 'COMPLIANCE', etc.
    summary TEXT,
    details TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Strike History Type
```typescript
strikeHistory: { 
    date: string;           // ISO timestamp of when strike was issued
    reason: string;         // Human-readable reason
    serviceDate?: string;   // Optional service date for notice
}[]
```
