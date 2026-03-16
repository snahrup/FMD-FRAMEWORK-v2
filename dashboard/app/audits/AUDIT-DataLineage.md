# AUDIT: DataLineage.tsx

**Audited:** 2026-03-13
**Page:** `dashboard/app/src/pages/DataLineage.tsx` (~406 lines)
**Backend:** `dashboard/app/api/routes/entities.py` (entity-digest), no backend for `/api/microscope/{id}`

---

## Data Flow Trace

### API Calls

| # | Frontend Call | Backend Route | SQL / Data Source | Status |
|---|-------------|---------------|-------------------|--------|
| 1 | `GET /api/entity-digest` | `get_entity_digest()` in `entities.py` | `lz_entities` JOIN `datasources` JOIN `connections` + `entity_status` + `bronze_entities` + `silver_entities` | CORRECT |
| 2 | `GET /api/microscope/{entityId}` | **DOES NOT EXIST** | N/A | BROKEN |

---

## Metric-by-Metric Trace

### KPI Cards (lines 273-278, 294-299)

| KPI | Frontend Computation | Correct Source | Correct? |
|-----|---------------------|---------------|----------|
| Total Entities | `allEntities.length` | Count of LZ entities from digest | YES |
| Landing Zone | `allEntities.filter(e => e.lzStatus === "loaded").length` | entity_status-derived | YES |
| Bronze | `allEntities.filter(e => e.bronzeStatus === "loaded").length` | entity_status-derived | YES |
| Silver | `allEntities.filter(e => e.silverStatus === "loaded").length` | entity_status-derived | YES |
| Full Chain | `allEntities.filter(e => lzStatus==="loaded" && bronzeStatus==="loaded" && silverStatus==="loaded").length` | entity_status-derived | YES |
| Coverage % | `(withLz / totalEntities) * 100` etc. | Derived from above | YES |

### Entity List Table (lines 340-393)

Each row displays:

| Column | Source Field | Correct? |
|--------|------------|----------|
| Entity name | `e.tableName` | YES -- from lz_entities.SourceName |
| Schema | `e.sourceSchema` | YES -- from lz_entities.SourceSchema |
| Source | `resolveSourceLabel(e.source)` | YES -- from datasources.Namespace |
| LZ status | `e.lzStatus` | YES -- entity_status-derived |
| Bronze status | `e.bronzeStatus` | YES -- entity_status-derived |
| Silver status | `e.silverStatus` | YES -- entity_status-derived |
| Gold status | Hardcoded "---" | YES -- Gold not implemented |
| Rows | Hardcoded "---" | YES -- No row count data available |

### Source Filter Buttons (lines 251-255, 313-335)

Source filter derived from `allEntities.forEach(e => { if (e.source) s.add(e.source); })`. Filtering is client-side against the digest data. Correct.

### Entity Search (lines 257-270)

Client-side search against `tableName`, `sourceSchema`, and `source`. No additional API calls. Correct.

### EntityLineageDetail Panel (lines 63-241)

**Table-level lineage (lines 163-208):**

| Field | Source | Correct? |
|-------|--------|----------|
| Available layers | Computed from `entity.lzStatus`, `entity.bronzeStatus`, `entity.silverStatus` | YES |
| LZ Status badge | `entity.lzStatus` | YES -- entity_status-derived |
| Bronze Status badge | `entity.bronzeStatus` | YES -- entity_status-derived |
| Silver Status badge | `entity.silverStatus` | YES -- entity_status-derived |
| LZ last load | `entity.lzLastLoad` | YES -- entity_status.LoadEndDateTime |
| Bronze last load | `entity.bronzeLastLoad` | YES -- entity_status.LoadEndDateTime |
| Silver last load | `entity.silverLastLoad` | YES -- entity_status.LoadEndDateTime |
| Rows | Hardcoded "---" (line 206) | OK -- no row count data available |

**Column-level lineage (lines 70-110, 209-236):**

This feature calls `GET /api/microscope/{entity.id}` to fetch column data per layer.

---

## Bugs Found

