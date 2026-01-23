# Rent Tracker Page Analysis - src/app/rent-tracker/page.tsx

**File**: [src/app/rent-tracker/page.tsx](src/app/rent-tracker/page.tsx)
**Lines**: 937
**Complexity**: VERY HIGH
**Status**: ⚠️ REQUIRES IMMEDIATE REFACTOR

---

## 🔴 CRITICAL ISSUES IDENTIFIED

### **Issue #1: useEffect Race Conditions** (Lines 149-209)

**Multiple overlapping useEffects with conflicting dependencies:**

```typescript
// Effect 1: Initial load (Lines 149-159)
useEffect(() => {
    fetchProperties();
    fetchPayments();
}, [fetchProperties, fetchPayments]); // ❌ Dependencies change on every render

// Effect 2: Route navigation (Lines 161-171)
useEffect(() => {
    if (pathname === '/rent-tracker' || pathname === '/') {
        if (isMounted) {
            fetchProperties();
            fetchPayments();
        }
    }
}, [pathname, fetchProperties, fetchPayments, isMounted]); // ❌ Same functions

// Effect 3: Tab visibility (Lines 173-185)
useEffect(() => {
    const handleVisibilityChange = () => {
        fetchProperties();
        fetchPayments();
    };
    // ...
}, [fetchProperties, fetchPayments]); // ❌ Same dependencies

// Effect 4: Redundant payments fetch (Lines 187-189)
useEffect(() => {
    fetchPayments();
}, [fetchPayments]); // ❌ Duplicate of Effect 1

// Effect 5: Auto-generation (Lines 370-377)
useEffect(() => {
    if (properties.length > 0 && payments.length >= 0 && !loading) {
        autoGeneratePayments();
    }
}, [properties, loading, testDate]); // ❌ Missing payments dependency
```

**Problems:**
1. **fetchProperties** and **fetchPayments** are `useCallback` with no dependencies, but they reference `supabase` which is stable
2. Effect 1, 2, 3, and 4 all fetch the same data with overlapping triggers
3. Effect 5 (`autoGeneratePayments`) runs EVERY time `properties` array changes (even if just re-ordered)
4. `testDate` changes trigger auto-generation unnecessarily
5. Race condition: auto-generation starts before initial fetch completes

**Result**:
- Multiple simultaneous fetches on page load
- Infinite loops possible if state updates trigger callback recreation
- UI flickering from repeated renders

---

### **Issue #2: Test Date Re-render Bug** (Throughout)

**testDate changes don't trigger UI updates properly:**

```typescript
// Line 42: testDate state
const [testDate, setTestDate] = useState<Date | null>(null);

// Line 395: getTenantState uses testDate
const getTenantState = useCallback((tenantId: string) => {
    const today = testDate || new Date();
    // ... calculations
}, [payments, properties, testDate]); // ✅ Has testDate dependency

// Line 840: tenantStates memo
const { tenantStates, terminationEligibility } = useMemo(() => {
    properties.forEach(property => {
        property.tenants.forEach(tenant => {
            states.set(tenant.id, getTenantState(tenant.id));
        });
    });
    return { tenantStates: states, terminationEligibility: eligibility };
}, [properties, payments, testDate, getTenantState]); // ✅ Has testDate
```

**The problem is subtle:**
- `getTenantState` callback recreates when testDate changes ✅
- `useMemo` depends on testDate ✅
- BUT: The memo compares by reference, not value
- When testDate changes, `getTenantState` function changes
- However, Maps don't trigger deep equality checks

**Actual cause**: PropertyCard receives `tenantStates` Map by reference. React doesn't know the Map's contents changed.

**Solution**: Return plain object instead of Map, or add key to force re-render.

---

### **Issue #3: Massive State Bloat** (Lines 27-45)

**12 separate useState calls:**

