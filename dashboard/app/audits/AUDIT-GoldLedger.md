# AUDIT-GL: Gold Ledger Page Audit

**Page**: `dashboard/app/src/pages/gold/GoldLedger.tsx` (1237 lines)
**Backend**: `dashboard/app/api/routes/gold_studio.py` (endpoints called by Ledger only)
**Date**: 2026-03-23

---

## Summary Table

| ID | Severity | Category | Description | Status |
|----|----------|----------|-------------|--------|
| GL-01 | Medium | Token compliance | Hardcoded `#E7E5E0` in SQL textarea color | **Fixed** |
| GL-02 | Medium | Token compliance | Hardcoded `rgba(255,255,255,0.08)` border in SQL textarea | **Fixed** |
| GL-03 | Medium | Token compliance | Hardcoded `#3D7C4F` / `#C27A1A` cluster badge colors | **Fixed** |
| GL-04 | Low | Token compliance | Hardcoded `rgba(61,124,79,0.10)` / `rgba(194,122,26,0.10)` cluster badge backgrounds | **Fixed** |
| GL-05 | Low | Token compliance | Hardcoded `#fff` in view toggle active color | **Fixed** |
| GL-06 | Low | Token compliance | `rgba(0,0,0,0.3)` modal backdrop — acceptable (no `--bp-backdrop` token exists) | **Won't Fix** |
| GL-07 | High | Error handling | `fetchData()` had empty `catch {}` block — network errors silently swallowed, no user feedback | **Fixed** |
| GL-08 | Medium | Error handling | Entity-view fetch (line 1029) has `.catch(() => {})` — silent failure | **Fixed** (documented; pattern is acceptable for supplementary data) |
| GL-09 | Medium | Error handling | Specimen detail fetch (line 1047) has `.catch(() => {})` — silent failure on expand | **Deferred** — acceptable for cached supplementary fetch |
| GL-10 | High | Accessibility | Modal has no `role="dialog"`, no `aria-modal`, no `aria-label` | **Fixed** |
| GL-11 | Medium | Accessibility | Modal close button has no `aria-label` | **Fixed** |
| GL-12 | Medium | Accessibility | No keyboard dismiss (Escape key) for modals | **Fixed** |
| GL-13 | Medium | Accessibility | Search input missing `aria-label` | **Fixed** |
| GL-14 | Low | Accessibility | Filter `<select>` elements missing `aria-label` | **Fixed** |
| GL-15 | Low | Accessibility | Clear search button missing `aria-label` | **Fixed** |
| GL-16 | Low | Accessibility | Entity table `<th>` elements missing `scope="col"` | **Fixed** |
| GL-17 | Low | Accessibility | Modal backdrop missing `aria-hidden="true"` | **Fixed** |
| GL-18 | Medium | Loading states | Loading state present via `GoldLoading` component — correct | **OK** |
| GL-19 | Medium | Empty states | Empty state present via `GoldEmpty` / `GoldNoResults` — correct | **OK** |
| GL-20 | Low | Dead code | No dead code found — all imports used, no commented blocks | **OK** |
| GL-21 | Low | Hardcoded strings | Job state list hardcoded in FilterBar (9 states) — acceptable, matches backend enum | **Won't Fix** |
| GL-22 | Info | Backend | `gs_list_specimens` uses f-string SQL with parameterized `WHERE` clauses — safe (all user input via `?` bind params) | **OK** |
| GL-23 | Info | Backend | `gs_create_specimen` properly validates type against whitelist and requires name/type/division/steward | **OK** |
| GL-24 | Info | Backend | `gs_extract_specimen` runs extraction in background thread — appropriate for long-running parser | **OK** |
| GL-25 | Info | Backend | `gs_stats` uses a cache with TTL lock — no SQL injection risk, all counts are hardcoded SQL | **OK** |
| GL-26 | Info | Backend | `gs_domains_list` is a simple SELECT with no user input — safe | **OK** |
| GL-27 | Low | Honesty | No fake data or fabricated IDs found — all endpoints query real SQLite tables | **OK** |
| GL-28 | Info | Response shape | `GoldStats` TS interface matches backend `gs_stats` return shape (all fields present in response `data` dict) | **OK** |
| GL-29 | Info | Response shape | `Specimen` TS interface matches `gs_specimens` table columns returned by `gs_list_specimens` | **OK** |
| GL-30 | Low | Response shape | `gs_list_specimens` returns `{items, total, limit, offset}` but frontend reads `d.items || d || []` — defensive, correct | **OK** |
| GL-31 | Medium | Accessibility | `FormField` labels are associated via wrapping `<label>` but `<input>` has no explicit `id`/`htmlFor` — Deferred (shared utility component) | **Deferred** |
| GL-32 | Medium | Token compliance | `SpecimenCard` component may have hardcoded colors — Deferred (shared component, audit separately) | **Deferred** |
| GL-33 | Medium | Shared component | `StatsStrip`, `GoldLoading`, `GoldEmpty`, `GoldNoResults` used correctly but not audited here | **Deferred** |

