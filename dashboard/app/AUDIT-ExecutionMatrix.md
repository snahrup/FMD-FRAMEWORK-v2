# ExecutionMatrix Page Audit

**Audited**: 2026-03-10
**Page**: `dashboard/app/src/pages/ExecutionMatrix.tsx` (route `/`, home page)
**Scope**: Every piece of data displayed, traced from React component through API handler to data source.

---

## Files Audited

| File | Role |
|------|------|
| `src/pages/ExecutionMatrix.tsx` | Main page component |
| `src/hooks/useEntityDigest.ts` | Entity digest data hook |
| `src/hooks/useEngineStatus.ts` | Engine status/metrics/runs/logs hook |
| `src/components/EntityTable.tsx` | Sortable entity table with drill-down |
| `src/components/KPICard.tsx` | KPI summary card |
| `src/components/PieChart.tsx` | Mini donut chart |
| `src/components/TimeRangeSelector.tsx` | Time range button group |
| `api/server.py` | API server (routes, SQLite handlers, Fabric SQL fallback) |
| `api/control_plane_db.py` | SQLite read/write functions |
| `engine/api.py` | Engine REST API handlers |

---

## Data Flow Summary

```
Fabric SQL DB (EntityStatusSummary, EngineRun, EngineTaskLog)
    |
    | background sync (every 30min, server.py _sync_to_sqlite)
    v
Local SQLite (entity_status, engine_runs, engine_task_log, lz_entities, ...)
    |
    | API handlers (_sqlite_entity_digest, _sqlite_engine_status, _sqlite_engine_runs)
    v
REST API (/api/entity-digest, /api/engine/status, /api/engine/metrics, /api/engine/runs, /api/engine/logs)
    |
    | fetch + normalize (useEntityDigest, useEngineStatus)
    v
React Components (ExecutionMatrix -> KPICard, EntityTable, StatusPieChart, BarChart)
```

---

## Bugs Found and Fixed (Frontend)

### BUG 1 (CRITICAL): Entity digest response shape mismatch
**Files**: `useEntityDigest.ts`, `server.py:951`
**Issue**: The backend has two code paths for `/api/entity-digest`:
- **SQLite path** (`_sqlite_entity_digest`, server.py:789): Returns `sources` as an **array** of objects, each with `statusCounts` (not `summary`) and no `key` field.
- **Fabric SQL path** (`build_entity_digest`, server.py:4613): Returns `sources` as a **dict** keyed by source name, with `summary` and `key` fields.

The frontend `DigestResponse` type expected `sources: Record<string, DigestSource>` with a `summary` field. When SQLite was the data source (the primary path), the hook would:
- `sourceList` sort by `a.key.localeCompare(b.key)` would crash because `key` was undefined.
- `totalSummary` would produce all zeros because `s.summary` was undefined (data was in `s.statusCounts`).
- `entitiesBySource(sourceKey)` would always return `[]` because you can't index an array by string key.

**Fix**: Added `normalizeDigestResponse()` in `useEntityDigest.ts` that handles both array and dict shapes, maps `statusCounts` to `summary`, and ensures `key` is always present.

### BUG 2 (CRITICAL): Engine status response shape mismatch
**Files**: `useEngineStatus.ts`, `server.py:675-690`
**Issue**: The backend's `_sqlite_engine_status()` returns:
```python
{"status": "idle", "lastRun": {raw SQLite row}, "_source": "sqlite"}
```
But the engine API's `_handle_status()` returns:
```python
{"status": "idle", "last_run": {mapped fields}, "engine_version": "3.0.0", ...}
```
The frontend expected `last_run` (snake_case) with fields `started_at`, `ended_at`, `status`, `duration_seconds`. The SQLite path sent `lastRun` (camelCase) with raw DB columns `RunId`, `StartedAt`, `EndedAt`, `TotalDurationSeconds`.

Result: The "Last Run" KPI card would show "No runs recorded" even when runs existed. The engine status badge would show "Idle" even when a run was in progress.

