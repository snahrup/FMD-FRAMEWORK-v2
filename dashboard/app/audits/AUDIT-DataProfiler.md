# AUDIT: DataProfiler

**Audited:** 2026-03-13
**File:** `dashboard/app/src/pages/DataProfiler.tsx` (~1120 lines)
**Backend route:** `dashboard/app/api/routes/data_access.py` — `get_blender_profile()`
**Hooks:** `useEntityDigest` from `@/hooks/useEntityDigest.ts`
**Schema ref:** `dashboard/app/audits/SCHEMA_REFERENCE.txt`

---

## Overview

DataProfiler lets users select a data source, entity, and layer (Bronze or Silver), then profiles the table by querying the Fabric lakehouse SQL endpoint for column metadata and row counts. It displays completeness, uniqueness, null density, quality rankings, and a missing-value matrix.

### Data Flow

```
EntityPicker (inline component)
  └─ useEntityDigest() → GET /api/entity-digest → SQLite (lz_entities, bronze_entities, silver_entities, entity_status, datasources, connections)
       → Populates source selector, entity list, layer status badges

Profile button click
  └─ loadProfile() → GET /api/blender/profile?lakehouse=X&schema=Y&table=Z
       → data_access.py:get_blender_profile()
         → _query_lakehouse(lakehouse, INFORMATION_SCHEMA.COLUMNS)
         → _query_lakehouse(lakehouse, COUNT(*))
         → returns {lakehouse, schema, table, rowCount, columns: [{COLUMN_NAME, DATA_TYPE, IS_NULLABLE}]}
```

---

## API Endpoint Trace

### 1. GET /api/entity-digest (entity list for EntityPicker)

| Frontend | Backend | SQL Tables | Correct? |
|----------|---------|------------|----------|
| `useEntityDigest()` in EntityPicker | `entities.py:get_entity_digest()` → `_build_sqlite_entity_digest()` | `lz_entities` + JOINs via `cpdb.get_registered_entities_full()`, `entity_status`, `bronze_entities`, `silver_entities` | YES |

- **Tables used:** `lz_entities`, `datasources`, `connections`, `lakehouses`, `bronze_entities`, `silver_entities`, `entity_status`
- **Fields consumed by EntityPicker:** `id`, `tableName`, `sourceSchema`, `source`, `lzStatus`, `bronzeStatus`, `silverStatus`, `summary.total`
- **All fields correctly sourced from SQLite.** No issues.

### 2. GET /api/blender/profile (column profiling)

| Frontend | Backend | Data Source | Correct? |
|----------|---------|-------------|----------|
| `loadProfile()` line 677 | `data_access.py:get_blender_profile()` | Live Fabric Lakehouse SQL Endpoint (INFORMATION_SCHEMA.COLUMNS + COUNT(*)) | PARTIAL |

- **URL construction:** `${API}/blender/profile?lakehouse=...&schema=...&table=...`
  - Note: `API = "/api"`, so final URL is `/api/blender/profile?...` — CORRECT.
- **Backend queries Fabric lakehouse** via `_query_lakehouse()`, NOT SQLite. This is correct for column schema since SQLite does not store per-column metadata.
- **Lakehouse name** comes from `LAYER_LAKEHOUSE` map: `landing → LH_DATA_LANDINGZONE`, `bronze → LH_BRONZE_LAYER`, `silver → LH_SILVER_LAYER`. Matched against `lakehouses` table in SQLite for GUID lookup. CORRECT.

---

## Issues Found

### F1. CRITICAL — Backend returns raw INFORMATION_SCHEMA; frontend expects rich profile data

**Problem:** The frontend `ProfileColumn` interface expects these fields from the API response:
```typescript
interface ProfileColumn {
  name: string;          // Backend returns COLUMN_NAME
  dataType: string;      // Backend returns DATA_TYPE
  nullable: boolean;     // Backend returns IS_NULLABLE (string "YES"/"NO")
  maxLength: number | null;       // NOT returned
  precision: number | null;       // NOT returned
  scale: number | null;           // NOT returned
  ordinal: number;                // NOT returned
  distinctCount: number;          // NOT returned
  nullCount: number;              // NOT returned
  nullPercentage: number;         // NOT returned
  minValue: string | null;        // NOT returned
  maxValue: string | null;        // NOT returned
  uniqueness: number;             // NOT returned
  completeness: number;           // NOT returned
}
```

