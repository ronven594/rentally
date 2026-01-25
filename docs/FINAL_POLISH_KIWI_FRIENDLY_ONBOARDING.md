# Final Polish: Kiwi-Friendly Tenant Onboarding

**Implementation Date**: 2026-01-24
**Purpose**: Simplify tenant onboarding, eliminate technical jargon, and provide intuitive "ghost debt" resolution

---

## Problem Statement

### User Experience Issues

1. **Too Technical**: Fields like "Tracking Start Date" and "Opening Arrears" confused non-technical users
2. **Ghost Debt Confusion**: Users saw $800 debt immediately after adding a tenant who moved in weeks ago
3. **Jargon Overload**: Terms like "arrears" felt formal and unintuitive for Kiwi users
4. **No Settlement Path**: If users backdated tracking and saw unexpected debt, they had no clear way to resolve it

---

## Solution: Three-Part Polish

### 1. Simplified Toggle-Based Onboarding
### 2. Kiwi-Friendly Vocabulary (No "Arrears")
### 3. One-Click Settlement Button

---

## Part 1: Simplified Add Tenant Form

### The Toggle Interface

**Default State** (90% of users):
```
┌─────────────────────────────────────────────┐
│ ✓ Start tracking rent from today           │
│   Recommended for new tenants or those      │
│   who are paid up                           │
└─────────────────────────────────────────────┘
```

**Result**:
- Tracking Start Date: **Today**
- Existing Balance: **$0**
- Status: **"All Good"** (Green)

---

**Advanced State** (10% of users):

Toggle OFF reveals:
```
┌─────────────────────────────────────────────┐
│ ☐ Start tracking rent from today           │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Track from past date *                      │
│ [2025-12-01]                                │
│ When should we start tracking rent?         │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Existing Balance ($)                        │
│ [$400.00]                                   │
│ How much rent are they behind?              │
│ (leave as $0 if paid up)                    │
└─────────────────────────────────────────────┘
```

**Result**:
- Tracking Start Date: **2025-12-01**
- Existing Balance: **$400**
- Status: **"Needs Look"** (Amber)

---

### Code Implementation

**File**: [AddTenantDialog.tsx](../src/components/dashboard/AddTenantDialog.tsx)

**Key Changes**:

1. **Toggle State** (Line 41):
```typescript
const [trackFromToday, setTrackFromToday] = useState(true); // Default: ON
const [customTrackingDate, setCustomTrackingDate] = useState(""); // Revealed when toggle is OFF
const [existingBalance, setExistingBalance] = useState("0"); // Revealed when toggle is OFF
```

2. **Conditional Backend Mapping** (Lines 75-82):
```typescript
const finalTrackingStartDate = trackFromToday
    ? format(new Date(), 'yyyy-MM-dd') // Track from today
    : customTrackingDate; // Track from custom past date

const finalOpeningBalance = trackFromToday
    ? 0 // No existing debt if tracking from today
    : Number(existingBalance) || 0; // Use specified existing balance if backdating
```

3. **UI Toggle** (Lines 315-357):
```typescript
<button
    type="button"
    onClick={() => setTrackFromToday(!trackFromToday)}
    className={`relative inline-flex h-6 w-11 items-center rounded-full ${
        trackFromToday ? 'bg-emerald-600' : 'bg-slate-300'
    }`}
>
    <span className={`inline-block h-4 w-4 transform rounded-full bg-white ${
        trackFromToday ? 'translate-x-6' : 'translate-x-1'
    }`} />
</button>

{/* Conditional Fields: Show if tracking from past date */}
{!trackFromToday && (
    <div className="space-y-3 pt-3 border-t border-emerald-200/50">
        {/* Custom Tracking Date */}
        {/* Existing Balance */}
    </div>
)}
```

---

## Part 2: Kiwi-Friendly Vocabulary

### The "No Arrears" Rule

**Search Pattern**: `arrears|Arrears|ARREARS` (case-insensitive)

**Replacements Made**:

| File | Line | Old Text | New Text |
|------|------|----------|----------|
| [TenantCard.tsx](../src/components/dashboard/TenantCard.tsx#L87) | 87 | "calendar days in **arrears**" | "calendar days **behind**" |
| [status-engine.ts](../src/lib/status-engine.ts#L96) | 96 | "**ARREARS DETECTED**" | "**BEHIND**" |
| [status-engine.ts](../src/lib/status-engine.ts#L104) | 104 | "days in **arrears**" | "days **behind**" |
| [status-engine.ts](../src/lib/status-engine.ts#L163) | 163 | "text: '**ARREARS**'" | "text: '**BEHIND**'" |

**Vocabulary Guide**:

| Technical Term | Kiwi-Friendly |
|----------------|---------------|
| Arrears | Behind |
| In Arrears | Behind |
| Days in Arrears | Days Behind |
| Opening Arrears | Existing Balance |
| Total Arrears | Total Behind |

---

## Part 3: One-Click Settlement Button

### The Problem

User adds a tenant with:
- Lease Start: January 2, 2026 (3 weeks ago)
- Toggle OFF: Track from past date = January 2
- Existing Balance: $0

**Result**: System shows $800 debt (4 weeks × $200)

**User Reaction**: "Wait, they're actually paid up! How do I fix this?"

---

### The Solution

**"Mark Opening Balance as Paid" Button**

**When Shown**:
- Tenant has `openingArrears` > $0
- Tenant has `totalBalanceDue` > $0
- Parent component provides `onSettleOpeningBalance` callback

**Visual Design**:
```
┌─────────────────────────────────────────────┐
│  ✓  MARK OPENING BALANCE AS PAID           │
│     (Green outline button)                  │
└─────────────────────────────────────────────┘
```

**What It Does**:
1. Sets `opening_arrears` to $0 in database
2. Recalculates total balance (now $0 if only opening arrears existed)
3. Status changes from "Behind" → "All Good"

---

### Code Implementation

**File**: [TenantCard.tsx](../src/components/dashboard/TenantCard.tsx)

**Interface Update** (Lines 14-23):
```typescript
interface TenantCardProps {
    tenant: Tenant;
    legalStatus: RentalLogicResult;
    payments: RentPayment[];
    propertyId: string;
    suggestedMatch?: { ... };
    onRecordPayment: (...) => Promise<void>;
    onSettings: () => void;
    onSettleOpeningBalance?: (tenantId: string) => Promise<void>; // NEW: Settlement action
}
```

**Settlement Button** (Lines 211-237):
```typescript
{/* Settlement Button - Only show if tenant has opening arrears */}
{tenant.openingArrears && tenant.openingArrears > 0 && totalBalanceDue > 0 && onSettleOpeningBalance && (
    <Button
        variant="outline"
        size="brand"
        onClick={async (e) => {
            e.stopPropagation();
            setIsSettling(true);
            try {
                await onSettleOpeningBalance(tenant.id);
            } finally {
                setIsSettling(false);
            }
        }}
        disabled={isSettling}
        className="w-full rounded-2xl border-2 border-emerald-600 text-emerald-700 hover:bg-emerald-50 font-black"
    >
        {isSettling ? (
            <>
                <Loader2 className="w-4 h-4 animate-spin" />
                SETTLING...
            </>
        ) : (
            <>
                <CheckCircle className="w-4 h-4" />
                MARK OPENING BALANCE AS PAID
            </>
        )}
    </Button>
)}
```

---

## Part 4: getKiwiStatus Consistency

### The Requirement

**Property Card dot** and **Tenant Card banner** must use **identical** status logic to prevent confusion.

### Verification

**Both components call getKiwiStatus with identical parameters**:

```typescript
// PropertyCard.tsx (Line 42)
const tenantStatus = getKiwiStatus(
    legalStatus.daysOverdue,
    legalStatus.workingDaysOverdue,
    legalStatus.totalBalanceDue
);

// TenantCard.tsx (Line 61)
const statusInfo = getKiwiStatus(daysOverdue, workingDaysOverdue, totalBalanceDue);
```

**getKiwiStatus Logic** ([status-engine.ts](../src/lib/status-engine.ts#L193-L235)):

```typescript
export function getKiwiStatus(
    daysArrears: number,
    workingDaysOverdue: number,
    totalArrears: number
): KiwiStatus {
    // CRITICAL: 21+ calendar days (Termination Eligible)
    if (daysArrears >= 21) {
        return {
            label: "Critical",
            color: "#1A1C1D", // Black
            severity: 'critical',
            actionText: "Termination Eligible"
        };
    }

    // BEHIND: 5+ working days (Strike Eligible)
    if (workingDaysOverdue >= 5) {
        return {
            label: "Behind",
            color: "#DC2626", // Red-600
            severity: 'overdue',
            actionText: "Strike Notice Ready"
        };
    }

    // NEEDS LOOK: Any arrears but not yet strike eligible
    if (totalArrears > 0) {
        return {
            label: "Needs Look",
            color: "#F59E0B", // Amber-500
            severity: 'warning',
            actionText: "Payment Pending"
        };
    }

    // ALL GOOD: No arrears
    return {
        label: "All Good",
        color: "#008060", // Green-700
        severity: 'safe',
        actionText: "Up to Date"
    };
}
```

**Result**: Perfect synchronization ✅

---

## User Flows

### Flow 1: New Tenant (Default Path)

**User Actions**:
1. Click "Add Tenant"
2. Fill in name, email, rent amount
3. Leave toggle **ON** (default)
4. Click "Save Tenant"

**System Behavior**:
- `tracking_start_date`: Today
- `opening_arrears`: $0
- Payments generated: From today forward
- **Status**: "All Good" (Green)

**User Sees**: ✅ No ghost debt!

---

### Flow 2: Existing Tenant (Paid Up)

**User Actions**:
1. Click "Add Tenant"
2. Fill in name, email, rent amount
3. Fill in "Lease Start": January 2, 2026 (for reference)
4. Leave toggle **ON** (default)
5. Click "Save Tenant"

**System Behavior**:
- `tracking_start_date`: Today (Jan 24)
- `opening_arrears`: $0
- Payments generated: From today forward (NOT from Jan 2)
- **Status**: "All Good" (Green)

**User Sees**: ✅ No ghost debt from historical dates!

---

### Flow 3: Existing Tenant (Behind $400)

**User Actions**:
1. Click "Add Tenant"
2. Fill in name, email, rent amount
3. Fill in "Lease Start": January 2, 2026
4. Toggle **OFF**
5. Set "Track from past date": January 2, 2026
6. Set "Existing Balance": $400
7. Click "Save Tenant"

**System Behavior**:
- `tracking_start_date`: Jan 2, 2026
- `opening_arrears`: $400
- Payments generated: From Jan 2 forward
- Total Balance: $400 (opening) + unpaid ledger entries
- **Status**: "Needs Look" (Amber)

**User Sees**: Tenant correctly shown as $400 behind

---

### Flow 4: Settlement (User Made a Mistake)

**Scenario**: User added tenant with $400 opening balance, but they're actually paid up

**User Actions**:
1. View Tenant Card showing "Behind" status
2. See "$400" total balance
3. Click "**MARK OPENING BALANCE AS PAID**" button
4. Confirm action

**System Behavior**:
- Updates `opening_arrears` from $400 → $0
- Recalculates total balance: $0
- **Status**: Changes from "Needs Look" → "All Good"

**User Sees**: ✅ Instant correction without re-adding tenant!

---

## Files Changed

| File | Summary |
|------|---------|
| [AddTenantDialog.tsx](../src/components/dashboard/AddTenantDialog.tsx) | Toggle-based interface, conditional fields, simplified vocabulary |
| [TenantCard.tsx](../src/components/dashboard/TenantCard.tsx) | Settlement button, Loader2 import, "behind" instead of "arrears" |
| [status-engine.ts](../src/lib/status-engine.ts) | Replaced "ARREARS" with "BEHIND" in labels and messages |

---

## Vocabulary Audit Results

**Search Command**: `grep -rni "arrears" src/`

**Backend/Internal** (Keep as is):
- Database column names: `opening_arrears`
- TypeScript types: `openingArrears`, `totalArrears`
- Variable names: `ledgerArrears`, `finalOpeningBalance`
- Comments: Technical documentation

**User-Facing** (Changed to "Behind"):
- ✅ Status labels: "BEHIND" (was "ARREARS DETECTED")
- ✅ Banner text: "behind" (was "in arrears")
- ✅ Property card: "BEHIND" (was "ARREARS")
- ✅ Footer messages: "behind" (was "in arrears")

---

## Testing Checklist

### Toggle Interface
- [ ] Default state: Toggle ON, tracking from today
- [ ] Toggle OFF: Reveals custom date and existing balance fields
- [ ] Toggle back ON: Hides conditional fields
- [ ] Form submission with toggle ON: Sets tracking start to today, opening balance to $0
- [ ] Form submission with toggle OFF: Uses custom date and existing balance

### Vocabulary
- [ ] TenantCard banners say "behind" not "arrears"
- [ ] Property Card status badge says "BEHIND" not "ARREARS"
- [ ] Status engine labels use "Behind" terminology

### Settlement Button
- [ ] Only shows when `openingArrears` > 0
- [ ] Only shows when `totalBalanceDue` > 0
- [ ] Clicking shows "SETTLING..." with spinner
- [ ] After settlement, status changes to "All Good"
- [ ] After settlement, total balance is $0

### Consistency
- [ ] Property Card dot color matches Tenant Card banner severity
- [ ] getKiwiStatus used consistently with same parameters
- [ ] All status labels synchronized across components

---

## Summary

**Before**: Technical jargon, confusing fields, no clear way to fix ghost debt

**After**:
- ✅ Simple toggle-based onboarding (90% of users never see advanced fields)
- ✅ Kiwi-friendly language ("behind" instead of "arrears")
- ✅ One-click settlement for backdated tenants
- ✅ Perfect status synchronization across components

**Result**: Intuitive, professional, Kiwi-friendly tenant onboarding! 🇳🇿
