# FMD Dashboard: UI/UX Upgrade + Governance/Lineage/Classification Pages

## Context

We're combining three things:
1. **UI/UX Pro Max skill** — design intelligence engine with 68 styles, 96 palettes, 25 chart types, 100 industry reasoning rules, and stack-specific guidance for shadcn/ui + React + Recharts
2. **fabric_toolbox catalog work** — complete data catalog type system (classification, lineage, ownership, certification, sensitivity levels) plus AI-powered column analysis
3. **New MDM capabilities** — data classification, column/table lineage, governance pages, with Claude via Foundry integration planned

---

## Part A: Existing Dashboard Improvements (UI/UX Pro Max Applied)

### A1. Extract Shared Design Primitives (Eliminate Repeated Code Debt)

**Problem**: 15+ pages duplicate status color maps, 12+ pages duplicate LAYERS/type-icon constants, 8+ pages re-implement timestamp formatting.

**Actions**:
- Create `src/lib/statusColors.ts` — canonical status→color map (running/success/failed/pending/cancelled) using existing OKLCH tokens from `index.css`, not hardcoded hex
- Create `src/lib/typeIcons.ts` — extract the 30+ data type→icon mapping from ColumnEvolution (100+ lines duplicated in 3 pages)
- Create `src/lib/formatters.ts` — consolidate timestamp, duration, row count formatting helpers that exist in 8+ pages
- Create `src/components/ui/StatusBadge.tsx` — single reusable badge component using the statusColors map (replaces inline `<span className="bg-emerald-500/10...">` scattered across pages)
- Create `src/components/ui/KpiCard.tsx` — standardized KPI card component (every Operations page has 4-6 KPI cards with slightly different implementations)
- Create `src/components/ui/LayerBadge.tsx` — layer indicator using `LAYER_MAP` from `layers.ts` (currently inline in 12+ pages)

**UI/UX Pro Max style applied**: **#28 Data-Dense Dashboard** — `font-size: 12-14px` for data tables, `gap: 8px` for dense grids, consistent card padding

### A2. Operations Pages — Apply Real-Time Monitoring Pattern (#31)

**Pages**: LiveMonitor, EngineControl, ExecutionMatrix, Pipeline Runner

**Actions**:
- **LiveMonitor**: Add subtle pulse animation on the status header (skill recommends `animation: pulse 2s ease-in-out infinite` for live data). Add event-type filter chips. Currently has no filtering at all.
- **ExecutionMatrix**: Replace hardcoded inline emerald/amber/red colors with StatusBadge component. Apply #28 dense grid layout to the entity table (currently wastes horizontal space).
- **EngineControl**: Extract the 5-tab layout into a consistent pattern. The plan modal is 36KB of inline rendering — extract to `PlanViewer` sub-component.
- **Pipeline Runner**: Move the 200+ line `displayNameOverrides` object to a shared config. Apply data-dense table pattern to execution history.

**Anti-pattern enforcement** (from skill reasoning rules):
- Rule #19 (SaaS Dashboard): "Must have real-time updates; prioritize performance for large datasets" — add virtualization to entity tables with 659+ rows
- Rule #45 (Analytics): "Data export required" — add CSV export button to ExecutionMatrix and ExecutionLog

### A3. Data Pages — Apply Drill-Down Analytics Pattern (#32)

**Pages**: DataJourney, DataMicroscope, ColumnEvolution, DataProfiler

**Actions**:
- **DataJourney** (42KB): Currently monolithic. Extract column comparison grid into `ColumnComparisonTable` sub-component. Apply #32 hierarchical expansion pattern — entity picker → layer summary → column detail.
- **ColumnEvolution** (45KB): The TYPE_ICON_MAP (100+ lines) is the prime extraction target. After extracting to `typeIcons.ts`, the page drops by ~25%. Apply consistent motion patterns (skill recommends `200-250ms` transitions, our `--duration-normal: 200ms` token already matches).
- **DataMicroscope** (48KB): The `getCellStatus` logic is complex and duplicated. Extract to a shared `diffEngine.ts`. Apply #28 dense grid for the multi-column layer comparison.
- **DataProfiler**: Apply #14 Radar/Spider chart for multi-axis DQ scores (completeness, uniqueness, validity). Currently uses simple BarCharts only.

