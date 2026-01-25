# Button Contrast & Modal Guidelines

**Implementation Date**: 2026-01-24
**Purpose**: Ensure consistent, accessible button text contrast and replace browser alerts with in-app modals

---

## Problem Statement

### Issues Identified

1. **Browser Confirm Dialogs**: Using `window.confirm()` shows ugly "localhost says..." browser dialogs
2. **Button Text Contrast**: Colored buttons sometimes had dark text on dark backgrounds (poor readability)
3. **Inconsistent Styling**: Confirmation dialogs had varying button styles

---

## Solution: Button Contrast Rules + ConfirmationDialog

### Part 1: Button Text Contrast Rules

**Primary Rule**: **Colored backgrounds MUST have white text**

| Background Color | Text Color | Example |
|-----------------|------------|---------|
| Dark colors (black, red, blue, etc.) | `text-white` | Remove button (red bg) |
| Light colors (white, gray-50, etc.) | `text-nav-black` or `text-gray-600` | Cancel button |
| Green (success) | `text-white` | Save Changes button |
| Transparent/Outline | Inherit or dark text | Secondary actions |

---

### Part 2: ConfirmationDialog Component

**File**: [ConfirmationDialog.tsx](../src/components/dashboard/ConfirmationDialog.tsx)

**Purpose**: Reusable, styled confirmation dialog to replace `window.confirm()`

**Props**:
```typescript
interface ConfirmationDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: string;
    confirmText?: string; // Defaults to "Confirm"
    variant?: "default" | "destructive"; // Defaults to "default"
    onConfirm: () => void;
}
```

**Usage Example**:
```typescript
<ConfirmationDialog
    open={showDeleteConfirm}
    onOpenChange={setShowDeleteConfirm}
    title="Remove Tenant?"
    description="This will permanently delete John Smith and all associated rent records. This action cannot be undone."
    confirmText="Remove"
    variant="destructive"
    onConfirm={() => {
        onDelete(tenantId);
        setShowDeleteConfirm(false);
    }}
/>
```

---

## Implementation Details

### 1. ConfirmationDialog Component Updates

