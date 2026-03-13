# AUDIT: ValidationChecklist.tsx — Data Source Correctness

**Date**: 2026-03-13
**Page**: `dashboard/app/src/pages/ValidationChecklist.tsx`
**Backend**: `engine/api.py` — `_handle_validation()` (line 1056)
**DB Layer**: `dashboard/app/api/db.py` via `engine/api.py:_db_query()`
**Primary Table**: `entity_status` (PK: LandingzoneEntityId + Layer)

---

## API Calls Made by Frontend

| # | API Call | Trigger | Used For |
|---|----------|---------|----------|
| 1 | `GET /api/engine/validation` | Initial load + 15s auto-refresh | All data: overview, per-layer status, digest, never-attempted, stuck, entity table |
| 2 | `POST /api/engine/start` | "Run Selected" button click | Launch engine run for selected entities |

---

## Route: `GET /api/engine/validation` -> `_handle_validation(handler)`

Route registered at `engine/api.py:341`: `sub_path == "/validation"` dispatches to `_handle_validation(handler)`.

### Response Shape

Backend returns JSON with 8 keys. Frontend expects `ValidationData` interface.

| Response Key | Frontend Type | Match? |
|-------------|---------------|--------|
| `overview` | `SourceOverview[]` | CORRECT |
| `lz_status` | `LayerStatus[]` | CORRECT |
| `bronze_status` | `LayerStatus[]` | CORRECT |
| `silver_status` | `LayerStatus[]` | CORRECT |
| `digest` | `DigestEntry[]` | CORRECT |
| `never_attempted` | `{ EntityId, DataSource, SourceSchema, SourceName }[]` | CORRECT |
| `stuck_at_lz` | `StuckEntry[]` | CORRECT |
| `entities` | `EntityRow[]` | CORRECT |

---

## SQL Query #1: Overview by Source

```sql
SELECT d.Name AS DataSource,
       COUNT(*) AS TotalEntities,
       SUM(CASE WHEN e.IsActive = 1 THEN 1 ELSE 0 END) AS Active,
       SUM(CASE WHEN e.IsActive = 0 THEN 1 ELSE 0 END) AS Inactive
FROM lz_entities e
JOIN datasources d ON e.DataSourceId = d.DataSourceId
GROUP BY d.Name ORDER BY d.Name
```

| Check | Result |
|-------|--------|
| Table: `lz_entities` | CORRECT — source of truth for entity registration |
| Join: `datasources` on `DataSourceId` | CORRECT — FK exists in schema |
| Column: `d.Name AS DataSource` | CORRECT — matches `SourceOverview.DataSource` |
| Column: `COUNT(*) AS TotalEntities` | CORRECT — matches `SourceOverview.TotalEntities` |
| Column: `IsActive` for Active/Inactive | CORRECT — `lz_entities.IsActive` is INTEGER (0/1) |
| Includes inactive entities in total | CORRECT — `TotalEntities` = all, `Active` = active only |

**Frontend usage**: Summary card "Total Active" = `sum(Active)`, "of N registered" = `sum(TotalEntities)`. CORRECT.

**Verified against live data**: 5 sources, 1666 total (all active).

---

## SQL Query #2: LZ Status per Source

```sql
SELECT d.Name AS DataSource,
       SUM(CASE WHEN LOWER(COALESCE(es.Status,'')) IN ('loaded','succeeded') THEN 1 ELSE 0 END) AS LzLoaded,
       SUM(CASE WHEN LOWER(COALESCE(es.Status,'')) IN ('failed','error') THEN 1 ELSE 0 END) AS LzFailed,
       SUM(CASE WHEN NOT ... loaded AND NOT ... failed THEN 1 ELSE 0 END) AS LzNeverAttempted
FROM lz_entities e
JOIN datasources d ON e.DataSourceId = d.DataSourceId
LEFT JOIN entity_status es ON e.LandingzoneEntityId = es.LandingzoneEntityId
    AND LOWER(es.Layer) IN ('landing', 'landingzone')
WHERE e.IsActive = 1
GROUP BY d.Name ORDER BY d.Name
```

| Check | Result |
|-------|--------|
| Table: `entity_status` | CORRECT — single source of truth for load status |
| Join condition: `LandingzoneEntityId` + Layer filter | CORRECT |
| Layer filter: `IN ('landing', 'landingzone')` | CORRECT — handles both seeded data (`'landing'`) and engine-written data (`'LandingZone'` via `LOWER()`) |
| `LOWER(COALESCE(es.Status,''))` | CORRECT — handles NULL (LEFT JOIN miss) and case variations |
| Loaded = `'loaded','succeeded'` | CORRECT — covers both seeded status (`'loaded'`) and engine status (`'Succeeded'` via LOWER) |
| Failed = `'failed','error'` | CORRECT — covers failure variants |
| NeverAttempted = NOT loaded AND NOT failed | CORRECT — catches `'not_started'` and NULL (no row) |
| `WHERE e.IsActive = 1` | CORRECT — only counts active entities |
| Column aliases match frontend | CORRECT — `LzLoaded`, `LzFailed`, `LzNeverAttempted` match `LayerStatus` interface |