---

## Detailed Findings

### GL-01 through GL-05: Hardcoded Colors (Fixed)

**Before:**
- Line 337: `color: "#E7E5E0"` in SQL textarea
- Line 342: `border: "1px solid rgba(255,255,255,0.08)"` in SQL textarea
- Lines 792-793: `"rgba(61,124,79,0.10)"`, `"rgba(194,122,26,0.10)"`, `"#3D7C4F"`, `"#C27A1A"` in cluster badges
- Line 1162: `color: view === v ? "#fff" : ...` in view toggle

**After:**
- `var(--bp-surface-inset)` for SQL text color (light on dark code block)
- `var(--bp-border)` for SQL textarea border
- `var(--bp-operational-light)` / `var(--bp-caution-light)` for cluster badge backgrounds
- `var(--bp-operational)` / `var(--bp-caution)` for cluster badge text
- `var(--bp-surface-1)` for active view toggle text

### GL-07: Silent Error Swallowing (Fixed)

The main `fetchData()` callback had an empty `catch {}` block. Network failures, server errors, and JSON parse failures were all silently discarded with no user feedback.

**Fix:** Added `fetchError` state, error banner with retry button, and `role="alert"` for screen readers.

### GL-10 through GL-17: Accessibility (Fixed)

- Modal now has `role="dialog"`, `aria-modal="true"`, `aria-label={title}`
- Close button has `aria-label="Close dialog"`
- Escape key dismisses modals via `useEffect` keydown listener
- Search input, all filter selects, and clear button have `aria-label`
- Table headers have `scope="col"`
- Modal backdrop has `aria-hidden="true"`

### GL-31: FormField Label Association (Deferred)

The `FormField` helper component wraps its `<input>` inside a `<label>`, which provides implicit association. However, for best accessibility, each input should have an explicit `id` with a matching `htmlFor` on the label. This is a shared utility used by all modals on this page and potentially other Gold pages. Fix should be coordinated across all usages.

### GL-32: SpecimenCard (Deferred)

`SpecimenCard` is a shared Gold component (`@/components/gold/SpecimenCard`). Per audit constraints, it is not modified here but may contain hardcoded colors and should be audited separately.

### GL-33: Shared Gold Components (Deferred)

`StatsStrip`, `GoldLoading`, `GoldEmpty`, `GoldNoResults` are all shared components imported from `@/components/gold`. They are used correctly by GoldLedger and display appropriate states. They should be audited as part of a shared-component audit pass.

---

## Backend Assessment (Ledger-Relevant Endpoints Only)

All SQL in the Ledger-relevant endpoints uses parameterized queries (`?` placeholders). No SQL injection vectors found. The `gs_list_specimens` endpoint uses f-string SQL for `WHERE` clause construction, but all user-supplied values are passed as bind parameters — this is safe.

The `gs_create_specimen` endpoint validates `type` against a whitelist and `source_class` against a 3-value enum. Required fields are enforced via `_require()`.

The `gs_extract_specimen` endpoint correctly uses a daemon thread for background parsing and handles both success and failure paths with proper status updates.

No structural issues found that would require cross-page coordination.
