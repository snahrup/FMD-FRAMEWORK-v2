# Audit: SourceManager + SourceOnboardingWizard

**Date**: 2026-03-10
**Files audited**:
- `dashboard/app/src/pages/SourceManager.tsx` (1505 lines)
- `dashboard/app/src/components/sources/SourceOnboardingWizard.tsx` (1651 lines)
- `dashboard/app/src/hooks/useEntityDigest.ts`
- `dashboard/app/src/hooks/useSourceConfig.ts`
- `dashboard/app/src/contexts/BackgroundTaskContext.tsx`
- `dashboard/app/api/server.py` (import orchestration: lines 5162-5384, SSE: 8518-8552)

---

## Frontend Bugs Fixed

### 1. Hardcoded SQL Credentials (SECURITY - CRITICAL)
**File**: `SourceOnboardingWizard.tsx:150`
**Was**: `useState({ username: 'UsrSQLRead', password: 'Ku7T@hoqFDmDPqG4deMgrrxQ9' })`
**Fixed**: `useState({ username: '', password: '' })`
**Impact**: Credentials were hardcoded as default state and visible in source control.

### 2. SSE Error Handler Stale Closure (BUG)
**File**: `SourceOnboardingWizard.tsx:644-659`
**Was**: `es.onerror` captured `importComplete` by closure at creation time (always `false`), so the fallback poll would always execute even if `onmessage` already set it to `true`.
**Fixed**: Added `importCompleteRef` (useRef) that is updated alongside the state setter. The `onerror` handler reads from the ref to get the current value.
**Impact**: On SSE disconnect after successful completion, the browser would unnecessarily poll the status endpoint.

### 3. Import Sends ALL Entities, Not Just Current Source (BUG)
**File**: `SourceOnboardingWizard.tsx:598`
**Was**: `registeredEntities.map(e => ...)` sent every entity from every source to the import endpoint.
**Fixed**: Filter entities by matching `DataSourceName` against the current onboarding source's database name, namespace, or selected source name. Falls back to all entities if no match found.
**Impact**: Importing source A would trigger re-import of sources B, C, D, E.

### 4. Import datasourceId Resolves to NaN (BUG - CRITICAL)
**File**: `SourceOnboardingWizard.tsx:594,607`
**Was**: `dsStep?.referenceId` stores the database name (e.g., "mes") from step 2, not a numeric ID. `parseInt(dsId)` on a non-numeric string produces `NaN`, then fallback to `0`.
**Fixed**: Look up the actual DataSourceId from `registeredDataSources` by matching the database name. Throws a clear error if the lookup fails.
**Impact**: Import would always send `datasourceId: 0` or `NaN` to the backend, causing `register_entity()` to fail.

### 5. No SSE Cleanup on Retry (BUG)
**File**: `SourceOnboardingWizard.tsx:583`
**Was**: When the user clicks "Retry Import" after a failure, `startImport` runs again without closing the old EventSource ref.
**Fixed**: `startImport` now closes and nulls any existing EventSource before creating a new one. Also nulls the ref in `onmessage` terminal events and `onerror`.
**Impact**: Potential memory leak and stale event listeners.

### 6. updateStep Fire-and-Forget with No Error Handling (BUG)
**File**: `SourceOnboardingWizard.tsx:304-316`
**Was**: `fetch()` call with no error handling. If the network request fails, the error is silently swallowed and the Promise rejects unhandled.
**Fixed**: Added try/catch with `console.warn` for both HTTP errors and network failures.
**Impact**: Unhandled promise rejections in the console; silent failures during onboarding step updates.

### 7. digestToRegistered DataSourceName Mismatch (DATA CONTRACT)
**File**: `SourceManager.tsx:140`
**Was**: `DataSourceName: d.source` mapped to the digest's `source` field (ds.Namespace, e.g., "MES"). But the wizard's `alreadyRegisteredKeys` filter compares against step 2's `referenceId` which is the database name (e.g., "mes").
**Fixed**: `DataSourceName: d.dataSourceName || d.source` to use the database name from the digest (which is `row.dbName` from the stored proc).
**Impact**: Already-registered table detection in Step 2 would fail to match, causing registered tables to appear as "new" and selectable for re-registration.