```typescript
const [properties, setProperties] = useState<Property[]>([]);
const [payments, setPayments] = useState<RentPayment[]>([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);
const [isAddPropertyOpen, setIsAddPropertyOpen] = useState(false);
const [isAddTenantOpen, setIsAddTenantOpen] = useState(false);
const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
const [managingTenantId, setManagingTenantId] = useState<string | null>(null);
const [testDate, setTestDate] = useState<Date | null>(null);
const [confirmState, setConfirmState] = useState<{...}>({...});
const [isMounted, setIsMounted] = useState(false);
const pathname = usePathname();
```

**Problems:**
1. Too many state variables = hard to track updates
2. Dialog states (isAddPropertyOpen, isAddTenantOpen) could be single enum
3. confirmState object could be a dialog hook
4. isMounted anti-pattern (should use cleanup)

**Better approach**: useReducer or React Query

---

### **Issue #4: Manual Strike Logging (Lines 489-515)**

**Duplicates logic already in rent-logic.ts:**

```typescript
// STRIKE LOGIC: Ensure we only issue a strike if it's FULLY paid and LATE.
if (isFullyPaid) {
    const workingDaysLate = differenceInWorkingDays(today, payment.due_date, property.region);

    if (workingDaysLate >= 5) {
        evidenceEntries.push({
            propertyId: property.id,
            tenantId: tenantId,
            eventType: EVENT_TYPES.STRIKE_ISSUED,
            category: CATEGORIES.ARREARS,
            title: 'Strike issued - Payment received after grace period',
            description: `...`,
            metadata: { dueDate, paidDate, workingDaysLate, amountPaid }
        });
    }
}
```

**Should use**: `isStrikeWithLogging()` from refactored rent-logic.ts

---

### **Issue #5: Inefficient Auto-Generation** (Lines 191-368)

**Runs on EVERY properties array change:**

```typescript
useEffect(() => {
    if (properties.length > 0 && payments.length >= 0 && !loading) {
        autoGeneratePayments();
    }
}, [properties, loading, testDate]); // ❌ properties is a new array every fetch
```

**Problems:**
1. Array reference changes even if contents identical
2. Should use deep comparison or only run on mount + explicit triggers
3. testDate shouldn't trigger auto-generation
4. Missing payments dependency causes stale closure

**Infinite loop scenario:**
1. properties fetched → properties array changes → effect runs
2. autoGeneratePayments() creates new payment
3. setPayments() updates state
4. PropertyCard re-renders
5. Some prop change triggers fetchProperties()
6. Go to step 1

---

### **Issue #6: Console Log Pollution**

**62 console.log statements** throughout the file:
- Line 54: `console.log('🔄 Fetching...')`
- Line 59: `console.log('✅ Properties fetched:')`
- Line 152: `console.log('🏁 Component mounted')`
- And 59 more...

**Should**: Use proper logger with levels

---

### **Issue #7: God Component Anti-Pattern**

**One component doing EVERYTHING:**

1. Data fetching (properties, payments, strikes)
2. CRUD operations (add, update, delete)
3. Payment processing
4. Auto-generation logic
5. UI rendering
6. Dialog state management
7. Confirmation flows
8. Evidence logging

**Should**: Break into smaller components/hooks

---

## 📊 STATE FLOW DIAGRAM

```
Initial Load:
  ├─ Effect 1: fetchProperties() + fetchPayments()
  ├─ Effect 2: (skipped - not mounted yet)
  ├─ Effect 3: Visibility listener added
  ├─ Effect 4: fetchPayments() AGAIN ❌
  └─ Effect 5: autoGeneratePayments() (before data loads!) ❌

Data Loaded:
  ├─ setProperties() triggers
  ├─ Effect 5 runs again (properties changed)
  └─ autoGeneratePayments() runs

Test Date Changed:
  ├─ setTestDate() triggers
  ├─ Effect 5 runs (testDate dependency)
  ├─ autoGeneratePayments() runs (shouldn't!) ❌
  ├─ getTenantState callback recreates
  ├─ useMemo recalculates
  └─ BUT: UI doesn't update (Map reference unchanged) ❌
```

