# AUDIT: ExecutionMatrix
**File**: `dashboard/app/src/pages/ExecutionMatrix.tsx`
**Backend hooks**: `dashboard/app/src/hooks/useEntityDigest.ts`, `dashboard/app/src/hooks/useEngineStatus.ts`
**Backend routes**: `dashboard/app/api/routes/entities.py`, `dashboard/app/api/routes/engine.py`
**Engine API**: `engine/api.py`
**DB layer**: `dashboard/app/api/control_plane_db.py` (SQLite `fmd_control_plane.db`)
**Audited**: 2026-03-13
**Focus**: Data source correctness

---

## Architecture Summary

ExecutionMatrix uses **two shared hooks** that each call multiple API endpoints:

1. **`useEntityDigest`** -> `GET /api/entity-digest` -> `entities.py` -> `control_plane_db.py`
2. **`useEngineStatus`** -> `GET /api/engine/status`, `GET /api/engine/metrics?hours=N`, `GET /api/engine/runs?limit=20` -> `engine.py` -> `engine/api.py` -> SQLite

---

## Data Points Verified

### 1. Entity Digest (KPI Cards, Layer Health, Entity Table)
- **Frontend expects**: `DigestResponse` with `sources` (dict or array), each containing `entities[]` of type `DigestEntity` with fields: `id`, `tableName`, `sourceSchema`, `source`, `lzStatus`, `bronzeStatus`, `silverStatus`, `overall`, `lastError`, etc.
- **API call**: `GET /api/entity-digest`
- **Backend route** (entities.py:234-254): `_build_sqlite_entity_digest()` queries:
  - `cpdb.get_registered_entities_full()` -> joins `lz_entities`, `datasources`, `connections` (returns `LandingzoneEntityId`, `SourceSchema`, `SourceName`, `Namespace`, `DataSourceName`, `ServerName`, `DatabaseName`, `ConnectionName`, `IsActive`, `IsIncremental`, `IsIncrementalColumn`)
  - `cpdb.get_entity_status_all()` -> `SELECT * FROM entity_status` (4998 rows, PK: `(LandingzoneEntityId, Layer)`)
  - `cpdb.get_bronze_view()` -> `SELECT * FROM bronze_entities` (1666 rows, has `BronzeLayerEntityId`, `LandingzoneEntityId`, `PrimaryKeys`)
  - `cpdb.get_silver_view()` -> `SELECT * FROM silver_entities` (1666 rows, has `SilverLayerEntityId`, `BronzeLayerEntityId`)
- **Status lookup** (entities.py:115-117): Uses exact string match on Layer values `"LandingZone"`, `"Bronze"`, `"Silver"` (PascalCase)
- **Schema**: `entity_status.Layer` stores these as PascalCase per the seed data pattern
- **Status**: CORRECT
- **Note**: The `useEntityDigest` hook (line 119-179) has a `normalizeDigestResponse()` that handles both array and dict `sources` formats, and maps `statusCounts` -> `summary`. The SQLite path returns `sources` as an array with `statusCounts`, which is correctly normalized.

### 2. KPI Card: Total Entities
- **Frontend** (line 450): `totalSummary.total` from `useEntityDigest`
- **Derived**: Sum of all `source.summary.total` across all sources
- **Backend**: Count of all LZ entities returned by `get_registered_entities_full()`
- **Status**: CORRECT

### 3. KPI Card: Success Rate
- **Frontend** (line 187-191): `Math.round((totalSummary.complete / totalSummary.total) * 100)`
- **Backend**: `complete` count = entities where ALL 3 layer statuses are in `("loaded", "complete", "Succeeded")`
- **Status**: CORRECT -- uses the `overall` status bucketing from `_build_sqlite_entity_digest()`

### 4. KPI Card: Active Errors
- **Frontend** (line 528): `totalSummary.error`
- **Backend**: `error` count = entities where ANY layer status is in `("error", "Failed", "failed")`
- **Status**: CORRECT

