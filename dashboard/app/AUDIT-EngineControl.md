# EngineControl Page Audit

Audited: 2026-03-10
File: `dashboard/app/src/pages/EngineControl.tsx` (~2860 lines)
Backend: `engine/api.py`, `dashboard/app/api/server.py`, `dashboard/app/api/control_plane_db.py`

---

## Frontend Bugs Fixed

### 1. SSE Never Reconnects After Connection Error (CRITICAL)

**Problem:** When `es.onerror` fires mid-run, the handler cleared `sseRunIdRef` and `eventSourceRef` but did NOT clear `liveRunId` state. The SSE effect's dependency array is `[liveRunId]`, so since `liveRunId` didn't change, the effect never re-fired. Result: live log stream permanently dies mid-run with no reconnection attempt.

**Fix:** Added exponential backoff reconnection (2s -> 4s -> 8s -> 16s -> 32s) with a 5-attempt max. On error, briefly toggles `liveRunId` state (`null` then back) via `requestAnimationFrame` to force the effect to re-fire. Added `sseRetryCount` ref, reset on successful `open` event. Falls back to status polling if SSE is permanently unreachable.

### 2. Metrics `layers` Shape Mismatch (CRITICAL)

**Problem:** The `MetricsData` interface declares `layers: Record<string, { count: number; avg_duration: number }>` (an object keyed by layer name). But `engine/api.py`'s `_handle_metrics` returns `layers: [array of row objects]` with PascalCase fields (`Layer`, `TotalTasks`, `AvgDurationSeconds`). The frontend code does `Object.entries(metrics.layers).map(...)` which, on an array, yields `["0", {...}], ["1", {...}]` -- rendering layer names as "0", "1", "2" and `data.count` as `undefined`.

**Fix:** Added normalization in `fetchMetrics` that detects whether `layers` is an array (backend format) or already an object (expected format), and maps `{Layer, TotalTasks, AvgDurationSeconds}` to `{count, avg_duration}` keyed by lowercase layer name.

### 3. Expanded Run Logs Show Broken Data (CRITICAL)

**Problem:** `handleExpandRun` fetches task logs from `/engine/logs?run_id=...` which returns `TaskLog` objects (PascalCase: `TaskId`, `RunId`, `EntityId`, `Layer`, `Status`, `StartedAtUtc`, `RowsRead`, etc.) from `sp_GetEngineTaskLogs`. But it stores them as `LogEntry[]` and renders via `LogLine` which expects `{timestamp, level, message}`. All three fields are `undefined` on TaskLog objects, so every expanded run shows empty/broken log lines.

**Fix:** Added mapping in `handleExpandRun` that converts each `TaskLog` to a `LogEntry` with a synthesized message like `[LANDING] dbo.MyTable: succeeded 1,234 rows 2.3s`. Sets `level` based on status (ERROR for failed, INFO for succeeded, WARN otherwise). Uses `StartedAtUtc` as timestamp.

### 4. `runSummary.total_rows.toLocaleString()` Crash Risk (MEDIUM)

**Problem:** In the run complete summary, `total_rows` was rendered via `.toLocaleString()` directly instead of the null-safe `fmtNum()` helper. If the retry path's `run_complete` event ever had a missing `total_rows`, this would throw at runtime.

**Fix:** Changed to use `fmtNum(runSummary.total_rows)`.

### 5. Live Run `totalRows.toLocaleString()` Crash Risk (MEDIUM)

**Problem:** Same pattern -- `totalRows` (derived from `entityResults.reduce(...)`) is always a number (defaults to 0), but using `.toLocaleString()` is inconsistent with the rest of the page which uses `fmtNum()`.

**Fix:** Changed to use `fmtNum(totalRows)`.

---

## Backend Issues (Not Fixed -- Requires server.py Changes)

### B1. `/api/engine/runs` SQLite Path Returns Wrong Shape (CRITICAL)

**File:** `server.py` line ~8923

**Problem:** When SQLite is available, `_sqlite_engine_runs(limit)` returns a **plain array** of row dicts. But the frontend expects `{ runs: [...], count: N }`. Result: `data.runs` is `undefined`, so run history appears empty even though SQLite has data.

