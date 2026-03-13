# AUDIT: PipelineMonitor
**File**: `dashboard/app/src/pages/PipelineMonitor.tsx` (2130 lines)
**Backend**: `dashboard/app/api/routes/pipeline.py`, `dashboard/app/api/routes/monitoring.py`, `dashboard/app/api/routes/source_manager.py`
**DB layer**: `dashboard/app/api/db.py` (thin wrapper around `fmd_control_plane.db`)
**Audited**: 2026-03-13
**Focus**: Data source correctness — every metric, KPI, count, and table traced from frontend to SQL

---

## Summary

PipelineMonitor is a dual-source page: pipeline metadata comes from SQLite, and live run status comes from the Fabric REST API. The SQLite data paths are mostly correct. The Fabric API data paths are architecturally sound. However, there are several broken table references in monitoring.py and a field-name mismatch where the frontend tries to read columns that don't exist in the `pipeline_audit` table.

**Bugs found: 6 (4 critical, 2 moderate)**

---

## Data Points Verified

### 1. Pipeline List (Pipeline Cards + KPI cards)
- **Frontend fetches**: `GET /api/pipelines` (line 1355)
- **Backend** (pipeline.py:312-313): `SELECT * FROM pipelines ORDER BY PipelineId`
- **Schema**: `pipelines` table has columns `PipelineId, Name, IsActive, updated_at, PipelineGuid, WorkspaceGuid` — 6 rows
- **Frontend interface** (line 17-23): expects `PipelineId, PipelineGuid, WorkspaceGuid, Name, IsActive` — all present
- **Status**: CORRECT

### 2. Pipeline Executions (Execution Log + Active Run Status Polling)
- **Frontend fetches**: `GET /api/pipeline-executions` (line 1356, 826, 1466)
- **Backend** (pipeline.py:333-335): `SELECT * FROM pipeline_audit ORDER BY id DESC LIMIT 500`
- **Schema**: `pipeline_audit` has columns `id, PipelineRunGuid, PipelineName, EntityLayer, TriggerType, LogType, LogDateTime, LogData, EntityId, created_at`
- **Status**: WRONG — see **B1** below

### 3. Workspaces (Pipeline Card workspace label)
- **Frontend fetches**: `GET /api/workspaces` (line 1357)
- **Backend** (source_manager.py:293-295): `SELECT * FROM workspaces ORDER BY WorkspaceId`
- **Schema**: `workspaces` table has `WorkspaceId, WorkspaceGuid, Name, updated_at` — 5 rows
- **Frontend interface** (line 29-33): expects `WorkspaceId, WorkspaceGuid, Name` — all present
- **Usage**: Maps `pipeline.WorkspaceGuid` to workspace `Name` for display (line 1972)
- **Status**: CORRECT

### 4. Fabric Jobs (Monitoring Hub table + Status Badges)
- **Frontend fetches**: `GET /api/fabric-jobs` (line 1372, 1431, 1467)
- **Backend** (pipeline.py:338-345): Calls `_get_fabric_job_instances()` which hits the Fabric REST API (`/v1/workspaces/{id}/items` then `/jobs/instances` per pipeline). Returns array of Fabric job objects enriched with `pipelineName` and `workspaceId`.
- **Frontend interface** (line 52-63): expects `id, status, startTimeUtc, endTimeUtc, failureReason, pipelineName, pipelineGuid, workspaceGuid, workspaceName`
- **Status**: MOSTLY CORRECT — see **B2** below

### 5. Activity Runs (Execution Log Modal — Activity Runs tab)
- **Frontend fetches**: `GET /api/pipeline-activity-runs?workspaceGuid=X&jobInstanceId=Y` (line 812-813)
- **Backend** (pipeline.py:348-365): Hits Fabric REST API `/v1/workspaces/{ws}/datapipelines/pipelineruns/{jobId}/activityruns`
- **Frontend interface** (line 721-733): expects `activityName, activityType, status, startTime, endTime, durationMs, error, input, output, activityRunId, rowCounts`
- **Source**: Live Fabric API response. The `rowCounts` field (line 714-719) expects `rowsRead, rowsWritten, dataRead, dataWritten` — these come from the Fabric activity run output if available.
- **Status**: CORRECT — Fabric API returns these fields natively for copy activities.

### 6. Copy Executions (Execution Log Modal — Copy Activities tab)
- **Frontend fetches**: `GET /api/copy-executions` (line 827)
- **Backend** (monitoring.py:134-138): `SELECT * FROM CopyActivityExecution ORDER BY CopyActivityExecutionId DESC`
- **Schema**: Table `CopyActivityExecution` DOES NOT EXIST. Actual table is `copy_activity_audit`.
- **Status**: WRONG — see **B3** below

