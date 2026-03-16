# AUDIT: EngineControl.tsx — Data Source Correctness

**Files audited:**
- `dashboard/app/src/pages/EngineControl.tsx` (2,938 lines)
- `dashboard/app/api/routes/engine.py` (234 lines — delegation layer)
- `engine/api.py` (1,399 lines — actual handlers)
- `dashboard/app/api/control_plane_db.py` (lines 959-986 — cpdb helpers)
- `dashboard/app/api/db.py` (62 lines — SQLite query helpers)

**Database:** `dashboard/app/api/fmd_control_plane.db` (SQLite)

---

## Architecture Summary

The delegation chain is:

```
Frontend (EngineControl.tsx)
  -> fetch("/api/engine/...")
  -> dashboard/app/api/routes/engine.py  (thin @route adapter)
  -> engine/api.py  (actual SQL + engine singleton logic)
  -> SQLite control-plane DB
```

`engine.py` routes build a `_HandlerAdapter` and call `handle_engine_request()` in `engine/api.py`.
The API module uses two DB access paths: `_get_cpdb()` (control_plane_db module) and `_db_query()`/`_db_execute()` (db.py).

---

## Endpoint-by-Endpoint Audit

### 1. GET /api/engine/status

**Backend handler:** `_handle_status()` (engine/api.py:390-432)

**SQL:** `cpdb.get_engine_runs(limit=1)` -> `SELECT * FROM engine_runs ORDER BY StartedAt DESC LIMIT 1`

**Response shape:**
```json
{
  "status": "<engine.status>",
  "current_run_id": "<engine.current_run_id>",
  "uptime_seconds": 123.4,
  "engine_version": "3.0.0",
  "load_method": "local|pipeline",
  "pipeline_fallback": true,
  "pipeline_configured": true,
  "last_run": {
    "run_id": "...", "status": "...", "mode": "...",
    "started": "...", "completed": "...",
    "total": 0, "succeeded": 0, "failed": 0, "skipped": 0,
    "total_rows": 0, "duration_seconds": 0.0,
    "layers": "...", "triggered_by": "...", "elapsed_seconds": 0
  }
}
```

**Frontend interface (`EngineStatus`):** (lines 20-35)
```ts
last_run: {
  run_id: string;
  status: string;
  started_at: string;    // <-- expects "started_at"
  finished_at: string;   // <-- expects "finished_at"
  duration_seconds: number;
}
```

**Frontend usage:** (lines 1632-1648)
- `status.last_run.status` -- renders last run status label
- `status.last_run.duration_seconds` -- renders duration
- `status.last_run.finished_at` -- renders timestamp of last run end

#### BUG: `last_run` field name mismatch (CRITICAL)

| Frontend expects | Backend sends | Column in engine_runs |
|---|---|---|
| `last_run.started_at` | `last_run.started` | `StartedAt` |
| `last_run.finished_at` | `last_run.completed` | `EndedAt` |

The backend (line 419) sends `"started"` and `"completed"`, but the frontend reads `started_at` and `finished_at`. This means:

- **`fmtTimestamp(status.last_run.finished_at)`** at line 1645 always receives `undefined` and renders "--".
- The `EngineStatus` interface also defines `started_at` which is never populated.
- `duration_seconds` does match (both sides use this key).

**Impact:** The "Last run" section in the status bar never shows the end timestamp. It always shows "--" where the finished time should be.

#### NOTE: Duplicate key `elapsed_seconds`

The backend sends both `duration_seconds` (float) and `elapsed_seconds` (int from the same column `TotalDurationSeconds`). The frontend only uses `duration_seconds`. The `elapsed_seconds` key is dead weight but harmless.

#### CORRECT:
- `status`, `current_run_id`, `uptime_seconds`, `engine_version` -- all match.
- `load_method`, `pipeline_fallback`, `pipeline_configured` -- all match. Frontend syncs these on mount (lines 1062-1067).
- `last_run.status`, `last_run.duration_seconds` -- these keys match and render correctly.