### 5. KPI Card: Last Run
- **Frontend** (lines 489-520): `engineStatus.last_run.ended_at`, `engineStatus.last_run.status`, `engineStatus.last_run.duration_seconds`
- **API call**: `GET /api/engine/status`
- **Backend** (engine/api.py:390-432 `_handle_status()`):
  - Queries `cpdb.get_engine_runs(limit=1)` -> `SELECT * FROM engine_runs ORDER BY StartedAt DESC LIMIT 1`
  - Maps: `RunId` -> `run_id`, `Status` -> `status`, `StartedAt` -> `started`, `EndedAt` -> `completed`, `TotalDurationSeconds` -> `duration_seconds`
- **Frontend normalizer** (useEngineStatus.ts:119-155): Maps `started` -> `started_at`, `completed` -> `ended_at` via fallback chain
- **Schema**: `engine_runs` has 4 rows with columns `RunId` (TEXT PK), `Status`, `StartedAt`, `EndedAt`, `TotalDurationSeconds`
- **Status**: CORRECT

### 6. Layer Health Bars
- **Frontend** (lines 159-184): Computes `layerCounts.lz`, `.bz`, `.sv` by iterating `allEntities` and bucketing each entity's `lzStatus`, `bronzeStatus`, `silverStatus`
- **Bucketing logic**: `SUCCESS_VALUES = {"loaded", "complete", "succeeded"}`, `PENDING_VALUES = {"pending", "inprogress", "running"}`, `not_started`/empty -> pending, anything else -> failed
- **Source**: All from entity digest (same data as KPI cards)
- **Status**: CORRECT -- bucketing handles the various status string variants stored in `entity_status.Status`

### 7. Layer Throughput Bar Chart
- **Frontend** (lines 634-704): `engineMetrics.layers` with fields `Layer`, `Succeeded`, `Failed`; plus `engineMetrics.runs` (count), `engineMetrics.slowest_entities`
- **API call**: `GET /api/engine/metrics?hours=N`
- **Backend** (engine/api.py:908-979 `_handle_metrics()`):
  - **Layer breakdown**: `SELECT Layer, COUNT(*) AS TotalTasks, SUM(CASE WHEN Status='succeeded' ...) AS Succeeded, SUM(CASE WHEN Status='failed' ...) AS Failed, SUM(RowsRead) AS TotalRowsRead, AVG(DurationSeconds) AS AvgDurationSeconds FROM engine_task_log WHERE created_at >= datetime('now', '-N hours') GROUP BY Layer`
  - **Slowest entities**: Joins `engine_task_log t`, `lz_entities e`, `datasources d` -- returns `EntityId`, `SourceName`, `DataSourceName`, `Layer`, `DurationSeconds`
  - **Top errors**: `SELECT ErrorType, ErrorMessage, COUNT(*) AS Occurrences FROM engine_task_log WHERE ... Status='failed' GROUP BY ErrorType, ErrorMessage ORDER BY COUNT(*) DESC LIMIT 5`
- **Schema**: `engine_task_log` has 0 rows currently (table exists, columns match). Columns `Layer`, `Status`, `RowsRead`, `DurationSeconds`, `ErrorType`, `ErrorMessage` all exist.
- **Frontend normalizer** (useEngineStatus.ts:158-205): Maps `runs` (array -> count), `layers` (PascalCase passthrough), `slowest_entities` (EntityId/SourceName/Layer/DurationSeconds -> snake_case), `top_errors` (ErrorMessage/Occurrences -> error_message/count)
- **Status**: CORRECT -- all column names match between SQL, backend response, and frontend normalizer

### 8. Top Errors Panel
- **Frontend** (lines 584-628): `engineMetrics.top_errors` with fields `error_message`, `count`
- **Source**: Same `GET /api/engine/metrics` endpoint, `top_errors` key
- **Status**: CORRECT -- see #7 above

### 9. Entity Table (EntityTable component)
- **Frontend** (line 574): Passes `filteredEntities` (DigestEntity[]) to `<EntityTable>`
- **Entity fields used**: `id`, `tableName`, `sourceSchema`, `source`, `isActive`, `isIncremental`, `watermarkColumn`, `lzStatus`, `bronzeStatus`, `silverStatus`, `lzLastLoad`, `bronzeLastLoad`, `silverLastLoad`, `lastError`, `overall`, `diagnosis`, `bronzeId`, `bronzePKs`, `silverId`, `connection`
- **All from entity digest**: `_build_sqlite_entity_digest()` builds all these fields correctly from SQLite
- **Status**: CORRECT

