# Fix: Strike Fetch Column Names

## Problem
Strike history fetch was returning 0 strikes even though STRIKE_ISSUED records existed in evidence_ledger.

## Root Cause
The query was selecting `summary` column, but the evidence_ledger schema uses `title` instead.

## Fix Applied

### Changed in `page.tsx` (Lines 58, 75):

**❌ BEFORE:**
```tsx
.select('tenant_id, created_at, summary, metadata')  // ❌ Wrong column!

// ...

reason: strike.summary || 'Strike issued',  // ❌ Undefined!
```

**✅ AFTER:**
```tsx
.select('tenant_id, created_at, title, metadata')  // ✅ Correct column!

// ...

reason: strike.title || 'Strike issued',  // ✅ Works!
```

### Enhanced Error Logging (Lines 62-68):

**❌ BEFORE:**
```tsx
if (strikeError) {
    console.error('Error fetching strike history:', strikeError);
}
```

**✅ AFTER:**
```tsx
if (strikeError) {
    console.error('❌ Error fetching strike history:', strikeError);
    console.error('Strike fetch details:', {
        message: strikeError.message,
        details: strikeError.details,
        hint: strikeError.hint
    });
}
```

## Evidence Ledger Schema

The correct schema is:
```sql
CREATE TABLE evidence_ledger (
    id UUID PRIMARY KEY,
    property_id UUID,
    tenant_id UUID,
    event_type TEXT,
    category TEXT,
    title TEXT,          -- ✅ Use this (not summary)
    description TEXT,    -- ✅ Use this (not details)
    metadata JSONB,
    file_urls TEXT[],
    created_at TIMESTAMPTZ
);
```

## Testing

1. Refresh the rent tracker page
2. Open browser console (F12)
3. Look for:
   ```
   📊 Strike History Loaded: {
     totalStrikes: 3,
     tenantsWithStrikes: 1,
     strikesByTenant: { ... }
   }
   ```

If you see `totalStrikes: 0`, check for error logs showing column issues.

## Files Modified
- `src/app/rent-tracker/page.tsx` (Lines 58, 62-68, 75)
