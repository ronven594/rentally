# Clean UI Data Flow - Single Source of Truth

## 🎯 Objective
**Eliminate all legacy rent calculations from UI components. Force all UI to use ONLY the Legal Engine output.**

---

## ✅ Data Flow (Clean Version)

### 1. **Legal Engine** (`src/lib/legal-engine.ts`)
**Single Source of Truth for all rent calculations**

```typescript
export function analyzeTenancySituation(input: AnalysisInput): AnalysisResult {
    // 1. FILTER LEDGER FOR "GHOST ARREARS"
    let ledger = input.ledger;
    if (input.leaseStartDate) {
        ledger = getValidLedger(input.ledger, input.leaseStartDate);
    }

    // 2. CALCULATE ARREARS (from filtered ledger)
    const daysArrears = calculateDaysInArrears(ledger, currentDate);
    const totalArrears = calculateTotalArrears(ledger);
    const workingDaysOverdue = calculateWorkingDaysOverdue(...);

    // 3. RETURN ANALYSIS WITH TOTALARREARS
    return {
        status: "...",
        analysis: {
            daysArrears,           // ← Calendar days overdue
            workingDaysOverdue,    // ← Working days overdue (RTA compliance)
            totalArrears,          // ← ✅ FILTERED TOTAL (no ghost arrears)
            // ...
        }
    };
}
```

**Key Function:**
```typescript
export function getValidLedger(ledger: LedgerEntry[], leaseStartDate: string): LedgerEntry[] {
    const floorDate = parseISO(leaseStartDate);
    return ledger.filter(entry => {
        const dueDate = parseISO(entry.dueDate);
        // Keep entries ON or AFTER lease start
        return isAfter(dueDate, floorDate) || isEqual(dueDate, floorDate);
    });
}
```

---

### 2. **Rental Logic Hook** (`src/hooks/useRentalLogic.ts`)
**Bridge between Legal Engine and UI**

```typescript
export function calculateRentalLogic(input: UseRentalLogicInput): RentalLogicResult {
    // 1. Convert payments to ledger format
    const ledger = input.payments.map(p => ({...}));

    // 2. Call Legal Engine with leaseStartDate
    const legalAnalysis = analyzeTenancySituation({
        tenantId: input.tenantId,
        ledger,
        strikeHistory: input.strikeHistory,
        leaseStartDate: input.leaseStartDate,  // ← Passed to engine
        // ...
    });

    // 3. ✅ SINGLE SOURCE OF TRUTH: Use totalArrears from legal engine
    const totalBalanceDue = legalAnalysis.analysis.totalArrears;

    // 4. Return cleaned data
    return {
        status: '...',
        daysOverdue: legalAnalysis.analysis.daysArrears,
        workingDaysOverdue: legalAnalysis.analysis.workingDaysOverdue,
        totalBalanceDue,  // ← From legal engine, NOT recalculated
        legalAnalysis,
        // ...
    };
}
```

**❌ REMOVED:** Manual filtering and recalculation
```typescript
// OLD CODE (DELETED):
const totalBalanceDue = ledger
    .filter(entry => {
        if (entry.status !== 'Unpaid') return false;
        if (input.leaseStartDate) {
            // Manual ghost arrears filter
        }
        return true;
    })
    .reduce((sum, entry) => sum + entry.amount, 0);
```

---

### 3. **Rent Tracker Page** (`src/app/rent-tracker/page.tsx`)
**Passes leaseStartDate to hook**

```typescript
const tenantLegalStatuses = useMemo(() => {
    const statuses: Record<string, RentalLogicResult> = {};

    properties.forEach(property => {
        property.tenants.forEach(tenant => {
            const tenantPayments = payments.filter(p => p.tenantId === tenant.id);
            const strikeHistory = strikeHistories[tenant.id] || [];

            statuses[tenant.id] = calculateRentalLogic({
                tenantId: tenant.id,
                payments: tenantPayments,
                strikeHistory,
                region: property.region || 'Auckland',
                currentDate: testDate || undefined,
                leaseStartDate: tenant.startDate,  // ← ✅ CRITICAL: Prevents ghost arrears
            });
        });
    });

    return statuses;
}, [properties, payments, strikeHistories, testDate]);
```

