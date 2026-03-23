# AUDIT: DataMicroscope (AUDIT-DMS)

**Audited:** 2026-03-23
**Files:** `dashboard/app/src/pages/DataMicroscope.tsx` (1138 lines), `dashboard/app/api/routes/microscope.py` (584 lines)
**Hooks:** `useMicroscope`, `useMicroscopePks` from `@/hooks/useMicroscope.ts`
**Shared components:** `EntitySelector` from `@/components/EntitySelector.tsx`

---

## Overview

DataMicroscope is a cross-layer row inspection tool. Users select an entity, search for a primary key value, and the page displays that specific row across Source, Landing Zone, Bronze, and Silver layers in a side-by-side diff grid. Highlights cell-level changes, shows SCD2 version navigation for Silver, displays transformation pipeline steps, and provides click-to-inspect popovers.

### Architecture

```
EntitySelector (shared component)
  -> useEntityDigest() -> GET /api/entity-digest -> SQLite

PkSearchInput
  -> useMicroscopePks(entityId, searchQuery) -> GET /api/microscope/pks?entity=N&q=X&limit=20
     -> microscope.py:get_microscope_pks() -> SQLite + on-prem ODBC (graceful fallback)

DiffGrid
  -> useMicroscope(entityId, pkValue) -> GET /api/microscope?entity=N&pk=V
     -> microscope.py:get_microscope() -> SQLite + on-prem ODBC + OneLake Parquet (polars)
```

**Previous audit (2026-03-13)** found both backend endpoints missing. They have since been implemented in `microscope.py`. This audit focuses on the current state of both frontend and backend.

---

## NAVIGATION

### Inbound params consumed
- `?entity=<LandingzoneEntityId>` — pre-selects entity on mount via `useSearchParams()`
- `?pk=<value>` — pre-fills PK search and triggers cross-layer lookup
- Both params are read on mount and drive the page state. Deep linking works correctly.

### Outbound links
- **None.** DataMicroscope is a data inspection terminal with no outbound navigation to other pages.

### Sidebar nav
- DataMicroscope (`/microscope`) is NOT in the sidebar nav. It is only accessible via direct URL or programmatic navigation. Currently no other page links to it via `<Link>` or `navigate()`.

---

## Issues Found

### DMS-01 (LOW) — Unused imports: `ChevronDown`, `DigestEntity`
**Problem:** `ChevronDown` from lucide-react and `DigestEntity` type from useEntityDigest were imported but never used.
**Fix:** Removed both unused imports. **FIXED**

### DMS-02 (MEDIUM) — Hardcoded hex colors instead of design tokens
**Problem:** Dozens of inline `style=` and Tailwind arbitrary value references used hardcoded hex colors (`#1C1917`, `#78716C`, `#FEFDFB`, `#EDEAE4`, `#B93A2A`, `#FBEAE8`, `#57534E`, `#475569`, `#9A4A1F`, `#E2E8F0`, `#A8A29E`) that have exact `--bp-*` design token equivalents. Also `rgba(0,0,0,0.08)` and `rgba(0,0,0,0.04)` used directly instead of `var(--bp-border)` / `var(--bp-border-subtle)`.
**Fix:** Replaced all exact-match hex colors with their token equivalents:
- `#1C1917` -> `var(--bp-ink-primary)`
- `#57534E` -> `var(--bp-ink-secondary)`
- `#78716C` -> `var(--bp-ink-tertiary)`
- `#A8A29E` -> `var(--bp-ink-muted)`
- `#FEFDFB` -> `var(--bp-surface-1)`
- `#EDEAE4` -> `var(--bg-muted)`
- `#B93A2A` -> `var(--bp-fault)`
- `#FBEAE8` -> `var(--bp-fault-light)`
- `#9A4A1F` -> `var(--bp-copper-hover)`
- `#475569` -> `var(--bp-silver)`
- `#E2E8F0` -> `var(--bp-silver-light)`
- `rgba(0,0,0,0.08)` in borders/shadows -> `var(--bp-border)`
- `rgba(0,0,0,0.04)` in borders -> `var(--bp-border-subtle)`

