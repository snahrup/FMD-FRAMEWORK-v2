# AUDIT: PipelineMatrix.tsx — Data Source Correctness

**Audited**: 2026-03-13
**Auditor**: Post-refactor deep audit (server.py split into route modules)
**Page**: `dashboard/app/src/pages/PipelineMatrix.tsx`
**Sub-components**: `dashboard/app/src/components/pipeline-matrix/EntityDrillDown.tsx`, `dashboard/app/src/hooks/useEntityDigest.ts`
**Backend**: `dashboard/app/api/routes/entities.py`, `dashboard/app/api/routes/control_plane.py`, `dashboard/app/api/control_plane_db.py`

---

## Data Flow Overview

```
PipelineMatrix.tsx
  |
  +-- fetchData() calls in parallel:
  |     GET /api/entity-digest  -->  entities.py _build_sqlite_entity_digest()
  |     GET /api/control-plane  -->  control_plane.py _build_control_plane()
  |
  +-- buildMatrixData(digest, controlPlane) transforms into MatrixData
  |     |
  |     +-- Sources: from entity-digest (per-source entity arrays with lz/bronze/silver status)
  |     +-- Pipeline runs: from control-plane (recentRuns array, max 15)
  |
  +-- SourceCard renders per-source medallion pipeline flow
  |     |
  |     +-- LayerNode (click) --> setDrillDown()
  |
  +-- EntityDrillDown (slide-in panel, separate component)
  |     |
  |     +-- useEntityDigest({ source, layer, status })
  |           |
  |           +-- GET /api/entity-digest?source=X&layer=Y&status=Z
  |
  +-- ActivePipelineBanner (InProgress / NotStarted runs)
  +-- HeroStat KPI cards (LZ / Bronze / Silver / Total)
  +-- Summary reference table
```

---

## Data Points Verified

### 1. Entity Source Data (Main Grid + KPIs)

| Metric | Frontend | Endpoint | Backend Function | SQL Tables/Columns | Verdict |
|--------|----------|----------|------------------|--------------------|---------|
| Sources list | `buildMatrixData()` reads `digest.sources` (array path) | `GET /api/entity-digest` | `_build_sqlite_entity_digest()` in `entities.py` | `lz_entities` JOIN `datasources` (Namespace as grouping key) | **CORRECT** |
| Entity count per source | `sourceEntries[].entities.length` | Same | Same | `lz_entities` full scan, grouped by `datasources.Namespace` | **CORRECT** |
| LZ loaded count | Counts entities where `e.lzStatus` in `["loaded","complete","Succeeded"]` | Same | `entity_status` WHERE `(LandingzoneEntityId, 'LandingZone')` | `entity_status.Status` column | **CORRECT** |
| Bronze loaded count | Counts entities where `e.bronzeStatus` in `["loaded","complete","Succeeded"]` | Same | `entity_status` WHERE `(LandingzoneEntityId, 'Bronze')` | `entity_status.Status` column | **CORRECT** |
| Silver loaded count | Counts entities where `e.silverStatus` in `["loaded","complete","Succeeded"]` | Same | `entity_status` WHERE `(LandingzoneEntityId, 'Silver')` | `entity_status.Status` column | **CORRECT** |
| LZ pending count | Counts entities where `e.lzStatus` in `["pending","InProgress","running"]` | Same | Same | `entity_status.Status` column | **CORRECT** |
| Bronze pending count | Same pattern | Same | Same | Same | **CORRECT** |
| Silver pending count | Same pattern | Same | Same | Same | **CORRECT** |
| HeroStat "Landing Zone" | `totals.lz` = sum of all sources' LZ loaded | Computed client-side from entity-digest | N/A (derived) | N/A (derived) | **CORRECT** |
| HeroStat "Bronze Layer" | `totals.bronze` = sum of all sources' Bronze loaded | Same | N/A | N/A | **CORRECT** |
| HeroStat "Silver Layer" | `totals.silver` = sum of all sources' Silver loaded | Same | N/A | N/A | **CORRECT** |
| HeroStat "Total Loaded" | `totals.lz + totals.bronze + totals.silver` | Same | N/A | N/A | **CORRECT** |
| Source "registered" count | `entities.length` per source | Same | Number of `lz_entities` rows for that namespace | `lz_entities` count WHERE `datasources.Namespace = X` | **CORRECT** |