### 7. Notebook Executions (Execution Log Modal — Notebooks tab)
- **Frontend fetches**: `GET /api/notebook-executions` (line 828)
- **Backend** (monitoring.py:141-144): `SELECT * FROM NotebookExecution ORDER BY NotebookExecutionId DESC`
- **Schema**: Table `NotebookExecution` DOES NOT EXIST. Actual table is `notebook_executions`.
- **Status**: WRONG — see **B4** below

### 8. Pipeline Trigger (Quick Actions + Play button)
- **Frontend calls**: `POST /api/pipeline/trigger` with `{ pipelineName }` (line 1509)
- **Backend** (pipeline.py:414-419): Validates pipeline name, calls `_trigger_pipeline()` which looks up `PipelineGuid, WorkspaceGuid` from SQLite `pipelines` table, resolves the CODE workspace, then calls Fabric API to trigger.
- **Response** (line 223-231): `{ success, pipelineName, pipelineGuid, workspaceGuid, jobInstanceId, status, location }`
- **Frontend interface** (line 35-42): matches exactly
- **Status**: CORRECT

### 9. Failure Trace (Monitoring Hub — failed job error rows)
- **Frontend fetches**: `GET /api/pipeline/failure-trace?workspaceGuid=X&jobInstanceId=Y&pipelineName=Z` (line 577-578)
- **Backend** (pipeline.py:381-407): Hits Fabric API for activity runs, filters to failed activities, returns `{ jobInstanceId, pipelineName, failedActivities, totalActivities }`
- **Frontend interface** (line 559-562): expects `{ trail: FailureTrailStep[], rootCause: FailureTrailStep | null }`
- **Status**: WRONG — see **B5** below

### 10. KPI Cards — Stats Overview (4 cards)
- **"Total Pipelines"** (line 1660): `activePipelines.length` where `activePipelines = pipelines.filter(p => p.IsActive === 'True')` (line 1523)
  - Source: `/api/pipelines` → `pipelines` table, filtered client-side by `IsActive === 'True'`
  - **Status**: WRONG — see **B6** below. `IsActive` is stored as integer `1` in SQLite, serialized as number `1` in JSON. The comparison `=== 'True'` (strict string equality) always fails, making `activePipelines` an empty array. All 4 KPI cards show 0 and the pipeline card list is empty.

- **"Landing Zone"** (line 1661): `categoryCounts['Landing Zone'] || 0` — counts from `activePipelines` grouped by category name matching. If `activePipelines` is empty due to B6, this is always 0.
- **"Transform"** (line 1662): `(categoryCounts['Bronze'] || 0) + (categoryCounts['Silver'] || 0)` — same dependency.
- **"Orchestration"** (line 1663): `categoryCounts['Orchestration'] || 0` — same dependency.
- **Sub-labels** are static strings, not data-driven. CORRECT.

### 11. Framework Status sidebar card
- **"Pipelines Deployed"** (line 2113): `activePipelines.length` — same B6 dependency
- **"Workspaces"** (line 2114): `workspaces.length` — CORRECT (comes from `/api/workspaces`)
- **"Active Runs"** (line 2115): `runningCount` — computed as `fabricJobs.filter(j => status is inprogress/running/notstarted).length || activeRuns.filter(r => status is triggered/running).length` (line 1588-1591). This is correct — it's from live Fabric API.
- **"Execution Logs"** (line 2116): `executions.length` — from `/api/pipeline-executions` which queries `pipeline_audit`. Shows raw row count. CORRECT (4 rows exist per schema reference).

### 12. Pipeline Distribution bar chart
- Source: `chartData` computed from `categoryCounts` (line 1576-1586), which groups `activePipelines` by `categorize()` function.
- **Dependency on B6**: If `activePipelines` is empty, chart shows no bars.
- The categorization logic itself is correct: checks pipeline `Name` for `_LDZ_`/`LANDING` (Landing Zone), `_BRONZE_`/`_BRZ_` (Bronze), `_SILVER_`/`_SLV_` (Silver), `_LOAD_`/`_TASKFLOW_` (Orchestration), else Utility.
- **Status**: Logic CORRECT, but data may be empty due to B6.

### 13. Running count (header subtitle)
- `runningCount` (line 1588-1591): Counts from `fabricJobs` where status is in-progress/running/notstarted. Falls back to local `activeRuns` count.
- **Status**: CORRECT — live Fabric API data.

