# AUDIT: DataJourney.tsx

**Page**: `dashboard/app/src/pages/DataJourney.tsx`
**Date**: 2026-03-13
**Auditor**: Claude (Opus)
**Verdict**: CRITICAL — Backend response shape does not match frontend TypeScript interface. Page will crash or show blank for every entity.

---

## 1. API Calls Traced

### 1A. Entity List (for selector dropdown)

| Step | Detail |
|------|--------|
| **Frontend** | `useEntityDigest()` hook -> `GET /api/entity-digest` |
| **Backend route** | `entities.py:get_entity_digest()` -> `_build_sqlite_entity_digest()` |
| **SQL queries** | `cpdb.get_registered_entities_full()` -> `lz_entities JOIN datasources JOIN connections` |
| | `cpdb.get_entity_status_all()` -> `SELECT * FROM entity_status` |
| | `cpdb.get_bronze_view()` -> `bronze_entities JOIN lz_entities JOIN datasources LEFT JOIN pipeline_bronze_entity` |
| | `cpdb.get_silver_view()` -> `silver_entities JOIN bronze_entities JOIN lz_entities JOIN datasources` |
| **Tables used** | `lz_entities` (1666 rows), `datasources` (8 rows), `connections` (10 rows), `entity_status` (4998 rows), `bronze_entities` (1666 rows), `silver_entities` (1666 rows) |
| **Status** | CORRECT — All tables exist and have data. Entity list works. |

### 1B. Entity Journey Detail (the main data)

| Step | Detail |
|------|--------|
| **Frontend** | `fetchJson<JourneyData>('/journey?entity=${id}')` (line 367) |
| **Backend route** | `monitoring.py:get_entity_journey()` (line 224) |
| **SQL queries** | (1) `SELECT le.*, ds.Name AS DataSourceName FROM lz_entities le LEFT JOIN datasources ds ON le.DataSourceId = ds.DataSourceId WHERE le.LandingzoneEntityId = ?` |
| | (2) `SELECT * FROM bronze_entities WHERE LandingzoneEntityId = ?` |
| | (3) `SELECT * FROM silver_entities WHERE BronzeLayerEntityId = ?` |
| | (4) `SELECT LoadValue, LastLoadDatetime FROM watermarks WHERE LandingzoneEntityId = ? ORDER BY LastLoadDatetime DESC LIMIT 5` |
| **Tables used** | `lz_entities`, `datasources`, `bronze_entities`, `silver_entities`, `watermarks` (0 rows) |

---

## 2. Bugs Found

### BUG 1 (CRITICAL): Backend response shape does not match frontend `JourneyData` interface

The backend `get_entity_journey()` returns:
```python
{
    "entityId": int,
    "lz": { raw SQLite row: LandingzoneEntityId, DataSourceId, SourceSchema, SourceName, FileName, FilePath, FileType, IsIncremental, IsIncrementalColumn, ... DataSourceName },
    "bronze": { raw SQLite row: BronzeLayerEntityId, LandingzoneEntityId, Schema_, Name, PrimaryKeys, FileType, IsActive, ... } | None,
    "silver": { raw SQLite row: SilverLayerEntityId, BronzeLayerEntityId, Schema_, Name, FileType, IsActive, ... } | None,
    "lastLoadValues": [ { LoadValue, LastLoadDatetime } ]
}
```

The frontend `JourneyData` interface expects:
```typescript
{
    entityId: number,
    source: { schema, name, dataSourceName, dataSourceType, namespace, connectionName, connectionType },
    landing: { entityId, fileName, filePath, fileType, lakehouse, isIncremental, incrementalColumn, customSelect, customNotebook },
    bronze: { entityId, schema, name, primaryKeys, fileType, lakehouse, rowCount, columns: ColumnInfo[], columnCount } | null,
    silver: { entityId, schema, name, fileType, lakehouse, rowCount, columns: ColumnInfo[], columnCount } | null,
    gold: null,
    schemaDiff: SchemaDiffEntry[]
}
```

**Impact**: Every field access on the response will fail. `journey.source.schema` -> `undefined` because backend returns `lz` not `source`. `journey.landing.fileName` -> `undefined` because backend returns `lz.FileName` not `landing.fileName`. The page will render blank or crash on every entity selection.

**Missing from backend response entirely**:
- `source.dataSourceType` (no join to datasources.Type)
- `source.namespace` (no join to datasources.Namespace)
- `source.connectionName` / `source.connectionType` (no join through connections)
- `landing.lakehouse` (no join to lakehouses table for lakehouse name)
- `bronze.lakehouse` / `silver.lakehouse` (no lakehouse name lookup)
- `bronze.rowCount` / `silver.rowCount` (not stored in SQLite, would require Fabric lakehouse query)
- `bronze.columns` / `silver.columns` (not stored in SQLite, would require Fabric INFORMATION_SCHEMA query)
- `bronze.columnCount` / `silver.columnCount` (derived from columns)
- `schemaDiff` (entirely computed, not in backend)
- `gold` (stub, but not returned)

