# AUDIT: LiveMonitor
**File**: `dashboard/app/src/pages/LiveMonitor.tsx`
**Backend**: `dashboard/app/api/routes/monitoring.py`
**DB layer**: `dashboard/app/api/db.py` (thin wrapper around `fmd_control_plane.db`)
**Audited**: 2026-03-13
**Focus**: Data source correctness

---

## Data Points Verified

### 1. Pipeline Events (Pipeline Runs card)
- **Frontend expects**: array `pipelineEvents` with fields `PipelineName`, `LogType`, `LogDateTime`, `LogData`, `PipelineRunGuid`, `EntityLayer` from `GET /api/live-monitor?minutes=N`
- **Backend provides** (monitoring.py:61-65): `SELECT PipelineName, LogType, LogDateTime, LogData, PipelineRunGuid, EntityLayer FROM pipeline_audit ORDER BY LogDateTime DESC LIMIT 50`
- **Schema**: `pipeline_audit` has all 6 columns. 4 rows exist.
- **Status**: CORRECT (column mapping)
- **Issue**: See B1 below -- `minutes` parameter is ignored.

### 2. Notebook Events (Notebook Executions card)
- **Frontend expects**: array `notebookEvents` with fields `NotebookName`, `LogType`, `LogDateTime`, `LogData`, `EntityId`, `EntityLayer`, `PipelineRunGuid`
- **Backend provides** (monitoring.py:68-73): `SELECT '' AS NotebookName, Status AS LogType, created_at AS LogDateTime, ErrorMessage AS LogData, EntityId, Layer AS EntityLayer, RunId AS PipelineRunGuid FROM engine_task_log ORDER BY created_at DESC LIMIT 200`
- **Status**: WRONG
- **Issue**: See B2 below -- queries `engine_task_log` instead of `notebook_executions`. Column mapping is lossy: `NotebookName` is hardcoded to empty string, `Status` is aliased as `LogType` (but Status values like `Succeeded`/`Failed` do not match LogType values like `StartNotebookActivity`/`EndNotebookActivity`/`FailNotebookActivity`), `ErrorMessage` is aliased as `LogData` (loses structured JSON copy output data). The frontend's `parseNotebookDetail()` tries to `JSON.parse(LogData)` expecting `{Action, CopyOutput, ...}` but will get plain error text strings from `ErrorMessage`.

### 3. Copy Events (Copy Activity card)
- **Frontend expects**: array `copyEvents` with fields `CopyActivityName`, `EntityName`, `LogType`, `LogDateTime`, `LogData`, `EntityId`, `EntityLayer`, `PipelineRunGuid`
- **Backend provides** (monitoring.py:76-80): `SELECT CopyActivityName, CopyActivityParameters AS EntityName, LogType, LogDateTime, LogData, EntityId, EntityLayer, PipelineRunGuid FROM copy_activity_audit ORDER BY LogDateTime DESC LIMIT 100`
- **Schema**: `copy_activity_audit` has all source columns. `CopyActivityParameters` is aliased as `EntityName`.
- **Status**: WRONG (semantic)
- **Issue**: See B3 below -- `CopyActivityParameters` is a JSON parameters blob, not an entity display name. The frontend displays `evt.EntityName` as the entity label in the Copy Activity table (line 593). Users will see raw JSON or parameter text instead of a human-readable entity name. The table has no `EntityName` column; the closest would be to join `lz_entities` on `EntityId` to get `SourceName`.

### 4. Entity Processing Counts -- lzRegistered / brzRegistered / slvRegistered
- **Frontend expects**: `counts.lzRegistered`, `counts.brzRegistered`, `counts.slvRegistered` from the `counts` object
- **Backend provides** (monitoring.py:85-87):
  - `SELECT COUNT(*) AS cnt FROM lz_entities` (1666 rows)
  - `SELECT COUNT(*) AS cnt FROM bronze_entities` (1666 rows)
  - `SELECT COUNT(*) AS cnt FROM silver_entities` (1666 rows)
- **Status**: CORRECT
- **Note**: Counts all entities regardless of `IsActive` flag. This may be intentional (show total registered) but differs from the `IsActive=1` filter pattern used elsewhere. Not flagging as a bug since "registered" plausibly means all.

