# AUDIT: SourceManager.tsx — Data Source Correctness

**Date**: 2026-03-13
**Page**: `dashboard/app/src/pages/SourceManager.tsx`
**Backend**: `dashboard/app/api/routes/source_manager.py`, `dashboard/app/api/routes/control_plane.py`
**DB Layer**: `dashboard/app/api/db.py` (thin wrapper around same `fmd_control_plane.db`)

---

## API Calls Made by Frontend

| # | API Call | Trigger | Used For |
|---|----------|---------|----------|
| 1 | `GET /api/gateway-connections` | Initial load (best-effort) | Onboarding wizard gateway list |
| 2 | `GET /api/connections` | Initial load | Registered connections list |
| 3 | `GET /api/datasources` | Initial load | Registered data sources list |
| 4 | Entity digest hook (`/api/entity-digest`) | Initial load (via `useEntityDigest`) | All entity data (replaces `/api/entities`) |
| 5 | `GET /api/load-config` | Load Optimization tab switch | Entity load configuration matrix |
| 6 | `GET /api/analyze-source?datasource={id}` | Analyze button click | Source table analysis (VPN required) |
| 7 | `POST /api/register-bronze-silver` | After analyze (auto) | Register Bronze/Silver entities |
| 8 | `POST /api/load-config` | Save Changes button | Batch update IsIncremental/watermark |
| 9 | `POST /api/connections` | Register Connection button | Register gateway connection |
| 10 | `DELETE /api/entities/{id}` | Delete entity button | Cascade delete entity |
| 11 | `POST /api/entities/bulk-delete` | Bulk delete button | Cascade bulk delete |
| 12 | `GET /api/entities/cascade-impact?ids=` | Before delete confirmation | Preview cascade impact |

---

## Route 1: `GET /api/connections` (from control_plane.py)

### SQL Query (via cpdb.get_connections)
```sql
SELECT ConnectionId, Name, Type, IsActive
FROM connections ORDER BY Name
```

**CORRECT**: Reads from `connections` table. Returns ConnectionId, Name, Type, IsActive. The frontend uses these to match against gateway connections via `ConnectionGuid`.

**Note**: The frontend `isRegistered()` function matches `rc.ConnectionGuid.toLowerCase() === gwConn.id.toLowerCase()` but the query does NOT select `ConnectionGuid`. This means the matching will fail silently — `rc.ConnectionGuid` will be `undefined`.

**BUG**: `get_connections()` in control_plane_db.py does NOT select `ConnectionGuid`, but the frontend SourceManager expects it in the `RegisteredConnection` interface. The gateway-to-registered matching is broken.

---

## Route 2: `GET /api/datasources` (from control_plane.py)

### SQL Query (via cpdb.get_datasources)
```sql
SELECT d.DataSourceId, d.Name, d.Namespace, d.Type, d.Description,
       d.IsActive, c.Name AS ConnectionName
FROM datasources d
LEFT JOIN connections c ON c.ConnectionId = d.ConnectionId
ORDER BY d.Namespace, d.Name
```

**CORRECT**: Reads from `datasources` with JOIN to `connections` for ConnectionName. All columns used by the frontend are present.

---

## Route 3: Entity Data (via `useEntityDigest` hook)

The SourceManager uses the digest hook instead of raw `/api/entities`. Entities are mapped via `digestToRegistered()`:

```typescript
function digestToRegistered(d: DigestEntity): RegisteredEntity {
  return {
    LandingzoneEntityId: String(d.id),
    SourceSchema: d.sourceSchema,
    SourceName: d.tableName,
    FileName: d.tableName,        // NOTE: uses tableName, not actual FileName
    FilePath: d.source,           // NOTE: uses source (namespace), not actual FilePath
    FileType: 'parquet',          // HARDCODED — ignores actual FileType
    IsIncremental: d.isIncremental ? 'True' : 'False',
    IsActive: d.isActive ? 'True' : 'False',
    DataSourceName: d.dataSourceName || d.source,
  };
}
```