### A4. Executive / Summary Pages — Apply Executive Dashboard Pattern (#30)

**Pages**: ExecutiveDashboard, ControlPlane, LoadProgress, RecordCounts

**Actions**:
- Apply skill #30 specs: max 4-6 KPIs, sparkline height 32px, status traffic lights
- **ControlPlane**: Health status config is duplicated (healthy/warning/critical color map) — consolidate with statusColors.ts
- **LoadProgress**: Add funnel visualization (skill chart #7 — Funnel Chart) showing entity conversion through LZ→Bronze→Silver layers
- **RecordCounts**: Add data export (CSV) per skill anti-pattern rule #45

### A5. Canvas Pages — Polish Animation Consistency

**Pages**: SankeyFlow (D3), ImpactPulse (React Flow), TransformationReplay (GSAP)

**Actions**:
- Standardize animation easing to use `--ease-claude` and `--ease-spring` tokens instead of hardcoded cubic-bezier values scattered across these pages
- TransformationReplay uses 3 animation frameworks (GSAP + Framer Motion + CSS) — consolidate to GSAP + CSS only
- SankeyFlow: Apply skill chart #12 (Sankey) guidance — ensure tooltips show entity counts and row volumes at each flow stage

---

## Part B: New Governance / Lineage / Classification Pages

### B1. Navigation Expansion

Add a new **"GOVERNANCE"** section to the sidebar, between DATA and LABS:

```
GOVERNANCE
├── Data Lineage        (icon: GitBranch)    — Table/column flow visualization
├── Data Classification (icon: Shield)       — Sensitivity tagging & coverage
├── Data Catalog        (icon: BookOpen)     — Entity browser with business context
└── Impact Analysis     (icon: Zap)          — "What breaks if X changes?"
```

### B2. Data Lineage Page

**Purpose**: Visualize the full Source → LZ → Bronze → Silver → Gold flow at both table and column level.

**Data source**: Existing FK chain in metadata DB (`LandingzoneEntity → BronzeLayerEntity → SilverLayerEntity`) + new `ColumnMetadata` and `ColumnLineage` tables.

**Layout** (applying skill #35 Sankey + #16 Network Graph):
- **Top**: Source filter (MES/ETQ/M3C/Optiva) + Layer filter + Search
- **Main area**: Interactive Sankey/DAG showing entity flow through layers. Click a node to drill into column-level lineage.
- **Detail panel** (right slide-out): Column mapping table showing source→target for selected entity, with transformation type badges (passthrough/computed/cleansed)
- **Mode toggle**: "Table View" (Sankey/DAG) vs "Column View" (expandable table with column mappings per entity)

**New API endpoints**:
- `GET /api/lineage/table/:entityId` — returns upstream/downstream entity chain
- `GET /api/lineage/column/:entityId` — returns column mappings across layers
- `GET /api/lineage/graph` — returns full entity graph for Sankey rendering
- `GET /api/lineage/impact/:columnName` — returns all downstream dependencies of a column

**Types to port from fabric_toolbox**:
- `LineageNode`, `LineageRelationship` from `catalog.ts`
- Adapt for FMD's layer model (add `layer: 'source' | 'landing' | 'bronze' | 'silver' | 'gold'`)

### B3. Data Classification Page

**Purpose**: Tag entities and columns with sensitivity levels, view classification coverage, manage classification rules.

**Data source**: New `ColumnClassification` table + adapted `SensitivityLevel` and `CertificationStatus` types from fabric_toolbox.

**Layout** (applying skill #28 Data-Dense + #29 Heatmap):
- **Top KPIs**: Total Columns, Classified %, PII Count, Confidential Count, Unclassified Count
- **Heatmap view**: Source × Sensitivity matrix (rows = data sources, columns = sensitivity levels, cells = entity counts)
- **Table view**: Sortable/filterable entity list with sensitivity badges per column
- **Classification editor**: Click an entity to open a slide-out where you can tag columns with sensitivity levels. Initially manual, then Claude via Foundry auto-suggests.

**New API endpoints**:
- `GET /api/classification/summary` — coverage stats
- `GET /api/classification/entity/:id` — column-level classifications for one entity
- `POST /api/classification/entity/:id` — save classification tags
- `GET /api/classification/heatmap` — source × sensitivity matrix data

**Types to port from fabric_toolbox**:
- `SensitivityLevel`, `CertificationStatus`, `DataQualityTier`, `DataTag`, `ColumnBusinessMetadata`

### B4. Data Catalog Page

**Purpose**: Browse all 659+ entities with business context, descriptions, ownership, and cross-references.

**Layout** (applying skill #32 Drill-Down + #28 Data-Dense):
- **Search bar** with faceted filters (source, schema, layer, sensitivity, certification status)
- **Card grid or table** of entities with badges (sensitivity, certification, layer coverage)
- **Entity detail modal** (port/adapt `TableDetailModal.tsx` from fabric_toolbox — 802 lines, already built with tabs for Overview, Columns, Lineage, Quality)
- **Tabs in detail**: Overview (business desc, owners, tags) | Columns (with classification badges) | Lineage (upstream/downstream mini-graph) | Quality (DQ scores if available)

### B5. Impact Analysis Page

**Purpose**: Answer "What breaks if this column/table changes?" using lineage graph traversal.

**Layout** (applying skill #21 Decomposition Tree + #16 Network Graph):
- **Input**: Select an entity + optionally a column
- **Output**: Downstream dependency tree showing every Bronze, Silver, Gold entity and column that would be affected
- **Visualization**: React Flow tree layout (top-to-bottom), nodes colored by layer, edges labeled with relationship type
- **Export**: Generate a markdown impact report for Jira/documentation

---

## Part C: Backend — Metadata DB Schema Extensions

### C1. New Tables (deployed via deploy_from_scratch.py Phase 16 extension)

```sql
-- Column schema cache — populated by notebook at load time
CREATE TABLE [integration].[ColumnMetadata] (
    ColumnMetadataId INT IDENTITY(1,1) PRIMARY KEY,
    EntityId INT NOT NULL,           -- FK to LandingzoneEntity/BronzeLayer/SilverLayer
    Layer NVARCHAR(20) NOT NULL,     -- 'landing' | 'bronze' | 'silver'
    ColumnName NVARCHAR(500) NOT NULL,
    DataType NVARCHAR(100),
    OrdinalPosition INT,
    IsNullable BIT DEFAULT 1,
    IsPrimaryKey BIT DEFAULT 0,
    IsSystemColumn BIT DEFAULT 0,    -- HashedPKColumn, IsDeleted, etc.
    CapturedAtUtc DATETIME2 DEFAULT GETUTCDATE(),
    UNIQUE(EntityId, Layer, ColumnName)
);

-- Column-level lineage mappings
CREATE TABLE [integration].[ColumnLineage] (
    ColumnLineageId INT IDENTITY(1,1) PRIMARY KEY,
    SourceEntityId INT NOT NULL,
    SourceColumnName NVARCHAR(500) NOT NULL,
    TargetEntityId INT NOT NULL,
    TargetColumnName NVARCHAR(500) NOT NULL,
    SourceLayer NVARCHAR(20) NOT NULL,
    TargetLayer NVARCHAR(20) NOT NULL,
    TransformationType NVARCHAR(50) DEFAULT 'passthrough',  -- passthrough | computed | cleansed | aggregated
    TransformationDetail NVARCHAR(MAX),                      -- JSON for cleansing rules, etc.
    IsActive BIT DEFAULT 1,
    CreatedAtUtc DATETIME2 DEFAULT GETUTCDATE()
);

-- Classification tags
CREATE TABLE [integration].[ColumnClassification] (
    ColumnClassificationId INT IDENTITY(1,1) PRIMARY KEY,
    EntityId INT NOT NULL,
    Layer NVARCHAR(20) NOT NULL,
    ColumnName NVARCHAR(500) NOT NULL,
    SensitivityLevel NVARCHAR(20),   -- public | internal | confidential | restricted | pii
    CertificationStatus NVARCHAR(20), -- certified | pending | draft | deprecated
    BusinessName NVARCHAR(500),
    Description NVARCHAR(MAX),
    ClassifiedBy NVARCHAR(100),       -- 'auto:pattern' | 'auto:claude' | 'manual:username'
    ClassifiedAtUtc DATETIME2 DEFAULT GETUTCDATE(),
    UNIQUE(EntityId, Layer, ColumnName)
);
```

### C2. Schema Capture in Notebooks

Add schema persistence to Bronze and Silver notebooks — after the DataFrame is loaded, persist `df.schema` to `ColumnMetadata` table. Auto-generate `ColumnLineage` entries (1:1 passthrough for all source columns, 'computed' for framework-added columns like `HashedPKColumn`, `IsCurrent`, etc.).

### C3. Dashboard API Endpoints

Add new endpoints to `dashboard/app/api/server.py`:
- Lineage endpoints (4): table, column, graph, impact
- Classification endpoints (4): summary, entity, save, heatmap
- Catalog endpoints (2): search, entity detail

---

## Part D: Implementation Order

| Phase | What | Pages/Files | Depends On |
|-------|------|-------------|------------|
| **D1** | Extract shared primitives (statusColors, typeIcons, KpiCard, StatusBadge) | 6 new files in lib/ and components/ui/ | Nothing |
| **D2** | Apply primitives to existing Operations pages | ExecutionMatrix, EngineControl, LiveMonitor, ExecutionLog | D1 |
| **D3** | Apply primitives to existing Data pages | DataJourney, ColumnEvolution, DataMicroscope, RecordCounts | D1 |
| **D4** | Backend: Deploy new metadata tables + API endpoints | server.py, deploy_from_scratch.py | Nothing (parallel with D1-D3) |
| **D5** | Data Lineage page (table-level first, column-level second) | New page + API | D4 |
| **D6** | Data Classification page | New page + API | D4 |
| **D7** | Data Catalog page (port fabric_toolbox TableDetailModal) | New page, ported types | D4, D5, D6 |
| **D8** | Impact Analysis page | New page | D5 (needs lineage graph) |
| **D9** | Notebook schema capture (Bronze + Silver notebooks) | 2 notebook files | D4 (needs ColumnMetadata table) |
| **D10** | Claude via Foundry integration (auto-classification, lineage Q&A) | API + UI integration | D6, D7 (needs classification + catalog in place) |

**D1-D3 can run in parallel with D4.**
**D5-D8 are sequential but each page is independently shippable.**
**D9 and D10 are enhancements — the pages work with manual/derived data first.**

---

## UI/UX Pro Max Skill — How to Invoke

For each new page, invoke the skill with context:
```
/ui-ux-pro-max — Design a [page name] for a metadata-driven data pipeline dashboard.
Stack: React 19, Tailwind 4 (OKLCH tokens), shadcn/ui, Recharts, Framer Motion.
Theme: Warm cream/terracotta (Claude Design System), DM Sans + IBM Plex Mono.
Pattern: [#28 Data-Dense | #30 Executive | #31 Real-Time | #32 Drill-Down | #39 Bento].
Data: [describe what the page shows].
```

For existing page refactors, invoke as a review:
```
/ui-ux-pro-max — Review this [page name] component for anti-patterns.
Focus: data-dense dashboard rules, virtualization for 659+ entity lists, data export capability.
```

The skill's shadcn.csv (60 rules) and react.csv (53 rules) provide component-level guidance. The industry reasoning rules (#19 SaaS Dashboard, #45 Analytics Dashboard) provide page-level anti-pattern enforcement.
