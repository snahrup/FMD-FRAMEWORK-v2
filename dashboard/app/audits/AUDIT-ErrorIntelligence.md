# AUDIT: ErrorIntelligence
**File**: `dashboard/app/src/pages/ErrorIntelligence.tsx`
**Backend route**: `dashboard/app/api/routes/monitoring.py`
**Old implementation**: `dashboard/app/api/server.py.bak` (lines 3002-3156)
**DB layer**: `dashboard/app/api/db.py` (thin wrapper around `fmd_control_plane.db`)
**Audited**: 2026-03-13
**Focus**: Data source correctness

---

## Architecture Summary

ErrorIntelligence makes a single API call:

- `GET /api/error-intelligence` -> `monitoring.py:152-195` (`get_error_intelligence()`)

The frontend expects a rich `ErrorIntelligenceData` structure with:
- `summaries[]` -- grouped/categorized error cards with severity, suggestion, occurrence count
- `errors[]` -- individual error records with pipeline name, entity name, raw error, category
- `patternCounts` -- dict of category -> count
- `severityCounts` -- dict of severity level -> count
- `totalErrors` -- number
- `topIssue` -- object with errorType, label, count, suggestion

---

## Data Points Verified

### 1. Error Intelligence Response Shape
- **Frontend expects** (TypeScript interface, lines 14-58): `ErrorIntelligenceData` with fields: `summaries`, `errors`, `patternCounts`, `severityCounts`, `totalErrors`, `topIssue`
- **Backend provides** (monitoring.py:152-195): Returns a dict with keys: `pipelineFailures`, `notebookFailures`, `copyFailures`, `failuresByPipeline`, `serverTime`
- **Status**: **COMPLETELY MISMATCHED**
- **Issue**: See B1 below.

### 2. Pipeline Failures Query
- **Backend** (monitoring.py:162-167):
  ```sql
  SELECT PipelineName, LogType, LogDateTime, LogData
  FROM PipelineExecution
  WHERE LogType = 'Error'
  ORDER BY LogDateTime DESC LIMIT 100
  ```
- **Schema**: **TABLE `PipelineExecution` DOES NOT EXIST** in SQLite. The actual table is `pipeline_audit`.
- **Status**: **BROKEN** -- query fails silently via `_safe_query()`, returns `[]`
- **Issue**: See B2 below.

### 3. Failure Counts By Pipeline
- **Backend** (monitoring.py:170-176):
  ```sql
  SELECT PipelineName, COUNT(*) as failureCount
  FROM PipelineExecution
  WHERE LogType = 'Error'
  GROUP BY PipelineName
  ORDER BY failureCount DESC
  ```
- **Schema**: Same non-existent `PipelineExecution` table.
- **Status**: **BROKEN** -- returns `[]`

### 4. Notebook Failures Query
- **Backend** (monitoring.py:179-184):
  ```sql
  SELECT NotebookName, LogType, LogDateTime, LogData, EntityId, EntityLayer
  FROM NotebookExecution
  WHERE LogType = 'Error'
  ORDER BY LogDateTime DESC LIMIT 100
  ```
- **Schema**: **TABLE `NotebookExecution` DOES NOT EXIST** in SQLite. The actual table is `notebook_executions`.
- **Status**: **BROKEN** -- returns `[]`

### 5. Copy Activity Failures Query
- **Backend** (monitoring.py:187-191):
  ```sql
  SELECT CopyActivityName, EntityName, LogType, LogDateTime, LogData
  FROM CopyActivityExecution
  WHERE LogType = 'Error'
  ORDER BY LogDateTime DESC LIMIT 100
  ```
- **Schema**: **TABLE `CopyActivityExecution` DOES NOT EXIST** in SQLite. The actual table is `copy_activity_audit`. Furthermore, `copy_activity_audit` has no `EntityName` column.
- **Status**: **BROKEN** -- returns `[]`

### 6. Frontend Consumption
- **Frontend** (lines 364-381): `fetchData()` calls `/api/error-intelligence`, expects `ErrorIntelligenceData`, then accesses:
  - `data.summaries` (line 390) -- backend returns NO `summaries` key
  - `data.errors` (line 391) -- backend returns NO `errors` key
  - `data.totalErrors` (line 392) -- backend returns NO `totalErrors` key
  - `data.severityCounts.critical` (line 393) -- backend returns NO `severityCounts` key
  - `data.topIssue` (line 396) -- backend returns NO `topIssue` key
- **Result**: All values default to 0/null/empty. The page renders the "No Pipeline Errors" empty state with the green checkmark, regardless of actual error data.
- **Status**: Page appears to work (shows clean state) but actually shows no data.

---

## Bugs Found

### B1 — Backend response shape completely mismatches frontend expectations [CRITICAL]
- **Location**: `monitoring.py:152-195` vs `ErrorIntelligence.tsx:14-58`
- **Issue**: The refactored `get_error_intelligence()` in `monitoring.py` returns raw SQL results in a flat dict:
  ```python
  {
      "pipelineFailures": [...],
      "failuresByPipeline": [...],
      "notebookFailures": [...],
      "copyFailures": [...],
      "serverTime": "..."
  }
  ```
  The frontend expects the fully processed `ErrorIntelligenceData` shape:
  ```typescript
  {
      summaries: ErrorSummary[],      // grouped by category, with severity/suggestion
      errors: ErrorRecord[],          // individual records with entity name, etc.
      patternCounts: Record<string, number>,
      severityCounts: Record<string, number>,
      totalErrors: number,
      topIssue: TopIssue | null
  }
  ```
