# ExecutionLog Page Audit

> Generated 2026-03-10 | Auditor: Claude Agent

---

## 1. Architecture Overview

The ExecutionLog page (`dashboard/app/src/pages/ExecutionLog.tsx`) renders three tabs:

| Tab | API Endpoint | Backend Function | Data Source | SQLite Table |
|-----|-------------|-----------------|-------------|--------------|
| Pipeline Runs | `/api/pipeline-executions` | `get_pipeline_executions()` | Fabric SQL `logging.PipelineExecution` via `query_sql('SELECT * ...')` | `pipeline_audit` (exists but NOT used by this endpoint) |
| Copy Activities | `/api/copy-executions` | `get_copy_executions()` | Fabric SQL `logging.CopyActivityExecution` via `query_sql('SELECT * ...')` | `copy_activity_audit` (exists but NOT used) |
| Notebook Runs | `/api/notebook-executions` | `get_notebook_executions()` | Fabric SQL `logging.NotebookExecution` via `query_sql('SELECT * ...')` | **Does not exist in SQLite** |

All three endpoints hit Fabric SQL directly (`server.py` lines 1999-2024). There is **no SQLite fallback** for these endpoints, unlike engine/runs and engine/status which prefer SQLite. If Fabric SQL is unreachable, all three return `[]`.

---

## 2. Column Contracts

### 2a. Fabric SQL `logging.PipelineExecution` (`SELECT *`)

Populated by `sp_AuditPipeline` stored procedure. Columns (inferred from stored proc params + sync query):

| Column | Type | Source | Notes |
|--------|------|--------|-------|
| PipelineGuid | GUID | `@pipeline().Pipeline` | Pipeline artifact ID |
| PipelineName | String | `@pipeline().PipelineName` | Human-readable pipeline name |
| PipelineRunGuid | GUID | `@pipeline().RunId` | Unique per pipeline run |
| PipelineParentRunGuid | GUID | `@pipeline()?.TriggeredByPipelineRunId` | Parent orchestrator run |
| PipelineParameters | String | Varies | JSON or null |
| TriggerType | String | `@pipeline().TriggerType` | "Manual", "Scheduled", "Engine" |
| TriggerGuid | GUID | `@pipeline().TriggerId` | |
| TriggerTime | DateTime | `@pipeline().TriggerTime` | When the pipeline was triggered |
| WorkspaceGuid | GUID | `@pipeline().DataFactory` | Workspace ID |
| EntityLayer | String | Hardcoded per pipeline | "Landingzone", "Bronze", "Silver" |
| EntityId | Int32 | From entity metadata | 0 for pipeline-level events, entity ID for entity-level |
| LogType | String | Hardcoded per activity | See LogType Values below |
| LogData | String | JSON or text | Varies (Action, Error details, etc.) |
| LogDateTime | DateTime | Auto-set by proc | When the log row was created |

**LogType values used in practice** (from pipeline JSON definitions + engine logging_db.py):

| LogType | Meaning | Used By |
|---------|---------|---------|
| `StartPipeline` | Pipeline execution started | PL_FMD_LOAD_BRONZE, PL_FMD_LOAD_SILVER, all COMMAND pipelines |
| `EndPipeline` | Pipeline completed successfully | Same |
| `FailPipeline` | Pipeline failed (error in ForEach/notebook) | Same |
| `InProgress` | Engine run started | engine/logging_db.py `_write_pipeline_audit()` |
| `Succeeded` | Engine run completed OK | engine/logging_db.py |
| `Failed` | Engine run failed | engine/logging_db.py |

### 2b. SQLite `pipeline_audit` (mirrored subset)

| Column | Type |
|--------|------|
| id | INTEGER AUTOINCREMENT |
| PipelineRunGuid | TEXT |
| PipelineName | TEXT |
| EntityLayer | TEXT |
| TriggerType | TEXT |
| LogType | TEXT |
| LogDateTime | TEXT |
| LogData | TEXT |
| EntityId | INTEGER |
| created_at | TEXT |

**Missing from SQLite vs Fabric SQL**: PipelineGuid, PipelineParentRunGuid, PipelineParameters, TriggerGuid, TriggerTime, WorkspaceGuid.

### 2c. Fabric SQL `logging.CopyActivityExecution` (`SELECT *`)

Populated by `sp_AuditCopyActivity`. Columns:

| Column | Type |
|--------|------|
| CopyActivityName | String |
| PipelineRunGuid | GUID |
| PipelineParentRunGuid | GUID |
| CopyActivityParameters | String |
| TriggerType | String |
| TriggerGuid | GUID |
| TriggerTime | DateTime |
| LogData | String |
| LogType | String |
| WorkspaceGuid | GUID |
| EntityId | Int32 |
| EntityLayer | String |
| LogDateTime | DateTime |

