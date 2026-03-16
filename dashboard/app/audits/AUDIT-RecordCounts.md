# AUDIT: RecordCounts.tsx

**Page**: `dashboard/app/src/pages/RecordCounts.tsx`
**Date**: 2026-03-13
**Auditor**: Steve Nahrup (automated)
**Verdict**: 2 BUGS found (1 critical, 1 minor)

---

## Data Flow Trace

### 1. Entity Metadata (useEntityDigest hook)

| Step | Artifact | Details |
|------|----------|---------|
| Frontend call | `useEntityDigest()` (no filters) | `dashboard/app/src/hooks/useEntityDigest.ts` |
| API endpoint | `GET /api/entity-digest` | `dashboard/app/api/routes/entities.py:234` |
| Backend function | `_build_sqlite_entity_digest()` | `dashboard/app/api/routes/entities.py:66` |
| DB helpers called | `cpdb.get_registered_entities_full()` | `lz_entities` JOIN `datasources` JOIN `connections` |
| | `cpdb.get_entity_status_all()` | `entity_status` (full table scan) |
| | `cpdb.get_bronze_view()` | `bronze_entities` JOIN `lz_entities` JOIN `datasources` JOIN `pipeline_bronze_entity` |
| | `cpdb.get_silver_view()` | `silver_entities` JOIN `bronze_entities` JOIN `lz_entities` JOIN `datasources` |
| Tables read | `lz_entities` (1,666 rows) | Source entity metadata |
| | `entity_status` (4,998 rows) | Per-entity per-layer status |
| | `bronze_entities` (1,666 rows) | Bronze registrations |
| | `silver_entities` (1,666 rows) | Silver registrations |
| | `datasources` (8 rows) | For Namespace/DataSourceName |
| | `connections` (10 rows) | For ServerName/DatabaseName |
| | `pipeline_bronze_entity` (0 rows) | For IsProcessed state |
| | `sync_metadata` (1 row) | `last_sync` watermark |

**Usage in RecordCounts**: The hook provides `allEntities` which is used to build a `entityToSource` lookup map keyed by `${ent.source}.${ent.tableName}` (Namespace + SourceName). This is used to annotate each lakehouse count row with its `dataSource` and `loadType` (incremental vs. full).

**Assessment**: CORRECT. The digest uses `Namespace` from `datasources` as `source` and `SourceName` from `lz_entities` as `tableName`. The entity lookup key construction (`source.tableName`) matches how lakehouse tables are organized by namespace schema.

---

### 2. Lakehouse Row Counts (primary data)

| Step | Artifact | Details |
|------|----------|---------|
| Frontend call | `fetchJson("/lakehouse-counts")` or `fetchJson("/lakehouse-counts?force=1")` | Line 170 |
| API endpoint | `GET /api/lakehouse-counts` | `dashboard/app/api/routes/data_access.py:206` |
| Backend logic | Reads `lakehouse_counts_cache.json` from disk | File at `dashboard/app/api/lakehouse_counts_cache.json` |
| Data source | Pre-computed cache file (populated by background sync) | NOT a live query |

**Frontend expectation** (lines 171-180):
```
CountsResponse = { LH_BRONZE_LAYER: [...], LH_SILVER_LAYER: [...], _meta?: {...} }
```
The code iterates `Object.entries(data)`, skips `_meta`, and expects each value to be `Array<{schema, table, rowCount}>`.

**Actual cache file structure**:
```json
{"counts": {"LH_DATA_LANDINGZONE": [], "LH_BRONZE_LAYER": [...], "LH_SILVER_LAYER": [...]}, "savedAt": "..."}
```

**Backend returns**: The raw JSON file contents verbatim: `{"counts": {...}, "savedAt": "..."}`.

---

## BUG 1 (CRITICAL): Cache file structure mismatch

**Severity**: Critical -- the entire page renders empty due to this.

The frontend expects lakehouse arrays at the top level of the response:
```json
{"LH_BRONZE_LAYER": [...], "LH_SILVER_LAYER": [...]}
```