---

## 🔧 REFACTOR PLAN

### **Phase 1: Fix Critical Bugs** (Priority 1)

#### **1.1 Consolidate useEffects**

**Before** (5 effects):
```typescript
useEffect(() => { fetchProperties(); fetchPayments(); }, [fetchProperties, fetchPayments]);
useEffect(() => { if (pathname...) fetchProperties(); }, [pathname, ...]);
useEffect(() => { visibility listener }, [fetchProperties, fetchPayments]);
useEffect(() => { fetchPayments(); }, [fetchPayments]);
useEffect(() => { autoGeneratePayments(); }, [properties, loading, testDate]);
```

**After** (2 effects):
```typescript
// 1. Initial load + external triggers
useEffect(() => {
    if (!isMounted) {
        fetchProperties();
        fetchPayments();
        setIsMounted(true);
        return;
    }

    // Handle pathname changes
    if (pathname === '/rent-tracker' || pathname === '/') {
        fetchProperties();
        fetchPayments();
    }
}, [pathname]); // Only pathname as dependency

// 2. Visibility listener (stable)
useEffect(() => {
    const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
            fetchProperties();
            fetchPayments();
        }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
}, []); // Empty dependencies - functions are stable
```

#### **1.2 Fix Test Date Re-renders**

**Change tenantStates from Map to Object:**

```typescript
// Before
const { tenantStates, terminationEligibility } = useMemo(() => {
    const states = new Map(); // ❌ Reference doesn't change
    // ...
    return { tenantStates: states, terminationEligibility: eligibility };
}, [properties, payments, testDate, getTenantState]);

// After
const { tenantStates, terminationEligibility } = useMemo(() => {
    const states: Record<string, TenantState> = {}; // ✅ New object every time

    properties.forEach(property => {
        property.tenants.forEach(tenant => {
            states[tenant.id] = getTenantState(tenant.id);
        });
    });

    return { tenantStates: states, terminationEligibility: eligibilityObj };
}, [properties, payments, testDate, getTenantState]);
```

#### **1.3 Fix Auto-Generation Trigger**

```typescript
// Before
useEffect(() => {
    if (properties.length > 0 && payments.length >= 0 && !loading) {
        autoGeneratePayments(); // Runs on every properties change ❌
    }
}, [properties, loading, testDate]);

// After
const [lastAutoGenTime, setLastAutoGenTime] = useState(0);

useEffect(() => {
    const now = Date.now();

    // Only run if:
    // 1. Has properties
    // 2. Not loading
    // 3. Hasn't run in last 5 seconds (debounce)
    if (properties.length > 0 && !loading && (now - lastAutoGenTime) > 5000) {
        autoGeneratePayments();
        setLastAutoGenTime(now);
    }
}, [properties.length, loading]); // Use .length instead of array reference
```

---

### **Phase 2: Extract Custom Hooks** (Priority 2)

#### **2.1 Create useProperties Hook**

```typescript
// hooks/useProperties.ts
export function useProperties() {
    const [properties, setProperties] = useState<Property[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchProperties = useCallback(async () => {
        // ... existing fetch logic
    }, []);

    const addProperty = useCallback(async (property: Property) => {
        // ...
    }, []);

    const deleteProperty = useCallback(async (id: string) => {
        // ...
    }, []);

    return { properties, loading, error, fetchProperties, addProperty, deleteProperty };
}
```

#### **2.2 Create usePayments Hook**

```typescript
// hooks/usePayments.ts
export function usePayments() {
    const [payments, setPayments] = useState<RentPayment[]>([]);

    const fetchPayments = useCallback(async () => {
        // ...
    }, []);

    const recordPayment = useCallback(async (tenantId: string, amount: number) => {
        // Use isStrikeWithLogging here!
    }, []);

    return { payments, fetchPayments, recordPayment };
}
```