| Field | Mapped From | Correct? |
|-------|-------------|----------|
| LandingzoneEntityId | `d.id` | CORRECT |
| SourceSchema | `d.sourceSchema` | CORRECT |
| SourceName | `d.tableName` | CORRECT |
| FileName | `d.tableName` | **WARNING** — should be `d.tableName` from digest, but the actual FileName in lz_entities could differ. The digest doesn't expose FileName separately. |
| FilePath | `d.source` | **WARNING** — `d.source` is the namespace/datasource name, not the actual FilePath from lz_entities. Displayed as group header label. |
| FileType | `'parquet'` hardcoded | **WARNING** — ignores actual FileType (could be Delta or other) |
| IsIncremental | `d.isIncremental` | CORRECT |
| IsActive | `d.isActive` | CORRECT |
| DataSourceName | `d.dataSourceName || d.source` | CORRECT |

**Impact**: The entity table in "Entity Registry" tab shows incorrect FileName extension (always `.parquet`), incorrect FilePath (shows namespace instead of actual path), and hardcoded FileType. This is a cosmetic issue in the registry view — the actual data in SQLite is correct.

---

## Route 4: `GET /api/load-config` (from source_manager.py)

### SQL Query
```sql
SELECT le.LandingzoneEntityId AS entityId,
       ds.Namespace AS dataSource, ds.DataSourceId AS dataSourceId,
       le.SourceSchema AS [schema], le.SourceName AS [table], le.FileName,
       le.IsIncremental, le.IsIncrementalColumn AS watermarkColumn,
       be.BronzeLayerEntityId AS bronzeEntityId, be.PrimaryKeys AS primaryKeys,
       se.SilverLayerEntityId AS silverEntityId
FROM lz_entities le
LEFT JOIN datasources ds ON le.DataSourceId = ds.DataSourceId
LEFT JOIN bronze_entities be ON le.LandingzoneEntityId = be.LandingzoneEntityId
LEFT JOIN silver_entities se ON be.BronzeLayerEntityId = se.BronzeLayerEntityId
ORDER BY ds.Name, le.SourceSchema, le.SourceName
```

| Column | Source Table.Column | Correct? |
|--------|---------------------|----------|
| entityId | `lz_entities.LandingzoneEntityId` | CORRECT |
| dataSource | `datasources.Namespace` | CORRECT |
| dataSourceId | `datasources.DataSourceId` | CORRECT |
| schema | `lz_entities.SourceSchema` | CORRECT |
| table | `lz_entities.SourceName` | CORRECT |
| FileName | `lz_entities.FileName` | CORRECT |
| IsIncremental | `lz_entities.IsIncremental` | CORRECT |
| watermarkColumn | `lz_entities.IsIncrementalColumn` | CORRECT |
| bronzeEntityId | `bronze_entities.BronzeLayerEntityId` | CORRECT |
| primaryKeys | `bronze_entities.PrimaryKeys` | CORRECT |
| silverEntityId | `silver_entities.SilverLayerEntityId` | CORRECT |

**CORRECT**: All JOINs and columns are accurate. The optional `?datasource=` filter correctly filters by `le.DataSourceId`.

**Note**: Frontend displays `lastWatermarkValue` and `lastLoadTime` columns in the Load Config interface, but these are NOT in the query response. They will always be null/empty.

---

## Route 5: `POST /api/load-config` (from source_manager.py)

### SQL Write
```sql
UPDATE lz_entities SET IsIncremental=?, IsIncrementalColumn=?
WHERE LandingzoneEntityId=?
```

**CORRECT**: Updates the right table (`lz_entities`) and the right columns (`IsIncremental`, `IsIncrementalColumn` aliased from `watermarkColumn` in the request).

---

## Route 6: `POST /api/register-bronze-silver` (from source_manager.py)

### SQL Queries
1. `SELECT ... FROM lz_entities WHERE DataSourceId = ? AND IsActive = 1` — CORRECT
2. `SELECT LakehouseId FROM lakehouses WHERE Name LIKE '%BRONZE%' LIMIT 1` — CORRECT
3. `SELECT LakehouseId FROM lakehouses WHERE Name LIKE '%SILVER%' LIMIT 1` — CORRECT
4. `INSERT OR IGNORE INTO bronze_entities (LandingzoneEntityId, LakehouseId, Schema_, Name, IsActive)` — CORRECT
5. `INSERT OR IGNORE INTO silver_entities (BronzeLayerEntityId, LakehouseId, Schema_, Name, IsActive)` — CORRECT

