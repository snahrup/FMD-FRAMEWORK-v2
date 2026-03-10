# FMD Framework Backend Audit

> Generated: 2026-03-09 | Total backend LOC: ~16,700+ (engine: 5,827 + server.py: ~10,900)

---

## 1. Engine Modules (`engine/*.py`)

**Total**: 14 files, 5,827 lines of Python

| File | LOC | Purpose | Key Classes / Functions | Dependencies |
|------|-----|---------|------------------------|--------------|
| `__init__.py` | 0 | Package marker | — | — |
| `api.py` | 2,213 | REST API handlers for `/api/engine/*` routes. Wired into `server.py`. SSE log streaming, background thread execution. | `_get_engine()`, `_SSEHook`, `_emit_sse()`, `_cleanup_orphaned_runs()`, `_safe_row()`, `_to_int()`, `_to_float()`, `handle_engine_request()` | `engine.config`, `engine.orchestrator`, `engine.models`, `threading`, `json`, `urllib` |
| `auth.py` | 186 | Service Principal token acquisition for 3 scopes. Thread-safe cache with auto-refresh. | `TokenProvider` (class), `AccessToken` (namedtuple), constants: `SCOPE_FABRIC_SQL`, `SCOPE_FABRIC_API`, `SCOPE_ONELAKE` | `engine.models`, `urllib`, `struct`, `threading` |
| `config.py` | 131 | Reads `dashboard/app/api/config.json` + `.env`, builds `EngineConfig`. | `load_config()`, `_load_env()`, `_resolve_env_vars()` | `engine.models` |
| `connections.py` | 180 | Database connection managers for Fabric SQL metadata DB and on-prem source servers. | `MetadataDB` (class), `SourceConnection` (class), `build_source_map()` | `engine.auth`, `engine.models`, `pyodbc`, `struct` |
| `extractor.py` | 302 | Data extraction from on-prem SQL to Parquet byte buffers. Full + incremental loads, chunked reads. | `DataExtractor` (class): `.extract(entity)` returns `(bytes, RunResult)` | `engine.connections`, `engine.models`, `polars`, `pyodbc` |
| `loader.py` | 217 | Write Parquet files to OneLake Landing Zone via ADLS Gen2 API. | `OneLakeLoader` (class): `.upload(entity, parquet_bytes, run_id)` | `engine.auth`, `engine.models`, `azure.storage.filedatalake` |
| `logging_db.py` | 488 | Structured JSON logging to SQL audit tables. **Dual-write**: local SQLite (primary via `control_plane_db`) + Fabric SQL (secondary/best-effort). Orchestrator passes `local_db` module. | `AuditLogger` (class): `.log_run_start()`, `.log_entity_result()`, `.log_run_end()`, `.log_notebook_result()` | `engine.connections`, `engine.models`, `dashboard.app.api.control_plane_db` (optional) |
| `models.py` | 236 | Core data models. No ORM — pure dataclasses with JSON serialization. | `Entity`, `RunResult`, `LogEnvelope`, `EngineConfig`, `LoadPlan` (all `@dataclass`) | `dataclasses`, `datetime` |
| `notebook_trigger.py` | 356 | Trigger Bronze/Silver/Maintenance Fabric notebooks via REST API. Auto-discovers notebook IDs by display name. | `NotebookTrigger` (class): `.trigger_layer(layer, run_id)`, `.poll_job(job_id)` | `engine.auth`, `engine.models`, `urllib` |
| `orchestrator.py` | 840 | Main engine run loop. Extract -> Upload -> Log -> Trigger notebooks. Adaptive concurrency with throttle backoff. | `LoadOrchestrator` (class): `.run(mode)`, `.stop()`, `.status()`, `_AdaptiveConcurrency` (inner class) | `engine.auth`, `engine.config`, `engine.connections`, `engine.extractor`, `engine.loader`, `engine.logging_db`, `engine.models`, `engine.notebook_trigger`, `engine.pipeline_runner`, `engine.preflight` |
| `pipeline_runner.py` | 269 | Trigger `PL_FMD_LDZ_COPY_SQL` per entity via Fabric REST API. Poll-based completion tracking. | `FabricPipelineRunner` (class): `.run_entity(entity)`, `.cancel(job_id)` | `engine.auth`, `engine.models`, `urllib` |
| `preflight.py` | 262 | Pre-run health checks: SP tokens, SQL connectivity, OneLake reachability, source servers, entity worklist validation. | `PreflightChecker` (class): `.run_all()`, `CheckResult`, `PreflightReport` (both `@dataclass`) | `engine.auth`, `engine.connections`, `engine.models` |
| `smoke_test.py` | 147 | End-to-end validation (requires VPN). Tests config, auth, metadata DB, source connectivity, OneLake, and extraction. | `main()` with 7 sequential checks | `engine.config`, `engine.auth`, `engine.connections`, `engine.extractor`, `engine.loader` |

