# AUDIT: AdminGovernance.tsx

**Page**: `dashboard/app/src/pages/AdminGovernance.tsx`
**Backend**: `dashboard/app/api/routes/control_plane.py`, `dashboard/app/api/routes/source_manager.py`, `dashboard/app/api/routes/pipeline.py`, `dashboard/app/api/routes/monitoring.py`, `dashboard/app/api/routes/entities.py`
**Audited**: 2026-03-13

---

## Summary

AdminGovernance is a read-only governance dashboard that displays framework health metrics, entity inventory, data lineage swim lanes, workspace/lakehouse topology, and pipeline inventory. It pulls from 6 API endpoints plus the entity digest hook. There is one **critical bug**: the `/api/stats` endpoint queries non-existent tables AND returns a completely different response shape than what the frontend expects.

**Verdict**: FAIL -- 1 critical data source bug

---

## API Calls Traced

### 1. Entity Digest (via `useEntityDigest` hook)

**Frontend** (line 93-98): `useEntityDigest()` hook

**Backend** (`entities.py` line 234): `GET /api/entity-digest`

Calls `_build_sqlite_entity_digest()` which queries:
- `cpdb.get_registered_entities_full()` -- joins `lz_entities` + `datasources` + `connections`
- `cpdb.get_entity_status_all()` -- reads `entity_status` table
- `cpdb.get_bronze_view()` -- joins `bronze_entities` + `lz_entities`
- `cpdb.get_silver_view()` -- joins `silver_entities` + `bronze_entities`

**Correctness**: PASS -- all tables exist, joins are correct.

**Frontend usage**: `allEntities` array used for:
- `lzEntityCount` = `allEntities.length` (line 151) -- CORRECT (digest returns one entry per LZ entity)
- `bronzeEntityCount` = `allEntities.filter(e => e.bronzeId !== null).length` (line 152) -- CORRECT
- `silverEntityCount` = `allEntities.filter(e => e.silverId !== null).length` (line 153) -- CORRECT
- Source lanes derived by grouping entities by `e.source` and matching to `ds.Name` (line 178) -- CORRECT

### 2. `GET /api/connections`

**Frontend** (line 117): `fetchJson<Connection[]>('/connections')`

**Backend** (`control_plane.py` line 397): `return cpdb.get_connections()`

SQL: `SELECT * FROM connections` (via `control_plane_db.py`)

**Correctness**: PASS -- `connections` table exists with correct columns.

### 3. `GET /api/datasources`

**Frontend** (line 118): `fetchJson<DataSource[]>('/datasources')`

**Backend** (`control_plane.py` line 403): `return cpdb.get_datasources()`

SQL: `SELECT ds.*, c.Name AS ConnectionName FROM datasources ds LEFT JOIN connections c ON ds.ConnectionId = c.ConnectionId`

**Correctness**: PASS -- both tables exist, join is correct, `ConnectionName` alias is used by frontend (line 177).

### 4. `GET /api/pipelines`

**Frontend** (line 119): `fetchJson<Pipeline[]>('/pipelines')`

**Backend** (`pipeline.py` line 311): `return db.query("SELECT * FROM pipelines ORDER BY PipelineId")`

**Correctness**: PASS -- `pipelines` table exists with `PipelineId`, `PipelineGuid`, `WorkspaceGuid`, `Name`, `IsActive`.

### 5. `GET /api/workspaces`

**Frontend** (line 120): `fetchJson<Workspace[]>('/workspaces')`

**Backend** (`source_manager.py` line 293): `return db.query("SELECT * FROM workspaces ORDER BY WorkspaceId")`

**Correctness**: PASS -- `workspaces` table exists with `WorkspaceId`, `WorkspaceGuid`, `Name`.

### 6. `GET /api/lakehouses`

**Frontend** (line 121): `fetchJson<Lakehouse[]>('/lakehouses')`

**Backend** (`source_manager.py` line 298): `return db.query("SELECT * FROM lakehouses ORDER BY LakehouseId")`

**Correctness**: PASS -- `lakehouses` table exists with `LakehouseId`, `LakehouseGuid`, `WorkspaceGuid`, `Name`.

### 7. `GET /api/stats`

**Frontend** (line 122): `fetchJson<DashboardStats>('/stats')`

**Backend** (`monitoring.py` line 202): `get_dashboard_stats()`

```python
lz = db.query("SELECT COUNT(*) AS cnt FROM LandingzoneEntity WHERE IsActive=1")
brz = db.query("SELECT COUNT(*) AS cnt FROM BronzeLayerEntity WHERE IsActive=1")
slv = db.query("SELECT COUNT(*) AS cnt FROM SilverLayerEntity WHERE IsActive=1")
return {
    "lzActiveEntities": lz[0]["cnt"],
    "bronzeActiveEntities": brz[0]["cnt"],
    "silverActiveEntities": slv[0]["cnt"],
}
```

