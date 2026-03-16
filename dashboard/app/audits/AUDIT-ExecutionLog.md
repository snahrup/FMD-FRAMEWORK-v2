# AUDIT: ExecutionLog
**File**: `dashboard/app/src/pages/ExecutionLog.tsx`
**Backend routes**: `dashboard/app/api/routes/pipeline.py`, `dashboard/app/api/routes/monitoring.py`
**DB layer**: `dashboard/app/api/db.py` (thin wrapper around `fmd_control_plane.db`)
**Audited**: 2026-03-13
**Focus**: Data source correctness

---

## Architecture Summary

ExecutionLog has three tabs that each call a separate API endpoint:

1. **Pipeline Runs** -> `GET /api/pipeline-executions` -> `pipeline.py`
2. **Copy Activities** -> `GET /api/copy-executions` -> `monitoring.py`
3. **Notebook Runs** -> `GET /api/notebook-executions` -> `monitoring.py`

The frontend normalizes all three into a common `PipelineRun` shape via `normalizeRun()`.

---

## Data Points Verified

### 1. Pipeline Runs Tab
- **Frontend call** (line 181): `fetch('/api/pipeline-executions')`
- **Frontend expects**: Array of objects with fields usable by `normalizeRun()`. Key fields: `PipelineName`, `LogType`, `LogDateTime`, `PipelineRunGuid`, `EntityLayer`, `Status`, `StartTime`, `EndTime`, `ErrorMessage`.
- **Backend route** (pipeline.py:333-335): `SELECT * FROM pipeline_audit ORDER BY id DESC LIMIT 500`
- **Schema**: `pipeline_audit` columns: `id`, `PipelineRunGuid`, `PipelineName`, `EntityLayer`, `TriggerType`, `LogType`, `LogDateTime`, `LogData`, `EntityId`, `created_at`. 4 rows exist.
- **Frontend normalization** (lines 44-75): `normalizeRun()` maps:
  - `LogType` -> `Status` (via `normalizeLogType()` which maps e.g. `EndPipeline`->`Succeeded`, `FailPipeline`->`Failed`)
  - `LogDateTime` -> `StartTime` (fallback if `StartTime` missing)
- **Status**: PARTIALLY CORRECT
- **Issue**: See B1 below.

### 2. Copy Activities Tab
- **Frontend call** (line 182): `fetch('/api/copy-executions')`
- **Frontend expects**: Array of objects. Key fields expected by `normalizeRun()`: `CopyActivityName`, `Status`, `StartTime`, `EndTime`, `CopyActivityExecutionId`.
- **Backend route** (monitoring.py:134-138): `SELECT * FROM CopyActivityExecution ORDER BY CopyActivityExecutionId DESC`
- **Schema**: **TABLE `CopyActivityExecution` DOES NOT EXIST** in SQLite. The actual table is `copy_activity_audit`.
- **Status**: **BROKEN** -- query will fail silently (wrapped in `_safe_query` which returns `[]` on error)
- **Issue**: See B2 below.

### 3. Notebook Runs Tab
- **Frontend call** (line 183): `fetch('/api/notebook-executions')`
- **Frontend expects**: Array of objects. Key fields: `NotebookName`, `Status`, `StartTime`, `EndTime`, `NotebookExecutionId`.
- **Backend route** (monitoring.py:141-145): `SELECT * FROM NotebookExecution ORDER BY NotebookExecutionId DESC`
- **Schema**: **TABLE `NotebookExecution` DOES NOT EXIST** in SQLite. The actual table is `notebook_executions`.
- **Status**: **BROKEN** -- query will fail silently (wrapped in `_safe_query` which returns `[]` on error)
- **Issue**: See B3 below.

### 4. Status Normalization
- **Frontend** (lines 34-41): `normalizeLogType()` handles LogType values from `pipeline_audit`:
  - `succeeded`/`endpipeline`/`endcopyactivity`/`endnotebook` -> `Succeeded`
  - `failed`/`failpipeline`/`pipelineerror`/`error` -> `Failed`
  - `inprogress`/`startpipeline`/`startcopyactivity`/`startnotebook`/`running` -> `InProgress`
  - `cancelled`/`canceled` -> `Cancelled`
  - `queued` -> `Queued`
