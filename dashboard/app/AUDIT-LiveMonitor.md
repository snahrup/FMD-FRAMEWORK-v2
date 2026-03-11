# LiveMonitor Page Audit

**File**: `dashboard/app/src/pages/LiveMonitor.tsx` (702 lines)
**Backend handler**: `dashboard/app/api/server.py` — `get_live_monitor()` (lines 2051-2137)
**Endpoint**: `GET /api/live-monitor?minutes=N`
**Date**: 2026-03-10

---

## Architecture Summary

LiveMonitor uses **HTTP polling** (not SSE). It fetches `/api/live-monitor?minutes=N` on a configurable interval (default 5s). The backend makes 6 independent SQL queries against the Fabric SQL metadata DB and returns a single JSON payload.

The SSE endpoint at `/api/pipeline/stream` exists in server.py but is **not used** by LiveMonitor — it is consumed by PipelineRunner.

### Data Flow
1. Frontend calls `GET /api/live-monitor?minutes=30` (default 30 min window)
2. Backend runs 6 SQL queries: pipeline events, notebook events, copy events, entity counts, bronze entities, LZ entities
3. Frontend groups pipeline events by `PipelineRunGuid` to build pipeline run objects
4. Auto-refresh via `setInterval` at configurable rate (default 5s)

---

## Frontend Bugs Fixed

### 1. Hardcoded time window text (FIXED)
- **Lines**: 407, 415, 515, 578
- **Problem**: Header said "(last 4h)" and empty-state messages said "last 4 hours" regardless of the selected time window dropdown
- **Fix**: Replaced hardcoded strings with dynamic text computed from `timeWindow` state

### 2. `interval` variable shadows `window.setInterval` (FIXED)
- **Line**: 224
- **Problem**: `const [interval, setRefreshInterval] = useState(5)` shadowed the global `setInterval` function. While it didn't cause runtime bugs (React closures capture the right reference), it's a lint violation and maintenance hazard.
- **Fix**: Renamed to `pollInterval`

---

## Backend Bugs (server.py — NOT FIXED, requires server.py edit)

### 3. CRITICAL: Missing `slvPipelineTotal` and `slvProcessed` in counts query
- **Location**: `server.py` lines 2098-2109
- **Problem**: The SQL counts query computes 9 fields but is missing two that the frontend requires:
  - `slvPipelineTotal` — never queried (no `PipelineSilverLayerEntity` table count)
  - `slvProcessed` — never queried (no processed count for Silver pipeline entities)
- **Impact**: The Silver progress bar always shows **0 / N** (0% progress). The "Queued" and "Loaded" stats under the Silver bar always show 0. The progress bar denominator (`slvRegistered`) works, but progress is never tracked.
- **Root cause**: The execution schema may not have a `PipelineSilverLayerEntity` table (Silver uses views). The counts query needs to either:
  - Query a Silver pipeline entity table if one exists, OR
  - Derive Silver processed count from `execution.EntityStatusSummary` or the digest

### 4. Silent exception swallowing on all 6 queries
- **Location**: `server.py` lines 2058-2134
- **Problem**: Every query is wrapped in `try/except Exception: result[key] = []`. If the Fabric SQL endpoint is down or throttled, the frontend shows empty data with no error indication. The frontend only shows errors from the HTTP fetch itself, not from individual query failures.
- **Suggestion**: Return a `warnings` array in the response for partial failures.

### 5. No `time_filter` on bronze/LZ entity queries
- **Location**: `server.py` lines 2116-2134
- **Problem**: Queries #5 and #6 (bronze entities, LZ entities) always return `TOP 20` regardless of the `minutes` parameter. This means changing the time window dropdown has no effect on these two sections — they always show the 20 most recent rows.
- **Impact**: Low. The TOP 20 approach is arguably correct for "recent activity" monitoring, but it's inconsistent with the time window control promise.

### 6. CopyActivityParameters used as EntityName
- **Location**: `server.py` line 2086
- **Problem**: `CopyActivityParameters AS EntityName` aliases the parameters column as entity name. If `CopyActivityParameters` contains JSON or connection strings rather than a clean entity name, the UI would display raw technical data.
- **Impact**: Depends on what the pipeline actually writes to that column. Needs verification.

---

## Data Contract

### Frontend expects (`LiveData` interface):
```typescript
{
  pipelineEvents: PipelineEvent[]    // PipelineName, LogType, LogDateTime, LogData, PipelineRunGuid, EntityLayer
  notebookEvents: NotebookEvent[]    // NotebookName, LogType, LogDateTime, LogData, EntityId, EntityLayer, PipelineRunGuid
  copyEvents: CopyEvent[]            // CopyActivityName, EntityName, LogType, LogDateTime, LogData, EntityId, EntityLayer, PipelineRunGuid
  counts: Counts                     // lzRegistered, lzPipelineTotal, lzProcessed, brzRegistered, brzPipelineTotal, brzProcessed, slvRegistered, slvPipelineTotal, slvProcessed, brzViewPending, slvViewPending
  bronzeEntities: BronzeEntity[]     // BronzeLayerEntityId, SchemaName, TableName, InsertDateTime, IsProcessed, LoadEndDateTime
  lzEntities: LzEntity[]             // LandingzoneEntityId, FilePath, FileName, InsertDateTime, IsProcessed, LoadEndDateTime
  serverTime: string
}
```

### Backend provides:
- All fields above EXCEPT `slvPipelineTotal` and `slvProcessed` (always undefined)
- All values are strings (query_sql converts everything via `str()`)

### Mismatches:
| Field | Frontend expects | Backend provides |
|-------|-----------------|-----------------|
| `counts.slvPipelineTotal` | string (number) | `undefined` |
| `counts.slvProcessed` | string (number) | `undefined` |

---

## Empty Data Handling

- Pipeline Runs: Shows centered message -- OK
- Notebook Executions: Shows centered message with subtitle -- OK
- Copy Activity: Shows centered message -- OK
- Bronze Entities: Shows centered message with subtitle -- OK
- LZ Entities: Shows centered message -- OK
- Error state: Shows red banner with error text -- OK
- Initial loading: Shows spinner -- OK

All empty states handle gracefully. No crashes on null/undefined data.

---

## Polling Lifecycle

- `fetchData` is memoized via `useCallback` with `timeWindow` dependency -- correct
- Initial fetch fires via `useEffect(() => { fetchData() }, [fetchData])` -- correct
- Timer fires via separate `useEffect` with `setInterval` -- cleanup on unmount works correctly
- Changing `timeWindow` remounts `fetchData` (new reference), which triggers both effects -- correct
- Toggling `autoRefresh` off clears the interval immediately -- correct
- No stale closure bugs detected

---

## Performance Notes

- 6 SQL queries per poll (every 5s default) could cause Fabric SQL throttling under load
- No request deduplication — rapid time-window changes could fire overlapping requests
- `parseCopyOutput` and `parseNotebookDetail` are called inline during render, not memoized. With 200+ events this could cause frame drops, but unlikely at current TOP limits.