**Fix**: Added `normalizeEngineStatus()` in `useEngineStatus.ts` that handles both camelCase/snake_case naming and maps all column name variants to the canonical shape.

### BUG 3 (CRITICAL): Engine metrics response shape mismatch
**Files**: `useEngineStatus.ts`, `engine/api.py:912`
**Issue**: The engine API's `_handle_metrics()` returns:
```python
{"runs": [array of run metrics], "layers": [...], "slowest_entities": [...], "top_errors": [...]}
```
But the frontend `EngineMetrics` type expected `runs: number` (a count). Rendering `{engineMetrics.runs} runs` would display `[object Object],[object Object] runs`.

Additionally:
- `slowest_entities` items had SQL column names (`SourceName`, `DurationSeconds`, `Layer`) instead of the expected `entity_name`, `duration_seconds`, `layer`.
- `top_errors` items had `ErrorMessage` + `Occurrences` instead of `error_message` + `count`.

Result: The "Layer Throughput" section would show garbled run counts. Slowest entities and top errors would show undefined/empty values.

**Fix**: Added `normalizeEngineMetrics()` in `useEngineStatus.ts` that coerces `runs` to a count and maps all PascalCase SQL columns to the expected snake_case.

### BUG 4 (CRITICAL): Engine logs response has PascalCase SQL columns
**Files**: `useEngineStatus.ts`, `engine/api.py:670`
**Issue**: The `_handle_logs()` handler returns `_safe_row(r)` which preserves raw SQL column names from `sp_GetEngineTaskLogs`: `TaskId`, `RunId`, `EntityId`, `SourceName`, `Layer`, `Status`, `StartedAtUtc`, `CompletedAtUtc`, `RowsRead`, `DurationSeconds`, `ErrorMessage`.

The frontend `EngineLog` type expected: `log_id`, `run_id`, `entity_id`, `entity_name`, `layer`, `status`, `started_at`, `ended_at`, `rows_read`, `duration_seconds`, `error_message`.

Result: Expanding an entity row in the table showed a log sub-table with all undefined/empty values.

**Fix**: Added normalization in `fetchEntityLogs()` that maps both PascalCase and snake_case variants.

### BUG 5 (MODERATE): Layer status values not fully handled
**Files**: `ExecutionMatrix.tsx`, `EntityTable.tsx`
**Issue**: The `entity_status.Status` column can contain values beyond the canonical "loaded"/"pending"/"not_started":
- Engine logging_db.py writes `"Succeeded"` (capital S)
- Engine stored proc writes `"succeeded"` (lowercase)
- Pipeline notebooks may write `"Failed"`, `"error"`, `"InProgress"`, `"complete"`

The `layerCounts` computation only checked for `=== "loaded"` and `=== "pending"`, bucketing everything else (including `"Succeeded"`, `"complete"`) as failed. This overstated the failure count.

The `EntityTable` helper functions (`layerStatusLabel`, `layerStatusCls`, `layerStatusIcon`) only handled the three canonical values, showing "Never Run" for succeeded entities and using the wrong color/icon.

**Fix**:
- `ExecutionMatrix.tsx`: Updated `layerCounts` to use case-insensitive matching with sets: `SUCCESS_VALUES = {"loaded", "complete", "succeeded"}`, `PENDING_VALUES = {"pending", "inprogress", "running"}`.
- `EntityTable.tsx`: Broadened `LayerStatus` type to `string` and updated all helper functions to use case-insensitive matching, including proper handling of "Failed"/"error" states with red styling.

### BUG 6 (MODERATE): Engine runs response not normalized (SQLite path)
**Files**: `useEngineStatus.ts`, `server.py:8919-8923`
**Issue**: When SQLite is available, `/api/engine/runs` returns raw SQLite column names (`RunId`, `Status`, `StartedAt`, `EndedAt`, `TotalDurationSeconds`). But the engine API's `_handle_runs()` maps these to `run_id`, `status`, `started_at`, `finished_at`, `duration_seconds`. The `EngineRun` interface expects snake_case.