But the backend returns the raw cache file which wraps them in a `counts` key:
```json
{"counts": {"LH_BRONZE_LAYER": [...], "LH_SILVER_LAYER": [...]}, "savedAt": "..."}
```

When the frontend runs `Object.entries(data)` and checks `Array.isArray(val)`, neither `counts` (an object) nor `savedAt` (a string) pass that check. Result: `countData` is empty, `rows` is empty, and the entire comparison matrix shows zero tables.

**Fix option A** (backend): Unwrap in the route:
```python
raw = _json.loads(counts_file.read_text())
result = raw.get("counts", raw)
result["_meta"] = {"cachedAt": raw.get("savedAt"), "fromCache": True, ...}
return result
```

**Fix option B** (frontend): Unwrap on receipt:
```ts
const raw = await fetchJson<any>(path);
const payload = raw.counts ?? raw;
```

**File**: `dashboard/app/api/routes/data_access.py:206-218`

---

## BUG 2 (MINOR): Mock data generator is dead code but importable

**Severity**: Low (cosmetic / maintenance)

`generateMockCounts()` (lines 76-140) is defined but never called in the current code. The "Demo Data" button logic was removed, but the function remains as dead code. It uses fake source names like `IPC_PowerData`, `IPC_FinanceDB`, `IPC_MES`, `IPC_HRConnect` that don't match real datasource Namespace values (`mes`, `ETQStagingPRD`, `m3fdbprd`, `DI_PRD_Staging`).

No data correctness impact since it's never invoked, but it should be cleaned up.

---

## KPI / Metric Correctness Matrix

| Metric | Source | Correct? | Notes |
|--------|--------|----------|-------|
| Bronze table count | `stats.total - stats.silverOnly` | YES* | Correct derivation from lakehouse counts (but currently empty due to BUG 1) |
| Silver table count | `stats.total - stats.bronzeOnly` | YES* | Same caveat |
| Bronze total rows | `sum(row.bronzeCount)` | YES* | Summed from `LH_BRONZE_LAYER` array entries |
| Silver total rows | `sum(row.silverCount)` | YES* | Summed from `LH_SILVER_LAYER` array entries |
| Match count | Tables where `bronzeCount === silverCount` | YES | Correct comparison logic |
| Mismatch count | Tables where both counts exist but differ | YES | Correct |
| Match rate | `matched / total * 100` | YES | Correct |
| Delta | `abs(bronzeCount - silverCount)` | YES | Correct |
| Data source annotation | `entityToSource` map from digest | YES | Correctly uses `Namespace.SourceName` as key |
| Load type | `isIncremental` from digest entities | YES | Correctly maps boolean to "Incremental"/"Full" |

*All lakehouse count metrics are structurally correct but produce zero results due to BUG 1.

---

## Data Source Summary

| Frontend metric | SQLite table(s) | Column(s) used | Correct table? | Correct column? |
|-----------------|------------------|----------------|----------------|-----------------|
| Entity source/loadType | `lz_entities`, `datasources` | `Namespace`, `SourceName`, `IsIncremental` | YES | YES |
| Row counts per table | `lakehouse_counts_cache.json` (not SQLite) | `schema`, `table`, `rowCount` | N/A (file cache) | YES |
| Cache metadata | `lakehouse_counts_cache.json` | `savedAt` | N/A | MISMATCH (see BUG 1) |

---

## Recommendations

1. **Fix BUG 1 immediately** -- the page is completely non-functional with real data. The backend route at `data_access.py:206` should unwrap the `counts` key from the cache file and construct the `_meta` object from `savedAt`.
2. **Remove dead mock data** -- delete `generateMockCounts()` and the `isDemo` state variable. They serve no purpose.
3. **Add `LH_DATA_LANDINGZONE` to the matrix** -- the cache file includes LZ counts but the frontend only looks at `LH_BRONZE_LAYER` and `LH_SILVER_LAYER`. Consider showing a three-layer comparison (LZ vs Bronze vs Silver).
