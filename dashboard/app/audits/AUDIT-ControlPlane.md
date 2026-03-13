# AUDIT: ControlPlane.tsx — Data Source Correctness

**Date**: 2026-03-13
**Page**: `dashboard/app/src/pages/ControlPlane.tsx`
**Backend**: `dashboard/app/api/routes/control_plane.py`
**DB Layer**: `dashboard/app/api/control_plane_db.py`

---

## API Calls Made by Frontend

| # | API Call | Trigger | Used For |
|---|----------|---------|----------|
| 1 | `GET /api/control-plane` | Initial load + 30s auto-refresh | Health bar, KPI pills, source systems, lakehouses, workspaces, pipeline runs |
| 2 | `GET /api/load-config` | Initial load + 30s auto-refresh | Entity Metadata tab (table grid) |
| 3 | `POST /api/entity-digest/resync` | Maintenance button click | Resync entity digest |
| 4 | `POST /api/maintenance-agent/trigger` | Maintenance button click | Trigger Fabric notebook |

---

## Route 1: `GET /api/control-plane` -> `_build_control_plane()`

### SQL Queries Executed (via control_plane_db.py)

| # | Function | Table(s) | Columns Selected | Correct? |
|---|----------|----------|------------------|----------|
| 1 | `cpdb.get_connections()` | `connections` | ConnectionId, Name, Type, IsActive | CORRECT |
| 2 | `cpdb.get_datasources()` | `datasources` JOIN `connections` | DataSourceId, Name, Namespace, Type, Description, IsActive, ConnectionName | CORRECT |
| 3 | `cpdb.get_lz_entities()` | `lz_entities` JOIN `datasources` | LandingzoneEntityId, SourceSchema, SourceName, IsActive, IsIncremental, DataSourceName, Namespace | CORRECT |
| 4 | `cpdb.get_bronze_entities()` | `bronze_entities` JOIN `lz_entities` JOIN `datasources` | BronzeLayerEntityId, Schema, Name, IsActive, Namespace | CORRECT |
| 5 | `cpdb.get_silver_entities()` | `silver_entities` JOIN `bronze_entities` JOIN `lz_entities` JOIN `datasources` | SilverLayerEntityId, Schema, Name, IsActive, Namespace | CORRECT |
| 6 | `cpdb.get_lakehouses()` | `lakehouses` | LakehouseId, Name | CORRECT |
| 7 | `cpdb.get_workspaces()` | `workspaces` | WorkspaceId, Name | CORRECT |
| 8 | `cpdb.get_pipelines()` | `pipelines` | PipelineId, Name, IsActive | CORRECT |
| 9 | `cpdb.get_pipeline_runs_grouped()` | `pipeline_audit` | PipelineRunGuid, PipelineName, EntityLayer, TriggerType, StartTime, EndTime, EndLogData, ErrorData | CORRECT |

### KPI Metrics Traced

| Metric | Source | Calculation | Correct? |
|--------|--------|-------------|----------|
| Connections (active) | `connections.IsActive` | `sum(1 for c if IsActive in ("true","1"))` | CORRECT |
| Sources (active) | `datasources.IsActive` | Same pattern | CORRECT |
| Entities LZ/BR/SV (active) | `lz_entities.IsActive`, `bronze_entities.IsActive`, `silver_entities.IsActive` | Same pattern, counted separately per layer | CORRECT |
| Pipelines (active) | `pipelines.IsActive` | Same pattern | CORRECT |
| Lakehouses count | `lakehouses` | `len(set(Name))` — deduped by name | CORRECT |
| Workspaces count | `workspaces` | `len(workspaces)` | CORRECT |
| Pipeline health (OK/FAIL/RUN) | `pipeline_audit` grouped by RunGuid | Derived from LogType timestamps | CORRECT |

### Source Systems Aggregation

Entity counts per namespace are built by iterating `lz_entities`, `bronze_entities`, and `silver_entities` and grouping by `Namespace` (resolved via datasource JOIN). Both `entities` (total) and `activeEntities` (filtered by IsActive) are tracked.

**CORRECT**: Uses the right tables (lz_entities, bronze_entities, silver_entities) and the right column (IsActive) for the right purpose (registration status).

### Does NOT reference empty tables

| Empty Table | Referenced? |
|-------------|------------|
| `pipeline_lz_entity` (0 rows) | NO |
| `pipeline_bronze_entity` (0 rows) | NO |
| `entity_status` (4998 rows) | NO — not used in this endpoint |

**NOTE**: `entity_status` is intentionally not used by this endpoint. The Control Plane shows *registration* counts (IsActive), not *processing* status. This is correct behavior — the execution matrix endpoint uses entity_status separately.

---

## Route 2: `GET /api/load-config` (Entity Metadata tab)