---

### 2. POST /api/engine/start

**Backend handler:** `_handle_start()` (engine/api.py:439-536)

**SQL:** Writes to `engine_runs` and `engine_task_log` via the engine orchestrator (not directly).

**Response:**
```json
{"run_id": "...", "status": "started", "mode": "run"}
```

**Frontend (`StartResult`):** `{ run_id: string; status: string; }`

**CORRECT.** The response shape matches. The frontend uses `result.run_id` to set `liveRunId` and trigger SSE connection.

---

### 3. POST /api/engine/stop

**Backend handler:** `_handle_stop()` (engine/api.py:543-578)

**SQL:**
```sql
UPDATE engine_runs SET Status = 'Aborted', EndedAt = ... WHERE RunId = ? AND Status IN ('InProgress', 'running')
INSERT INTO pipeline_audit (PipelineRunGuid, ...) VALUES (?, 'FMD_ENGINE_V3', 'all', 'Engine', 'Aborted', ...)
```

**CORRECT.** Updates `engine_runs.Status` and writes terminal `pipeline_audit` row. Frontend just calls `fetchStatus()` and `fetchRuns()` afterward.

---

### 4. POST /api/engine/abort-run

**Backend handler:** `_handle_abort_run()` (engine/api.py:585-643)

**SQL:** Same pattern as stop -- marks runs as `Aborted` in `engine_runs`, writes `pipeline_audit` terminal rows.

**Response:** `{"aborted": N, "message": "Aborted N run(s)"}`

**Frontend:** Expects `{ aborted: number; message: string }` (line 1412).

**CORRECT.** Response shape matches. Both single-run and bulk abort paths update correctly.

---

### 5. GET /api/engine/plan

**Backend handler:** `_handle_plan()` (engine/api.py:650-670)

**SQL:** None directly -- delegates to `engine.run(mode="plan")` which builds a plan from metadata.

**Response:** The `plan.to_dict()` shape.

**Frontend (`PlanResult`):** (lines 82-93)
```ts
{
  run_id, entity_count, incremental_count, full_load_count,
  layers, entities, sources, layer_plan, config_snapshot, warnings
}
```

**CORRECT.** Plan is generated by the orchestrator, not from raw SQL. The fields are populated from engine internals. The rendering at lines 2098-2303 displays all fields correctly: KPI cards, layer badges, warnings, execution steps, source breakdown, config snapshot, and entity details table.

---

### 6. GET /api/engine/logs

**Backend handler:** `_handle_logs()` (engine/api.py:677-722)

**SQL (primary path via cpdb):**
```sql
SELECT * FROM engine_task_log WHERE RunId = ? [AND EntityId = ?] ORDER BY created_at DESC
```
Then filtered in Python by `layer` and `status`, paginated.

**SQL (fallback path via _db_query):**
Same query but with WHERE clauses built dynamically.

**Response:**
```json
{"logs": [<rows from engine_task_log>], "count": N}
```

Each row in `logs` has the exact column names from `engine_task_log`:
`id, RunId, EntityId, Layer, Status, SourceServer, SourceDatabase, SourceTable, SourceQuery, RowsRead, RowsWritten, BytesTransferred, DurationSeconds, TargetLakehouse, TargetPath, WatermarkColumn, WatermarkBefore, WatermarkAfter, LoadType, ErrorType, ErrorMessage, ErrorStackTrace, ErrorSuggestion, LogData, created_at`