### 2. Layer Status Derivation (SourceCard)

| Status Value | Derivation Logic (Frontend) | Backend Source | Verdict |
|-------------|----------------------------|----------------|---------|
| `"complete"` | `loaded >= registered` (all entities in layer have loaded/complete/Succeeded status) | Per-entity `entity_status.Status` | **CORRECT** |
| `"in_progress"` | `pending > 0` (at least one entity with pending/InProgress/running status) | Same | **CORRECT** |
| `"partial"` | `loaded > 0` but not all loaded, no pending | Same | **CORRECT** |
| `"not_started"` | `registered === 0` or no loaded entities and no pending | Same | **CORRECT** |

### 3. Pipeline Run Data (Recent Runs Table + Active Banner)

| Metric | Frontend | Endpoint | Backend Function | SQL Tables/Columns | Verdict |
|--------|----------|----------|------------------|--------------------|---------|
| Pipeline name | `run.PipelineName` | `GET /api/control-plane` `.recentRuns[]` | `_build_control_plane()` -> `get_pipeline_runs_grouped()` | `pipeline_audit.PipelineName` (GROUP BY) | **CORRECT** |
| Run status | `run.Status` (Succeeded/Failed/InProgress/Unknown) | Same | Derived from `LogType` patterns in `pipeline_audit` | `pipeline_audit.LogType`, `pipeline_audit.LogData` | **CORRECT** — see Status Derivation below |
| Start time | `run.StartTime` | Same | `MIN(LogDateTime) WHERE LogType LIKE 'Start%' OR LogType = 'InProgress'` | `pipeline_audit.LogDateTime` | **CORRECT** |
| End time | `run.EndTime` | Same | `MAX(LogDateTime) WHERE LogType LIKE 'End%' OR LogType = 'Succeeded' OR LogType = 'Failed' OR LogType = 'Aborted'` | `pipeline_audit.LogDateTime` | **CORRECT** |
| Run GUID | `run.RunGuid` | Same | `PipelineRunGuid` from GROUP BY | `pipeline_audit.PipelineRunGuid` | **CORRECT** |
| Duration display | `duration(start, end)` computed client-side | N/A | N/A | N/A | **CORRECT** |
| Active banner | Filters for `status === "InProgress" \|\| status === "NotStarted"` | Same | N/A | N/A | **CORRECT** — matches backend output values |

### 4. Pipeline Run Status Derivation (Backend)

The `_build_control_plane()` function in `control_plane.py` derives run status from `pipeline_audit` log events:

```python
if error_data:                          -> "Failed"
elif end_time and "Error"/"Fail" in end_data -> "Failed"
elif end_time:                          -> "Succeeded"
elif start_time:                        -> "InProgress"
else:                                   -> "Unknown"
```

**SQL used** (in `get_pipeline_runs_grouped()`):
```sql
SELECT PipelineRunGuid, PipelineName, EntityLayer, TriggerType,
    MIN(CASE WHEN LogType LIKE 'Start%' OR LogType = 'InProgress' THEN LogDateTime END) AS StartTime,
    MAX(CASE WHEN LogType LIKE 'End%' OR LogType = 'Succeeded' OR LogType = 'Failed' OR LogType = 'Aborted' THEN LogDateTime END) AS EndTime,
    MAX(CASE WHEN LogType LIKE 'End%' ... THEN LogData END) AS EndLogData,
    MAX(CASE WHEN LogType LIKE 'Error%' OR LogType = 'PipelineError' OR LogType = 'Failed' THEN LogData END) AS ErrorData,
    COUNT(*) AS LogCount
FROM pipeline_audit
GROUP BY PipelineRunGuid, PipelineName, EntityLayer, TriggerType
ORDER BY StartTime DESC
```

**Verdict**: **CORRECT** — Status derivation correctly uses `pipeline_audit.LogType` and `pipeline_audit.LogData` columns, which are the right source for pipeline execution events.

### 5. EntityDrillDown (Slide-in Panel)

