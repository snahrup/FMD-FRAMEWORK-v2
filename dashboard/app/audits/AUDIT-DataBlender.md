# AUDIT: DataBlender.tsx

**Page**: `dashboard/app/src/pages/DataBlender.tsx`
**Date**: 2026-03-13
**Auditor**: Steve Nahrup (automated)
**Verdict**: 3 BUGS found (1 critical, 1 moderate, 1 minor), 1 missing backend route

---

## Architecture Overview

DataBlender is a multi-panel exploration page with five subcomponents:

| Component | File | API Endpoint | Status |
|-----------|------|--------------|--------|
| `TableBrowser` | `components/datablender/TableBrowser.tsx` | `GET /api/blender/tables` | Live API |
| `TableProfiler` | `components/datablender/TableProfiler.tsx` | `GET /api/blender/profile` | Live API |
| `BlendSuggestions` | `components/datablender/BlendSuggestions.tsx` | None (hardcoded empty) | Stub |
| `BlendPreview` | `components/datablender/BlendPreview.tsx` | None (hardcoded empty) | Stub |
| `SqlWorkbench` | `components/datablender/SqlWorkbench.tsx` | `POST /api/blender/query` | Live API |
| Purview status | DataBlender.tsx (parent) | `GET /api/purview/status` | Missing |
| Purview search | TableProfiler.tsx | `GET /api/purview/search` | Missing |

---

## Data Flow Trace

### 1. Purview Status Check (parent page)

| Step | Artifact | Details |
|------|----------|---------|
| Frontend call | `fetch('/api/purview/status')` | `DataBlender.tsx:25` |
| API endpoint | `GET /api/purview/status` | **DOES NOT EXIST** |
| Behavior | `catch` block sets `purviewConnected = false` | Shows "Purview offline" badge |

**Assessment**: NOT A BUG -- graceful degradation. The endpoint doesn't exist, the catch block fires, and the UI correctly shows "Purview offline". This is a planned-but-not-yet-implemented feature. No data correctness issue.

---

### 2. TableBrowser (left panel)

| Step | Artifact | Details |
|------|----------|---------|
| Frontend call | `fetch('/api/blender/tables')` | `TableBrowser.tsx:41` |
| API endpoint | `GET /api/blender/tables` | `data_access.py:137` |
| DB module | `dashboard/app/api/db.py` → `fmd_control_plane.db` | Same SQLite DB |
| Query 1 (LZ) | `lz_entities` JOIN `datasources` JOIN `lakehouses` | WHERE `le.IsActive = 1` |
| Query 2 (Bronze) | `bronze_entities` JOIN `lakehouses` | WHERE `be.IsActive = 1` |
| Query 3 (Silver) | `silver_entities` JOIN `lakehouses` | WHERE `se.IsActive = 1` |

**Tables read**: `lz_entities` (1,666), `bronze_entities` (1,666), `silver_entities` (1,666), `datasources` (8), `lakehouses` (6)

**Returned shape**: Array of `{id, name, layer, lakehouse, schema, source?, dataSource?}`

**Assessment**: CORRECT.
- LZ entities: `id = "lz-{LandingzoneEntityId}"`, `name = FileName || SourceName`, `layer = "landing"`, `lakehouse = LakehouseName || "LH_DATA_LANDINGZONE"`, `schema = SourceSchema || "dbo"`, `dataSource = DataSourceName`
- Bronze entities: `id = "br-{BronzeLayerEntityId}"`, `name = Name`, `layer = "bronze"`, `lakehouse = LakehouseName || "LH_BRONZE_LAYER"`, `schema = Schema_ || "dbo"`
- Silver entities: `id = "sv-{SilverLayerEntityId}"`, `name = Name`, `layer = "silver"`, `lakehouse = LakehouseName || "LH_SILVER_LAYER"`, `schema = Schema_ || "dbo"`
- All JOIN paths and column references are valid.
- Note: Bronze/Silver tables don't include `dataSource` in the response (missing from the query). This means the TableBrowser won't be able to show data source for Bronze/Silver tables, but this is a minor omission, not a data correctness bug.

---

### 3. TableProfiler (right panel, Profile tab)

| Step | Artifact | Details |
|------|----------|---------|
| Frontend call | `fetch('/api/blender/profile?lakehouse=...&schema=...&table=...')` | `TableProfiler.tsx:59` |
| API endpoint | `GET /api/blender/profile` | `data_access.py:221` |
| Backend queries | `INFORMATION_SCHEMA.COLUMNS` (via Fabric SQL endpoint) | Schema metadata |
| | `SELECT COUNT(*) AS cnt FROM [schema].[table]` | Row count |
| Connection | `_get_lakehouse_connection()` → pyodbc to Fabric SQL Analytics | SP token auth |

