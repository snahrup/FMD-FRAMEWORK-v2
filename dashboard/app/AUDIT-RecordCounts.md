# RecordCounts Page Audit

**Audited**: 2026-03-10
**Page**: `dashboard/app/src/pages/RecordCounts.tsx`
**Dependencies**: `useEntityDigest.ts` hook, `server.py` (`/api/lakehouse-counts`, `/api/entity-digest`), `control_plane_db.py`

---

## Data Flow Summary

```
RecordCounts.tsx
  |
  +-- useEntityDigest() --> GET /api/entity-digest --> _sqlite_entity_digest() / build_entity_digest()
  |     Returns: allEntities[] with sourceSchema, tableName, source (namespace), isIncremental
  |
  +-- fetchJson("/lakehouse-counts") --> get_lakehouse_row_counts()
        Returns: { LH_BRONZE_LAYER: [{schema, table, rowCount}], LH_SILVER_LAYER: [...], _meta: {...} }
        Schema values = datasource namespace (mes, etq, m3, m3c, optiva)
```

The page joins lakehouse row counts (keyed by `schema.table`) with entity metadata (from the digest) to show a Data Source column and Load Type column per table row.

---

## Bugs Found and Fixed

### BUG 1 (Critical) -- Entity-to-Lakehouse Join Key Mismatch [FIXED]

**Location**: RecordCounts.tsx line 217 (original)

**Problem**: The entity-to-datasource lookup used `ent.sourceSchema` (the source database schema, typically `dbo`) to build the join key. But lakehouse tables use the datasource **namespace** (`mes`, `etq`, `m3`, `m3c`, `optiva`) as their schema. This meant the lookup key was `dbo.WorkOrders` while the lakehouse key was `mes.WorkOrders` -- they never match.

**Impact**: The "Data Source" column showed "unlinked" for every single row. The "Load Type" column was always blank.

**Root Cause**: The Fabric notebook `NB_FMD_LOAD_LANDING_BRONZE` writes Delta tables to the path `Tables/{DataSourceNamespace}/{TargetName}`, where `DataSourceNamespace` is the datasource namespace from the metadata DB. In the lakehouse SQL endpoint, this namespace becomes the SQL schema. But the entity digest exposes the namespace as `ent.source`, not as `ent.sourceSchema` (which is the on-prem source schema like `dbo`).

**Fix**: Changed join key from `${ent.sourceSchema}.${ent.tableName}` to `${ent.source}.${ent.tableName}`.

### BUG 2 (Minor) -- API Error Sets Truthy Empty Object [FIXED]

**Location**: RecordCounts.tsx line 184 (original)

**Problem**: On API failure, `setCounts({})` was called. An empty object is truthy in JavaScript, so the Summary Cards section rendered showing all zeros alongside the error banner. The "No counts loaded" empty state could never render after an API failure.

**Fix**: Changed to `setCounts(null)` so the error banner renders alone without confusing zero-count cards.

### BUG 3 (Minor) -- Initial Loading State Flash [FIXED]

**Location**: RecordCounts.tsx line 153 (original)

**Problem**: `countsLoading` was initialized to `false`. Since the `useEffect` that calls `loadCounts()` fires after the first render, there was a single render frame where `counts=null, countsLoading=false, countsError=null`, causing the "No counts loaded" empty state to flash before the loading spinner appeared.

**Fix**: Changed initial state to `useState(true)` since `loadCounts()` is unconditionally called on mount.

---

## Backend Issues (Not Fixed -- Documented Only)

### ISSUE A -- `_sqlite_entity_digest` Return Shape Mismatch

**Location**: `server.py` lines 941-957 vs 4593-4618

The SQLite path and Fabric SQL path return different shapes for the `/api/entity-digest` response:

| Field | SQLite Path | Fabric SQL Path | Frontend Type |
|-------|-------------|-----------------|---------------|
| `sources` | `list` of source objects | `dict` keyed by source name | `Record<string, DigestSource>` |
| Source `.key` | Missing (has `.name` only) | Present | Required by `DigestSource` |
| Source `.summary` | Missing (has `.statusCounts`) | Present | Required by `DigestSource` |
| Source `.connection` | Missing | Present | Required by `DigestSource` |
| Top-level `.generatedAt` | Missing | Present | Expected by `DigestResponse` |
| Top-level `.buildTimeMs` | Missing | Present | Expected by `DigestResponse` |

