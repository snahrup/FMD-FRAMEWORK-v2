# AUDIT: RecordCounts.tsx (AUDIT-RC)

**Page**: `dashboard/app/src/pages/RecordCounts.tsx`
**Date**: 2026-03-23
**Auditor**: Steve Nahrup (automated)
**Verdict**: 8 issues found (1 truth bug, 2 error handling, 2 hardcoded colors, 3 accessibility). All fixed.

---

## 1. Truth Bugs

### T1: Match rate uses Math.round (can show false 100%)

**Severity**: Medium
**Line**: 443 (original)
**Issue**: `Math.round((matched / matchable.length) * 100)` rounds 99.5% up to 100%, showing a perfect match rate when mismatches exist. For accuracy metrics, always round down.
**Fix**: Changed to `Math.floor()` so the display never overstates match quality.

### No fabricated data, no Math.random, no Math.ceil tricks, no hardcoded counts.

The row count comparison logic (lines 316-384) is honest:
- Counts come from real lakehouse scan data keyed by `schema.table`
- Status derivation (match/mismatch/bronze-only/silver-only/pending) is correct
- Delta is `Math.abs(bronzeCount - silverCount)` -- correct
- Match rate denominator correctly excludes entities without both Bronze AND Silver counts

---

## 2. Dead Code

No dead code found. All imports (React hooks, Lucide icons, hooks, components) are used. The previously-reported `generateMockCounts()` and `isDemo` state have already been removed.

---

## 3. Error Handling

### E1: triggerScan swallows all errors silently

**Severity**: Medium
**Lines**: 298-303 (original)
**Issue**: The scan POST request had a bare `catch { /* ignore */ }` and no `res.ok` check. If the API fails or returns a non-OK status, the user sees nothing -- the "Scanning..." indicator just spins indefinitely.
**Fix**: Added `res.ok` check and catch block that both set `countsError` with a descriptive message and reset `scanning` to false.

### E2: Missing `resolveLabel` in useMemo dependency array

**Severity**: Low
**Line**: 426 (original)
**Issue**: `resolveLabel` is called inside the `displayed` useMemo filter callback (line 406) but not listed in the dependency array. If the source config ever re-resolved labels, the memoized result would be stale.
**Fix**: Added `resolveLabel` to the dependency array.

---

## 4. Hardcoded Hex Colors

### C1: `#94a3b8` used for "Unlinked" source fallback (2 occurrences)

**Severity**: Low
**Lines**: 182, 876 (original)
**Issue**: Hardcoded slate-400 hex instead of using the design system.
**Fix**: Changed both to `var(--bp-ink-muted)`.

---

## 5. Accessibility

### A1: Missing aria-labels on interactive controls

**Severity**: Medium
**Issue**: Zero `aria-label` or `role` attributes anywhere on the page.
**Fixes applied**:
- Search input: `aria-label="Search tables, schemas, or sources"`
- Filter select: `aria-label="Filter by match status"`
- Source card buttons: `aria-label="Filter by source: {name}"` + `aria-pressed`
- Data journey links: `aria-label="View data journey for {schema}.{table}"`

### A2: Sort headers not keyboard accessible

**Severity**: Medium
**Issue**: Table column headers with click-to-sort had no keyboard support (no `tabIndex`, no keydown handler).
**Fixes applied**:
- Added `tabIndex={0}` on sortable headers
- Added `onKeyDown` handler for Enter/Space to trigger sort
- Added `aria-sort="ascending"|"descending"` on the active sort column
- Added `aria-label="Sort by {column}"` on sortable headers
- Added `role="columnheader"` on sortable headers

---

## 6. Loading States

Loading states are properly handled:
- Initial load: Centered spinner with "Querying lakehouse SQL endpoints..." message (line 724-729)
- Reload button: Shows spinner icon when `countsLoading` is true (line 674)
- Scan in progress: Shows spinner + "Scanning..." text + progress info (line 677-685)

No issues found.

---

## 7. Empty States

Empty states are properly handled:
- No data loaded: Full empty state with icon + heading + instruction to scan (line 712-721)
- No search results: Table shows "No tables match your search or filter." (line 865-869)
- Error state: Red card with error message and details (line 702-710)

No issues found.

---

## 8. Cross-Layer Accuracy

The three-layer comparison is correctly implemented:
- LZ, Bronze, and Silver counts are fetched from the same API response
- Counts are keyed by `${schema}.${table}` (lowercased) for consistent matching across layers
- Entity metadata (source, load type, status) is joined via the same key from `useEntityDigest`
- The layer summary strip (lines 754-788) shows total rows per layer with a delta indicator
- The StrataBar component receives all three layer counts for visual comparison

No issues found.

---

## 9. Cross-Page Navigation

### Inbound
- Accepts `?search=` URL parameter to pre-populate the search field (line 263)

### Outbound
- Each row links to `/journey?table={table}&schema={schema}` via the Route icon (line 606-613)

Both directions are correctly implemented.

---

## Summary of Changes

| # | Category | Description | Lines affected |
|---|----------|-------------|----------------|
| T1 | Truth bug | Math.round -> Math.floor for match rate | 443 |
| E1 | Error handling | triggerScan: add res.ok check + error feedback | 298-312 |
| E2 | Error handling | Add resolveLabel to displayed useMemo deps | 426 |
| C1 | Design tokens | Replace #94a3b8 with var(--bp-ink-muted) | 182, 876 |
| A1 | Accessibility | aria-labels on search, filter, source cards, journey links | 5 locations |
| A2 | Accessibility | Keyboard support + ARIA on sortable table headers | 642-660 |