**Backend return shape**:
```python
{"lakehouse": str, "schema": str, "table": str, "rowCount": int,
 "columns": [{"COLUMN_NAME": str, "DATA_TYPE": str, "IS_NULLABLE": str}, ...]}
```

**Frontend expected shape** (`LiveTableProfile` from `types/blender.ts`):
```typescript
{lakehouse, schema, table, rowCount, columnCount, profiledColumns,
 columns: [{name, dataType, nullable, distinctCount, nullPercentage, minValue, maxValue, ...}]}
```

---

## BUG 1 (CRITICAL): Column field name mismatch between backend and frontend

**Severity**: Critical -- the profiler renders but all column data is undefined/NaN.

The backend profile endpoint returns raw `INFORMATION_SCHEMA.COLUMNS` rows with SQL Server column names:
- `COLUMN_NAME`, `DATA_TYPE`, `IS_NULLABLE`

The frontend `LiveProfileView` component accesses:
- `col.name`, `col.dataType`, `col.nullPercentage`, `col.distinctCount`, `col.completeness`, `col.minValue`, `col.maxValue`

None of these match. The `TableProfiler` checks `data.columns && data.columns.length > 0` (line 64) -- this passes because the array exists and has items, so `setIsLive(true)` is called and `LiveProfileView` renders.