### Dependency Graph

```
orchestrator.py (840 LOC) — central hub
    ├── auth.py
    ├── config.py → models.py
    ├── connections.py → auth.py, models.py
    ├── extractor.py → connections.py, models.py
    ├── loader.py → auth.py, models.py
    ├── logging_db.py → connections.py, models.py
    ├── notebook_trigger.py → auth.py, models.py
    ├── pipeline_runner.py → auth.py, models.py
    └── preflight.py → auth.py, connections.py, models.py

api.py (2,213 LOC) — HTTP surface
    ├── config.py
    ├── orchestrator.py
    └── models.py
```

### Local SQLite Control Plane (`dashboard/app/api/control_plane_db.py`)

**NEW file (added 2026-03-09)** — Replaces Fabric SQL Analytics Endpoint as the primary read source for all control plane / dashboard data. Fabric SQL had 0-30+ min sync lag that caused weeks of phantom bugs (see BURNED-BRIDGES.md Section 3 and 10).

| Aspect | Detail |
|--------|--------|
| **Mode** | SQLite WAL (write-ahead logging) for concurrent reads during writes |
| **Tables** | 16 tables mirroring Fabric SQL schema (config + execution schemas) |
| **Primary consumer** | `server.py` — control plane reads use `cpdb.*` instead of `query_sql()` |
| **Write path** | `logging_db.py` dual-writes: local SQLite first (primary), then Fabric SQL (best-effort) |
| **Sync** | Background thread every 5 min pulls notebook-initiated runs from Fabric SQL that bypassed the local engine |
| **Seeding** | `deploy_from_scratch.py` Phase 13b seeds all entity registrations into local SQLite |

**Rules**:
- All control plane reads go through `cpdb.*` — do NOT add new `query_sql()` calls for control plane data.
- `query_sql()` is still needed for admin, DataBlender, DQ, and other non-control-plane endpoints.
- Do NOT touch: Fabric SQL stored procedures, `query_sql()` function itself, `metrics_store.py`, Engine `MetadataDB`/`SourceConnection` classes.

### External Dependencies

| Package | Used By | Purpose |
|---------|---------|---------|
| `pyodbc` | connections.py, extractor.py | ODBC database connectivity |
| `polars` | extractor.py | DataFrame / Parquet conversion |
| `azure-storage-file-datalake` | loader.py | OneLake ADLS Gen2 uploads |
| `azure-identity` | (indirect) | Credential wrapper for ADLS SDK |
| `sqlite3` | control_plane_db.py | Local SQLite control plane (stdlib, no install needed) |

---

## 2. API Server (`dashboard/app/api/server.py`)

**Total**: ~10,900 lines | **Framework**: stdlib `http.server.BaseHTTPRequestHandler` (no Flask/FastAPI)

### Architecture

- **Class**: `DashboardHandler(BaseHTTPRequestHandler)` — single handler for all routes
- **Routing**: `if/elif` chain in `do_GET()` and `do_POST()` methods (no decorator-based routing)
- **CORS**: Manual `Access-Control-Allow-Origin: *` headers in every response
- **Auth**: SP token via `azure.identity` / manual OAuth2 for Fabric API calls
- **SSE**: Two independent SSE streams — deploy events (`/api/deploy/stream`) and engine logs (`/api/engine/logs/stream`)
- **WebSocket**: None
- **Static serving**: Serves React build from `../dist` when present (production mode)
- **Threading**: `ThreadingHTTPServer` for concurrent request handling

### Route Groups

#### GET Endpoints (~55 routes)

