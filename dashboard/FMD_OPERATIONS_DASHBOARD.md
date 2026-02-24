# FMD Operations Dashboard

A purpose-built operations console for the Fabric Metadata-Driven (FMD) Framework. The dashboard provides real-time visibility into every layer of the medallion data architecture, from source system connections through Landing Zone, Bronze, Silver, and Gold. It surfaces pipeline health, error diagnostics, data lineage, record-level validation, and administrative governance in a single interface, replacing the need to navigate between Fabric portal tabs, SQL queries, and manual spot-checks.

**Stack:** React + TypeScript, Vite, Tailwind CSS, Lucide icons, Python API server
**API Server:** Python HTTP server on port 8787 — queries Fabric SQL Analytics endpoints, PowerBI Gateway REST API, and the FMD metadata database
**Design System:** Dark theme with light mode toggle, glassmorphism cards, responsive sidebar layout

---

## Pages

### 1. Pipeline Monitor

**Route:** `/` (Home)
**Purpose:** Real-time inventory and categorization of all FMD pipelines across the medallion architecture.

**Features:**
- Summary stat cards showing total pipeline count, Landing Zone pipelines, Transform pipelines (Bronze + Silver), and Orchestration pipelines (Load + Taskflow)
- Pipeline distribution bar chart breaking down counts by category with color-coded bars
- Searchable pipeline list with text search across pipeline names
- Category filter dropdown: All, Landing Zone, Bronze, Silver, Orchestration, Utility
- Expandable pipeline cards showing execution details, workspace assignment, and status
- Medallion progress indicator visualizing which architecture layer each pipeline targets
- Category badges with layer-specific color coding (Blue for LDZ, Amber for Bronze, Purple for Silver, Emerald for Orchestration, Slate for Utility)
- Active/Inactive status badges per pipeline
- "Awaiting first run" indicator when no execution data exists yet
- Auto-refresh with manual refresh button
- Automatic categorization based on pipeline naming conventions (`_LDZ_`, `_BRONZE_`, `_SILVER_`, `_LOAD_`, `_TASKFLOW_`)

---

### 2. Control Plane

**Route:** `/control`
**Purpose:** Single-pane-of-glass health dashboard showing the real-time state of the entire FMD data platform.

**Features:**
- Overall system health indicator with five states: Operational (green), Degraded (amber), Critical (red), Initial Setup (blue), and Offline (red)
- Summary cards for active connections, data sources, total entities, and active pipelines
- Full medallion data flow visualization: Source Systems → Landing Zone → Bronze → Silver → Gold/Business, with entity counts at each stage and directional arrows
- Source systems grid (3-column layout) showing each namespace with connection count, data source breakdown, and per-source status dots
- Pipeline health section with success rate progress bar, succeeded/failed/running/total counts, and scrollable recent run list (up to 10 entries with pipeline name, start time, status badge, and duration)
- Infrastructure footer listing all workspaces, lakehouses, active pipeline count, and platform metadata
- Auto-refresh toggle with manual refresh button
- Snapshot mode banner when the SQL database is unreachable (displays cached data with warning)
- Last-refreshed timestamp with human-readable "time ago" format
- Pulsing health indicator dot

---

### 3. Error Intelligence

**Route:** `/errors`
**Purpose:** AI-powered error diagnostics with root cause analysis and resolution guidance for pipeline failures.

**Features:**
- Summary cards: Total Errors, Critical, Warnings, Info, and Errors Analyzed count
- Claude Opus 4.6 integration badge with Demo Mode indicator
- Weekly Error Analysis with inline trend timeline: color-coded heatmap bar (green/amber/red by severity) with clickable week segments, week detail strip showing critical/warning/info breakdown, and collapsible AI insight panel with thinking animation and streamed markdown response
- Error Pattern Analysis grid showing the top 5 recurring patterns (e.g., Connection Timeout, Duplicate Records) with occurrence counts
- Severity filter pills: All, Critical, Warning, Info — with active/inactive toggle styling
- Expandable error cards with header (icon, title, severity badge, occurrence count, time-ago timestamp) and detail body
- Two-column detail layout: Analysis section (What Happened, Why It Happened) and Resolution section (Source System, Suggested Fix with numbered steps)
- "Analyze with Claude" button per error card — triggers AI analysis with thinking dots animation and streamed response
- Raw error detail toggle: pre-formatted code block with full technical error output
- "Awaiting First Pipeline Execution" banner when no live data exists
- "All Clear" empty state with checkmark icon when no errors match current filters

---

### 4. Execution Log