**Fix**: Added normalization in the `setEngineRuns()` call.

### BUG 7 (MINOR): Type safety for DigestEntity status fields
**Files**: `useEntityDigest.ts`
**Issue**: `lzStatus`, `bronzeStatus`, `silverStatus` were typed as `"loaded" | "pending" | "not_started"` but actual data could contain `"Succeeded"`, `"Failed"`, etc. TypeScript wouldn't catch runtime mismatches.

**Fix**: Broadened all three to `string` with documentation comments. Same for `overall`.

### BUG 8 (MINOR): Missing null guards in search filter
**Files**: `ExecutionMatrix.tsx`
**Issue**: Search filter called `.toLowerCase()` on `e.tableName`, `e.sourceSchema`, `e.source` without null guards. If the backend ever sent null/undefined (e.g., from a malformed entity_status row), this would throw.

**Fix**: Added `(e.tableName || "")` coercion before `.toLowerCase()`.

---

## Backend Issues (Cannot Fix from Frontend)

### BACKEND-1: `_sqlite_entity_digest` returns wrong response shape
**File**: `server.py:951`
**Line**: `'sources': list(sources.values())`
**Issue**: Returns sources as a list instead of a dict. The Fabric SQL path (server.py:4617) correctly returns a dict. This inconsistency forces the frontend to normalize.
**Recommendation**: Change line 951 to `'sources': sources` (keep it as a dict). Also add `'key'` field to each source object and rename `'statusCounts'` to `'summary'` to match the Fabric SQL path. Add `'generatedAt'` and `'buildTimeMs'` fields.

### BACKEND-2: `_sqlite_engine_status` returns wrong field names
**File**: `server.py:686-690`
**Issue**: Returns `'lastRun'` (camelCase) with raw SQLite columns instead of `'last_run'` (snake_case) with mapped columns like the engine API does.
**Recommendation**: Change the return to match the engine API shape:
```python
return {
    'status': status,
    'current_run_id': None,
    'uptime_seconds': 0,
    'engine_version': '',
    'last_run': {
        'run_id': last_run.get('RunId', ''),
        'started_at': last_run.get('StartedAt', ''),
        'ended_at': last_run.get('EndedAt', ''),
        'status': last_run.get('Status', ''),
        'duration_seconds': last_run.get('TotalDurationSeconds', 0),
    } if last_run else None,
    '_source': 'sqlite',
}
```

### BACKEND-3: `_sqlite_engine_runs` returns raw SQLite column names
**File**: `server.py:670-672` and `server.py:8919-8923`
**Issue**: Returns raw dict from SQLite (PascalCase: `RunId`, `Status`, `StartedAt`, etc.) without the column mapping that `engine/api.py:_handle_runs()` does. But the engine API path wraps results in `{"runs": mapped, "count": len(mapped)}`, while the SQLite path returns a bare list.
**Recommendation**: Apply the same column mapping as `_handle_runs()`, and wrap in `{"runs": [...], "count": N}`.

### BACKEND-4: `_handle_metrics` returns `runs` as array, not count
**File**: `engine/api.py:914`
**Issue**: `"runs": [_safe_row(r) for r in run_metrics]` returns an array of run metrics. The frontend needs a run count.
**Recommendation**: Change to `"runs": len(run_metrics)` or `"run_count": len(run_metrics)`.

### BACKEND-5: `_handle_logs` returns raw SQL column names
**File**: `engine/api.py:670`
**Issue**: Returns `_safe_row(r)` which preserves PascalCase SQL column names. No mapping to the snake_case format the frontend expects.
**Recommendation**: Add column mapping like `_handle_runs()` does.