---

### 4. **TenantCard** (`src/components/dashboard/TenantCard.tsx`)
**NO CALCULATIONS - Only displays Legal Engine output**

```typescript
export function TenantCard({ tenant, legalStatus, ...props }: TenantCardProps) {
    // ✅ Extract values from Legal Engine output
    const {
        status,
        daysOverdue,           // From legalAnalysis.analysis.daysArrears
        workingDaysOverdue,    // From legalAnalysis.analysis.workingDaysOverdue
        totalBalanceDue,       // From legalAnalysis.analysis.totalArrears (filtered!)
        eligibleActions,
        activeStrikeCount,
    } = legalStatus;

    // ✅ Get Kiwi Status (Green/Amber/Red/Black)
    const statusInfo = getKiwiStatus(daysOverdue, workingDaysOverdue, totalBalanceDue);

    return (
        <div className={cn(
            "bg-gray-50/50 border rounded-[2rem]",
            statusInfo.severity === 'critical' && "border-[#1A1C1D] bg-black/5",
            statusInfo.severity === 'overdue' && "border-red-200 bg-red-50/30",
            statusInfo.severity === 'warning' && "border-[#F59E0B]/30 bg-amber-50/20",
        )}>
            {/* Display values directly - NO CALCULATIONS */}
            <p>{statusInfo.severity === 'overdue'
                ? `${daysOverdue} days overdue: $${totalBalanceDue.toFixed(2)}`
                : `${statusInfo.actionText}: $${totalBalanceDue.toFixed(2)}`
            }</p>
        </div>
    );
}
```

**❌ NO MANUAL CALCULATIONS:**
- ❌ No `daysOverdue = ...`
- ❌ No `totalOwed = payments.filter(...).reduce(...)`
- ❌ No custom arrears logic
- ✅ ALL VALUES from `legalStatus` (Legal Engine output)

---

### 5. **PropertyCard** (`src/components/dashboard/PropertyCard.tsx`)
**Aggregates tenant statuses using Kiwi Status**

```typescript
export function PropertyCard({ property, tenantLegalStatuses, ...props }: PropertyCardProps) {
    // ✅ Use getKiwiStatus for perfect synchronization
    let mostCriticalStatus: KiwiStatus = getKiwiStatus(0, 0, 0);

    property.tenants.forEach(tenant => {
        const legalStatus = tenantLegalStatuses[tenant.id];
        if (!legalStatus) return;

        // ✅ Get Kiwi status from Legal Engine values
        const tenantStatus = getKiwiStatus(
            legalStatus.daysOverdue,
            legalStatus.workingDaysOverdue,
            legalStatus.totalBalanceDue
        );

        // Escalate to most critical severity
        if (severityPriority[tenantStatus.severity] > severityPriority[mostCriticalStatus.severity]) {
            mostCriticalStatus = tenantStatus;
        }
    });

    return (
        <div>
            <StatusBadge
                status={mostCriticalStatus.severity}
                text={mostCriticalStatus.label.toUpperCase()}
            />
        </div>
    );
}
```

---

## 🎨 Kiwi Status Flow (Green-Amber-Red-Black)

### Status Engine (`src/lib/status-engine.ts`)

