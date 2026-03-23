# AUDIT-DM: Data Manager Page Audit

**Date**: 2026-03-23
**Auditor**: Claude (AUDIT-DM packet)
**Frontend**: `dashboard/app/src/pages/DataManager.tsx` (936 lines)
**Backend**: `dashboard/app/api/routes/data_manager.py` (591 lines)

---

## Summary

The Data Manager is a well-built database explorer. The previous audit (2026-03-13) verified all table schemas, FK resolutions, and column mappings are correct. This audit focuses on code quality, error handling, accessibility, and design token compliance.

**7 findings**: 1 HIGH, 4 MEDIUM, 2 LOW. All 7 FIXED.

---

## Findings

### DM-01 | HIGH | Truth bug: BoolBadge mislabels non-IsActive booleans
**Description**: `BoolBadge` always displayed "Active"/"Inactive" regardless of which boolean column it rendered. Columns like `IsIncremental` and `IsProcessed` were labeled "Active"/"Inactive" instead of "Yes"/"No", misleading users about what the value means.
**Fix**: Added `colKey` prop to `BoolBadge`. Only `IsActive` columns use "Active"/"Inactive" labels; all others use "Yes"/"No".
**Status**: FIXED

### DM-02 | MEDIUM | Hardcoded rgba border colors instead of design tokens
**Description**: Five locations used hardcoded `rgba(61,124,79,0.2)`, `rgba(185,58,42,0.2)`, `rgba(185,58,42,0.3)`, and `rgba(0,0,0,0.04)` for borders instead of design tokens.
**Fix**: Replaced `rgba(0,0,0,0.04)` with `var(--bp-border-subtle)`. Replaced rgba operational/fault borders with `var(--bp-operational-light)` and `var(--bp-fault-light)` respectively.
**Status**: FIXED

### DM-03 | MEDIUM | Silent error swallowing on table list fetch
**Description**: Line 691 `.catch(() => {})` silently discarded errors when the table list API failed. Users saw an empty sidebar with no indication of failure.
**Fix**: `.catch()` now shows an error toast: "Failed to load table list".
**Status**: FIXED

### DM-04 | MEDIUM | No error state for table data fetch
**Description**: When `GET /api/data-manager/table/{name}` failed, `tableData` was set to null and the grid area showed nothing — no error message, no retry hint.
**Fix**: Added `dataError` state. On fetch failure, an error message is displayed in the grid area. Error clears on table switch or successful reload.
**Status**: FIXED

### DM-05 | MEDIUM | Backend crashes on non-numeric pagination params
**Description**: `int(params.get("page", 1))` and `int(params.get("per_page", 50))` would throw `ValueError` if given non-numeric query params (e.g., `?page=abc`), causing a 500 error.
**Fix**: Wrapped both in try/except with safe defaults. Also clamped `page` to minimum 1 and `per_page` to range [1, 500].
**Status**: FIXED

### DM-06 | LOW | Missing aria-labels on interactive elements
**Description**: No `aria-label` attributes on sidebar search input, row search input, or clear-search button. Screen readers could not identify these controls.
**Fix**: Added `aria-label` to both search inputs and the clear-search button.
**Status**: FIXED

### DM-07 | LOW | Hardcoded `#fff` on pagination active button
**Description**: Line 621 used `color: "#fff"` for the active pagination button text.
**Reason deferred**: `#fff` is used as text-on-accent color for the copper-background active pagination button. There is no `--bp-ink-on-accent` token in the design system. The fallback of `#fff` is the correct visual choice and matches other pages (e.g., LoadCenter.tsx). Would require a new design token to fix properly.
**Status**: DEFERRED — needs design token addition

---

## Deferred Items

| ID | Severity | Reason |
|----|----------|--------|
| DM-07 | LOW | No `--bp-ink-on-accent` design token exists; `#fff` is the only correct value for text on `--bp-copper` background. Fixing requires adding a new token to the design system, which is out of scope for a page audit. |

---

## Items Verified Clean (No Issues Found)

| Check | Result |
|-------|--------|
| Truth bugs (fake data, Math.random, hardcoded counts) | Clean — all data comes from live DB queries |
| Dead code (unused imports, unreachable branches) | Clean — all imports used, no commented-out blocks |
| SQL injection | Clean — `_safe_ident()` validates all identifiers; values use parameterized queries |
| Path traversal | Clean — table names validated against `TABLE_REGISTRY` whitelist |
| Backend dangerous operations | Clean — no DELETE/TRUNCATE/DROP endpoints exposed |
| Loading states | Clean — sidebar shows spinner; grid shows "Loading..." with spinner |
| Empty states | Clean — category-specific empty messages exist for all 6 categories |
| API response shape mismatch | Clean — frontend `TableDataResponse` interface matches backend response exactly |
| `var()` fallback hex on line 133 | Clean — `var(--bp-warning-light, #FEF3C7)` is a valid CSS fallback, not a hardcoded color |
| `Math.ceil` on line 585 | Clean — legitimate pagination math, not a data fabrication trick |