### BACKEND-6: `_handle_metrics` returns raw SQL column names for slowest_entities and top_errors
**File**: `engine/api.py:916-917`
**Issue**: Returns `_safe_row(r)` with PascalCase SQL columns instead of mapped snake_case.
**Recommendation**: Map `SourceName` to `entity_name`, `DurationSeconds` to `duration_seconds`, `ErrorMessage` to `error_message`, `Occurrences` to `count`.

### BACKEND-7: Inconsistent status values in `_sqlite_entity_digest` overall computation
**File**: `server.py:849`
**Issue**: The overall status computation checks for `('loaded', 'complete', 'Succeeded')` but NOT `'succeeded'` (lowercase). The engine writes `'succeeded'` (lowercase) via the stored proc path. This means entities that succeeded via the engine proc path would not be classified as `overall='complete'`.
**Recommendation**: Normalize status values to lowercase before comparison, or add `'succeeded'` to the success set.

### BACKEND-8: Dead code in `_sqlite_entity_digest`
**File**: `server.py:804-807`
```python
bronze_by_lz = {}
for b in bronze_ents:
    pass
```
**Issue**: This loop body is `pass` (dead code). The variable is immediately overwritten at line 813.
**Recommendation**: Remove lines 804-807.

---

## Data Contract Reference

### `/api/entity-digest` (Primary: SQLite, Fallback: Fabric SQL)

**Frontend expects (after normalization)**:
```typescript
{
  generatedAt: string;
  buildTimeMs: number;
  totalEntities: number;
  sources: Record<string, {
    key: string;
    name: string;
    connection: { server, database, connectionName } | null;
    entities: DigestEntity[];
    summary: { total, complete, pending, error, partial, not_started };
  }>;
}
```

**SQLite path returns**: `sources` as array, `statusCounts` not `summary`, no `key`, no `generatedAt`/`buildTimeMs`.
**Fabric SQL path returns**: Matches expected shape.

### `/api/engine/status` (Primary: SQLite, Fallback: engine API)

**Frontend expects (after normalization)**:
```typescript
{
  status: string;
  current_run_id: string | null;
  uptime_seconds: number;
  engine_version: string;
  last_run: { run_id, started_at, ended_at, status, duration_seconds } | null;
}
```

**SQLite path returns**: `lastRun` (camelCase), raw DB columns.
**Engine API path returns**: `last_run` (snake_case), mapped but with `started`/`completed` instead of `started_at`/`ended_at`.

### `/api/engine/metrics` (Always: engine API -> Fabric SQL)

**Frontend expects (after normalization)**:
```typescript
{
  runs: number;
  layers: LayerMetric[];
  slowest_entities: SlowestEntity[];
  top_errors: TopError[];
}
```

**Engine API returns**: `runs` as array (not number), PascalCase SQL columns in sub-arrays.

### `/api/engine/runs` (Primary: SQLite, Fallback: engine API)

**Frontend expects**: `{ runs: EngineRun[], count: number }`
**SQLite path returns**: Raw array of dicts with PascalCase columns (not wrapped in `{runs, count}`).
**Engine API path returns**: Correctly mapped and wrapped.

### `/api/engine/logs` (Always: engine API -> Fabric SQL)

**Frontend expects**: `{ logs: EngineLog[], count: number }`
**Engine API returns**: Raw PascalCase SQL columns without mapping.

---

## What's Working Correctly

- **KPICard, StatusPieChart, TimeRangeSelector**: Pure display components, no data issues.
- **Entity digest data model**: The entity-level data shape (entity fields like id, tableName, etc.) is consistent between both backend paths.
- **Auto-refresh mechanism**: Timer lifecycle is correctly managed with useRef + cleanup.
- **CSV export**: Correctly serializes all entity fields.
- **Error handling**: Both hooks gracefully catch errors and surface them to the UI.
- **Module-level digest cache**: Singleton pattern with TTL and inflight deduplication works correctly.
- **Pagination**: Page bounds checking handles filter changes correctly.
- **Search**: Case-insensitive, covers tableName/schema/source/id.
