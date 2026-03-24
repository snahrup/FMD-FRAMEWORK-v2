# BUILD Track Handoff — 4 Stub Pages → Real Pages

> **Author:** Steve Nahrup
> **Date:** 2026-03-23
> **Status:** Implementing
> **Spec:** `docs/superpowers/specs/2026-03-16-gold-layer-design.md`
> **Plan:** `docs/superpowers/plans/2026-03-16-gold-cleansing-dq.md`

---

## Overview

Four stub pages in the FMD Dashboard need to become real, functional pages. Each is currently a ~51-line "Coming Soon" placeholder. All four are in the Labs nav group at `/labs/*` routes.

The design spec and implementation plan already exist (see refs above). This handoff distills the actionable scope for each page.

---

## Page 1: DQ Scorecard (`/labs/dq-scorecard`)

### Current state
- **File:** `dashboard/app/src/pages/DqScorecard.tsx` (51 lines, Coming Soon)
- **Route:** `/labs/dq-scorecard` in `App.tsx`
- **Nav:** AppLayout.tsx line 98

### Data sources (ALREADY EXIST)
- `quality_scores` table in SQLite — populated by `services/quality_engine.py`
- `GET /api/quality/scores` — paginated scores with tier filter (quality.py)
- `GET /api/quality/score/{entityId}` — single entity breakdown (quality.py)
- `POST /api/quality/refresh` — recompute all scores (quality.py)
- `GET /api/quality/scores` returns `summary` with tier counts
- DQ components already built: `DqScoreRing`, `DqTrendChart`, `ColumnQualityBar`, `EntitySparkline`, `EntityHeatmap`, `FreshnessIndicator`, `IssueSeverityDonut`, `SourceBreakdownCards`, `AnimatedCounter`

### What to build
1. **No new backend needed** — existing endpoints provide everything
2. **Frontend only** — replace stub with real page:
   - **KPI strip**: Total entities scored, average composite, tier distribution (gold/silver/bronze/unclassified) using `DqScoreRing` components
   - **Tier distribution chart**: Donut or bar chart of tier counts
   - **Entity table**: Paginated sortable table of entities with scores, filterable by tier and source
   - **Entity detail slide-out**: Click a row → see dimension breakdown (completeness, freshness, consistency, volume)
   - **Refresh button**: Trigger `POST /api/quality/refresh`
   - **7-day trend chart**: Already built as `DqTrendChart` component
3. **Extend backend (optional)**: Add `GET /api/quality/scorecard` endpoint per spec Section 4.3 for aggregated summary. If not, compute from existing `/api/quality/scores?limit=500` response.

### API response shape (existing)
```json
{
  "items": [{"entityId", "entityName", "source", "completeness", "freshness", "consistency", "volume", "composite", "tier", "computedAt"}],
  "total": 1666,
  "summary": {"scored": N, "tiers": {"gold": N, "silver": N, "bronze": N, "unclassified": N}}
}
```

---

## Page 2: Gold MLV Manager (`/labs/gold-mlv`)

### Current state
- **File:** `dashboard/app/src/pages/GoldMLVManager.tsx` (51 lines, Coming Soon)
- **Route:** `/labs/gold-mlv` in `App.tsx`
- **Nav:** AppLayout.tsx (in Labs group, behind feature flag)

### Data sources (PARTIALLY EXIST)
- `gs_gold_specs` table — has `object_type` field ('mlv', 'view', 'table') and status/SQL/dependencies
- `GET /api/gold-studio/specs` — paginated list with domain filter (gold_studio.py)
- `GET /api/gold-studio/specs/{id}` — detail with validation runs
- Gold Studio has 67 endpoints total for the full workflow
- **NEW tables needed** (per spec): `gold_domains`, `gold_models`, `gold_model_columns`, `gold_relationships`

### What to build
1. **Backend**: Create `dashboard/app/api/routes/gold.py` with domain/model/relationship CRUD (spec Section 4.1)
2. **Schema**: Add Gold layer tables to `control_plane_db.py` (spec Section 3.1)
3. **Frontend**: Replace stub with:
   - **Domain cards**: Grid of business domains (Sales Analytics, Production Analytics, etc.)
   - **Model list per domain**: Fact/Dimension classification with Silver dependencies
   - **Relationship diagram**: Star schema visualization (use @xyflow/react if available, or simple SVG)
   - **Model detail panel**: Columns, source SQL, dependency chain
   - **Lakehouse sync button**: `POST /api/gold/domains/:id/sync` to discover tables from Gold lakehouse
4. **Note**: The sync endpoint needs Fabric access (VPN + SP token). Handle 503 gracefully with manual registration fallback.

### Pragmatic approach
Since Gold Studio already has extensive data (`gs_gold_specs`, canonical entities, etc.), the MLV Manager can start by displaying existing Gold specs filtered to `object_type='mlv'` while the full domain/model schema is built out. This gives immediate value without waiting for schema migration.

---

## Page 3: Cleansing Rule Editor (`/labs/cleansing`)

