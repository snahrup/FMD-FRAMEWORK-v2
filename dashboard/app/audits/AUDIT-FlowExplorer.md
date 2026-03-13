# AUDIT: FlowExplorer.tsx

**Page**: `dashboard/app/src/pages/FlowExplorer.tsx`
**Date**: 2026-03-13
**Auditor**: Claude (Opus)
**Verdict**: LOW RISK — Data sources are correct. Minor semantic issues with how bronze/silver layer presence is determined.

---

## 1. API Calls Traced

### 1A. Entity Digest (primary data source)

| Step | Detail |
|------|--------|
| **Frontend** | `useEntityDigest()` hook -> `GET /api/entity-digest` |
| **Backend route** | `entities.py:get_entity_digest()` -> `_build_sqlite_entity_digest()` |
| **SQL queries (via cpdb)** | `get_registered_entities_full()`: `lz_entities JOIN datasources JOIN connections` |
| | `get_entity_status_all()`: `SELECT * FROM entity_status` |
| | `get_bronze_view()`: `bronze_entities JOIN lz_entities JOIN datasources LEFT JOIN pipeline_bronze_entity` |
| | `get_silver_view()`: `silver_entities JOIN bronze_entities JOIN lz_entities JOIN datasources` |
| **Tables used** | `lz_entities` (1666), `datasources` (8), `connections` (10), `entity_status` (4998), `bronze_entities` (1666), `silver_entities` (1666), `pipeline_bronze_entity` (0 rows, LEFT JOIN) |
| **Status** | CORRECT — All tables exist and have data. Digest builds correctly. |

### 1B. Connections (for Framework Architecture view)

| Step | Detail |
|------|--------|
| **Frontend** | `fetchJson<Connection[]>("/connections")` (line 584) |
| **Backend route** | `control_plane.py:get_connections()` -> `cpdb.get_connections()` |
| **SQL** | `SELECT ConnectionId, Name, Type, IsActive FROM connections ORDER BY Name` |
| **Table** | `connections` (10 rows) |
| **Status** | PARTIAL — Missing `ConnectionGuid` column. Frontend interface declares `ConnectionGuid: string` but the backend query doesn't SELECT it. |

### 1C. DataSources (for type/namespace lookup)

| Step | Detail |
|------|--------|
| **Frontend** | `fetchJson<DataSource[]>("/datasources")` (line 585) |
| **Backend route** | `control_plane.py:get_datasources()` -> `cpdb.get_datasources()` |
| **SQL** | `SELECT d.DataSourceId, d.Name, d.Namespace, d.Type, d.Description, d.IsActive, c.Name AS ConnectionName FROM datasources d LEFT JOIN connections c ON c.ConnectionId = d.ConnectionId ORDER BY d.Namespace, d.Name` |
| **Table** | `datasources` (8 rows), `connections` (10 rows) |
| **Status** | CORRECT — All fields the frontend uses (`Name`, `Namespace`, `Type`, `ConnectionName`, `IsActive`) are present. |

### 1D. Pipelines (for Framework Architecture view)

| Step | Detail |
|------|--------|
| **Frontend** | `fetchJson<Pipeline[]>("/pipelines")` (line 586) |
| **Backend route** | `pipeline.py:get_pipelines()` |
| **SQL** | `SELECT * FROM pipelines ORDER BY PipelineId` |
| **Table** | `pipelines` (6 rows) |
| **Status** | PARTIAL — The frontend interface declares `PipelineGuid` and `WorkspaceGuid` fields. The schema has these columns (added via ALTER TABLE), and `SELECT *` includes them, so they'll be present. However, `cpdb.get_pipelines()` (used elsewhere) only returns `PipelineId, Name, IsActive` — the route here uses `db.query("SELECT * ...")` which returns all columns. This is fine. |

---

## 2. Bugs Found

### BUG 1 (MEDIUM): Bronze/Silver layer presence determined by entity registration, not load status

The `digestToFlow()` function (line 616) determines `maxLayer` like this:
```typescript
let maxLayer: EntityFlow["maxLayer"] = "landing";
if (ent.silverId != null) maxLayer = "silver";
else if (ent.bronzeId != null) maxLayer = "bronze";
```