| Group | Routes | Purpose |
|-------|--------|---------|
| **Core Metadata** | `/api/connections`, `/api/gateway-connections`, `/api/datasources`, `/api/entities`, `/api/entities/cascade-impact/*` | Fabric SQL metadata queries |
| **Pipeline Views** | `/api/pipeline-view`, `/api/bronze-view`, `/api/silver-view`, `/api/pipelines`, `/api/pipeline-executions`, `/api/pipeline-matrix` | Pipeline/layer status views |
| **Workspace/Lakehouse** | `/api/workspaces`, `/api/lakehouses`, `/api/bronze-entities`, `/api/silver-entities` | Fabric workspace/lakehouse inventory |
| **Execution** | `/api/copy-executions`, `/api/notebook-executions`, `/api/fabric-jobs`, `/api/pipeline-activity-runs/*`, `/api/live-monitor/*` | Execution history and monitoring |
| **Runner** | `/api/runner/sources`, `/api/runner/entities/*`, `/api/runner/state` | Pipeline runner state and sources |
| **Entity Digest** | `/api/entity-digest/*`, `/api/load-progress/*`, `/api/source-config`, `/api/executive`, `/api/stats` | Aggregated entity status/progress |
| **Control Plane** | `/api/control-plane`, `/api/health`, `/api/schema` | System health, SQL schema introspection |
| **Onboarding** | `/api/onboarding` | Source onboarding wizard state |
| **Data Journey** | `/api/journey/*` | Entity lineage/journey tracking |
| **DataBlender** | `/api/blender/tables`, `/api/blender/endpoints`, `/api/blender/lakehouses`, `/api/blender/profile`, `/api/blender/sample`, `/api/lakehouse-counts/*` | Cross-lakehouse SQL analytics |
| **Purview** | `/api/purview/status`, `/api/purview/search`, `/api/purview/entity/*` | Microsoft Purview integration |
| **Config** | `/api/config-manager`, `/api/config`, `/api/notebook-config`, `/api/config-manager/references`, `/api/load-config` | Configuration CRUD |
| **Setup** | `/api/setup/capacities`, `/api/setup/workspaces/*/lakehouses`, `/api/setup/workspaces/*/sql-databases`, `/api/setup/workspaces/*/notebooks`, `/api/setup/workspaces/*/pipelines`, `/api/setup/current-config`, `/api/setup/validate` | Environment provisioning |
| **Fabric API** | `/api/fabric/workspaces`, `/api/fabric/connections`, `/api/fabric/security-groups`, `/api/fabric/resolve-workspace` | Direct Fabric REST API proxy |
| **Notebook Debug** | `/api/notebook-debug/status`, `/api/notebook-debug/notebooks`, `/api/notebook-debug/entities/*`, `/api/notebook-debug/job-status` | Notebook troubleshooting |
| **Diagnostics** | `/api/diag/stored-procs`, `/api/deploy/preflight`, `/api/deployment/status` | System diagnostics |
| **SQL Explorer** | `/api/sql-explorer/servers`, `/api/sql-explorer/databases/*`, `/api/sql-explorer/schemas/*`, `/api/sql-explorer/tables/*`, `/api/sql-explorer/columns/*` | On-prem SQL object browser |
| **Settings** | `/api/settings/agent-log`, `/api/analyze-source` | Agent collaboration, load optimization |
| **SSE Streams** | `/api/deploy/stream`, `/api/engine/logs/stream` | Server-Sent Events (real-time) |
| **Engine (via api.py)** | `/api/engine/status`, `/api/engine/plan`, `/api/engine/logs`, `/api/engine/health`, `/api/engine/metrics`, `/api/engine/runs` | FMD v3 Engine status/control |
| **MRI** | `/api/mri/*` | Automated regression / integration testing |

#### POST Endpoints (~35 routes)

| Group | Routes | Purpose |
|-------|--------|---------|
| **Data Management** | `/api/entities/bulk-delete`, `/api/sources/purge`, `/api/register-bronze-silver` | Bulk entity operations |
| **Onboarding** | `/api/onboarding`, `/api/onboarding/step`, `/api/onboarding/delete` | Source onboarding wizard CRUD |
| **Setup/Provisioning** | `/api/setup/create-workspace`, `/api/setup/create-lakehouse`, `/api/setup/create-sql-database`, `/api/setup/provision-all`, `/api/setup/save-config` | Fabric resource provisioning |
| **Config Updates** | `/api/config-manager/update`, `/api/notebook-config/update`, `/api/load-config`, `/api/deployment/apply-config` | Configuration writes |
| **Pipeline Execution** | `/api/pipeline/trigger`, `/api/deploy-pipelines`, `/api/runner/prepare`, `/api/runner/trigger`, `/api/runner/restore` | Pipeline triggering and management |
| **Notebook Execution** | `/api/notebook/trigger`, `/api/notebook-debug/run`, `/api/maintenance-agent/trigger` | Notebook triggering |
| **Deployment** | `/api/deploy/start`, `/api/deploy/cancel`, `/api/deploy/wipe-and-trigger` | Deploy lifecycle |
| **Entity Digest** | `/api/entity-digest/resync` | Force resync entity status |
| **Purview** | `/api/purview/entity/*`, `/api/purview/search` | Purview classification writes |
| **DataBlender** | `/api/blender/query` | Execute ad-hoc SQL against lakehouses |
| **SQL Explorer** | `/api/sql-explorer/server-label`, `/api/source-config/label` | Custom label management |
| **Admin** | `/api/admin/auth`, `/api/admin/config` | Admin authentication and page visibility |
| **MRI** | `/api/mri/run`, `/api/mri/api-tests/run`, `/api/mri/baselines/*` | MRI test execution and baselines |
| **Audit** | `/api/audit/run` | Run audit queries |
| **Engine (via api.py)** | `/api/engine/start`, `/api/engine/stop`, `/api/engine/retry`, `/api/engine/abort-run`, `/api/engine/entity/*/reset` | Engine control |

