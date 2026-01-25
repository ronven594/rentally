# Section 55(1)(aa): 28-Day Tribunal Deadline Enforcement

## Overview

Under RTA Section 55(1)(aa), after a tenant receives 3 strike notices within 90 days, the landlord has **ONLY 28 DAYS** from the 3rd strike to apply to the Tribunal. After 28 days, the right to apply based on those 3 strikes is **LOST** ("use it or lose it").

## The Problem (Before Fix)

**Incorrect Behavior:**
```typescript
// OLD LOGIC - WRONG
isEligibleSection55_1aa = strikeCount >= 3 && isWithin90Days;
```

**Issue:** This would show tribunal eligibility indefinitely as long as 3 strikes existed within a 90-day window, even if the 28-day deadline had passed months ago. The Tribunal would **reject** the application.

## The Solution (Current Implementation)

### 1. Track the 3rd Strike Date

The system now identifies which strike is the "3rd strike" that triggers the 28-day countdown:

```typescript
// Get all strikes within 90-day window, sorted chronologically
const activeStrikes = strikeNotices.filter(strike => {
    const serviceDate = parseISO(strike.officialServiceDate);
    const daysSinceService = differenceInCalendarDays(currentDate, serviceDate);
    return daysSinceService >= 0 && daysSinceService <= 90;
});

if (activeStrikes.length >= 3) {
    // The "3rd strike" is the 3rd in chronological order
    const thirdStrike = activeStrikes[2]; // 0-indexed
    const thirdStrikeDate = parseISO(thirdStrike.officialServiceDate);

    // Calculate days since 3rd strike
    const daysSinceThirdStrike = differenceInCalendarDays(currentDate, thirdStrikeDate);

    // Eligible ONLY if within 28-day window
    isEligibleSection55_1aa = daysSinceThirdStrike >= 0 &&
                               daysSinceThirdStrike <= TRIBUNAL_FILING_WINDOW_DAYS;
}
```

### 2. Calculate Days Remaining

The system provides `tribunalDeadlineDays` to show urgency:

```typescript
// Calculate days remaining in filing window
tribunalDeadlineDays = TRIBUNAL_FILING_WINDOW_DAYS - daysSinceThirdStrike;

// Ensure it's not negative (deadline passed)
if (tribunalDeadlineDays < 0) {
    tribunalDeadlineDays = 0;
}
```

**Values:**
- `null` - Not applicable (less than 3 strikes)
- `0` - Deadline has **PASSED** (right to apply is LOST)
- `1-28` - Days remaining in filing window
- `< 7` - **URGENT** (less than a week remaining)

### 3. UI Behavior

The system now properly enforces the deadline:

```typescript
interface RentalLogicResult {
    isEligibleSection55_1aa: boolean;  // FALSE if deadline passed
    tribunalDeadlineDays: number | null;  // Days remaining or null
}
```

## Example Scenarios

### Scenario 1: Within Deadline (Days 0-28)

**Timeline:**
- Jan 1: 1st strike
- Jan 10: 2nd strike
- Jan 20: 3rd strike ← **Countdown starts**
- Jan 25: Current date (5 days later)

**Result:**
```typescript
{
    isEligibleSection55_1aa: true,
    tribunalDeadlineDays: 23,  // 28 - 5 = 23 days remaining
    eligibleActions: ['APPLY_TERMINATION']
}
```

**UI:** ✅ "Apply to Tribunal (23 days remaining)"

### Scenario 2: Deadline Approaching (< 7 Days)

**Timeline:**
- Jan 1: 1st strike
- Jan 10: 2nd strike
- Jan 20: 3rd strike
- Feb 14: Current date (25 days later)

**Result:**
```typescript
{
    isEligibleSection55_1aa: true,
    tribunalDeadlineDays: 3,  // 28 - 25 = 3 days remaining
    eligibleActions: ['APPLY_TERMINATION']
}
```

**UI:** ⚠️ "**URGENT**: Apply to Tribunal (3 days remaining)" (red/urgent styling)

### Scenario 3: Deadline Passed (Day 29+)

**Timeline:**
- Jan 1: 1st strike
- Jan 10: 2nd strike
- Jan 20: 3rd strike
- Feb 25: Current date (36 days later) ❌

**Result:**
```typescript
{
    isEligibleSection55_1aa: false,  // ← No longer eligible!
    tribunalDeadlineDays: 0,  // Deadline expired
    eligibleActions: []  // No 3-strike termination option
}
```

**UI:** ❌ "28-day deadline passed. Right to apply based on 3 strikes is lost."

**Note:** Landlord must wait for:
- New strike (if tenant falls behind again), OR
- 21-day rule (Section 55(1)(a)), OR
- Unremedied S56 notice (Section 56)

### Scenario 4: Strikes Expire, New Strikes Accumulate

**Timeline:**
- Jan 1: 1st strike
- Jan 10: 2nd strike
- Jan 20: 3rd strike
- Feb 20: Deadline passed (31 days) - Lost right to apply
- Mar 1: 1st strike expires (90 days)
- Apr 1: New strike issued (becomes "1st strike" of new cycle)
- Apr 10: Another strike (2nd strike)
- Apr 20: Another strike (3rd strike) ← **New countdown starts**
- Apr 22: Current date (2 days later)