### 10. Entity Logs (expanded entity detail)
- **Frontend**: `onFetchLogs` -> `fetchEntityLogs(entityId)` -> `GET /api/engine/logs?entity_id=N&limit=10`
- **Backend** (engine/api.py:677-722 `_handle_logs()`):
  - Via `cpdb.get_engine_task_log(entity_id=N)` or direct SQL: `SELECT * FROM engine_task_log WHERE EntityId=N ORDER BY created_at DESC`
- **Frontend normalizer** (useEngineStatus.ts:292-318): Maps columns to `EngineLog` interface (log_id, run_id, entity_id, entity_name, layer, status, rows_read, rows_written, duration_seconds, error_message, started_at, ended_at)
- **Schema**: `engine_task_log` columns match: `id`, `RunId`, `EntityId`, `Layer`, `Status`, `RowsRead`, `RowsWritten`, `DurationSeconds`, `ErrorMessage`, `created_at` (used as started_at)
- **Status**: CORRECT -- column mapping chain is complete, but `entity_name` is not stored in `engine_task_log`. The normalizer falls back to `SourceName` or `EntityName` from the backend, but `_handle_logs` returns raw rows without joining to get the name. The frontend will show empty entity names.
- **Issue**: See B1 below.

### 11. Reset Watermark
- **Frontend**: `onResetWatermark` -> `resetEntityWatermark(entityId)` -> `POST /api/engine/entity/{id}/reset`
- **Backend** (engine/api.py:986-1003): `DELETE FROM watermarks WHERE LandingzoneEntityId = ?`
- **Schema**: `watermarks` table has `LandingzoneEntityId` PK, 0 rows
- **Status**: CORRECT

---

## Bugs Found

### B1 — Entity logs missing entity_name [MINOR]
- **Location**: `engine/api.py:677-722` (`_handle_logs`)
- **Issue**: The `_handle_logs()` handler returns raw rows from `engine_task_log` which does NOT have a `SourceName` or `EntityName` column. It has `SourceTable` and `SourceServer` but not a friendly entity name. The frontend normalizer (`useEngineStatus.ts:303`) tries `r.entity_name ?? r.SourceName ?? r.EntityName` -- all will be undefined, so entity names in the expanded log detail will display as empty string.
- **Fix**: Join `lz_entities` on `EntityId = LandingzoneEntityId` to include `SourceName` in the result, or alias `SourceTable` as `SourceName`.

### B2 — engine_task_log has 0 rows [DATA GAP, NOT BUG]
- **Observation**: `engine_task_log` has 0 rows and `engine_runs` has 4 rows. The throughput chart, top errors panel, and slowest entities will all be empty until engine runs populate this table.
- **Impact**: Not a code bug -- the table is correctly queried but simply has no data yet. Once the engine runs execute, data will flow.

---

## Summary

| # | Data Point | Source Table(s) | Status |
|---|-----------|----------------|--------|
| 1 | Entity Digest | lz_entities, entity_status, bronze_entities, silver_entities, datasources, connections | CORRECT |
| 2 | Total Entities KPI | (derived from #1) | CORRECT |
| 3 | Success Rate KPI | (derived from #1) | CORRECT |
| 4 | Active Errors KPI | (derived from #1) | CORRECT |
| 5 | Last Run KPI | engine_runs | CORRECT |
| 6 | Layer Health Bars | (derived from #1) | CORRECT |
| 7 | Layer Throughput Chart | engine_task_log | CORRECT |
| 8 | Top Errors Panel | engine_task_log | CORRECT |
| 9 | Entity Table | (derived from #1) | CORRECT |
| 10 | Entity Logs | engine_task_log | MINOR BUG (B1) |
| 11 | Reset Watermark | watermarks | CORRECT |

**Overall verdict**: 10/11 data points correct. 1 minor bug (entity name missing in log detail view).