- **Status**: CORRECT for `pipeline_audit` data. Moot for copy/notebook tabs since they return empty arrays.

### 5. Row Key Generation
- **Frontend** (lines 78-89): `rowKey()` function tries:
  - `PipelineExecutionId` -- from Fabric SQL `logging.PipelineExecution` (NOT in SQLite)
  - `CopyActivityExecutionId` -- from Fabric SQL `logging.CopyActivityExecution` (NOT in SQLite)
  - `NotebookExecutionId` -- from Fabric SQL `logging.NotebookExecution` (NOT in SQLite)
  - `PipelineRunGuid` + `LogType` + `LogDateTime` -- from `pipeline_audit` (this works)
  - `RunId` -- from `engine_runs`
- **Status**: CORRECT for the pipeline tab (falls through to PipelineRunGuid combo). Would be correct for copy/notebook if they returned data.

### 6. Quick Stats
- **Frontend** (lines 252-260): Counts `succeeded`, `failed`, `running` from normalized Status field
- **Source**: Computed from the same tab data
- **Status**: CORRECT (for pipeline tab), empty for copy/notebook tabs

### 7. Duration Calculation
- **Frontend** (lines 93-103): `humanDuration(startStr, endStr)` computes diff between StartTime and EndTime
- **Issue for pipeline_audit**: `pipeline_audit` only has `LogDateTime` (one timestamp per log event), no `EndTime`. The normalizer maps `LogDateTime` -> `StartTime`, but there's no `EndTime`, so duration will always show as "---" for pipeline audit rows.
- **Status**: WRONG for pipeline tab (no end time available)
- **Issue**: See B4 below.

### 8. Business View Summary
- **Frontend** (lines 140-158): `businessSummary(run)` builds human-readable text from `Name`, `Status`, duration, and `ErrorMessage`
- **For pipeline_audit**: `Name` comes from `PipelineName` (via normalizeRun fallback). `ErrorMessage` comes from `ErrorSummary` (via normalizeRun, line 67). Neither `ErrorMessage` nor `ErrorSummary` exists in `pipeline_audit` -- it has `LogData` instead.
- **Status**: PARTIAL -- pipeline name works, error message is missing
- **Issue**: See B5 below.

---

## Bugs Found

### B1 — Pipeline Runs show audit log rows, not execution records [SEMANTIC MISMATCH]
- **Location**: `pipeline.py:333-335`
- **Issue**: The endpoint queries `pipeline_audit` which is a **logging table** with one row per pipeline event (StartPipeline, EndPipeline, Error, etc.). It is NOT a one-row-per-execution table. The Execution Log page is designed to show pipeline runs as complete executions, but instead shows individual log entries. A single pipeline run that logged Start + End would appear as 2 separate rows.
- **Root cause**: The original `server.py.bak` queried `logging.PipelineExecution` from Fabric SQL, which has one row per execution with `Status`, `StartDateTime`, `EndDateTime`, `ErrorMessage`. The refactored route substituted `pipeline_audit` (a logging events table) without restructuring the data into execution-level rows.
- **Impact**: Each pipeline execution appears as multiple rows (one per LogType event). Users see duplicated/confusing entries.
- **Fix**: Either (a) query `engine_runs` for pipeline-level execution history, or (b) aggregate `pipeline_audit` by `PipelineRunGuid` to collapse events into single execution rows, or (c) create a view/query that reconstructs execution records from audit events.

### B2 — Copy Executions queries non-existent table `CopyActivityExecution` [CRITICAL]
- **Location**: `monitoring.py:134-138`
- **Issue**: `SELECT * FROM CopyActivityExecution ORDER BY CopyActivityExecutionId DESC` -- the table `CopyActivityExecution` does not exist in SQLite. The actual table is `copy_activity_audit` with different column names (`id` not `CopyActivityExecutionId`, `CopyActivityName`, `LogType`, `LogDateTime`, etc.).
- **Root cause**: This query was copied verbatim from the Fabric SQL path (`logging.CopyActivityExecution`) without being translated to the SQLite schema. The `_safe_query` wrapper silently swallows the error and returns `[]`.
- **Impact**: Copy Activities tab is always empty. Shows "No Execution Logs" regardless of data.
- **Fix**: Change to `SELECT * FROM copy_activity_audit ORDER BY id DESC LIMIT 500`.