**Frontend `TaskLog` interface** (lines 426-452):
```ts
{
  TaskId: string;              // BUG: column is "id"
  RunId: string;               // OK
  EntityId: number;            // OK
  Layer: string;               // OK
  Status: string;              // OK
  StartedAtUtc: string;        // BUG: column is "created_at" (no start time)
  CompletedAtUtc: string;      // BUG: does not exist
  SourceServer: string;        // OK
  SourceDatabase: string;      // OK
  SourceTable: string;         // OK (but see below)
  RowsRead: number;            // OK
  RowsWritten: number;         // OK
  BytesTransferred: number;    // OK
  DurationSeconds: number;     // OK
  RowsPerSecond: number;       // BUG: does not exist
  LoadType: string;            // OK
  WatermarkColumn: string;     // OK
  WatermarkBefore: string;     // OK
  WatermarkAfter: string;      // OK
  ErrorType: string;           // OK
  ErrorMessage: string;        // OK
  ErrorSuggestion: string;     // OK
  SourceSchema: string;        // BUG: does not exist in engine_task_log
  SourceName: string;          // BUG: does not exist; column is SourceTable
  DataSourceName: string;      // BUG: does not exist; no JOIN to datasources
}
```

#### BUG: Task log response missing 6 fields the frontend depends on (CRITICAL)

| Frontend field | Actual column | Impact |
|---|---|---|
| `TaskId` | `id` | Used as React key in entity tables (line 797, 847, 850). Will be `undefined` -- React keys break. |
| `StartedAtUtc` | does not exist | Used for timestamp display in expanded run logs (line 1459). Always `undefined`. |
| `CompletedAtUtc` | does not exist | Used as fallback timestamp (line 1459). Always `undefined`. |
| `SourceName` | `SourceTable` | Used everywhere for entity display labels (lines 540, 549, 795, 859, 1449). Always `undefined`, so entities show "Entity {id}" instead of table names. |
| `SourceSchema` | does not exist | Used for entity labels "schema.table" (lines 540, 799, 859, 1449). Always `undefined`, falls back to "dbo". |
| `DataSourceName` | does not exist | Used for grouping by source (line 509), display (lines 801, 862). Always "Unknown". |
| `RowsPerSecond` | does not exist | Used in expanded detail view (line 895). Always `undefined`, section hidden. |

**Impact:** The RunSummaryModal (lines 456-929) and expanded run logs rely heavily on these missing fields. When task logs are fetched:
- Entity names show as "Entity 123" instead of actual table names
- "By Data Source" grouping in the modal shows only "Unknown"
- Timestamps in expanded log view are all "--"
- React keys are `undefined` causing potential rendering issues

**Root cause:** The `_handle_logs` handler does `SELECT * FROM engine_task_log` without JOINing to `lz_entities` or `datasources`, and without aliasing `id` to `TaskId` or `SourceTable` to `SourceName`.

---

### 7. GET /api/engine/logs/stream (SSE)

**Backend handler:** `_handle_logs_stream()` (engine/api.py:729-781)

**Events emitted:**
- `log` -> `{level, message, timestamp, ts}` -- matches `LogEntry` interface
- `entity_result` -> `{run_id, entity_id, entity_name, layer, status, rows_read, rows_written, duration_seconds, error}` -- matches `EntityResult` interface
- `run_complete` -> `{succeeded, failed, skipped, total_rows}` -- matches `RunSummary` interface
- `run_error` -> `{error}` -- matches frontend handler
- `job_status` -> `{jobs, elapsed_seconds}` -- matches frontend handler
- `plan_complete` -> plan dict -- matches frontend handler

**CORRECT.** All SSE event shapes match what the frontend listeners expect. The `_publish_entity_result` helper (line 229) builds `entity_name` from the orchestrator's entity object, so live streaming entity names are correct (unlike the task log query which lacks this data).

---

### 8. POST /api/engine/retry

**Backend handler:** `_handle_retry()` (engine/api.py:787-882)

**SQL to find failed entities:**
```sql
SELECT DISTINCT EntityId FROM engine_task_log WHERE RunId = ? AND Status = 'failed' AND EntityId IS NOT NULL
```

**CORRECT.** Queries `engine_task_log` for failed entities, then starts a new run with those entity IDs.

---

### 9. GET /api/engine/health

**Backend handler:** `_handle_health()` (engine/api.py:889-901)

**Response:** `engine.preflight().to_dict()` -> `{checks: [{name, passed, message}], all_passed: bool}`

