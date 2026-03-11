# LoadProgress Page Audit

**File**: `dashboard/app/src/pages/LoadProgress.tsx`
**Date**: 2026-03-10
**Status**: Frontend bugs fixed, backend endpoint missing

---

## CRITICAL: Backend Endpoint Missing

The page fetches `GET /api/load-progress` (line 173), but **this endpoint does not exist in `server.py`**. The page will always show an error banner (`HTTP 404`).

### What the endpoint needs to return

The frontend expects this `LoadData` shape:

```typescript
{
  overall: {
    TotalEntities: number,
    LoadedEntities: number,
    PendingEntities: number,
    PctComplete: number,
    RunStarted: string | null,
    LastActivity: string | null,
    ElapsedSeconds: number | null,
  },
  bySource: [{
    Source: string,          // namespace
    TotalEntities: number,
    LoadedCount: number,
    PendingCount: number,
    PctComplete: number,
    FirstLoaded: string | null,
    LastLoaded: string | null,
  }],
  recentActivity: [{
    TableName: string,
    Source: string,
    LogType: string,
    LogTime: string,
    Layer: string,
    LogData: string | null,
    EntityId: number,
  }],
  loadedEntities: [{
    Source: string,
    Schema: string,
    TableName: string,
    LoadedAt: string | null,
    TargetFile: string,
    IsIncremental: boolean,
    EntityId: number,
    RowsCopied: number | null,
    Duration: string | null,
    Status: string,          // "Loaded" | "Pending"
  }],
  pendingBySource: [{
    Source: string,
    cnt: number,
  }],
  concurrencyTimeline: [{
    time: string,
    concurrent: number,
    bySource: Record<string, number>,
  }],
  serverTime: string,
}
```

### Available data sources for implementation

SQL monitoring views exist (deployed by `scripts/deploy_monitoring_views.py`):
- `execution.vw_LZ_OverallProgress` -- maps to `overall`
- `execution.vw_LZ_ProgressBySource` -- maps to `bySource`
- `execution.vw_LZ_RecentActivity` -- maps to `recentActivity`
- `execution.vw_LZ_LoadStatus` -- maps to `loadedEntities`

SQLite (`control_plane_db.py`) has:
- `entity_status` table (LandingzoneEntityId, Layer, Status, LoadEndDateTime)
- `copy_activity_audit` table (mirrors CopyActivityExecution)
- `lz_entities` + `datasources` tables for entity metadata
- `get_entity_status_all()`, `get_copy_executions()`, `get_registered_entities_full()`

### Recommended implementation approach

Add a `_sqlite_load_progress()` function in `server.py` that builds the response from SQLite tables (consistent with how `/api/control-plane`, `/api/record-counts`, etc. work). The `concurrencyTimeline` and `pendingBySource` fields can be computed from `copy_activity_audit` data.

Route registration needed in `do_GET` around line 8515:
```python
elif self.path == '/api/load-progress':
    if _cpdb_available():
        try:
            self._json_response(_sqlite_load_progress())
        except Exception as e:
            log.warning(f'SQLite load-progress failed: {e}')
            self._error_response(f'Load progress unavailable: {e}')
    else:
        self._error_response('SQLite control plane not initialized', 503)
```

---

## Frontend Bugs Fixed

### 1. `formatDuration(0)` returned "--" instead of "0s" (line 80)

**Root cause**: `if (!seconds)` is truthy when `seconds === 0`.
**Fix**: Changed to `if (seconds == null)`.

### 2. `fetchData` dependency on `data` caused interval thrashing (line 199)

**Root cause**: `useCallback(..., [data])` meant `fetchData` reference changed on every state update. The `useEffect` for the auto-refresh interval (line 205-209) depended on `fetchData`, so the interval was torn down and recreated every time data was fetched.
**Fix**: Added `dataRef` ref to track previous data for the "newly loaded" animation instead of closing over `data` state. Changed dependency array to `[]`.

### 3. `RowsCopied` not normalized in `normalizeData` (line 143)

**Root cause**: `normalizeData` normalized `EntityId` and `IsIncremental` on loaded entities but missed `RowsCopied`, which can arrive as a string from pyodbc. Downstream code at line 219 and 786 had to defensively call `num()` again.
**Fix**: Added `RowsCopied: e.RowsCopied != null ? num(e.RowsCopied) : null` in normalizeData.

---

## Minor Issues (Not Fixed -- Low Impact)

### 4. Fragile "recently loaded" animation detection (lines 181-185)

The code assumes newly loaded entities are the first N items in the `loadedEntities` array (by slicing). This only works if the backend returns entities sorted with most-recent-first. If the backend returns them in a different order, the wrong entities get highlighted. A more robust approach would compare the previous and current `EntityId` sets.

### 5. Source card border color uses string manipulation (line 418)

`c.ring.replace("ring-", "border-")` works because `ring` values are consistently `ring-<color>`, but this is a fragile coupling to the Tailwind class naming convention. Currently functional.

### 6. `timeAgo` doesn't handle future timestamps (line 90)

If `diff` is negative (server clock ahead of client), `Math.floor(diff)` produces negative numbers. The first guard `diff < 5` catches small negatives (shows "just now"), but large clock skew would show "NaN" or negative values. Edge case with aligned clocks.

### 7. Concurrency timeline SVG division by zero potential (line 543)

When `points.length === 1`, the expression `i / (points.length - 1)` divides by 0. The enclosing condition `data.concurrencyTimeline.length > 1` prevents this at the top level, but if `step` filtering reduces to 1 point, it could happen. The `|| i === timeline.length - 1` fallback makes this extremely unlikely.
