# AUDIT: ImpactAnalysis.tsx

**Audited:** 2026-03-13
**Page:** `dashboard/app/src/pages/ImpactAnalysis.tsx` (~428 lines)
**Backend:** `dashboard/app/api/routes/entities.py` (entity-digest)

---

## Data Flow Trace

### API Calls

| # | Frontend Call | Backend Route | SQL / Data Source | Status |
|---|-------------|---------------|-------------------|--------|
| 1 | `GET /api/entity-digest` | `get_entity_digest()` in `entities.py` | `lz_entities` JOIN `datasources` JOIN `connections` + `entity_status` + `bronze_entities` + `silver_entities` | CORRECT |

This page makes a single API call via `useEntityDigest()`. All analysis is performed client-side using the digest data.

---

## Metric-by-Metric Trace

### KPI Cards (lines 168-170, 207-211)

| KPI | Frontend Computation | Correct Source | Correct? |
|-----|---------------------|---------------|----------|
| Total Entities | `allEntities.length` | Count of all LZ entities from digest | YES |
| Full Chain | `allEntities.filter(e => e.lzStatus === "loaded" && e.bronzeStatus === "loaded" && e.silverStatus === "loaded").length` | entity_status-derived statuses | YES |
| Partial Chain | `allEntities.filter(e => e.lzStatus === "loaded" && (e.bronzeStatus !== "loaded" \|\| e.silverStatus !== "loaded")).length` | entity_status-derived statuses | YES |
| Not Started | `allEntities.filter(e => !e.lzStatus \|\| e.lzStatus === "not_started").length` | entity_status-derived status | YES |

### Impact Chain Computation (lines 36-48)

`computeImpact(entity)` builds an impact trace for a selected entity:

| Layer | Status Source | `isActive` Determination | Correct? |
|-------|-------------|-------------------------|----------|
| Source | Hardcoded "origin" | Always true | YES |
| Landing | `entity.lzStatus` | `lzStatus === "loaded"` | YES -- uses entity_status |
| Bronze | `entity.bronzeStatus` | `bronzeStatus === "loaded"` | YES -- uses entity_status |
| Silver | `entity.silverStatus` | `silverStatus === "loaded"` | YES -- uses entity_status |
| Gold | Hardcoded "not_started" | Always false | YES -- Gold not yet implemented |

The `totalDownstream` count (line 47) correctly counts only layers where `isActive` is true AND layer is not "source".

### Source Impact Overview Table (lines 173-187)

| Column | Frontend Computation | Correct? |
|--------|---------------------|----------|
| Entities (total) | Per-source count from `allEntities` | YES |
| LZ | Count where `e.lzStatus === "loaded"` per source | YES -- entity_status-derived |
| Bronze | Count where `e.bronzeStatus === "loaded"` per source | YES -- entity_status-derived |
| Silver | Count where `e.silverStatus === "loaded"` per source | YES -- entity_status-derived |
| Full Chain | Count where all three statuses are "loaded" per source | YES |
| Errors | Count where `e.lastError` exists per source | YES -- entity_status.ErrorMessage |
| Blast Radius | `src.total / allEntities.length * 100` | YES -- proportional metric |

### At-Risk Entities (lines 190-194)

```typescript
allEntities
  .filter(e => e.lastError || (e.lzStatus === "loaded" && (e.bronzeStatus !== "loaded" || e.silverStatus !== "loaded")))
  .slice(0, 10)
```

| Filter Criterion | Source | Correct? |
|-----------------|--------|----------|
| Has error | `e.lastError` (from entity_status.ErrorMessage) | YES |
| Partial chain (LZ loaded but Bronze/Silver not) | entity_status-derived statuses | YES |

### Entity Search (lines 125-131)

Searches `allEntities` by `tableName` and `sourceSchema` -- client-side filtering of digest data. No additional API calls.

### Export Report (lines 139-165)

Generates a markdown file from the impact result. Uses only client-side data already loaded from the digest. No backend calls.

---

## Bugs Found

### No bugs found.

This page is clean. All metrics are derived from the entity digest which correctly uses `entity_status` for load status determination.

---

## IsActive-as-Loaded Check

**PASS.** The page never uses `IsActive` as a proxy for loaded status. Every status check uses `lzStatus`, `bronzeStatus`, or `silverStatus` which are derived from the `entity_status` table in the backend.

The `isActive` field from the digest is not referenced anywhere in this page's code.

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

- The impact trace is deterministic because LZ-to-Bronze-to-Silver is 1:1:1 in FMD. The page correctly models this as a linear chain.
- Column-level impact analysis is stubbed out with a "coming in Phase 2" placeholder (lines 282-294). This is honest and appropriate.
- The "Gold" layer is always shown as inactive ("not_started"), which is correct since Gold/MLV layers are not yet implemented.

---

## Verdict

**Page Status: FULLY FUNCTIONAL -- all data sources correct**

ImpactAnalysis is a well-designed page that uses the entity digest as its sole data source. All KPIs, the impact chain, the source breakdown table, and the at-risk entity list correctly use `entity_status`-derived statuses rather than `IsActive` flags. No queries against empty tables. No missing endpoints.