---

## Backend Issues (Documented, Not Fixed)

### B1. `_run_source_import` Calls `register_entity()` with Wrong Keys (CRITICAL)
**File**: `server.py:5281-5285`
**Problem**: The import orchestrator passes:
```python
register_entity({
    'datasourceId': datasource_id,   # wrong key: expects 'dataSourceName'
    'schema': schema,                 # wrong key: expects 'sourceSchema'
    'table': table,                   # wrong key: expects 'sourceName'
})
```
But `register_entity()` (line 4701) expects:
```python
ds_name = body.get('dataSourceName', '')   # will get ''
ds_type = body.get('dataSourceType', 'ASQL_01')
schema = body.get('sourceSchema', 'dbo')    # will get 'dbo' (not the actual schema)
table = body.get('sourceName', '')          # will get ''
```
**Impact**: Phase 1 (entity registration) in the import pipeline silently fails for every table. The `register_entity` call gets empty `ds_name` and `table`, causing `DataSource not found` errors. Registration does NOT happen.

**Fix needed**: Change the import to pass:
```python
register_entity({
    'dataSourceName': ds_name_from_datasource_id,
    'dataSourceType': ds_type_from_datasource_id,
    'sourceSchema': schema,
    'sourceName': table,
    'fileName': f'{prefix}.{table}' if prefix else table,
    'filePath': file_path,
})
```
This requires looking up the DataSource name/type from the datasource_id before the registration loop.

### B2. Pipeline Triggers Are Fire-and-Forget (DESIGN FLAW)
**File**: `server.py:5311-5342`
**Problem**: Phases 3-5 (LZ, Bronze, Silver pipeline triggers) call `trigger_pipeline()` which starts the Fabric pipeline via REST API, but does NOT wait for it to complete. The import immediately moves to the next phase. This means:
- Bronze pipeline triggers while LZ is still copying data
- Silver pipeline triggers while Bronze is still processing
- The "complete" event fires before any actual data has been loaded

**Impact**: The user sees "Import complete" within seconds, but the actual data loading takes minutes to hours. The progress bar is misleading -- it tracks orchestration progress, not data movement. The pipelines may also fail because they depend on the previous layer's output.

**Mitigation**: This is partially mitigated by the existing pipeline logic (each pipeline checks for available data in previous layers), but the progress reporting to the user is inaccurate. A proper fix would poll `jobInstanceId` status until the pipeline completes before advancing to the next phase.

### B3. No Datasource Name Resolution in Import Thread
**File**: `server.py:5263-5270`
**Problem**: The import thread receives `datasourceId` but Phase 1 registration needs the datasource NAME (see B1). The thread has no code to look up the DataSource name from the ID.
**Impact**: Even if B1's key names were fixed, there's no mechanism to supply the `dataSourceName` that `register_entity()` requires.

### B4. Import Jobs Never Cleaned Up
**File**: `server.py:5177`
**Problem**: `_import_jobs` dict grows forever. Completed jobs are never removed. Over time this is a memory leak.
**Impact**: Low severity for now (each job is small), but should have a TTL-based cleanup.

### B5. `register_bronze_silver()` Receives Credentials But Doesn't Use Them for Registration
**File**: `server.py:5305`
**Problem**: `register_bronze_silver(int(datasource_id), username=username, password=password)` passes credentials, but `register_bronze_silver()` (if it follows the pattern of the existing one around line 5100) uses them for source analysis, not for the actual SQL metadata INSERT. This is probably fine but worth verifying the function signature.

---

## Full Import Data Flow

