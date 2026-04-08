# AUDIT-GOV-MOCK-TRUTH: Governance Mock-vs-Truth Forensic Audit

**Session**: GOV-MOCK-TRUTH (Phase 1)
**Audited**: 2026-04-08
**Surfaces**: GOV-001 through GOV-004, GOV-010
**Scope**: READ-ONLY truth audit -- determine what is mocked, what is real, and what needs to happen to make each page truthful.
**Prior audits referenced**: AUDIT-DataLineage (2026-03-23), AUDIT-DataClassification (2026-03-23), AUDIT-DataCatalog (2026-03-23), AUDIT-ImpactAnalysis (2026-03-23)

---

## Executive Summary

**The manifest's "MOCK" classification is largely incorrect.** Of the three pages tagged MOCK (DataClassification, DataCatalog, ImpactAnalysis), none display fabricated data in their current state. All five governance pages source their primary data from real database queries -- either via the Entity Digest Engine (`/api/entity-digest`) or dedicated backend routes that query the control plane SQLite DB. The previously-identified fabricated column counts in DataClassification's fallback (`*15` multiplier) were already fixed in the March 23 audit. The remaining gaps are not about mock data but about **data availability** -- classification tables are empty until a scan runs, quality scores are not yet populated, and Gold layer impact is structurally unknown.

| Surface | Verdict | Mock Data? | Real Data Path |
|---------|---------|-----------|----------------|
| GOV-001 DataLineage | **REAL** | None | Entity Digest + `/api/lineage/columns/{id}` |
| GOV-002 DataClassification | **REAL (conditional)** | Fallback shows zeros, not fakes | `/api/classification/summary` + Entity Digest |
| GOV-003 DataCatalog | **REAL** | None | Entity Digest only |
| GOV-004 ImpactAnalysis | **REAL (computed)** | No API -- deterministic client-side | Entity Digest only |
| GOV-010 DataEstate | **REAL** | None | `/api/estate/overview` (7-section aggregation) |

---

## GOV-001: DataLineage (`/lineage`)

**File**: `dashboard/app/src/pages/DataLineage.tsx`
**Backend**: `dashboard/app/api/routes/lineage.py` (395 lines, 7 endpoints implied)
**Prior audit**: AUDIT-DataLineage.md (2026-03-23) -- PASS verdict

### Data Sources

| ID | Data Point | Source | Classification |
|----|-----------|--------|---------------|
| GOV-LIN-001 | Entity list (KPIs, table, search) | `useEntityDigest()` hook -> `GET /api/entity-digest` -> SQLite JOINs across `lz_entities`, `datasources`, `connections`, `bronze_entities`, `silver_entities`, `entity_status` | **REAL** |
| GOV-LIN-002 | Column lineage per entity | `fetch(/api/lineage/columns/${entity.id})` -> `lineage.py:get_lineage_columns()` -> reads OneLake Parquet schema via Polars, caches to `column_metadata` SQLite table | **REAL** |
| GOV-LIN-003 | Layer status badges (LZ/Bronze/Silver) | Derived from digest entity status fields (`lzStatus`, `bronzeStatus`, `silverStatus`) | **REAL** |
| GOV-LIN-004 | Row counts column | Always shows em-dash -- no row count data available in data model | **DEAD** (acknowledged, not mock) |
| GOV-LIN-005 | Source colors | `getSourceColor()` from shared `layers.ts` utility | **REAL** (design system, not data) |

### Verdict: **NOT MOCK**

All KPIs derive from real entity-digest data. Column lineage reads actual Parquet file schemas from OneLake and caches them in SQLite. The only "gap" is row counts (GOV-LIN-004), which is honestly displayed as an em-dash rather than fabricated.

### Gaps Identified

- **GOV-LIN-006**: Column lineage depends on `column_metadata` table being populated. On first run or fresh DB, the table may not exist. The backend handles this gracefully (returns cache miss, falls through to OneLake discovery), but if OneLake is unreachable, the column panel shows an error message. This is correct behavior, not mock data.
- **GOV-LIN-007**: Gold layer is not represented in the lineage chain. The lineage traces LZ -> Bronze -> Silver but Gold entities are not yet linked in the metadata model.

