# Critical Timezone Fix: 5 PM Rule (RTA Section 136)

## The Bug (CRITICAL LEGAL COMPLIANCE ISSUE)

**Discovered:** 2026-01-24

### Problem
The `calculateOfficialServiceDate()` and `calculateServiceDate()` functions were using **server timezone** instead of **NZ timezone** when checking the 5 PM cutoff for notice service dates.

This could **invalidate legal notices** if challenged in the Tenancy Tribunal.

### Real-World Failure Scenario

**Setup:**
- Server: Deployed on AWS (UTC timezone)
- User: Auckland landlord
- Timestamp: `2026-01-19T05:00:00Z` (5 AM UTC)

**User's Intent:**
- Sent notice at **6:00 PM NZDT** (UTC+13 during daylight saving)
- Expected: Notice served **next working day** (because sent after 5 PM NZ time)

**Old Code Behavior (WRONG):**
```typescript
const sentDate = parseISO('2026-01-19T05:00:00Z');
const sentHour = sentDate.getHours(); // Returns 5 (UTC hour!)

if (sentHour < 17) { // 5 < 17 = true
    // WRONG: Served same day
    // Should be: Next working day because it was 6 PM in NZ
}
```

**Legal Impact:**
- Notice served "same day" according to system
- Actual legal requirement: "next working day" (sent after 5 PM NZ time)
- **Tribunal could invalidate the notice** for incorrect service date calculation

---

## The Fix

### Changes Made

1. **Installed `date-fns-tz`**
   ```bash
   npm install date-fns-tz
   ```

2. **Added NZ timezone constant**
   ```typescript
   const NZ_TIMEZONE = "Pacific/Auckland"; // IANA timezone
   ```

3. **Fixed `calculateOfficialServiceDate()` (string-based)**
   ```typescript
   export function calculateOfficialServiceDate(sentTimestamp: string, region?: NZRegion): string {
       const sentDateUTC = parseISO(sentTimestamp);

       // CRITICAL: Convert to NZ timezone BEFORE checking hour
       const sentDateNZ = toZonedTime(sentDateUTC, NZ_TIMEZONE);
       const sentHourNZ = sentDateNZ.getHours(); // Now gets NZ hour!

       if (sentHourNZ < EMAIL_CUTOFF_HOUR) { // Check against NZ time
           candidateDate = startOfDay(sentDateNZ);
       } else {
           candidateDate = addDays(startOfDay(sentDateNZ), 1);
       }
       // ...
   }
   ```

4. **Fixed `calculateServiceDate()` (Date-based)**
   ```typescript
   export function calculateServiceDate(sentAt: Date, region?: NZRegion): Date {
       // CRITICAL: Convert to NZ timezone BEFORE checking hour
       const sentDateNZ = toZonedTime(sentAt, NZ_TIMEZONE);
       const sentHourNZ = sentDateNZ.getHours(); // Now gets NZ hour!

       if (sentHourNZ >= 17) { // Check against NZ time
           return getNextWorkingDay(addDays(sentDate, 1), region);
       }
       // ...
   }
   ```

---

## Test Cases

### Edge Case 1: UTC Server, NZ Evening Send

**Scenario:**
- Server timezone: UTC
- User sends: 6:00 PM NZDT (January 19, 2026)
- UTC equivalent: 5:00 AM UTC (same day)

**Input:**
```typescript
calculateOfficialServiceDate('2026-01-19T05:00:00Z', 'Auckland')
```

**Expected (CORRECT):**
- Sent hour in NZ: **18** (6 PM)
- 18 >= 17 → **next working day**
- OSD: `2026-01-20` (Tuesday)

**Old Behavior (WRONG):**
- Sent hour in UTC: **5** (5 AM)
- 5 < 17 → same day
- OSD: `2026-01-19` ❌ **INCORRECT**

---

### Edge Case 2: UTC Server, NZ Afternoon Send

**Scenario:**
- Server timezone: UTC
- User sends: 4:00 PM NZDT (January 19, 2026)
- UTC equivalent: 3:00 AM UTC (same day)