- **Root cause**: The old `server.py.bak` implementation (lines 3002-3156) contained ~150 lines of error classification, categorization, severity assignment, pattern analysis, top-issue computation, and display-name mapping. This entire processing pipeline was **not migrated** to `monitoring.py`. The refactored route only contains the raw SQL queries without any of the aggregation/classification logic.
- **Impact**: The ErrorIntelligence page is completely non-functional. All cards show 0. All error lists are empty. The page always displays "No Pipeline Errors" regardless of actual error state.
- **Fix**: Port the full error intelligence processing logic from `server.py.bak:3002-3156` into `monitoring.py`. This includes:
  - `_classify_error()` -- categorizes raw error text into categories (timeout, gateway_offline, auth_denied, etc.)
  - `_extract_error_context()` -- pulls entity name, error type, summary from raw error text
  - `_ERROR_CATEGORY_META` -- dict mapping categories to title/severity/suggestion
  - The entire aggregation loop that builds `summaries`, `errors`, `patternCounts`, `severityCounts`, `topIssue`

### B2 — All four SQL queries reference non-existent Fabric SQL tables [CRITICAL]
- **Location**: `monitoring.py:162-191`
- **Issue**: Four queries reference tables that exist only in Fabric SQL (`logging.PipelineExecution`, `logging.CopyActivityExecution`, `logging.NotebookExecution`), not in the local SQLite database:
  - `PipelineExecution` -> should be `pipeline_audit`
  - `CopyActivityExecution` -> should be `copy_activity_audit`
  - `NotebookExecution` -> should be `notebook_executions`
- **Column mismatches even after table rename**:
  - `PipelineExecution` had `PipelineName`, `Status`, `StartDateTime`, `EndDateTime`, `ErrorMessage`
  - `pipeline_audit` has `PipelineName`, `LogType` (not Status), `LogDateTime` (not Start/End), `LogData` (not ErrorMessage)
  - `CopyActivityExecution` had `EntityName` -- `copy_activity_audit` has no `EntityName` column
- **Impact**: All queries fail silently. Even if B1 were fixed to add the processing logic, there's no data flowing in because the queries all error out.
- **Fix**: Rewrite queries against the correct SQLite tables with correct column names. Additionally, consider querying `engine_task_log` (which has `ErrorType`, `ErrorMessage`, `ErrorStackTrace`, `ErrorSuggestion`) as the primary error data source for the v3 architecture.

### B3 — engine_task_log is the correct error source but is not queried [DESIGN GAP]
- **Location**: `monitoring.py:152-195`
- **Issue**: The v3 engine architecture writes detailed per-entity error data to `engine_task_log` with dedicated error columns: `ErrorType`, `ErrorMessage`, `ErrorStackTrace`, `ErrorSuggestion`, plus `Layer`, `Status`, `EntityId`, `SourceTable`, `DurationSeconds`. This is a far richer error data source than the audit logging tables. However, `get_error_intelligence()` does not query it at all.
- **Impact**: Even if the audit table queries were fixed, the error intelligence would only have access to generic pipeline-level log events, not the detailed entity-level error data that the v3 engine produces.
- **Fix**: Make `engine_task_log WHERE Status = 'failed'` the primary data source for error intelligence. It has all the fields needed to build the `ErrorRecord` objects the frontend expects: entity ID, layer, error type, error message, stack trace, and even pre-built error suggestions.

### B4 — Fabric job instance errors not queried [REGRESSION]
- **Location**: `monitoring.py:152-195` vs `server.py.bak:3010-3037`
- **Issue**: The old implementation also queried live Fabric job instances (`get_fabric_job_instances()`) for failed jobs with `failureReason`. This source was dropped in the refactored version. This means errors that occur at the Fabric pipeline orchestration level (outside the v3 engine) would not appear.
- **Impact**: Fabric-level pipeline failures (timeouts, gateway errors, capacity errors) are invisible to the Error Intelligence page.
- **Fix**: Optionally re-add Fabric job instance error collection as a secondary source alongside `engine_task_log`.

---

## Summary

| # | Data Point | Source Table(s) | Status |
|---|-----------|----------------|--------|
| 1 | Response shape | N/A | **COMPLETE MISMATCH** (B1) |
| 2 | Pipeline failures | **PipelineExecution (MISSING)** | **BROKEN** (B2) |
| 3 | Failure counts by pipeline | **PipelineExecution (MISSING)** | **BROKEN** (B2) |
| 4 | Notebook failures | **NotebookExecution (MISSING)** | **BROKEN** (B2) |
| 5 | Copy activity failures | **CopyActivityExecution (MISSING)** | **BROKEN** (B2) |
| 6 | Frontend consumption | N/A | Shows empty state always |

**Overall verdict**: This page is **100% non-functional**. It has two compounding critical failures:
1. All SQL queries reference Fabric SQL table names that don't exist in SQLite (silent failures, empty results)
2. Even if the queries returned data, the backend response shape is completely different from what the frontend expects -- the entire error classification/aggregation/categorization pipeline from `server.py.bak` was not ported

The page always renders the "No Pipeline Errors" green checkmark state, which is misleading when there are actual errors in the system. The correct fix requires both rewriting the SQL queries against the correct SQLite tables AND porting the ~150 lines of error intelligence processing logic from the old implementation.

The most impactful improvement would be to build the error intelligence from `engine_task_log` (which already has `ErrorType`, `ErrorMessage`, `ErrorSuggestion` columns) rather than trying to reconstruct errors from the audit logging tables.