### B3 — Notebook Executions queries non-existent table `NotebookExecution` [CRITICAL]
- **Location**: `monitoring.py:141-145`
- **Issue**: `SELECT * FROM NotebookExecution ORDER BY NotebookExecutionId DESC` -- the table `NotebookExecution` does not exist in SQLite. The actual table is `notebook_executions` with different column names (`id` not `NotebookExecutionId`).
- **Root cause**: Same as B2 -- Fabric SQL table name not translated to SQLite.
- **Impact**: Notebook Runs tab is always empty.
- **Fix**: Change to `SELECT * FROM notebook_executions ORDER BY id DESC LIMIT 500`.

### B4 — Duration always shows "---" for pipeline audit rows [MODERATE]
- **Location**: Frontend `humanDuration()` (line 93) and `normalizeRun()` (line 51-65)
- **Issue**: `pipeline_audit` rows have a single `LogDateTime` column, not separate Start/End timestamps. `normalizeRun()` maps `LogDateTime` -> `StartTime`, but `EndTime` remains null. Duration = `humanDuration(StartTime, null)` = "---".
- **Root cause**: The original Fabric SQL `PipelineExecution` table had both `StartDateTime` and `EndDateTime`. The SQLite `pipeline_audit` is a logging events table with only `LogDateTime`.
- **Impact**: Duration column is always blank on Pipeline Runs tab.
- **Fix**: If execution records are reconstructed from audit events (see B1 fix), pair Start/End events to compute duration. Alternatively, if switching to `engine_runs`, it has `StartedAt` and `EndedAt`.

### B5 — Error message missing for pipeline audit rows [MODERATE]
- **Location**: Frontend `normalizeRun()` (lines 66-68) and `businessSummary()` (line 149)
- **Issue**: `normalizeRun()` looks for `ErrorMessage` or `ErrorSummary` fields, but `pipeline_audit` stores error details in `LogData` (a JSON blob), not a dedicated error message column. The business view for failed pipeline runs will say "failed" without any error details.
- **Root cause**: Schema mismatch between Fabric SQL `PipelineExecution.ErrorMessage` and SQLite `pipeline_audit.LogData`.
- **Impact**: Failed pipeline runs show no error context in the business view.
- **Fix**: Extract error information from `LogData` JSON, or parse it in `normalizeRun()`.

### B6 — frontend references `engine_runs` fields but route returns `pipeline_audit` [MINOR]
- **Location**: `normalizeRun()` lines 58-68
- **Issue**: The normalizer has fallback mappings for `StartedAt`->`StartTime`, `EndedAt`->`EndTime`, `ErrorSummary`->`ErrorMessage`, and `RunId` for row keys -- all of which are `engine_runs` column names. But the pipeline-executions endpoint returns `pipeline_audit` rows, which don't have these fields. The fallbacks are dead code for the current data source.
- **Impact**: No functional impact (the fallbacks simply don't match), but indicates the normalizer was designed for a different data source than what's being returned.
- **Note**: If the endpoint is changed to query `engine_runs` (as part of B1 fix), these mappings would become active and useful.

---

## Summary

| # | Data Point | Source Table(s) | Status |
|---|-----------|----------------|--------|
| 1 | Pipeline Runs tab | pipeline_audit | SEMANTIC MISMATCH (B1) |
| 2 | Copy Activities tab | **CopyActivityExecution (MISSING)** | **BROKEN** (B2) |
| 3 | Notebook Runs tab | **NotebookExecution (MISSING)** | **BROKEN** (B3) |
| 4 | Status normalization | (derived) | CORRECT |
| 5 | Row keys | (derived) | CORRECT |
| 6 | Quick stats | (derived) | CORRECT (for pipelines) |
| 7 | Duration | pipeline_audit | WRONG (B4) |
| 8 | Business summary | pipeline_audit | PARTIAL (B5) |

**Overall verdict**: 2 of 3 tabs are completely broken (query non-existent Fabric SQL table names). The working pipeline tab has semantic issues (shows log events not execution records, duration always blank, no error details). **This is the most broken page audited.** The root cause is that the refactored `monitoring.py` routes were only partially migrated from Fabric SQL to SQLite -- the copy-executions and notebook-executions endpoints still reference the old Fabric SQL table names that don't exist in the local database.
