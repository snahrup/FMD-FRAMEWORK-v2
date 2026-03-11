# PipelineMonitor Page Audit

**File**: `dashboard/app/src/pages/PipelineMonitor.tsx` (2126 lines)
**Audited**: 2026-03-10

## Summary

PipelineMonitor is the primary pipeline operations page. It provides:
- Stats overview cards (Total Pipelines, Landing Zone, Transform, Orchestration)
- Quick Action buttons to trigger pipeline runs (LZ, Bronze, Silver, Full Load)
- Monitoring Hub table (Fabric API-backed job history, last 12 hours, status filter chips)
- Pipeline card list with search/category filter, real-time status badges
- Execution Log modal with activity runs view, pipeline/copy/notebook log tabs
- Failure trace investigation (recursive root cause drilling)
- Error interpretation (translates Fabric errors to plain English)

## API Endpoints Used

| Frontend Call | Server Endpoint | Handler | Data Source |
|---|---|---|---|
| `GET /api/pipelines` | `get_pipelines()` | `query_sql('SELECT * FROM integration.Pipeline')` | Fabric SQL |
| `GET /api/workspaces` | `get_workspaces()` | `query_sql('SELECT * FROM integration.Workspace')` | Fabric SQL |
| `GET /api/pipeline-executions` | `get_pipeline_executions()` | `query_sql('SELECT * FROM logging.PipelineExecution')` | Fabric SQL |
| `GET /api/copy-executions` | `get_copy_executions()` | `query_sql('SELECT * FROM logging.CopyActivityExecution')` | Fabric SQL |
| `GET /api/notebook-executions` | `get_notebook_executions()` | `query_sql('SELECT * FROM logging.NotebookExecution')` | Fabric SQL |
| `GET /api/fabric-jobs` | `get_fabric_job_instances()` | Fabric REST API (parallel, 15s cache) | Fabric API |
| `GET /api/pipeline-activity-runs` | `get_pipeline_activity_runs()` | Fabric REST API (queryactivityruns) | Fabric API |
| `GET /api/pipeline/failure-trace` | `trace_pipeline_failure()` | Fabric REST API (recursive) | Fabric API |
| `POST /api/pipeline/trigger` | `trigger_pipeline()` | Fabric REST API (jobs/instances) | Fabric API |

## Data Contract Verification

### Pipeline interface vs backend
- **Frontend expects**: `PipelineId`, `PipelineGuid`, `WorkspaceGuid`, `Name`, `IsActive` (all strings)
- **Backend returns**: `SELECT * FROM integration.Pipeline` via `query_sql()` which serializes all values with `str(v)`
- **IsActive check**: `p.IsActive === 'True'` — Python's pyodbc returns BIT as boolean, `str(True)` = `'True'`. **Correct.**
- **Risk**: If Fabric SQL Analytics Endpoint returns `1`/`0` instead of `True`/`False`, the filter would silently drop all pipelines. See Backend Issues.

### FabricJob interface vs backend
- **Frontend expects**: `id?`, `status`, `startTimeUtc?`, `endTimeUtc?`, `failureReason?`, `pipelineName`, `pipelineGuid`, `workspaceGuid`, `workspaceName`, `[key: string]: unknown`
- **Backend enriches** raw Fabric API response with `pipelineName`, `pipelineGuid`, `workspaceGuid`, `workspaceName`. **Contract matches.**

### TriggerResult interface vs backend
- **Frontend expects**: `success`, `pipelineName`, `pipelineGuid`, `workspaceGuid`, `status`, `location`
- **Backend returns**: all of the above plus `jobInstanceId` (extra field, harmlessly ignored). **Contract matches.**

### ActivityRun interface vs backend
- **Frontend expects**: `activityName`, `activityType`, `status`, `startTime`, `endTime`, `durationMs`, `error`, `input`, `output`, `activityRunId`, `rowCounts`
- **Backend normalizes** Fabric API response to match exactly. **Contract matches.**

### PipelineExecution (generic)
- **Frontend**: `[key: string]: string | null` — fully generic. Any column set works.
- **Backend**: `SELECT *` with `str(v)` serialization. **Contract matches.**

## Frontend Bugs Fixed

### 1. Missing `relative` on ping animation container (line 1705)
**Severity**: Visual (minor)
**Problem**: The animated ping indicator on Quick Action buttons had `absolute` positioning inside a parent without `relative`, causing the ping to escape its container and position relative to the Button instead.
**Fix**: Added `relative` to outer `<span>` and changed inner `h-2 w-2` to `h-full w-full` to match the correct pattern used elsewhere (lines 968, 1739).

### 2. Missing `relative` on activity card for connector line (line 1100)
**Severity**: Visual (minor)
**Problem**: The connector line between activity cards in the Execution Log modal used `absolute` positioning, but the parent div lacked `relative`. The connector would position relative to the modal container instead of the individual card.
**Fix**: Added `relative` to the activity card container div.