**Impact**: Currently benign for RecordCounts because it only uses `allEntities` (which works via `Object.values()` on both arrays and objects). But `sourceList` in the hook uses `a.key.localeCompare(b.key)` which would throw on the SQLite path since `key` is undefined. Any page using `sourceList` or `totalSummary` (which reads `.summary`) from the hook would break when the SQLite path is active.

**Recommendation**: Align `_sqlite_entity_digest` return shape to match the Fabric SQL path. Specifically:
1. Return `sources` as a dict, not a list
2. Add `key` field to each source object
3. Rename `statusCounts` to `summary`
4. Add `connection` to each source object
5. Add `generatedAt` and `buildTimeMs` at top level

### ISSUE B -- Lakehouse Names Hardcoded in Frontend

**Location**: RecordCounts.tsx lines 201-202

```typescript
const bronzeCounts = counts["LH_BRONZE_LAYER"] || [];
const silverCounts = counts["LH_SILVER_LAYER"] || [];
```

These names are hardcoded to match the Fabric lakehouse `displayName` values. If the lakehouse names change in Fabric, the page silently shows zero data. The fallback `|| []` means no error is raised.

**Impact**: Low risk since lakehouse names are managed by the deploy script and rarely change. But worth noting.

### ISSUE C -- Dead Mock Data Code

**Location**: RecordCounts.tsx lines 76-140

The `generateMockCounts()` function and `isDemo` state variable exist but there is no UI to trigger demo mode. The function generates data with source names (`IPC_PowerData`, `IPC_FinanceDB`, etc.) that don't match the real lakehouse schema names. If demo mode were ever enabled, the entity-to-datasource join would also fail since mock data uses schemas like `dbo`/`staging`/`raw`.

**Impact**: Zero -- dead code only.

---

## Count Verification

### Entity Counts Per Source

From the control plane snapshot (`control_plane_snapshot.json`):

| Source | Namespace | LZ | Bronze | Silver | Total |
|--------|-----------|-----|--------|--------|-------|
| ETQ | etq | 29 | 29 | 29 | 29 |
| M3 ERP | m3 | 596 | 596 | 596 | 596 |
| M3 Cloud | m3c | 187 | 187 | 187 | 187 |
| MES | mes | 445 | 445 | 445 | 445 |
| OPTIVA | optiva | 409 | 409 | 409 | 409 |
| **Total** | | **1,666** | **1,666** | **1,666** | **1,666** |

All counts are consistent: 1,666 entities across all three layers. LZ = Bronze = Silver = 1,666.

### RecordCounts Page Math Verification

The summary cards compute:
- **Bronze table count**: `total - silverOnly` -- correct (tables in bronze layer)
- **Silver table count**: `total - bronzeOnly` -- correct (tables in silver layer)
- **Match rate**: `matched / total * 100` -- this uses all unique tables as denominator, including tables that exist in only one layer. This means the match rate is diluted by bronze-only and silver-only tables (which can never "match"). Consider using `matched / (matched + mismatched) * 100` if you want the rate among comparable tables only.
- **Delta**: `Math.abs(bronzeCount - silverCount)` for mismatched rows -- correct absolute difference.

### Row Count Accuracy

Lakehouse row counts come from `sys.partitions` metadata (`SUM(p.rows) WHERE index_id IN (0, 1)`). This is the standard fast-path for SQL Server/Fabric row counts and is accurate to within a few seconds of the latest write operation. The fallback uses `COUNT_BIG(*)` which is exact but slower.

---

## Recommendations

1. **Fix ISSUE A** (backend shape mismatch) before any page beyond RecordCounts uses the `sourceList` or `totalSummary` helpers from `useEntityDigest`.
2. **Remove dead code**: The `generateMockCounts` function (65 lines), `isDemo` state, and demo badge UI add noise. Remove them or wire up a proper demo toggle.
3. **Consider match rate denominator**: Current match rate includes single-layer tables, which can never match. Document whether this is intentional.
