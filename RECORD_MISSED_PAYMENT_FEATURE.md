# Record Missed Payment Feature - Implementation Summary

## Overview
Added ability to record multiple missed rent payments for a tenant, allowing unpaid payments to accumulate beyond the single Paid/Unpaid toggle.

## Components Created

### RecordMissedPaymentDialog.tsx
**Location:** `src/components/dashboard/RecordMissedPaymentDialog.tsx`

**Features:**
- Due date picker (defaults to next rent due based on frequency)
- Amount input (defaults to tenant.rentAmount)
- Calculates next due date based on tenant frequency:
  - Weekly: +1 week
  - Fortnightly: +2 weeks
  - Monthly: +30 days
- Loading state during submission
- Form validation

## Implementation Details

### 1. Handler Function (page.tsx)
**Function:** `handleRecordMissedPayment(tenantId, dueDate, amount)`

**Actions:**
1. Finds tenant and property
2. Inserts new payment record to Supabase:
   ```sql
   INSERT INTO payments (tenant_id, property_id, due_date, amount, status)
   VALUES (..., 'Unpaid')
   ```
3. Logs to evidence ledger (RENT_MISSED event)
4. Updates local state
5. Shows success toast

### 2. Data Flow
```
TenantCard
  ↓ User clicks "Record Missed Rent" button
RecordMissedPaymentDialog opens
  ↓ User enters due date & amount
  ↓ User clicks "Record Payment"
handleRecordMissedPayment(tenantId, dueDate, amount)
  ↓ Insert to Supabase payments table
  ↓ Log to evidence_ledger
  ↓ Update local payments state
Payments list refreshes
  ↓ Arrears calculations update automatically
TenantCard shows new totalArrears
```

### 3. UI Integration
**Location:** TenantCard.tsx

**Button:**
- Label: "Record Missed Rent"
- Style: Amber background, Plus icon
- Position: Next to status badge
- Always visible (not just when unpaid)

## Usage Scenarios

### Scenario 1: Tenant Misses First Payment
1. Tenant has no unpaid payments
2. Click "Record Missed Rent"
3. Dialog opens with next due date
4. Click "Record Payment"
5. New unpaid payment created
6. Tenant shows as unpaid with $500 arrears

### Scenario 2: Tenant Misses Multiple Payments
1. Tenant already has 1 unpaid payment ($500)
2. Click "Record Missed Rent" again
3. Adjust due date to next period
4. Click "Record Payment"
5. Second unpaid payment created
6. Tenant shows $1,000 total arrears

### Scenario 3: Custom Amount
1. Click "Record Missed Rent"
2. Change amount from $500 to $600 (rent increase)
3. Click "Record Payment"
4. New unpaid payment for $600 created

## Key Features

### Automatic Due Date Calculation
The dialog intelligently calculates the next rent due date based on the tenant's payment frequency:

```tsx
const getNextDueDate = () => {
    const today = testDate || new Date();
    const frequency = tenant.frequency || "Weekly";
    
    if (frequency === "Weekly") {
        return addWeeks(today, 1);
    } else if (frequency === "Fortnightly") {
        return addWeeks(today, 2);
    } else {
        // Monthly or any other frequency
        return addDays(today, 30);
    }
};
```

### Test Date Support
The feature respects the test date override, allowing you to simulate missed payments at any point in time.

### Arrears Accumulation
Multiple unpaid payments automatically accumulate:
- Payment 1: $500 (Jan 1)
- Payment 2: $500 (Jan 15)
- Payment 3: $500 (Feb 1)
- **Total Arrears:** $1,500

This is calculated automatically in PropertyCard and passed to GenerateNoticeButton for accurate notice generation.

## Database Impact

### New Records Created
Each "Record Missed Rent" action creates:

1. **Payment Record:**
   ```sql
   payments table:
   - id: UUID
   - tenant_id: UUID
   - property_id: UUID
   - due_date: DATE
   - amount: DECIMAL
   - status: 'Unpaid'
   - paid_date: NULL
   ```

2. **Evidence Ledger Entry:**
   ```sql
   evidence_ledger table:
   - event_type: 'RENT_MISSED'
   - category: 'ARREARS'
   - title: "Missed Rent Recorded"
   - description: "Rent payment of $X marked as missed..."
   - metadata: { amount, dueDate }
   ```

## Testing Steps

### Test 1: Basic Missed Payment
1. Open rent tracker
2. Find a tenant with no unpaid payments
3. Click "Record Missed Rent"
4. **Expected:** Dialog opens with next week's date, $500 amount
5. Click "Record Payment"
6. **Expected:** Success toast, tenant shows as unpaid, $500 arrears

### Test 2: Multiple Missed Payments
1. Tenant already has 1 unpaid payment
2. Click "Record Missed Rent" again
3. Adjust due date to 2 weeks from now
4. Click "Record Payment"
5. **Expected:** 2 unpaid payments, $1,000 total arrears
6. Open console (F12)
7. **Expected:**
   ```
   📝 Missed Payment Recorded: {
     tenant: "John Doe",
     dueDate: "2026-02-01",
     amount: 500,
     message: "New unpaid payment added to records"
   }
   
   💰 Arrears Calculation for John Doe: {
     unpaidPayments: 2,
     overdueAmount: 500,
     totalArrears: 1000,
     breakdown: [...]
   }
   ```

### Test 3: Custom Amount
1. Click "Record Missed Rent"
2. Change amount to $600
3. Click "Record Payment"
4. **Expected:** New payment for $600 created

### Test 4: With Test Date Override
1. Set test date to 2026-03-01
2. Click "Record Missed Rent"
3. **Expected:** Due date defaults to 2026-03-08 (1 week from test date)
4. Record payment
5. **Expected:** Payment created with correct due date

## Files Modified

### New Files
- `src/components/dashboard/RecordMissedPaymentDialog.tsx` (158 lines)

### Modified Files
- `src/app/rent-tracker/page.tsx` (Added handleRecordMissedPayment handler, ~70 lines)
- `src/components/dashboard/PropertyCard.tsx` (Added onRecordMissedPayment prop, passed to TenantCard)
- `src/components/dashboard/TenantCard.tsx` (Added button, dialog integration, state management)

## Debug Logging

### When Recording Missed Payment
```
📝 Missed Payment Recorded: {
  tenant: "John Doe",
  dueDate: "2026-01-15",
  amount: 500,
  message: "New unpaid payment added to records"
}
```

### When Calculating Arrears
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

## Benefits

1. **Accurate Arrears Tracking:** Multiple missed payments accumulate correctly
2. **Flexible Recording:** Can record past or future missed payments
3. **Evidence Trail:** All missed payments logged to evidence ledger
4. **Notice Accuracy:** Section 56 notices show correct total arrears
5. **No Data Loss:** Doesn't interfere with existing Paid/Unpaid toggle
6. **User-Friendly:** Simple dialog with smart defaults

## Important Notes

### Difference from Paid/Unpaid Toggle
- **Toggle:** Creates/updates a single unpaid payment (yesterday's date)
- **Record Missed Rent:** Creates additional unpaid payments with custom dates

### When to Use Each
- **Toggle:** Quick mark as unpaid for current period
- **Record Missed Rent:** 
  - Tenant missed multiple payments
  - Need to backdate missed payments
  - Recording future expected missed payments
  - Custom amounts (rent increases)

### Arrears Calculation
The system automatically sums ALL unpaid payments:
- Doesn't matter how they were created (toggle vs. record button)
- All unpaid payments contribute to totalArrears
- Used in Section 56 notice generation
