# AUDIT: ColumnEvolution

**Audited:** 2026-03-13
**File:** `dashboard/app/src/pages/ColumnEvolution.tsx` (~1014 lines)
**Backend route:** `dashboard/app/api/routes/monitoring.py` — `get_entity_journey()`
**Hooks:** `useEntityDigest` from `@/hooks/useEntityDigest.ts`
**Schema ref:** `dashboard/app/audits/SCHEMA_REFERENCE.txt`

---

## Overview

ColumnEvolution lets users select an entity and visualize its column schema transforming through medallion layers (Source, Landing Zone, Bronze, Silver, Gold). It uses an animated layer-stepper with auto-play, showing column cards with diff annotations (NEW, REMOVED, TYPE_CHANGED, SYSTEM) at each layer. Schema diff data powers the comparison between Bronze and Silver.

### Data Flow

```
EntitySelector (inline component)
  └─ useEntityDigest() → GET /api/entity-digest → SQLite

loadJourney(id)
  └─ GET /api/journey?entity={id}
       → monitoring.py:get_entity_journey()
         → SQLite: lz_entities + datasources (LZ metadata)
         → SQLite: bronze_entities (Bronze metadata)
         → SQLite: silver_entities (Silver metadata)
         → SQLite: watermarks (load history)
         → returns {entityId, lz, bronze, silver, lastLoadValues}
```

---

## API Endpoint Trace

### 1. GET /api/entity-digest (entity list for EntitySelector)

| Frontend | Backend | SQL Tables | Correct? |
|----------|---------|------------|----------|
| `useEntityDigest()` in EntitySelector | `entities.py:get_entity_digest()` | `lz_entities`, `datasources`, `connections`, `lakehouses`, `bronze_entities`, `silver_entities`, `entity_status` | YES |

- Fields consumed: `id`, `tableName`, `sourceSchema`, `source`
- All correctly sourced from SQLite. No issues.

### 2. GET /api/journey?entity={id} (column schema + lineage)

| Frontend | Backend | SQL Tables | Correct? |
|----------|---------|-------------|----------|
| `loadJourney()` line 758 | `monitoring.py:get_entity_journey()` | `lz_entities`, `datasources`, `bronze_entities`, `silver_entities`, `watermarks` | SHAPE MISMATCH |

**Frontend expects** (from `JourneyData` interface, line 126-172):
```typescript
{
  entityId: number;
  source: {
    schema: string;
    name: string;
    dataSourceName: string;
    dataSourceType?: string;
    namespace?: string;
    connectionName: string;
    connectionType?: string;
  };
  landing: {
    entityId: number;
    fileName: string;
    filePath: string;
    fileType: string;
    lakehouse: string;
    isIncremental: boolean;
    incrementalColumn: string | null;
  };
  bronze: {
    entityId: number;
    schema: string;
    name: string;
    primaryKeys: string | null;
    fileType: string;
    lakehouse: string;
    rowCount: number | null;
    columns: ColumnInfo[];        // <-- CRITICAL: array of INFORMATION_SCHEMA columns
    columnCount: number;
  } | null;
  silver: {
    entityId: number;
    schema: string;
    name: string;
    fileType: string;
    lakehouse: string;
    rowCount: number | null;
    columns: ColumnInfo[];        // <-- CRITICAL: array of INFORMATION_SCHEMA columns
    columnCount: number;
  } | null;
  gold: null;
  schemaDiff: SchemaDiffEntry[];  // <-- CRITICAL: Bronze vs Silver column comparison
}
```

**Backend actually returns** (from `monitoring.py:get_entity_journey()`, line 269-275):
```python
{
    "entityId": entity_id,
    "lz": {raw lz_entities row + DataSourceName},
    "bronze": {raw bronze_entities row} or None,
    "silver": {raw silver_entities row} or None,
    "lastLoadValues": [{LoadValue, LastLoadDatetime}]
}
```

---

## Issues Found

### F1. CRITICAL — Response shape completely different from what frontend expects

**Problem:** The refactored `/api/journey` endpoint returns raw SQLite row dicts (`lz`, `bronze`, `silver`) with the original table column names (e.g., `LandingzoneEntityId`, `SourceSchema`, `Schema_`, `BronzeLayerEntityId`). The frontend expects a structured response with nested objects (`source`, `landing`, `bronze`, `silver`, `schemaDiff`) using different field names.

The old `server.py.bak` (line 3422-3575) built a carefully structured response:
- Nested `source` object with `schema`, `name`, `dataSourceName`, `namespace`, `connectionName`
- Nested `landing` object with `entityId`, `fileName`, `filePath`, `fileType`, `lakehouse`, `isIncremental`
- Nested `bronze` object with `entityId`, `schema`, `name`, `primaryKeys`, `fileType`, `lakehouse`, `rowCount`, `columns` (ColumnInfo[]), `columnCount`
- Nested `silver` object with same shape
- `schemaDiff` array comparing Bronze and Silver column schemas

The refactored endpoint returns none of this structure. Every field access in ColumnEvolution.tsx will return `undefined`.