The `bronzeId` and `silverId` fields come from the entity digest, which derives them from `bronze_entities` and `silver_entities` table registration. Since **all 1666 entities are registered across all 3 layers**, every entity will show `maxLayer = "silver"`, and every `bronzeName`/`silverName` will be non-null.

This means:
- The **flow visualization** will show all entities as fully progressed to Silver
- The **source group counts** (`bronzeCount`, `silverCount`) will always equal `landingCount` (all 1666)
- The connector between layers will always be active (never dimmed/pending)
- The narrative will say "Business rules and data quality checks are applied" for every entity, even ones never loaded

**Root cause**: The digest backend (`_build_sqlite_entity_digest`) correctly tracks `lzStatus`, `bronzeStatus`, `silverStatus` from `entity_status` table, but the FlowExplorer only checks for ID existence, not status values.

**Fix**: Change `maxLayer` logic to use the status fields:
```typescript
let maxLayer: EntityFlow["maxLayer"] = "landing";
if (ent.silverId != null && ent.silverStatus !== "not_started") maxLayer = "silver";
else if (ent.bronzeId != null && ent.bronzeStatus !== "not_started") maxLayer = "bronze";
```

And similarly gate `bronzeName`/`silverName` on status:
```typescript
bronzeEntityId: (ent.bronzeId != null && ent.bronzeStatus !== "not_started") ? String(ent.bronzeId) : null,
```

### BUG 2 (LOW): `ConnectionGuid` missing from `/api/connections` response

The frontend `Connection` interface (line 29) declares:
```typescript
interface Connection {
    ConnectionId: string;
    ConnectionGuid: string;  // <-- not in query
    Name: string;
    Type: string;
    IsActive: string;
}
```

But `cpdb.get_connections()` selects only `ConnectionId, Name, Type, IsActive`. The `ConnectionGuid` column exists in the table schema but is not selected. The FlowExplorer never actually *uses* `ConnectionGuid` (the `buildArchSourcePaths` function only references `c.Name` and `c.IsActive`), so this is a cosmetic interface mismatch with no runtime impact.

### BUG 3 (LOW): `pipeline_bronze_entity` LEFT JOIN returns NULLs

`get_bronze_view()` LEFT JOINs `pipeline_bronze_entity` (0 rows), so `IsProcessed` and `InsertDateTime` are always NULL. This does not affect FlowExplorer because these fields aren't used in the digest-to-flow conversion. The digest uses `entity_status` for status, not `pipeline_bronze_entity`.

### BUG 4 (INFO): Hardcoded fallback values mask missing data

In `digestToFlow()` (line 616-645):
```typescript
lzFileType: "PARQUET",           // hardcoded, not from entity data
bronzeFileType: ent.bronzeId != null ? "DELTA" : null,   // hardcoded
silverFileType: ent.silverId != null ? "DELTA" : null,    // hardcoded
lzFilePath: ent.sourceSchema,    // using schema as file path (incorrect semantics)
lzFileName: ent.tableName,       // using table name as file name (close but not exact)
dataSourceType: ds?.Type || "ASQL_01",  // defaults to SQL Server
```