### 14. Monitoring Hub status filter chip counts
- Computed inline (line 1750-1761) from `fabricJobs` filtered to last 12 hours.
- Uses `parseFabricTime()` for time comparison and `normalizeFabricStatus()` for bucketing.
- Status bucketing: inprogress/running/none → "In Progress"; completed → "Succeeded"; failed → "Failed"; cancelled/deduped → "Cancelled"
- **Status**: CORRECT

### 15. Monitoring Hub table row data
- Each row shows: `pipelineName` (display name), `jobType` (item type), `status` (normalized), `duration` (computed from start/end time), `startTimeUtc`, `endTimeUtc`
- **Duration** (line 1830-1836): Uses `formatDuration(startTimeUtc, endTimeUtc)`. For active jobs with no end time, computes elapsed from start to now. For completed jobs without start time, shows '—'.
- **Status**: CORRECT — all fields come from Fabric API response.

### 16. Active Run status sync from pipeline_audit polling
- When `hasActiveRuns` is true, a 5-second poll (line 1463-1492) fetches `/api/pipeline-executions` and tries to match local active runs to execution log entries.
- The match logic (line 1477-1479): `execs.find(e => e.PipelineName === run.pipelineName && new Date(e.StartTime) >= run.triggeredAt)`
- **Status**: WRONG — see **B1** below. The `pipeline_audit` table has no `StartTime` column (it has `LogDateTime`), and no `Status` column (it has `LogType`).

---

## Bugs Found

### B1 (CRITICAL): Frontend accesses non-existent columns from `/api/pipeline-executions`

**Location**: PipelineMonitor.tsx lines 1477-1484
**Endpoint**: `GET /api/pipeline-executions`
**Backend SQL**: `SELECT * FROM pipeline_audit ORDER BY id DESC LIMIT 500`

The frontend's active-run polling logic accesses:
- `e.PipelineName` — EXISTS in `pipeline_audit` (line 1478)
- `e.StartTime` — DOES NOT EXIST. The actual column is `LogDateTime`. `new Date(e.StartTime as string)` will parse `undefined`, producing `Invalid Date`, so the comparison `>= run.triggeredAt` always fails.
- `match.Status` — DOES NOT EXIST. The actual column is `LogType`. `match.Status` is `undefined`, so the status checks against `'Succeeded'`, `'Failed'`, etc. never match.

**Impact**: The local active run status will NEVER be updated from `pipeline_audit` data. Active runs will remain in 'triggered' state until Fabric API polling resolves them (via `syncFabricJobsToActiveRuns`). This is a **functional dead code path** — the Fabric API sync at line 1380-1395 is the only path that actually works for status updates.

