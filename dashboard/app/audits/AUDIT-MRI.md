# AUDIT: MRI.tsx (Machine Regression Intelligence)

**File**: `dashboard/app/src/pages/MRI.tsx` (377 lines)
**Hook**: `dashboard/app/src/hooks/useMRI.ts` (385 lines)
**Components**: `dashboard/app/src/components/mri/*` (9 files)
**Audited**: 2026-03-23
**Previous audit**: 2026-03-13 (backend-missing assessment only)
**Verdict**: 14 findings — 11 fixed, 3 deferred

---

## Findings

### FIXED

#### F-01: Truth bug — CoverageHeatmap fabricates E2E coverage (CoverageHeatmap.tsx)
- **Severity**: CRITICAL
- `hasE2E` was hardcoded to `true` when creating coverage cells from visual diffs, making every visual test appear as an E2E test when it is not. Users would see an inflated coverage picture.
- **Fix**: Initialize `hasE2E: false` — E2E coverage is only set when an actual E2E data source provides it.

#### F-02: Hardcoded `#fff` color on badges (MRI.tsx)
- **Severity**: LOW
- Lines 163, 169: Scanning and Running badges used `color: '#fff'` instead of design tokens.
- **Fix**: Changed to `color: 'var(--bp-surface-1)'`.

#### F-03: Missing ARIA tab pattern (MRI.tsx)
- **Severity**: MEDIUM
- Tab bar had no `role="tablist"`, tab buttons had no `role="tab"` or `aria-selected`, tab panels had no `role="tabpanel"` or `aria-labelledby`.
- **Fix**: Added full WAI-ARIA tab pattern: `role="tablist"` on container, `role="tab"` + `aria-selected` + `aria-controls` + `id` on each tab button, `role="tabpanel"` + `id` + `aria-labelledby` on each panel (overview, visual, backend).

#### F-04: Missing progress indicator ARIA (MRI.tsx)
- **Severity**: LOW
- Scanning progress dots had no screen reader exposure.
- **Fix**: Added `role="progressbar"` with `aria-label`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`.

#### F-05: Dead state — `scanStartedAt` (useMRI.ts)
- **Severity**: LOW
- `scanStartedAt` state was set but never returned from the hook or read externally.
- **Fix**: Removed the state variable and all its setter calls.

#### F-06: Leaked polling interval in `triggerRun` (useMRI.ts)
- **Severity**: HIGH
- `triggerRun` created a local `poll` interval but stored it only in a local `const`. The 300s safety timeout referenced this local variable, but if `triggerRun` was called again, the old interval was orphaned — leaked forever.
- **Fix**: Added `scanPollRef` to store the polling interval in a ref, properly cleared on re-trigger and timeout.

#### F-07: Silent error swallowing in baseline actions (useMRI.ts)
- **Severity**: MEDIUM
- `acceptBaseline()` and `acceptAllBaselines()` had no try/catch — fetch failures were unhandled promises. Users would click "Accept" and see no feedback if it failed.
- **Fix**: Added try/catch with `setError()` and response status validation.

#### F-08: Dead code — unused Dialog in ScreenshotGallery (ScreenshotGallery.tsx)
- **Severity**: LOW
- `previewDiff` state and a full `Dialog` component were defined but `setPreviewDiff` was never called — the Dialog could never open. Also pulled in `useState`, `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle` imports unnecessarily.
- **Fix**: Removed `previewDiff` state, the Dialog JSX, and the unused imports.

#### F-09: Unused imports across components
- **Severity**: LOW
- `BaselineManager.tsx`: `XCircle` imported but unused.
- `BackendTestPanel.tsx`: `Clock` and `Zap` imported but unused.
- `CoverageHeatmap.tsx`: `Badge` imported but unused.
- **Fix**: Removed all unused imports.

#### F-10: Missing `scope="col"` on table headers (BackendTestPanel, BaselineManager, CrossBranchCompare)
- **Severity**: LOW
- All three table components had `<th>` elements without `scope` attribute, reducing screen reader usability.
- **Fix**: Added `scope="col"` to all column headers.

#### F-11: Missing aria-labels on interactive controls (ScreenshotGallery, VisualDiffViewer)
- **Severity**: LOW
- Screenshot gallery buttons had no `aria-label` (just an image + truncated text).
- VisualDiffViewer zoom buttons, opacity slider, and slider comparison container had no accessible labels.
- **Fix**: Added `aria-label` to all interactive controls.

### DEFERRED

#### D-01: VisualDiffViewer slider drag leaks to window (VisualDiffViewer.tsx)
- **Severity**: MEDIUM
- Slider drag uses `onMouseDown`/`onMouseUp`/`onMouseLeave` on the container element. If the user drags outside the container and releases, `isDragging` stays true until they re-enter and move. A proper implementation would attach `window`-level mouseup listeners during drag.
- **Reason deferred**: The component is functional for normal use; fixing this requires a useEffect cleanup pattern that changes the component's event model. Low user impact since MRI is a dev-only hidden page.

#### D-02: MRI components use shadcn semantic classes instead of `var(--bp-*)` tokens
- **Severity**: LOW
- All 9 sub-components use shadcn/Tailwind semantic classes (`text-destructive`, `text-success`, `bg-muted`, `border-border`, etc.) rather than the Blueprint `var(--bp-*)` design tokens. The parent MRI.tsx correctly uses BP tokens but the sub-components do not.
- **Reason deferred**: The shadcn classes are mapped to CSS custom properties in the theme and render correctly. A full migration to BP tokens would touch every component and is a design system consolidation task, not a bug fix.

#### D-03: All 13 MRI backend API endpoints return 404 (no backend implementation)
- **Severity**: KNOWN
- Previously documented in the 2026-03-13 audit. The frontend is complete but the backend does not exist. Error handling is graceful.
- **Reason deferred**: Backend implementation is a separate feature task.

---

## Files Changed

| File | Changes |
|------|---------|
| `dashboard/app/src/pages/MRI.tsx` | F-02, F-03, F-04 |
| `dashboard/app/src/hooks/useMRI.ts` | F-05, F-06, F-07 |
| `dashboard/app/src/components/mri/CoverageHeatmap.tsx` | F-01, F-09 |
| `dashboard/app/src/components/mri/ScreenshotGallery.tsx` | F-08, F-11 |
| `dashboard/app/src/components/mri/VisualDiffViewer.tsx` | F-11 |
| `dashboard/app/src/components/mri/BackendTestPanel.tsx` | F-09, F-10 |
| `dashboard/app/src/components/mri/BaselineManager.tsx` | F-09, F-10 |
| `dashboard/app/src/components/mri/CrossBranchCompare.tsx` | F-10 |

---

## Summary

14 findings total. 1 truth bug (fabricated E2E coverage), 1 high-severity leaked interval, 2 medium-severity error handling gaps, and 10 low-severity accessibility/dead-code issues — all fixed. 3 findings deferred (slider drag UX, design token migration, missing backend).