**CopyActivity LogType values**: `StartCopyActivity`, `EndCopyActivity` (from pipeline JSON defs), plus engine `succeeded`/`failed` (from `_write_copy_audit`).

### 2d. Fabric SQL `logging.NotebookExecution`

No stored proc definition found in repo. Used by notebooks via `sp_AuditNotebook`. Likely columns: NotebookName, PipelineRunGuid, EntityId, EntityLayer, LogType, LogDateTime, LogData.

**No SQLite mirror exists.** The `control_plane_db.py` has no `notebook_execution` table and no `get_notebook_executions()` function.

### 2e. SQLite `engine_runs` (separate table, different shape)

| Column | Type | Notes |
|--------|------|-------|
| RunId | TEXT PK | UUID string |
| Mode | TEXT | "full", "incremental", etc. |
| Status | TEXT | "InProgress", "Succeeded", "Failed" |
| TotalEntities | INTEGER | |
| SucceededEntities | INTEGER | |
| FailedEntities | INTEGER | |
| SkippedEntities | INTEGER | |
| TotalRowsRead | INTEGER | |
| TotalRowsWritten | INTEGER | |
| TotalBytesTransferred | INTEGER | |
| TotalDurationSeconds | REAL | |
| Layers | TEXT | |
| EntityFilter | TEXT | |
| TriggeredBy | TEXT | |
| ErrorSummary | TEXT | |
| StartedAt | TEXT | (not StartTime) |
| EndedAt | TEXT | (not EndTime) |
| updated_at | TEXT | |

This table is served by `/api/engine/runs`, NOT by `/api/pipeline-executions`. The ExecutionLog page does not currently fetch engine runs.

---

## 3. Bugs Found and Fixed

### 3a. normalizeLogType() -- missing LogType values (FIXED)

**Before**: Only recognized `endpipeline`, `endcopyactivity`, `endnotebookexecution`, `startpipeline`, `startcopyactivity`, `startnotebookexecution`, `failed`, `succeeded`, `inprogress`, `running`.

**Missing**:
- `FailPipeline` -- used by all COMMAND/LOAD pipelines on ForEach error (mapped to "Failed")
- `PipelineError` -- alternate error LogType
- `Error` -- generic error LogType
- `EndNotebook` / `StartNotebook` -- short forms used by some notebook audit calls

**After**: Added `failpipeline`, `pipelineerror`, `error`, `endnotebook`, `startnotebook` mappings.

### 3b. normalizeRun() -- incomplete field mappings (FIXED)

**Before**: Only mapped `LogType->Status`, `LogDateTime->StartTime`, `TriggerTime->StartTime`, `Name` unification.

**Missing**:
- `StartedAt -> StartTime` (engine_runs table)
- `EndedAt -> EndTime` (engine_runs table)
- `ErrorSummary -> ErrorMessage` (engine_runs table)

**After**: Added all three mappings.

### 3c. Row keys -- nonexistent field names (FIXED)

**Before**: Used `PipelineExecutionId`, `CopyActivityExecutionId`, `NotebookExecutionId` as keys, but these columns may not exist (Fabric SQL uses auto-increment IDs that may have different names, and SQLite `pipeline_audit` has `id` as primary key). When all three were null, fell back to array index, causing React key collisions if filtering changed the order.

**After**: New `rowKey()` function with proper fallback chain:
1. `PipelineExecutionId` / `CopyActivityExecutionId` / `NotebookExecutionId` (Fabric SQL auto-IDs)
2. `PipelineRunGuid + LogType + LogDateTime` (composite key for SQLite rows where PipelineRunGuid alone is not unique)
3. `RunId` (engine_runs table)
4. Array index (last resort)

### 3d. Sort logic -- reverse() instead of proper sort (FIXED)

**Before**: `if (sortDir === 'asc') filtered = [...filtered].reverse()` -- assumed API always returns newest first, and flipping = oldest first. This was wrong because:
- Fabric SQL `SELECT * ORDER BY 1 DESC` orders by first column (PipelineGuid), not by time
- If filtering removed rows, the reverse wouldn't preserve chronological order

**After**: Proper `.sort()` comparing `StartTime` (post-normalization) with null handling.

### 3e. API response parsing -- no safety for malformed JSON (FIXED)

**Before**: `plRes.ok ? await plRes.json() : []` -- if the API returned HTTP 200 but with non-array JSON (e.g. `{error: "..."}`) or invalid JSON, this would crash.

**After**: Added `safeParse()` helper that catches JSON parse errors and validates the response is an array.

### 3f. Status filter -- missing "Queued" option (FIXED)

**Before**: Status filter dropdown had "All", "Succeeded", "Failed", "Running", "Cancelled" but no "Queued" option, even though `normalizeLogType()` returns "Queued" and `getStatusInfo()` renders it.