**Fix needed:** Change line 8923 from:
```python
self._json_response(_sqlite_engine_runs(limit=limit))
```
to:
```python
runs = _sqlite_engine_runs(limit=limit)
self._json_response({"runs": runs, "count": len(runs)})
```

Additionally, the SQLite rows use PascalCase column names (`RunId`, `Status`, `StartedAt`, `EndedAt`, `TotalDurationSeconds`) while the frontend expects the snake_case mapping that `engine/api.py`'s `_handle_runs` provides (`run_id`, `status`, `started_at`, `finished_at`, `duration_seconds`). The SQLite path needs the same column mapping that `_handle_runs` does at lines 987-1004.

### B2. `/api/engine/status` SQLite Path Returns Wrong Shape (CRITICAL)

**File:** `server.py` line ~675-690

**Problem:** `_sqlite_engine_status()` returns:
```python
{"status": "idle", "lastRun": {raw SQLite row}, "_source": "sqlite"}
```

But the frontend `EngineStatus` interface expects:
```typescript
{
  status: "idle" | "running" | "stopping" | "error",
  current_run_id: string | null,
  uptime_seconds: number,
  engine_version: string,
  load_method?: "local" | "pipeline",
  pipeline_fallback?: boolean,
  pipeline_configured?: boolean,
  last_run: { run_id, status, started_at, finished_at, duration_seconds } | null
}
```

Missing fields: `current_run_id`, `uptime_seconds`, `engine_version`, `load_method`, `pipeline_fallback`, `pipeline_configured`. Wrong key: `lastRun` vs `last_run`. The `lastRun` value is a raw SQLite row instead of the mapped object.

**Result:** The frontend silently ignores all the missing fields (status bar shows no version, no uptime, no load method). The `last_run` section never renders because the key is wrong (`lastRun` vs `last_run`).

**Fix needed:** `_sqlite_engine_status` should delegate to `engine/api.py` for the full shape. The SQLite-only path is a degraded fallback that loses important engine state. Consider always delegating to the engine API for `/status` (which already uses SQLite internally with Fabric SQL fallback) and remove the server.py intercept entirely.

### B3. `/api/engine/metrics` Hits Fabric SQL Directly -- No SQLite Fallback (HIGH)

**File:** `engine/api.py` lines 857-921

**Problem:** `_handle_metrics` makes 4 separate Fabric SQL queries (sp_GetEngineMetrics + 3 raw queries). When Fabric SQL is unreachable (SSL failures, VPN down), ALL queries fail and the endpoint returns 500. The known issue: "returning 500s in a loop" was addressed by catching the error, but the fix should go further.

**Recommendation:** Add a SQLite fallback path for metrics. The `engine_task_log` table in SQLite has `RunId`, `EntityId`, `Layer`, `Status`, `RowsRead`, `DurationSeconds`, `ErrorType`, `ErrorMessage`, `StartedAt` -- everything needed to compute the layer breakdown, slowest entities, and top errors. The `engine_runs` table has run history.

Proposed SQLite metrics implementation:
```python
def _sqlite_engine_metrics(hours: int) -> dict:
    import control_plane_db as cpdb
    since = (datetime.utcnow() - timedelta(hours=hours)).isoformat()
    # Use cpdb queries against engine_task_log and engine_runs tables
    # ... aggregate layers, slowest, errors locally
```

### B4. `/api/engine/entities` Hits Fabric SQL Only (MEDIUM)

**File:** `engine/api.py` lines 1286-1328

**Problem:** The entity selector endpoint has no SQLite fallback. If Fabric SQL is down, the entity selector shows "No entities found". The `lz_entities` table in SQLite has all the needed data.

### B5. `/api/engine/logs` Hits Fabric SQL Only (MEDIUM)

**File:** `engine/api.py` lines 640-673

**Problem:** The task log endpoint (`sp_GetEngineTaskLogs`) has no SQLite fallback. If Fabric SQL is down and the user opens a Run Report modal or expands a run in history, it shows empty. The `engine_task_log` table in SQLite is the local mirror.