**File**: [ConfirmationDialog.tsx](../src/components/dashboard/ConfirmationDialog.tsx#L42-L50)

**Changes Made**:

#### Before (No White Text):
```tsx
<AlertDialogFooter>
    <AlertDialogCancel className="rounded-xl border-none hover:bg-slate-100">
        Cancel
    </AlertDialogCancel>
    <AlertDialogAction
        onClick={onConfirm}
        className={variant === "destructive"
            ? "bg-overdue-red hover:bg-overdue-red/90 rounded-xl font-black"
            : "bg-safe-green hover:bg-safe-green/90 rounded-xl font-black"}
    >
        {confirmText}
    </AlertDialogAction>
</AlertDialogFooter>
```

**Problems**:
- No `text-white` on colored buttons (red/green)
- Cancel button had no explicit text color
- Missing shadow for depth

---

#### After (Fixed Contrast):
```tsx
<AlertDialogFooter>
    <AlertDialogCancel className="rounded-xl border-none hover:bg-slate-100 text-nav-black font-bold">
        Cancel
    </AlertDialogCancel>
    <AlertDialogAction
        onClick={onConfirm}
        className={variant === "destructive"
            ? "bg-overdue-red hover:bg-overdue-red/90 text-white rounded-xl font-black shadow-lg"
            : "bg-safe-green hover:bg-safe-green/90 text-white rounded-xl font-black shadow-lg"}
    >
        {confirmText}
    </AlertDialogAction>
</AlertDialogFooter>
```

**Improvements**:
- ✅ Added `text-white` to colored buttons (red/green)
- ✅ Added `text-nav-black` to cancel button (explicit dark text)
- ✅ Added `font-bold` to cancel for consistency
- ✅ Added `shadow-lg` for depth

---

### 2. ManageTenantDialog Updates

**File**: [ManageTenantDialog.tsx](../src/components/dashboard/ManageTenantDialog.tsx)

**Changes Made**:

#### 1. Import ConfirmationDialog (Line 24):
```typescript
import { ConfirmationDialog } from "./ConfirmationDialog"
```

#### 2. Add State (Line 47):
```typescript
const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
```

#### 3. Replace window.confirm (Lines 213-226):

**Before**:
```typescript
<button
    onClick={() => {
        if (confirm(`Are you sure you want to remove ${tenant.name}?`)) {
            onDelete(tenant.id);
            onOpenChange(false);
        }
    }}
    className="flex items-center gap-2 text-rose-500 hover:text-rose-600 transition-colors group px-2"
>
    <div className="w-8 h-8 rounded-full bg-rose-50 flex items-center justify-center group-hover:bg-rose-100 transition-colors">
        <Trash2 className="w-4 h-4" />
    </div>
    <span className="text-xs font-bold uppercase tracking-wider">Remove Tenant</span>
</button>
```

**After**:
```typescript
<button
    onClick={() => setShowDeleteConfirm(true)}
    className="flex items-center gap-2 text-rose-500 hover:text-rose-600 transition-colors group px-2"
>
    <div className="w-8 h-8 rounded-full bg-rose-50 flex items-center justify-center group-hover:bg-rose-100 transition-colors">
        <Trash2 className="w-4 h-4" />
    </div>
    <span className="text-xs font-bold uppercase tracking-wider">Remove Tenant</span>
</button>
```

---

#### 4. Add ConfirmationDialog to Both Return Statements (Lines 233-264):

**Desktop (Dialog)**:
```typescript
if (isDesktop) {
    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-[480px] bg-white border-none shadow-2xl rounded-3xl p-8">
                    <DialogHeader className="mb-6">
                        <DialogTitle className="text-2xl font-black italic text-nav-black">
                            Manage {tenant.name}
                        </DialogTitle>
                    </DialogHeader>
                    {content}
                </DialogContent>
            </Dialog>

            <ConfirmationDialog
                open={showDeleteConfirm}
                onOpenChange={setShowDeleteConfirm}
                title="Remove Tenant?"
                description={`This will permanently delete ${tenant.name} and all associated rent records. This action cannot be undone.`}
                confirmText="Remove"
                variant="destructive"
                onConfirm={() => {
                    onDelete(tenant.id);
                    setShowDeleteConfirm(false);
                    onOpenChange(false);
                }}
            />
        </>
    );
}
```

**Mobile (Sheet)**:
```typescript
return (
    <>
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="bottom" className="bg-white rounded-t-[32px] p-8 border-none outline-none ring-0 focus:ring-0">
                <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-8" />
                <SheetHeader className="mb-6">
                    <SheetTitle className="text-2xl font-black italic text-nav-black text-left">
                        Manage {tenant.name}
                    </SheetTitle>
                </SheetHeader>
                {content}
            </SheetContent>
        </Sheet>

        <ConfirmationDialog
            open={showDeleteConfirm}
            onOpenChange={setShowDeleteConfirm}
            title="Remove Tenant?"
            description={`This will permanently delete ${tenant.name} and all associated rent records. This action cannot be undone.`}
            confirmText="Remove"
            variant="destructive"
            onConfirm={() => {
                onDelete(tenant.id);
                setShowDeleteConfirm(false);
                onOpenChange(false);
            }}
        />
    </>
);
```

---

## Button Contrast Audit Results

### ✅ Components with Correct Contrast

| Component | Button | Background | Text Color | Status |
|-----------|--------|------------|------------|--------|
| **button.tsx** | `brand` variant | `bg-nav-black` | `text-white` | ✅ Correct |
| **button.tsx** | `destructive` variant | `bg-destructive` | `text-white` | ✅ Correct |
| **button.tsx** | `brand-secondary` variant | `bg-white` | `text-gray-600` | ✅ Correct |
| **button.tsx** | `brand-success` variant | `bg-white` | `text-safe-green` | ✅ Correct |
| **ConfirmationDialog.tsx** | Confirm button (destructive) | `bg-overdue-red` | `text-white` | ✅ Fixed |
| **ConfirmationDialog.tsx** | Confirm button (default) | `bg-safe-green` | `text-white` | ✅ Fixed |
| **ConfirmationDialog.tsx** | Cancel button | `bg-white` | `text-nav-black` | ✅ Fixed |
| **UpcomingObligations.tsx** | Obligation button | `bg-red-600/bg-nav-black/bg-amber-500` | `text-white` | ✅ Correct |
| **TenantCard.tsx** | Settlement button | `border-emerald-600` | `text-emerald-700` | ✅ Correct |

---

## Kiwi-Friendly Confirmation Patterns

### Pattern 1: Destructive Action (Delete/Remove)

```typescript
<ConfirmationDialog
    open={showConfirm}
    onOpenChange={setShowConfirm}
    title="Remove Tenant?"
    description="This will permanently delete [Name] and all associated records. This action cannot be undone."
    confirmText="Remove"
    variant="destructive"
    onConfirm={handleDelete}
/>
```

**Visual**:
```
┌────────────────────────────────────────┐
│ Remove Tenant?                         │
│                                        │
│ This will permanently delete John      │
│ Smith and all associated rent records. │
│ This action cannot be undone.          │
│                                        │
│  [Cancel]    [Remove]                  │
│  (Gray)      (Red/White)               │
└────────────────────────────────────────┘
```

---

### Pattern 2: Confirmation Action (Save/Update)

```typescript
<ConfirmationDialog
    open={showConfirm}
    onOpenChange={setShowConfirm}
    title="Save Changes?"
    description="Are you sure you want to update the rent amount for this tenant?"
    confirmText="Save"
    variant="default"
    onConfirm={handleSave}
/>
```

**Visual**:
```
┌────────────────────────────────────────┐
│ Save Changes?                          │
│                                        │
│ Are you sure you want to update the    │
│ rent amount for this tenant?           │
│                                        │
│  [Cancel]    [Save]                    │
│  (Gray)      (Green/White)             │
└────────────────────────────────────────┘
```

---

## CSS/Tailwind Classes Reference

### Primary/Action Buttons (Colored Backgrounds)

**Must include `text-white`**:

```tsx
// Destructive (Red)
className="bg-overdue-red hover:bg-overdue-red/90 text-white rounded-xl font-black shadow-lg"

// Success (Green)
className="bg-safe-green hover:bg-safe-green/90 text-white rounded-xl font-black shadow-lg"

// Primary (Black)
className="bg-nav-black hover:bg-black text-white rounded-xl font-black shadow-lg"

// Brand Variant (from button.tsx)
variant="brand" // Automatically includes text-white
```

---

### Secondary/Cancel Buttons (Light Backgrounds)

**Must include dark text color**:

```tsx
// Cancel (White/Light)
className="rounded-xl border-none hover:bg-slate-100 text-nav-black font-bold"

// Brand Secondary (from button.tsx)
variant="brand-secondary" // Automatically includes text-gray-600

// Outline
variant="outline" // Uses default dark text
```

---

## Testing Checklist

### Visual Contrast
- [ ] Destructive buttons (red) have white text
- [ ] Success buttons (green) have white text
- [ ] Primary buttons (black) have white text
- [ ] Cancel buttons (white/light) have dark text
- [ ] All buttons are readable in both light and dark mode (if applicable)

### Functionality
- [ ] Confirmation dialog opens when delete is clicked
- [ ] Cancel button closes dialog without action
- [ ] Confirm button executes action and closes dialog
- [ ] Dialog dismisses when clicking outside (if enabled)
- [ ] Dialog works on both desktop (Dialog) and mobile (Sheet)

### Accessibility
- [ ] Buttons have sufficient contrast ratio (4.5:1 minimum)
- [ ] Focus states are visible
- [ ] Keyboard navigation works (Tab, Enter, Escape)
- [ ] Screen readers announce button purpose correctly

---

## Migration Guide

### Replacing window.confirm()

**Step 1**: Import ConfirmationDialog
```typescript
import { ConfirmationDialog } from "./ConfirmationDialog"
```

**Step 2**: Add state
```typescript
const [showConfirm, setShowConfirm] = useState(false);
```

**Step 3**: Replace window.confirm
```typescript
// OLD:
if (confirm("Are you sure?")) {
    handleAction();
}

// NEW:
onClick={() => setShowConfirm(true)}
```

**Step 4**: Add ConfirmationDialog component
```typescript
<ConfirmationDialog
    open={showConfirm}
    onOpenChange={setShowConfirm}
    title="Confirm Action?"
    description="Detailed description of what will happen."
    confirmText="Confirm"
    variant="default" // or "destructive"
    onConfirm={() => {
        handleAction();
        setShowConfirm(false);
    }}
/>
```

---

## Files Changed

| File | Changes |
|------|---------|
| [ConfirmationDialog.tsx](../src/components/dashboard/ConfirmationDialog.tsx) | Added `text-white` to colored buttons, `text-nav-black` to cancel, `shadow-lg` |
| [ManageTenantDialog.tsx](../src/components/dashboard/ManageTenantDialog.tsx) | Replaced `window.confirm()` with ConfirmationDialog |

---

## Summary

**Before**:
- ❌ Browser confirm dialogs ("localhost says...")
- ❌ Inconsistent button text colors
- ❌ Poor readability on colored buttons

**After**:
- ✅ Clean, in-app confirmation modals
- ✅ All colored buttons have white text
- ✅ All light buttons have dark text
- ✅ Consistent shadow and styling
- ✅ Kiwi-friendly, professional UX

**Result**: Accessible, readable, professional confirmation dialogs! 🎉