### 5. Entity Processing Counts -- lzProcessed / brzProcessed / slvProcessed
- **Frontend expects**: `counts.lzProcessed`, `counts.brzProcessed`, `counts.slvProcessed`
- **Backend provides** (monitoring.py:93-105): Queries `entity_status` table grouped by `LOWER(Layer)` where status is `'succeeded'` or `'loaded'`.
  - `lzProcessed` = count where layer is `'landing'` or `'landingzone'`
  - `brzProcessed` = count where layer is `'bronze'`
  - `slvProcessed` = count where layer is `'silver'`
- **Schema**: `entity_status` has 4998 rows with `(LandingzoneEntityId, Layer)` PK.
- **Status**: CORRECT -- this is the fixed version noted in the task context.

### 6. Entity Processing Counts -- lzPipelineTotal / brzPipelineTotal / slvPipelineTotal
- **Frontend expects**: `counts.lzPipelineTotal`, `counts.brzPipelineTotal`, `counts.slvPipelineTotal` (displayed as "Queued" under each progress bar)
- **Backend provides**: NOT PROVIDED. The `counts` dict (monitoring.py:99-106) only returns `*Registered` and `*Processed` keys.
- **Status**: MISSING
- **Issue**: See B4 below. Frontend will display 0 for all "Queued" values because `num()` returns 0 for undefined fields.

### 7. Entity Processing Counts -- brzViewPending / slvViewPending
- **Frontend expects**: `counts.brzViewPending`, `counts.slvViewPending` (displayed as "Pending" under Bronze and Silver progress bars)
- **Backend provides**: NOT PROVIDED.
- **Status**: MISSING
- **Issue**: See B4 below. Same root cause -- backend doesn't compute pending counts.

### 8. Bronze Entities (Bronze Layer card)
- **Frontend expects**: array `bronzeEntities` with fields `BronzeLayerEntityId`, `SchemaName`, `TableName`, `InsertDateTime`, `IsProcessed`, `LoadEndDateTime`
- **Backend provides** (monitoring.py:111-116): `SELECT BronzeLayerEntityId, SchemaName, TableName, InsertDateTime, IsProcessed, updated_at AS LoadEndDateTime FROM pipeline_bronze_entity ORDER BY InsertDateTime DESC LIMIT 20`
- **Schema**: `pipeline_bronze_entity` has `BronzeLayerEntityId`, `TableName`, `SchemaName`, `InsertDateTime`, `IsProcessed` -- columns match.
- **Status**: WRONG (data availability)
- **Issue**: See B5 below -- `pipeline_bronze_entity` has 0 rows. This table is only populated when the Fabric pipeline runs, but entity processing data lives in `entity_status`. The card will always show "No Bronze entities have been processed yet" even though 1666 entities have status data.

### 9. LZ Entities (Landing Zone card)
- **Frontend expects**: array `lzEntities` with fields `LandingzoneEntityId`, `FilePath`, `FileName`, `InsertDateTime`, `IsProcessed`, `LoadEndDateTime`
- **Backend provides** (monitoring.py:119-124): `SELECT LandingzoneEntityId, FilePath, FileName, InsertDateTime, IsProcessed, updated_at AS LoadEndDateTime FROM pipeline_lz_entity ORDER BY InsertDateTime DESC LIMIT 20`
- **Schema**: `pipeline_lz_entity` has `LandingzoneEntityId`, `FileName`, `FilePath`, `InsertDateTime`, `IsProcessed` -- columns match.
- **Status**: WRONG (data availability)
- **Issue**: See B6 below -- `pipeline_lz_entity` has 0 rows. Same root cause as Bronze: pipeline_lz_entity is only written by Fabric pipelines. The card will always show "No LZ pipeline entities tracked".

### 10. Server Time
- **Frontend expects**: `serverTime` string
- **Backend provides** (monitoring.py:126): `datetime.now(timezone.utc).isoformat()` with `Z` suffix
- **Status**: CORRECT

---

## Backend Issues Found

### B1: `minutes` time-window parameter is parsed but never used in any SQL query
- **File**: `dashboard/app/api/routes/monitoring.py:52-65`
- **Issue**: The frontend sends `GET /api/live-monitor?minutes=30` (or whatever the user selects from the dropdown). The backend parses `minutes` into an integer (line 52-56) but never applies it to any SQL WHERE clause. All 6 queries return data without any time filter -- only limited by `LIMIT N`.
- **Impact**: The time-window dropdown in the UI header (5m / 15m / 30m / 1h / 2h / 4h / 8h / 24h / All time) has zero effect on the data returned. Users get the same 50 pipeline events regardless of selection.
- **Fix needed**: Add a `WHERE LogDateTime >= datetime('now', '-N minutes')` clause to the pipeline_audit, engine_task_log, and copy_activity_audit queries, or use the `minutes` value `0` to skip filtering.