**Frontend (`HealthReport`):** `{checks: HealthCheck[], all_passed: boolean}`

**CORRECT.** Shapes match perfectly.

---

### 10. GET /api/engine/metrics

**Backend handler:** `_handle_metrics()` (engine/api.py:908-979)

**SQL queries (4 total):**

1. **Run metrics:** `SELECT RunId, Mode, Status, ... FROM engine_runs WHERE StartedAt >= datetime('now', '-N hours') ORDER BY StartedAt DESC` -- CORRECT. Uses `engine_runs` table, correct columns.

2. **Layer breakdown:** `SELECT Layer, COUNT(*), SUM(CASE...), AVG(DurationSeconds) FROM engine_task_log WHERE created_at >= datetime('now', '-N hours') GROUP BY Layer` -- CORRECT. Uses `engine_task_log` table.

3. **Slowest entities:** `SELECT t.EntityId, e.SourceName, d.Name AS DataSourceName, t.Layer, t.DurationSeconds, t.RowsRead, t.Status FROM engine_task_log t LEFT JOIN lz_entities e ON t.EntityId = e.LandingzoneEntityId LEFT JOIN datasources d ON e.DataSourceId = d.DataSourceId WHERE ... ORDER BY t.DurationSeconds DESC LIMIT 10` -- CORRECT. Proper JOINs to resolve entity names and datasource names.

4. **Top errors:** `SELECT ErrorType, ErrorMessage, COUNT(*) AS Occurrences FROM engine_task_log WHERE ... GROUP BY ErrorType, ErrorMessage ORDER BY COUNT(*) DESC LIMIT 5` -- CORRECT.

**Response shape:**
```json
{
  "hours": 24,
  "runs": [<engine_runs rows, PascalCase>],
  "layers": [{"Layer": "...", "TotalTasks": N, "AvgDurationSeconds": N}],
  "slowest_entities": [{"EntityId": N, "SourceName": "...", "DataSourceName": "...", "DurationSeconds": N}],
  "top_errors": [{"ErrorType": "...", "ErrorMessage": "...", "Occurrences": N}]
}
```

**Frontend normalization:**
- `layers`: The frontend normalizer (lines 1136-1143) correctly converts the array `[{Layer, TotalTasks, AvgDurationSeconds}]` to `Record<string, {count, avg_duration}>`. CORRECT.
- `runs`: Only used for `.length` presence check (line 2569). Shape mismatch is harmless.
- `slowest_entities`: Frontend accesses `EntityId`, `SourceName`, `DataSourceName`, `DurationSeconds` (lines 2638-2665). All match the backend response. CORRECT.
- `top_errors`: Frontend accesses `Occurrences`, `ErrorType`, `ErrorMessage` (lines 2678-2689). All match. CORRECT.

**CORRECT.** All 4 metric queries use the right tables, columns, and JOINs.

---

### 11. GET /api/engine/runs

**Backend handler:** `_handle_runs()` (engine/api.py:1010-1049)

**SQL:** `cpdb.get_engine_runs(limit=N)` -> `SELECT * FROM engine_runs ORDER BY StartedAt DESC LIMIT ?`

**Column mapping (backend lines 1035-1048):**

| engine_runs column | Mapped response key | Frontend RunRecord field |
|---|---|---|
| RunId | run_id | run_id |
| Status | status | status |
| Mode | mode | mode |
| StartedAt | started_at | started_at |
| EndedAt | finished_at | finished_at |
| TotalDurationSeconds | duration_seconds | duration_seconds |
| SucceededEntities | entities_succeeded | entities_succeeded |
| FailedEntities | entities_failed | entities_failed |
| SkippedEntities | entities_skipped | entities_skipped |
| TriggeredBy | triggered_by | triggered_by |
| TotalRowsRead | total_rows | total_rows |
| ErrorSummary | error_summary | (not in interface but harmless) |