### Current state
- **File:** `dashboard/app/src/pages/CleansingRuleEditor.tsx` (51 lines, Coming Soon)
- **Route:** `/labs/cleansing` in `App.tsx`
- **Nav:** AppLayout.tsx line 99

### Data sources (NEED TO BE BUILT)
- **No `cleansing_rules` table yet** in SQLite — needs to be created per spec Section 3.2
- Cleansing rules currently live in Fabric SQL metadata DB, read by `sp_GetSilverCleansingRule` stored proc
- Bronze→Silver notebook (`NB_FMD_LOAD_BRONZE_SILVER`) reads and applies rules via `handle_cleansing_functions()`
- Rule format is JSON: `[{"column": "...", "function": "normalize_text", "params": {"case": "lower"}}]`

### What to build
1. **Schema**: Add `cleansing_rules` table to `control_plane_db.py` (spec Section 3.2)
2. **Backend**: Create `dashboard/app/api/routes/cleansing.py` with CRUD + preview (spec Section 4.2)
   - `GET /api/cleansing/rules?entity_id=` — rules for entity
   - `POST /api/cleansing/rules` — create rule
   - `PUT /api/cleansing/rules/:id` — update
   - `DELETE /api/cleansing/rules/:id` — remove
   - `GET /api/cleansing/functions` — available rule types + parameter schemas
   - `POST /api/cleansing/rules/preview` — dry-run with sample data (needs VPN)
   - `POST /api/cleansing/rules/batch-copy` — copy rules across entities
3. **Frontend**: Replace stub with:
   - **Entity selector**: Pick a Silver entity to manage rules for
   - **Rule list**: Ordered list of rules for selected entity with drag-reorder
   - **Rule editor form**: Adaptive form based on rule_type (different params per type)
   - **JSON preview**: Show the JSON that will be sent to the notebook
   - **Before/after preview**: Sample data showing rule application (if VPN available)

### Rule types (from spec)
normalize_text, fill_nulls, parse_datetime, trim, replace, regex, cast_type, map_values, clamp_range, deduplicate

---

## Page 4: SCD Audit View (`/labs/scd-audit`)

### Current state
- **File:** `dashboard/app/src/pages/SCDAudit.tsx` (51 lines, Coming Soon)
- **Route:** `/labs/scd-audit` in `App.tsx`
- **Nav:** AppLayout.tsx line 100

### Data sources (PARTIALLY EXIST)
- `engine_task_log` — Silver layer rows have `RowsRead`, `RowsWritten`, `LoadType`, `Status`
- Bronze→Silver notebook tracks SCD2 operations: inserts, updates (expire old + insert new), soft deletes
- SCD2 columns added: `IsCurrent`, `RecordStartDate`, `RecordEndDate`, `RecordModifiedDate`, `IsDeleted`, `Action`
- **No explicit SCD change breakdown table** — the notebook logs totals but doesn't separately log insert/update/delete counts to the control plane

### What to build
1. **Backend**: Create `dashboard/app/api/routes/scd_audit.py` with:
   - `GET /api/scd/summary` — per-entity SCD metrics derived from engine_task_log Silver runs
   - `GET /api/scd/entity/{entityId}` — run-by-run detail for one entity
   - `GET /api/scd/runs?run_id=` — Silver layer results for a specific run
   The metrics are derived: for each Silver layer task in engine_task_log, RowsRead = source rows, RowsWritten = rows merged. The delta (RowsWritten - RowsRead if positive = new inserts, etc.) gives approximate change indicators.
2. **Frontend**: Replace stub with:
   - **KPI strip**: Total Silver entities, last run timestamp, total rows processed
   - **Entity table**: Per-entity Silver load results with RowsRead/RowsWritten/LoadType
   - **Run-over-run trend**: Chart showing record churn per entity across runs
   - **Entity detail**: Click to see all Silver runs for an entity with timestamps, row counts, status
   - **IsCurrent/IsDeleted distribution**: If the data is available from OneLake queries (requires Fabric access)

### Pragmatic approach
Start with what's in `engine_task_log` (Silver layer runs with row counts). This gives real data immediately. The full insert/update/delete breakdown would require either:
- Extending the Bronze→Silver notebook to log these counts separately
- Querying OneLake Silver tables directly for IsCurrent/IsDeleted counts (expensive, needs VPN)

Phase 1 should use engine_task_log data. Phase 2 can add direct lakehouse queries.

---

## Build order (recommended)

1. **DQ Scorecard** — most existing infrastructure, no new backend needed
2. **SCD Audit** — uses existing engine_task_log, new backend routes only
3. **Gold MLV Manager** — needs new schema + routes, but Gold Studio data exists
4. **Cleansing Rules** — most new code (schema + full CRUD + preview)

## Design constraints
- Use `var(--bp-*)` design tokens throughout — no hardcoded hex
- All UI must scale to N sources (never hardcode 5)
- Use existing components: `EntitySelector`, `DqScoreRing`, `DqTrendChart`, etc.
- ARIA accessibility from the start
- Honest empty states — if no data exists yet, say so clearly
