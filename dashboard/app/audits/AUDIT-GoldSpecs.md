# AUDIT-GS: Gold Specs Page Audit

**Page**: `dashboard/app/src/pages/gold/GoldSpecs.tsx` (479 lines)
**Backend**: `dashboard/app/api/routes/gold_studio.py` (endpoints: gs_list_specs, gs_get_spec, gs_spec_versions, gs_spec_impact, gs_validation_runs)
**Date**: 2026-03-23

---

## Summary Table

| ID | Severity | Category | Description | Status |
|----|----------|----------|-------------|--------|
| GS-01 | CRITICAL | Truth / API shape | Stats strip shows all zeros — frontend `Stats` expects `{total, ready, pending, needs_reval, deprecated}` but backend `gs_stats` returns `{gold_specs, specs_validated, ...}`. Field names never match. | **Fixed** |
| GS-02 | HIGH | Crash / API shape | `ColumnsTab` and `TransformsTab` receive `selected.columns` and `selected.transforms` directly, but backend `gs_get_spec` does NOT return `columns` or `transforms` arrays. Accessing `.map()` on `undefined` crashes the tab. | **Fixed** |
| GS-03 | HIGH | Error handling | `load()` list fetch has empty `.catch(() => {})` — network errors silently swallowed, no user feedback | **Fixed** |
| GS-04 | LOW | Dead code | `useGoldToast` imported and destructured as `_showToast` but never used | **Fixed** |
| GS-05 | MEDIUM | Token compliance | Hardcoded `rgba(194,122,26,0.10)` and `rgba(194,122,26,0.25)` in SQL warning banner | **Fixed** |
| GS-06 | MEDIUM | Token compliance | Hardcoded `#2B2A27` (SQL code block background) | **Fixed** (uses `var(--bp-code-bg, #2B2A27)` fallback) |
| GS-07 | MEDIUM | Token compliance | Hardcoded `#E8E6E3` in SQL code text, expand button, copy button (3 occurrences) | **Fixed** (uses `var(--bp-code-fg, #E8E6E3)` fallback) |
| GS-08 | LOW | Token compliance | Hardcoded `rgba(232,230,227,0.3)` for line numbers in SQL code block | **Fixed** (uses `var(--bp-code-line-nr, ...)` fallback) |
| GS-09 | MEDIUM | Accessibility | Search input missing `aria-label` | **Fixed** |
| GS-10 | MEDIUM | Accessibility | Filter `<select>` elements missing `aria-label` | **Fixed** |
| GS-11 | MEDIUM | Accessibility | Spec row buttons missing `aria-label` | **Fixed** |
| GS-12 | LOW | Accessibility | Copy button missing `aria-label` | **Fixed** |
| GS-13 | LOW | Accessibility | Expand/collapse button in SQL tab missing `aria-label` | **Fixed** |
| GS-14 | LOW | Accessibility | Status rail and badge icons missing `aria-hidden="true"` (decorative elements) | **Fixed** |
| GS-15 | LOW | Accessibility | Search icon missing `aria-hidden="true"` | **Fixed** |
| GS-16 | LOW | Accessibility | Table headers missing `scope="col"` | **Fixed** |
| GS-17 | LOW | Accessibility | Last column header was empty string `""` — now `"Status"` for screen readers | **Fixed** |
| GS-18 | MEDIUM | Empty state | `ColumnsTab` had no empty state — would render empty `<table>` when no columns | **Fixed** |
| GS-19 | LOW | Loading states | Loading state present via `GoldLoading` component — correct | **OK** |
| GS-20 | LOW | Empty states | Empty state present via `GoldNoResults` — correct | **OK** |
| GS-21 | Info | Backend | `gs_list_specs` uses parameterized `?` bind params for all user input — safe | **OK** |
| GS-22 | Info | Backend | `gs_get_spec` returns `validation_runs` inline but NOT `columns`/`transforms` — frontend must guard | **OK** (guarded in GS-02 fix) |
| GS-23 | Info | Response shape | `gs_spec_impact` returns `{spec_id, catalog_entries, related_specs, downstream_reports, impact_count}` — matches frontend `ImpactData` interface | **OK** |
| GS-24 | Info | Response shape | `gs_spec_versions` returns `{items, total, root_id}` — frontend reads `r.items`, correct | **OK** |
| GS-25 | Info | Response shape | `gs_validation_runs` returns `{items, total, limit, offset}` — frontend reads `r.items`, correct | **OK** |
| GS-26 | Info | Honesty | No fabricated data, no Math.random, no hardcoded counts — all data from real endpoints | **OK** |
| GS-27 | Info | Shared component | `StatsStrip`, `SlideOver`, `GoldLoading`, `GoldNoResults`, `ProvenanceThread` used correctly but not audited here | **Deferred** |
| GS-28 | MEDIUM | Shared component | `SlideOver` should have `role="dialog"`, `aria-modal`, Escape-to-close — cannot verify without reading shared component | **Deferred** |