### Middleware / Cross-Cutting Concerns

| Concern | Implementation |
|---------|---------------|
| CORS | Manual headers (`Access-Control-Allow-Origin: *`) per response |
| Auth (Fabric) | SP token via `_get_fabric_token()` — cached, auto-refresh |
| Auth (SQL) | SP token via `struct.pack` pyodbc attrs_before pattern |
| Auth (Admin) | Simple password check via `/api/admin/auth` POST |
| Logging | Python `logging` module, configurable file + level via `config.json` |
| Error handling | Try/catch per route, returns JSON `{"error": "..."}` |
| Static files | Falls through to file serving for non-`/api` paths |

---

## 3. API Config Files (`dashboard/app/api/*.json`)

| File | Size | Purpose | Key Fields |
|------|------|---------|------------|
| `config.json` | 2.1 KB | **Primary config** — server, Fabric, SQL, Purview, paths, engine settings, logging | `server.{host,port}`, `fabric.{tenant_id,client_id,client_secret,workspace_*}`, `sql.{server,database,driver}`, `engine.{lz/bronze/silver_lakehouse_id,batch_size,chunk_rows,load_method}`, `paths.{lz_*,bronze_*,silver_*}`, `logging.{file,level}` |
| `admin_config.json` | 124 B | Page visibility toggling for admin gateway | `hiddenPages` (array of href paths like `/engine`) |
| `.runner_state.json` | ~2 KB | Persisted pipeline runner state — tracks active runs, deactivated entities per layer, selected sources | `active` (bool), `startedAt` (timestamp), `layer`, `selectedSources`, `deactivated.{lz,bronze,silver}` (entity ID arrays) |
| `control_plane_snapshot.json` | 7.9 KB | Cached control plane aggregate — entity/pipeline/workspace/lakehouse counts, pipeline health, connection status | `health`, `lastRefreshed`, `summary.{connections,dataSources,entities.{landing,bronze,silver},pipelines,lakehouses,workspaces}`, `pipelineHealth` |
| `source_labels.json` | 220 B | User-friendly display names for data source databases | Maps DB names to labels: `"MES"→"MES"`, `"ETQStagingPRD"→"ETQ"`, `"DI_PRD_Staging"→"M3 Cloud"`, `"m3fdbprd"→"M3"`, `"Optiva"→"Optiva"` |
| `server_labels.json` | 53 B | User-friendly display names for source SQL servers | Maps server hostnames to labels: `"m3-db1"→"MES"`, `"sqloptivalive"→"Optiva"` |
| `lakehouse_counts_cache.json` | 259 KB | Cached row counts from lakehouse SQL analytics endpoints. Auto-refreshed by `/api/lakehouse-counts` endpoint. | Array of `{lakehouse, table, rowCount, lastRefreshed}` records |
| `fmd_metrics.db` | 6.6 MB | SQLite database for local metrics/analytics. Used by dashboard for historical tracking. | Binary SQLite file |

---

## 4. Engine Tests (`engine/tests/`)

**Total**: 3 test files, 411 lines