Inside `LiveProfileView`:
- `col.name` = `undefined` (should be `COLUMN_NAME`)
- `col.dataType` = `undefined` (should be `DATA_TYPE`)
- `col.nullPercentage` = `undefined` → treated as `NaN` in arithmetic
- `col.distinctCount` = `undefined` → `NaN`
- `formatNumber(profile.rowCount)` works correctly (backend returns `rowCount` as expected)
- `profile.columnCount` is `undefined` (backend doesn't return it)

**Result**: The profiler shows the correct table name, lakehouse, schema, and row count. But the column table renders with all `undefined` values and NaN percentages. The "Columns" stat card shows "undefined". Quality bars render at 0%.

**Fix**: The backend should map `INFORMATION_SCHEMA` fields to the expected camelCase format. It should also compute `distinctCount`, `nullPercentage`, `minValue`, `maxValue` per column (which requires actual data queries, not just schema metadata). At minimum:
```python
cols_mapped = [
    {"name": c["COLUMN_NAME"], "dataType": c["DATA_TYPE"],
     "nullable": c["IS_NULLABLE"] == "YES",
     "distinctCount": 0, "nullPercentage": 0, "nullCount": 0, "ordinal": i}
    for i, c in enumerate(cols)
]
return {"lakehouse": ..., "schema": ..., "table": ...,
        "rowCount": row_count, "columnCount": len(cols_mapped),
        "profiledColumns": 0, "columns": cols_mapped}
```

**Files**:
- Backend: `dashboard/app/api/routes/data_access.py:221-248`
- Frontend: `dashboard/app/src/components/datablender/TableProfiler.tsx:122-248`
- Type: `dashboard/app/src/types/blender.ts:42-51`

---

### 4. SqlWorkbench (bottom panel)

| Step | Artifact | Details |
|------|----------|---------|
| Frontend call | `POST /api/blender/query` with `{lakehouse, sql}` | `SqlWorkbench.tsx:61` |
| API endpoint | `POST /api/blender/query` | `data_access.py:274` |
| Security | `_validate_select_only()` blocks DML/DDL | SELECT-only enforcement |
| Connection | `_get_lakehouse_connection()` → pyodbc to Fabric SQL | SP token auth |
| TOP enforcement | Auto-injects `TOP 100` if missing | Server-side safety |

**Return shape**: `{success, rowCount, rows: [{col: val, ...}], sql}` or `{error}`
**Frontend type**: `QueryResult` from `types/blender.ts:84-90` — matches.

**Assessment**: CORRECT. The SQL workbench correctly:
- Sends the lakehouse name and SQL to the backend
- Backend validates SELECT-only, injects TOP 100, queries the Fabric SQL endpoint
- Returns column names and string-coerced values
- Frontend renders the result table with proper column headers from `Object.keys(result.rows[0])`

---

### 5. BlendSuggestions (stub)

**Assessment**: NO DATA ISSUE. The component hardcodes `suggestions = []` and shows an empty state. It references the `BlendSuggestion` type and `layerConfig` from mock data but never calls any API. No data correctness concern -- this is an unimplemented feature.

---

### 6. BlendPreview (stub)

**Assessment**: NO DATA ISSUE. The component renders a static "No blend preview available" message. No API calls, no data sources. Pure placeholder.

---

### 7. Purview Search (TableProfiler)

| Step | Artifact | Details |
|------|----------|---------|
| Frontend call | `fetch('/api/purview/search?q=...')` | `TableProfiler.tsx:84` |
| API endpoint | `GET /api/purview/search` | **DOES NOT EXIST** |
| Behavior | `catch` block silently ignores | No UI impact |

**Assessment**: NOT A BUG -- the Purview link only appears if `purviewEntity` is set, which never happens since the API doesn't exist. Graceful degradation.

---

## BUG 2 (MODERATE): TableProfiler ID format parsing is brittle

**Severity**: Moderate -- affects tables discovered via lakehouse (non-metadata) path.

`TableProfiler.tsx` lines 42-50 parse `tableId` with format `lh-{lakehouse}-{schema}-{table}`, splitting on dashes from the right. But lakehouse names like `LH_BRONZE_LAYER` and table names like `GL_Account_Master` contain no dashes (they use underscores), so this works for the current data.

However, the `TableBrowser` generates IDs in the format `lz-{LandingzoneEntityId}`, `br-{BronzeLayerEntityId}`, `sv-{SilverLayerEntityId}` -- these are integer-suffixed, not `lh-` prefixed.

When a user selects a table from the browser tree:
- `tableId` = `"br-42"` (for example)
- The `lh-` prefix check fails (line 42)
- Falls through to `tableMeta` branch (line 51)
- Uses `tableMeta.lakehouse`, `tableMeta.schema`, `tableMeta.name` -- which ARE populated correctly from the browser

So the `lh-` parsing branch is dead code in the current flow. The `tableMeta` branch works correctly. But if anyone ever sends an `lh-` prefixed ID with dashes in the lakehouse name or table name, the right-to-left dash splitting would break.

**Impact**: Low in practice (dead code path), but the parsing logic is fragile.

---

## BUG 3 (MINOR): Backend profile doesn't return `columnCount` or `profiledColumns`

**Severity**: Minor -- UI shows "undefined" in the Columns stat card.

The `LiveTableProfile` type expects `columnCount: number` and `profiledColumns: number`. The backend only returns `{lakehouse, schema, table, rowCount, columns}`. The missing `columnCount` means the stat card renders "undefined".

**Fix**: Add `"columnCount": len(cols)` and `"profiledColumns": 0` to the backend response dict at `data_access.py:243`.

---

## Data Source Summary

| Frontend metric | Data source | Table(s) / column(s) | Correct? | Notes |
|-----------------|-------------|----------------------|----------|-------|
| Table tree (LZ) | SQLite `lz_entities` JOIN `datasources` JOIN `lakehouses` | `SourceName`, `FileName`, `SourceSchema`, `LakehouseName` | YES | |
| Table tree (Bronze) | SQLite `bronze_entities` JOIN `lakehouses` | `Name`, `Schema_`, `LakehouseName` | YES | |
| Table tree (Silver) | SQLite `silver_entities` JOIN `lakehouses` | `Name`, `Schema_`, `LakehouseName` | YES | |
| Table count per layer | Derived from table tree | Counted client-side | YES | |
| Profile: row count | Fabric SQL endpoint: `SELECT COUNT(*)` | Live query | YES | |
| Profile: columns | Fabric SQL endpoint: `INFORMATION_SCHEMA.COLUMNS` | Live query | WRONG field names (BUG 1) | |
| Profile: distinct/nulls/min/max | Not computed | N/A | MISSING | Backend only returns schema metadata, no data profiling |
| Profile: columnCount | Not returned by backend | N/A | MISSING (BUG 3) | |
| SQL workbench results | Fabric SQL endpoint: user query | Live query | YES | |
| Purview status | `/api/purview/status` | N/A | N/A (unimplemented) | |
| Blend suggestions | Hardcoded empty array | N/A | N/A (unimplemented) | |
| Blend preview | Static placeholder | N/A | N/A (unimplemented) | |

---

## Recommendations

1. **Fix BUG 1 immediately** -- map `INFORMATION_SCHEMA` column names to the `ColumnProfile` interface fields in the backend. At minimum provide `name`, `dataType`, `nullable`, and zeroed metrics. Ideally add actual profiling queries (COUNT DISTINCT, NULL %, MIN, MAX) per column.
2. **Fix BUG 3** -- add `columnCount` and `profiledColumns` to the backend profile response.
3. **Consider lazy profiling** -- full column-level profiling (DISTINCT, NULL%, MIN, MAX) across all columns is expensive on Fabric SQL endpoints. Consider computing it on-demand per column or caching results.
4. **BlendSuggestions and BlendPreview** are pure stubs. No API integration needed until the feature is built. The mock data in `blenderMockData.ts` is not used by either component.
5. **Purview integration** is a future feature. Both `/api/purview/status` and `/api/purview/search` are missing. The frontend degrades gracefully. No action needed unless Purview integration is prioritized.