---

## GOV-002: DataClassification (`/classification`)

**File**: `dashboard/app/src/pages/DataClassification.tsx`
**Backend**: `dashboard/app/api/routes/classification.py` (415+ lines, 6 endpoints)
**Prior audit**: AUDIT-DataClassification.md (2026-03-23) -- PASS verdict after fixes

### Data Sources

| ID | Data Point | Source | Classification |
|----|-----------|--------|---------------|
| GOV-CLS-001 | KPI cards (total entities, total columns, classified, coverage %) | Primary: `fetch("/api/classification/summary")` -> `classification.py:get_classification_summary_route()` -> queries `column_classifications` + `column_metadata` SQLite tables. Fallback: `_fallback(entities)` from digest | **REAL** with **zero-value fallback** |
| GOV-CLS-002 | Sensitivity breakdown (public/internal/confidential/restricted/pii) | From `/api/classification/summary` response `bySensitivity` field -> real `GROUP BY sensitivity_level` query | **REAL** |
| GOV-CLS-003 | Per-source breakdown table | From `/api/classification/summary` response `bySource` field -> real query joining `column_classifications`, `column_metadata`, `lz_entities`, `datasources` | **REAL** |
| GOV-CLS-004 | Heatmap (source x sensitivity) | Computed client-side from `bySource` response data | **REAL** (derived from real data) |
| GOV-CLS-005 | Entity list with sensitivity counts | `useEntityDigest()` for entity list + API summary for classification overlay | **REAL** |
| GOV-CLS-006 | Scan trigger + status | `POST /api/classification/scan` triggers background thread, `GET /api/classification/status` polls. Real Presidio + pattern-based classification engine | **REAL** |

### The "MOCK" Question: Why the Manifest Tagged This Page

The confusion likely stems from two factors:

1. **Empty-state appearance**: If no classification scan has ever run, `column_classifications` and `column_metadata` tables are empty. The API returns zeros for everything. The page looks "empty" but is not showing fake data -- it is honestly showing zero classified columns.

2. **The now-fixed `*15` multiplier** (DC2-01): Before the March 23 audit, the `_fallback()` function fabricated column counts using `entities.length * 15`. This was the only genuinely mock data on this page, and it was fixed to return zeros instead. The fix is confirmed in the current codebase -- line 66-88 of `DataClassification.tsx` shows `_fallback()` returning all-zero values.

### Fallback Behavior (Current)

```
function _fallback(entities): ClassificationData {
  // All counts = 0, all breakdowns = 0
  // Sources derived from real digest data (dynamic, not hardcoded)
  // Heatmap cells all have count: 0
}
```

The fallback activates during API loading and on API failure. It shows zeros, not fabricated numbers. Source names are derived from the real entity digest (dynamic, scales to N sources).

### Verdict: **NOT MOCK** (was partially mock before 2026-03-23 fix)

### Conditional Reality

The data is real *when classification tables are populated*. The classification engine (`classification_engine.py`) uses Presidio and regex pattern matching to classify columns. But classification requires:
1. `column_metadata` table populated (happens during Bronze/Silver loads via OneLake schema discovery)
2. A scan triggered via the UI or API (`POST /api/classification/scan`)

If neither has happened, the page shows zeros -- which is truthful.

### Truth Alignment Plan

| Step | Action | Effort |
|------|--------|--------|
| 1 | Ensure `column_metadata` is populated during load pipeline runs | Backend -- already happens during Bronze/Silver loads |
| 2 | Auto-trigger classification scan after first successful load | Backend -- add post-load hook in orchestrator |
| 3 | Add "No scan has been run" banner when `column_classifications` is empty | Frontend -- small UX improvement |
| 4 | Populate Gold layer classification when Gold entities exist | Backend -- extend scan to Gold layer schemas |

---

## GOV-003: DataCatalog (`/catalog`)

**File**: `dashboard/app/src/pages/DataCatalog.tsx` (800+ lines)
**Backend**: Entity Digest only -- no dedicated catalog backend route
**Prior audit**: AUDIT-DataCatalog.md (2026-03-23) -- PASS verdict

### Data Sources

