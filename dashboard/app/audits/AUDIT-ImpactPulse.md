# AUDIT: ImpactPulse.tsx

**Audited:** 2026-03-13
**Page:** `dashboard/app/src/pages/ImpactPulse.tsx` (~849 lines)
**Backend:** `dashboard/app/api/routes/entities.py` (entity-digest), `dashboard/app/api/routes/monitoring.py` (live-monitor)

---

## Data Flow Trace

### API Calls

| # | Frontend Call | Backend Route | SQL / Data Source | Status |
|---|-------------|---------------|-------------------|--------|
| 1 | `GET /api/entity-digest` | `get_entity_digest()` in `entities.py` | `lz_entities` JOIN `datasources` JOIN `connections` + `entity_status` + `bronze_entities` + `silver_entities` | CORRECT |
| 2 | `GET /api/live-monitor?minutes=30` | `get_live_monitor()` in `monitoring.py` | `pipeline_audit` + `engine_task_log` + `copy_activity_audit` + `pipeline_bronze_entity` + `pipeline_lz_entity` + entity counts | PARTIAL ISSUES |

---

## Metric-by-Metric Trace

### Entity Digest (Primary Data Source)

The page uses `useEntityDigest()` hook which calls `GET /api/entity-digest`. The backend implementation in `_build_sqlite_entity_digest()` (entities.py, lines 66-231) is **correct**:

| Frontend Field | Backend Source | Correct? |
|----------------|---------------|----------|
| `allEntities[].lzStatus` | `entity_status` WHERE `(LandingzoneEntityId, 'LandingZone')` | YES -- uses entity_status, not IsActive |
| `allEntities[].bronzeStatus` | `entity_status` WHERE `(LandingzoneEntityId, 'Bronze')` | YES -- uses entity_status |
| `allEntities[].silverStatus` | `entity_status` WHERE `(LandingzoneEntityId, 'Silver')` | YES -- uses entity_status |
| `allEntities[].overall` | Computed from 3 layer statuses | YES -- correct logic |
| `allEntities[].bronzeId` | `bronze_entities.BronzeLayerEntityId` via `bronze_by_lz` lookup | YES |
| `allEntities[].silverId` | `silver_entities.SilverLayerEntityId` via `silver_by_bronze` lookup | YES |
| `allEntities[].lastError` | `entity_status.ErrorMessage` for most recent error layer | YES |
| `sourceList[].summary` | Backend `statusCounts`, normalized by `useEntityDigest` hook | YES |

### Layer Stats (Frontend Computation)

`computeLayerStats()` (lines 144-177) correctly derives per-layer totals from the digest data:

| Stat | Computation | Correct? |
|------|-------------|----------|
| `lz.total` | Count of all entities | YES -- every entity has an LZ registration |
| `lz.loaded` | Count where `e.lzStatus === "loaded"` | YES -- uses entity_status-derived status |
| `bronze.total` | Count where `e.bronzeId !== null` | YES -- checks registration existence |
| `bronze.loaded` | Count where `e.bronzeStatus === "loaded"` | YES |
| `silver.total` | Count where `e.silverId !== null` | YES |
| `silver.loaded` | Count where `e.silverStatus === "loaded"` | YES |
| `gold.total` | Always 0 (no gold layer data) | YES -- correct, Gold not implemented |
| `*.error` | Count where `e.lastError?.layer === layerName` | YES |

### React Flow Nodes

| Node | Data Source | `entityCount` | `loadedCount` | `errorCount` | Correct? |
|------|-----------|---------------|---------------|--------------|----------|
| Source nodes | `sourceList[].summary` | `.total` | `.complete + .partial` | `.error` | YES |
| LZ node | `layerStats.lz` | `.total` | `.loaded` | `.error` | YES |
| Bronze node | `layerStats.bronze` | `.total` | `.loaded` | `.error` | YES |
| Silver node | `layerStats.silver` | `.total` | `.loaded` | `.error` | YES |
| Gold node | `layerStats.gold` | `.total` (=0) | `.loaded` (=0) | `.error` (=0) | YES -- placeholder |

### React Flow Edges

| Edge | `entityCount` | `isActive` | Correct? |
|------|--------------|-----------|----------|
| Source -> LZ | `src.summary.total` | Live event detection | YES |
| LZ -> Bronze | `layerStats.bronze.total` | `layerActivity.bronze` | YES |
| Bronze -> Silver | `layerStats.silver.total` | `layerActivity.silver` | YES |
| Silver -> Gold | `layerStats.gold.total` (=0) | `layerActivity.gold` | YES -- edge won't render if value=0 |

