# AUDIT-GC: Gold Canonical Page Audit

**Page**: `dashboard/app/src/pages/gold/GoldCanonical.tsx` (716 lines)
**Backend**: `dashboard/app/api/routes/gold_studio.py` (endpoints called by Canonical only)
**Date**: 2026-03-23

---

## Summary Table

| ID | Severity | Category | Description | Status |
|----|----------|----------|-------------|--------|
| GC-01 | Critical | Truth bug | `Stats` interface expected `canonical_entities`, `dimensions`, `facts`, `bridges`, `approved`, `draft`, `pending_steward` — backend `gs_stats` returns `canonical_total`, `canonical_approved` and no type/status breakdowns. Stats strip showed zeros/undefined. | **Fixed** |
| GC-02 | Medium | Token compliance | Hardcoded `rgba(91,127,163,0.1)` for Bridge type background | **Fixed** |
| GC-03 | Medium | Token compliance | Hardcoded `rgba(180,86,36,0.06)` for Aggregate type background | **Fixed** |
| GC-04 | Low | Token compliance | Hardcoded `rgba(194,149,43,0.12)` for BK key badge background | **Fixed** |
| GC-05 | Low | Token compliance | `rgba(0,0,0,0.04)` in ReactFlow `<Background>` component — no `--bp-grid` token exists | **Won't Fix** |
| GC-06 | High | Error handling | Detail slide-over fetch had `.catch(() => {})` — network errors silently swallowed | **Fixed** |
| GC-07 | High | Error handling | Main page data load had no error state — fetch failures silently ignored with no user feedback | **Fixed** |
| GC-08 | Medium | Accessibility | Search input missing `aria-label` | **Fixed** |
| GC-09 | Medium | Accessibility | All 3 filter `<select>` elements missing `aria-label` | **Fixed** |
| GC-10 | Medium | Accessibility | `<th>` elements in DomainGrid table missing `scope="col"` | **Fixed** |
| GC-11 | Medium | Accessibility | `<th>` elements in ColumnsTab table missing `scope="col"` | **Fixed** |
| GC-12 | Medium | Accessibility | `<th>` elements in RelationshipsTab table missing `scope="col"` | **Fixed** |
| GC-13 | Low | Accessibility | View toggle buttons missing `aria-pressed` state | **Fixed** |
| GC-14 | Low | Accessibility | Domain collapse buttons missing `aria-expanded` attribute | **Fixed** |
| GC-15 | Low | Accessibility | View toggle group missing `role="group"` and `aria-label` | **Fixed** |
| GC-16 | Low | Dead code | `domainFilter` prop declared in `RelationshipMap` signature but never used inside the component | **Fixed** |
| GC-17 | Info | Loading states | Loading state present via `GoldLoading` component — correct | **OK** |
| GC-18 | Info | Empty states | Empty state present via `GoldEmpty` / `GoldNoResults` — correct | **OK** |
| GC-19 | Info | Backend | `gs_list_canonical` uses parameterized queries — safe | **OK** |
| GC-20 | Info | Backend | `gs_approve_canonical` validates required fields and uses optimistic concurrency check | **OK** |
| GC-21 | Info | Backend | `gs_generate_spec` checks status=approved before generating — safe | **OK** |
| GC-22 | Info | Honesty | No fake data, Math.random, or fabricated counts found — all data from real SQLite queries | **OK** |
| GC-23 | Medium | Shared component | `StatsStrip`, `GoldLoading`, `GoldEmpty`, `GoldNoResults`, `SlideOver`, `ProvenanceThread` used correctly but not audited here | **Deferred** |
| GC-24 | Low | Shared component | `LineageNode` type uses `Record<string, unknown>` cast for `cluster_id` access — type safety could improve | **Deferred** |

---

## Detailed Findings

### GC-01: Stats Interface Mismatch (Critical — Fixed)

The `Stats` TypeScript interface defined fields that do not exist in the backend response:
- Frontend expected: `canonical_entities`, `dimensions`, `facts`, `bridges`, `approved`, `draft`, `pending_steward`
- Backend `gs_stats` returns: `canonical_total`, `canonical_approved`, `gold_specs`, `specs_validated`, `catalog_published`, `catalog_certified`, `certification_rate`, plus specimen/cluster counts

The stats strip was rendering with `undefined` values for every field. Fixed by aligning the interface to the actual backend response and updating the `statsItems` array to use real fields.

### GC-02 through GC-04: Hardcoded Colors (Fixed)

**Before:**
- Line 50: `Bridge: "rgba(91,127,163,0.1)"`
- Line 52: `Aggregate: "rgba(180,86,36,0.06)"`
- Line 64: `BK: { ..., bg: "rgba(194,149,43,0.12)" }`

**After:**
- `var(--bp-lz-light)` for Bridge type background
- `var(--bp-copper-soft)` for Aggregate type background
- `var(--bp-caution-light)` for BK key badge background

### GC-06: Silent Error in Detail Fetch (Fixed)

The detail slide-over's main fetch chain ended with `.catch(() => {})`, silently discarding network errors. Fixed to show a toast notification on failure (only when the request was not aborted by user navigation).

### GC-07: Missing Error State for Main Data Load (Fixed)

The initial data load (`stats` + `domains`) used `fetchJson` which returns null on error, but the page had no mechanism to tell the user something went wrong. Added `fetchError` state, error banner with `role="alert"`, and a Retry button.

### GC-08 through GC-15: Accessibility (Fixed)

- Search input: added `aria-label="Search canonical entities"`
- Domain filter: added `aria-label="Filter by domain"`
- Type filter: added `aria-label="Filter by entity type"`
- Status filter: added `aria-label="Filter by status"`
- All `<th>` elements in DomainGrid, ColumnsTab, and RelationshipsTab: added `scope="col"`
- View toggle buttons: added `aria-pressed` reflecting active state
- View toggle group: added `role="group"` and `aria-label="View mode"`
- Domain collapse buttons: added `aria-expanded` reflecting collapsed state

### GC-16: Unused `domainFilter` Prop (Fixed)

`RelationshipMap` declared `domainFilter: string` in its props type but never referenced it inside the component body. Removed from both the type signature and the call site.

---

## Deferred Items

### GC-23: Shared Gold Components

`StatsStrip`, `GoldLoading`, `GoldEmpty`, `GoldNoResults`, `SlideOver`, and `ProvenanceThread` are all shared components imported from `@/components/gold`. They are used correctly by GoldCanonical but should be audited as part of a shared-component audit pass.

### GC-24: LineageNode Type Safety

In `DetailSlideOver` and `ClusterHistoryTab`, `lineage` items are cast to `Record<string, unknown>` to access `cluster_id`, which is not declared in the `LineageNode` interface. This works at runtime because the backend returns extra fields, but is not type-safe. The `LineageNode` interface should be extended to include `cluster_id?: number`. Deferred because it would require coordinating the type definition across all Gold pages that use lineage data.

---

## Backend Assessment (Canonical-Relevant Endpoints Only)

All SQL in Canonical endpoints uses parameterized queries (`?` placeholders). No SQL injection vectors found.

- `gs_list_canonical`: User filter values passed as bind params — safe.
- `gs_get_canonical`: ID is parsed via `_parse_int` — safe.
- `gs_approve_canonical`: Validates required fields, uses optimistic concurrency — safe.
- `gs_generate_spec`: Checks status=approved precondition, checks for existing spec (409) — safe.
- `gs_canonical_relationships`: No user input in WHERE clause — safe.
- `gs_canonical_domains`: No user input — safe.

No structural issues found that would require cross-page coordination.