**Impact:** The page will:
1. Show the entity name as `undefined.undefined` (line 865: `journey.source.namespace` and `journey.source.name`)
2. `getMaxLayerIndex()` will return 1 (since `journey.silver` and `journey.bronze` won't match the expected shape)
3. `buildDisplayColumns()` will return empty arrays (since `journey.bronze?.columns` is undefined)
4. The column grid will be empty at every layer
5. No schema diff will be shown

### F2. CRITICAL — No column schema data in refactored response

**Problem:** The most important data for ColumnEvolution is `bronze.columns` and `silver.columns` — arrays of `ColumnInfo` objects with `COLUMN_NAME`, `DATA_TYPE`, `IS_NULLABLE`, `CHARACTER_MAXIMUM_LENGTH`, `NUMERIC_PRECISION`, `NUMERIC_SCALE`, `ORDINAL_POSITION`. These are queried from the Fabric lakehouse `INFORMATION_SCHEMA.COLUMNS` by the old `server.py.bak` (line 3473-3516 via `get_lakehouse_columns()` and `ThreadPoolExecutor`).

The refactored endpoint only queries SQLite tables, which do not store per-column metadata. SQLite `bronze_entities` has `PrimaryKeys` and `Name` but no column schema information. Without live Fabric lakehouse queries, column data cannot be retrieved.

**Fix needed:** The refactored `/api/journey` endpoint must:
1. Restructure the response to match the `JourneyData` interface
2. Query Fabric lakehouse SQL endpoints for `INFORMATION_SCHEMA.COLUMNS` on Bronze and Silver tables
3. Compute `schemaDiff` by comparing Bronze and Silver column lists
4. Include row counts via `COUNT(*)` on the lakehouse tables

Alternatively, a separate endpoint could be created for column schema (e.g., reuse `get_blender_profile` from `data_access.py`) and the frontend refactored to call it.

### F3. CRITICAL — schemaDiff not returned

**Problem:** The `schemaDiff` field is consumed by `buildDisplayColumns()` for the Silver layer (line 245-301). It drives the diff badges (NEW, REMOVED, TYPE_CHANGED) that are the core visual feature of ColumnEvolution. Without `schemaDiff`, the Silver layer view will show all columns as "none" diff status (no badges, no diff highlighting).

The old `server.py.bak` (line 3390-3419) computed `schemaDiff` via `_build_schema_diff()` which compared `bronze_columns` and `silver_columns` by `COLUMN_NAME` and `DATA_TYPE`.

### F4. LOW — Missing lakehouse name in response

**Problem:** The frontend reads `journey.source.connectionName` (line 865), `bronze.lakehouse` (for display), `silver.lakehouse`. The refactored endpoint does not JOIN against the `lakehouses` table for Bronze/Silver entities, so lakehouse names are not included. The old endpoint did `JOIN integration.Lakehouse lh ON be.LakehouseId = lh.LakehouseId` to include `LakehouseName`.

### F5. LOW — `source.namespace` vs DataSourceName

**Problem:** The frontend reads `journey.source.namespace || journey.source.dataSourceName` for the header display (line 865). The refactored response puts everything under `lz` with raw column names. Even if the shape were fixed, the refactored query only JOINs `datasources` for `Name AS DataSourceName` and does not include `Namespace`, `Type`, or connection info from the `connections` table.

---

## Frontend Logic Review (assuming correct data)

The frontend column diff logic is sound IF the backend returns the expected shape:

| Function | Logic | Correct? |
|----------|-------|----------|
| `buildDisplayColumns(data, 0/1)` | Source/LZ: Bronze columns minus system columns | YES |
| `buildDisplayColumns(data, 2)` | Bronze: all columns, mark BRONZE_SYSTEM_COLUMNS as "system" | YES |
| `buildDisplayColumns(data, 3)` | Silver: annotate from schemaDiff, then append bronze_only as "removed" | YES |
| `computeDiffSummary()` | Count added/removed/typeChanged between previous and current layer | YES |
| `getMaxLayerIndex()` | Returns 3 if silver, 2 if bronze, 1 otherwise | YES |
| System column sets | `BRONZE_SYSTEM_COLUMNS`, `SILVER_SYSTEM_COLUMNS` match actual FMD notebook output | YES |

---

## Mock / Hardcoded Data Check

| Item | Status |
|------|--------|
| Entity list | LIVE — from `/api/entity-digest` via SQLite |
| Journey data | LIVE — from `/api/journey` via SQLite, BUT response shape is wrong and columns are missing |
| Column schemas | MISSING — would need live Fabric lakehouse queries (not in refactored endpoint) |
| Layer definitions | HARDCODED `LAYERS` array — cosmetic, correct |
| System column names | HARDCODED `SYSTEM_COLUMNS`, `BRONZE_SYSTEM_COLUMNS`, `SILVER_SYSTEM_COLUMNS` — match actual column names |
| Gold layer | HARDCODED as placeholder ("coming soon") — correct, Gold not implemented |
| Auto-play timing | HARDCODED 2000ms interval — cosmetic |

---

## Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 3 | (1) Response shape completely mismatched — refactored `/api/journey` returns flat SQLite rows, frontend expects structured nested objects with specific field names. (2) No column schema data — refactored endpoint does not query Fabric lakehouse INFORMATION_SCHEMA; `bronze.columns` and `silver.columns` are missing. (3) No `schemaDiff` — diff array not computed, Silver layer diff badges non-functional. |
| LOW | 2 | Missing lakehouse names and datasource namespace/connection info in response |

**Bottom line:** The entity selector works (via entity-digest), but once an entity is selected, the entire column evolution visualization is broken. The refactored `/api/journey` endpoint was simplified to return raw SQLite data without the structured response shape, column schemas, or schema diff that the old `server.py.bak` provided. The page will display "No column schema available yet" for all entities, even those that have been loaded.