---

## Live Monitor Data

| Frontend Field | Backend Query | Issues |
|----------------|---------------|--------|
| `pipelineEvents` | `SELECT ... FROM pipeline_audit ORDER BY LogDateTime DESC LIMIT 50` | OK -- 4 rows exist |
| `notebookEvents` | `SELECT ... FROM engine_task_log ORDER BY created_at DESC LIMIT 200` | MINOR -- 0 rows, table empty |
| `copyEvents` | `SELECT ... FROM copy_activity_audit ORDER BY LogDateTime DESC LIMIT 100` | MINOR -- 0 rows, table empty |
| `counts.lzProcessed` | `entity_status WHERE LOWER(Status) IN ('succeeded','loaded') GROUP BY LOWER(Layer)` | CORRECT -- uses entity_status |
| `counts.brzProcessed` | Same query, filtered to 'bronze' | CORRECT |
| `counts.slvProcessed` | Same query, filtered to 'silver' | CORRECT |
| `bronzeEntities` | `SELECT ... FROM pipeline_bronze_entity ORDER BY InsertDateTime DESC LIMIT 20` | **BUG** -- table is EMPTY (0 rows) |
| `lzEntities` | `SELECT ... FROM pipeline_lz_entity ORDER BY InsertDateTime DESC LIMIT 20` | **BUG** -- table is EMPTY (0 rows) |

---

## Bugs Found

### BUG-1: LOW -- Live monitor queries empty pipeline_*_entity tables

**Severity:** LOW (data is supplementary for the slide-out drawer activity feed)
**Location:** `monitoring.py` lines 111-124

The `/api/live-monitor` endpoint queries `pipeline_bronze_entity` and `pipeline_lz_entity` for "recently processed" entities. Both tables have 0 rows and have never been populated. These results feed into `liveData.bronzeEntities` and `liveData.lzEntities` on the frontend, but ImpactPulse.tsx does not directly consume those fields -- it only uses `pipelineEvents`, `notebookEvents`, and `copyEvents` for the live activity overlay.

**Impact on ImpactPulse:** None directly. The empty tables don't affect the page's primary visualization. The live activity detection still works via `pipeline_audit` events.

### BUG-2: INFO -- engine_task_log and copy_activity_audit are empty

**Severity:** INFO
**Tables:** `engine_task_log` (0 rows), `copy_activity_audit` (0 rows)

The live monitor queries these tables for notebook and copy events. Both are empty, meaning the live activity detection in `isLayerActive()` (line 180) only has `pipeline_audit` data (4 rows) to work with. The animated edges and "active" node glow will rarely trigger because there's minimal event data.

**Impact:** The page renders correctly but appears static (no animated activity pulses) because the event tables are nearly empty.

---

## IsActive-as-Loaded Check

**PASS.** ImpactPulse correctly uses `entity_status`-derived status fields (`lzStatus`, `bronzeStatus`, `silverStatus`) from the entity digest, not `IsActive` flags. The `computeLayerStats()` function checks `e.lzStatus === "loaded"`, not `e.isActive`.

The `isActive` field on `DigestEntity` does exist and is used only for the node `isActive` prop for animation purposes (detecting live pipeline activity via events), which is a different concept from "loaded status."

---

## Empty Table Check

| Table | Rows | Used By This Page? | Impact |
|-------|------|-------------------|--------|
| `pipeline_lz_entity` | 0 | Indirectly via live-monitor (not consumed) | NONE |
| `pipeline_bronze_entity` | 0 | Indirectly via live-monitor (not consumed) | NONE |
| `copy_activity_audit` | 0 | Yes, for live activity detection | LOW -- no copy events shown |
| `engine_task_log` | 0 | Yes, for live activity detection | LOW -- no notebook events shown |
| `entity_status` | 4,998 | Yes, via entity-digest | CORRECT -- primary status source |

---

## Verdict

**Page Status: FUNCTIONAL -- data sources are correct**

ImpactPulse is one of the cleanest pages in the dashboard. It uses `useEntityDigest()` as its primary data source, which correctly reads from `entity_status` for load status. The live monitor overlay is limited by empty event tables but degrades gracefully. No IsActive-as-loaded bugs. No queries against empty pipeline_*_entity tables for core functionality.