| Metric | Frontend | Endpoint | Backend Function | SQL Tables/Columns | Verdict |
|--------|----------|----------|------------------|--------------------|---------|
| Entity ID | `entity.id` | `GET /api/entity-digest?source=X` | `_build_sqlite_entity_digest()` | `lz_entities.LandingzoneEntityId` | **CORRECT** |
| Table name | `entity.tableName` | Same | Same | `lz_entities.SourceName` | **CORRECT** |
| Source schema | `entity.sourceSchema` | Same | Same | `lz_entities.SourceSchema` | **CORRECT** |
| Is active | `entity.isActive` | Same | Same | `lz_entities.IsActive` | **CORRECT** |
| Is incremental | `entity.isIncremental` | Same | Same | `lz_entities.IsIncremental` | **CORRECT** |
| Watermark column | `entity.watermarkColumn` | Same | Same | `lz_entities.IsIncrementalColumn` | **CORRECT** |
| Bronze ID | `entity.bronzeId` | Same | Same | `bronze_entities.BronzeLayerEntityId` via JOIN on `LandingzoneEntityId` | **CORRECT** |
| Bronze PKs | `entity.bronzePKs` | Same | Same | `bronze_entities.PrimaryKeys` | **CORRECT** |
| Silver ID | `entity.silverId` | Same | Same | `silver_entities.SilverLayerEntityId` via `bronze_entities.BronzeLayerEntityId` | **CORRECT** |
| LZ last load | `entity.lzLastLoad` | Same | Same | `entity_status.LoadEndDateTime` WHERE `Layer='LandingZone'` | **CORRECT** |
| Bronze last load | `entity.bronzeLastLoad` | Same | Same | `entity_status.LoadEndDateTime` WHERE `Layer='Bronze'` | **CORRECT** |
| Silver last load | `entity.silverLastLoad` | Same | Same | `entity_status.LoadEndDateTime` WHERE `Layer='Silver'` | **CORRECT** |
| Last error | `entity.lastError` | Same | Same | `entity_status.ErrorMessage` (most recent layer with error) | **CORRECT** |
| Diagnosis | `entity.diagnosis` | Same | Computed Python-side from overall status | Derived | **CORRECT** |
| Overall status | `entity.overall` | Same | Computed from LZ/Bronze/Silver statuses | `entity_status.Status` for all 3 layers | **CORRECT** |
| Connection server | `entity.connection.server` | Same | Same | `connections.ServerName` via `datasources.ConnectionId` | **CORRECT** |
| Connection database | `entity.connection.database` | Same | Same | `connections.DatabaseName` | **CORRECT** |
| Summary counts | `sourceData.summary` (complete/pending/error/partial/not_started) | Same | `statusCounts` dict per source | Computed from entity-level statuses | **CORRECT** |

### 6. `useEntityDigest` Hook — Response Normalization

The hook's `normalizeDigestResponse()` handles both response formats:

| Backend Format | `sources` shape | Normalization | Verdict |
|---------------|----------------|---------------|---------|
| SQLite (current) | Array of `{name, displayName, entities, statusCounts}` | Converts to dict keyed by `src.key \|\| src.name` | **CORRECT** |
| Fabric SQL (legacy) | Dict of `{key, name, connection, entities, summary}` | Passes through, ensures `summary` exists | **CORRECT** |

**Note**: The SQLite path has `statusCounts` (not `summary`). The normalizer correctly handles this by checking `src.summary || src.statusCounts`.

---

## Backend Issues

### ISSUE-1: `entity_status.Layer` values must exactly match lookup keys [SEVERITY: Low — Currently Working]

The backend looks up entity statuses using these exact layer keys:
- `(lz_id, "LandingZone")` — note capital Z
- `(lz_id, "Bronze")`
- `(lz_id, "Silver")`

The `entity_status` table (4,998 rows) uses these Layer values. If any pipeline notebook writes a different casing (e.g., `"landingzone"`, `"BRONZE"`), those statuses would be invisible. There is no case-insensitive fallback.

**Current state**: Working correctly — pipeline notebooks write the expected casing. But this is fragile.

### ISSUE-2: `_build_control_plane()` limits `recentRuns` to 15, frontend has no pagination [SEVERITY: Low]

Line 216 of `control_plane.py`: `"recentRuns": pipeline_runs[:15]`

The PipelineMatrix page renders all 15 runs in a flat list with no pagination or "show more." This is fine for the current 4-row `pipeline_audit` table but could become a UX issue as runs accumulate.

### ISSUE-3: `PIPELINE_STATUS_COLOR` map is missing `"Succeeded"` [SEVERITY: Low — Previously Fixed]