| ID | Data Point | Source | Classification |
|----|-----------|--------|---------------|
| GOV-CAT-001 | Entity grid (name, schema, source, status) | `useEntityDigest()` -> `GET /api/entity-digest` -> real SQLite JOINs | **REAL** |
| GOV-CAT-002 | KPI cards (total entities, loaded %, sources, layers) | Computed from digest data client-side | **REAL** |
| GOV-CAT-003 | Source filter dropdown | Dynamic from digest source keys | **REAL** (scales to N sources) |
| GOV-CAT-004 | Quality tier badge | `entity.qualityScore` + `entity.qualityTier` from digest | **REAL** but **empty** -- fields exist in DigestEntity interface but not yet populated by backend |
| GOV-CAT-005 | Detail modal - Columns tab | Placeholder text pointing to Labs > DQ Scorecard. No API call. | **DEAD** (placeholder, not mock) |
| GOV-CAT-006 | Detail modal - Lineage tab | Placeholder -- references column lineage page | **DEAD** (placeholder, not mock) |
| GOV-CAT-007 | Detail modal - Quality tab | Shows `qualityScore`/`qualityTier` if populated, otherwise "Quality scoring not configured" message | **PARTIAL** -- honest about missing data |
| GOV-CAT-008 | Detail modal - Overview tab | Connection info, primary keys, layer statuses -- all from digest | **REAL** |
| GOV-CAT-009 | Business name / description / domain / tags | `DigestEntity` interface declares `businessName`, `description`, `domain`, `tags` fields -- none rendered in grid or modal | **DEAD** (fields exist but not surfaced in UI) |
| GOV-CAT-010 | 150-entity client cap | `filtered.slice(0, 150)` hard-caps rendered results | **Limitation** (not mock, but truncates large sources) |

### Verdict: **NOT MOCK**

The catalog is entirely driven by the Entity Digest. No hardcoded data, no fabricated counts, no imported mock data. The only gaps are **feature stubs** (columns tab, lineage tab) that honestly display placeholder messages rather than fake data, and **unpopulated fields** (quality, business name) that are invisible until backend data exists.

### Glossary Integration

The manifest lists `glossary.py` as a backend for this page. However, the DataCatalog page **does not call any glossary endpoint**. The `glossary.py` backend serves `GET /api/glossary` for the Business Help page's glossary, not the DataCatalog. The `businessName`, `description`, `domain`, and `tags` enrichment fields on `DigestEntity` are not sourced from the glossary -- they are direct fields on the entity digest response that are simply not yet populated.

### Truth Alignment Plan

| Step | Action | Effort |
|------|--------|--------|
| 1 | Populate `qualityScore`/`qualityTier` in entity digest backend | Backend -- wire DQ scorecard results into digest |
| 2 | Surface `businessName`/`description`/`domain`/`tags` in grid + modal | Frontend -- render existing fields when populated |
| 3 | Wire Columns tab to `/api/lineage/columns/{id}` (already exists) | Frontend -- reuse DataLineage's column fetch |
| 4 | Add pagination or virtual scrolling for >150 entities | Frontend -- replace `slice(0, 150)` |

---

## GOV-004: ImpactAnalysis (`/impact`)

**File**: `dashboard/app/src/pages/ImpactAnalysis.tsx` (~480 lines)
**Backend**: **None** -- no backend route, no API call. Entirely client-side computation.
**Prior audit**: AUDIT-ImpactAnalysis.md (2026-03-23) -- PASS verdict

### Data Sources

| ID | Data Point | Source | Classification |
|----|-----------|--------|---------------|
| GOV-IMP-001 | Entity selector + search | `useEntityDigest()` -> real entity data | **REAL** |
| GOV-IMP-002 | KPI cards (total entities, sources, at-risk count) | Computed from digest data client-side | **REAL** |
| GOV-IMP-003 | Impact chain visualization (Source -> LZ -> Bronze -> Silver -> Gold) | `computeImpact(entity)` -- deterministic client-side function | **REAL (computed)** |
| GOV-IMP-004 | Layer status in impact chain | From digest fields: `lzStatus`, `bronzeStatus`, `silverStatus` | **REAL** |
| GOV-IMP-005 | Gold layer impact | Hardcoded to `{ layer: "gold", status: "not_started", isActive: false }` | **STRUCTURAL LIMITATION** |
| GOV-IMP-006 | Downstream count | `layers.filter(l => l.isActive && l.layer !== "source").length` -- derived from real statuses | **REAL** |
| GOV-IMP-007 | At-risk entity list | Filters digest entities by error states and partial layer chains | **REAL** |
| GOV-IMP-008 | Blast radius (per-source breakdown) | Proportional counts from digest, not fabricated | **REAL** |