**Not changed:** Intentional opacity variants (`rgba(168,162,158,0.3)`, `rgba(226,232,240,0.2)`, etc.) that represent deliberate opacity levels without exact token equivalents. **FIXED**

### DMS-03 (LOW) — Missing aria-labels on interactive elements
**Problem:** Close button in CellPopover, clear button in PkSearchInput, PK search input, and SCD2 version `<select>` had no aria-labels.
**Fix:** Added `aria-label` to:
- CellPopover close button: "Close popover"
- PK search clear button: "Clear search"
- PK search input: "Primary key search"
- Silver version select: "Select Silver SCD2 version"
**FIXED**

### DMS-04 (LOW) — Inconsistent font-display token
**Problem:** The second header (entity-selected state, line 938) used `var(--font-display)` while the first header (no-entity state, line 890) correctly used `var(--bp-font-display)`. Both resolve to the same value but inconsistency suggests a copy-paste error.
**Fix:** Changed to `var(--bp-font-display)` for consistency. **FIXED**

---

## Deferred Items

### DMS-D1 (INFO) — `silver.currentVersion` misleadingly named
**Reason:** Backend returns `len(silver_versions)` as `currentVersion` — this is a count, not an index. The field is typed in the frontend (`MicroscopeData.silver.currentVersion`) but never read by `DataMicroscope.tsx`. Renaming would affect the API contract and the TransformationReplay page which also consumes `GET /api/microscope`. Low risk, deferred.

### DMS-D2 (INFO) — No sidebar nav entry for /microscope
**Reason:** The page is registered in the router (`App.tsx` line 117) but has no sidebar nav link. It's only accessible via direct URL. This may be intentional (it's a deep-dive tool). No change made.

### DMS-D3 (INFO) — `bronze_available`/`silver_available` can be misleading
**Reason:** When `pk_value` is provided but OneLake read fails silently, `bronze_available` stays `True` (set from entity registration existence) while `bronze_row` is `None`. The frontend shows the layer badge as "available" but cells display dashes. Minor UX discrepancy but the error handling is graceful and no data is fabricated. Deferred.

---

## TransformationReplay Notes

TransformationReplay (`TransformationReplay.tsx` line 488) also calls `GET /api/microscope?entity=N&pk=V` directly — the same endpoint. No TransformationReplay-specific endpoints exist in `microscope.py`. The `_build_transformations()` helper in `microscope.py` generates data consumed by both pages. No issues found specific to TransformationReplay's usage of this endpoint, but AUDIT-TR should verify the `transformations` field consumption on its side.

---

## Backend Review (microscope.py — Microscope-specific endpoints only)

### Security
- **SQL injection:** Properly mitigated. `_sanitize()` strips non-alphanumeric chars from identifiers. PK values use parameterized queries (`cursor.execute(sql, (pk_value,))`).
- **Server validation:** `_validate_server()` checks against registered connections in SQLite before allowing ODBC connections.
- **Input validation:** `entity` param validated as integer; `limit` clamped 1-100; empty strings handled.
- **Path traversal:** Not applicable — no file path construction from user input. OneLake paths built from database metadata.

### Data honesty
- Source row: Real ODBC query to on-prem SQL Server (graceful fallback if VPN unavailable)
- Bronze/Silver rows: Real Parquet reads via polars from OneLake mount
- Transformations: Deterministic descriptions of actual FMD pipeline behavior — not fabricated
- No Math.random, no faker, no mock data

### Error handling
- All ODBC/Parquet failures caught and logged, return `None` gracefully
- 404 for unknown entity IDs
- 400 for missing/invalid params

---

## Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 0 | Previous CRITs (missing endpoints) are now resolved |
| MEDIUM | 1 | DMS-02: Hardcoded hex colors (fixed) |
| LOW | 3 | DMS-01: Unused imports (fixed), DMS-03: Missing aria-labels (fixed), DMS-04: Inconsistent token (fixed) |
| DEFERRED | 3 | DMS-D1/D2/D3: Naming, nav, availability flag edge cases |

**Bottom line:** The page and its backend are fully functional. No truth bugs, no fabricated data, no security issues. The backend implements proper parameterization, server validation, and graceful failure handling. Fixes focused on design token compliance, dead code removal, and accessibility.