### 3. Monitoring Hub shows '--' for active job duration (line 1831)
**Severity**: UX inconsistency
**Problem**: The pipeline card view correctly showed elapsed time for running jobs (via `PipelineStatusDetail`), but the Monitoring Hub table showed '--' for in-progress jobs, making it impossible to see how long a job has been running.
**Fix**: Added `isActive` check to compute elapsed time (`formatDuration(start, undefined)`) for active jobs without an `endTimeUtc`.

## Backend Issues (NOT Fixed — Document Only)

### 1. IsActive BIT serialization fragility
**Risk**: Medium
**Location**: `server.py:query_sql()` line 201, `PipelineMonitor.tsx` line 1523
**Problem**: `query_sql` uses `str(v)` to serialize all SQL values. For BIT columns, pyodbc returns Python `bool`, so `str(True)` = `'True'`. The frontend checks `p.IsActive === 'True'`. If the SQL connection path changes (e.g., through the SQL Analytics Endpoint which may return `1`/`0` for BIT columns), this comparison would silently fail and no pipelines would display.
**Recommendation**: Normalize the BIT/boolean value server-side: return `True`/`False` as explicit JSON booleans instead of relying on `str()` coercion of the raw pyodbc value.

### 2. SQLite pipelines table missing PipelineGuid and WorkspaceGuid columns
**Risk**: Low (currently not used for this page)
**Location**: `control_plane_db.py` lines 85-91, 750-758
**Problem**: The SQLite `pipelines` table only stores `PipelineId`, `Name`, `IsActive`. The frontend requires `PipelineGuid` and `WorkspaceGuid`. If `/api/pipelines` is ever routed through SQLite (like other endpoints are), the page would break — pipeline cards wouldn't show workspace info, and the trigger/run buttons would fail.
**Recommendation**: Add `PipelineGuid` and `WorkspaceGuid` columns to the SQLite `pipelines` table and populate them during sync.

### 3. Pipeline execution logs depend on Fabric SQL logging tables
**Risk**: Medium
**Location**: `server.py:get_pipeline_executions()` lines 2024-2031
**Problem**: `logging.PipelineExecution`, `logging.CopyActivityExecution`, and `logging.NotebookExecution` tables in Fabric SQL are populated by pipeline notebooks. If no pipelines have run, these tables may not exist, returning empty arrays (gracefully handled with try/catch). However, there's no SQLite fallback for these endpoints, unlike most other read endpoints.
**Recommendation**: Consider syncing execution data to SQLite, or note that these tables are expected to be empty until first pipeline run. Current error handling is adequate.

### 4. Fabric jobs cache can serve stale data during first load
**Risk**: Low
**Location**: `server.py:get_fabric_job_instances()` lines 2630-2633
**Problem**: The 15-second cache TTL means a freshly triggered pipeline won't appear in the Monitoring Hub for up to 15 seconds. The frontend mitigates this with local `activeRuns` state for triggered pipelines, but the Monitoring Hub table specifically shows only Fabric API data.
**Recommendation**: Accept as designed — the 15s cache is a reasonable tradeoff to avoid hammering the Fabric API. The frontend's local run tracking bridges the gap.

## Empty Data Behavior

With 0 registered pipelines in SQLite and Fabric SQL returning actual data:
- **Stats cards**: Show correct counts from `activePipelines.length` and category breakdowns
- **Quick Actions**: Render correctly; buttons trigger via API regardless of local pipeline count
- **Monitoring Hub**: Shows "No recent runs" empty state with helpful text when no jobs exist
- **Pipeline list**: Shows "No pipelines match your search" when filtered list is empty
- **Execution Log modal**: Shows appropriate empty states per tab
- **No execution data banner**: Shows info banner when both `executions` and `fabricJobs` are empty

All empty states handle gracefully with descriptive messages and icons.

## Null Safety

- `FabricJob.failureReason` is typed as `string | Record<string, unknown> | null` — `interpretFailureReason()` handles all cases
- `PipelineExecution` values are `string | null` — `formatCellValue()` handles nulls with '--'
- `ActivityRun.error` is `Record<string, unknown>` — error message extraction uses `?.` chaining
- `fabricJobs.find()` may return undefined — handled with `?.` and fallback checks
- `localStorage.getItem/setItem` wrapped in try/catch for SSR safety

## Performance Notes

- Fabric jobs polling uses adaptive backoff: 10s when active, doubles to 30s/60s when idle
- Tab visibility check skips polls when page is hidden
- Parallel pipeline data fetching with ThreadPoolExecutor (6 workers)
- Module-level singleton cache (15s TTL) for fabric jobs
- `hasLoadedOnce` ref prevents full-page spinner on subsequent refreshes
