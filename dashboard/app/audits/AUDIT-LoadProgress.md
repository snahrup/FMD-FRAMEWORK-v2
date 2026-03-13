# AUDIT: LoadProgress.tsx — Data Source Correctness

**Date**: 2026-03-13
**Auditor**: Claude (Opus)
**Frontend**: `dashboard/app/src/pages/LoadProgress.tsx`
**Backend endpoint**: `GET /api/load-progress`
**Status**: BROKEN — endpoint does not exist

---

## Executive Summary

The LoadProgress page is **completely non-functional**. It calls `GET /api/load-progress` (line 175), but no backend handler is registered for this route. The router returns a 404, so the page always displays the error banner "HTTP 404" and shows zero data.

There is no partially-working state to audit further — the page has never loaded real data since the server was refactored to the decorator-based route registry.

---

## 1. Frontend API Call Trace

The entire page relies on a single fetch call:

| Component/Section | Data Field | Fetched From | Line |
|---|---|---|---|
| Overall progress hero | `overall.TotalEntities`, `LoadedEntities`, `PendingEntities`, `PctComplete` | `GET /api/load-progress` → `.overall` | 175 |
| KPI cards | `overall.PctComplete`, `PendingEntities`, `ElapsedSeconds`, `LastActivity` | same → `.overall` | 328-359 |
| Total rows loaded | sum of `loadedEntities[].RowsCopied` | same → `.loadedEntities` | 222 |
| Stacked progress bar | `bySource[].LoadedCount` / `overall.TotalEntities` | same → `.bySource` | 364-387 |
| Source progress cards | `bySource[].Source`, `TotalEntities`, `LoadedCount`, `PendingCount`, `PctComplete`, `LastLoaded` | same → `.bySource` | 407-461 |
| Concurrency timeline chart | `concurrencyTimeline[].time`, `concurrent`, `bySource` | same → `.concurrencyTimeline` | 485-589 |
| Live activity feed table | `recentActivity[].TableName`, `Source`, `LogType`, `LogTime`, `LogData` | same → `.recentActivity` | 630-715 |
| All entities table | `loadedEntities[].Source`, `Schema`, `TableName`, `RowsCopied`, `Duration`, `LoadedAt`, `IsIncremental`, `Status` | same → `.loadedEntities` | 717-816 |
| Pending by source | `pendingBySource[].Source`, `cnt` | same → `.pendingBySource` | (not rendered, but expected in payload) |
| Server time footer | `serverTime` | same → `.serverTime` | 819-823 |

**Every single metric, table, chart, and KPI on this page comes from the same `GET /api/load-progress` call.** There is no secondary endpoint.

---

## 2. Backend Handler Status

### Route Registration Audit

Searched all files in `dashboard/app/api/routes/*.py` for `@route("GET", "/api/load-progress")`:

**Result: NO MATCH FOUND.**

The only references to "load-progress" in the entire backend are in the module docstring of `monitoring.py` (lines 1 and 8), which claims:
```
GET /api/load-progress — entity load progress (alias of live-monitor counts)
```
But the docstring is aspirational — the handler was never implemented. The route registry (`router.py:_routes`) has no entry for `("GET", "/api/load-progress")`.

### What happens at runtime

1. Frontend calls `fetch("/api/load-progress")`
2. `server.py` `do_GET` dispatches via `dispatch("GET", "/api/load-progress", ...)`
3. `router.py:_match_route` finds no exact match, no pattern match
4. Returns `(None, {})`
5. `dispatch()` returns `404, {...}, '{"error": "Not found"}'`
6. Frontend catches the non-200 status, sets error state
7. Page displays: error banner with "HTTP 404"

---

## 3. BUG: Same Category as ValidationChecklist

**Yes, this shares the same root cause pattern.** The monitoring.py module also has these data source bugs in its `/api/live-monitor` endpoint (the closest existing proxy):

### 3a. `lzEntities` and `bronzeEntities` query EMPTY tables (lines 111-124)

```python
result["bronzeEntities"] = _safe_query(
    "SELECT ... FROM pipeline_bronze_entity ORDER BY InsertDateTime DESC LIMIT 20"
)
result["lzEntities"] = _safe_query(
    "SELECT ... FROM pipeline_lz_entity ORDER BY InsertDateTime DESC LIMIT 20"
)
```

Both `pipeline_bronze_entity` (0 rows) and `pipeline_lz_entity` (0 rows) are empty. These would always return `[]`.

### 3b. `entity_status` used correctly for counts (lines 93-106)

The `counts` section in `/api/live-monitor` does correctly use `entity_status`:
```python
status_rows = _safe_query(
    "SELECT LOWER(Layer) AS layer, COUNT(*) AS cnt FROM entity_status "
    "WHERE LOWER(Status) IN ('succeeded', 'loaded') GROUP BY LOWER(Layer)"
)
```
This handles both case conventions and both status values.

### 3c. Other monitoring.py routes reference non-existent tables

- `/api/copy-executions` → queries `CopyActivityExecution` (table does not exist in schema; actual table is `copy_activity_audit`)
- `/api/notebook-executions` → queries `NotebookExecution` (table does not exist; actual table is `notebook_executions`)
- `/api/error-intelligence` → queries `PipelineExecution`, `NotebookExecution`, `CopyActivityExecution` (none exist)
- `/api/stats` → queries `LandingzoneEntity`, `BronzeLayerEntity`, `SilverLayerEntity` (none exist; actual tables are `lz_entities`, `bronze_entities`, `silver_entities`)

These are silent failures because `_safe_query()` catches exceptions and returns `[]`.

---

## 4. Expected Response Shape vs Available Data

If the endpoint were to be implemented, here's what SQLite tables could source each field:

| Response Field | Correct Source Table | Status Column / Logic |
|---|---|---|
| `overall.TotalEntities` | `lz_entities` → `COUNT(*) WHERE IsActive=1` | OK (1,666 rows) |
| `overall.LoadedEntities` | `entity_status` → `COUNT(*) WHERE LOWER(Layer) IN ('landing','landingzone') AND LOWER(Status) IN ('loaded','succeeded')` | OK (4,998 rows total, need LZ filter) |
| `overall.PendingEntities` | TotalEntities - LoadedEntities | Computed |
| `overall.PctComplete` | `ROUND(LoadedEntities * 100.0 / TotalEntities)` | Computed |
| `overall.RunStarted` | `engine_runs.StartedAt` (latest run) | OK (4 rows) |
| `overall.LastActivity` | `entity_status.LoadEndDateTime` (MAX) or `engine_task_log.created_at` (MAX) | `entity_status` preferred (has data) |
| `overall.ElapsedSeconds` | `julianday('now') - julianday(RunStarted)` from `engine_runs` | Computed |
| `bySource[].Source` | `datasources.Name` via `lz_entities.DataSourceId` | OK |
| `bySource[].TotalEntities` | `lz_entities` grouped by DataSourceId | OK |
| `bySource[].LoadedCount` | `entity_status` WHERE Layer=landing + succeeded/loaded, joined to lz_entities via LandingzoneEntityId, grouped by DataSourceId | OK |
| `bySource[].PendingCount` | TotalEntities - LoadedCount per source | Computed |
| `bySource[].FirstLoaded` | `MIN(entity_status.LoadEndDateTime)` per source | OK |
| `bySource[].LastLoaded` | `MAX(entity_status.LoadEndDateTime)` per source | OK |
| `recentActivity[]` | `copy_activity_audit` joined with `lz_entities`/`datasources` for Source | `copy_activity_audit` has 0 rows currently; `engine_task_log` also 0 rows |
| `loadedEntities[]` | `lz_entities` LEFT JOIN `entity_status` for status/dates | OK |
| `loadedEntities[].RowsCopied` | `engine_task_log.RowsWritten` | 0 rows in engine_task_log |
| `loadedEntities[].Duration` | `engine_task_log.DurationSeconds` | 0 rows |
| `pendingBySource[]` | Entities in `lz_entities` without a 'succeeded'/'loaded' row in `entity_status` for landing layer | Computed |
| `concurrencyTimeline[]` | `copy_activity_audit` time-bucketed by LogDateTime | 0 rows |
| `serverTime` | `datetime('now')` | Trivial |

**Key concern**: `copy_activity_audit` (0 rows) and `engine_task_log` (0 rows) mean that even with a correctly implemented endpoint, the `recentActivity`, `concurrencyTimeline`, `RowsCopied`, and `Duration` fields would all be empty/null. The core progress metrics (TotalEntities, LoadedEntities, bySource counts) would work correctly from `lz_entities` + `entity_status`.

---

## 5. Findings Summary

| # | Severity | Finding |
|---|---|---|
| **B1** | **CRITICAL** | `/api/load-progress` endpoint does not exist. The page is a 404 dead end. All metrics, KPIs, tables, charts, and progress bars are non-functional. |
| **B2** | **HIGH** | `monitoring.py` docstring claims this endpoint exists (line 8) but no `@route` decorator was ever written for it. |
| **B3** | **MEDIUM** | The closest existing endpoint (`/api/live-monitor`) queries empty tables `pipeline_lz_entity` and `pipeline_bronze_entity` for its entity lists (lines 111-124), returning empty arrays. It does correctly use `entity_status` for aggregate counts. |
| **B4** | **MEDIUM** | `/api/stats` (line 202) queries non-existent table names `LandingzoneEntity`, `BronzeLayerEntity`, `SilverLayerEntity` instead of `lz_entities`, `bronze_entities`, `silver_entities`. Always returns `{}`. |
| **B5** | **MEDIUM** | `/api/copy-executions`, `/api/notebook-executions`, `/api/error-intelligence` all reference tables that don't exist in the schema (`CopyActivityExecution`, `NotebookExecution`, `PipelineExecution`). Silently return `[]`. |
| **B6** | **LOW** | `recentActivity` and `concurrencyTimeline` would be empty even with a correct implementation because `copy_activity_audit` has 0 rows. These features require active pipeline runs to populate. |
| **B7** | **LOW** | `loadedEntities[].RowsCopied` and `Duration` would be null because `engine_task_log` has 0 rows. Same dependency on active engine runs. |

---

## 6. Required Fix

Implement `@route("GET", "/api/load-progress")` in `monitoring.py` that:

1. Queries `lz_entities` for total entity counts (per source via `datasources` join)
2. Queries `entity_status` (NOT `pipeline_lz_entity`) for loaded/succeeded counts at the `landing`/`landingzone` layer
3. Queries `engine_runs` for RunStarted/ElapsedSeconds from the latest run
4. Queries `entity_status` MAX(LoadEndDateTime) for LastActivity
5. Builds `bySource` by grouping counts by `datasources.Name` via DataSourceId
6. Builds `loadedEntities` by LEFT JOINing `lz_entities` to `entity_status` and `engine_task_log`
7. Builds `recentActivity` from `copy_activity_audit` (will be empty when no runs active, but structurally correct)
8. Builds `concurrencyTimeline` from time-bucketed `copy_activity_audit` (same caveat)
9. Returns `pendingBySource` as the difference between total and loaded per source
10. Returns `serverTime` from `datetime('now')`

The response shape must match the `LoadData` TypeScript interface exactly (lines 66-75 of LoadProgress.tsx).