| File | LOC | Tests | What It Covers |
|------|-----|-------|----------------|
| `__init__.py` | 0 | — | Package marker |
| `test_models.py` | 140 | ~12 tests | `Entity.qualified_name`, `Entity.onelake_folder` (with/without namespace), `Entity.build_source_query` (full, incremental, no-watermark), `RunResult.succeeded`, `LogEnvelope` serialization, `EngineConfig` defaults, `LoadPlan` construction |
| `test_api.py` | 154 | ~10 tests | `_safe_row()` (basic, datetime, UUID serialization), `_to_int()` / `_to_float()` type coercion, `_SSEHook` integration (mocked, no network) |
| `test_config.py` | 117 | ~8 tests | `_resolve_env_vars()` (simple, missing, dict, nested, passthrough), `_load_env()` file parsing, `load_config()` with temp file + env vars |

### Coverage Gaps

| Module | LOC | Test Coverage | Gap Severity |
|--------|-----|---------------|--------------|
| `models.py` | 236 | **Good** — core properties and serialization tested | Low |
| `api.py` | 2,213 | **Partial** — only utility functions tested, no route handler tests | High |
| `config.py` | 131 | **Good** — env resolution and config loading tested | Low |
| `auth.py` | 186 | **None** — no tests | Medium (network-dependent) |
| `connections.py` | 180 | **None** — no tests | Medium (requires SQL) |
| `extractor.py` | 302 | **None** — no tests | High |
| `loader.py` | 217 | **None** — no tests | High |
| `logging_db.py` | 488 | **None** — no tests | Medium |
| `notebook_trigger.py` | 356 | **None** — no tests | Medium |
| `orchestrator.py` | 840 | **None** — no tests | **Critical** |
| `pipeline_runner.py` | 269 | **None** — no tests | Medium |
| `preflight.py` | 262 | **None** — no tests | Medium |
| `smoke_test.py` | 147 | N/A — this IS a test (e2e) | N/A |
| `server.py` | ~10,900 | **None** — no tests | **Critical** |

### Summary

- **Test ratio**: 411 test LOC / 5,827 engine LOC = **7.1%**
- **Tested modules**: 3 of 12 (models, api utilities, config)
- **Critical gaps**: `orchestrator.py` (840 LOC, zero tests), `server.py` (~10,900 LOC, zero tests), `extractor.py` (302 LOC, zero tests)
- **All tests are offline**: No VPN/network required. `smoke_test.py` is the only e2e test and must be run manually.
- **Framework**: pytest
- **Run**: `python -m pytest engine/tests/ -v`

---

## 5. Key Architecture Notes

### Load Methods

The engine supports two load methods configured via `config.json → engine.load_method`:

| Method | Flow | Used When |
|--------|------|-----------|
| `local` | Source SQL → pyodbc → polars → Parquet bytes → OneLake ADLS upload | Default. Requires VPN to source servers. |
| `pipeline` | Trigger `PL_FMD_LDZ_COPY_SQL` per entity via Fabric REST API | Fallback. No VPN needed but slower. |

### SQL Stored Procedures (called by engine)

| Proc | Schema | Called By |
|------|--------|-----------|
| `sp_UpsertEngineRun` | execution | `logging_db.py` |
| `sp_InsertEngineTaskLog` | execution | `logging_db.py` |
| `sp_AuditPipeline` | logging | `logging_db.py` |
| `sp_AuditCopyActivity` | logging | `logging_db.py` |
| `sp_UpsertPipelineLandingzoneEntity` | execution | `logging_db.py` |
| `sp_UpsertEntityStatus` | execution | `logging_db.py` |
| `sp_GetBronzelayerEntity` | execution | `notebook_trigger.py` (via Fabric notebook) |
| `sp_GetSilverlayerEntity` | execution | `notebook_trigger.py` (via Fabric notebook) |

### SSE Streams

| Stream | Endpoint | Purpose | Pattern |
|--------|----------|---------|---------|
| Deploy | `/api/deploy/stream` | Real-time deploy script output | `_deploy_cond` (threading.Condition) |
| Engine Logs | `/api/engine/logs/stream` | Real-time engine task logs | `_sse_cond` (threading.Condition) |

Both use append-only event lists with Condition-based notification. Max 10,000 events in memory.

### Token Scopes

| Scope | Constant | Used For |
|-------|----------|----------|
| `https://analysis.windows.net/powerbi/api/.default` | `SCOPE_FABRIC_SQL` | Fabric SQL DB queries (NOT `database.windows.net`) |
| `https://api.fabric.microsoft.com/.default` | `SCOPE_FABRIC_API` | Fabric REST API (notebooks, pipelines, workspaces) |
| `https://storage.azure.com/.default` | `SCOPE_ONELAKE` | OneLake ADLS Gen2 file operations |