**BUG (SEMANTIC)**: `LzNeverAttempted` conflates two different states: (a) entities with no `entity_status` row at all (truly never attempted), and (b) entities with status `'not_started'` (tracked but pending). Both end up in the same bucket. This is functionally acceptable but could mislead operators if they need to distinguish "system doesn't know about this entity" from "system knows but hasn't processed it yet." **Severity: LOW** — current data has all 1666 entities with `landing` rows, so scenario (a) doesn't occur.

**BUG (LABEL)**: Frontend labels `LzFailed` as "Pending" (line 791 in LayerDetail, line 709 in CheckItem). The backend field `LzFailed` counts entities with status `'failed'`/`'error'`, NOT pending entities. If any entity actually fails, the dashboard will display the failure count under the "Pending" label, hiding the failure from operators. **Severity: MEDIUM** — misleading when failures occur.

**Verified against live data**: All 1666 LZ entities show as loaded, 0 failed, 0 never attempted.

---

## SQL Query #3: Bronze Status per Source

Same structure as LZ query but filtered with `LOWER(es.Layer) = 'bronze'`.

| Check | Result |
|-------|--------|
| Layer filter: `= 'bronze'` | CORRECT — matches seeded and engine-written data |
| Column aliases: `BronzeLoaded`, `BronzeFailed`, `BronzeNeverAttempted` | CORRECT |
| All other logic | Same as LZ — CORRECT |

**Same SEMANTIC and LABEL bugs apply** (BronzeFailed displayed as "Pending").

**Verified against live data**: 208 bronze loaded across sources, 0 failed, 1458 never attempted.

---

## SQL Query #4: Silver Status per Source

Same structure but filtered with `LOWER(es.Layer) = 'silver'`.

| Check | Result |
|-------|--------|
| Layer filter: `= 'silver'` | CORRECT |
| Column aliases: `SilverLoaded`, `SilverFailed`, `SilverNeverAttempted` | CORRECT |
| All other logic | Same as LZ — CORRECT |

**Same SEMANTIC and LABEL bugs apply** (SilverFailed displayed as "Pending").

**Verified against live data**: 0 silver loaded, 0 failed, 1666 never attempted (all `not_started`).

---

## SQL Query #5: Digest (Overall per-entity status)

```sql
WITH entity_layers AS (
    SELECT e.LandingzoneEntityId,
           MAX(CASE WHEN LOWER(es.Layer) IN ('landing','landingzone')
                     AND ... loaded ... THEN 1 ELSE 0 END) AS lz_ok,
           MAX(CASE WHEN LOWER(es.Layer) = 'bronze' AND ... loaded ... THEN 1 ELSE 0 END) AS brz_ok,
           MAX(CASE WHEN LOWER(es.Layer) = 'silver' AND ... loaded ... THEN 1 ELSE 0 END) AS slv_ok
    FROM lz_entities e LEFT JOIN entity_status es ON ...
    WHERE e.IsActive = 1 GROUP BY e.LandingzoneEntityId
)
SELECT CASE
    WHEN lz_ok=1 AND brz_ok=1 AND slv_ok=1 THEN 'complete'
    WHEN lz_ok=1 OR brz_ok=1 OR slv_ok=1 THEN 'partial'
    ELSE 'not_started'
END AS OverallStatus, COUNT(*) AS EntityCount
FROM entity_layers GROUP BY OverallStatus
```

| Check | Result |
|-------|--------|
| CTE groups by `LandingzoneEntityId` | CORRECT — one row per entity |
| LEFT JOIN on `entity_status` (no layer filter) | CORRECT — picks up all layers per entity |
| `MAX(CASE ...)` per layer | CORRECT — handles multiple rows per entity from entity_status |
| Classification logic | CORRECT — complete=all 3 loaded, partial=at least 1 loaded, not_started=none loaded |
| Column aliases: `OverallStatus`, `EntityCount` | CORRECT — matches `DigestEntry` interface |

**Frontend usage**: Progress bar shows complete/partial/not_started. `digestComplete` found via `data.digest.find(d => d.OverallStatus === "complete")`. CORRECT.

**Verified against live data**: 1666 partial (LZ loaded, silver not loaded), 0 complete, 0 not_started.

---

## SQL Query #6: Never-Attempted Entities