**Fix**: Either:
(a) Change the frontend to use the correct column names: `e.LogDateTime` instead of `e.StartTime`, `e.LogType` instead of `match.Status` (but LogType values like `'StartPipeline'`/`'EndPipeline'` don't match `'Succeeded'`/`'Failed'`)
(b) Create a proper grouped endpoint (e.g., expose `get_pipeline_runs_grouped()` via a `/api/pipeline-runs` route) that returns `StartTime`, `EndTime`, `Status` (derived), matching the frontend's expectations.

Option (b) is preferred — `get_pipeline_runs_grouped()` in `control_plane_db.py` already does the correct aggregation with derived `StartTime` and `EndTime` fields. It's used by `/api/control-plane` but NOT exposed as a standalone endpoint for PipelineMonitor.

---

### B2 (MODERATE): Fabric job response may not include `workspaceName`

**Location**: PipelineMonitor.tsx line 61 (FabricJob interface)
**Endpoint**: `GET /api/fabric-jobs`

The `FabricJob` interface declares `workspaceName: string` but the backend enrichment (pipeline.py:160-162) only adds `pipelineName` and `workspaceId` — it does NOT add `workspaceName`. The Fabric `/jobs/instances` API response also does not include a workspace name.

**Impact**: `job.workspaceName` is always `undefined`. However, searching the template code, `workspaceName` is defined in the interface but never accessed in the JSX render. No visible impact — purely a type interface inaccuracy.

**Severity**: Low — no visible data incorrectness, just a misleading type definition.

---

### B3 (CRITICAL): `/api/copy-executions` queries non-existent table

**Location**: monitoring.py line 136-138
**SQL**: `SELECT * FROM CopyActivityExecution ORDER BY CopyActivityExecutionId DESC`

The table `CopyActivityExecution` does not exist in the SQLite schema. The actual table is `copy_activity_audit` with columns `id, PipelineRunGuid, CopyActivityName, EntityLayer, TriggerType, LogType, LogDateTime, LogData, EntityId, CopyActivityParameters, created_at`. There is no `CopyActivityExecutionId` column.

**Impact**: The query silently fails (wrapped in `_safe_query` which returns `[]` on error). The "Copy Activities" tab in the Execution Log Modal always shows "No copy activity execution data yet."

**Fix**: Change the query to: `SELECT * FROM copy_activity_audit ORDER BY id DESC`

---

### B4 (CRITICAL): `/api/notebook-executions` queries non-existent table

**Location**: monitoring.py line 143-144
**SQL**: `SELECT * FROM NotebookExecution ORDER BY NotebookExecutionId DESC`

The table `NotebookExecution` does not exist in the SQLite schema. The actual table is `notebook_executions` with columns `id, NotebookName, PipelineRunGuid, EntityId, EntityLayer, LogType, LogDateTime, LogData, Status, StartedAt, EndedAt, created_at`. There is no `NotebookExecutionId` column.

**Impact**: The query silently fails. The "Notebooks" tab in the Execution Log Modal always shows "No notebook execution data yet."

**Fix**: Change the query to: `SELECT * FROM notebook_executions ORDER BY id DESC`

---

### B5 (MODERATE): Failure trace response shape mismatch

**Location**: PipelineMonitor.tsx line 559-562 vs pipeline.py line 399-404
**Endpoint**: `GET /api/pipeline/failure-trace`

The frontend expects:
```typescript
interface FailureTraceResult {
  trail: FailureTrailStep[];  // breadcrumb trail of failed activities
  rootCause: FailureTrailStep | null;  // deepest failure
}
```

The backend returns:
```python
{
    "jobInstanceId": ji,
    "pipelineName": pn,
    "failedActivities": failed,  # raw Fabric activity run objects
    "totalActivities": len(activities),
}
```

The response has no `trail` or `rootCause` field. The frontend will set `trace = { trail: undefined, rootCause: undefined }` and then:
- `trace.trail.length` at line 609 will throw a TypeError (cannot read `length` of undefined)
- The `catch` block at line 582-584 sets `trace = { trail: [], rootCause: null }` which shows "No activity-level failure details available" — so the error is gracefully caught.

**Impact**: The failure trace feature never renders the breadcrumb trail or root cause interpretation. It always shows the "no details" message. The `FailureTracePanel` component (line 564-653) is effectively dead code.

**Fix**: The backend needs to build a `trail` array of `FailureTrailStep` objects from the Fabric activity runs, traversing nested `ExecutePipeline` activities to find the root cause. Alternatively, the frontend could consume `failedActivities` directly.

---

### B6 (CRITICAL): `IsActive` string comparison breaks pipeline list and all KPI cards

**Location**: PipelineMonitor.tsx line 1523
**Code**: `const activePipelines = pipelines.filter(p => p.IsActive === 'True')`

The `pipelines` table defines `IsActive INTEGER DEFAULT 1`. The `upsert_pipeline()` function in `control_plane_db.py` (line 509) stores `row.get('IsActive', 1)` as a raw integer — it does NOT apply the `_v()` stringifier. So `IsActive` is stored as integer `1` in SQLite, serialized as number `1` in JSON, and received as number `1` in JavaScript. The strict comparison `=== 'True'` (string) against number `1` always fails.

**Note**: `ControlPlane.tsx` line 126-130 already has the correct `checkActive()` helper that handles `1`, `"1"`, `true`, and `"True"`. PipelineMonitor does not use this helper.

**Note**: This same `=== 'True'` pattern appears in AdminGovernance.tsx (6 instances), ConfigManager.tsx (5 instances), and SourceManager.tsx (6 instances). It is a codebase-wide issue, not unique to PipelineMonitor.

**Impact**: `activePipelines` is always empty, so:
- All 4 KPI cards show 0
- Pipeline card list is empty (no pipeline cards rendered)
- Pipeline Distribution chart is empty
- Framework Status "Pipelines Deployed" shows 0
- Quick Actions still work (they use hardcoded pipeline names, not the filtered list)
- Monitoring Hub still works (it uses `fabricJobs` from Fabric API, not pipelines table)

**Fix**: Replace `p.IsActive === 'True'` with a robust check like `ControlPlane.tsx`'s `checkActive()`: `String(p.IsActive).toLowerCase() === 'true' || String(p.IsActive) === '1' || p.IsActive === 1`

---

## Other Observations (Not Bugs)

### O1: `get_pipeline_runs_grouped()` is not exposed to PipelineMonitor

The `control_plane_db.py` function `get_pipeline_runs_grouped()` (line 936) does the correct aggregation: groups `pipeline_audit` by `PipelineRunGuid`, derives `StartTime`, `EndTime`, `ErrorData`, and `LogCount`. It also includes `Failed` and `Aborted` in the `EndTime` CASE expression (the known fix mentioned in context).

This function IS used by `/api/control-plane` (control_plane.py line 42) to build the ControlPlane page's `recentRuns` and `pipelineHealth` data. But it is NOT exposed as a standalone endpoint. PipelineMonitor's polling logic (B1) would benefit from a `/api/pipeline-runs` endpoint that returns the grouped/derived data.

### O2: Error Intelligence queries non-existent tables

monitoring.py lines 162-191: The `/api/error-intelligence` endpoint queries `PipelineExecution`, `NotebookExecution`, and `CopyActivityExecution` — three tables that don't exist. All three queries silently fail via `_safe_query()`. This endpoint is not used by PipelineMonitor but is documented and broken.

### O3: Dashboard Stats queries non-existent tables

monitoring.py lines 206-208: The `/api/stats` endpoint queries `LandingzoneEntity`, `BronzeLayerEntity`, `SilverLayerEntity` — these should be `lz_entities`, `bronze_entities`, `silver_entities`. Not used by PipelineMonitor.

### O4: `pipeline-executions` serves raw audit log rows, not aggregated runs

The `/api/pipeline-executions` endpoint (pipeline.py:333-335) returns raw `pipeline_audit` rows. Each pipeline run generates 2+ audit rows (Start, End, possibly Error). The Execution Log Modal's "Pipeline Log" tab (line 908) displays these as a flat table with dynamic columns, which is correct for a raw log view. But the active-run matching logic (B1) treats them as if they were aggregated run records with `StartTime` and `Status` fields.

### O5: Execution Log Modal polling is aggressive

The Execution Log Modal polls both `/api/pipeline-executions` and `/api/pipeline-activity-runs` every 4 seconds (line 846). Since `/api/pipeline-activity-runs` hits the live Fabric API on every call (no caching), this could cause API throttling. The main page's Fabric job poll uses exponential backoff (line 1420-1441), but the modal does not.

### O6: `parseFabricTime` fallback for missing timestamps

`parseFabricTime()` (line 247-253) returns `Date.now()` when the input is null/undefined. This means jobs with no `startTimeUtc` appear as if they started "just now" in the time filter and "just now" in the time-ago display. This is a reasonable default but could cause confusion if a job truly has no start time.

---

## Endpoints Used by PipelineMonitor

| Endpoint | Backend File | SQL / Source | Used For |
|----------|-------------|-------------|----------|
| `GET /api/pipelines` | pipeline.py:312 | `SELECT * FROM pipelines` | Pipeline list, KPI cards, chart |
| `GET /api/pipeline-executions` | pipeline.py:334 | `SELECT * FROM pipeline_audit LIMIT 500` | Execution log, active run polling |
| `GET /api/workspaces` | source_manager.py:293 | `SELECT * FROM workspaces` | Workspace name lookup |
| `GET /api/fabric-jobs` | pipeline.py:338 | Fabric REST API (cached 15s) | Monitoring Hub, status badges |
| `GET /api/pipeline-activity-runs` | pipeline.py:348 | Fabric REST API (live) | Activity Runs tab in modal |
| `GET /api/pipeline/failure-trace` | pipeline.py:381 | Fabric REST API (live) | Failure investigation |
| `POST /api/pipeline/trigger` | pipeline.py:414 | Fabric REST API (trigger) | Quick Actions, Play button |
| `GET /api/copy-executions` | monitoring.py:134 | BROKEN — wrong table name | Copy Activities tab in modal |
| `GET /api/notebook-executions` | monitoring.py:141 | BROKEN — wrong table name | Notebooks tab in modal |

---

## Bug Priority

| Bug | Severity | Impact | Effort |
|-----|----------|--------|--------|
| B1 | Critical | Active run status never updates from audit log | Medium — need new endpoint or column mapping fix |
| B3 | Critical | Copy Activities tab always empty | Low — rename table in SQL query |
| B4 | Critical | Notebooks tab always empty | Low — rename table in SQL query |
| B5 | Moderate | Failure trace never renders breadcrumb trail | High — needs backend logic to build trail |
| B6 | Critical | All KPI cards and pipeline list empty | Low — fix string comparison |
| B2 | Low | Type interface inaccuracy, no visible impact | Trivial |