### BUG 2 (HIGH): `watermarks` table is empty (0 rows)

The backend queries `watermarks` for load history, but this table has 0 rows. The `lastLoadValues` will always be an empty list. The frontend doesn't directly display `lastLoadValues` (it's in the returned data but not mapped into `JourneyData`), so this is a latent data gap rather than a crash bug.

### BUG 3 (MEDIUM): Entity status not included in journey response

The frontend doesn't currently display per-layer load status on the DataJourney page, but the `entity_status` table (4998 rows) is the actual source of truth for whether an entity has been "loaded" to each layer. The journey endpoint ignores it entirely.

The `getMaxLayer()` function (line 131) determines how far an entity has progressed:
```typescript
function getMaxLayer(data: JourneyData): string {
    if (data.silver) return "silver";
    if (data.bronze) return "bronze";
    return "landing";
}
```

This uses the *existence* of bronze/silver entity registration to determine progress, not actual load status from `entity_status`. Since all 1666 entities are registered across all 3 layers, `getMaxLayer()` will always return `"silver"` for every entity — even ones that have never been loaded. This is misleading: the timeline will show full progression (Source -> Landing -> Bronze -> Silver all lit up) for entities with status `"not_started"`.

### BUG 4 (LOW): `pipeline_bronze_entity` used in `get_bronze_view()` is empty

`cpdb.get_bronze_view()` LEFT JOINs `pipeline_bronze_entity` (0 rows). This doesn't cause a crash because it's a LEFT JOIN, but the `IsProcessed` and `InsertDateTime` columns will always be NULL. This view is used by the entity digest (which DataJourney relies on for the selector), not by the journey endpoint directly.

---

## 3. Table/Column Usage Summary

| Table | Column(s) Used | Correct? | Notes |
|-------|---------------|----------|-------|
| `lz_entities` | `*` (all columns) | YES | Correct table, correct join to datasources |
| `datasources` | `Name AS DataSourceName` | PARTIAL | Missing `Type`, `Namespace` which frontend needs |
| `bronze_entities` | `*` (all columns) | YES | Correct table and FK join via `LandingzoneEntityId` |
| `silver_entities` | `*` (all columns) | YES | Correct table and FK join via `BronzeLayerEntityId` |
| `watermarks` | `LoadValue, LastLoadDatetime` | YES | Correct table but 0 rows — no data to show |
| `entity_status` | NOT USED | BUG | Should be used to determine actual load status per layer |
| `connections` | NOT USED | BUG | Should be joined for `connectionName`, `connectionType` |
| `lakehouses` | NOT USED | BUG | Should be joined for lakehouse display names |
| `pipeline_lz_entity` | NOT USED | OK | Empty table, not needed here |
| `pipeline_bronze_entity` | NOT USED (directly) | OK | Empty table, used only in bronze_view |

---

## 4. IsActive Misuse Check

The journey endpoint does NOT filter by `IsActive`. It returns the entity regardless of active status. This is arguably correct for a "show me this entity's full journey" use case. No IsActive-as-loaded-proxy issue here.

However, the entity selector (useEntityDigest) does include inactive entities. The digest builds its status from `entity_status.Status` values, which is correct.

---

## 5. Fix Required

The backend `get_entity_journey()` needs a complete rewrite to:

1. **Restructure response** to match the `JourneyData` TypeScript interface (nested `source`, `landing`, `bronze`, `silver`, `gold`, `schemaDiff` objects)
2. **Join connections table** for `connectionName` and `connectionType` (via `datasources.ConnectionId -> connections`)
3. **Join datasources table** for `Type` (dataSourceType) and `Namespace`
4. **Join lakehouses table** for lakehouse display names on each layer
5. **Include entity_status** to report actual load status (not just registration existence)
6. **Add placeholder** for `rowCount`, `columns`, `columnCount`, `schemaDiff` (these require live Fabric lakehouse queries that may not be available from the SQLite replica)

Alternatively, the frontend could be adapted to consume the raw backend shape, but given the page is designed around the rich `JourneyData` interface, fixing the backend is the correct approach.

---

## 6. Overall Risk Assessment

| Severity | Count | Items |
|----------|-------|-------|
| CRITICAL | 1 | Response shape mismatch — page broken for all entities |
| HIGH | 1 | Watermarks table empty — no load history data |
| MEDIUM | 1 | entity_status not used — false progress indication |
| LOW | 1 | pipeline_bronze_entity empty — NULL processing fields |