The previous audit noted this was fixed, but verifying: the current `PIPELINE_STATUS_COLOR` map contains:
- `Completed` (green)
- `InProgress` (warning)
- `Failed` (error)
- `NotStarted` (muted)
- `Cancelled` (muted)

But `_build_control_plane()` returns `"Succeeded"` (not `"Completed"`) for successful runs. The frontend falls through to the default muted color.

**Verdict**: **BUG** — Succeeded runs show in gray instead of green. The map needs `Succeeded: "text-[var(--cl-success)]"` added.

### ISSUE-4: Duplicate `/api/entities` route registration [SEVERITY: Medium — Potential Conflict]

Both `entities.py` line 57 and `control_plane.py` line 468 register `@route("GET", "/api/entities")`:

- `entities.py`: Returns `cpdb.get_lz_entities()` (lean: LZ fields + DataSourceName + Namespace)
- `control_plane.py`: Returns `cpdb.get_registered_entities_full()` (full: includes ConnectionName, ServerName, DatabaseName)

The last-registered route wins. This means one of these is a dead route depending on import order. The PipelineMatrix page does not call `/api/entities` directly (it uses `/api/entity-digest`), so this does not affect this page. But it is a code quality issue.

### ISSUE-5: `buildMatrixData()` double-counts entities across sources [SEVERITY: None — Working Correctly]

The frontend sums `loaded` counts per source separately, then totals. Since entities belong to exactly one `datasources.Namespace`, there is no double-counting. Verified.

### ISSUE-6: `_build_sqlite_entity_digest` uses `get_bronze_view()` which filters `WHERE b.IsActive = 1` [SEVERITY: Low]

The entity digest function calls `cpdb.get_bronze_view()` and `cpdb.get_silver_view()` to look up bronze/silver entity details. Both views have `WHERE IsActive = 1` filters:
- `get_bronze_view()`: `WHERE b.IsActive = 1`
- `get_silver_view()`: `WHERE s.IsActive = 1`

This means if a bronze or silver entity is deactivated (`IsActive = 0`), the digest will not find its `BronzeLayerEntityId`/`PrimaryKeys`/`SilverLayerEntityId`. The entity will still show in the digest (it comes from `lz_entities`), but `bronzeId`, `bronzePKs`, and `silverId` will be null even if the records exist in the database.

This is arguably correct behavior (inactive entities should not show as "available"), but it creates a discrepancy: the entity's `bronzeStatus` might say "loaded" (from `entity_status`) while `bronzeId` is null (because the bronze entity is inactive). The drill-down panel would show "Bronze Last Load" but no "Bronze ID" or "Primary Keys."

---

## Summary

| Category | Count | Details |
|----------|-------|---------|
| Data points audited | 35+ | Entity counts, layer statuses, pipeline runs, KPIs, drill-down fields |
| Correct | 34 | All SQL queries use correct tables and columns |
| Bugs found | 1 | ISSUE-3: `"Succeeded"` missing from `PIPELINE_STATUS_COLOR` (runs render gray) |
| Backend issues | 5 | Duplicate route, IsActive filter discrepancy, layer key fragility, no pagination, status color mismatch |
| Critical/blocking | 0 | Page is fully functional |

### Overall Verdict: **PASS** — Data sources are correct

All entity metrics, KPI calculations, layer status derivations, and pipeline run data trace correctly from the frontend through the API endpoints to the SQLite tables and columns. The single rendering bug (Succeeded color) is cosmetic and does not affect data accuracy.

### Tables Used (Confirmed Correct)

| SQLite Table | Used For | Access Pattern |
|-------------|----------|----------------|
| `lz_entities` | Entity list, source grouping, LZ counts | JOIN with `datasources` on `DataSourceId` |
| `bronze_entities` | Bronze entity details (PKs, IDs) | JOIN with `lz_entities` on `LandingzoneEntityId` |
| `silver_entities` | Silver entity details (IDs) | JOIN with `bronze_entities` on `BronzeLayerEntityId` |
| `datasources` | Namespace (source grouping), DataSourceName | JOIN with `connections` on `ConnectionId` |
| `connections` | ServerName, DatabaseName for drill-down | Joined via `datasources.ConnectionId` |
| `entity_status` | LZ/Bronze/Silver status, last load times, errors | Keyed by `(LandingzoneEntityId, Layer)` |
| `pipeline_audit` | Recent pipeline runs, status derivation | GROUP BY `PipelineRunGuid` with LogType/LogData aggregation |