**TWO CRITICAL ISSUES**:

**Issue A -- Wrong table names**: The backend queries `LandingzoneEntity`, `BronzeLayerEntity`, `SilverLayerEntity` which **DO NOT EXIST** in the SQLite schema. The correct table names are `lz_entities`, `bronze_entities`, `silver_entities`. This query will throw a "no such table" error, be caught by the `except` block, and return `{}`.

**Issue B -- Response shape mismatch**: The frontend expects:
```typescript
interface DashboardStats {
  activeConnections: number;
  activeDataSources: number;
  activeEntities: number;
  lakehouses: number;
  entityBreakdown: { DataSourceName: string; DataSourceType: string; EntityCount: string }[];
}
```

But the backend returns (when working):
```python
{"lzActiveEntities": N, "bronzeActiveEntities": N, "silverActiveEntities": N}
```

The response keys don't match at all. The frontend uses:
- `stats?.activeConnections` (line 271) -- backend returns nothing for this
- `stats?.activeDataSources` (line 273) -- backend returns nothing for this
- `stats?.activeEntities` (line 301) -- backend returns nothing for this
- `stats?.lakehouses` (line 283) -- backend returns nothing for this

**Result**: All stats cards show `0` because the response is `{}` (error) or because the keys don't match.

---

## Bugs Found

### BUG-AG-1: `/api/stats` queries non-existent tables (CRITICAL)

**File**: `dashboard/app/api/routes/monitoring.py` lines 206-208
**Wrong**: `LandingzoneEntity`, `BronzeLayerEntity`, `SilverLayerEntity`
**Correct**: `lz_entities`, `bronze_entities`, `silver_entities`
**Impact**: Query throws "no such table" error. Exception is caught, returns `{}`. All health scorecard numbers show 0.

### BUG-AG-2: `/api/stats` response shape does not match frontend interface (CRITICAL)

**File**: `monitoring.py` line 209-213 vs `AdminGovernance.tsx` line 57-63
**Backend returns**: `{ lzActiveEntities, bronzeActiveEntities, silverActiveEntities }`
**Frontend expects**: `{ activeConnections, activeDataSources, activeEntities, lakehouses, entityBreakdown }`
**Impact**: Even if table names were fixed, the response keys would still not populate the health cards.

**Fix**: Rewrite the `/api/stats` endpoint to:
1. Use correct table names (`lz_entities`, `bronze_entities`, `silver_entities`)
2. Return the shape the frontend expects: `activeConnections` (COUNT from `connections WHERE IsActive=1`), `activeDataSources` (COUNT from `datasources WHERE IsActive=1`), `activeEntities` (COUNT from `lz_entities WHERE IsActive=1`), `lakehouses` (COUNT from `lakehouses`), `entityBreakdown` (GROUP BY datasource)

---

## Data Source Correctness Detail

| KPI | Frontend Field | Backend Source | Status |
|---|---|---|---|
| Pipeline count | `pipelines.length` | `pipelines` table | CORRECT |
| Active pipelines | `pipelines.filter(p => p.IsActive === 'True')` | `pipelines.IsActive` | CORRECT |
| Connections count | `stats?.activeConnections` | **MISSING from backend** | BUG |
| Data sources count | `stats?.activeDataSources` | **MISSING from backend** | BUG |
| Lakehouses count | `stats?.lakehouses` | **MISSING from backend** | BUG |
| Entity count | `stats?.activeEntities` | **MISSING from backend** | BUG |
| LZ entity count | `lzEntityCount` (from digest) | `lz_entities` via entity-digest | CORRECT |
| Bronze entity count | `bronzeEntityCount` (from digest) | `bronze_entities` via entity-digest | CORRECT |
| Silver entity count | `silverEntityCount` (from digest) | `silver_entities` via entity-digest | CORRECT |
| Active connections | `connections.filter(c => c.IsActive === 'True')` | `connections` table | CORRECT |
| Workspace topology | `workspaces` | `workspaces` table | CORRECT |
| Lakehouse topology | `lakehouses` + workspace join | `lakehouses` table | CORRECT |
| Pipeline inventory | `pipelines` categorized by name pattern | `pipelines` table | CORRECT |
| Swim lanes | derived from digest + datasources | entity-digest + datasources | CORRECT |

---

## Verdict

- 5 of 7 API endpoints return correct data from correct SQLite tables
- Entity digest integration is correct and well-implemented
- Swim lane lineage visualization correctly derives from digest + datasources
- `/api/stats` is **doubly broken**: wrong table names AND wrong response shape
- The page is mostly functional because the entity counts come from the digest hook (correct), not from `/api/stats` (broken)
- The "Connections" and "Lakehouses" health cards will show 0 until `/api/stats` is fixed