### B2: Notebook events query uses wrong table with incompatible column semantics
- **File**: `dashboard/app/api/routes/monitoring.py:68-73`
- **Issue**: The query reads from `engine_task_log` (an engine execution log) instead of `notebook_executions` (the actual notebook execution log table). The column aliasing creates semantic mismatches:
  1. `NotebookName` is hardcoded to `''` -- the frontend shows empty notebook names.
  2. `Status AS LogType` -- engine_task_log.Status contains values like `Succeeded`/`Failed`/`Skipped`. The frontend filters on `LogType === 'StartNotebookActivity'` / `'EndNotebookActivity'` / `'FailNotebookActivity'`. These will never match, so `nbStarts`, `nbEnds`, `nbFails` will always be 0.
  3. `ErrorMessage AS LogData` -- the frontend's `parseNotebookDetail()` tries `JSON.parse()` on this, but ErrorMessage is plain text, causing silent catch-to-empty results.
- **Fix needed**: Query from `notebook_executions` table directly: `SELECT NotebookName, LogType, LogDateTime, LogData, EntityId, EntityLayer, PipelineRunGuid FROM notebook_executions ORDER BY LogDateTime DESC LIMIT 200`. Note: `notebook_executions` currently has 0 rows, so both tables are empty -- but when data does arrive, it will be in `notebook_executions` with the correct column semantics.

### B3: Copy events `EntityName` field is aliased from wrong column
- **File**: `dashboard/app/api/routes/monitoring.py:77-80`
- **Issue**: `CopyActivityParameters AS EntityName` -- the `CopyActivityParameters` column contains JSON parameter data for the copy activity, not a human-readable entity name. The `copy_activity_audit` table has no `EntityName` column. The frontend displays this as the entity name in the copy activity row (LiveMonitor.tsx:593).
- **Fix needed**: Either:
  - Join to `lz_entities` on `EntityId` to get `SourceName` as the entity name, or
  - Parse entity name from `CopyActivityName` (which often encodes the entity), or
  - Add an `EntityName` alias from the `CopyActivityName` column if it's more descriptive than the parameters blob.

### B4: Five `counts` fields expected by frontend are not returned by backend
- **File**: `dashboard/app/api/routes/monitoring.py:99-106`
- **Issue**: The frontend reads `lzPipelineTotal`, `brzPipelineTotal`, `slvPipelineTotal`, `brzViewPending`, `slvViewPending` from the counts object. The backend only returns `*Registered` and `*Processed`. The missing fields silently default to 0 via the frontend's `num()` helper, so the "Queued" and "Pending" labels always show 0.
- **Fix needed**: Compute and return:
  - `lzPipelineTotal`: `SELECT COUNT(*) FROM pipeline_lz_entity` (entities queued in the LZ pipeline)
  - `brzPipelineTotal`: `SELECT COUNT(*) FROM pipeline_bronze_entity` (entities queued in the Bronze pipeline)
  - `slvPipelineTotal`: Could derive from entity_status rows with Layer='Silver' (or leave 0 if no pipeline queue table for silver)
  - `brzViewPending`: `SELECT COUNT(*) FROM pipeline_bronze_entity WHERE IsProcessed = 0`
  - `slvViewPending`: Could derive from entity_status entries with non-succeeded status for silver layer
  - Note: Since `pipeline_lz_entity` and `pipeline_bronze_entity` both have 0 rows currently, these would still be 0 -- but the wiring should be correct for when data arrives.

### B5: Bronze entities card reads from empty `pipeline_bronze_entity` instead of populated `entity_status`
- **File**: `dashboard/app/api/routes/monitoring.py:111-116`
- **Issue**: `pipeline_bronze_entity` has 0 rows and is only populated during active Fabric pipeline execution. The `entity_status` table has 4998 rows (1666 per layer) with actual processing status. The Bronze entities card will always be empty.
- **Fix needed**: Query from `entity_status` joined with `bronze_entities` for Bronze layer processing info:
  ```sql
  SELECT b.BronzeLayerEntityId, b.Schema_ AS SchemaName, b.Name AS TableName,
         es.updated_at AS InsertDateTime,
         CASE WHEN LOWER(es.Status) IN ('succeeded','loaded') THEN 1 ELSE 0 END AS IsProcessed,
         es.LoadEndDateTime
  FROM entity_status es
  JOIN bronze_entities b ON es.LandingzoneEntityId = b.LandingzoneEntityId
  WHERE LOWER(es.Layer) = 'bronze'
  ORDER BY es.updated_at DESC LIMIT 20
  ```

