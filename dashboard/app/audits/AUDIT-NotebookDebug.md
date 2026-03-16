# AUDIT: NotebookDebug.tsx

**Date**: 2026-03-13
**Frontend**: `dashboard/app/src/pages/NotebookDebug.tsx`
**Backend handler**: MISSING -- all four `/api/notebook-debug/*` endpoints were in the old monolithic `server.py.bak` but have NOT been migrated to the new `routes/*.py` architecture.
**Endpoints consumed**:
- `GET /api/notebook-debug/notebooks`
- `GET /api/notebook-debug/entities?layer=<layer>`
- `POST /api/notebook-debug/run`
- `GET /api/notebook-debug/job-status?jobId=<id>&notebookId=<id>`

---

## Purpose

NotebookDebug (labeled "Pipeline Testing" in the UI) lets users trigger Fabric notebook runs for controlled testing of individual pipeline layers (landing, bronze, silver) against a limited set of entities. It shows entity previews, triggers notebook runs via the Fabric Jobs API, polls for job status, and displays run history.

## Data Flow

1. **On mount**: Fetches `GET /api/notebook-debug/notebooks` to list notebooks in the Fabric CODE workspace. Auto-selects `NB_FMD_PROCESSING_PARALLEL_MAIN`.
2. **On layer change**: Fetches `GET /api/notebook-debug/entities?layer={layer}` to get entity list from stored procedures / views.
3. **On "Run Test" click**: POSTs to `/api/notebook-debug/run` with `{notebookId, layer, maxEntities, dataSourceFilter, chunkMode}`. Returns `{jobInstanceId, notebookId, entityCount, ...}`.
4. **Polling**: Every 5 seconds, fetches `GET /api/notebook-debug/job-status?jobId={id}&notebookId={id}` until status is Completed/Failed/Cancelled.

## API Call Trace

| Frontend Call | Backend Route | Data Source | Status |
|---|---|---|---|
| `GET /api/notebook-debug/notebooks` | `server.py.bak:notebook_debug_list()` | Fabric REST API: `GET /v1/workspaces/{CODE_WS}/items?type=Notebook` | MISSING |
| `GET /api/notebook-debug/entities?layer=bronze` | `server.py.bak:notebook_debug_get_entities('bronze')` | Fabric SQL: `EXEC [execution].[sp_GetBronzelayerEntity_Full]` | MISSING |
| `GET /api/notebook-debug/entities?layer=silver` | `server.py.bak:notebook_debug_get_entities('silver')` | Fabric SQL: `EXEC [execution].[sp_GetSilverlayerEntity_Full]` | MISSING |
| `GET /api/notebook-debug/entities?layer=landing` | `server.py.bak:notebook_debug_get_entities('landing')` | Fabric SQL: `SELECT ... FROM [execution].[vw_LoadSourceToLandingzone]` | MISSING |
| `POST /api/notebook-debug/run` | `server.py.bak:notebook_debug_run(body)` | Fabric REST API: `POST /v1/workspaces/{CODE_WS}/items/{notebookId}/jobs/instances?jobType=RunNotebook` | MISSING |
| `GET /api/notebook-debug/job-status` | `server.py.bak:notebook_debug_job_status()` | Fabric REST API: `GET /v1/workspaces/{CODE_WS}/items/{notebookId}/jobs/instances/{jobId}` | MISSING |

## Data Source Correctness Analysis

### Entity data (bronze/silver layers)
- **Source**: Fabric SQL stored procedures `sp_GetBronzelayerEntity_Full` / `sp_GetSilverlayerEntity_Full`.
- **Correctness**: The stored procs return `NotebookParams` JSON which is parsed into entity summaries. The frontend extracts `namespace`, `schema`, `table`, `fileName` from the `params` sub-object. This is correct -- these match what the pipeline notebooks expect.

### Entity data (landing layer)
- **Source**: Fabric SQL view `[execution].[vw_LoadSourceToLandingzone]`.
- **Correctness**: Queries `EntityId`, `DataSourceName`, `DataSourceNamespace`, `SourceSchema`, `SourceName`, `TargetFilePath`, `TargetFileName`, `TargetFileType`, `TargetLakehouseGuid`, `WorkspaceGuid`, `ConnectionGuid`, `ConnectionType`, `IsIncremental`. Correctly maps these to the same entity summary format used by bronze/silver.

### Notebook listing
- **Source**: Fabric REST API workspace items query filtered to `type=Notebook`.
- **Correctness**: Returns `{id, displayName}` which maps to frontend's `Notebook` interface `{id, name}`. Correct mapping.

### Job status
- **Source**: Fabric REST API job instances endpoint.
- **Correctness**: Maps `status`, `startTimeUtc`, `endTimeUtc`, `failureReason` to the frontend's `JobStatus` interface. Correct.

## Issues Found

### 1. CRITICAL -- All four `/api/notebook-debug/*` endpoints are missing from the route layer

The server refactor migrated handler logic from `server.py.bak` into `routes/*.py` modules, but the notebook-debug endpoints were NOT migrated. No file in `dashboard/app/api/routes/` registers any path starting with `/api/notebook-debug/`.

**Impact**: The entire NotebookDebug page is non-functional. All four API calls will return 404.

**Fix needed**: Create `dashboard/app/api/routes/notebook_debug.py` that registers these four routes and reimplements the logic currently in `server.py.bak` functions `notebook_debug_list()`, `notebook_debug_get_entities()`, `notebook_debug_run()`, and `notebook_debug_job_status()`.

### 2. NOTE -- These endpoints hit Fabric SQL and Fabric REST API, not SQLite

Unlike most other dashboard pages, NotebookDebug does NOT read from the local SQLite control plane DB. It queries:
- **Fabric SQL** (via ODBC) for stored procedures and views
- **Fabric REST API** for notebook listing, triggering, and job status polling

This means the migration requires the Fabric SQL connection logic (`query_sql()`) and Fabric API helpers (`get_fabric_token()`) that currently exist only in `server.py.bak`.

### 3. MINOR -- Entity summary field names are correct

Frontend displays `namespace`, `schema`, `table`, `fileName` which match the backend response format. No field name mismatches.

## Verdict

**Page Status: BROKEN** -- 4/4 endpoints missing from route layer. Page renders but all data fetches will 404.
