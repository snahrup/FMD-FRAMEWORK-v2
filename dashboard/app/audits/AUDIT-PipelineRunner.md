# Audit: PipelineRunner.tsx

**Audited**: 2026-03-13
**Page**: `dashboard/app/src/pages/PipelineRunner.tsx`
**Backend**: `dashboard/app/api/routes/pipeline.py` (runner/* routes)
**Database**: SQLite at `dashboard/app/api/fmd_control_plane.db`

---

## API Calls Traced

The PipelineRunner page makes the following API calls:

| # | Frontend Call | Backend Route | Handler |
|---|---|---|---|
| 1 | `GET /api/runner/sources` | `@route("GET", "/api/runner/sources")` | `get_runner_sources()` |
| 2 | `GET /api/runner/entities?dataSourceId={id}` | `@route("GET", "/api/runner/entities")` | `get_runner_entities()` |
| 3 | `GET /api/runner/state` | `@route("GET", "/api/runner/state")` | `get_runner_state()` |
| 4 | `POST /api/runner/prepare` | `@route("POST", "/api/runner/prepare")` | `post_runner_prepare()` |
| 5 | `POST /api/runner/trigger` | `@route("POST", "/api/runner/trigger")` | `post_runner_trigger()` |
| 6 | `POST /api/runner/restore` | `@route("POST", "/api/runner/restore")` | `post_runner_restore()` |

---

## Data Points Verified

### 1. Source System List with Entity Counts per Layer

**Frontend**: `GET /api/runner/sources` -> `RunnerSource[]` with `entities.landing.{total,active}`, `entities.bronze.{total,active}`, `entities.silver.{total,active}`

**Backend SQL** (`get_runner_sources`):

| Sub-query | SQL | Table(s) | Status |
|---|---|---|---|
| Data sources | `SELECT DataSourceId, Name, DisplayName, ConnectionId, IsActive FROM datasources ORDER BY DataSourceId` | `datasources` | **CORRECT** |
| Connections | `SELECT ConnectionId, Name, DisplayName FROM connections` | `connections` | **CORRECT** |
| LZ counts | `SELECT DataSourceId, COUNT(*), SUM(CASE WHEN IsActive=1 THEN 1 ELSE 0 END) FROM lz_entities GROUP BY DataSourceId` | `lz_entities` | **CORRECT** |
| Bronze counts | `SELECT le.DataSourceId, COUNT(*), SUM(CASE WHEN be.IsActive=1 ...) FROM bronze_entities be JOIN lz_entities le ON be.LandingzoneEntityId = le.LandingzoneEntityId GROUP BY le.DataSourceId` | `bronze_entities` JOIN `lz_entities` | **CORRECT** |
| Silver counts | `SELECT le.DataSourceId, COUNT(*), SUM(CASE WHEN se.IsActive=1 ...) FROM silver_entities se JOIN bronze_entities be ON se.BronzeLayerEntityId = be.BronzeLayerEntityId JOIN lz_entities le ON be.LandingzoneEntityId = le.LandingzoneEntityId GROUP BY le.DataSourceId` | `silver_entities` JOIN `bronze_entities` JOIN `lz_entities` | **CORRECT** |

**Verdict**: **CORRECT** -- All three layer counts use the correct entity tables (`lz_entities`, `bronze_entities`, `silver_entities`) with proper joins. Does NOT use the empty `pipeline_lz_entity` or `pipeline_bronze_entity` tables. The `datasources` and `connections` tables are queried with the correct columns.

---

### 2. Entity List with Layer Status (Entity Drill-Down)

**Frontend**: `GET /api/runner/entities?dataSourceId={id}` -> `RunnerEntity[]`

**Expected by frontend (RunnerEntity interface)**:
- `lzEntityId`, `sourceSchema`, `sourceName`, `namespace`
- `isIncremental`, `incrementalColumn`
- `lzActive`
- `bronzeEntityId`, `bronzeActive`, `primaryKeys`
- `silverEntityId`, `silverActive`

**Backend SQL** (`get_runner_entities`):
```sql
SELECT le.LandingzoneEntityId, le.DataSourceId, le.SourceSchema, le.SourceName,
       le.FileName, le.FilePath, le.FileType, le.IsActive, le.IsIncremental, le.IsIncrementalColumn
FROM lz_entities le
WHERE le.DataSourceId = ?
ORDER BY le.SourceName
```

**Verdict**: **WRONG -- Missing bronze/silver entity data**

The backend only queries `lz_entities` and returns raw column names (`LandingzoneEntityId`, `IsActive`, etc.) without any bronze or silver join. The frontend expects:

| Frontend Field | Backend Returns | Problem |
|---|---|---|
| `lzEntityId` | `LandingzoneEntityId` | **WRONG** -- Key mismatch. Backend returns `LandingzoneEntityId`, frontend reads `lzEntityId`. Will be `undefined`. |
| `sourceSchema` | `SourceSchema` | **WRONG** -- Case mismatch. Backend returns `SourceSchema`, frontend reads `sourceSchema`. Will be `undefined`. |
| `sourceName` | `SourceName` | **WRONG** -- Case mismatch. Will be `undefined`. |
| `namespace` | Not returned | **WRONG** -- Not in query. Always `undefined`. |
| `isIncremental` | `IsIncremental` | **WRONG** -- Case mismatch. Will be `undefined`. |
| `incrementalColumn` | `IsIncrementalColumn` | **WRONG** -- Case mismatch AND name mismatch. Will be `undefined`. |
| `lzActive` | `IsActive` | **WRONG** -- Case mismatch. Will be `undefined`. |
| `bronzeEntityId` | Not returned | **WRONG** -- No bronze join at all. Always `undefined`. |
| `bronzeActive` | Not returned | **WRONG** -- No bronze join. Always `undefined`. |
| `primaryKeys` | Not returned | **WRONG** -- No bronze join. Always `undefined`. |
| `silverEntityId` | Not returned | **WRONG** -- No silver join. Always `undefined`. |
| `silverActive` | Not returned | **WRONG** -- No silver join. Always `undefined`. |

**Impact**: The entity table in "Pick Specific Entities" mode will show:
- Entity names: **BLANK** (sourceName is undefined due to case mismatch)
- Schema column: **BLANK**
- Incremental column: Always shows "Full" (isIncremental is undefined, falsy)
- LZ status: Always shows X (lzActive is undefined)
- Bronze status: Always shows dash (bronzeEntityId is null)
- Silver status: Always shows dash (silverEntityId is null)
- Entity selection works by `lzEntityId` which is `undefined`, so **toggling/selecting entities is broken**

**Required fix**: The backend must:
1. JOIN `bronze_entities` and `silver_entities`
2. Return camelCase keys matching the frontend interface, OR the frontend must use PascalCase keys

---

### 3. Source Card Layer Counts Display

**Frontend**: `SourceCard` component renders `source.entities.landing.active`, `source.entities.bronze.active`, `source.entities.silver.active`

**Backend**: These come from the `/runner/sources` endpoint (verified correct in #1 above).

**Verdict**: **CORRECT** -- The backend correctly builds the nested `entities.landing.active` / `entities.bronze.active` / `entities.silver.active` structure with camelCase keys.

---

### 4. Runner State (Persisted Scope)

**Frontend**: `GET /api/runner/state` -> `RunnerState`

**Backend**: Reads from `_runner_state` dict (persisted to `.runner_state.json` file). No SQL involved.

**Verdict**: **CORRECT** -- This is purely in-memory/file state, no database dependency.

---

### 5. Prepare Scope (POST /api/runner/prepare)

**Frontend sends**: `{ dataSourceIds: number[], layer: string, entityIds?: number[] }`

**Backend behavior**: Sets `_runner_state` with the selections. **Does NOT actually deactivate entities in the database.** The `deactivated` field is always `{"lz": [], "bronze": [], "silver": []}` and `affected` is always `{"lz": 0, "bronze": 0, "silver": 0}`, `kept` is always `{"lz": 0, "bronze": 0, "silver": 0}`.

**Verdict**: **WRONG -- Prepare is a no-op**

The prepare endpoint is supposed to:
1. Identify which entities to keep active (in-scope) vs deactivate (out-of-scope)
2. Actually UPDATE `lz_entities.IsActive`, `bronze_entities.IsActive`, `silver_entities.IsActive` in SQLite
3. Record the deactivated entity IDs so restore can re-activate them

Instead it just saves state metadata with zero counts. The entire "safe scoped execution" promise is hollow -- **all entities remain active**, meaning the pipeline processes everything regardless of what the user selected.

---

### 6. Trigger Pipeline (POST /api/runner/trigger)

**Frontend sends**: `{ pipelineName: string }`

**Backend SQL**:
```sql
SELECT PipelineGuid, WorkspaceGuid, Name FROM pipelines WHERE Name = ? AND IsActive = 1 ORDER BY PipelineId LIMIT 1
SELECT WorkspaceGuid, Name FROM workspaces
```

**Verdict**: **CORRECT** -- Uses `pipelines` and `workspaces` tables with correct columns. Triggers via Fabric REST API.

---

### 7. Restore Scope (POST /api/runner/restore)

**Frontend**: Calls `POST /api/runner/restore` which should re-activate deactivated entities.

**Backend behavior**: Simply resets `_runner_state` to `{"active": False}`. **Does NOT run any SQL UPDATE** to restore entity IsActive flags.

**Verdict**: **WRONG -- Restore is a no-op**

This is consistent with prepare being a no-op -- since nothing was deactivated, nothing needs restoring. But the frontend displays:
- "Entities In Scope: 0 LZ, 0 Bronze, 0 Silver" (always zero)
- "Temporarily Deactivated: 0 LZ, 0 Bronze, 0 Silver" (always zero)

The user sees zeros where they should see actual entity counts.

---

### 8. Review Step Entity Count Display

**Frontend**: On the review step, entity counts shown per source come from `s.entities[selectedLayer].active` (from the sources response).

**Verdict**: **CORRECT** -- This pulls from the `/runner/sources` data which is correctly computed.

---

### 9. Pipeline Name Mapping

**Frontend**: Maps layer choice to pipeline name via `layerConfig`:
- `landing` -> `PL_FMD_LOAD_LANDINGZONE`
- `bronze` -> `PL_FMD_LOAD_LANDING_BRONZE`
- `silver` -> `PL_FMD_LOAD_BRONZE_SILVER`
- `full` -> `PL_FMD_LOAD_ALL`

**Backend**: Looks up by `Name` in `pipelines` table.

**Verdict**: **CORRECT** -- Pipeline names match what's in the `pipelines` table (6 rows).

---

### 10. Does It Reference Empty pipeline_*_entity Tables?

**Frontend**: No direct references to `pipeline_lz_entity` or `pipeline_bronze_entity`.

**Backend routes used by PipelineRunner**: The runner/* routes do NOT query `pipeline_lz_entity` or `pipeline_bronze_entity`.

**Note**: Other routes in the same file DO reference them:
- `get_bronze_view()` queries `pipeline_bronze_entity` (0 rows -- will always return empty)
- These are NOT called by PipelineRunner.tsx.

**Verdict**: **CORRECT** -- PipelineRunner itself does not use the empty pipeline execution tracking tables.

---

## Backend Issues Summary

### BUG-1: Entity List Returns Wrong Column Names (CRITICAL)

**File**: `dashboard/app/api/routes/pipeline.py`, line 553-561
**Route**: `GET /api/runner/entities`

The backend returns PascalCase column names from SQLite (`LandingzoneEntityId`, `SourceSchema`, `SourceName`, `IsActive`, etc.) but the frontend expects camelCase (`lzEntityId`, `sourceSchema`, `sourceName`, `lzActive`). Additionally, bronze and silver entity data is completely missing -- no JOINs to `bronze_entities` or `silver_entities`.

**Fix needed**: Rewrite the query to JOIN bronze/silver tables and alias columns to camelCase:
```sql
SELECT
    le.LandingzoneEntityId AS lzEntityId,
    le.SourceSchema AS sourceSchema,
    le.SourceName AS sourceName,
    le.FileName AS namespace,
    le.IsIncremental AS isIncremental,
    le.IsIncrementalColumn AS incrementalColumn,
    le.IsActive AS lzActive,
    be.BronzeLayerEntityId AS bronzeEntityId,
    be.IsActive AS bronzeActive,
    be.PrimaryKeys AS primaryKeys,
    se.SilverLayerEntityId AS silverEntityId,
    se.IsActive AS silverActive
FROM lz_entities le
LEFT JOIN bronze_entities be ON be.LandingzoneEntityId = le.LandingzoneEntityId
LEFT JOIN silver_entities se ON se.BronzeLayerEntityId = be.BronzeLayerEntityId
WHERE le.DataSourceId = ?
ORDER BY le.SourceName
```

### BUG-2: Prepare Is a No-Op -- No Entity Deactivation (CRITICAL)

**File**: `dashboard/app/api/routes/pipeline.py`, lines 570-596
**Route**: `POST /api/runner/prepare`

The handler records the scope in memory/file but never runs SQL to deactivate out-of-scope entities. The `kept`, `affected`, and `deactivated` fields are always zero/empty. This means the "scoped run" feature does nothing -- all entities remain active and the pipeline processes everything.

### BUG-3: Restore Is a No-Op -- No Entity Reactivation (MODERATE)

**File**: `dashboard/app/api/routes/pipeline.py`, lines 616-624
**Route**: `POST /api/runner/restore`

The handler resets in-memory state but never runs SQL to re-activate entities. Consistent with BUG-2 (since nothing was deactivated). Once BUG-2 is fixed, this must also be fixed to restore the deactivated entity IDs.

### BUG-4: Running State Shows All Zeros (MODERATE)

**File**: `dashboard/app/api/routes/pipeline.py`, lines 583-594

On the "Scoped Run Active" screen (step=running), the UI displays:
- "Entities In Scope: 0 LZ, 0 Bronze, 0 Silver"
- "Temporarily Deactivated: 0 LZ, 0 Bronze, 0 Silver"

These are always zero because `post_runner_prepare` hardcodes them to 0 instead of computing actual counts.

---

## Summary

| Category | Count |
|---|---|
| Data points checked | 10 |
| CORRECT | 7 |
| WRONG | 3 (covering 4 bugs) |
| Uses empty pipeline_*_entity tables? | No |

**Critical issues**: The entity drill-down table is completely broken due to column name mismatches and missing JOINs (BUG-1). The entire "scoped execution" feature (prepare/restore) is non-functional -- it's UI-only theater with no actual database mutations (BUG-2, BUG-3, BUG-4).

**What works correctly**: Source list with per-layer entity counts, runner state persistence, pipeline triggering, pipeline name mapping, and the review step display all pull from the correct tables with correct columns.