### Frontend Flow
1. User reaches Step 3 ("Import Data") in the wizard
2. Clicks "Import N Tables" button
3. `startImport()`:
   a. Resolves datasource ID from step 2's referenceId (database name) via `registeredDataSources` lookup
   b. Filters `registeredEntities` to only this source's entities
   c. POST to `/api/sources/import` with `{ datasourceId, datasourceName, tables, username, password }`
   d. Receives `{ jobId }` in response
   e. Opens SSE connection to `/api/sources/import/{jobId}/stream`
   f. Updates progress bar from SSE events

### Backend Flow (`_run_source_import`)
1. **Phase 1 - Register** (5-15%): Loops through tables, calls `register_entity()` for each
   - **BROKEN**: Wrong key names (see B1). All registrations silently fail.
2. **Phase 2 - Optimize** (20-35%): Calls `analyze_source_tables()` to discover PKs, watermarks, row counts from on-prem SQL. Then calls `register_bronze_silver()`.
3. **Phase 3 - Load LZ** (40-55%): Triggers `PL_FMD_LDZ_COPY_SQL` pipeline (fallback: `PL_FMD_LDZ_COPY_FROM_ASQL_01`)
   - Fire-and-forget: does NOT wait for pipeline to complete
4. **Phase 4 - Load Bronze** (60-75%): Triggers `PL_FMD_LOAD_LANDING_BRONZE`
   - Fire-and-forget
5. **Phase 5 - Load Silver** (80-95%): Triggers `PL_FMD_LOAD_BRONZE_SILVER`
   - Fire-and-forget
6. **Complete** (100%): Marks job done

### SSE Protocol
- Server: HTTP 200 with `Content-Type: text/event-stream`
- Events: `data: {"phase":"...","label":"...","progress":N}\n\n`
- Terminal events: `phase: "complete"` or `phase: "failed"`
- Keepalive: `: keepalive\n\n` every 15 seconds
- Server blocks on `threading.Condition.wait()` for new events

### Does Import Actually Work End-to-End?

**No.** The import pipeline has two critical failures:

1. **Phase 1 registration is broken** (B1): Wrong dictionary keys mean no entities get registered. However, if entities were already registered in Step 2 via the wizard's `bulkRegisterEntities()`, this phase is redundant and the import continues.

2. **Phases 3-5 are fire-and-forget** (B2): Pipelines are triggered but not awaited. The Bronze pipeline may start before LZ finishes, and Silver before Bronze. The Fabric pipelines have their own internal logic to handle this (they query for available data), but timing issues are possible.

**Practical reality**: If the user completed Steps 1 and 2 of the wizard (entities already registered and potentially already optimized via the Load Optimization tab), then clicking "Import" in Step 3 will:
- Skip Phase 1 registration (entities exist, re-registration is idempotent via sp_Upsert)
- Phase 2 optimization runs (works, useful for PK/watermark discovery)
- Phases 3-5 trigger the pipelines (they fire, but progress tracking is fake)

The user experience is: "Import complete" appears in seconds, but actual data loading takes 10-60+ minutes depending on source size.

---

## SourceManager.tsx Additional Notes

### Entity Digest Integration
The page uses `useEntityDigest()` to derive `registeredEntities` instead of fetching `/api/entities` directly. This is efficient (single cached request) but means entity data is slightly stale (30s client TTL).

### Load Optimization Tab
Works correctly. `fetchLoadConfig()` hits `/api/load-config` (Fabric SQL query), `handleAnalyzeSource()` hits `/api/analyze-source` (connects to on-prem SQL via VPN). Both endpoints are well-implemented.

### Delete Operations
Both single and bulk delete work correctly with cascade impact preview. The cascade impact endpoint `/api/entities/cascade-impact` returns affected Bronze and Silver entities.

### Gateway Connection Registration
Works correctly. The `registerConnection` function generates FMD naming convention (`CON_FMD_{SERVER}_{DB}`) and calls `/api/connections` POST.

### Onboarding Wizard Modal
The wizard opens as a modal overlay on the SourceManager page. Props are passed correctly. The `onRefresh` callback invalidates both digest cache and reloads gateway/connection/datasource data.
