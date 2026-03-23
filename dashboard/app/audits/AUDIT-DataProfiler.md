# AUDIT-DP: Data Profiler Page Audit

**Audited:** 2026-03-23
**Files:** `dashboard/app/src/pages/DataProfiler.tsx` (1118 lines), `dashboard/app/api/routes/data_access.py` (1120 lines)
**Scope:** Profiler-specific endpoints only (`/api/blender/profile`, `/api/blender/sample`)

---

## Summary

13 findings across both files. 10 fixed, 3 deferred. The most critical issue was a truth bug where the profile endpoint reported sampled row count (capped at 100k) as the actual table row count, misleading users about table size.

---

## Findings

### CRITICAL

| ID | Severity | Description | Fix Status |
|----|----------|-------------|------------|
| DP-01 | CRITICAL | **Truth bug: `rowCount` reports sample size, not actual count.** `get_blender_profile()` calls `lf.head(100_000).collect()` then sets `row_count = len(sample)`. For any table >100k rows, the frontend "Rows" KPI shows 100,000 instead of the real count. | FIXED |

**Fix:** Added a separate `pl.len()` call on the full LazyFrame to get the true row count. Profile statistics (null%, uniqueness%) still computed against the sample. Response now includes `sampled` and `sampleSize` fields. Frontend shows "Rows (sampled 100,000)" when applicable.

### HIGH

| ID | Severity | Description | Fix Status |
|----|----------|-------------|------------|
| DP-02 | HIGH | **Path traversal: `lakehouse` param not sanitized** in `get_blender_profile()` and `get_blender_sample()`. The `lakehouse` value is used directly in filesystem path construction via `_scan_onelake_table()` -> `_resolve_onelake_table_path()`. A crafted lakehouse name like `../../etc` could traverse outside OneLake. | FIXED |
| DP-03 | HIGH | **130+ hardcoded rgba/hex colors** in `DataProfiler.tsx`. `nullBg()` used 4 hardcoded `rgba()` values. `MissingValueMatrix` used 7 hardcoded `rgba()` values. Entity list used `rgba(0,0,0,0.02)` borders. All violate design token system. | FIXED |

### MEDIUM

| ID | Severity | Description | Fix Status |
|----|----------|-------------|------------|
| DP-04 | MEDIUM | **Unused imports:** `Link` from react-router-dom (never used), `Info` from lucide-react (never used). Dead code. | FIXED |
| DP-05 | MEDIUM | **Redundant branches in `qualityColor()`:** Three separate conditions (>=98, >=90, >=80) all returned the same value `var(--bp-operational)`. Same for >=60 and >=40 returning `var(--bp-caution)`. Collapsed to 2 branches. | FIXED |
| DP-06 | MEDIUM | **Missing keyboard navigation on expandable rows.** Column detail rows are click-only with no `tabIndex`, `role`, or `onKeyDown`. Screen readers and keyboard users cannot expand column details. | FIXED |
| DP-07 | MEDIUM | **Missing aria-label on back button.** The "Change table" button only has a `title` attribute, no `aria-label`. | FIXED |
| DP-08 | MEDIUM | **Profile stats use wrong denominator after row count fix.** After fixing DP-01, `null_pct` and `uniqueness` calculations referenced `row_count` (now the true count) instead of `sample_size` (the actual sample these stats were computed from). Would inflate completeness and deflate uniqueness for large tables. | FIXED |

### LOW

| ID | Severity | Description | Fix Status |
|----|----------|-------------|------------|
| DP-09 | LOW | **`hexColor` property naming is misleading.** `ColumnDetailPanel` stats array uses `hexColor` but values are CSS custom properties like `var(--bp-copper)`, not hex codes. | DEFERRED |
| DP-10 | LOW | **Entity picker layer selector hardcodes Bronze/Silver only.** If Landing Zone profiling were added, the layer selector would need updating. Not a current bug since LZ profiling works via direct URL params. | DEFERRED |
| DP-11 | LOW | **`qualityScore` formula undocumented in type.** The 60/40 weighting is explained in UI text but not in the function JSDoc or type system. | DEFERRED |

---

## Deferred Items

| ID | Reason |
|----|--------|
| DP-09 | Cosmetic naming issue only. Renaming `hexColor` to `tokenColor` would touch many lines for zero functional benefit. |
| DP-10 | Not a current bug -- LZ tables are not exposed in the entity picker layer selector by design. |
| DP-11 | Code comment is sufficient; adding JSDoc to a 3-line helper is over-engineering. |

---

## Data Blender Endpoint Issues (for AUDIT-DBL)

The following issues were found in `data_access.py` but affect Data Blender endpoints, NOT the profiler. Noting here for the next audit agent:

| ID | Endpoint | Description |
|----|----------|-------------|
| DBL-NOTE-01 | `POST /api/blender/query` | `lakehouse` param is not sanitized before being used in path construction (`mount / f"{lakehouse}.Lakehouse"`). Same path traversal risk as DP-02. |
| DBL-NOTE-02 | `POST /api/blender/query` | `re.sub` removes TOP keyword from SQL but the regex search for `top_n` uses the original `params.get("sql", "")` instead of the cleaned version. Minor but inconsistent. |
| DBL-NOTE-03 | `GET /api/purview/status` | Returns `error: str(e)` which may leak internal exception details to the client. |

---

## Files Modified

- `dashboard/app/src/pages/DataProfiler.tsx` — removed unused imports, collapsed redundant branches, replaced all hardcoded rgba/hex colors with design tokens, added keyboard navigation and aria-labels to expandable rows and back button, added `sampled`/`sampleSize` to ProfileData interface, updated Rows KPI to show sample indicator
- `dashboard/app/api/routes/data_access.py` — fixed truth bug (row count now uses `pl.len()` for true count), sanitized `lakehouse` param in profile and sample endpoints, separated `sample_size` from `row_count` for correct stat calculations, added `sampled` and `sampleSize` fields to response
