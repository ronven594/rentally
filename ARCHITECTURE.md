# Rent Tracking Engine Architecture

## Core Principle
Balance is calculated **deterministically** from raw inputs:

```
Balance = (Cycles Due x Rent Amount) + Opening Arrears - Sum(Payments)
```

Ledger records are for **display only** - they never drive calculations.

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/date-utils.ts` | NZ timezone handling, working days, holidays, `daysBetween()`, `getEffectiveToday()` |
| `src/lib/rent-calculator.ts` | Core balance calculation: `calculateRentState()`, cycle counting, paid-until date |
| `src/lib/status-calculator.ts` | Status/severity/eligibility: `calculateTenantStatus()` - the single source of truth |
| `src/lib/legal-engine.ts` | RTA compliance: notice service dates, remedy periods, tribunal deadlines |
| `src/lib/status-engine.ts` | Display helpers: `formatFrequencyLabel()`, `getObligationMessages()` |
| `src/lib/rta-constants.ts` | Legal constants (working day thresholds, blackout periods, etc.) |
| `src/lib/nz-holidays.ts` | NZ public holiday definitions |
| `src/lib/ledger-regenerator.ts` | Generates display-only ledger records |
| `src/hooks/useTenantStatus.ts` | React hook wrapping `calculateTenantStatus()` |
| `src/hooks/useTenantLedgerSync.ts` | Ledger sync hook |
| `src/components/dashboard/TenantCard.tsx` | Main tenant display component |
| `src/components/dashboard/StrikeBar.tsx` | Strike pill UI (SENT/ELIGIBLE/INACTIVE) |

## Data Flow

### Rendering a tenant
1. `page.tsx` fetches tenant settings + payments from Supabase
2. Calls `calculateTenantStatus(settings, payments, notices, remedyDate, region, testDate)`
3. Returns `TenantStatusResult` with balance, severity tier, strike eligibility, notice eligibility
4. `TenantCard` renders using returned values

### Recording a payment
1. Payment saved to Supabase
2. Component refetches payments
3. `calculateTenantStatus()` recalculates with new payment data
4. UI updates immediately (no ledger mutation needed)

### Settings change (rent amount, frequency, due day)
1. Current balance calculated from existing settings
2. Balance stored as new `openingArrears`
3. `trackingStartDate` resets to change date
4. Old payment records cleared
5. Ledger regenerated for display
6. UI shows correct carried-forward balance

### Test date override
1. `testDate` state updated in page
2. Passed to all `calculateTenantStatus()` calls
3. All date-dependent logic uses the override
4. UI shows simulated "future" state

## Severity Tiers (5-tier system)
| Tier | Name | Condition |
|------|------|-----------|
| 0 | GREEN | No arrears or in credit |
| 1 | AMBER | 1-4 working days overdue |
| 2 | GOLD | 5+ working days (strike eligible) |
| 3 | RED | 14+ calendar days (14-day notice eligible) |
| 4 | BREATHING RED | 21+ calendar days (termination eligible) |

## Strike System
- 3 strikes within a rolling 90-day window triggers termination eligibility
- Each pill in StrikeBar shows: SENT (issued), ELIGIBLE (can issue), INACTIVE (not yet eligible)
- 5 PM NZ time service cutoff rule applies
- Summer blackout: Dec 25 - Jan 15 (no notices can be served)

## Deleted in Session 6 (dead code)
- `src/lib/payment-date-math.ts` - replaced by `date-utils.ts` + `rent-calculator.ts`
- `src/lib/tenant-status-resolver.ts` - replaced by `status-calculator.ts`
- `src/lib/ledger-sync-utils.ts` - unused
- `src/hooks/useRentState.ts` - unused (superseded by `useTenantStatus.ts`)
- `tenantLegalStatuses` useMemo block in `page.tsx` - replaced by `tenantStatuses` using `calculateTenantStatus()`
- `strikeHistories` state + fetch effect in `page.tsx` - only consumer was removed block
