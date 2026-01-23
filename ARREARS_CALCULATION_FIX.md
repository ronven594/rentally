# Fix Summary: Arrears Calculation from Payment Records

## Problem
Notice generation was showing hardcoded rent amounts instead of calculating actual arrears from the payments table.

## Root Cause
**File:** `src/components/dashboard/TenantCard.tsx` (Lines 127-128)

Both `overdueAmount` and `totalArrears` were hardcoded to `tenant.rentAmount` with comments saying "Simplified for demo":

```tsx
overdueAmount={tenant.rentAmount} // Simplified for demo
totalArrears={tenant.rentAmount}    // Simplified for demo
```

This meant:
- ❌ Section 55 notices showed wrong overdue amount
- ❌ Section 56 notices didn't show accumulated arrears
- ❌ Multiple unpaid payments weren't being summed

## Solution Implemented

### Data Flow (NEW):
```
page.tsx (has payments array)
  ↓ passes payments prop
PropertyCard
  ↓ calculates arrears from payments
  ↓ overdueAmount = current unpaid payment
  ↓ totalArrears = sum of ALL unpaid payments
TenantCard
  ↓ passes calculated values
GenerateNoticeButton
  ↓ uses in notice generation
```

## Changes Made

### 1. Pass Payments to PropertyCard (`page.tsx`, Line 608)

**BEFORE:**
```tsx
<PropertyCard
    property={property}
    tenantStates={tenantStates}
    terminationEligibility={terminationEligibility}
    // ❌ No payments prop
    ...
/>
```

**AFTER:**
```tsx
<PropertyCard
    property={property}
    payments={payments}  // ✅ Pass payments array
    tenantStates={tenantStates}
    terminationEligibility={terminationEligibility}
    ...
/>
```

### 2. Calculate Arrears in PropertyCard (Lines 141-158)

**BEFORE:**
```tsx
{property.tenants.map(tenant => {
    const state = tenantStates.get(tenant.id) || { ... };
    const isEligible = terminationEligibility.get(tenant.id) || false;

    return (
        <TenantCard
            tenant={tenant}
            // ❌ No arrears calculation
            ...
        />
    );
})}
```

**AFTER:**
```tsx
{property.tenants.map(tenant => {
    const state = tenantStates.get(tenant.id) || { ... };
    const isEligible = terminationEligibility.get(tenant.id) || false;

    // ✅ Calculate arrears from actual payment records
    const tenantPayments = payments.filter(p => 
        p.tenantId === tenant.id && p.status === "Unpaid"
    );
    
    // overdueAmount = current/latest unpaid payment amount
    const currentUnpaid = tenantPayments.length > 0 
        ? tenantPayments[0].amount 
        : 0;
    
    // totalArrears = sum of ALL unpaid payments
    const totalUnpaid = tenantPayments.reduce((sum, p) => sum + p.amount, 0);

    console.log(`💰 Arrears Calculation for ${tenant.name}:`, {
        unpaidPayments: tenantPayments.length,
        overdueAmount: currentUnpaid,
        totalArrears: totalUnpaid,
        breakdown: tenantPayments.map(p => ({
            dueDate: p.dueDate,
            amount: p.amount
        }))
    });

    return (
        <TenantCard
            tenant={tenant}
            overdueAmount={currentUnpaid}  // ✅ Calculated
            totalArrears={totalUnpaid}     // ✅ Calculated
            ...
        />
    );
})}
```

### 3. Update TenantCard Props (Lines 8-20, 127-128)

**Interface BEFORE:**
```tsx
interface TenantCardProps {
    tenant: Tenant;
    isUnpaid: boolean;
    daysOverdue?: number;
    workingDaysOverdue?: number;
    // ❌ No overdueAmount or totalArrears
    ...
}
```

**Interface AFTER:**
```tsx
interface TenantCardProps {
    tenant: Tenant;
    isUnpaid: boolean;
    daysOverdue?: number;
    workingDaysOverdue?: number;
    overdueAmount: number;       // ✅ Current unpaid payment amount
    totalArrears: number;        // ✅ Sum of ALL unpaid payments
    ...
}
```

**Usage BEFORE:**
```tsx
<GenerateNoticeButton
    overdueAmount={tenant.rentAmount} // ❌ Hardcoded
    totalArrears={tenant.rentAmount}  // ❌ Hardcoded
    ...
/>
```

**Usage AFTER:**
```tsx
<GenerateNoticeButton
    overdueAmount={overdueAmount}  // ✅ From payments table
    totalArrears={totalArrears}    // ✅ From payments table
    ...
/>
```