### B6: LZ entities card reads from empty `pipeline_lz_entity` instead of populated `entity_status`
- **File**: `dashboard/app/api/routes/monitoring.py:119-124`
- **Issue**: `pipeline_lz_entity` has 0 rows. Same root cause as B5.
- **Fix needed**: Query from `entity_status` joined with `lz_entities`:
  ```sql
  SELECT lz.LandingzoneEntityId, lz.FilePath, lz.FileName,
         es.updated_at AS InsertDateTime,
         CASE WHEN LOWER(es.Status) IN ('succeeded','loaded') THEN 1 ELSE 0 END AS IsProcessed,
         es.LoadEndDateTime
  FROM entity_status es
  JOIN lz_entities lz ON es.LandingzoneEntityId = lz.LandingzoneEntityId
  WHERE LOWER(es.Layer) IN ('landing','landingzone')
  ORDER BY es.updated_at DESC LIMIT 20
  ```

### B7: Error Intelligence endpoint references non-existent tables
- **File**: `dashboard/app/api/routes/monitoring.py:162-193`
- **Issue**: The `GET /api/error-intelligence` endpoint queries `PipelineExecution`, `NotebookExecution`, and `CopyActivityExecution` -- none of these tables exist in the SQLite schema. The correct table names are `pipeline_audit`, `notebook_executions`, and `copy_activity_audit`. All three queries will silently return `[]` via `_safe_query()`.
- **Note**: This endpoint is not consumed by LiveMonitor.tsx but is in the same route file and will break any page that uses it.

### B8: Dashboard Stats endpoint references non-existent tables
- **File**: `dashboard/app/api/routes/monitoring.py:206-213`
- **Issue**: `GET /api/stats` queries `LandingzoneEntity`, `BronzeLayerEntity`, `SilverLayerEntity` -- these table names don't exist. The correct names are `lz_entities`, `bronze_entities`, `silver_entities`. The query will throw an exception and return `{}`.
- **Note**: Not consumed by LiveMonitor.tsx but broken for any other consumer.

---

## Summary

**10 data points checked, 4 correct, 6 issues found across the LiveMonitor page.**

| # | Data Point | Status |
|---|-----------|--------|
| 1 | Pipeline Events | CORRECT (columns match, but time filter broken -- B1) |
| 2 | Notebook Events | WRONG -- wrong table, wrong column semantics (B2) |
| 3 | Copy Events | WRONG -- EntityName aliased from parameters blob (B3) |
| 4 | lzRegistered / brzRegistered / slvRegistered | CORRECT |
| 5 | lzProcessed / brzProcessed / slvProcessed | CORRECT |
| 6 | lzPipelineTotal / brzPipelineTotal / slvPipelineTotal | MISSING -- not returned by backend (B4) |
| 7 | brzViewPending / slvViewPending | MISSING -- not returned by backend (B4) |
| 8 | Bronze Entities list | WRONG -- reads from empty table (B5) |
| 9 | LZ Entities list | WRONG -- reads from empty table (B6) |
| 10 | Server Time | CORRECT |

**Additionally found 2 broken endpoints in the same file** that are not consumed by LiveMonitor but affect other pages:
- `GET /api/error-intelligence` -- references 3 non-existent tables (B7)
- `GET /api/stats` -- references 3 non-existent tables (B8)

**Severity ranking**:
1. **B1** (High) -- Time-window dropdown does nothing. Every query ignores the minutes parameter.
2. **B2** (High) -- Notebook events will never display correctly. Wrong table, wrong column semantics, counters always zero.
3. **B5/B6** (High) -- Bronze and LZ entity cards are permanently empty despite 4998 entity_status rows.
4. **B4** (Medium) -- Five count fields always show 0. "Queued" and "Pending" labels are dead UI.
5. **B3** (Medium) -- Copy activity entity names show JSON parameters instead of entity names.
6. **B7/B8** (Medium) -- Broken endpoints in same file (not LiveMonitor-specific but discovered during audit).