### SQL Query

```sql
SELECT le.LandingzoneEntityId AS entityId,
       ds.Namespace AS dataSource, ds.DataSourceId AS dataSourceId,
       le.SourceSchema AS [schema], le.SourceName AS [table], le.FileName,
       le.IsIncremental, le.IsIncrementalColumn AS watermarkColumn,
       be.BronzeLayerEntityId AS bronzeEntityId, be.PrimaryKeys AS primaryKeys,
       se.SilverLayerEntityId AS silverEntityId
FROM lz_entities le
LEFT JOIN datasources ds ON le.DataSourceId = ds.DataSourceId
LEFT JOIN bronze_entities be ON le.LandingzoneEntityId = be.LandingzoneEntityId
LEFT JOIN silver_entities se ON be.BronzeLayerEntityId = se.BronzeLayerEntityId
ORDER BY ds.Name, le.SourceSchema, le.SourceName
```

| Column | Source Table.Column | Correct? |
|--------|---------------------|----------|
| entityId | `lz_entities.LandingzoneEntityId` | CORRECT |
| dataSource | `datasources.Namespace` | CORRECT |
| schema | `lz_entities.SourceSchema` | CORRECT |
| table | `lz_entities.SourceName` | CORRECT |
| FileName | `lz_entities.FileName` | CORRECT |
| IsIncremental | `lz_entities.IsIncremental` | CORRECT |
| watermarkColumn | `lz_entities.IsIncrementalColumn` | CORRECT |
| bronzeEntityId | `bronze_entities.BronzeLayerEntityId` | CORRECT |
| primaryKeys | `bronze_entities.PrimaryKeys` | CORRECT |
| silverEntityId | `silver_entities.SilverLayerEntityId` | CORRECT |

**CORRECT**: All columns come from the right tables. The JOIN chain (lz -> bronze via LandingzoneEntityId, bronze -> silver via BronzeLayerEntityId) is correct.

### Frontend Display of Entity Metadata

| Column Header | Data Field | Display Logic | Correct? |
|---------------|-----------|---------------|----------|
| Source | `e.dataSource` | Raw namespace | CORRECT |
| Schema | `e.schema` | Raw value | CORRECT |
| Table | `e.table` | Raw value | CORRECT |
| File Name | `e.FileName` | Raw value | CORRECT |
| Load Type | `e.IsIncremental` | `=== 1 or === true` -> "INCR", else "FULL" | CORRECT |
| Watermark | `e.watermarkColumn` | Raw value or dash | CORRECT |
| Primary Keys | `e.primaryKeys` | Raw value or dash | CORRECT |
| Bronze | `e.bronzeEntityId` | Truthy -> checkmark | CORRECT |
| Silver | `e.silverEntityId` | Truthy -> checkmark | CORRECT |
| Last Load | `e.lastLoadTime` | Formatted timestamp or "never" | **WARNING** |

### Warning: `lastLoadTime` always null

The `/api/load-config` response does NOT include `lastLoadTime` or `lastWatermarkValue`. The SQL query does not join `entity_status` or `watermarks`. The frontend references `e.lastLoadTime` which will always be undefined, rendering "never" for all entities.

**Impact**: The "Last Load" column in the Entity Metadata tab always shows "never" even for entities that have been loaded. The data exists in `entity_status.LoadEndDateTime` but is not joined into this query.

---

## IsActive vs Processing Status Confusion Check

| Location | Uses IsActive? | Purpose | Correct Usage? |
|----------|---------------|---------|----------------|
| KPI pills (connections, sources, entities, pipelines) | Yes | Registration count | CORRECT — IsActive means "registered and enabled" |
| Source systems entity counts | Yes (activeEntities) | Active registration per namespace | CORRECT |
| Source system "Active"/"Partial" badge | Yes (connections + datasources IsActive) | All connections active? | CORRECT |
| Entity Metadata tab Bronze/Silver columns | Uses bronzeEntityId/silverEntityId presence | Registration exists? | CORRECT — not confused with load status |

**No confusion found.** IsActive is consistently used for registration status, never conflated with entity_status processing status.

---

## Summary

| Category | Finding | Severity |
|----------|---------|----------|
| CORRECT | All 9 SQL queries target correct tables with correct columns | - |
| CORRECT | Entity counts per source use lz/bronze/silver entity tables (not empty pipeline_*_entity) | - |
| CORRECT | IsActive consistently used for registration, not confused with processing status | - |
| CORRECT | Pipeline health derived from pipeline_audit table correctly | - |
| WARNING | Entity Metadata tab "Last Load" column always shows "never" — load-config query lacks entity_status JOIN | Medium |
| CORRECT | No references to empty pipeline_lz_entity or pipeline_bronze_entity tables | - |
