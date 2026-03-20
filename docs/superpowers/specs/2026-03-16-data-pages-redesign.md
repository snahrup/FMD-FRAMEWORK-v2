# Data Pages Creative Redesign — Comprehensive Spec

**Date**: 2026-03-16
**Branch**: `feat/business-portal`
**Scope**: 7 pages in the "Data" navigation category
**Goal**: Transform generic dashboard pages into distinctive, craft-driven interfaces that leverage each page's unique subject matter for visualization opportunities. Then audit-fix until zero bugs.

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Shared Visual Language](#2-shared-visual-language)
3. [Page-by-Page Specifications](#3-page-by-page-specifications)
   - 3.1 RecordCounts — The Assay Lab
   - 3.2 DataJourney — The Expedition Map
   - 3.3 FlowExplorer — The Process Floor
   - 3.4 DataBlender — The Laboratory
   - 3.5 SqlExplorer — The Observatory
   - 3.6 SourceManager — The Command Center
   - 3.7 DataManager — The Logbook
4. [Competitive Intelligence & Stolen Ideas](#4-competitive-intelligence)
5. [AI Assistant with Dynamic Visualizations](#5-ai-assistant)
6. [Cross-Page Navigation](#6-cross-page-navigation)
7. [Shared Refactoring](#7-shared-refactoring)
8. [Implementation Phases](#8-implementation-phases)
9. [Audit-Fix Protocol](#9-audit-fix-protocol)

---

## 1. Design Philosophy

### The Problem
Every page currently uses the same pattern: Instrument Serif heading → KPI cards → sortable table. This is correct, readable, functional — and completely interchangeable. Swap the data and titles and you can't tell which page you're on. That's the definition of template.

### The Principle
Each Data page has a **unique subject** with a **unique visualization vocabulary** baked into its domain. RecordCounts is about comparing quantities across layers — that's a bar chart, not a table. DataJourney traces a single entity through transformations — that's a timeline, not tabs. FlowExplorer shows pipeline topology — that's a flow diagram, not a card grid.

**The rule: let the data shape choose the visualization, not the template.**

### What Stays
- BP design tokens (copper, warm paper, borders-only depth, Instrument Serif/Outfit/JetBrains Mono)
- Page header pattern (Instrument Serif title, subtitle, action buttons)
- The warm-industrial manufacturing control room aesthetic
- All existing business logic and data fetching — we're redesigning the presentation layer

### What Changes
- Each page gets a **signature visualization** unique to its data shape
- Metrics move from cards-with-numbers to inline gauges, strata bars, and proportional indicators
- Tables that exist only to display counts or status get replaced with visual alternatives
- Cross-page links added where data flows between pages

---

## 2. Shared Visual Language

### 2.1 The Strata Bar (Signature Element)

The **Strata Bar** is a horizontal visualization showing an entity's presence and health across medallion layers. It appears on every Data page where entities are listed.

```
┌─────────────────────────────────────────────────────┐
│ ██ LZ ████ │ ███ Bronze ███ │ ██ Silver ██ │        │
│ #A8A29E    │ #9A4A1F        │ #475569      │ (Gold) │
└─────────────────────────────────────────────────────┘
```

- **Width** of each segment is proportional to row count (or equal if no count data)
- **Opacity/fill** indicates status: solid = loaded, striped = in-progress, hollow = not started
- **Height**: 6px for inline use, 12px for detail view
- Appears in: RecordCounts (primary), FlowExplorer (per-entity), SourceManager (summary)

### 2.2 Medallion Layer Colors (Canonical)

| Layer | Hex | Usage | CSS Variable |
|-------|-----|-------|--------------|
| Source | `#78716C` | Text, icons, borders | `--bp-ink-tertiary` |
| Landing Zone | `#A8A29E` | Subtle, staging area | `--bp-ink-muted` |
| Bronze | `#9A4A1F` | Warm patina | `--bp-copper-hover` |
| Silver | `#475569` | Cool steel | (new: `--bp-silver`) |
| Gold | `#8B6914` | Certification | (new: `--bp-gold`) |

Add to `index.css`:
```css
:root {
  --bp-silver: #475569;
  --bp-silver-light: #E2E8F0;
  --bp-gold: #8B6914;
  --bp-gold-light: #F5E6C8;
}
```

### 2.3 Quality Indicators

Replace text badges with inline visual indicators:

| Status | Visual |
|--------|--------|
| Match / Complete | Solid green dot + thin green rail |
| Mismatch / Error | Amber triangle pulse |
| Pending / In Progress | Animated dash pattern |
| Not Started | Hollow circle, muted |

### 2.4 Number Display

All significant numbers use JetBrains Mono with tabular-nums. Large hero numbers get:
- `font-size: 28px` for primary metrics
- `font-size: 14px` for secondary context
- A **trend indicator** (↑↓) or **proportion bar** where applicable, not just the raw number

---

## 3. Page-by-Page Specifications

---

### 3.1 RecordCounts — "The Assay Lab"

**Current**: 6 KPI cards → filter bar → sortable table with text columns for LZ/Bronze/Silver counts.

**Problem**: The entire page is a table. The user's task is to compare quantities across layers — that's fundamentally visual, not tabular.

**Redesign concept**: A **comparison matrix** where each entity is a horizontal strata bar showing relative volumes across layers, with divergence indicators built into the visualization.

#### Layout

```
┌────────────────────────────────────────────────────────────┐
│ [Instrument Serif] Record Counts                           │
│ Compare row counts across layers to verify data integrity  │
│                                          [Scan] [Export]   │
├────────────────────────────────────────────────────────────┤
│                                                            │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────────────────┐       │
│ │ LZ   │ │Bronze│ │Silver│ │ Match Rate            │       │
│ │1,247 │ │1,198 │ │1,198 │ │ ████████████░░ 87%   │       │
│ │tables│ │tables│ │tables│ │ ring gauge             │       │
│ └──────┘ └──────┘ └──────┘ └──────────────────────┘       │
│                                                            │
│ [Search...] [Filter: All ▾] [Group by: Source ▾]           │
│                                                            │
│ ─── MES (445 entities) ──────────────────────────────────  │
│                                                            │
│  Table Name        Strata Bar                    Delta     │
│  ─────────────────────────────────────────────────────     │
│  WORK_ORDER       ████████████│████████████│████████████ ✓ │
│  INVENTORY        ████████    │██████████  │██████████   Δ3│
│  BATCH_RECORD     ████████████│████████████│             B  │
│  QUALITY_HOLD     ████████████│            │             P  │
│                                                            │
│ ─── M3 ERP (596 entities) ───────────────────────────────  │
│  ...                                                       │
└────────────────────────────────────────────────────────────┘
```

#### Key Changes

1. **Match Rate ring gauge** replaces the "Matched" and "Mismatched" KPI cards. A single donut/ring with percentage in the center communicates the same info in 1/4 the space.

2. **Strata Bars replace count columns**. Each row shows a horizontal bar with three segments (LZ, Bronze, Silver) proportional to their row counts. At a glance, you can see:
   - Bars of equal length = match
   - Bars of different length = mismatch (delta shown as number)
   - Missing segment = not loaded (letter indicator: B = bronze-only, P = pending)

3. **Group by Source** — entities grouped by data source with a collapsible header showing source-level stats. This replaces the flat table that buries the source context.

4. **Scan progress** — when scanning, show a thin animated progress bar across the top of the content area, not a separate loading state.

5. **Summary strip** — the three layer cards (LZ/Bronze/Silver) become a compact summary strip at the top, not full cards. Each shows table count + total rows in a compact `1,247 tables · 12.4M rows` format.

#### Implementation Notes

- The strata bar is a new shared component: `<StrataBar lz={count} bronze={count} silver={count} />`
- The ring gauge is pure CSS (conic-gradient) — no chart library needed
- Group-by-source uses the same `allEntities` from `useEntityDigest` already fetched
- Keep the CSV export and sort functionality — just move them to the header action bar
- Keep the existing scan/poll mechanism — just improve the progress display

---

### 3.2 DataJourney — "The Expedition Map"

**Current**: Search bar → entity selector → tabbed panels (Overview, Schema, Column Diff) with nested tables.

**Problem**: A "journey" should feel like movement through space. Currently it's static panels. The column diff (the most valuable feature) is buried in a tab.

**Redesign concept**: A **vertical pipeline visualization** with station nodes at each layer, connected by lines showing the transformation applied. The column diff is promoted to the primary view.

#### Layout

```
┌────────────────────────────────────────────────────────────┐
│ [Instrument Serif] Data Journey                            │
│ Trace one entity from source to gold       [Search entity] │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ┌─[Entity Header]──────────────────────────────────────┐  │
│  │ WORK_ORDER · MES · dbo                               │  │
│  │ Full load · Last: 2h ago · 14,231 rows               │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  SOURCE ──○ m3-db1.mes.dbo.WORK_ORDER                      │
│           │ 42 columns · SQL Server                        │
│           │                                                │
│           ▼ Copy (raw, no transform)                       │
│                                                            │
│  LANDING ─○ dbo/WORK_ORDER.parquet                         │
│           │ 42 columns · Parquet · LH_DATA_LANDINGZONE     │
│           │                                                │
│           ▼ +HashedPK, +RecordLoadDate, sanitize names     │
│                                                            │
│  BRONZE ──○ dbo.WORK_ORDER                                 │
│           │ 45 columns · Delta · LH_BRONZE_LAYER           │
│           │ ┌─ Added: HashedPKColumn,                      │
│           │ │  HashedNonKeyColumns, RecordLoadDate          │
│           │ └─ 3 columns added                             │
│           │                                                │
│           ▼ +SCD2 columns, merge logic                     │
│                                                            │
│  SILVER ──○ dbo.WORK_ORDER                                 │
│           │ 50 columns · Delta · LH_SILVER_LAYER           │
│           │ ┌─ Added: IsCurrent, RecordStartDate,          │
│           │ │  RecordEndDate, IsDeleted, Action             │
│           │ └─ 5 columns added                             │
│           │                                                │
│  ┌─[Column Alignment Diagram]───────────────────────────┐  │
│  │ Source(42) ──→ Landing(42) ──→ Bronze(45) ──→ Silver(50) │
│  │                                                       │  │
│  │ [Shared columns shown as connected lines]             │  │
│  │ [Added columns shown branching in at their layer]     │  │
│  │ [Type changes highlighted with amber indicator]       │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌─[Schema Diff Table]──────────────────────────────────┐  │
│  │ Column            Bronze   Silver   Status            │  │
│  │ WORK_ORDER_ID     int      int      unchanged         │  │
│  │ RecordStartDate   —        datetime added_in_silver    │  │
│  │ ...                                                   │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

#### Key Changes

1. **Vertical pipeline** replaces tabs. All four layers visible simultaneously as a vertical flow with station nodes, connected by labeled transformation arrows. This IS the journey — visible at once.

2. **Transformation labels on the connectors** — between each layer, show what happens: "Copy (raw)", "+HashedPK, +RecordLoadDate, sanitize names", "+SCD2 columns, merge logic". These come from the existing `/api/microscope` transformations endpoint.

3. **Column count delta at each station** — show `42 → 42 → 45 → 50` columns progressing through layers, with the "+3" and "+5" additions called out inline.

4. **Column Alignment Diagram** — a visual showing how columns map across layers. Shared columns as parallel horizontal lines, added columns branching in at their layer. This replaces the flat diff table as the primary visualization.

5. **Schema diff table stays** as a secondary detail — but sorted by status (added/changed first, unchanged last).

#### Implementation Notes

- The vertical pipeline is pure HTML/CSS — no SVG needed. Station nodes as `div`s with a vertical connecting line (border-left on a wrapper).
- Transformation data comes from `/api/microscope` — call it with `layer_detail=true` to get the step descriptions.
- Column alignment diagram: render as a simple multi-row grid where each column name spans the layers it exists in. Use CSS grid with named areas.
- Keep the entity search/selector at the top — it's the entry point.
- Deep-link support: `?entity=ID` or `?table=NAME&schema=SCHEMA` (already exists).

---

### 3.3 FlowExplorer — "The Process Floor"

**Current**: Two-panel layout. Left: source groups with entity rows. Right: narrative detail panel for selected entity. Also has a "Framework Architecture" toggle showing a static pipeline topology diagram.

**Problem**: The "Data Flow" view is essentially another entity list (like SourceManager). The "Framework Architecture" view is the truly unique feature but it's hidden behind a toggle.

**Redesign concept**: Make the **pipeline topology the hero**. The entity list becomes a supporting panel, and the flow visualization becomes the primary interaction.

#### Layout

```
┌────────────────────────────────────────────────────────────┐
│ Flow Explorer                                              │
│ See how data moves through the pipeline    [Tech ↔ Simple] │
├────────────────────────────────────────────────────────────┤
│                                                            │
│ ┌─[Pipeline Topology — ALWAYS VISIBLE]──────────────────┐  │
│ │                                                        │  │
│ │  ┌──────┐     ┌──────────┐     ┌────────┐             │  │
│ │  │Source│────→│Landing   │────→│Bronze  │────→ Silver  │  │
│ │  │  DB  │     │  Zone    │     │ Layer  │     Layer    │  │
│ │  └──────┘     └──────────┘     └────────┘             │  │
│ │    5 src        1,666          1,666         1,666     │  │
│ │                                                        │  │
│ │  Click a source to filter ──→ flow highlights          │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                            │
│ ┌─[Source Swim Lanes]───────────────────────────────────┐   │
│ │                                                        │  │
│ │  MES (445)  ████████████████████████████████████████   │  │
│ │             LZ: 445 ✓  Bronze: 445 ✓  Silver: 440 ⚠   │  │
│ │                                                        │  │
│ │  M3 ERP (596) ██████████████████████████████████████   │  │
│ │               LZ: 596 ✓  Bronze: 596 ✓  Silver: 590 ⚠ │  │
│ │                                                        │  │
│ │  ETQ (29)   ████████                                   │  │
│ │             LZ: 29 ✓  Bronze: 29 ✓  Silver: 29 ✓      │  │
│ │                                                        │  │
│ │  M3C (187)  ████████████████                           │  │
│ │             ...                                        │  │
│ │                                                        │  │
│ │  OPTIVA (409) ██████████████████████████████           │  │
│ │               ...                                      │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                            │
│ ┌─[Entity Detail — appears on click]─────────────────────┐ │
│ │ [Same narrative panel as today, but as a slide-up sheet] │ │
│ └────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

#### Key Changes

1. **Pipeline topology always visible** at the top — not toggled. Show the Source → LZ → Bronze → Silver → Gold flow with aggregate counts at each stage. Clicking a source node filters the swim lanes below.

2. **Source swim lanes** replace the entity card list. Each source gets a horizontal bar showing its relative size (proportional width) and per-layer status. This shows at a glance that MES has 445 entities and 5 have Silver issues, without expanding anything.

3. **Entity detail as a slide-up sheet** — clicking a source lane or expanding it shows entity-level detail in a bottom sheet, not a side panel. This preserves the full-width topology view.

4. **Remove the Data Flow / Framework Architecture toggle** — merge the best of both into one cohesive view. The topology IS the page.

5. **Animated flow indicators** — CSS animated dashes on the connection lines between stages. When a source is selected, only its flow path animates.

6. **The "what happens to this data" narrative** stays — it's the best part of the current detail panel. Just moves to the bottom sheet.

#### Implementation Notes

- The topology diagram at top uses CSS flexbox with connecting lines (pseudo-elements). Not SVG.
- Source swim lanes: each is a `<div>` with a proportional-width inner bar. Layer status as inline badges.
- Bottom sheet: fixed at bottom, slides up on entity select, close button to dismiss.
- Keep Tech/Simple toggle — it's unique and valuable.
- Keep the animated CSS flow connectors from the current Framework Architecture view.

---

### 3.4 DataBlender — "The Laboratory"

**Current**: Left sidebar (table tree) → right panel with Profile/Blend/Preview tabs. The profiler shows stats in a sortable table. SQL Workbench docked at bottom.

**Problem**: The profiler is the crown jewel of this page but renders rich statistical data (completeness, uniqueness, null%, distinct count, min/max per column) as plain text in a table. This is a data QUALITY visualization opportunity.

**Redesign concept**: Turn the profiler output into a **column quality heatmap** — a visual matrix where each column's health dimensions are immediately visible.

#### Layout

```
┌──────────────────────────────────────────────────────────────┐
│ Data Blender                                    [Purview ✓]  │
│ Exploration sandbox                                          │
├────────┬─────────────────────────────────────────────────────┤
│        │                                                     │
│ Table  │  ┌─[Profile Summary Strip]──────────────────────┐   │
│ Tree   │  │ 14,231 rows · 42 cols · 94% complete · 2 ⚠  │   │
│        │  └──────────────────────────────────────────────┘   │
│ Layer  │                                                     │
│  ├ LZ  │  ┌─[Column Quality Heatmap]────────────────────┐   │
│  ├ Brz │  │                                              │   │
│  ├ Slv │  │  Column          Complete  Unique  Type      │   │
│  └ Gld │  │  ─────────────────────────────────────────   │   │
│        │  │  WORK_ORDER_ID   ██████    ██████  int    K  │   │
│ Tables │  │  BATCH_NO        ██████    █████░  varchar   │   │
│  ├ ... │  │  STATUS          ██████    █░░░░░  varchar   │   │
│  ├ ... │  │  CREATED_DATE    █████░    ██████  datetime  │   │
│  └ ... │  │  NOTES           ██░░░░    █████░  text   ⚠  │   │
│        │  │  LEGACY_FLAG     ██████    ░░░░░░  bit    ⚠  │   │
│        │  │                                              │   │
│        │  │  ██ = 90-100%  █░ = 50-90%  ░░ = <50%       │   │
│        │  └──────────────────────────────────────────────┘   │
│        │                                                     │
│        │  ┌─[Data Quality Signals]───────────────────────┐   │
│        │  │ ⚠ NOTES: 62% null — consider if needed       │   │
│        │  │ ⚠ LEGACY_FLAG: single value (0) — constant   │   │
│        │  └──────────────────────────────────────────────┘   │
│        │                                                     │
│        │  ┌─[SQL Workbench — collapsible]─────────────────┐  │
│        │  │ SELECT TOP 100 * FROM [dbo].[WORK_ORDER]      │  │
│        │  │                                    [Run ▶]    │  │
│        │  └──────────────────────────────────────────────┘  │
└────────┴─────────────────────────────────────────────────────┘
```

#### Key Changes

1. **Column Quality Heatmap** replaces the sortable text table. Each column gets a row with:
   - **Completeness bar**: filled proportional to `100 - nullPercentage` (green → amber → red gradient)
   - **Uniqueness bar**: filled proportional to `distinctCount / rowCount` ratio
   - **Data type icon**: visual type indicator (int, varchar, datetime, bit, text)
   - **Key indicator**: "K" badge for likely primary keys (100% unique + 100% complete)
   - **Warning flag**: ⚠ for columns flagged by garbage detection

2. **Profile Summary Strip** replaces 4 KPI cards. A single compact bar: `14,231 rows · 42 cols · 94% complete · 2 warnings`. Denser, more informative.

3. **Color intensity encodes quality** — the bars use a gradient from full-opacity (healthy) to low-opacity (problematic). At a glance, you can see which columns are the problem children.

4. **Garbage signals promoted** — the quality signals panel moves below the heatmap (currently hidden in a collapsed section). These are the actionable insights.

5. **Blend Suggestions and Preview** — keep as tabs but style the suggestions as relationship cards with mini entity-pair diagrams.

#### Implementation Notes

- The heatmap bars are simple `<div>`s with percentage width and background color.
- Completeness: `width: ${100 - nullPercentage}%`, color gradient based on value.
- Uniqueness: `width: ${(distinctCount / rowCount) * 100}%`
- No chart library needed — pure CSS.
- Keep the existing profiler API call and data shape — just change the rendering.
- The table tree sidebar stays as-is — it's well-designed and layer-grouped.

---

### 3.5 SqlExplorer — "The Observatory"

**Current**: Left sidebar (object tree: servers/DBs/schemas/tables + lakehouses) → right panel (Columns tab, Data tab).

**Problem**: The tree is functional but the detail panel is a plain HTML table. The rich schema metadata (types, PKs, nullability, precision) could be visualized. Also, server health is buried in individual tree dots.

**Redesign concept**: Add a **server health summary bar** at the top and enhance the column detail with a **schema fingerprint** visualization.

#### Layout

```
┌────────────────────────────────────────────────────────────┐
│ SQL Object Explorer                       [Read-Only Mode] │
├────────────────────────────────────────────────────────────┤
│ ┌─[Server Health Bar]──────────────────────────────────┐   │
│ │ ● MES online  ● M3 ERP online  ○ ETQ offline        │   │
│ │ ● M3C online  ● OPTIVA online    3 lakehouses       │   │
│ └──────────────────────────────────────────────────────┘   │
├────────┬───────────────────────────────────────────────────┤
│        │                                                   │
│ Object │  ┌─[Table Header]────────────────────────────┐    │
│ Tree   │  │ dbo.WORK_ORDER · MES · 14,231 rows        │    │
│        │  │ [Columns] [Data] [→ Profile in Blender]    │    │
│ Source │  └────────────────────────────────────────────┘    │
│  ├ MES │                                                   │
│  ├ M3  │  ┌─[Schema Fingerprint]──────────────────────┐    │
│  ├ ETQ │  │                                            │    │
│  └ ... │  │  ┌──┬────┬──┬──────┬────┬──┬──┬─────┐     │    │
│        │  │  │PK│ int│PK│varchar│date│  │  │bit  │     │    │
│ Fabric │  │  │  │    │  │      │    │  │  │     │     │    │
│  ├ LZ  │  │  └──┴────┴──┴──────┴────┴──┴──┴─────┘     │    │
│  ├ Brz │  │  42 columns · 2 PKs · 38 nullable         │    │
│  └ Slv │  └────────────────────────────────────────────┘    │
│        │                                                   │
│        │  ┌─[Column Detail Table]─────────────────────┐    │
│        │  │ # │ Column         │ Type    │ PK │ Null  │    │
│        │  │ 1 │ WORK_ORDER_ID  │ int     │ 🔑 │ NO    │    │
│        │  │ 2 │ BATCH_NO       │ varchar │    │ YES   │    │
│        │  │ ...                                       │    │
│        │  └───────────────────────────────────────────┘    │
│        │                                                   │
│        │  ┌─[Type Distribution]───────────────────────┐    │
│        │  │ varchar: 24 │ int: 10 │ datetime: 5 │ ... │    │
│        │  │ ██████████████ ████████ ████                │    │
│        │  └───────────────────────────────────────────┘    │
└────────┴───────────────────────────────────────────────────┘
```

#### Key Changes

1. **Server Health Bar** — compact strip at the top showing all server connection statuses at a glance. Green dot = online, hollow = offline. Replaces having to scan the tree for status dots.

2. **Schema Fingerprint** — a horizontal strip of colored blocks where each block is a column. Width proportional to data type size (int = narrow, varchar(max) = wide). Color by type family (numeric = blue, string = neutral, datetime = amber, boolean = green). PK columns get a gold top border. This gives an instant visual sense of the table's shape.

3. **Type Distribution bar** — compact horizontal stacked bar below the fingerprint showing the proportion of each data type. Answers "what kind of table is this?" at a glance.

4. **"Profile in Blender" link** — when viewing a Fabric lakehouse table, show a link to DataBlender with pre-selected table params. Cross-page navigation.

5. **Ordinal numbers visible** — add a `#` column to the column detail table showing `ORDINAL_POSITION`.

#### Implementation Notes

- Server health bar: fetch from `/api/sql-explorer/servers` (already has `status` field). Render as a flex row of status indicators.
- Schema fingerprint: map `DATA_TYPE` to a color family, `CHARACTER_MAXIMUM_LENGTH` or type-specific defaults to width. Render as a flex row of colored divs.
- Type distribution: group columns by type family, count, render as a proportional bar.
- Cross-page link: `<Link to={/blender?lakehouse=${lh}&schema=${s}&table=${t}}>`. DataBlender needs to accept these URL params (add `useSearchParams` init).
- Keep the resizable sidebar, tree structure, and data preview — they work well.

---

### 3.6 SourceManager — "The Command Center"

**Current**: Action banner → 4 KPI cards → Entity Registry/Load Optimization tabs → expandable source groups with entity tables → Gateway connections section.

**Problem**: KPI cards are generic (just counts). The entity table within each source group is a plain table. With 596 M3 ERP entities, the page becomes a massive scrolling list.

**Redesign concept**: Replace KPI cards with **source proportion circles** showing relative scale. Add **pipeline enrollment indicators** per source showing LZ/Bronze/Silver registration completeness.

#### Layout

```
┌────────────────────────────────────────────────────────────┐
│ Source Manager                        [+ New Data Source]   │
│ Register and manage pipeline sources                       │
├────────────────────────────────────────────────────────────┤
│                                                            │
│ ┌─[Source Overview]────────────────────────────────────┐    │
│ │                                                      │    │
│ │  ┌────────┐ ┌────────────────┐ ┌──────────┐         │    │
│ │  │  MES   │ │   M3 ERP       │ │ OPTIVA   │         │    │
│ │  │  445   │ │     596        │ │   409    │         │    │
│ │  │ ██████ │ │ ████████████   │ │ ████████ │         │    │
│ │  │ L✓B✓S✓ │ │ L✓ B✓ S⚠      │ │ L✓B✓S✓  │         │    │
│ │  └────────┘ └────────────────┘ └──────────┘         │    │
│ │                                                      │    │
│ │  ┌──────────┐ ┌──────┐                               │    │
│ │  │   M3C    │ │ ETQ  │     1,666 total entities      │    │
│ │  │   187    │ │  29  │     5 sources · 3 connections  │    │
│ │  │ ████████ │ │ ████ │                                │    │
│ │  │ L✓B✓S✓  │ │L✓B✓S✓│                                │    │
│ │  └──────────┘ └──────┘                                │    │
│ └──────────────────────────────────────────────────────┘    │
│                                                            │
│ [Entity Registry] [Load Optimization]                      │
│                                                            │
│ (existing tabbed content stays, but entity rows get        │
│  strata bars instead of plain text status columns)         │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

#### Key Changes

1. **Source proportion cards** replace the 4 generic KPI cards. Each source gets a card sized proportionally to its entity count. The largest (M3 ERP, 596) gets the biggest card. Each card shows:
   - Source name and entity count
   - A mini strata bar showing L/B/S registration completeness
   - A layer status indicator (✓ = all loaded, ⚠ = some issues)

2. **Pipeline enrollment summary** per source card — at a glance, see which sources have complete LZ/Bronze/Silver coverage vs. which have gaps.

3. **Entity rows get strata bars** — within the Entity Registry tab, each entity row includes a mini strata bar showing its layer status instead of text badges.

4. **Action status as toast** — move the action banner to a toast notification to free up vertical space.

5. **Existing functionality preserved** — onboarding wizard, load optimization tab, gateway connections, bulk delete, analyze/optimize buttons all stay.

#### Implementation Notes

- Source proportion cards: use `sourceList` from `useEntityDigest`. Card width based on `source.summary.total / maxTotal * 100%`.
- Mini strata bars: reuse the shared `<StrataBar />` component from RecordCounts spec.
- Entity row strata bars: inline version, 6px height.
- Toast: replace the action banner div with a fixed-position toast (similar to DataManager's existing toast).
- Keep all mutation endpoints and existing CRUD logic untouched.

---

### 3.7 DataManager — "The Logbook"

**Current**: Left sidebar (table categories) → right panel (data grid with inline editing, pagination, search).

**Problem**: This is the most "tool-like" page and least in need of creative visualization. But it's also the plainest. The sidebar categories are just lists. The grid has no visual quality signals.

**Redesign concept**: Keep the CRUD tool identity but add **category stat headers** and **inline health indicators** to the data grid.

#### Layout Changes (Incremental, Not Redesign)

1. **Category headers with mini stats** — each sidebar category shows a total row count badge AND a small completeness indicator (e.g., "Source Systems: 5 sources, all active" vs "Load Status: 12 failed entities").

2. **Boolean columns as toggle switches** (already partially implemented) — ensure all IsActive columns render as styled toggles, not checkboxes.

3. **Status columns with colored indicators** — any column containing status values (e.g., EntityStatus table's `Status` column) should render with the appropriate colored dot/badge.

4. **Row count in category labels** — already there but style with tabular-nums and muted color for consistency.

5. **Empty state per category** — when a table has 0 rows, show a relevant empty state message instead of just "No data in this table".

6. **Cross-page links** — for entity tables (LZ/Bronze/Silver entities), add a link icon on each row that opens the entity in DataJourney.

#### Implementation Notes

- Mostly incremental — enhance existing components, don't rewrite.
- Add `Link` imports for cross-page navigation.
- Status detection: check column name contains "status" or "isactive" and apply visual treatment.
- This page should be the fastest to implement since it's mostly polish.

---

## 4. Competitive Intelligence & Stolen Ideas

### Research Summary

Analyzed 12+ competing platforms: dbt Explorer, Dagster, Monte Carlo, Atlan, Select Star, Secoda, Soda, Collibra, Alation, Mage AI, Prefect, and general dashboard design leaders.

### Ideas We're Stealing (with attribution)

#### 4.1 Lenses System (from dbt Explorer)

dbt Explorer's killer feature: same DAG graph, different "lenses" overlaid — execution status, column evolution, performance. One visualization, many views.

**Apply to FlowExplorer**: Same pipeline topology, but toggle between:
- **Status Lens** — shows loaded/error/pending per entity (default)
- **Freshness Lens** — shows time-since-last-load, heatmapped from green (fresh) to red (stale)
- **Volume Lens** — Sankey-style proportional connectors where width = row count flowing through each stage
- **Quality Lens** — overlay quality scores per entity at each layer

Implementation: Each lens is a `Record<string, (entity: DigestEntity) => { color: string; width?: number; label?: string }>` mapping. The topology layout stays fixed; only the visual encoding changes.

#### 4.2 Staleness Root Cause Tracing (from Dagster)

Dagster doesn't just mark assets as stale — it traces through the dependency graph to show WHY. "Asset X is stale because upstream Asset Y was updated 2h ago."

**Apply to DataJourney + FlowExplorer**: When an entity has errors, trace the root cause:
- Silver failed? Show it's because Bronze PK merge conflict.
- Bronze never loaded? Show it's because LZ copy timed out.
- LZ timed out? Show the source server was offline.

Data source: `lastError` field in `DigestEntity` + `/api/microscope` transformation chain.

#### 4.3 Materialization Metadata & Run History (from Dagster)

Every Dagster run carries rich metadata: row counts, timestamps, duration, rendered charts. They display these as a per-asset timeline.

**Apply to RecordCounts + FlowExplorer**: Add **run history sparklines** — tiny inline charts showing the last N loads per entity. Data comes from `engine_task_log` table via `/api/data-manager/table/engine_task_log`.

#### 4.4 Anomaly Timeline (from Monte Carlo)

Monte Carlo shows freshness, volume, and schema anomalies as a timeline with root cause overlays. Not just "current state" but "how did we get here."

**Apply to RecordCounts**: Add a timeline view option — show how row counts have changed over the last N loads. Surface sudden drops or spikes. Data: build from `engine_task_log` TotalRowsRead/Written history.

#### 4.5 Popularity Tracking (from Select Star)

Select Star scores tables by query frequency — how many times queried, by how many people. Surfaces the most relevant assets.

**Apply to DataBlender + SqlExplorer**: Show "popularity" based on pipeline load frequency from engine run history. Most-loaded entities get a "hot" indicator. Entities never loaded get a "cold" indicator. Helps users focus on what matters.

#### 4.6 Sankey-Style Proportional Connectors (from Flourish/D3)

Pipeline flow diagrams where link width = volume of data flowing through each stage. Way more informative than uniform arrows.

**Apply to FlowExplorer topology**: The Source → LZ → Bronze → Silver connectors become proportional to entity count per source. MES (445) gets a thick pipe. ETQ (29) gets a thin one. Immediately communicates relative scale.

#### 4.7 AI Chat with Domain Context (from Secoda + our knowledge base)

Secoda pioneered "ChatGPT for your data stack." But their AI only knows schema metadata.

**Our moat**: We have structured domain knowledge (IP Corp companies, systems, data flows, glossary, contacts, gotchas) that no generic tool can match. See Section 5.

### What We're NOT Stealing

- Soda's code-based checks workflow — our system is metadata-driven, not YAML-driven
- Collibra's heavy governance model — overkill for our use case
- Mage AI's notebook interface — we already have SqlWorkbench which is better scoped

---

## 5. AI Assistant with Dynamic Visualizations

### 5.1 The Vision

An AI assistant panel available on every Data page that:
1. **Understands the domain** — IP Corp manufacturing, MES boundaries, Batch IDs, system relationships
2. **Sees the current context** — which page, which entity, what's selected, what's visible
3. **Answers in visuals, not just text** — generates structured JSON that renders as React components inline

This is inspired by [Google A2UI](https://github.com/google/A2UI) (Agent-to-User Interface) — "safe like data, expressive like code." The AI describes UI INTENT as declarative JSON; the frontend renders it from a pre-approved component catalog.

### 5.1.1 CRITICAL: Integration & Visibility Rules

**SDK Only — NEVER API Key**: The AI integration MUST use the **Claude Agent SDK** exclusively. No API key route. No `ANTHROPIC_API_KEY` environment variable. The backend uses the Agent SDK client which authenticates via Claude Max OAuth token (same pattern as Open-Cowork/Cortex). This is non-negotiable.

**Admin Toggle — Complete Invisibility**: The AI assistant feature is controlled by a boolean setting in the Admin/Settings page:
- `aiAssistantEnabled: boolean` (default: `false`)
- When **disabled**: Zero AI artifacts visible anywhere. No chat bubbles, no "Ask AI" buttons, no assistant panel toggle, no suggested questions, no AI-related UI elements whatsoever. The pages must look 100% like they were designed without AI in mind.
- When **enabled**: The full AI assistant panel, suggested questions, and visualization generation become available across all Data pages.
- The toggle lives in Settings → Features (or a dedicated "AI Features" subsection in Admin).
- State persisted to `localStorage` key `fmd_ai_assistant_enabled` and optionally to the backend config.
- All AI-related React components use a shared `useAiEnabled()` hook that gates rendering. Components return `null` when disabled — no hidden DOM elements, no placeholder divs, nothing.

**Showcase Mode**: Steve must be able to demo the dashboard to stakeholders with zero indication that AI features exist. This means the toggle must be a clean on/off with no "disabled" ghost state.

### 5.2 Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ FRONTEND (React)                                                     │
│                                                                      │
│  ┌──────────────────┐  ┌───────────────────────────────────────────┐│
│  │ Data Page         │  │ AI Assistant Panel                        ││
│  │ (e.g. RecordCounts│  │                                           ││
│  │  FlowExplorer,    │  │  [?] Ask about your data...               ││
│  │  DataJourney...)  │  │                                           ││
│  │                   │  │  > "Why is WORK_ORDER missing from Silver?"││
│  │                   │  │                                           ││
│  │                   │  │  WORK_ORDER failed the SCD2 merge in     ││
│  │                   │  │  Silver due to a PK collision on 3/14.   ││
│  │                   │  │                                           ││
│  │                   │  │  ┌─[Generated Pipeline Diagram]────────┐ ││
│  │                   │  │  │ Source ✓ → LZ ✓ → Bronze ✓ → Silver ✗│ ││
│  │                   │  │  └─────────────────────────────────────┘ ││
│  │                   │  │                                           ││
│  │                   │  │  ┌─[Generated Run History]─────────────┐ ││
│  │                   │  │  │ ████████████████░░░░  (last 7 loads) │ ││
│  │                   │  │  │ 3/10 ✓ 3/11 ✓ 3/12 ✓ 3/13 ✓ 3/14 ✗ │ ││
│  │                   │  │  └─────────────────────────────────────┘ ││
│  │                   │  │                                           ││
│  │                   │  │  Recommendation: Check sp_UpsertEntity   ││
│  │                   │  │  for duplicate HashedPKColumn values.    ││
│  └──────────────────┘  └───────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ BACKEND (/api/ai/ask)                                                │
│                                                                      │
│  Input:                                                              │
│    - question: string                                                │
│    - pageContext: { page, selectedEntity?, filters?, visibleData? }  │
│                                                                      │
│  Claude Agent SDK call with system context:                                │
│    - knowledge/IP-CORP-SYSTEM-OVERVIEW.md                            │
│    - knowledge/ipcorp-knowledge.md                                   │
│    - knowledge/entities/glossary.json                                │
│    - knowledge/entities/dataflows.json                               │
│    - knowledge/entities/systems.json                                 │
│    - knowledge/learnings/gotchas.json                                │
│    - Live entity digest (current pipeline state)                     │
│    - Visualization component catalog schema                          │
│                                                                      │
│  Output:                                                             │
│    {                                                                 │
│      "text": "WORK_ORDER failed the SCD2 merge...",                  │
│      "visualizations": [                                             │
│        {                                                             │
│          "type": "pipeline-status",                                  │
│          "props": {                                                  │
│            "entity": "WORK_ORDER",                                   │
│            "layers": [                                               │
│              { "name": "Source", "status": "ok" },                   │
│              { "name": "Landing", "status": "ok" },                  │
│              { "name": "Bronze", "status": "ok" },                   │
│              { "name": "Silver", "status": "error",                  │
│                "error": "PK collision in SCD2 merge" }               │
│            ]                                                         │
│          }                                                           │
│        },                                                            │
│        {                                                             │
│          "type": "run-history",                                      │
│          "props": {                                                  │
│            "runs": [                                                 │
│              { "date": "3/10", "status": "ok" },                     │
│              { "date": "3/14", "status": "error" }                   │
│            ]                                                         │
│          }                                                           │
│        }                                                             │
│      ],                                                              │
│      "suggestions": [                                                │
│        "Check sp_UpsertEntityStatus for duplicate HashedPKColumn",   │
│        "View in Data Microscope for row-level comparison"            │
│      ],                                                              │
│      "links": [                                                      │
│        { "label": "View in Data Microscope", "href": "/microscope?..."}│
│      ]                                                               │
│    }                                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.3 Pre-Approved Visualization Component Catalog

The AI can reference any of these component types in its response. The frontend has pre-built React components for each:

| Component Type | Props | Visual |
|---------------|-------|--------|
| `pipeline-status` | `entity, layers[{name, status, error?}]` | Horizontal pipeline with colored nodes |
| `strata-bar` | `lz, bronze, silver, gold` | Proportional layer bar |
| `sparkline` | `data[{x, y}], color, height` | Tiny inline chart |
| `completeness-heatmap` | `columns[{name, completeness, uniqueness}]` | Color-coded grid |
| `comparison-table` | `headers[], rows[][]` | Compact diff table |
| `stat-card` | `label, value, trend?, delta?` | Single metric with context |
| `entity-lineage` | `nodes[{id, type}], edges[{from, to}]` | Mini graph diagram |
| `run-timeline` | `runs[{date, status, rowCount?, duration?}]` | Horizontal timeline |
| `quality-gauge` | `score, label, thresholds` | Arc gauge (0-100) |
| `source-map` | `sources[{name, count, status}]` | Proportional source circles |

### 5.4 Knowledge Context Loading Strategy

The backend loads context in layers (not all at once — keeps token usage efficient):

1. **Always loaded** (~2K tokens): Business glossary terms, system names, company structure
2. **Page-specific** (~1K tokens): Relevant data flows, known gotchas for the current page's domain
3. **Entity-specific** (on demand): Entity digest data for the selected entity, recent run history
4. **Deep context** (only if needed): Full knowledge docs, deployment details, pipeline failure reports

### 5.5 Per-Page AI Context & Example Queries

| Page | Default AI Context | Example Queries |
|------|-------------------|-----------------|
| **RecordCounts** | Layer counts, match rates, anomaly thresholds | "Why do Bronze and Silver counts differ for MES tables?" / "Which source has the most mismatches?" / "Show me the trend for WORK_ORDER counts" |
| **DataJourney** | Selected entity's full pipeline state, transformation chain, schema diff | "What transformations happen between Bronze and Silver?" / "Why are there 5 extra columns in Silver?" / "Is this entity's SCD2 working correctly?" |
| **FlowExplorer** | Source-level summaries, pipeline health, error patterns | "Which sources have the most failures?" / "Show me the data flow for OPTIVA" / "Why is ETQ fully loaded but M3C has gaps?" |
| **DataBlender** | Selected table's profile, column statistics, related tables | "What is the CONO column?" / "Which columns have data quality issues?" / "What tables could I join this with?" |
| **SqlExplorer** | Server connectivity, database metadata, table relationships | "What tables are related to MITMAS?" / "Is the MES server healthy?" / "How many tables does M3 ERP have?" |
| **SourceManager** | Source registration status, load optimization state, connection health | "Is OPTIVA fully registered?" / "Which entities need watermark configuration?" / "Show me the cascade impact of removing this source" |
| **DataManager** | Table metadata, row counts, edit history | "What does the EntityStatus table track?" / "How many entities are in error state?" / "Explain the pipeline_audit columns" |

### 5.6 UI Component: AiAssistantPanel

```
File: src/components/ai/AiAssistantPanel.tsx

Features:
  - Slide-out panel (right side) or inline expandable section
  - Text input with Ctrl+Enter to submit
  - Streaming response display (text + visualizations render as they arrive)
  - Conversation history within the session (not persisted)
  - "Suggested questions" based on current page context
  - Generated visualizations render inline between text paragraphs
  - Links to other pages render as clickable chips
  - Collapse/expand toggle — remembers state per session
  - Loading state with "Thinking..." indicator

Props:
  pageContext: {
    page: string;           // "record-counts" | "data-journey" | etc.
    selectedEntity?: DigestEntity;
    selectedSource?: string;
    filters?: Record<string, string>;
    visibleData?: unknown;  // page-specific summary data
  }
```

### 5.7 Backend Endpoint: /api/ai/ask

```
File: dashboard/app/api/routes/ai.py

POST /api/ai/ask
  Body: {
    question: string,
    pageContext: { page, selectedEntity?, filters?, visibleData? },
    conversationHistory?: { role: string, content: string }[]
  }

  Response (streamed): {
    text: string,
    visualizations: AiVisualization[],
    suggestions: string[],
    links: { label: string, href: string }[]
  }

Implementation:
  1. Load knowledge context based on pageContext.page
  2. If selectedEntity, load entity-specific data from digest
  3. Build Claude API prompt with system context + conversation history
  4. Include visualization component catalog schema in system prompt
  5. Stream response, parsing JSON visualization blocks as they arrive
  6. Return structured response

Requires:
  - Claude Agent SDK (claude_agent_sdk) — authenticates via Claude Max OAuth token
  - NEVER uses ANTHROPIC_API_KEY — Agent SDK handles auth via OAuth flow
  - Admin toggle check: returns 403 if AI features disabled
  - Knowledge files accessible at known paths
  - Entity digest available via existing /api/entity-digest endpoint
```

---

## 6. Cross-Page Navigation

Add these navigation bridges:

| From | To | Trigger |
|------|----|---------|
| RecordCounts → DataJourney | Click entity row | Already exists (Route icon) |
| FlowExplorer → DataJourney | "Deep Dive" in entity detail | Already exists |
| FlowExplorer → SourceManager | "Manage this source" link | **NEW** |
| SourceManager → FlowExplorer | "View in Flow Explorer" link | **NEW** |
| SqlExplorer → DataBlender | "Profile in Blender" (Fabric tables) | **NEW** |
| DataBlender → SqlExplorer | "View source schema" link | **NEW** |
| DataManager → DataJourney | Entity row link icon | **NEW** |
| DataJourney → DataBlender | "Profile this table" link | **NEW** |

---

## 7. Shared Refactoring

### 5.1 New Shared Component: StrataBar

```
File: src/components/data/StrataBar.tsx

Props:
  lz?: number | null      // Landing zone count/status
  bronze?: number | null   // Bronze count/status
  silver?: number | null   // Silver count/status
  gold?: number | null     // Gold count/status
  mode: 'count' | 'status' // count = proportional widths, status = equal segments
  size: 'sm' | 'md' | 'lg' // 4px, 8px, 16px height
  showLabels?: boolean     // Show layer labels below
```

Used in: RecordCounts, FlowExplorer, SourceManager, DataJourney.

### 5.2 New Shared Component: LayerStatusDot

```
File: src/components/data/LayerStatusDot.tsx

Props:
  status: 'loaded' | 'pending' | 'error' | 'not_started'
  size: 'sm' | 'md'
  pulse?: boolean
```

Replaces the various ad-hoc status badges across pages.

### 5.3 New CSS Variables

Add to `index.css`:
```css
--bp-silver: #475569;
--bp-silver-light: #E2E8F0;
--bp-gold: #8B6914;
--bp-gold-light: #F5E6C8;
```

### 5.4 Extract Shared Types

```
File: src/types/sources.ts

Export: Connection, DataSource, Pipeline, _isActive()
```

Currently duplicated in FlowExplorer and SourceManager.

---

## 8. Implementation Phases

### Phase 1: Foundation + RecordCounts + DataJourney (Highest Visual Impact)
1. Add new CSS variables (silver, gold)
2. Build `StrataBar` and `LayerStatusDot` shared components
3. Extract shared types to `src/types/sources.ts`
4. **Redesign RecordCounts** — strata bars, ring gauge, group-by-source, run history sparklines (§4.3)
5. **Redesign DataJourney** — vertical pipeline, column alignment diagram, root cause tracing (§4.2)

### Phase 2: DataBlender + SqlExplorer (Data Exploration Pair)
6. **Redesign DataBlender/TableProfiler** — column quality heatmap, summary strip, popularity indicators (§4.5)
7. **Redesign SqlExplorer/TableDetail** — server health bar, schema fingerprint, type distribution
8. Add DataBlender ↔ SqlExplorer cross-page links

### Phase 3: FlowExplorer + SourceManager (Pipeline Topology Pair)
9. **Redesign FlowExplorer** — topology hero with Sankey connectors (§4.6), lenses system (§4.1), source swim lanes
10. **Redesign SourceManager** — source proportion cards, strata bars in entity rows
11. Add FlowExplorer ↔ SourceManager cross-page links

### Phase 4: DataManager + Polish
12. **Enhance DataManager** — category stat headers, status indicators, cross-links
13. Add remaining cross-page navigation links
14. Visual consistency pass across all 7 pages

### Phase 5: AI Assistant Infrastructure (§5)
15. Build `/api/ai/ask` backend endpoint with knowledge base context loading
16. Build `AiAssistantPanel` React component with streaming response display
17. Build pre-approved visualization component catalog (10 component types)
18. Wire AI panel into all 7 Data pages with page-specific context
19. Add "Suggested questions" per page based on current state
20. Test with real queries across all pages

### Phase 6: Audit-Fix Loop
21. Full audit pass across all 7 pages — trace every data path, fix frontend bugs, document backend issues
22. Fix all documented issues
23. Re-audit until zero findings
24. Generate visual recap HTML report

---

## 9. Audit-Fix Protocol

After each phase of redesign, run an audit pass on the modified pages:

### Audit Checklist Per Page
- [ ] All API calls have error handling (try/catch, error state display)
- [ ] Loading states shown during fetches
- [ ] Empty states for no-data scenarios
- [ ] All `useEffect` cleanups (mountedRef, clearInterval, clearTimeout)
- [ ] No hardcoded source names or counts (must scale to N sources)
- [ ] All click handlers work (no dead buttons)
- [ ] Search/filter functionality correct
- [ ] Sort functionality correct
- [ ] Cross-page links use correct route params
- [ ] BP design tokens used consistently (no raw hex outside of index.css)
- [ ] Responsive: no horizontal overflow at 1280px width
- [ ] No console errors or warnings
- [ ] Keyboard accessible (tab order, focus rings)

### Final Loop Criteria
The audit-fix loop ends when:
1. Zero bugs found across all 7 pages
2. Zero visual inconsistencies
3. All cross-page links verified working
4. All loading/empty/error states verified
5. The auditor "cannot find a single negative thing to say"

---

## Appendix: File Inventory

| File | Lines | Phase |
|------|-------|-------|
| `src/pages/RecordCounts.tsx` | ~604 | 1 |
| `src/pages/DataJourney.tsx` | ~1,200 | 1 |
| `src/pages/DataBlender.tsx` | ~161 | 2 |
| `src/components/datablender/TableProfiler.tsx` | ~400 | 2 |
| `src/components/datablender/TableBrowser.tsx` | ~200 | 2 |
| `src/components/datablender/BlendSuggestions.tsx` | ~200 | 2 |
| `src/components/datablender/BlendPreview.tsx` | ~30 | 2 |
| `src/components/datablender/SqlWorkbench.tsx` | ~150 | 2 |
| `src/pages/SqlExplorer.tsx` | ~138 | 2 |
| `src/components/sql-explorer/ObjectTree.tsx` | ~800 | 2 |
| `src/components/sql-explorer/TableDetail.tsx` | ~400 | 2 |
| `src/pages/FlowExplorer.tsx` | ~1,416 | 3 |
| `src/pages/SourceManager.tsx` | ~1,617 | 3 |
| `src/pages/DataManager.tsx` | ~800 | 4 |
| `src/components/data/StrataBar.tsx` | NEW | 1 |
| `src/components/data/LayerStatusDot.tsx` | NEW | 1 |
| `src/types/sources.ts` | NEW | 1 |
| `src/index.css` | EDIT | 1 |