These hardcoded values are mostly correct for this framework (LZ is always parquet, Bronze/Silver are always Delta), but:
- `lzFilePath` is set to `ent.sourceSchema` (e.g., "dbo") which is not the actual file path
- `lzFileName` is set to `ent.tableName` which is the source table name, not necessarily the landing zone file name (though they're usually the same)

The actual `FileName` and `FilePath` fields exist in `lz_entities` but are not passed through the digest endpoint. This is a minor inaccuracy in the file path display.

---

## 3. Table/Column Usage Summary

| Table | Columns Used | Correct? | Notes |
|-------|-------------|----------|-------|
| `lz_entities` | `LandingzoneEntityId, SourceSchema, SourceName, IsActive, IsIncremental, DataSourceId` (via digest) | YES | Via entity-digest endpoint |
| `datasources` | `DataSourceId, Name, Namespace, Type, ConnectionName, IsActive` | YES | Via both entity-digest and `/datasources` |
| `connections` | `ConnectionId, Name, Type, IsActive` | YES | Missing ConnectionGuid but unused |
| `pipelines` | `PipelineId, Name, IsActive, PipelineGuid, WorkspaceGuid` | YES | `SELECT *` returns all columns |
| `bronze_entities` | `BronzeLayerEntityId, LandingzoneEntityId, Schema_, Name, PrimaryKeys, IsActive` | YES | Via digest bronze_view |
| `silver_entities` | `SilverLayerEntityId, BronzeLayerEntityId, Schema_, Name, IsActive` | YES | Via digest silver_view |
| `entity_status` | `LandingzoneEntityId, Layer, Status, LoadEndDateTime, ErrorMessage` | YES | Used correctly in digest for status |
| `pipeline_bronze_entity` | LEFT JOIN only (0 rows) | OK | NULL results don't affect FlowExplorer |
| `pipeline_lz_entity` | NOT USED | OK | Empty table, not needed |
| `watermarks` | NOT USED | OK | Not relevant to flow visualization |

---

## 4. IsActive Usage Check

**Connections**: `_isActive(c.IsActive)` in `buildArchSourcePaths()` — filters connections for architecture view. Correct usage: this is the config-level active flag, not a proxy for loaded status.

**Pipelines**: `_isActive(p.IsActive)` in `buildArchSourcePaths()` — filters active pipelines. Correct usage.

**Entities**: The digest reports `isActive` as a boolean from `lz_entities.IsActive`. FlowExplorer does NOT filter on this — all entities (active and inactive) appear in the flow. This is acceptable for a visualization page, though inactive entities could be visually distinguished.

**Bronze/Silver presence**: As noted in BUG 1, `bronzeId != null` and `silverId != null` are used as proxies for "entity exists in that layer." Since all entities are registered, this effectively says "100% at Silver" which is misleading. The `IsActive` flag on bronze/silver entities is not checked either — `get_bronze_view()` does filter `WHERE b.IsActive = 1`, but since all 1666 are active, this doesn't help.

---

## 5. Framework Architecture View Analysis

The "Framework" tab (`FrameworkArchView` component, line 308) builds a pipeline topology visualization.

| Data Source | Query | Notes |
|-------------|-------|-------|
| `pipelines` | `SELECT * FROM pipelines` (6 rows) | Matches pipeline names against patterns like `COMMAND_ASQL`, `COPY_FROM_ASQL_01` |
| `connections` | `cpdb.get_connections()` (10 rows) | Matches connection names against source type keys |

**Source type matching** (line 265-274) uses string matching on pipeline/connection names. This is brittle but functional: if a pipeline named `PL_FMD_LDZ_COMMAND_ASQL` exists, the SQL Server path appears. With only 6 pipelines in the DB, only matching source types will render.

No SQL correctness issues here. The data is from the right tables with the right columns.

---

## 6. Data Flow View Analysis

The "Data Flow" tab uses the entity digest exclusively.

- **Source groups**: Built from `sourceList` (from useEntityDigest), one group per `DigestSource`
- **Entity flows**: Each `DigestEntity` is converted via `digestToFlow()` to an `EntityFlow`
- **Layer counts**: `landingCount` = total entities in source, `bronzeCount` = entities with `bronzeName`, `silverCount` = entities with `silverName`
- **Progressive loading**: PAGE_SIZE = 25, with "Show more" button

The data is correct in terms of which tables it comes from. The issue is purely semantic (BUG 1): registration existence is conflated with actual load completion.

---

## 7. Overall Risk Assessment

| Severity | Count | Items |
|----------|-------|-------|
| CRITICAL | 0 | — |
| MEDIUM | 1 | Bronze/Silver presence based on registration not load status — all entities appear fully loaded |
| LOW | 2 | ConnectionGuid missing from query; pipeline_bronze_entity empty |
| INFO | 1 | Hardcoded file types and incorrect lzFilePath mapping |

---

## 8. Comparison to DataJourney

FlowExplorer is in significantly better shape than DataJourney:
- FlowExplorer uses the entity-digest endpoint which is well-structured and tested
- DataJourney uses `/api/journey` which returns raw SQLite rows that don't match the frontend interface at all
- FlowExplorer's bugs are semantic (misleading progress indicators), not structural (page crashes)