### The Computation Model

The `computeImpact()` function is deterministic and transparent:

```typescript
function computeImpact(entity: DigestEntity): ImpactResult {
  const layers = [
    { layer: "source", status: "active", isActive: true },
    { layer: "landing", status: entity.lzStatus, isActive: entity.lzStatus === "loaded" },
    { layer: "bronze", status: entity.bronzeStatus ?? "not_started", isActive: entity.bronzeStatus === "loaded" },
    { layer: "silver", status: entity.silverStatus ?? "not_started", isActive: entity.silverStatus === "loaded" },
    { layer: "gold", status: "not_started", isActive: false },
  ];
  return { origin: entity, impactedLayers: layers, totalDownstream: ... };
}
```

This is not mock data. Since the medallion architecture is 1:1:1 (LZ:Bronze:Silver), the impact trace is genuinely deterministic. Changing the source affects exactly those downstream layers. The only limitation is Gold, which is hardcoded to inactive because Gold entities are not yet linked in the metadata model.

### Verdict: **NOT MOCK**

The prior audit confirmed: "No Math.ceil/random tricks, no hardcoded counts, no fabricated data." The computation model is honest about the 1:1:1 relationship and transparently shows Gold as not-started.

### Truth Alignment Plan

| Step | Action | Effort |
|------|--------|--------|
| 1 | Link Gold specs to source entities in metadata model | Backend -- Gold Studio canonical entities need upstream links |
| 2 | Replace hardcoded Gold `not_started` with real Gold entity status lookup | Frontend + Backend |
| 3 | Add cross-entity impact (entity A's failure blocks entity B's join) | Future -- requires dependency graph in metadata |

---

## GOV-010: DataEstate (`/estate`)

**File**: `dashboard/app/src/pages/DataEstate.tsx` + 4 sub-components
**Backend**: `dashboard/app/api/routes/data_estate.py` (single aggregated endpoint)
**Prior audit**: None (first audit)

### Architecture

The DataEstate page is a high-level visual dashboard showing the entire pipeline estate: sources, medallion layers, governance status, and pipeline flow. It calls a single backend endpoint and distributes data to four sub-components.

**Frontend**: `DataEstate.tsx` -> `fetch("/api/estate/overview")` with 30s auto-refresh interval
**Sub-components**:
- `SourceNode.tsx` -- individual source system cards
- `LayerZone.tsx` -- medallion layer cards with coverage rings
- `GovernancePanel.tsx` -- classification + schema validation + Purview status
- `PipelineFlow.tsx` -- animated SVG flow connectors (purely visual, no data)

### Data Sources