#### **2.3 Create useDialogState Hook**

```typescript
// hooks/useDialogState.ts
export function useDialogState() {
    const [openDialog, setOpenDialog] = useState<
        | { type: 'none' }
        | { type: 'addProperty' }
        | { type: 'addTenant'; propertyId: string }
        | { type: 'manageTenant'; tenantId: string }
        | { type: 'confirm'; message: string; onConfirm: () => void }
    >({ type: 'none' });

    const openAddProperty = () => setOpenDialog({ type: 'addProperty' });
    const openAddTenant = (propertyId: string) => setOpenDialog({ type: 'addTenant', propertyId });
    // ...

    return { openDialog, openAddProperty, openAddTenant, ... };
}
```

---

### **Phase 3: Use React Query** (Priority 3)

**Replace manual fetching with TanStack Query:**

```typescript
// Before
const [properties, setProperties] = useState<Property[]>([]);
const fetchProperties = useCallback(async () => { ... }, []);
useEffect(() => { fetchProperties(); }, []);

// After
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const { data: properties, isLoading, error } = useQuery({
    queryKey: ['properties'],
    queryFn: fetchPropertiesFromSupabase,
    staleTime: 5 * 60 * 1000, // 5 minutes
});

const { mutate: recordPayment } = useMutation({
    mutationFn: async ({ tenantId, amount }) => {
        // ... record payment logic
    },
    onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['properties'] });
        queryClient.invalidateQueries({ queryKey: ['payments'] });
    }
});
```

**Benefits:**
- ✅ Automatic caching
- ✅ Automatic refetch on window focus
- ✅ No manual loading/error state
- ✅ Optimistic updates
- ✅ Request deduplication

---

### **Phase 4: Break Into Smaller Components** (Priority 4)

```
rent-tracker/
├── page.tsx (orchestration only)
├── components/
│   ├── RentTrackerHeader.tsx
│   ├── PropertyList.tsx
│   ├── TestDateOverride.tsx
│   ├── EmptyState.tsx
│   └── LoadingState.tsx
└── hooks/
    ├── useProperties.ts
    ├── usePayments.ts
    ├── useAutoGeneration.ts
    ├── useTenantState.ts
    └── useDialogState.ts
```

---

## 🎯 IMMEDIATE FIXES (Quick Wins)

### **Fix #1: Remove Redundant useEffect**

Delete lines 187-189:
```typescript
useEffect(() => {
    fetchPayments();
}, [fetchPayments]); // ❌ Duplicate
```

### **Fix #2: Use isStrikeWithLogging**

Replace lines 489-515 with:
```typescript
if (isFullyPaid) {
    await isStrikeWithLogging(
        payment.due_date,
        format(new Date(), 'yyyy-MM-dd'),
        property.region,
        property.id,
        tenantId,
        testDate || undefined
    );
}
```

### **Fix #3: Change Map to Object**

Line 840:
```typescript
// Before
const states = new Map();
const eligibility = new Map();

// After
const states: Record<string, TenantState> = {};
const eligibility: Record<string, boolean> = {};
```

---

## 📈 METRICS

| Metric | Current | Target | Priority |
|--------|---------|--------|----------|
| useEffect hooks | 5 | 2 | High |
| useState hooks | 12 | 5 | Medium |
| console.log calls | 62 | 0 | Low |
| Lines of code | 937 | <300 | High |
| Cyclomatic complexity | Very High | Medium | High |

---

## ✅ SUCCESS CRITERIA

After refactor:
- [ ] Test date changes update UI immediately
- [ ] No useEffect race conditions
- [ ] No infinite loops
- [ ] No duplicate data fetches
- [ ] Auto-generation only runs when needed
- [ ] Strike logging uses new `isStrikeWithLogging()`
- [ ] File under 400 lines

---

**Next Steps**: Apply Quick Wins first, then extract hooks, then consider React Query.