**CORRECT**: Creates Bronze and Silver layer entity registrations based on LZ entities. Idempotent (INSERT OR IGNORE).

---

## Route 7: `POST /api/sources/purge` (from source_manager.py)

### SQL Cascade Delete
1. Find datasource: `SELECT DataSourceId FROM datasources WHERE Name = ?`
2. Find LZ entities: `SELECT LandingzoneEntityId FROM lz_entities WHERE DataSourceId = ?`
3. For each LZ entity:
   - Find bronze: `SELECT BronzeLayerEntityId FROM bronze_entities WHERE LandingzoneEntityId = ?`
   - Delete silver: `DELETE FROM silver_entities WHERE BronzeLayerEntityId = ?`
   - Delete bronze: `DELETE FROM bronze_entities WHERE BronzeLayerEntityId = ?`
   - Delete LZ: `DELETE FROM lz_entities WHERE LandingzoneEntityId = ?`

**CORRECT**: Cascade delete follows the correct FK chain: Silver -> Bronze -> LZ.

**WARNING**: Does NOT delete corresponding `entity_status` rows. After a purge, orphan entity_status rows may remain in the DB for deleted entities.

---

## Summary Card Metrics

| Card | Data Source | Calculation | Correct? |
|------|-----------|-------------|----------|
| Data Sources | `registeredDataSources.length` | Count of `/api/datasources` response | CORRECT |
| External SQL | `registeredDataSources.filter(ds.Type === 'ASQL_01')` | Correct filter | CORRECT |
| Entities | `registeredEntities.length` | Count from digest | CORRECT |
| Active entities | `filter(e.IsActive === 'True')` | Digest maps `isActive: true` -> `'True'` | CORRECT |
| Incremental | `loadConfigData.filter(IsIncremental === true or === 1)` | From load-config endpoint | CORRECT |
| Connections | `gatewayConnections.length` | From Fabric gateway API (external) | CORRECT |
| Registered count | `filter(isRegistered(c))` | Matches gateway ID to ConnectionGuid | **BUG** — ConnectionGuid not in query |

---

## IsActive vs Processing Status Confusion Check

| Location | Uses | Purpose | Correct? |
|----------|------|---------|----------|
| Entity "Active"/"Inactive" badge | `IsActive` (via digest `isActive`) | Registration status | CORRECT |
| Active count in group header | `IsActive === 'True'` | Registration count per source | CORRECT |
| Load Optimization: "Bronze"/"Silver" columns | `bronzeEntityId != null` | Registration presence | CORRECT |

**No confusion found.** IsActive is used for registration. Processing status is not displayed on this page (it delegates to the execution matrix / data journey pages).

---

## Empty Table References

| Empty Table | Referenced? | Context |
|-------------|------------|---------|
| `pipeline_lz_entity` (0 rows) | NO | Not used |
| `pipeline_bronze_entity` (0 rows) | NO | Not used |
| `entity_status` (4998 rows) | INDIRECTLY via digest hook | Digest backend uses it; this page does not query it directly |

---

## Summary

| Category | Finding | Severity |
|----------|---------|----------|
| **BUG** | `get_connections()` omits `ConnectionGuid` column — `isRegistered()` matching in frontend always fails | High |
| WARNING | `digestToRegistered()` hardcodes FileType='parquet', maps FilePath=namespace — cosmetic inaccuracy in registry table | Low |
| WARNING | Load config query lacks `entity_status` JOIN — `lastLoadTime` and `lastWatermarkValue` always null | Medium |
| WARNING | `sources/purge` does not clean up orphan `entity_status` rows after cascade delete | Low |
| CORRECT | All entity counts, source counts, and load-config queries use correct tables/columns | - |
| CORRECT | IsActive never confused with processing status | - |
| CORRECT | No queries reference empty pipeline_lz_entity or pipeline_bronze_entity tables | - |
| CORRECT | Bronze/Silver registration INSERT targets correct tables with correct FK chains | - |
