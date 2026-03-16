# AUDIT: ExecutiveDashboard.tsx

**Audited:** 2026-03-13
**Page:** `dashboard/app/src/pages/ExecutiveDashboard.tsx` (~764 lines)
**Backend:** No dedicated backend endpoint exists

---

## Data Flow Trace

### API Calls

| # | Frontend Call | Backend Route | SQL / Data Source | Status |
|---|-------------|---------------|-------------------|--------|
| 1 | `GET /api/executive` | **DOES NOT EXIST** | N/A | BROKEN |

The page fetches a single monolithic endpoint at `GET /api/executive` (line 434). This endpoint has **never been implemented** in any route file or in `server.py`. Every request returns a 404, so the page always displays the error state ("Could not load dashboard data").

---

## Metrics Consumed (Expected from `/api/executive`)

Based on the `ExecData` TypeScript interface (lines 89-117), the page expects:

| Metric | Expected Field | Correct Source Table(s) | Status |
|--------|---------------|------------------------|--------|
| Total entities | `overview.totalEntities` | `lz_entities` COUNT | UNAVAILABLE |
| Data sources count | `dataSources` | `datasources` COUNT | UNAVAILABLE |
| LZ loaded / total / completion | `overview.layers.landing.{loaded,total,completion}` | `entity_status` WHERE Layer='LandingZone' AND Status='loaded' / `lz_entities` COUNT | UNAVAILABLE |
| Bronze loaded / total / completion | `overview.layers.bronze.{loaded,total,completion}` | `entity_status` WHERE Layer='Bronze' AND Status='loaded' / `bronze_entities` COUNT | UNAVAILABLE |
| Silver loaded / total / completion | `overview.layers.silver.{loaded,total,completion}` | `entity_status` WHERE Layer='Silver' AND Status='loaded' / `silver_entities` COUNT | UNAVAILABLE |
| Row counts (bronze/silver/landing) | `overview.rowCounts` | No local row count data available | UNAVAILABLE |
| Per-source layer breakdown | `sources[].layers.{landing,bronze,silver}.{count,total,loaded,completion}` | Would need entity_status JOINed with lz/bronze/silver entities grouped by Namespace | UNAVAILABLE |
| Pipeline health | `pipelineHealth.{totalRuns,succeeded,failed,running,successRate}` | `pipeline_audit` grouped by PipelineRunGuid | UNAVAILABLE |
| Recent activity | `recentActivity[]` | `pipeline_audit` recent rows | UNAVAILABLE |
| Issues | `issues[]` | `pipeline_audit` WHERE LogType='Error' | UNAVAILABLE |
| Health trends | `trends.health[]` | Would need a time-series metrics store | UNAVAILABLE |
| Pipeline rate (24h) | `trends.pipelineRate` | `pipeline_audit` aggregated | UNAVAILABLE |

---

## Bugs Found

### BUG-1: CRITICAL -- `/api/executive` endpoint does not exist

**Severity:** CRITICAL
**Impact:** Page is 100% non-functional. Always shows error state.

The page calls `fetch(\`${API}/api/executive\`)` at line 434. No route handler exists for this path in any of:
- `dashboard/app/api/routes/control_plane.py`
- `dashboard/app/api/routes/entities.py`
- `dashboard/app/api/routes/monitoring.py`
- `dashboard/app/api/routes/pipeline.py`
- `dashboard/app/api/server.py`

**Fix needed:** Either:
1. Implement a `GET /api/executive` route that aggregates data from `entity_status`, `lz_entities`, `bronze_entities`, `silver_entities`, `pipeline_audit`, and `datasources` into the `ExecData` shape.
2. Refactor the frontend to compose data from existing endpoints (`/api/entity-digest`, `/api/control-plane`).

### BUG-2: MEDIUM -- Row counts have no data source

**Fields:** `overview.rowCounts.{bronze,silver,landing}`

Even if the endpoint existed, the expected row counts (actual data rows ingested) have no backing SQLite table. The `entity_status` table tracks load status but not row counts. The `engine_task_log` table has `RowsRead`/`RowsWritten` but has 0 rows. The `lakehouse_counts_cache.json` file (from `/api/lakehouse-counts`) requires live Fabric connection.

### BUG-3: LOW -- Health trend data requires time-series store

**Field:** `trends.health[]` expects `HealthTrend` objects with `captured_at`, `lz_count`, `bronze_count`, `silver_count`, `bronze_rows`, `silver_rows`, `pipeline_success_rate`.

No time-series data is captured in SQLite. The `metrics_store.py` module exists but its data would need to be wired into the executive endpoint.

---

## Correct Data Sources (What SHOULD Be Used)

| Metric | Correct Query |
|--------|--------------|
| Total entities | `SELECT COUNT(*) FROM lz_entities` |
| LZ loaded count | `SELECT COUNT(*) FROM entity_status WHERE LOWER(Layer) IN ('landingzone','landing') AND LOWER(Status) IN ('loaded','succeeded')` |
| Bronze loaded count | `SELECT COUNT(*) FROM entity_status WHERE LOWER(Layer)='bronze' AND LOWER(Status) IN ('loaded','succeeded')` |
| Silver loaded count | `SELECT COUNT(*) FROM entity_status WHERE LOWER(Layer)='silver' AND LOWER(Status) IN ('loaded','succeeded')` |
| Per-source breakdown | JOIN `lz_entities` with `datasources` for Namespace, then JOIN `entity_status` for loaded counts |
| Pipeline health | `SELECT PipelineRunGuid, ... FROM pipeline_audit GROUP BY PipelineRunGuid` with status derivation (same logic as `_build_control_plane()` in control_plane.py) |

---

## IsActive-as-Loaded Check

**Not applicable** -- the page never renders because the endpoint doesn't exist. However, the expected data shape correctly distinguishes between `total` (registered count) and `loaded` (entity_status-driven count), so the design intent is correct. If/when the endpoint is built, it must use `entity_status` for loaded counts, not `IsActive`.

---

## Empty Table Check

**Not applicable** -- endpoint doesn't exist. But if built:
- `pipeline_lz_entity` (0 rows) and `pipeline_bronze_entity` (0 rows) must NOT be used for processing counts
- `entity_status` (4,998 rows) is the correct source for loaded/processed counts

---

## Verdict

**Page Status: COMPLETELY NON-FUNCTIONAL**

The entire ExecutiveDashboard is dead on arrival because `/api/executive` was never implemented. The frontend code is well-structured with proper null guards and safe defaults, but it has nothing to display.