## How It Works

### Scenario 1: Single Unpaid Payment
**Payments table:**
```
tenant_id: "abc123"
due_date: "2026-01-01"
amount: $500
status: "Unpaid"
```

**Calculation:**
- `overdueAmount` = $500 (first unpaid payment)
- `totalArrears` = $500 (sum of 1 payment)

**Notice shows:** $500 overdue

### Scenario 2: Multiple Unpaid Payments
**Payments table:**
```
1. due_date: "2025-12-15", amount: $500, status: "Unpaid"
2. due_date: "2026-01-01", amount: $500, status: "Unpaid"
3. due_date: "2026-01-15", amount: $500, status: "Unpaid"
```

**Calculation:**
- `overdueAmount` = $500 (first/current unpaid payment)
- `totalArrears` = $1,500 (sum of 3 payments)

**Notice shows:**
- Section 55: $500 current overdue
- Section 56: $1,500 total arrears

### Scenario 3: Some Paid, Some Unpaid
**Payments table:**
```
1. due_date: "2025-12-01", amount: $500, status: "Paid"
2. due_date: "2025-12-15", amount: $500, status: "Unpaid"
3. due_date: "2026-01-01", amount: $500, status: "Unpaid"
```

**Calculation:**
- `overdueAmount` = $500 (first unpaid)
- `totalArrears` = $1,000 (sum of 2 unpaid, ignores paid)

**Notice shows:** $1,000 total arrears

## Debug Logging Added

When the page loads or refreshes, you'll see:

```
💰 Arrears Calculation for John Doe: {
  unpaidPayments: 3,
  overdueAmount: 500,
  totalArrears: 1500,
  breakdown: [
    { dueDate: "2025-12-15", amount: 500 },
    { dueDate: "2026-01-01", amount: 500 },
    { dueDate: "2026-01-15", amount: 500 }
  ]
}
```

## Notice Generation Impact

### Section 55 (Strike Notice)
**Uses:** `overdueAmount` (current unpaid payment)

**Example:**
```
RENT ARREARS: $500.00
(Current overdue payment)
```

### Section 56 (14-Day Remedy Notice)
**Uses:** `totalArrears` (sum of all unpaid)

**Example:**
```
TOTAL RENT ARREARS: $1,500.00
(Accumulated unpaid rent)
```

## Testing Steps

### Test 1: Single Unpaid Payment
1. Mark tenant as "Unpaid" once
2. Open console (F12)
3. **Expected:**
   ```
   💰 Arrears Calculation for [Tenant]:
   unpaidPayments: 1
   overdueAmount: 500
   totalArrears: 500
   ```
4. Generate notice
5. **Expected:** Shows $500

### Test 2: Multiple Unpaid Payments
1. Mark tenant as "Unpaid" 3 times (different due dates)
2. Open console
3. **Expected:**
   ```
   💰 Arrears Calculation for [Tenant]:
   unpaidPayments: 3
   overdueAmount: 500
   totalArrears: 1500
   breakdown: [3 payments]
   ```
4. Generate Section 56 notice
5. **Expected:** Shows $1,500 total arrears

### Test 3: Verify Database Query
Check that the calculation matches the database:
```sql
SELECT 
    tenant_id,
    COUNT(*) as unpaid_count,
    SUM(amount) as total_arrears
FROM payments
WHERE status = 'Unpaid'
GROUP BY tenant_id;
```

## Files Modified
- `src/app/rent-tracker/page.tsx` (Line 608)
- `src/components/dashboard/PropertyCard.tsx` (Lines 4, 10, 22, 141-177)
- `src/components/dashboard/TenantCard.tsx` (Lines 12-13, 26-27, 127-128)

## Important Notes

### Payment Order
The code assumes `tenantPayments[0]` is the "current" unpaid payment. If payments aren't ordered by due date, you may need to sort them:

```tsx
const tenantPayments = payments
    .filter(p => p.tenantId === tenant.id && p.status === "Unpaid")
    .sort((a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime());
```

### Zero Arrears
If no unpaid payments exist:
- `overdueAmount` = 0
- `totalArrears` = 0
- GenerateNoticeButton won't be shown (because `isUnpaid` is false)

### Real-Time Updates
When you toggle a payment from Unpaid → Paid:
1. Payment status updates in database
2. `payments` state updates in page.tsx
3. PropertyCard recalculates arrears
4. Notice shows updated amounts

No page refresh needed!