**Input:**
```typescript
calculateOfficialServiceDate('2026-01-19T03:00:00Z', 'Auckland')
```

**Expected (CORRECT):**
- Sent hour in NZ: **16** (4 PM)
- 16 < 17 → **same day**
- OSD: `2026-01-19` (Monday)

**Old Behavior (WRONG):**
- Sent hour in UTC: **3** (3 AM)
- 3 < 17 → same day
- OSD: `2026-01-19` ✅ **Coincidentally correct** (but wrong logic!)

---

### Edge Case 3: Daylight Saving Transition

**Scenario:**
- NZ transitions to/from daylight saving
- UTC offset changes from UTC+12 to UTC+13 (or vice versa)

**Why This Matters:**
- `toZonedTime()` correctly handles DST transitions
- Old code would get the wrong hour during transition periods

---

## Verification

### Manual Test

```typescript
// Test in browser console or Node.js
import { parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

// Scenario: 6 PM NZDT sent from UTC server
const utcTime = parseISO('2026-01-19T05:00:00Z');
const nzTime = toZonedTime(utcTime, 'Pacific/Auckland');

console.log('UTC hour:', utcTime.getHours());     // 5
console.log('NZ hour:', nzTime.getHours());       // 18 ✓ CORRECT
console.log('Should serve next day:', nzTime.getHours() >= 17); // true ✓
```

### Integration Test

```typescript
import { calculateOfficialServiceDate } from '@/lib/legal-engine';

// Test 1: Evening send (after 5 PM NZ)
const osd1 = calculateOfficialServiceDate('2026-01-19T05:00:00Z', 'Auckland');
expect(osd1).toBe('2026-01-20'); // Next working day

// Test 2: Afternoon send (before 5 PM NZ)
const osd2 = calculateOfficialServiceDate('2026-01-19T03:00:00Z', 'Auckland');
expect(osd2).toBe('2026-01-19'); // Same day

// Test 3: Weekend send (Sunday 2 PM NZ)
const osd3 = calculateOfficialServiceDate('2026-01-18T01:00:00Z', 'Auckland');
expect(osd3).toBe('2026-01-19'); // Next working day (Monday)
```

---

## Legal References

**RTA Section 136 - Service of Documents:**
> A document may be served by email if the recipient consents. Service is deemed to occur on the date the email is sent, **provided it is sent before 5:00 PM on a working day**.

**Key Points:**
1. The 5:00 PM cutoff refers to **NZ local time**, not server time
2. Working days are determined by **NZ public holidays**, not server location holidays
3. The summer blackout period (Dec 25 - Jan 15) is based on **NZ calendar dates**

---

## Deployment Checklist

- [x] Install `date-fns-tz` dependency
- [x] Update `calculateOfficialServiceDate()` to use NZ timezone
- [x] Update `calculateServiceDate()` to use NZ timezone
- [x] Add NZ_TIMEZONE constant
- [x] Update function documentation with timezone warnings
- [x] Add timezone test cases
- [ ] Deploy to production
- [ ] Monitor for timezone-related issues in logs

---

## Related Files

- **Fixed:** `src/lib/legal-engine.ts`
  - `calculateOfficialServiceDate()` (string-based)
  - `calculateServiceDate()` (Date-based)

- **Constants:**
  - `NZ_TIMEZONE = "Pacific/Auckland"`
  - `EMAIL_CUTOFF_HOUR = 17`

- **Dependencies:**
  - `date-fns-tz` (newly added)

---

## Summary

| Aspect | Before Fix | After Fix |
|--------|------------|-----------|
| Hour source | Server timezone (UTC) | NZ timezone (Pacific/Auckland) |
| Legal compliance | ❌ Invalid for UTC servers | ✅ RTA-compliant |
| DST handling | ❌ Broken during transitions | ✅ Automatic via IANA timezone |
| Tribunal risk | High (invalid service dates) | Low (correct calculations) |

**Impact:** This fix ensures all notice service dates are calculated correctly according to NZ law, regardless of where the server is deployed.