**Route:** `/logs`
**Purpose:** Complete execution history for pipelines, copy activities, and notebooks with dual view modes.

**Features:**
- View mode toggle: Business (plain English summaries) vs Technical (full data table)
- Tab selector: Pipeline Runs, Copy Activities, Notebook Runs — each with count badges
- Quick stats row: Succeeded (green), Failed (red), Running (blue) counts
- Search input across all log fields
- Status dropdown filter: All, Succeeded, Failed, Running, Cancelled
- Sort toggle: Newest first / Oldest first
- **Business View:** Card-based layout with human-readable summary sentences (e.g., "Pipeline X completed successfully in 2m 34s"), time-ago timestamps, expandable detail grids
- **Technical View:** Full HTML table with horizontal scroll, all execution columns, sortable headers, status-colored badges, and row count footer
- Status-specific styling: Emerald for succeeded, Red for failed, Blue with spinning icon for running, Gray for cancelled
- Duration calculation from start/end timestamps rendered in human-readable format
- Empty state: Clock icon with "No Execution Logs" message

---

### 5. Source Manager

**Route:** `/sources`
**Purpose:** Register gateway connections, configure data sources, and manage landing zone entity mappings.

**Features:**
- "New Data Source" button launching an onboarding wizard modal
- Summary cards (4 columns): Gateway Connections (registered vs available), Data Sources (External SQL vs Internal), Landing Zone Entities (tables configured for ingestion), SQL Connections (on-prem via gateway)
- Action status banner: success/error alerts with dismiss button, color-coded
- Gateway connections section with search input and refresh button
- Collapsible connection cards showing: status icon (registered vs available), server → database info, status badge, auth type badge
- Expanded connection details: Connection GUID with copy-to-clipboard, server/database/encryption info, FMD framework name, naming convention tooltip, linked data sources list
- "Register Connection" button for unregistered connections
- "Open in Fabric" link for available but unregistered connections
- Registered entities table with columns: Source, Schema.Table, Output File, Path, Load Type (Incremental/Full badges), Status (Active/Inactive badges)
- Auto-generated FMD connection names following convention: `CON_FMD_{SERVER}_{SOURCE}`
- Onboarding wizard modal with fixed overlay and backdrop

---

### 6. Data Blender

**Route:** `/blender`
**Purpose:** Exploration sandbox for browsing table schemas, profiling columns, discovering join opportunities, and previewing data blends.

**Features:**
- Full-viewport layout (no page scroll — fills available height)
- Left sidebar table browser (260px fixed width) for navigating available tables
- Purview status indicator showing connection state to Microsoft Purview
- Tab system with context-sensitive enabling: Profile (always), Blend Suggestions (always), Preview (enabled after blend selection)
- Table Profiler component: column-level statistics, data types, null counts, and distribution info
- Blend Suggestions component: discovers potential join paths between selected tables
- Blend Preview component: renders join results in a preview grid
- SQL Workbench component: ad-hoc SQL query interface
- Empty state with instructions when no table is selected
- Modular component architecture with lazy-loaded sub-components

---

### 7. Flow Explorer

**Route:** `/flow`
**Purpose:** Interactive visualization of data flow through the medallion architecture with two distinct view modes.

**Features:**
- **Data Flow View:**
  - Five-column swim lane layout: Source → Landing Zone → Bronze → Silver → Gold
  - Layer headers with icons, color-coded labels, and descriptions
  - Search input filtering across tables, sources, and schemas
  - Expandable source groups showing entity progression through each layer
  - Count badges per layer showing how many tables have reached that stage
  - Individual entity rows tracing each table's journey through the architecture
  - Full/Incremental load type badges per entity
  - Dashed borders for layers not yet reached (pending)
  - Animated dashed-line flow indicators between active layers
  - Pagination with "Show more" button and remaining count
  - Footer stats: total tables and per-layer breakdown

- **Framework Architecture View:**
  - Topology diagram: Config DB → Orchestrator → Source-specific copy pipelines → Landing Zone → Processing Notebooks → Bronze → Silver
  - Fan-out/fan-in bracket visualizations showing pipeline distribution
  - Source-type-specific paths (one row per copy pipeline)
  - Animated connectors with color-coded dashed lines when highlighted
  - Click any path to see a narrative explanation of that flow

- **Detail Panel (Right Side):**
  - Selected table name, data source, and icon
  - Visual progress bar through medallion layers
  - 5-step narrative journey: Source → Landing → Bronze → Silver → Gold
  - Each step shows icon, title, description, and technical details (schema.table or file path)
  - Entity details footer: load type, format, connection, progress stage