**CORRECT.** All columns are mapped to the correct frontend field names. The Run History table (lines 2700-2920) displays all fields correctly:
- Run ID (truncated), Status (with color coding), Mode, Started timestamp, Duration, Succeeded/Failed/Skipped counts, Triggered By
- Abort and Retry action buttons reference correct run_id
- Expanded logs fetch via `/engine/logs?run_id=...` (see bug #6 above)

---

### 12. GET /api/engine/validation

**Backend handler:** `_handle_validation()` (engine/api.py:1056-1235)

**Frontend does NOT call this endpoint.** EngineControl.tsx does not fetch `/api/engine/validation`. This endpoint is consumed by a different page. Not audited here.

---

### 13. GET /api/engine/settings

**Backend handler:** `_handle_settings_get()` (engine/api.py:1242-1252)

**Response:**
```json
{
  "load_method": "local|pipeline",
  "pipeline_fallback": true,
  "pipeline_copy_sql_id": "...",
  "pipeline_workspace_id": "...",
  "pipeline_configured": true,
  "batch_size": 10
}
```

**Frontend:** EngineControl.tsx does not explicitly fetch `/api/engine/settings` -- the settings are read from the `/api/engine/status` response instead (which includes `load_method`, `pipeline_fallback`, `pipeline_configured`). The settings endpoint exists for the Settings page, not EngineControl.

**CORRECT** (not directly consumed by this page).

---

### 14. POST /api/engine/settings

**Backend handler:** `_handle_settings_post()` (engine/api.py:1259-1309)

**Frontend:** EngineControl.tsx does not call this endpoint. Load method and pipeline fallback are sent as part of the `/api/engine/start` POST body. The settings POST endpoint exists for a different settings UI.

---

### 15. GET /api/engine/entities

**Backend handler:** `_handle_entities()` (engine/api.py:1316-1357)

**SQL:**
```sql
SELECT
    e.LandingzoneEntityId AS entity_id,
    e.SourceSchema AS source_schema,
    e.SourceName AS source_name,
    COALESCE(NULLIF(d.Namespace, ''), d.Name) AS namespace,
    d.Name AS datasource,
    c.DatabaseName AS source_database,
    e.IsIncremental AS is_incremental,
    ple.InsertDateTime AS last_loaded,
    CASE WHEN ple.IsProcessed = 1 THEN 'loaded'
         WHEN ple.IsProcessed = 0 THEN 'failed'
         ELSE 'never' END AS lz_status
FROM lz_entities e
INNER JOIN datasources d ON e.DataSourceId = d.DataSourceId
INNER JOIN connections c ON d.ConnectionId = c.ConnectionId
LEFT JOIN pipeline_lz_entity ple ON e.LandingzoneEntityId = ple.LandingzoneEntityId
WHERE e.IsActive = 1
ORDER BY d.Name, e.SourceSchema, e.SourceName
```

#### BUG: Entity selector uses wrong status table (MODERATE)

The query JOINs on `pipeline_lz_entity` to derive `lz_status` and `last_loaded`. Per the schema reference, `pipeline_lz_entity` has **0 rows**. The authoritative status data lives in `entity_status` (4,998 rows).

**Impact:** Every entity in the selector grid shows `lz_status: "never"` and `last_loaded: "--"` even for entities that have been loaded. The frontend renders these in the entity selector table (lines 2028-2039), showing all entities as never loaded.

**Fix:** Replace the `pipeline_lz_entity` LEFT JOIN with a JOIN on `entity_status`:
```sql
LEFT JOIN entity_status es ON e.LandingzoneEntityId = es.LandingzoneEntityId
    AND LOWER(es.Layer) IN ('landing', 'landingzone')
```
And derive status as:
```sql
CASE WHEN LOWER(COALESCE(es.Status,'')) IN ('loaded','succeeded') THEN 'loaded'
     WHEN LOWER(COALESCE(es.Status,'')) IN ('failed','error') THEN 'failed'
     ELSE 'never' END AS lz_status,
es.LoadEndDateTime AS last_loaded
```

**Other fields CORRECT:**
- `entity_id` from `lz_entities.LandingzoneEntityId` -- correct PK
- `source_schema` from `lz_entities.SourceSchema` -- correct column
- `source_name` from `lz_entities.SourceName` -- correct column
- `namespace` from `datasources.Namespace` / `datasources.Name` -- correct
- `datasource` from `datasources.Name` -- correct
- `source_database` from `connections.DatabaseName` -- correct
- `is_incremental` from `lz_entities.IsIncremental` -- correct

---

### 16. POST /api/engine/entity/{id}/reset

**Backend handler:** `_handle_entity_reset()` (engine/api.py:986-1003)

**SQL:** `DELETE FROM watermarks WHERE LandingzoneEntityId = ?`

**CORRECT.** Deletes from the `watermarks` table using the correct PK. Forces full load on next run.

---

### 17. GET /api/engine/jobs (MISSING ENDPOINT)

**Frontend reference:** Line 1275: `fetch(\`${API}/engine/jobs\`)`

The frontend polls `/api/engine/jobs` every 15s when running in pipeline mode (lines 1271-1286) to check for active Fabric notebook jobs.

#### BUG: Endpoint does not exist (LOW)

Neither `engine/api.py` nor `dashboard/app/api/routes/engine.py` registers a `/api/engine/jobs` handler. The fetch silently fails (the frontend catches the error), so this is not a crash bug.

**Impact:** When using pipeline/notebook load method, the frontend cannot poll for Fabric job status via this endpoint. It falls back to SSE `job_status` events, which do work. The REST poll is a redundant fallback that doesn't function.

---

## Summary of Bugs

| # | Severity | Component | Description |
|---|---|---|---|
| 1 | **CRITICAL** | `/api/engine/status` | `last_run` sends `started`/`completed` but frontend reads `started_at`/`finished_at`. Status bar end timestamp always shows "--". |
| 2 | **CRITICAL** | `/api/engine/logs` | Task log response missing 6 fields (`TaskId`, `StartedAtUtc`, `CompletedAtUtc`, `SourceName`, `SourceSchema`, `DataSourceName`, `RowsPerSecond`). RunSummaryModal shows entity names as "Entity N", "By Source" grouping shows "Unknown", timestamps are "--", React keys are undefined. |
| 3 | **MODERATE** | `/api/engine/entities` | Entity selector JOINs on `pipeline_lz_entity` (0 rows) instead of `entity_status` (4,998 rows). All entities show status "never" and no last loaded date. |
| 4 | **LOW** | `/api/engine/jobs` | Frontend polls an endpoint that does not exist. Silently fails; SSE fallback works. |

## Items Verified Correct

- Engine status fields (`status`, `current_run_id`, `uptime_seconds`, `engine_version`, `load_method`, `pipeline_fallback`, `pipeline_configured`)
- Engine start/stop/abort-run: correct SQL updates to `engine_runs` and `pipeline_audit`
- Execution plan: all plan fields (`entity_count`, `incremental_count`, `full_load_count`, `layers`, `sources`, `layer_plan`, `config_snapshot`, `warnings`, `entities`) render correctly
- SSE streaming: all event types (`log`, `entity_result`, `run_complete`, `run_error`, `job_status`, `plan_complete`) have correct shapes
- Live run KPI cards: entity counts (`completedEntities`, `succeededEntities`, `failedEntities`), duration, and rows are computed correctly from SSE entity_result events
- Run history table: all 10+ columns correctly mapped from `engine_runs` DB columns to frontend field names
- 24h metrics: all 4 SQL queries use correct tables/columns/JOINs; layer normalization handles array->Record conversion; slowest entities and top errors display correct fields
- Health check: response shape matches perfectly
- Entity watermark reset: correct DELETE from `watermarks` table
- Retry: correctly queries failed entities from `engine_task_log` by RunId
- Orphaned run cleanup: correctly marks InProgress runs as Aborted on engine startup
