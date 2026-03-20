# Server Refactor Design Spec

**Date:** 2026-03-11
**Author:** Steve Nahrup
**Status:** Draft

## Problem Statement

`dashboard/app/api/server.py` is a 9,267-line monolith with 209 functions, 125 elif route clauses, and 45 handler functions that call Fabric SQL directly. A comprehensive audit of all 42 dashboard pages found 171 frontend bugs (fixed) and 164 backend issues (unfixed). The root causes:

1. **Dual data paths** — Handlers have SQLite AND Fabric SQL code paths that return different response shapes, causing frontend crashes
2. **No centralized error handling** — Each handler implements its own try/except (or doesn't), leading to raw Python tracebacks leaking to the browser
3. **SQL injection** — 5 injection points where f-string interpolation is used with user input
4. **Auth bypass** — Admin password check on `/api/admin/config` fails open when `ADMIN_PASSWORD` env var is unset (empty string matches empty string)
5. **Fabric SQL dependency** — Token auth issues, connection string churn, 429 throttling, sync lag, endpoint death. Source of 80% of infrastructure pain

## Architecture Decision

**Eliminate the Fabric SQL database entirely.** Replace with:
- **SQLite** as the single data store for all dashboard reads AND writes
- **Parquet/Delta export** to a local OneLake directory for lakehouse sync
- **OneLake sync** (already running) pushes Parquet files to the Fabric lakehouse
- **Fabric notebooks** read from lakehouse tables instead of SQL DB

This removes the entire `SQL_INTEGRATION_FRAMEWORK` database, all `query_sql()` / `get_sql_connection()` code, all token auth for `database.windows.net`, all stored procedures, and the sync lag problem that caused weeks of phantom bugs.

## Target Architecture

```
Dashboard UI (React)
       |
  HTTP Server (server.py ~200 lines)
       |
  Route Registry (router.py)
       |
  Middleware (error handling, CORS, logging, JSON serialization)
       |
  Route Modules (routes/*.py — one per domain)
       |
  SQLite (single source of truth for all dashboard data)
       |
  Parquet Export Job (background, on write)
       |
  Local OneLake Directory
       |
  OneLake Sync Agent (auto-pushes to lakehouse)
       |
  Fabric Notebooks (read from lakehouse tables)
```

### Data Source Rules

| Route type | Data source | Direction |
|---|---|---|
| All dashboard reads | SQLite | Read |
| All dashboard writes (config, entity registration, etc.) | SQLite | Write, then queue Parquet export |
| Live operations (trigger pipeline, poll job status) | Fabric REST API | Read (no SQL) |
| SQL Explorer (browse on-prem sources) | On-prem ODBC | Read |
| Lakehouse/Blender queries | Lakehouse SQL endpoint via OneLake | Read (NOTE: uses `analysis.windows.net` token, not `database.windows.net` — separate from Fabric SQL DB auth. This dependency remains intentionally as it provides live lakehouse browsing that cannot be replicated via static Parquet files.) |
| Database Explorer (new page) | SQLite | Read |

**No handler ever has two data paths. No fallback logic. One source per route.**

### What Notebooks Do

Fabric notebooks that run in the cloud write execution data (pipeline audit, copy activity, entity status) to **lakehouse Delta tables**. The dashboard server's background sync reads those tables and updates SQLite. This replaces the current pattern where notebooks write to Fabric SQL via stored procedures.

### Execution Data Ingest (Lakehouse → SQLite)

The background sync currently pulls from Fabric SQL. It will be rewritten to read from lakehouse Delta tables via the **OneLake local directory** (already synced by the OneLake File Explorer agent).

```
Fabric Notebooks → write Delta tables to lakehouse
                            ↓
OneLake Sync Agent → mirrors Delta files to local directory
                            ↓
delta_ingest.py → reads local Parquet/Delta files → upserts into SQLite
```

**`delta_ingest.py`** replaces `_sync_fabric_to_sqlite()`:
- Reads Parquet files from the local OneLake directory (no network calls, no tokens, no throttling)
- Uses `pyarrow.parquet.read_table()` to load each file
- Upserts rows into SQLite execution tables using `INSERT OR REPLACE`
- Tracks a watermark per table (last-modified timestamp of the Parquet file) to avoid re-processing unchanged files
- Runs on the same 30-minute schedule as the current sync, plus on-demand trigger after pipeline runs
- **Zero Fabric SQL dependency** — reads local files only

This avoids reintroducing the Fabric SQL problems (token auth, 429 throttling, sync lag) because the OneLake sync agent handles the cloud ↔ local transfer transparently. The dashboard server never makes a network call to Fabric for execution data.

### Remaining Lakehouse SQL Endpoint Dependency

The **Blender/data access routes** (`/api/blender/*`, `/api/schema`) still use the lakehouse SQL endpoint for live OneLake queries. This is a deliberate remaining dependency because:
- These routes provide interactive data browsing (arbitrary SQL against lakehouse tables)
- This cannot be replicated via static Parquet files
- The lakehouse SQL endpoint uses `analysis.windows.net` tokens (separate from the `database.windows.net` Fabric SQL DB auth)
- This is the same auth path used by Power BI and other Fabric services — it's stable

If this becomes problematic, a future phase can replace it with direct Parquet reads via pyarrow, but that's not in scope for this refactor.

## File Structure

```
dashboard/app/api/
  server.py              # HTTP server + bootstrap (~200 lines)
  router.py              # Route registry, decorator, dispatch, middleware (~200 lines)
  db.py                  # SQLite connection helpers, schema init, migrations (~150 lines)
  parquet_sync.py        # SQLite → Parquet export + OneLake directory management (~200 lines)
  delta_ingest.py        # OneLake Parquet/Delta → SQLite ingest (replaces _sync_fabric_to_sqlite)
  routes/
    __init__.py          # Auto-imports all route modules
    control_plane.py     # /api/control-plane, /api/execution-matrix, /api/record-counts, /api/sources
    engine.py            # /api/engine/* (status, runs, metrics, logs, entities, jobs)
    entities.py          # /api/entities, /api/entity-digest, /api/journey, /api/cascade-impact
    pipeline.py          # /api/pipelines, /api/pipeline-*, /api/runner/*, /api/fabric-jobs
    monitoring.py        # /api/live-monitor, /api/error-intelligence, /api/load-progress
    data_access.py       # /api/blender/*, /api/schema, /api/bronze-*, /api/silver-*
    sql_explorer.py      # /api/sql-explorer/* (on-prem ODBC)
    db_explorer.py       # /api/db-explorer/* (local SQLite browser for Patrick)
    source_manager.py    # /api/sources/import/*, /api/onboarding, /api/discover-tables
    admin.py             # /api/setup/*, /api/admin/*, /api/deploy/*, /api/health
    config_manager.py    # /api/config/*, /api/notebook-config/*
```

## Route Registry Design

### Decorator

```python
# router.py
_routes = {}

def route(method: str, path: str):
    """Register a handler. Supports exact match and prefix match with wildcard."""
    def decorator(fn):
        _routes[(method, path)] = fn
        return fn
    return decorator

def sse_route(method: str, path: str):
    """Register an SSE streaming handler. Bypasses JSON middleware."""
    def decorator(fn):
        _routes[(method, path)] = {"handler": fn, "sse": True}
        return fn
    return decorator
```

### Handler Contract

Every handler is a plain function that receives a `params` dict and returns a dict (or list):

```python
@route("GET", "/api/control-plane")
def get_control_plane(params):
    """Returns control plane data. Middleware handles JSON, CORS, errors."""
    conn = get_db()
    # ... query SQLite ...
    return {"sources": [...], "summary": {...}}
```

- `params` contains merged query string + POST body
- Return value is JSON-serialized by middleware
- Raise `HttpError("message", 400)` for client errors
- Unhandled exceptions are caught by middleware, logged with traceback, returned as `{"error": "message"}` with 500

### Supported Methods

The router supports **GET, POST, and DELETE**. The `@route` decorator accepts any of these:

```python
@route("DELETE", "/api/entities/{id}")
def delete_entity(params):
    entity_id = params["id"]
    # ...
```

**OPTIONS/CORS preflight** is handled automatically by the middleware — no per-route registration needed. The middleware intercepts all OPTIONS requests and returns 204 with CORS headers before dispatch.

### Middleware Pipeline

Every non-SSE request flows through:

1. **CORS preflight** — if OPTIONS, return 204 with CORS headers immediately
2. **Log** — `log.info(f"{method} {path}")`
3. **Parse** — query string → `params`, POST body → merged into `params`
4. **Dispatch** — match path to handler (exact first, then prefix with path params)
5. **Execute** — call handler with `params`
6. **Catch** — `HttpError` → status code + message; `Exception` → 500 + logged traceback
7. **Serialize** — `json.dumps(result)` + Content-Type + CORS headers

### SSE Handlers

SSE routes (pipeline stream, deploy stream, import progress) bypass the JSON middleware. They receive the raw `BaseHTTPRequestHandler` instance and manage their own response lifecycle:

```python
@sse_route("GET", "/api/pipeline-stream")
def pipeline_stream(handler, params):
    """Long-lived SSE connection. Manages own headers and streaming."""
    handler.send_response(200)
    handler.send_header("Content-Type", "text/event-stream")
    # ... streaming logic ...
```

## SQLite Schema

The SQLite database mirrors the current Fabric SQL schema but simplified. Key tables:

### Integration Schema (metadata)
- `Connection` — gateway connections (ConnectionId, ConnectionGuid, Name, Type, ServerName, DatabaseName, IsActive)
- `DataSource` — registered data sources (DataSourceId, Name, ConnectionId, DatabaseName, SchemaFilter)
- `Entity` — all entities across all layers (EntityId, DataSourceId, TableName, Schema, Layer, IsActive, IsIncremental, WatermarkColumn, PrimaryKeys, LastLoadValue)
- `Lakehouse` — lakehouse definitions (LakehouseId, Name, WorkspaceGuid, LakehouseGuid)
- `Workspace` — workspace definitions (WorkspaceId, WorkspaceGuid, Name)
- `Pipeline` — pipeline definitions (PipelineId, Name, IsActive)

### Execution Schema (runtime data)
- `PipelineExecution` — pipeline run history
- `CopyActivityExecution` — copy activity detail
- `NotebookExecution` — notebook run detail
- `EngineRun` — engine run summaries
- `EngineTaskLog` — per-entity task logs
- `EntityStatusSummary` — aggregated entity status (written by digest engine)

### Dashboard Schema (local-only)
- `SyncStatus` — last sync timestamps per table, pending write queue
- `ServerLabels` — display name overrides for servers
- `AdminConfig` — page visibility, admin settings
- `ImportJob` — import job tracking

## Parquet Export

When a write operation modifies SQLite, the affected table(s) are queued for Parquet export:

```python
# parquet_sync.py
import threading

# Whitelist of exportable tables — only these can be queued
EXPORTABLE_TABLES = {
    "Connection", "DataSource", "Entity", "Lakehouse", "Workspace",
    "Pipeline", "EntityStatusSummary", "PipelineExecution",
    "CopyActivityExecution", "NotebookExecution", "EngineRun", "EngineTaskLog",
}

_dirty_lock = threading.Lock()
_dirty_tables: set[str] = set()

def queue_export(table_name: str):
    """Mark a table as dirty. Background thread exports to Parquet."""
    if table_name not in EXPORTABLE_TABLES:
        raise ValueError(f"Unknown table: {table_name}")
    with _dirty_lock:
        _dirty_tables.add(table_name)

def _export_loop():
    """Runs every 10 seconds. Exports dirty tables to OneLake local dir."""
    while True:
        with _dirty_lock:
            tables = _dirty_tables.copy()
            _dirty_tables.clear()
        for table in tables:
            try:
                # NOTE: Identifier (table) can't be parameterized — validated against EXPORTABLE_TABLES allowlist
                rows = db.query(f"SELECT * FROM [{table}]")
                df = pd.DataFrame(rows)
                path = ONELAKE_DIR / f"{table}.parquet"
                df.to_parquet(path, index=False)
                log.info(f"Exported {table} ({len(rows)} rows) to {path}")
            except Exception:
                log.exception(f"Failed to export {table}, will retry next cycle")
                with _dirty_lock:
                    _dirty_tables.add(table)  # re-queue for retry
        time.sleep(10)

# Start as daemon thread in server bootstrap:
# t = threading.Thread(target=_export_loop, daemon=True)
# t.start()
```

The OneLake sync agent (already installed on both laptop and server) picks up the Parquet files and pushes them to the lakehouse automatically.

## Database Explorer Page

New dashboard page that gives Patrick (and Steve) a direct view into the SQLite database:

### Endpoints
- `GET /api/db-explorer/tables` — list all tables with row counts
- `GET /api/db-explorer/table/{name}` — paginated table data with column metadata
- `GET /api/db-explorer/table/{name}/schema` — column names, types, constraints
- `POST /api/db-explorer/query` — read-only SQL query execution (SELECT only, body: `{"sql": "..."}`)

- `GET /api/db-explorer/sync-status` — last sync times, pending exports, data freshness

### Frontend
- Table list sidebar with row counts and last-modified timestamps
- Data grid with sorting, filtering, search
- Schema viewer showing column types
- Sync status banner showing data freshness
- Read-only SQL console for ad-hoc queries (SELECT only, no writes)

## Security Fixes (Baked Into Migration)

Fixed as each handler is extracted from the monolith:

1. **SQL injection in `update_config_value`** — parameterized queries in `routes/config_manager.py`
2. **ODBC injection in SQL Explorer** — server param validated against registered connections allowlist in `routes/sql_explorer.py`
3. **SQL injection in `build_entity_digest`** — parameterized source filter in `routes/entities.py`
4. **SQL injection in `execute_blender_query`** — tightened validation in `routes/data_access.py`
5. **Admin auth bypass** — require ADMIN_PASSWORD env var, reject empty string, never store in React state. Implemented in `routes/admin.py`
6. **Hardcoded credentials** — removed from SourceManager (frontend fix already done in audit)

## Scorched Earth: Fabric SQL Removal

Every trace of the Fabric SQL database must be removed from:

### Code
- `server.py` — delete `query_sql()`, `get_sql_connection()`, `get_fabric_token('database.windows.net')`, SQL connection string, token struct packing
- `control_plane_db.py` — remove all Fabric SQL sync queries (rewrite to read from local OneLake Parquet/Delta files)
- `deploy_from_scratch.py` — remove Phase 6 (SQL DB creation), Phase 6.5 (setup notebook/stored procs), Phase 10 (SQL metadata population), Phase 16 (entity digest engine SQL deployment). NOTE: Phase 7 = "Deploy Notebooks" and Phase 11 = "Update Local Config Files" — these stay.
- `engine/api.py` — replace all 33 `query_sql()` calls with SQLite queries. NOTE: `routes/engine.py` is the new route handler that delegates to `engine/api.py` for business logic. `engine/api.py` remains as a module but all its Fabric SQL calls are replaced with SQLite. It is NOT absorbed into `routes/engine.py`.
- `engine/logging_db.py` — 19 Fabric SQL references, 6 stored proc calls (sp_UpsertEngineRun, sp_AuditPipeline, sp_InsertEngineTaskLog, sp_AuditCopyActivity, sp_UpsertPipelineLandingzoneEntity, sp_UpsertEntityStatus). Rewrite to write directly to SQLite instead of Fabric SQL stored procs.
- `engine/connections.py` — contains `MetadataDB` class (pyodbc connection manager for Fabric SQL). Delete entirely once `logging_db.py` and `engine/api.py` are migrated to SQLite.
- `antigravity/fabric_notebook_runner.py` — remove `sp_UpsertLandingzoneEntity`, `sp_UpsertBronzeLayerEntity`, `sp_UpsertSilverLayerEntity` stored proc calls (lines 135, 151, 160)
- All stored procedure references: sp_UpsertEntityStatus, sp_BuildEntityDigest, sp_AuditPipeline, sp_AuditCopyActivity, sp_UpsertPipelineLandingzoneEntity, sp_UpsertEngineRun, sp_InsertEngineTaskLog, sp_UpsertLandingZoneEntityLastLoadValue
- All notebook source files that write to Fabric SQL: NB_FMD_PROCESSING_LANDINGZONE_MAIN, NB_FMD_LOAD_LANDING_BRONZE, NB_FMD_LOAD_BRONZE_SILVER, NB_FMD_LOAD_LANDINGZONE_MAIN (heaviest stored proc caller)
- Additional notebooks to inventory: NB_FMD_CUSTOM_NOTEBOOK_TEMPLATE (sp_AuditNotebook), NB_FMD_DQ_CLEANSING (may write audit data) — migration may be deferred but must be cataloged
- **Pipeline JSON files** — 22 `PL_FMD_*.DataPipeline/pipeline-content.json` files exist (21 contain `storedProcedureName` references, ~120 total occurrences) to Fabric SQL stored procs. These stored procedure activities must be replaced with notebook activities that write to Delta tables, or removed if the corresponding notebooks already handle the same logging.

### Configuration
- `config/item_config.yaml` — remove SQL DB item ID
- `config.json` — remove `sql` section with connection string
- Environment variables — remove SQL_SERVER, SQL_DATABASE references

### Documentation & Knowledge
- `CLAUDE.md` — remove all Fabric SQL references
- `memory/MEMORY.md` — remove SQL endpoint, token struct, connection string entries
- `memory/sql-endpoint-sync-lag.md` — archive or delete entirely
- `memory/deployment-details.md` — update to reflect new architecture
- `memory/engine-v3.md` — update stored proc references
- `knowledge/` — scan and purge all SQL DB references
- All `AUDIT-*.md` files — backend issues referencing Fabric SQL are now moot
- Inline code comments mentioning Fabric SQL, SQL Analytics Endpoint, or the old connection pattern

### Deployed Artifacts
- Fabric SQL database itself (keep it alive briefly as backup, then decommission)
- NB_SETUP_FMD notebook (deployed stored procs — no longer needed)
- Variable library entries referencing SQL connection

## Implementation Phases

### Phase 1: Route Registry Foundation (Day 1)
1. Create `router.py` with decorator, dispatch, middleware, `HttpError`
2. Create `db.py` with SQLite connection helpers extracted from server.py
3. Create `routes/` directory structure with all module files
4. Extract route handlers into modules — prioritized by domain:
   - **1a.** `routes/admin.py` + `routes/config_manager.py` (fix security issues during extraction)
   - **1b.** `routes/control_plane.py` + `routes/entities.py` + `routes/engine.py` (delete dual data paths)
   - **1c.** `routes/pipeline.py` + `routes/monitoring.py` + `routes/data_access.py`
   - **1d.** `routes/sql_explorer.py` + `routes/source_manager.py` (fix ODBC injection)
5. Rewrite `server.py` `do_GET`/`do_POST`/`do_DELETE` to call `router.dispatch()`
6. Fix backend audit bugs as each handler is extracted (72 total, many resolved by deleting dead Fabric SQL paths)
7. All existing tests must pass after each sub-phase. NOTE: `engine/tests/` contains 14 test files (including `test_api.py`, `test_logging_db.py`, `test_connections.py`) that test against Fabric SQL infrastructure — these will need rewrites as the underlying modules are migrated to SQLite in Phase 2.
8. **Deploy to vsc-fabric at end of day**

### Phase 2: Full SQLite Migration (Day 2-3)
- Expand SQLite schema to cover all integration/execution tables currently in Fabric SQL
- Migrate remaining `query_sql()` write operations to SQLite + Parquet export queue
- Build `parquet_sync.py` for SQLite → Parquet → OneLake local directory
- Build `delta_ingest.py` for OneLake local directory → SQLite (reads execution data written by notebooks)
- **Seed SQLite** from current Fabric SQL data (one-time migration script)
- **Validation gate:** Compare row counts and spot-check checksums between Fabric SQL and seeded SQLite for every table. Do not proceed until counts match.
- Update background sync to use `delta_ingest.py` instead of `_sync_fabric_to_sqlite()`

### Phase 3: Notebook + Pipeline Migration (Day 3-4)
- Update notebooks to write execution logs to lakehouse Delta tables instead of Fabric SQL stored procs:
  - NB_FMD_LOAD_LANDINGZONE_MAIN (heaviest — sp_AuditCopyActivity x3, sp_UpsertPipelineLandingzoneEntity, sp_UpsertLandingZoneEntityLastLoadValue)
  - NB_FMD_PROCESSING_LANDINGZONE_MAIN
  - NB_FMD_LOAD_LANDING_BRONZE
  - NB_FMD_LOAD_BRONZE_SILVER
- Inventory and plan: NB_FMD_CUSTOM_NOTEBOOK_TEMPLATE, NB_FMD_DQ_CLEANSING
- **Pipeline JSON migration:** Update 21 `PL_FMD_*.DataPipeline/pipeline-content.json` files — replace stored procedure activities with notebook activities or remove if redundant with notebook logging
- Upload updated notebooks and pipelines to Fabric
- Test full pipeline execution end-to-end (LZ → Bronze → Silver)

### Phase 4: Database Explorer + Scorched Earth (Day 5)
- Build Database Explorer page (`routes/db_explorer.py` + React component)
- Purge ALL Fabric SQL references from code, config, docs, knowledge, memory
- Update `deploy_from_scratch.py` to reflect new architecture
- Final validation: `grep -r "SQL_INTEGRATION_FRAMEWORK\|query_sql\|get_sql_connection\|get_fabric_token.*database" --include="*.py" --include="*.md" --include="*.json" --include="*.yaml"` returns zero hits
- **Parallel operation period:** Keep Fabric SQL DB alive (read-only) for 1 week minimum as rollback safety net
- After 1 week with no issues: decommission SQL_INTEGRATION_FRAMEWORK database

### Rollback Plan
If the SQLite migration produces incorrect data:
1. Re-enable `_sync_fabric_to_sqlite()` in `server.py` (git revert the delta_ingest change)
2. Fabric SQL DB is still alive during the parallel operation period
3. Notebooks can be reverted to stored-proc versions from git history
4. Pipeline JSONs can be reverted from git history
5. The route registry refactor (Phase 1) is independent and does NOT need to be rolled back

## Environment Configuration

Only two env-specific values:

```json
{
  "onelake_local_dir": "C:/Users/snahrup/OneLake/...",
  "sqlite_db_path": "dashboard/app/api/fmd_control_plane.db"
}
```

Both machines (laptop + vsc-fabric) already have OneLake File Explorer installed and syncing. The SQLite DB lives next to the server code and is gitignored.

## Success Criteria

1. `server.py` is under 300 lines (HTTP server + bootstrap only)
2. Zero `query_sql()` or `get_sql_connection()` calls in any route handler
3. All 42 dashboard pages display consistent numbers from the same SQLite source
4. All 72 backend audit issues are resolved
5. All 5 security vulnerabilities are fixed
6. No grep hits for `SQL_INTEGRATION_FRAMEWORK`, `query_sql`, `get_fabric_token.*database` in the codebase
7. Patrick can browse the metadata database directly in the dashboard
8. Notebooks write execution data to lakehouse Delta tables
9. Dashboard server has zero Fabric SQL dependency
10. Works identically on laptop and vsc-fabric