- **Controls:**
  - View mode toggle: Data Flow vs Framework Architecture
  - Label mode toggle: Technical vs Simple (friendly names)
  - Reset button to clear all selections
  - Refresh button to reload metadata

---

### 8. Record Counts

**Route:** `/counts`
**Purpose:** Cross-layer row count comparison for spot-checking data migration accuracy between Bronze and Silver lakehouses.

**Features:**
- On-demand loading with "Load Counts" button (primary) and "Force Refresh" button (bypasses cache)
- Demo mode with pre-seeded realistic mock data (32 tables across 4 data sources) — auto-loads on first render with "Demo Data" badge
- Automatic switch to live data when API is available; demo badge disappears
- Summary cards (5 columns): Bronze tables + total rows, Silver tables + total rows, Matched count with match rate percentage, Mismatched count, Total unique tables
- Sortable data table with 7 columns: Table Name, Schema, Data Source, Bronze Rows (amber), Silver Rows (purple), Delta, Status
- Click any column header to sort ascending/descending with directional arrow indicator
- Search input filtering across table names, schemas, and data sources
- Status filter dropdown: All, Matched, Mismatched, Bronze only, Silver only — each with live counts
- Status badges: Match (green checkmark), Mismatch (amber warning), Bronze only, Silver only
- Amber background highlight on mismatched rows for quick visual scanning
- Delta column highlights non-zero values in amber bold
- CSV export button: downloads filtered/sorted view as timestamped CSV file
- Cache metadata display: shows whether data is from cache with age, or fresh with query duration
- Footer: table count across lakehouses, per-layer row totals, delta warning if totals differ
- Server-side caching: 5-minute TTL on lakehouse count queries to prevent endpoint strain
- Cross-layer metadata enrichment: joins Bronze/Silver tables with entity metadata to show data source and load type

---

### 9. Admin & Governance

**Route:** `/admin`
**Purpose:** Live framework metadata and operational governance view pulled directly from the Fabric SQL database.

**Features:**
- Health scorecard (4 columns): Pipelines (total + active + per-layer breakdown), Connections (active + data sources), Lakehouses (total + Dev vs Prod), Entities (total + per-layer breakdown)
- Entity inventory cards by layer (4 columns): Connections, Landing Zone, Bronze, Silver — each with count, status text, and color-coded left border
- **Data Lineage Swim Lanes:**
  - Per-source horizontal flow showing: Source node → Landing Zone → Bronze → Silver → Gold
  - Source nodes display data source name, connection name, and source type badge
  - Count nodes at each layer showing entity progression
  - Animated flow connectors: active (solid, moving) vs empty (faded, slow)
  - Expandable detail rows: 3-column grid listing Landing Zone entities, Bronze entities, Silver entities with schema.table names and INC/FULL load badges
  - Orphan connections (no data sources) shown with dashed borders
  - Flow summary: connected sources count with progression chain
- Workspaces & Lakehouses panel: Development (blue badges), Production (emerald badges), and Config workspaces with nested lakehouse listings
- Pipeline Inventory panel grouped by category: Landing Zone, Bronze Layer, Silver Layer, Orchestration, Utility — each with count badge and monospace pipeline name list
- Hover state dimming on swim lanes for focus
- Dynamic pipeline categorization by naming convention
- Dev (D) vs Prod (P) workspace detection

---

## Application Shell

### Sidebar Navigation

**Purpose:** Persistent navigation across all pages with responsive behavior.

**Features:**
- Three navigation groups: Operations (4 pages), Data (4 pages), Admin (1 page)
- Collapsible sidebar: 256px expanded with labels, 64px collapsed with icons only
- Active page highlight with primary background, bold text, and shadow
- Hover state with accent background color
- Smooth width transition animation on expand/collapse
- Tooltips on collapsed icon-only state
- Collapse/expand toggle button at sidebar bottom
- Mobile overlay: hamburger menu button, full sidebar overlay with 40% backdrop blur, close on backdrop click

### Header Bar

- Sticky top position with backdrop blur
- System status indicator: green pulsing dot with "System Operational" label
- Last updated timestamp
- Light/Dark theme toggle button
- DEV/MVP environment badge (amber with pulsing indicator)
- Mobile menu button (hidden on desktop)

### Content Area

- Responsive max-width container (max-w-7xl) with adaptive padding
- Full-viewport mode for Flow Explorer and Data Blender (no padding, fills height)
- Fade-in animation on route transitions