The refactored `get_blender_profile()` in `data_access.py` only queries `INFORMATION_SCHEMA.COLUMNS` for `COLUMN_NAME, DATA_TYPE, IS_NULLABLE` and does a `COUNT(*)` for row count. It returns:
```python
{"lakehouse": ..., "schema": ..., "table": ..., "rowCount": N,
 "columns": [{"COLUMN_NAME": "...", "DATA_TYPE": "...", "IS_NULLABLE": "..."}]}
```

The OLD `server.py.bak` (line 1290-1337) had a rich profiling function that ran `COUNT(DISTINCT col)`, `SUM(CASE WHEN col IS NULL...)`, `MIN(col)`, `MAX(col)` per column against the lakehouse, and computed `distinctCount`, `nullCount`, `nullPercentage`, `uniqueness`, `completeness`, `minValue`, `maxValue`.

**Impact:** The entire DataProfiler page is non-functional. Every column will show 0% completeness, 0% uniqueness, 0 distinct, 0 nulls, and no min/max values. The quality ranking and missing-value matrix will be empty/misleading. The frontend's `??` fallback (line 688-694) masks the missing fields by defaulting to 0, so it won't crash but will show incorrect data.

**Additionally:** Field names don't match. Backend returns `COLUMN_NAME`; frontend expects `name`. Backend returns `IS_NULLABLE` as string; frontend expects `nullable` as boolean. The frontend will get `undefined` for all fields it actually uses.

### F2. MEDIUM — Schema param mismatch

**Problem:** The `handleProfile()` function (line 496-499) passes `selectedEntity.source || selectedEntity.sourceSchema` as the schema parameter. The `source` field from the digest is the data source namespace (e.g., "MES", "ETQ"), not a SQL schema. For example, if `selectedEntity.source = "MES"` and `selectedEntity.sourceSchema = "dbo"`, the profile request sends `schema=MES`, but the lakehouse table is actually under schema `dbo` (or the namespace). The Fabric lakehouse INFORMATION_SCHEMA query will find zero columns for `TABLE_SCHEMA = 'MES'`.

**Fix needed:** Use `selectedEntity.sourceSchema` (which is typically "dbo") as the schema parameter, not `selectedEntity.source`.

### F3. LOW — `columnCount` and `profiledColumns` fields not returned

**Problem:** The frontend `ProfileData` interface expects `columnCount` and `profiledColumns` from the API. The refactored backend does not return these. The summary strip KPIs (line 877-879) show `profile.columnCount` and `profile.profiledColumns`, which will be `undefined` and display as empty.

### F4. LOW — No ORDINAL_POSITION in backend query

**Problem:** The backend INFORMATION_SCHEMA query does not include `ORDINAL_POSITION`, `CHARACTER_MAXIMUM_LENGTH`, `NUMERIC_PRECISION`, or `NUMERIC_SCALE`. These are shown in the ColumnDetailPanel expand view (line 264-268). The old `server.py.bak` queried all INFORMATION_SCHEMA columns.

---

## Mock / Hardcoded Data Check

| Item | Status |
|------|--------|
| Entity list | LIVE — from `/api/entity-digest` via SQLite |
| Profiling data | LIVE — queries Fabric lakehouse SQL endpoint at runtime |
| Lakehouse names | HARDCODED map `LAYER_LAKEHOUSE` matches actual lakehouse names in DB |
| Layer options | HARDCODED to Bronze/Silver only (correct, LZ is parquet, no SQL schema) |
| TYPE_MAP | HARDCODED display mapping — cosmetic only, no data issue |

---

## Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 1 | Backend profile endpoint is a skeleton — returns raw INFORMATION_SCHEMA with wrong field names and no profiling statistics (distinctCount, nullCount, completeness, uniqueness, min/max). The entire page displays zeroes. |
| MEDIUM | 1 | Schema param sends data source namespace instead of SQL schema |
| LOW | 2 | Missing columnCount/profiledColumns fields; missing ORDINAL_POSITION and length/precision columns |