```sql
SELECT e.LandingzoneEntityId AS EntityId, d.Name AS DataSource,
       e.SourceSchema, e.SourceName
FROM lz_entities e JOIN datasources d ON ...
LEFT JOIN entity_status es ON ... AND LOWER(es.Layer) IN ('landing','landingzone')
WHERE e.IsActive = 1 AND es.LandingzoneEntityId IS NULL
ORDER BY d.Name, e.SourceSchema, e.SourceName LIMIT 50
```

| Check | Result |
|-------|--------|
| Correctly finds entities with NO `entity_status` landing row | CORRECT — `LEFT JOIN ... WHERE es.LandingzoneEntityId IS NULL` |
| Column aliases match `never_attempted` type | CORRECT |
| LIMIT 50 | NOTED — silently truncates; no frontend warning |

**NOTE**: The `never_attempted` array is defined in the `ValidationData` interface but **never referenced** in the component render code. It is dead data — returned by the API but not displayed anywhere on the page. No correctness issue, but wasted bandwidth.

**Verified against live data**: 0 rows (all entities have landing status rows).

---

## SQL Query #7: Stuck at LZ

```sql
SELECT d.Name AS DataSource, COUNT(DISTINCT e.LandingzoneEntityId) AS StuckCount
FROM lz_entities e JOIN datasources d ON ...
JOIN entity_status es_lz ON ... AND LOWER(es_lz.Layer) IN ('landing','landingzone')
    AND ... loaded ...
LEFT JOIN entity_status es_brz ON ... AND LOWER(es_brz.Layer) = 'bronze'
    AND ... loaded ...
WHERE e.IsActive = 1 AND es_brz.LandingzoneEntityId IS NULL
GROUP BY d.Name ORDER BY d.Name
```

| Check | Result |
|-------|--------|
| INNER JOIN on loaded LZ status | CORRECT — only entities with successful LZ load |
| LEFT JOIN on loaded Bronze status | CORRECT — checks if bronze was also loaded |
| WHERE `es_brz.LandingzoneEntityId IS NULL` | CORRECT — no bronze loaded = stuck at LZ |
| Column aliases: `DataSource`, `StuckCount` | CORRECT — matches `StuckEntry` interface |

**Frontend usage**: Displayed in expanded source detail ("N entities stuck at LZ") and in checklist item. CORRECT.

**Verified against live data**: 1458 stuck (1666 LZ loaded - 208 bronze loaded).

---

## SQL Query #8: Per-Entity Layer Status

```sql
SELECT e.LandingzoneEntityId AS EntityId, d.Name AS DataSource,
       e.SourceSchema, e.SourceName, e.IsIncremental,
       CASE WHEN ...loaded(es_lz)... THEN 1
            WHEN ...failed(es_lz)... THEN 0
            ELSE -1 END AS LzStatus,
       CASE WHEN ...loaded(es_brz)... THEN 1
            WHEN ...failed(es_brz)... THEN 0
            ELSE -1 END AS BronzeStatus,
       CASE WHEN ...loaded(es_slv)... THEN 1
            WHEN ...failed(es_slv)... THEN 0
            ELSE -1 END AS SilverStatus
FROM lz_entities e JOIN datasources d ON ...
LEFT JOIN entity_status es_lz ON ... AND LOWER(es_lz.Layer) IN ('landing','landingzone')
LEFT JOIN entity_status es_brz ON ... AND LOWER(es_brz.Layer) = 'bronze'
LEFT JOIN entity_status es_slv ON ... AND LOWER(es_slv.Layer) = 'silver'
WHERE e.IsActive = 1
ORDER BY d.Name, e.SourceSchema, e.SourceName
```

| Check | Result |
|-------|--------|
| Three LEFT JOINs on entity_status (one per layer) | CORRECT |
| Status encoding: 1=loaded, 0=failed, -1=never | CORRECT — matches `EntityRow` interface comment |
| Column aliases match `EntityRow` interface | CORRECT — EntityId, DataSource, SourceSchema, SourceName, IsIncremental, LzStatus, BronzeStatus, SilverStatus |
| `WHERE e.IsActive = 1` | CORRECT — only active entities |
| No LIMIT clause | CORRECT — returns all entities (frontend truncates to 200 for display) |
| `_safe_row()` preserves int types | CORRECT — EntityId, LzStatus etc. are ints, passed through unchanged |

**Frontend usage**: Entity table with checkboxes, filtered by source/layer/search. Status icons via `layerCellStatus()`: 1=pass(green), 0=warn(amber), -1=fail(red). CORRECT mapping.

**Verified against live data**: 1666 entities returned. Status combos: 1458 with (LZ=1, Bronze=-1, Silver=-1), 208 with (LZ=1, Bronze=1, Silver=-1).

---

## Frontend Type Interfaces vs Actual Response Shape

