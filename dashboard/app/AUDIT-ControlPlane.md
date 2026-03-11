# ControlPlane.tsx Audit — 2026-03-10

## Data Flow

```
Fabric SQL DB
    |
    v (every 30min background sync)
Local SQLite (fmd_control_plane.db)
    |
    v
server.py _sqlite_control_plane() → /api/control-plane
    |
    v
ControlPlane.tsx
```

Entity Metadata tab uses a SEPARATE path:
```
Fabric SQL DB (LIVE, no SQLite fallback)
    |
    v
server.py get_load_config() → /api/load-config
    |
    v
ControlPlane.tsx entities state
```

## Bugs Found and Fixed (in this worktree)

### BUG 1: isActive comparison broken for SQLite integers (FIXED)
- **File**: `dashboard/app/src/pages/ControlPlane.tsx`, lines 559, 560, 591
- **Problem**: The comparisons `String(c.isActive).toLowerCase() === 'true' || c.isActive === '1'` fail when SQLite returns integer `1` (not string). `String(1).toLowerCase()` is `'1'` not `'true'`, and `1 === '1'` is `false` (strict equality). Result: ALL connections and data sources show as INACTIVE (red dots, "Partial" badges) even when they are active.
- **Fix**: Created `checkActive(val)` helper that handles `true`, `1`, `'true'`, and `'1'`.
- **Impact**: Sources tab showed every source as "Partial" and every connection with a red dot. Now correctly shows green/active.

### BUG 2: Hardcoded pipeline counts (FIXED)
- **File**: `dashboard/app/src/pages/ControlPlane.tsx`, lines 690-696
- **Problem**: Infrastructure tab showed "DEV (IDs 1-22): 22" and "PROD (IDs 23-44): 22" as hardcoded values regardless of actual pipeline count in the database.
- **Fix**: Replaced with dynamic calculation from `s.pipelines.total`.

### BUG 3: Entity metadata filter crash on null fields (FIXED)
- **File**: `dashboard/app/src/pages/ControlPlane.tsx`, line 414
- **Problem**: The search filter calls `.toLowerCase()` on `e.table`, `e.FileName`, `e.schema` without null guards. If any of these SQL columns returns null (e.g., FileName is nullable), the filter crashes with "Cannot read properties of null".
- **Fix**: Added `|| ''` fallback before `.toLowerCase()`.

### BUG 4: No user feedback when entity metadata fails (FIXED)
- **File**: `dashboard/app/src/pages/ControlPlane.tsx`
- **Problem**: `/api/load-config` always hits Fabric SQL (no SQLite fallback). When Fabric SQL is unreachable, the entity metadata tab silently shows "0 of 0 entities" with no explanation. The user has no idea why the table is empty.
- **Fix**: Added `entityError` state and a warning banner in the metadata tab when the load-config endpoint fails.

## Backend Issues (NOT fixed — server.py)

### ISSUE 5: /api/load-config has no SQLite fallback
- **File**: `dashboard/app/api/server.py`, line 8791-8794
- **Problem**: Unlike `/api/control-plane` which reads from SQLite primary and falls back to Fabric SQL, the `/api/load-config` endpoint ONLY queries Fabric SQL directly via `get_load_config()` (line 5386). There is no `_sqlite_load_config()` equivalent.
- **Impact**: When Fabric SQL is down, the Entity Metadata tab shows nothing. All other tabs (health bar, sources, infrastructure, execution) work from SQLite.
- **Recommendation**: Build a `_sqlite_load_config()` that joins `lz_entities` + `bronze_entities` + `silver_entities` + `watermarks` in SQLite. The schema already has all the data needed.

### ISSUE 6: /api/load-config route has no try/except
- **File**: `dashboard/app/api/server.py`, line 8791-8794
- **Problem**: The route handler calls `get_load_config()` without its own try/except. If Fabric SQL throws, it falls through to the top-level `do_GET` exception handler (line 8941) which returns a generic 500. This works but the error message is raw Python exception text.
- **Impact**: Low — the top-level handler catches it, but the error message is ugly.

### ISSUE 7: Pipeline audit sync creates duplicate rows
- **File**: `dashboard/app/api/server.py`, line 358-361
- **Problem**: `_sync_fabric_to_sqlite()` calls `cpdb.insert_pipeline_audit(r)` which does `INSERT INTO` (not `INSERT OR REPLACE`). Every 30-minute sync re-inserts the same TOP 2000 pipeline audit rows. Over time, `pipeline_audit` grows unboundedly with duplicates.
- **Impact**: `get_pipeline_runs_grouped()` groups by PipelineRunGuid so duplicates don't affect the final count, but the table bloats and query performance degrades.
- **Fix needed**: Either use `INSERT OR REPLACE` with a natural key, or `DELETE` old rows before re-inserting, or add a sync watermark filter.

### ISSUE 8: Workspace shape mismatch between SQLite and Fabric SQL paths
- **File**: `dashboard/app/api/server.py`
- **SQLite path** (line 594): Explicitly builds `{'WorkspaceId': ..., 'Name': ...}` — returns `WorkspaceId` as integer.
- **Fabric SQL path** (line 4422): Returns raw `query_sql()` results — `WorkspaceId` is a string (all values stringified by `query_sql`).
- **Frontend** (line 644): Uses `ws.WorkspaceId` as a React key. Works with both types, but the inconsistency could cause issues if the key changes between refreshes (string '1' vs number 1).
- **Impact**: Low — React coerces keys to strings.

## Summary of Current SQLite Data

| Table | Rows | Notes |
|-------|------|-------|
| lz_entities | 1,666 | All 5 sources |
| bronze_entities | 1,666 | Matches LZ 1:1 |
| silver_entities | 1,666 | Matches LZ 1:1 |
| entity_status | 4,998 | 1,666 x 3 layers |
| engine_runs | 6 | |
| pipeline_audit | 18 | May have duplicates from sync |
| pipeline_lz_entity | 0 | Queue tables empty |
| pipeline_bronze_entity | 0 | Queue tables empty |
| watermarks | 0 | No watermark data synced |
| engine_task_log | 0 | No task logs |

## Contract Verification

| Frontend Field | API Field | Source | Match? |
|----------------|-----------|--------|--------|
| `data.health` | `health` | SQLite control plane | Yes |
| `data.lastRefreshed` | `lastRefreshed` | Generated at query time | Yes |
| `data._fromSnapshot` | `_fromSnapshot` | Always false for SQLite | Yes |
| `data.summary.connections.active` | Counted from connections table | SQLite | Yes |
| `data.summary.entities.landing.active` | Counted from lz_entities | SQLite | Yes |
| `data.pipelineHealth.recentRuns` | Counted from pipeline_audit | SQLite | Yes |
| `data.sourceSystems[].isActive` | Integer 0/1 from SQLite | SQLite | **FIXED** |
| `data.lakehouses[].Environment` | Derived from LakehouseId | SQLite | Yes |
| `data.workspaces[].WorkspaceId` | Integer PK | SQLite | Yes (coerced) |
| `entities[].entityId` | LandingzoneEntityId | Fabric SQL | Yes |
| `entities[].IsIncremental` | Stringified bool | Fabric SQL | Yes |
| `entities[].FileName` | Nullable | Fabric SQL | **FIXED** (null guard) |