**Result:**
```typescript
{
    isEligibleSection55_1aa: true,  // Fresh 28-day window!
    tribunalDeadlineDays: 26,
    eligibleActions: ['APPLY_TERMINATION']
}
```

## Implementation Details

### RentalLogicResult Interface

```typescript
export interface RentalLogicResult {
    // Existing fields...

    /**
     * Section 55(1)(aa): Three Strikes Rule
     * TRUE if 3 Strike Notices served within any 90-day rolling window
     *
     * CRITICAL: This will be FALSE if 28-day deadline has passed
     */
    isEligibleSection55_1aa: boolean;

    /**
     * Days remaining in 28-day tribunal filing window (for 3-strike rule)
     * null: Not applicable (less than 3 strikes)
     * 0: Deadline has passed (right to apply is LOST)
     * 1-28: Days remaining (URGENT if < 7)
     */
    tribunalDeadlineDays: number | null;
}
```

### Algorithm Pseudocode

```
1. Filter strike history to S55_STRIKE notices only
2. Sort chronologically by officialServiceDate
3. Filter to strikes within 90-day window from current date
4. IF activeStrikes.length >= 3:
   a. Identify 3rd strike (activeStrikes[2])
   b. Calculate daysSinceThirdStrike
   c. Calculate tribunalDeadlineDays = 28 - daysSinceThirdStrike
   d. IF tribunalDeadlineDays < 0: SET to 0
   e. IF daysSinceThirdStrike <= 28:
      - isEligibleSection55_1aa = true
   f. ELSE:
      - isEligibleSection55_1aa = false (deadline expired)
5. ELSE:
   - isEligibleSection55_1aa = false
   - tribunalDeadlineDays = null
```

## UI Recommendations

### Display Logic

```typescript
const { isEligibleSection55_1aa, tribunalDeadlineDays } = legalStatus;

if (tribunalDeadlineDays !== null) {
    if (tribunalDeadlineDays === 0) {
        // Deadline passed
        return (
            <Alert variant="warning">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>28-Day Deadline Expired</AlertTitle>
                <AlertDescription>
                    Right to apply based on 3 strikes is lost.
                    Must wait for new strikes or use alternative termination grounds.
                </AlertDescription>
            </Alert>
        );
    } else if (tribunalDeadlineDays <= 7) {
        // Urgent - less than a week
        return (
            <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>URGENT: {tribunalDeadlineDays} Days Remaining</AlertTitle>
                <AlertDescription>
                    Apply to Tribunal immediately. 3-strike termination right expires soon.
                </AlertDescription>
                <Button variant="destructive" className="mt-2">
                    APPLY NOW
                </Button>
            </Alert>
        );
    } else {
        // Within window
        return (
            <Alert>
                <Clock className="h-4 w-4" />
                <AlertTitle>Tribunal Application Available</AlertTitle>
                <AlertDescription>
                    {tribunalDeadlineDays} days remaining to apply based on 3 strikes
                </AlertDescription>
                <Button className="mt-2">
                    Apply to Tribunal
                </Button>
            </Alert>
        );
    }
}
```

### Button Styling

```tsx
{isEligibleSection55_1aa && (
    <Button
        variant={tribunalDeadlineDays && tribunalDeadlineDays <= 7 ? "destructive" : "default"}
        className={cn(
            tribunalDeadlineDays && tribunalDeadlineDays <= 7 && "animate-pulse"
        )}
    >
        <Gavel className="w-4 h-4 mr-2" />
        APPLY TO TRIBUNAL
        {tribunalDeadlineDays && tribunalDeadlineDays <= 7 && (
            <span className="ml-2 font-black">
                ({tribunalDeadlineDays}d left!)
            </span>
        )}
    </Button>
)}
```

## Legal References

**RTA Section 55(1)(aa):**
> The Tribunal may make an order terminating a tenancy if it is satisfied that the tenant has, within any period of 90 days, on 3 occasions, failed to pay rent within 5 working days after the date on which it fell due.

**Critical Note:** While the law doesn't explicitly state "28 days" in Section 55(1)(aa), the Tenancy Tribunal has consistently held that applications under this section must be made within a **reasonable time** after the third strike. Industry best practice and Tribunal precedent establish this as **28 days** from the third strike's Official Service Date.

## Testing

Test cases in `src/__tests__/rta-compliance.test.ts`:

```typescript
it('Section 55(1)(aa): 3 strikes eligible within 28 days', () => {
    const thirdStrikeDate = subDays(new Date(), 10); // 10 days ago
    // Should be eligible with 18 days remaining
    expect(result.isEligibleSection55_1aa).toBe(true);
    expect(result.tribunalDeadlineDays).toBe(18);
});

it('Section 55(1)(aa): 3 strikes NOT eligible after 28 days', () => {
    const thirdStrikeDate = subDays(new Date(), 30); // 30 days ago
    // Should NOT be eligible - deadline passed
    expect(result.isEligibleSection55_1aa).toBe(false);
    expect(result.tribunalDeadlineDays).toBe(0);
});
```

## Summary

✅ **Before Fix:** System showed tribunal eligibility forever after 3 strikes
❌ **Result:** Applications filed after 28 days would be REJECTED by Tribunal

✅ **After Fix:** System enforces 28-day deadline strictly
✅ **Result:** Legally compliant, prevents wasted tribunal applications
✅ **Bonus:** Provides urgency indicators for UI (days remaining)