**After**: Added `<option value="queued">Queued</option>`.

---

## 4. Backend Issues (NOT fixed, documenting only)

### 4a. No SQLite fallback for execution log endpoints

`/api/pipeline-executions`, `/api/copy-executions`, `/api/notebook-executions` all call Fabric SQL directly via `query_sql()`. Unlike `/api/engine/runs` and `/api/engine/status` (which check `_cpdb_available()` first), these endpoints have zero SQLite integration.

**Impact**: When Fabric SQL Analytics Endpoint has sync lag (2-30 min) or is unreachable, these endpoints return stale data or `[]`.

**Recommended fix**: In `server.py`, wrap these three endpoints with `_cpdb_available()` checks, falling back to `cpdb.get_pipeline_executions()` and `cpdb.get_copy_executions()`. For notebooks, either add a `notebook_audit` table to `control_plane_db.py` or accept that tab will be empty without Fabric SQL.

### 4b. No notebook execution table in SQLite

`control_plane_db.py` has `pipeline_audit` and `copy_activity_audit` tables but no `notebook_audit` or `notebook_execution` table. The background sync (`_sync_fabric_to_sqlite()`) syncs pipeline_audit but NOT copy_activity_audit or notebook_execution.

**Impact**: The "Notebook Runs" tab is entirely dependent on Fabric SQL. Zero data available locally.

### 4c. Background sync only syncs pipeline_audit, not copy_activity_audit

`_sync_fabric_to_sqlite()` (server.py line 351-363) syncs `logging.PipelineExecution -> pipeline_audit` but does not sync `logging.CopyActivityExecution -> copy_activity_audit`. The engine dual-writes copy audits to SQLite, but notebook/pipeline-triggered copy activities only go to Fabric SQL.

### 4d. SELECT * is fragile

`get_pipeline_executions()` uses `SELECT * FROM logging.PipelineExecution`. If columns are added to the Fabric SQL table, they'll appear in the API response and show up as extra columns in the technical view. This is actually a feature (auto-discovery), but means column ordering is unpredictable and the frontend can't assume a fixed schema.

### 4e. Pipeline audit events are NOT grouped by run

Each call to `sp_AuditPipeline` creates a separate row. A single pipeline run generates at least 2 rows (StartPipeline + EndPipeline), and a ForEach pipeline generates many more. The "Pipeline Runs" tab shows individual log events, not aggregated runs. `control_plane_db.py` has a `get_pipeline_runs_grouped()` function that aggregates by PipelineRunGuid, but it is not used by any API endpoint.

**Impact**: With 18 pipeline_audit records from 6 runs, the Pipeline Runs tab shows 18 rows instead of ~6-9 logical pipeline executions. The business view shows "PL_FMD_LOAD_BRONZE is currently running" and "PL_FMD_LOAD_BRONZE completed successfully" as separate cards.

---

## 5. Rendering with Current Data (6 engine runs + 18 pipeline audits + 0 task logs)

| Tab | Expected Rows | Notes |
|-----|--------------|-------|
| Pipeline Runs | 18 | Individual log events from `logging.PipelineExecution`. Mix of StartPipeline/EndPipeline/FailPipeline events. Each shows as a separate card in business view. |
| Copy Activities | 0+ | Only if Fabric SQL has `logging.CopyActivityExecution` rows. Engine dual-writes here too. |
| Notebook Runs | 0 | No `logging.NotebookExecution` table in SQLite, Fabric SQL may have rows. |

**Empty state**: Works correctly. When `stats.total === 0`, shows "No runs recorded yet". When filtered to zero, shows "No runs match your current filters".

**Note**: The 6 engine runs are served by `/api/engine/runs`, NOT `/api/pipeline-executions`. They do NOT appear in the ExecutionLog page. However, the engine also dual-writes to `pipeline_audit` (via `_write_pipeline_audit`), so engine-originated events DO appear in the Pipeline Runs tab with LogType values like "InProgress", "Succeeded", "Failed" and PipelineName = "FMD_ENGINE_V3".

---

## 6. Files Audited

| File | Path | Role |
|------|------|------|
| ExecutionLog.tsx | `dashboard/app/src/pages/ExecutionLog.tsx` | React page component |
| server.py | `dashboard/app/api/server.py` | API server, routes at lines 8413-8446 |
| control_plane_db.py | `dashboard/app/api/control_plane_db.py` | SQLite schema + read/write functions |
| logging_db.py | `engine/logging_db.py` | Dual-write audit logger (SQLite + Fabric SQL) |
| api.py | `engine/api.py` | Engine REST API handlers |
| PL_FMD_LOAD_BRONZE pipeline-content.json | `src/PL_FMD_LOAD_BRONZE.DataPipeline/pipeline-content.json` | Pipeline definition (sp_AuditPipeline params) |
