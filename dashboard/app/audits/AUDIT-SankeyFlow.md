# AUDIT: SankeyFlow.tsx

**Audited:** 2026-03-13
**Page:** `dashboard/app/src/pages/SankeyFlow.tsx` (~809 lines)
**Backend:** `dashboard/app/api/routes/entities.py` (entity-digest)

---

## Data Flow Trace

### API Calls

| # | Frontend Call | Backend Route | SQL / Data Source | Status |
|---|-------------|---------------|-------------------|--------|
| 1 | `GET /api/entity-digest` | `get_entity_digest()` in `entities.py` | `lz_entities` JOIN `datasources` JOIN `connections` + `entity_status` + `bronze_entities` + `silver_entities` | CORRECT |

This page makes a single API call via `useEntityDigest()`. The Sankey diagram is computed entirely on the client side.

---

## Metric-by-Metric Trace

### Sankey Node Counts (lines 270-306)

The page builds Sankey nodes with entity counts from digest data:

**Source Nodes (one per source system):**

| Attribute | Source | Correct? |
|-----------|--------|----------|
| `count` | `src.summary.total` | YES -- total entities per source |

**Layer Nodes (aggregated from all sources):**

| Layer | Count Computation | Correct Source | Correct? |
|-------|-------------------|---------------|----------|
| Landing Zone | Count of entities where `entity.lzStatus === "loaded"` | entity_status-derived | YES |
| Bronze | Count of entities where `entity.bronzeStatus === "loaded"` | entity_status-derived | YES |
| Silver | Count of entities where `entity.silverStatus === "loaded"` | entity_status-derived | YES |
| Gold | Always 0 | N/A -- Gold not implemented | YES |

Lines 288-294 iterate per source, per entity:
```typescript
if (entity.lzStatus === "loaded") layerCounts.landing++;
if (entity.bronzeStatus === "loaded") layerCounts.bronze++;
if (entity.silverStatus === "loaded") layerCounts.silver++;
```

This correctly uses `entity_status`-derived load statuses, not `IsActive`.

### Sankey Link Values (lines 311-358)

| Link | `value` (band width) | Correct? |
|------|----------------------|----------|
| Source -> Landing Zone | `src.summary.total` (all registered entities per source) | YES -- represents entity registration flow |
| Landing -> Bronze | `layerCounts.bronze` (loaded bronze count) | YES -- represents loaded entities flowing through |
| Bronze -> Silver | `layerCounts.silver` (loaded silver count) | YES |
| Silver -> Gold | `layerCounts.gold` (always 0, link not rendered) | YES |

### Source Panel (SourcePanel component, lines 114-227)

When a source node is clicked, a slide-out panel shows entities for that source:

| Field | Source | Correct? |
|-------|--------|----------|
| Entity list | `source.entities` from digest | YES |
| Status badges | `entity.overall` from digest | YES -- derived from entity_status |
| Summary counts | `source.summary.{complete,partial,pending,error,not_started}` | YES |
| Connection info | `source.connection.{server,database}` | YES |

### Header Stats (lines 504-505)

| Stat | Source | Correct? |
|------|--------|----------|
| Total entities | `totalSummary.total` | YES -- aggregated from digest |
| Source count | `sourceList.length` | YES |
| Timestamp | `data.generatedAt` | YES |

---

## Bugs Found

### No bugs found.

All data sources are correct. The page uses `useEntityDigest()` exclusively and all computations correctly reference `entity_status`-derived status fields.

---

## IsActive-as-Loaded Check

**PASS.** The page uses `lzStatus === "loaded"`, `bronzeStatus === "loaded"`, and `silverStatus === "loaded"` for all count computations (lines 291-293). The `IsActive` field is never used as a proxy for loaded status.

Note: The `isActive` field on source nodes (`src.isActive` at line 505 in the `data` prop) refers to UI interactivity (whether a source node is clickable), not load status. This is a different semantic concept and is correctly named.

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

- The Sankey diagram correctly represents the data flow semantics: Source->LZ links use total registration count (all entities flow into LZ), while LZ->Bronze and Bronze->Silver links use loaded counts (only successfully processed entities flow through).
- Source->LZ link width = total entities (registration), LZ->Bronze link width = loaded bronze entities. This means the Sankey correctly visualizes "drop-off" where not all entities have been loaded through every layer.
- Gold node renders as "Coming soon" when `node.count === 0` (line 739), which is an appropriate placeholder.
- The slide-out SourcePanel uses `data?.sources[node.sourceKey]` (line 450) to look up source data. The `sourceKey` is the digest source key (Namespace), which aligns correctly with the `DigestResponse.sources` record keys.

---

## Verdict

**Page Status: FULLY FUNCTIONAL -- all data sources correct**

SankeyFlow is a clean implementation that uses the entity digest as its sole data source. All Sankey node counts and link values correctly derive from `entity_status`-based load statuses. No IsActive-as-loaded bugs. No queries against empty tables. The d3-sankey layout is driven entirely by correct data.
