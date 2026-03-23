# AUDIT-VC: ValidationChecklist.tsx — Full Page Audit

**Date**: 2026-03-23
**Page**: `dashboard/app/src/pages/ValidationChecklist.tsx` (847 lines)
**Backend**: `engine/api.py` — `_handle_validation()` (line 1071)
**DB Layer**: `dashboard/app/api/db.py` via `engine/api.py:_db_query()`
**Primary Table**: `entity_status` (PK: LandingzoneEntityId + Layer)

---

## Findings

### FIXED

| ID | Severity | Description | Fix |
|----|----------|-------------|-----|
| VC-01 | **HIGH** | `LzFailed` count labeled as "pending" in Checklist detail (line 735). Backend field `LzFailed` counts entities with status `'failed'/'error'`, NOT pending. When failures occur, operators see the failure count under the wrong label, hiding the problem. | Changed label from `"pending"` to `"failed"` |
| VC-02 | **HIGH** | `LayerDetail` component labels the `failed` prop as "Pending" (line 822). Same root cause as VC-01 — applies to all three layer detail views (LZ, Bronze, Silver). Operators expanding a source see failed entities labeled as pending. | Changed display text from `"Pending"` to `"Failed"` |

### DEFERRED

| ID | Severity | Description | Reason |
|----|----------|-------------|--------|
| VC-03 | LOW | `never_attempted` response field returned by API but never rendered by the frontend — dead data, wasted query + bandwidth | Backend-only cleanup. API response shape change could break other consumers. Low risk. |
| VC-04 | LOW | `never_attempted` query has `LIMIT 50` with no indication to the frontend that results are truncated | Not displayed anyway (see VC-03). No user impact. |
| VC-05 | LOW | `LzNeverAttempted` conflates "no entity_status row" with "status = not_started" | Functionally correct. Current data has all entities with landing rows. Semantic distinction only matters at scale. |
| VC-06 | LOW | `LayerStatus` TypeScript interface uses 9 optional fields for all 3 layer types instead of per-layer types | Type hygiene, not a data bug. No runtime impact. |
| VC-07 | LOW | No `aria-label` attributes on interactive elements (checkboxes, select dropdowns, expandable source rows) | Accessibility improvement. Not a truth or crash bug. Feature work. |
| VC-08 | LOW | `--bp-surface-2` CSS variable used (lines 476, 638, 676) but not defined in `index.css` — resolves to `initial` (transparent). | Codebase-wide issue (25 files). Not ValidationChecklist-specific. Should be addressed globally. |
| VC-09 | LOW | `rgba()` border colors used instead of design tokens (10 occurrences) — e.g., `rgba(61,124,79,0.2)` for operational border | No `--bp-*-border` tokens exist in the design system. This is a codebase-wide convention (55 occurrences across 13 files). Would require adding new tokens first. |

---

## Audit Checklist Results

| Check | Result |
|-------|--------|
| Truth bugs (fake data, misleading labels) | **VC-01, VC-02 FIXED** — "Pending" labels on failure counts |
| Dead code (unused imports, unreachable branches) | CLEAN — all imports used |
| Error handling | CLEAN — `fetchJson` throws on non-ok, caught by `fetchData` |
| Backend validation | CLEAN — SQL queries are parameterized via `_db_query`, no user input in SQL |
| Hardcoded hex colors | CLEAN — all colors use `var(--bp-*)` tokens. Border rgba() values are codebase convention (VC-09) |
| Accessibility | VC-07 deferred — missing aria-labels |
| Input validation | CLEAN — no user input sent to backend except entity IDs (numeric, from data) |
| Loading states | CLEAN — full loading spinner on first load, subtle refresh indicator on subsequent polls |
| Empty states | CLEAN — error state shown when API fails; loading state when no data |
| API response shape | CLEAN — all 8 response keys match TypeScript interfaces exactly |

---

## Previous Audit Reference

This audit supersedes the initial data-source audit from 2026-03-13. The previous audit identified VC-01/VC-02 but did not fix them. All 8 SQL queries were verified correct in that audit and remain unchanged.