### B6. Retry `run_complete` Event Missing `skipped` Count (LOW)

**File:** `engine/api.py` lines 816-820

**Problem:** The retry path's `run_complete` SSE event includes `succeeded`, `failed`, `total_rows` but NOT `skipped`. The normal run path (line 481-486) includes all four. Frontend displays `fmtNum(undefined)` which renders "---" -- not a crash but incorrect data.

**Fix needed:** Add `"skipped": skipped` to the retry `run_complete` event, matching the normal run path.

### B7. `/api/engine/jobs` Endpoint Not Implemented (LOW)

**File:** `engine/api.py` route dispatcher

**Problem:** The frontend polls `/api/engine/jobs` when in pipeline mode (line ~1219), but this endpoint is not listed in the route dispatcher. It would 404, which the frontend silently ignores. The `fabricJobs` state only gets populated via SSE `job_status` events, making the polling fallback non-functional.

---

## Data Flow Summary

| Endpoint | Frontend Calls | Backend Handler | Data Source | SQLite Fallback? |
|----------|---------------|-----------------|-------------|------------------|
| `/engine/status` | Every 5s | server.py intercept OR api.py `_handle_status` | SQLite -> Fabric SQL | YES (but wrong shape) |
| `/engine/runs` | On mount + after run | server.py intercept OR api.py `_handle_runs` | SQLite -> Fabric SQL | YES (but wrong shape) |
| `/engine/metrics` | On mount | api.py `_handle_metrics` | Fabric SQL only (4 queries) | NO |
| `/engine/entities` | When selector opens | api.py `_handle_entities` | Fabric SQL only | NO |
| `/engine/logs` | Run report + expanded rows | api.py `_handle_logs` | Fabric SQL (sp_GetEngineTaskLogs) | NO |
| `/engine/logs/stream` | During live run (SSE) | api.py `_handle_logs_stream` | In-memory event buffer | N/A |
| `/engine/health` | When panel open (10s) | api.py `_handle_health` | Engine preflight checks | N/A |
| `/engine/plan` | Dry run / before start | api.py `_handle_plan` | Engine orchestrator | N/A |
| `/engine/start` | Start button | api.py `_handle_start` | Engine orchestrator | N/A |
| `/engine/stop` | Stop button | api.py `_handle_stop` | Engine orchestrator + Fabric SQL | NO |
| `/engine/retry` | Retry button | api.py `_handle_retry` | Fabric SQL (failed entities query) | NO |
| `/engine/abort-run` | Abort button | api.py `_handle_abort_run` | Fabric SQL | NO |
| `/engine/jobs` | Pipeline mode polling | NOT IMPLEMENTED | -- | -- |

## Endpoints That Should Use SQLite First

Priority order for adding SQLite fallback:
1. **`/engine/runs`** -- fix shape mismatch (B1) -- high-frequency, visible on every page load
2. **`/engine/status`** -- fix shape mismatch (B2) -- polled every 5 seconds
3. **`/engine/metrics`** -- add SQLite fallback (B3) -- causes 500 errors when Fabric SQL is down
4. **`/engine/logs`** -- add SQLite fallback (B5) -- needed for run reports
5. **`/engine/entities`** -- add SQLite fallback (B4) -- needed for entity selector

---

## Architecture Notes

- The page is a single 2860-line file with 12+ inline sub-components. Consider extracting `RunSummaryModal`, `Section`, `StatusBadge`, `LayerBadge`, `EntityStatusBadge`, `ProgressBar`, `LogLine`, `ConfigValue` into separate files.
- `useEngineStatus.ts` hook exists but is NOT used by EngineControl -- the page has its own inline fetch logic. The hook is used by ExecutionMatrix. The two implementations have diverged (different type shapes, different field names).
- The `fmtNum` helper is shadowed inside `RunSummaryModal` with a different implementation (K/M abbreviation vs null-safe formatting).
- SSE event buffer (`_sse_events`) in the backend is capped at 10,000 events. For runs processing 1,666 entities across 3 layers, that's ~5,000 entity_result events plus ~5,000 log events. Could hit the cap on large runs and cause late joiners to miss early events.
