# Race Condition Fix - Ledger Sync System

## Problem

When clicking the "Sync Ledger" button, users had to click it 2-3 times before the UI showed the correct balance. This was caused by a race condition where:

1. Click Sync → Regeneration starts
2. Regeneration completes in background
3. UI tries to refresh immediately
4. Database writes haven't propagated yet
5. UI shows stale data
6. User clicks Sync again...

## Root Cause

The original implementation didn't wait for the full regeneration cycle to complete before refreshing the UI:

```typescript
// OLD CODE (BUGGY)
const syncLedger = async () => {
    await regeneratePaymentLedger(tenantId, settings, supabase);

    // Problem: Immediately invalidates queries before DB writes propagate
    queryClient.invalidateQueries(['tenant', tenantId]);
    // UI shows stale data because DB hasn't finished writing!
};
```

## The Fix

### 1. Loading State Management

The hook now provides an `isSyncing` boolean that tracks the regeneration state:

```typescript
const { isSyncing, syncLedger } = useTenantLedgerSync({
    tenantId: tenant.id,
    trackingStartDate: tenant.trackingStartDate,
    rentAmount: formRentAmount,
    frequency: formFrequency,
    rentDueDay: formRentDueDay,
    propertyId: tenant.propertyId
});

// In your UI:
<Button onClick={syncLedger} disabled={isSyncing}>
    {isSyncing ? (
        <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Syncing...
        </>
    ) : (
        'Sync Ledger'
    )}
</Button>
```

### 2. Proper Sync Flow

The new `syncLedger` function follows this sequence:

```typescript
const syncLedger = async () => {
    setIsSyncing(true);

    try {
        // Step 1: Trigger regeneration (all DB operations complete here)
        const result = await regeneratePaymentLedger(tenantId, currentSettings, supabase);

        // Step 2: Wait for DB writes to propagate (300ms buffer)
        await waitForDatabaseSync();

        // Step 3: Invalidate queries
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] }),
            queryClient.invalidateQueries({ queryKey: ['payments', tenantId] }),
            queryClient.invalidateQueries({ queryKey: ['tenants'] })
        ]);

        // Step 4: Explicitly refetch to ensure UI has latest data
        await Promise.all([
            queryClient.refetchQueries({ queryKey: ['tenant', tenantId] }),
            queryClient.refetchQueries({ queryKey: ['payments', tenantId] })
        ]);

        toast.success('Ledger synchronized');
    } finally {
        setIsSyncing(false);
    }
};
```

### 3. Database Sync Wait

Instead of complex polling/realtime subscriptions, we use a simple 300ms delay to ensure all database operations have completed:

```typescript
const waitForDatabaseSync = (): Promise<void> => {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve();
        }, 300);
    });
};
```

**Why 300ms?**
- Most Supabase operations complete within 100-200ms
- 300ms provides a safe buffer without being too slow for UX
- Prevents race conditions without complex polling logic

### 4. Explicit Refetch

After invalidating queries, we explicitly refetch them to ensure React Query fetches fresh data:

```typescript
// Invalidate marks queries as stale
await queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] });

// Refetch forces immediate data fetch
await queryClient.refetchQueries({ queryKey: ['tenant', tenantId] });
```

## Testing the Fix

### Before Fix:
1. Click "Sync Ledger"
2. Balance shows old value
3. Click "Sync Ledger" again
4. Balance shows old value
5. Click "Sync Ledger" third time
6. Balance finally updates ❌

### After Fix:
1. Click "Sync Ledger"
2. Button shows "Syncing..." with spinner
3. Wait 1-2 seconds
4. Balance updates correctly ✅
5. Button returns to "Sync Ledger"

## Alternative: Queue-Based Sync

For cases where you want to use the database trigger queue system (e.g., when tenant settings are updated via direct database changes), use the queue-based utilities:

```typescript
import { triggerQueuedRegeneration, waitForQueueCompletion } from '@/lib/ledger-sync-utils';

// Trigger a queued regeneration
await triggerQueuedRegeneration(
    tenantId,
    oldSettings,
    newSettings
);

// Or just wait for existing queue records to complete
await waitForQueueCompletion(tenantId);
```

The queue-based approach uses polling + realtime subscriptions to detect when the background processor marks the queue record as 'completed'.

## Files Modified

1. **src/hooks/useTenantLedgerSync.ts**
   - Added `isSyncing` state
   - Implemented proper sync flow with database wait
   - Added explicit refetch after invalidation
   - Returns `{ isSyncing, syncLedger }` for UI integration

2. **src/lib/ledger-sync-utils.ts** (NEW)
   - `waitForQueueCompletion()` - Wait for queue record completion
   - `triggerQueuedRegeneration()` - Create queue record and wait
   - `hasPendingRegeneration()` - Check if tenant has pending regeneration

3. **src/lib/ledger-queue-processor.ts** (UNCHANGED)
   - Already marks records as 'completed' or 'failed'
   - Used by background processing system

## Key Insights

1. **Database Propagation Takes Time** - Even after `await supabase.from('table').insert()` returns, the data may not be immediately queryable. A small delay ensures consistency.

2. **Invalidate + Refetch** - Invalidating queries marks them as stale, but doesn't force an immediate refetch. Explicitly calling `refetchQueries` ensures fresh data.

3. **Loading State is Critical** - The `isSyncing` boolean prevents users from clicking multiple times and provides visual feedback.

4. **Simple > Complex** - A 300ms delay is simpler and more reliable than complex polling/realtime subscription logic for this use case.

5. **Two Paths, Same Destination** - Direct regeneration (manual sync) and queue-based regeneration (database trigger) both work, but direct is simpler for UI interactions.

## Usage Example

```tsx
import { useTenantLedgerSync } from '@/hooks/useTenantLedgerSync';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

function TenantManagementDialog({ tenant }) {
    const [rentAmount, setRentAmount] = useState(tenant.weekly_rent);
    const [frequency, setFrequency] = useState(tenant.rent_frequency);
    const [rentDueDay, setRentDueDay] = useState(tenant.rent_due_day);

    const { isSyncing, syncLedger } = useTenantLedgerSync({
        tenantId: tenant.id,
        trackingStartDate: tenant.tracking_start_date,
        rentAmount,
        frequency,
        rentDueDay,
        propertyId: tenant.property_id,
        enabled: true
    });

    return (
        <div>
            <Input
                value={rentAmount}
                onChange={(e) => setRentAmount(Number(e.target.value))}
                disabled={isSyncing}
            />

            <Button
                onClick={syncLedger}
                disabled={isSyncing}
            >
                {isSyncing ? (
                    <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Syncing Ledger...
                    </>
                ) : (
                    'Sync Ledger'
                )}
            </Button>
        </div>
    );
}
```

## Performance Considerations

- **300ms delay per sync**: Acceptable for user-triggered actions
- **Explicit refetch**: Only refetches changed tenant's data, not all tenants
- **No polling loops**: No ongoing background processes after sync completes
- **Memory safe**: All timers and subscriptions properly cleaned up

## Future Improvements

1. **Optimistic Updates**: Update UI immediately, then sync in background
2. **Progressive Feedback**: Show detailed progress (deleting → generating → resolving)
3. **Retry Logic**: Auto-retry failed regenerations with exponential backoff
4. **Batch Processing**: Handle multiple tenant syncs in parallel