```typescript
export function getKiwiStatus(
    daysArrears: number,
    workingDaysOverdue: number,
    totalArrears: number
): KiwiStatus {
    // CRITICAL: 21+ calendar days (Termination Eligible - BLACK)
    if (daysArrears >= 21) {
        return {
            label: "Critical",
            color: "#1A1C1D",
            severity: 'critical',
            actionText: "Termination Eligible"
        };
    }

    // BEHIND: 5+ working days (Strike Eligible - RED)
    if (workingDaysOverdue >= 5) {
        return {
            label: "Behind",
            color: "#DC2626",
            severity: 'overdue',
            actionText: "Strike Notice Ready"
        };
    }

    // NEEDS LOOK: Any arrears but < 5 working days (AMBER)
    if (totalArrears > 0) {
        return {
            label: "Needs Look",
            color: "#F59E0B",
            severity: 'warning',
            actionText: "Payment Pending"
        };
    }

    // ALL GOOD: No arrears (GREEN)
    return {
        label: "All Good",
        color: "#008060",
        severity: 'safe',
        actionText: "Up to Date"
    };
}
```

---

## ✅ Verification Checklist

### Legal Engine
- [x] `analyzeTenancySituation()` filters ledger using `getValidLedger()` when `leaseStartDate` provided
- [x] `AnalysisResult.analysis.totalArrears` contains filtered total
- [x] Ghost arrears (payments before lease start) are excluded

### Rental Logic Hook
- [x] Passes `leaseStartDate` to `analyzeTenancySituation()`
- [x] Uses `legalAnalysis.analysis.totalArrears` instead of recalculating
- [x] No manual filtering or arrears calculation

### Rent Tracker Page
- [x] Passes `tenant.startDate` as `leaseStartDate` to `calculateRentalLogic()`

### TenantCard
- [x] Extracts all values from `legalStatus` prop
- [x] Uses `getKiwiStatus()` for color/severity mapping
- [x] No manual calculations

### PropertyCard
- [x] Uses `getKiwiStatus()` for each tenant
- [x] Aggregates to most critical severity
- [x] No manual calculations

---

## 🚫 Banned Patterns

**Never do this in UI components:**

```typescript
// ❌ BANNED: Manual arrears calculation
const totalOwed = payments
    .filter(p => p.status === 'Unpaid')
    .reduce((sum, p) => sum + p.amount, 0);

// ❌ BANNED: Manual days overdue calculation
const daysOverdue = differenceInCalendarDays(new Date(), parseISO(oldestDueDate));

// ❌ BANNED: Manual lease start filtering
const validPayments = payments.filter(p =>
    new Date(p.dueDate) >= new Date(tenant.leaseStartDate)
);
```

**Always do this:**

```typescript
// ✅ CORRECT: Use Legal Engine output
const {
    daysOverdue,
    workingDaysOverdue,
    totalBalanceDue,
} = legalStatus;  // From Legal Engine

const statusInfo = getKiwiStatus(daysOverdue, workingDaysOverdue, totalBalanceDue);
```

---

## 📊 Expected Behavior

### Scenario: Tenant with lease start Jan 2, 2026

**Before (Bug):**
- Shows $800 debt from payments generated before lease start
- UI calculates arrears manually, including "ghost debt"

**After (Fixed):**
- Legal Engine filters ledger: `getValidLedger(ledger, '2026-01-02')`
- Only payments on/after Jan 2 are counted
- `totalArrears` = $0 (if no valid unpaid payments)
- TenantCard shows "All Good" (Green)

---

## 🔍 Debug Commands

```bash
# Check for manual calculations in UI
grep -r "differenceInCalendarDays\|calculateDaysInArrears\|calculateTotalArrears" src/components/

# Verify leaseStartDate is passed
grep -r "leaseStartDate" src/app/rent-tracker/page.tsx src/hooks/useRentalLogic.ts

# Check Legal Engine exports totalArrears
grep -A 20 "export interface AnalysisResult" src/lib/legal-engine.ts
```

---

## 📝 Summary

**All UI components now:**
1. ✅ Rely solely on Legal Engine output
2. ✅ Respect `leaseStartDate` (no ghost arrears)
3. ✅ Use Kiwi Status for consistent colors (Green/Amber/Red/Black)
4. ✅ Never perform manual rent calculations

**Single Source of Truth:** `analyzeTenancySituation()` in `src/lib/legal-engine.ts`