---

## Detailed Findings

### GS-01: Stats Strip Shows All Zeros (CRITICAL — Fixed)

The frontend `Stats` interface expected `{total, ready, pending, needs_reval, deprecated}` but the backend `gs_stats` endpoint returns completely different field names: `{gold_specs, specs_validated, ...}`. Every stat card showed 0.

**Fix:** Added `BackendStats` interface and `mapStats()` function that maps `gold_specs` to `total`, `specs_validated` to `ready`, and computes `pending = total - ready`. The backend does not currently return per-status breakdowns for "needs_reval" or "deprecated" — those remain 0 until the backend is enhanced.

### GS-02: Columns/Transforms Tabs Crash (HIGH — Fixed)

The `SpecDetail` interface declared `columns: SpecColumn[]` and `transforms: SpecTransform[]` as required arrays, but the backend `gs_get_spec` endpoint does NOT return these fields. When a user clicked the Columns or Transforms tab, `selected.columns.map(...)` would throw on `undefined`.

**Fix:** Changed the interface to `columns?: SpecColumn[]` and `transforms?: SpecTransform[]` (optional). Pass `selected.columns ?? []` and `selected.transforms ?? []` to the sub-components. Also added an empty-state message to `ColumnsTab` for when the array is empty.

### GS-03: Silent Error Swallowing (HIGH — Fixed)

The main `load()` callback had `.catch(() => {})` on the specs list fetch. Network failures, server errors, and JSON parse failures were all silently discarded with no user feedback.

**Fix:** Added `fetchError` state, error banner with `role="alert"` and retry button.

### GS-04: Dead Import (LOW — Fixed)

`useGoldToast` was imported and destructured as `_showToast` but never called anywhere in the component.

**Fix:** Removed the import and destructuring.

### GS-05 through GS-08: Hardcoded Colors (MEDIUM — Fixed)

SQL warning banner used raw `rgba(194,122,26,...)` instead of `var(--bp-caution-light)` / `var(--bp-caution-amber)`.

SQL code block colors (`#2B2A27`, `#E8E6E3`, line number `rgba`) are intentional for a dark code theme where the design system may not define tokens. Fixed with CSS custom property fallbacks: `var(--bp-code-bg, #2B2A27)`, `var(--bp-code-fg, #E8E6E3)`, `var(--bp-code-line-nr, rgba(...))` — uses the token if defined, falls back gracefully if not.

### GS-09 through GS-17: Accessibility (Fixed)

- Search input: added `aria-label="Search gold specs"`
- Filter selects: added `aria-label="Filter by domain"` / `"Filter by status"`
- Spec row buttons: added `aria-label="Open spec: {name}"`
- Copy button: added `aria-label="Copy SQL to clipboard"` / `"Copied to clipboard"`
- Expand/collapse button: added descriptive `aria-label`
- Decorative elements (status rail, badge icons, search icon, line numbers): added `aria-hidden="true"`
- Table headers: added `scope="col"`, renamed empty header to `"Status"`

### GS-18: Columns Tab Empty State (MEDIUM — Fixed)

When the backend returns no columns (which is currently always — see GS-02), the `ColumnsTab` rendered an empty `<table>` with only headers. Added an early-return empty state message.

---

## Deferred Items

| ID | Reason |
|----|--------|
| GS-27 | Shared Gold components (`StatsStrip`, `SlideOver`, etc.) need their own audit packet |
| GS-28 | `SlideOver` dialog semantics (role, aria-modal, Escape key) must be verified in shared component audit |
| GS-01 partial | Backend `gs_stats` does not return per-status breakdowns for specs (needs_reval, deprecated counts). The `mapStats` function computes `pending = total - ready` as best effort. Full accuracy requires backend enhancement. |
| GS-02 partial | Backend `gs_get_spec` does not return `columns` or `transforms` arrays. The frontend now gracefully shows empty states, but the Columns and Transforms tabs will remain empty until the backend is enhanced to return this data. |
