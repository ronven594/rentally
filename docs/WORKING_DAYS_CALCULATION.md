# Working Days Calculation - RTA Compliance

## Auckland Anniversary Test Scenario

**Scenario**: Rent due Friday, January 23, 2026

### Working Day Exclusions
1. **Weekends**: Saturday and Sunday
2. **Public Holidays**: All NZ national holidays + regional anniversary days
3. **Auckland Anniversary 2026**: Monday, January 26, 2026

### Expected Working Days Count

| Date | Day | Is Working Day? | Working Days Overdue | Status | Banner Message |
|---|---|---|---|---|---|
| Jan 23 | Friday | Yes | 0 | Sweet As | None |
| Jan 24 | Saturday | No | 0 | Payment Pending | None |
| Jan 25 | Sunday | No | 0 | Payment Pending | None |
| **Jan 26** | **Monday** | **No (Auckland Anniv)** | **0** | **Payment Pending** | **None** |
| Jan 27 | Tuesday | Yes | 1 | Payment Pending | None |
| Jan 28 | Wednesday | Yes | 2 | Payment Pending | None |
| Jan 29 | Thursday | Yes | 3 | Payment Pending | None |
| Jan 30 | Friday | Yes | 4 | Monitor | None |
| Jan 31 | Saturday | No | 4 | Monitor | None |
| Feb 1 | Sunday | No | 4 | Monitor | None |
| **Feb 2** | **Monday** | **Yes** | **5** | **Arrears** | **Strike 1 Ready** |
| Feb 3 | Tuesday | Yes | 6 | Arrears | Strike 1 Ready |

## Key Findings

### ✓ Jan 26 (Auckland Anniversary)
- **Working Days Overdue**: 0
- **Status**: Payment Pending (Monitor - Orange)
- **Card Color**: Border `#F59E0B/30`, Background `amber-50/20`
- **Banner**: None (not yet 5 working days)
- **Subheading**: "Payment Pending"

### ✓ Feb 2 (Monday)
- **Working Days Overdue**: 5
- **Status**: Arrears (Red)
- **Card Color**: Border `red-200`, Background `red-50/30`
- **Banner**: "Action Advised: Notice of Overdue Rent (Strike 1) Ready"
- **Subheading**: "Arrears: $[Amount]"

## RTA State Machine Implementation

### Status Levels

| Overdue Period | Property Card Status | Subheading | Banner | Color |
|---|---|---|---|---|
| 0 Days | Sweet As (Green) | Paid to [Date] | None | Green |
| 1–9 Calendar Days | Monitor (Orange) | Payment Pending | None | Amber #F59E0B |
| **5 Working Days** | **Arrears (Red)** | **Arrears: [Amount]** | **Strike 1 Ready** | **Red #DC2626** |
| 10 Working Days | Arrears (Red) | Arrears: [Amount] | Strike 2+ Ready | Red #DC2626 |
| 21 Calendar Days | Critical (Black) | Termination Eligible | S55(1)(a) Eligible | Black #1A1C1D |

### Banner Messages (by Working Days)

- **5-9 Working Days**: "Action Advised: Notice of Overdue Rent (Strike 1) Ready"
- **10+ Working Days**: "ACTION REQUIRED: Section 55 Strike Notice Ready"
- **21+ Calendar Days**: "URGENT: Eligible for Termination Application (S55 1a)"

## Top-Level Obligation Banner

The dashboard banner now correctly uses **"working days"** terminology:

- **5-9 Working Days**: "RECONCILE: [TENANT] IS X WORKING DAYS BEHIND"
- **10+ Working Days**: "ACTION REQUIRED: SECTION 55 STRIKE NOTICE READY"

## Code References

- Working day calculation: [legal-engine.ts:114-143](../src/lib/legal-engine.ts#L114-L143)
- Auckland Anniversary: [nz-holidays.ts:245](../src/lib/nz-holidays.ts#L245)
- Working days overdue: [legal-engine.ts:433-449](../src/lib/legal-engine.ts#L433-L449)
- TenantCard banner logic: [TenantCard.tsx:74-100](../src/components/dashboard/TenantCard.tsx#L74-L100)
- Status subheading: [TenantCard.tsx:109-128](../src/components/dashboard/TenantCard.tsx#L109-L128)

## Testing Instructions

1. Use the test date override feature in the UI
2. Set a tenant's rent due date to Friday, Jan 23, 2026
3. Mark it as unpaid
4. Set test date to Monday, Jan 26, 2026 (Auckland region)
5. Verify:
   - Subheading shows "Payment Pending"
   - Card has amber border
   - No banner appears
6. Set test date to Monday, Feb 2, 2026
7. Verify:
   - Subheading shows "Arrears: $[amount]"
   - Card has red border
   - Banner shows "Action Advised: Notice of Overdue Rent (Strike 1) Ready"
   - Banner subtitle shows "5 working days overdue (RTA compliance)"