| Interface | Field | Backend Source | Type Match? |
|-----------|-------|---------------|-------------|
| `SourceOverview.DataSource` | `d.Name` (string) | CORRECT |
| `SourceOverview.TotalEntities` | `COUNT(*)` (int) | CORRECT |
| `SourceOverview.Active` | `SUM(CASE...)` (int) | CORRECT |
| `SourceOverview.Inactive` | `SUM(CASE...)` (int) | CORRECT |
| `LayerStatus.DataSource` | `d.Name` (string) | CORRECT |
| `LayerStatus.LzLoaded` | `SUM(CASE...)` (int) | CORRECT |
| `LayerStatus.LzFailed` | `SUM(CASE...)` (int) | CORRECT |
| `LayerStatus.LzNeverAttempted` | `SUM(CASE...)` (int) | CORRECT |
| `DigestEntry.OverallStatus` | CASE expression (string) | CORRECT |
| `DigestEntry.EntityCount` | `COUNT(*)` (int) | CORRECT |
| `StuckEntry.DataSource` | `d.Name` (string) | CORRECT |
| `StuckEntry.StuckCount` | `COUNT(DISTINCT ...)` (int) | CORRECT |
| `EntityRow.EntityId` | `LandingzoneEntityId` (int) | CORRECT |
| `EntityRow.IsIncremental` | `lz_entities.IsIncremental` (int 0/1) | CORRECT — frontend type `boolean \| number` handles both |
| `EntityRow.LzStatus` | CASE (int 1/0/-1) | CORRECT |
| `EntityRow.BronzeStatus` | CASE (int 1/0/-1) | CORRECT |
| `EntityRow.SilverStatus` | CASE (int 1/0/-1) | CORRECT |

---

## Entity Selection + Engine Launch

| Check | Result |
|-------|--------|
| `EntityId` = `LandingzoneEntityId` | CORRECT — engine `run()` accepts LandingzoneEntityId values |
| POST body: `{ layers, mode, entity_ids }` | CORRECT — matches `_handle_start()` expectations |
| Response: `{ run_id, status }` | CORRECT — frontend reads `result.run_id` |

---

## Layer Value Compatibility Matrix

The `entity_status.Layer` column stores different values depending on the writer:

| Writer | LZ Layer Value | Bronze Value | Silver Value |
|--------|---------------|--------------|--------------|
| Seed/sync data (current DB) | `'landing'` | `'bronze'` | `'silver'` |
| Engine `logging_db.py` | `'LandingZone'` | `'bronze'` | `'silver'` |
| Fabric notebook | `'landingzone'` | `'bronze'` | `'silver'` |

The queries use `LOWER(es.Layer) IN ('landing', 'landingzone')` for LZ, which handles all three variants. Bronze and Silver queries use `LOWER(es.Layer) = 'bronze'` and `= 'silver'`, which also handles case variations. **CORRECT — all writers covered.**

---

## Status Value Compatibility Matrix

| Writer | Success Value | Failure Value | Pending Value |
|--------|--------------|---------------|---------------|
| Seed data | `'loaded'` | N/A | `'not_started'` |
| Engine `logging_db.py` | `'Succeeded'` | `'failed'` | N/A |
| Fabric notebook | `'loaded'` | `'not_started'` | `'not_started'` |

The queries use `LOWER() IN ('loaded','succeeded')` for loaded and `LOWER() IN ('failed','error')` for failed. **CORRECT — all variants covered.**

---

## Summary of Findings

| # | Finding | Severity | Type |
|---|---------|----------|------|
| 1 | `LzFailed`/`BronzeFailed`/`SilverFailed` labeled "Pending" in UI but contains FAILED entity count | MEDIUM | Label mismatch — operators will not see failure counts when they occur |
| 2 | `never_attempted` response field is never used by the frontend — dead data, wasted query + bandwidth | LOW | Dead code |
| 3 | `never_attempted` query has `LIMIT 50` with no indication to the frontend that results are truncated | LOW | Silent truncation |
| 4 | `LzNeverAttempted` conflates "no entity_status row" with "status = not_started" | LOW | Semantic ambiguity (functionally correct) |
| 5 | `LayerStatus` TypeScript interface is over-broad (all 9 optional fields for all 3 layer types) | LOW | Type hygiene — not a data bug |

### Overall Verdict: CORRECT (data source queries are accurate)

All 8 SQL queries target the correct tables and columns. All JOIN conditions are valid. All column aliases match frontend interface expectations. The status encoding (1/0/-1) is consistent between backend and frontend. Layer value case variations are properly handled via `LOWER()`. The entity selection + launch flow correctly passes `LandingzoneEntityId` values to the engine.

The only actionable issue is **Finding #1**: rename "Pending" to "Failed" in the `LayerDetail` component and the checklist detail string, or split `LzFailed` into separate `LzFailed` + `LzPending` counts.