| ID | Data Point | Source | Classification |
|----|-----------|--------|---------------|
| GOV-EST-001 | Source list (name, status, entity count, loaded count, errors) | `_sources()` -> SQL JOIN across `lz_entities`, `datasources`, `connections`, `engine_task_log` with ROW_NUMBER windowing | **REAL** |
| GOV-EST-002 | Source operational status | Derived: `offline` if `IsActive=0`, `degraded` if errors > 0, `operational` otherwise | **REAL** (computed from real data) |
| GOV-EST-003 | Layer stats (registered, loaded, failed, coverage %) | `_layers()` -> `COUNT(*)` on `lz_entities`, `bronze_entities`, `silver_entities` where `IsActive=1`, plus `engine_task_log` windowed query for load/fail counts | **REAL** |
| GOV-EST-004 | Gold layer registered count | Hardcoded to `0` in `_layer("Gold", "gold", ..., 0)` | **STRUCTURAL LIMITATION** -- Gold entities not in metadata model yet |
| GOV-EST-005 | Classification coverage | `_classification()` -> `COUNT(*)` on `column_classifications` and `column_metadata` tables | **REAL** (zeros if tables empty) |
| GOV-EST-006 | Schema validation stats | `_schema_validation()` -> `SELECT COUNT(*), SUM(passed), SUM(failed) FROM schema_validations` | **REAL** (zeros if table empty) |
| GOV-EST-007 | Purview sync status | `_purview()` -> `classification_type_mappings` + `purview_sync_log` tables | **REAL** (shows "pending" if no sync has occurred) |
| GOV-EST-008 | Pipeline freshness | `_freshness()` -> `MAX(created_at) FROM engine_task_log`, last run from `engine_runs` | **REAL** |
| GOV-EST-009 | Derived KPIs (total entities, loaded, errors, healthy sources) | Client-side `reduce()` over real source data | **REAL** |
| GOV-EST-010 | Pipeline flow animations | `PipelineFlow` component -- visual only, animates based on `sourcesActive`/`layersActive`/`governanceActive` booleans derived from real data | **REAL** (visual representation of real state) |
| GOV-EST-011 | Ghost source nodes (empty state) | When `data.sources.length === 0`, shows `EmptyEstate` component | **Correct empty state** |

### Backend Resilience

The backend uses a `_safe()` wrapper around each section. If any individual query fails (e.g., missing table), that section returns a safe default (empty array or zeros) while other sections still load. This means:
- Missing `column_classifications` table -> classification shows zeros (correct)
- Missing `schema_validations` table -> schema validation shows zeros (correct)
- Missing `purview_sync_log` table -> Purview shows "pending" (correct)

System sources (`CUSTOM_NOTEBOOK`, `LH_DATA_LANDINGZONE`) are filtered out of the source list via `WHERE ds.Name NOT IN (...)`.

### Verdict: **REAL -- First fully-real governance page**

DataEstate has zero mock data. Every data point traces to a real SQL query against the control plane DB. Empty states are honest (show zeros or "pending", never fabricated numbers). The `_safe()` wrapper ensures graceful degradation without fake data.

### Findings

| ID | Severity | Description |
|----|----------|-------------|
| GOV-EST-012 | LOW | Gold layer registered count is hardcoded to 0 in backend. Should query Gold entity table when it exists. |
| GOV-EST-013 | LOW | `GovernancePanel` has hardcoded hex colors for sensitivity breakdown bar (`#5B8DEF`, `#E9A23B`, `#E07A3B`) instead of design tokens. Non-functional but inconsistent with BP design system. |
| GOV-EST-014 | INFO | 30-second auto-refresh interval matches client-side digest TTL. Server-side digest has 2-minute TTL. No wasted requests. |
| GOV-EST-015 | INFO | `PipelineFlow` uses SVG `viewBox="0 0 1000 600"` coordinate system -- responsive but may clip on very narrow viewports. |

---

## Cross-Cutting Findings

### Shared Infrastructure Dependencies (SHARED-* references)

All five pages depend on these shared components:

| Dependency | Used By | Notes |
|-----------|---------|-------|
| `useEntityDigest` hook (SHARED-DIGEST) | GOV-001, GOV-002, GOV-003, GOV-004 | Single source of truth. 30s client TTL, 2min server TTL. Normalizes SQLite and Fabric SQL response shapes. |
| Control Plane SQLite DB (SHARED-CPDB) | GOV-001, GOV-002, GOV-010 | Tables: `lz_entities`, `bronze_entities`, `silver_entities`, `datasources`, `connections`, `entity_status`, `engine_task_log`, `engine_runs`, `column_metadata`, `column_classifications`, `schema_validations`, `purview_sync_log`, `classification_type_mappings` |
| `layers.ts` utility (SHARED-LAYERS) | GOV-001, GOV-004 | Layer colors, labels, definitions. Hex opacity suffix pattern noted in prior audit. |
| BP Design System CSS vars (SHARED-BP) | All 5 | `--bp-copper`, `--bp-operational`, `--bp-fault`, `--bp-surface-*`, etc. |

### The "MOCK" Misconception

The manifest classified GOV-002, GOV-003, and GOV-004 as MOCK. This appears to be based on:

1. **Empty-state appearance**: When classification has not been run, or quality scores are not populated, these pages show zeros or placeholders. This *looks* like mock data to a casual observer but is actually honest representation of empty state.

2. **Historical fabrication (now fixed)**: DataClassification previously had a `*15` column count multiplier in its fallback function. This was the only genuinely mock data point, fixed in the March 23 audit.

3. **No dedicated backend**: ImpactAnalysis has no backend route -- its `computeImpact()` is client-side. This might have been misread as "no real data," but the computation uses real entity statuses from the digest.

4. **Stub features**: DataCatalog's Columns and Lineage modal tabs are placeholders. These are **feature stubs**, not mock data -- they honestly say "not available" rather than showing fake columns.

**Recommendation**: Reclassify GOV-002, GOV-003, and GOV-004 from MOCK to **REAL_WITH_GAPS** in the manifest. The gaps are about data availability and unbuilt features, not fabricated display data.

---

## Consolidated Truth Alignment Plan

### Priority 1: Data Availability (makes existing pages truthful for all states)

| # | Action | Pages Affected | Effort |
|---|--------|---------------|--------|
| 1 | Auto-trigger classification scan after first successful load run | GOV-002, GOV-010 | Backend: post-load hook in orchestrator |
| 2 | Populate `qualityScore`/`qualityTier` in entity digest | GOV-003 | Backend: wire DQ scorecard results |
| 3 | Add "No scan has been run" UX banner on classification page | GOV-002 | Frontend: small conditional banner |
| 4 | Add "Quality scoring not configured" banner on catalog grid (not just modal) | GOV-003 | Frontend: small conditional banner |

### Priority 2: Feature Gaps (makes pages more complete)

| # | Action | Pages Affected | Effort |
|---|--------|---------------|--------|
| 5 | Wire DataCatalog Columns tab to existing `/api/lineage/columns/{id}` | GOV-003 | Frontend: reuse DataLineage fetch |
| 6 | Surface `businessName`/`description`/`domain`/`tags` when populated | GOV-003 | Frontend: render existing digest fields |
| 7 | Link Gold specs to source entities for real Gold impact | GOV-004, GOV-010 | Backend: Gold metadata model |
| 8 | Replace DataCatalog 150-entity cap with pagination/virtualization | GOV-003 | Frontend: moderate effort |

### Priority 3: Polish

| # | Action | Pages Affected | Effort |
|---|--------|---------------|--------|
| 9 | Replace hardcoded hex colors in GovernancePanel sensitivity bar | GOV-010 | Frontend: trivial |
| 10 | Add row count data to lineage page when available | GOV-001 | Backend + Frontend |
| 11 | Extend classification scan to Gold layer schemas | GOV-002 | Backend |

---

## Appendix: File Inventory

| File | Lines | Role |
|------|-------|------|
| `dashboard/app/src/pages/DataLineage.tsx` | ~403 | GOV-001 frontend |
| `dashboard/app/src/pages/DataClassification.tsx` | ~400 | GOV-002 frontend |
| `dashboard/app/src/pages/DataCatalog.tsx` | ~800 | GOV-003 frontend |
| `dashboard/app/src/pages/ImpactAnalysis.tsx` | ~480 | GOV-004 frontend |
| `dashboard/app/src/pages/DataEstate.tsx` | ~300 | GOV-010 frontend |
| `dashboard/app/src/components/estate/SourceNode.tsx` | ~120 | GOV-010 sub-component |
| `dashboard/app/src/components/estate/LayerZone.tsx` | ~140 | GOV-010 sub-component |
| `dashboard/app/src/components/estate/GovernancePanel.tsx` | ~230 | GOV-010 sub-component |
| `dashboard/app/src/components/estate/PipelineFlow.tsx` | ~90 | GOV-010 sub-component |
| `dashboard/app/api/routes/lineage.py` | ~395 | GOV-001 backend |
| `dashboard/app/api/routes/classification.py` | ~415 | GOV-002 backend |
| `dashboard/app/api/routes/data_estate.py` | ~200 | GOV-010 backend |
| `dashboard/app/src/hooks/useEntityDigest.ts` | ~250 | Shared data hook (SHARED-DIGEST) |