### BUG-1: HIGH -- `/api/microscope/{id}` endpoint does not exist

**Severity:** HIGH (column lineage feature is broken)
**Location:** `DataLineage.tsx` line 79

```typescript
const res = await fetch(`/api/microscope/${entity.id}`, { signal: controller.signal });
```

No route handler exists for `/api/microscope/{id}` in any backend route file. When a user clicks "Column Lineage" tab in the detail panel, the fetch returns a 404. The error handling in the component (lines 80-109) catches this and displays `fetchError` = "API returned 404". The user sees "API returned 404" in the column lineage tab.

**Impact:** The "Column Lineage" tab in the entity detail panel is non-functional. The "Table Lineage" tab works correctly because it uses only digest data. The overall page is functional for table-level lineage but the column-level feature is dead.

**Fix needed:** Implement `GET /api/microscope/{id}` that returns per-layer column schema information. Expected response shape (from frontend consumption, lines 85-99):

```json
{
  "source": { "columns": [{ "name": "ColumnA" }, { "name": "ColumnB" }] },
  "landing": { "columns": [{ "name": "ColumnA" }, { "name": "ColumnB" }] },
  "bronze": { "columns": [{ "name": "ColumnA" }, { "name": "HashedPKColumn" }] },
  "silver": { "columns": [{ "name": "ColumnA" }, { "name": "IsDeleted" }, { "name": "IsCurrent" }] }
}
```

### BUG-2: INFO -- Row counts always show dashes

**Severity:** INFO
**Location:** Lines 206 and 385

The "Rows" column in the entity list table and the detail panel always display "---". This is technically correct because there is no row count data available in SQLite (no column in `entity_status` tracks row counts, `engine_task_log` is empty). However, this could confuse users who expect to see row counts.

---

## IsActive-as-Loaded Check

**PASS.** The page correctly uses `entity_status`-derived status fields for all load status checks:

- Line 274: `e.lzStatus === "loaded"` (not `e.isActive`)
- Line 275: `e.bronzeStatus === "loaded"`
- Line 276: `e.silverStatus === "loaded"`
- Line 277: All three statuses for full chain count
- Line 135: `entity.lzStatus === "loaded"` for available layers in detail panel

The `isActive` field from the digest is not referenced anywhere in this page.

---

## Empty Table Check

| Table | Rows | Used By This Page? | Impact |
|-------|------|-------------------|--------|
| `pipeline_lz_entity` | 0 | No | NONE |
| `pipeline_bronze_entity` | 0 | No | NONE |
| `entity_status` | 4,998 | Yes, via entity-digest | CORRECT |
| `lz_entities` | 1,666 | Yes, via entity-digest | CORRECT |
| `bronze_entities` | 1,666 | Yes, via entity-digest | CORRECT |
| `silver_entities` | 1,666 | Yes, via entity-digest | CORRECT |

---

## Design Notes

- The `ColumnLineageRow` component (lines 20-59) has hardcoded knowledge of FMD system columns (`HashedPKColumn`, `HashedNonKeyColumns`, `IsDeleted`, `IsCurrent`, `RecordStartDate`, `RecordEndDate`, `RecordModifiedDate`). It correctly identifies which layer introduces each system column (Bronze for hashed PKs, Silver for SCD2 columns).
- The page correctly shows 5 layers in the lineage chain (Source, Landing, Bronze, Silver, Gold) even though Gold data doesn't exist yet. Gold is always shown as inactive/empty.
- Column lineage includes a "passthrough" vs "computed" classification (line 54) which is correct: source columns pass through all layers, while system columns (hashed PKs, SCD2 fields) are computed at specific layers.

---

## Verdict

**Page Status: PARTIALLY FUNCTIONAL**

The main entity list, KPIs, source filtering, table-level lineage, and status display all work correctly using `entity_status`-derived data from the entity digest. The column-level lineage feature (behind the "Column Lineage" tab in the detail panel) is broken because `/api/microscope/{id}` doesn't exist. This affects approximately 30% of the page's functionality. The remaining 70% is correct and properly sourced.
