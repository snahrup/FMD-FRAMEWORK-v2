# AUDIT: ErrorIntelligence
**File**: `dashboard/app/src/pages/ErrorIntelligence.tsx`
**Backend route**: `dashboard/app/api/routes/monitoring.py`
**DB layer**: `dashboard/app/api/db.py` (thin wrapper around `fmd_control_plane.db`)
**Original audit**: 2026-03-13
**Updated**: 2026-03-23
**Focus**: Data source correctness, query deduplication, case sensitivity

---

## Status Change from Prior Audit

The 2026-03-13 audit declared the page **100% non-functional** due to:
- B1: Backend response shape completely mismatched frontend expectations
- B2: All SQL queries referenced non-existent Fabric SQL tables

**Both B1 and B2 have since been fixed.** The backend now:
- Queries `engine_task_log`, `pipeline_audit`, and `copy_activity_audit` (correct SQLite tables)
- Returns the `ErrorIntelligenceData` shape the frontend expects (`summaries`, `errors`, `patternCounts`, `severityCounts`, `totalErrors`, `topIssue`)
- Classifies errors via `_classify_error()` with category/severity/suggestion

**The page is functional.** Three bugs remained and were fixed in this audit pass.

---

## Bugs Found and Fixed (2026-03-23)

### N1 — Duplicate entries from engine_task_log [FIXED]
- **Location**: `monitoring.py` — `get_error_intelligence()`, the removed `es_errors` query block
- **Issue**: The route queried `engine_task_log` TWICE for failed records:
  - `task_errors`: `WHERE etl.Status = 'Failed' OR etl.ErrorType IS NOT NULL` (IDs: `etl-{id}`)
  - `es_errors`: `WHERE etl.Status = 'failed' AND etl.ErrorMessage IS NOT NULL` (IDs: `etl-{EntityId}-{Layer}`)
  Same underlying rows appeared in both result sets with different synthetic IDs, inflating error counts and skewing the Top Issue percentage.
- **Fix**: Removed the `es_errors` query block entirely. The `task_errors` query already captures all failed rows (it uses `Status = 'Failed' OR ErrorType IS NOT NULL`, which is a superset).

### N2 — SourceSchema accessed but never selected [FIXED]
- **Location**: `monitoring.py` — `task_errors` processing loop
- **Issue**: Code checked `if row.get("SourceSchema")` and prepended it to entity name, but the SELECT never included `SourceSchema` and `engine_task_log` has no such column (it has `SourceTable`). Dead code that silently did nothing.
- **Fix**: Removed the dead `SourceSchema` branch.

### N3 — Status case mismatch: 'Failed' vs 'failed' [FIXED]
- **Location**: `monitoring.py` — `task_errors` WHERE clause
- **Issue**: The primary query used `Status = 'Failed'` (capital F), while the removed duplicate used `Status = 'failed'` (lowercase). If the engine writes lowercase status values, the primary query would miss real failures.
- **Fix**: Changed to `LOWER(etl.Status) = 'failed'` for case-insensitive matching.

---

## Residual Issues (Document Only)

### N4 — No result cap / pagination
- **Location**: `monitoring.py` — all three query blocks
- **Issue**: Up to 1500 raw error rows (500 from `engine_task_log`, 500 from `pipeline_audit`, 500 from `copy_activity_audit`) can be returned in a single response with no pagination support. For a system with high error volume, this could produce large payloads.
- **Severity**: Low — current entity count (1,666) is unlikely to produce payloads large enough to cause issues. Worth addressing if error volume grows significantly.
- **Recommendation**: Add `?limit=` and `?offset=` query params, or implement server-side pagination.

### B4 (from prior audit) — Fabric job instance errors not queried
- **Location**: `monitoring.py` — `get_error_intelligence()`
- **Issue**: The old `server.py.bak` implementation queried live Fabric job instances for failed jobs with `failureReason`. This was not ported to the refactored route. Fabric-level pipeline failures (timeouts, gateway errors, capacity errors) that occur outside the v3 engine are invisible to the Error Intelligence page.
- **Severity**: Medium — the engine covers the vast majority of error scenarios, but Fabric orchestration-level failures would be missed.
- **Recommendation**: Consider re-adding Fabric job instance error collection as a secondary source.

---

## Architecture Summary (Current)

`GET /api/error-intelligence` in `monitoring.py` (`get_error_intelligence()`):

1. **Collects errors from 3 sources**:
   - `engine_task_log` (primary — richest data: ErrorType, ErrorMessage, ErrorStackTrace, ErrorSuggestion)
   - `pipeline_audit` (WHERE LogType = 'error')
   - `copy_activity_audit` (WHERE LogType = 'error')
2. **Classifies each error** via `_classify_error()` into categories (AUTH, TIMEOUT, GATEWAY, etc.) with severity and suggestions
3. **Groups by category** to build `summaries[]` with occurrence counts, affected pipelines, latest error
4. **Computes top issue** from the highest-severity, highest-count category
5. **Returns** `ErrorIntelligenceData` shape matching the frontend TypeScript interface

---

## Data Points Verified

| # | Data Point | Source Table(s) | Status |
|---|-----------|----------------|--------|
| 1 | Response shape matches frontend | N/A | **OK** |
| 2 | Engine task errors | `engine_task_log` | **OK** (case-insensitive after N3 fix) |
| 3 | Pipeline audit errors | `pipeline_audit` | **OK** |
| 4 | Copy activity audit errors | `copy_activity_audit` | **OK** |
| 5 | No duplicate rows | `engine_task_log` | **OK** (after N1 fix, single query) |
| 6 | Frontend consumption | N/A | **OK** — summaries, errors, counts, topIssue all populated |

**Overall verdict**: Page is **functional**. Three bugs fixed (N1 duplicate query, N2 dead code, N3 case mismatch). Two residual items documented for future work (N4 pagination, B4 Fabric job errors).
