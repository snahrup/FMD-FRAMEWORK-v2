# AUDIT: DataCatalog.tsx

**File**: `dashboard/app/src/pages/DataCatalog.tsx` (371 lines)
**Audited**: 2026-03-13
**Verdict**: PASS — all data sourced correctly from entity digest

---

## Page Overview

Data Catalog is a browsable grid of all registered entities with search, source filtering, sort, and a detail modal showing layer coverage, source connection info, primary keys, and metadata.

---

## Data Sources

### 1. Entity Digest (sole data source)

| What | Detail |
|------|--------|
| **Hook** | `useEntityDigest()` from `@/hooks/useEntityDigest` |
| **API call** | `GET /api/entity-digest` |
| **Backend handler** | `routes/entities.py → get_entity_digest()` → `_build_sqlite_entity_digest()` |
| **SQLite tables** | `lz_entities`, `datasources`, `connections`, `bronze_entities`, `silver_entities`, `entity_status`, `pipeline_bronze_entity`, `sync_metadata` |
| **Cache** | Server: 120s TTL, Client: 30s TTL + module-level singleton dedup |

---

## KPIs and Metrics

| KPI | Source | Computation | Correct? |
|-----|--------|-------------|----------|
| **Registered Entities** | `allEntities.length` | Count of all DigestEntity objects flattened from all sources | PASS — matches `lz_entities` WHERE IsActive=1 (via digest) |
| **Data Sources** | `sources.length` | Unique `source` values from `allEntities` | PASS — derived from `datasources.Namespace` |
| **Loaded %** | `loadedPct` | `allEntities.filter(e => e.lzStatus === "loaded").length / allEntities.length * 100` | PASS — `lzStatus` comes from `entity_status` WHERE Layer='LandingZone' |

---

## Entity Grid Fields

| Field | DigestEntity Property | SQLite Source | Correct? |
|-------|-----------------------|---------------|----------|
| Entity name | `tableName` | `lz_entities.SourceName` | PASS |
| Schema | `sourceSchema` | `lz_entities.SourceSchema` | PASS |
| Source badge | `source` | `datasources.Namespace` | PASS |
| LZ layer badge | `lzStatus === "loaded"` | `entity_status` WHERE Layer='LandingZone' | PASS |
| Bronze layer badge | `bronzeStatus === "loaded"` | `entity_status` WHERE Layer='Bronze' | PASS |
| Silver layer badge | `silverStatus === "loaded"` | `entity_status` WHERE Layer='Silver' | PASS |
| Last load time | `lzLastLoad` | `entity_status.LoadEndDateTime` WHERE Layer='LandingZone' | PASS |

---

## Entity Detail Modal Fields

| Field | DigestEntity Property | SQLite Source | Correct? |
|-------|-----------------------|---------------|----------|
| Table name | `tableName` | `lz_entities.SourceName` | PASS |
| Source schema | `sourceSchema` | `lz_entities.SourceSchema` | PASS |
| Source badge | `source` | `datasources.Namespace` | PASS |
| Layer count | Computed from lz/bronze/silver status | `entity_status` | PASS |
| Load type | `isIncremental` | `lz_entities.IsIncremental` | PASS |
| Server | `connection.server` | `connections.ServerName` | PASS |
| Database | `connection.database` | `connections.DatabaseName` | PASS |
| Primary Keys | `bronzePKs` | `bronze_entities.PrimaryKeys` | PASS |
| Watermark column | `watermarkColumn` | `lz_entities.IsIncrementalColumn` | PASS |
| Last error | `lastError.message` | `entity_status.ErrorMessage` (most recent layer error) | PASS |
| Layer status per layer | `lzStatus`, `bronzeStatus`, `silverStatus` | `entity_status.Status` per layer | PASS |
| Layer last load per layer | `lzLastLoad`, `bronzeLastLoad`, `silverLastLoad` | `entity_status.LoadEndDateTime` per layer | PASS |

---

## Detail Modal Tabs

| Tab | Data Source | Status |
|-----|-------------|--------|
| Overview | Entity digest fields | PASS — fully wired |
| Columns | None — placeholder text | PASS — correctly shows "Column metadata not yet captured" |
| Lineage | None — links to /lineage page | PASS — no data fetch |
| Quality | None — placeholder text | PASS — correctly shows "Quality scoring not configured" |

---

## Issues Found

None. All data is correctly sourced from the entity digest, which in turn queries the correct SQLite tables. The modal's placeholder tabs (Columns, Lineage, Quality) are honestly labeled as not-yet-available.

---

## Summary

Clean page. All KPIs, entity cards, and detail modal fields trace correctly through `useEntityDigest` → `GET /api/entity-digest` → `_build_sqlite_entity_digest()` → proper SQLite JOINs across `lz_entities`, `datasources`, `connections`, `bronze_entities`, `silver_entities`, and `entity_status`.
