# FMD Data Dashboard -- UX Audit Report

**Date**: 2026-03-09
**Auditor**: Visual UX Audit (non-technical user perspective)
**Scope**: 30 page screenshots from the FMD Data Pipeline Control dashboard
**Target users**: Business analysts and data engineers at IP Corp who need to monitor data flowing from on-premise SQL Server databases into Microsoft Fabric lakehouses

---

## Executive Summary

**Overall Grade: C+**

The FMD Data dashboard is a technically ambitious product with strong visual design fundamentals -- the dark theme is consistent, the sidebar navigation is well-organized, and several pages (Impact Pulse, Transformation Replay, Data Catalog) show genuine UX thoughtfulness. However, the dashboard suffers from three systemic problems that prevent a non-technical user from succeeding:

1. **Jargon overload**: Terms like "LZ", "Bronze", "Silver", "SCD", "MLV", "Watermark", "ForEach", "parquet" appear everywhere without explanation. A business analyst would hit a wall on nearly every page.
2. **Too many pages, too little content**: 30+ pages in the sidebar is overwhelming. At least 8 pages are "Coming Soon" placeholders. Several functional pages overlap significantly (Impact Analysis vs. Impact Pulse vs. Data Lineage all show similar source-to-destination flow data).
3. **Empty states dominate**: The majority of pages require entity selection before showing anything useful. A first-time user lands on empty screens with no guidance on what to do first or why they should care.

**Top 5 Critical Issues**:
1. Navigation has 20+ items with no grouping explanation -- users cannot self-orient
2. Internal architecture jargon ("Landing Zone", "Bronze", "Silver") is user-facing vocabulary everywhere
3. 8 of 30 pages are non-functional "Coming Soon" stubs that erode trust
4. Execution Log shows "status unknown" for all entries -- the primary monitoring page is broken
5. The "DEV - MVP" badge in the top-right corner signals "not ready" to every visitor

---

## Page-by-Page Audit

---

### 01. Execution Matrix -- Grade: C+

**First Impression (3-second test)**: A dense data table with red/green indicators. Looks like a monitoring dashboard for something, but what exactly? The number "1,666" is prominent but unexplained.

**What Works**:
- The large entity count (1,666) gives immediate scale context
- The Layer Health bar (Landing Zone / Bronze / Silver) provides at-a-glance status
- The red/green color coding in the table is intuitive for pass/fail
- Status filters (All, OK, Fail, Stale) at the top are well-placed

**Problems Found**:
1. **"Entity" is never defined** -- A business user would ask "entity of what?" The number 1,666 means nothing without context like "1,666 database tables being monitored". -- Add a subtitle: "Tracking 1,666 tables across 5 source databases"
2. **Column headers use jargon** -- "LZ", "BRZ", "SLV" are cryptic abbreviations. Even "Landing Zone" is an internal architecture term. -- Use "Extracted", "Staged", "Processed" or similar business-friendly terms, or at minimum provide tooltips
3. **The table shows raw database table names** (e.g., `aaa_batchaudit_tbl`, `abc_abc_batch_tbl`) -- These mean nothing to a business user. -- Add a "friendly name" or "description" column, or at least group by source system
4. **The 0% donut charts** in the header are alarming but provide no context on whether this is expected or a problem -- Add trend indicators or "expected vs actual" framing
5. **Row density is very high** -- 1,666 rows in a flat table is not scannable. -- Add source-system grouping, pagination count, or a summary-first view

**Priority**: High

---

### 02. Engine Control -- Grade: B+

**First Impression (3-second test)**: This is a control panel for starting/stopping data pipeline runs. Clear purpose, clean layout.

**What Works**:
- The status bar ("Idle", Version 3.0.0, Method Local, Uptime 27m) is excellent -- immediate system health at a glance
- "Start Run" and "Stop" buttons are prominently placed with good color contrast
- Run History table is well-structured with clear columns
- The "Succeeded" / "Aborted" status badges are color-coded and readable
- Duration formatting (79h 41m 7s) is human-readable
- "Health Check" button provides a safety net

**Problems Found**:
1. **Run IDs are truncated GUIDs** (e.g., "BA36BB7B-D...") -- These are meaningless to users. -- Replace with sequential run numbers or timestamps: "Run #6 (Mar 6)"
2. **"OK / FAIL / SKIP" column header** -- "2 / 0 / 0" is not self-explanatory. -- Use separate columns or a micro-chart showing entity outcomes
3. **"Mode: plan" vs "Mode: run"** -- Not obvious what "plan" mode means. -- Add tooltip: "Plan = dry run, Run = live execution"
4. **"Method Local"** -- What does this mean to a non-admin? -- Consider hiding this from non-admin views or adding context
5. **"Triggered by: dashboard"** -- Good that it shows trigger source, but could also show who triggered it

**Priority**: Medium

---

### 03. Control Plane -- Grade: C

**First Impression (3-second test)**: A dense metadata table. The title "Control Plane" is developer jargon -- a business user has no idea what this means.

**What Works**:
- "All Systems Operational" banner is reassuring
- Tab structure (Entity Metadata / Connections / etc.) organizes content
- The data table has sortable columns

**Problems Found**:
1. **"Control Plane" is meaningless to business users** -- This is a Kubernetes/infrastructure term. -- Rename to "System Configuration" or "Metadata Registry"
2. **The subtitle "the single source of truth driving all FMD pipelines"** uses framework-specific language -- Rewrite: "Central configuration for all data sources and processing rules"
3. **Table shows raw SQL column values** -- "All Sources (1666)" with columns like raw identifiers. -- Needs friendlier presentation for non-DBA users
4. **Small text, high density** -- The screenshot shows very small text that would be hard to read at normal zoom
5. **No clear call-to-action** -- What should a user DO on this page? Just read? Edit? -- Add contextual guidance

**Priority**: Medium

---

### 06. Source Manager -- Grade: B

**First Impression (3-second test)**: A source system registry. The KPI cards (8 Data Sources, 1666 Entities, 0 Incremental, 14 Connections) tell a clear story at the top.

**What Works**:
- KPI cards at top provide excellent summary
- Clear tab structure (Entity Registry / Load Optimization)
- Source grouping by system (ETQ, 29 tables) with expand/collapse
- Table columns (Schema.Table, Output File, Path, Load Type, Status) are well-chosen
- "Active" status badges in green are clear
- "+ New Data" button is prominently placed

**Problems Found**:
1. **"Landing Zone entities" in the subtitle** -- Business users do not think in terms of "landing zones". -- Use "Register data connections and manage which tables are extracted"
2. **"Incremental: 0" KPI** -- Shows "0 full load / 0% optimized" which is confusing. If everything is full load, is that bad? -- Add context: "0 of 1,666 tables use incremental loading (all full refresh)"
3. **"Output File" column shows `.parquet` filenames** -- "CustomerContacts.parquet" is an implementation detail. -- Hide this column by default or rename to "Target Table"
4. **"Path" column just shows "etq"** -- Redundant with the group header. -- Remove or replace with the full lakehouse path for debugging
5. **Load Type shows "Incremental" for all but header says 0 incremental** -- This is contradictory and confusing. Likely a data issue, but from UX perspective it destroys trust

**Priority**: Medium

---

### 08. Execution Log -- Grade: D

**First Impression (3-second test)**: A log viewer. But every entry says "status unknown" which screams "broken."

**What Works**:
- The tab structure (Pipeline Runs 3, Copy Activities 3335, Notebook Runs 2) gives good categorical breakdown
- Search and filter controls are well-placed
- Business/Technical toggle at top-right is a great concept
- "0 succeeded / 0 failed" summary is visible

**Problems Found**:
1. **Every entry shows "FMD_ENGINE_V3 -- status unknown"** -- This is the primary monitoring page and it looks completely broken. A user seeing this would lose all confidence in the system. -- Fix the data pipeline that populates status, or show a clear "Status data unavailable" message instead of broken entries
2. **"FMD_ENGINE_V3" is an internal system name** -- Business users do not know or care about engine version names. -- Show "Data Pipeline Run" or the specific pipeline name
3. **Entries have no timestamps visible** -- When did these runs happen? The dash (-) under each entry provides no information. -- Show start time, duration, and affected entities
4. **Massive empty space** -- Only 3 entries visible with a huge blank area below. -- Show more entries or provide a summary view when few entries exist
5. **The "Business" view toggle is selected but content is still technical** -- Business view should show "Extracted 1,666 tables from 5 sources at 2:30 AM" not engine IDs

**Priority**: Critical

---

### 10. Error Intelligence -- Grade: B-

**First Impression (3-second test)**: An error analysis page. The KPI cards (11 Total, 0 Critical, 11 Warnings, 0 Info) are immediately useful.

**What Works**:
- Severity breakdown in KPI cards (Total/Critical/Warnings/Info) is excellent
- "Top Issue" callout highlighting that 100% of errors share a root cause is very useful
- Pipeline filter dropdown allows scoping
- Search functionality present

**Problems Found**:
1. **"Top Issue: 11 of 11 errors (100%) -- Unknown Error"** -- If the system cannot classify its own errors, the "Intelligence" in the page name is misleading. -- Either invest in error classification or rename to "Error Log"
2. **"Review the raw error details. Check Fabric portal for full activity-level diagnostics."** -- This pushes the user OUT of the dashboard to solve problems. The whole point of this page should be to avoid that. -- Embed or link to specific Fabric portal pages, or provide actionable next steps
3. **"Pipeline: NB FMD LOAD LANDINGZONE MAIN"** -- Raw notebook names are not user-friendly. -- Map to friendly names: "Landing Zone Data Extraction"
4. **The error card shows "Warning" severity but the fix guidance is minimal** -- Add recommended actions, not just "review raw details"

**Priority**: High

---

### 11. Admin Gateway -- Grade: B

**First Impression (3-second test)**: A password-protected admin area. Simple, clear, and appropriate.

**What Works**:
- Clean, centered layout with clear purpose
- Lock icon reinforces security
- Single password field with "Unlock" button is straightforward
- Does not show admin content to unauthorized users

**Problems Found**:
1. **No indication of WHAT is behind the admin gate** -- "Enter the admin password to continue" -- continue to what? -- Add: "Access system configuration, deployment controls, and advanced settings"
2. **No "Forgot password" or admin contact info** -- If a user needs access, they have no recourse. -- Add "Contact your system administrator for access"
3. **The page title "Admin Access" does not appear in the sidebar** -- The nav item that led here is unclear from this screenshot
4. **No visual feedback on wrong password** -- Hopefully there is error handling, but it is not visible in the screenshot

**Priority**: Low

---

### 12. Flow Explorer -- Grade: C-

**First Impression (3-second test)**: A grid of colored tiles representing tables/databases. Very dense, hard to parse.

**What Works**:
- Grouping by source system (FTQStagingPRD, M_FMD_Staging, OptivaLive, etc.)
- Color-coded status tiles provide visual density
- Search functionality at top
- Filter buttons (All, Bronze, Silver, etc.)

**Problems Found**:
1. **Extremely high information density with no hierarchy** -- Dozens of tiny colored rectangles with abbreviated names are not scannable. -- Provide a summary view first, then drill into detail
2. **Source system names are raw database names** ("FTQStagingPRD", "M_FMD_Staging") -- These mean nothing to business users. -- Map to friendly names: "ETQ Quality System", "M3 ERP"
3. **The right panel says "Select a table to explore"** but gives no guidance on what exploring means -- Add preview information or auto-select the first item
4. **Color coding is not explained** -- What do the different colored tiles mean? No legend visible. -- Add a legend showing color = status mapping
5. **Many tiles show red indicators** -- Are these errors? Warnings? No way to tell without clicking each one

**Priority**: Medium

---

### 15. Setup Notebook Configuration -- Grade: C

**First Impression (3-second test)**: A configuration page with GUIDs and technical settings. This is purely for developers.

**What Works**:
- Warning banner ("Values still need to be set before running the setup notebook") is useful
- Workspace/Connection sections are logically organized
- "Run Setup Notebook" button with version info
- "Preview Variable File" for verification before execution

**Problems Found**:
1. **Raw GUIDs everywhere** -- "a415fc76-d9a5-4961-bc03..." is meaningless. -- Show workspace names prominently with GUIDs as secondary/collapsible detail
2. **This page should not be in the main navigation** -- Setup/deployment configuration is a one-time admin task, not a daily-use page. -- Move under Settings or Admin Gateway
3. **"NB_SETUP_FMD notebook" in the subtitle** -- Raw notebook names. -- "Framework Setup Script" or similar
4. **Workspace sections show both GUIDs and labels** which is good, but the visual hierarchy makes GUIDs too prominent

**Priority**: Low (admin-only page)

---

### 16. Pipeline Runner -- Grade: B-

**First Impression (3-second test)**: A run management page showing a "Scoped Run Active" state. Clear that something is running.

**What Works**:
- Large "Scoped Run Active" banner with orange border draws attention
- Clear breakdown: Layer = Bronze, Entities in Scope = 29 LZ / 29 Bronze / 29 Silver
- "Temporarily Deactivated" count in red makes the scope impact visible
- "Restore All Entities" button with clear call-to-action
- Helpful note: "Check the Monitoring Hub on the Pipeline Monitor page to track this run's progress"

**Problems Found**:
1. **"Scoped Run Active" / "entities are temporarily deactivated"** -- A business user would panic: "Why are things deactivated?!" -- Reframe: "Focused run in progress -- processing 29 tables from ETQ. Other tables will resume after this completes."
2. **"0 LZ / 1637 Bronze / 0 Silver" temporarily deactivated** -- The LZ/Bronze/Silver terminology is confusing. -- Use "1,637 tables paused during this focused run"
3. **The page looks sparse when a run is active** -- No progress bar, no ETA, no live status of the running entities. -- Add real-time progress: "12 of 29 tables extracted (41%)"
4. **"Ready to restore?"** -- Restore from what? This implies something is broken rather than intentionally scoped. -- Use "Resume full processing" or "End focused run"
5. **No way to see WHAT is currently running** -- Which 29 entities? What source? -- Add a collapsible entity list showing the current run scope

**Priority**: High

---

### 18. Pipeline Testing (labeled "NotebookDebug" in filename) -- Grade: B-

**First Impression (3-second test)**: A testing interface with step selection (Extract from Source / Load to Bronze / Transform to Silver). Clear workflow.

**What Works**:
- Three-step pipeline selection is excellent UX -- visual, sequential, clear
- Source and scope selection dropdowns
- "Run Test" button is prominent
- "Tables Included in Test" expandable section shows what will be tested
- Entity count shown ("This will load to bronze for X entities across all data sources")

**Problems Found**:
1. **"Extract from Source" / "Load to Bronze" / "Transform to Silver"** -- "Bronze" and "Silver" are still jargon. -- "Step 1: Extract" / "Step 2: Stage" / "Step 3: Transform"
2. **"All sources (12 tables)" scope selector** -- Good, but what 12 tables? The expandable section helps but should be open by default for small counts
3. **"Run Test" naming** -- Is this a real test with real data, or a dry run? Ambiguous. -- Clarify: "Run Test (uses live data)" or "Simulate Run"
4. **"How many rows to test?"** -- Good option but might confuse users about whether this affects production data

**Priority**: Medium

---

### 21. Data Journey -- Grade: C+

**First Impression (3-second test)**: An empty page with "Select an entity above to trace its data journey." Clear instruction but nothing to engage with.

**What Works**:
- Clean empty state with instructive text
- Entity selector dropdown at top
- Subtitle explains the concept: "See how your data transforms through Source -> Landing -> Bronze -> Silver -> Gold"

**Problems Found**:
1. **Empty state is too empty** -- No sample data, no suggested entities, no recent selections. -- Show "Popular entities" or "Recently loaded" as starting suggestions
2. **"Source -> Landing -> Bronze -> Silver -> Gold"** -- Five stages of jargon. A business user would not understand this pipeline. -- "See how your data flows from source database through processing stages to final reporting tables"
3. **No page description beyond the subtitle** -- Why would I want to trace a data journey? What will I learn? -- Add value proposition: "Track exactly where your data is and verify it arrived correctly"
4. **The entity selector has 1,666 items** -- Searching through that without guidance is daunting. -- Add source system filter first, then entity selection

**Priority**: Medium

---

### 22. Settings -- Grade: B

**First Impression (3-second test)**: A settings/deployment page with clear sections. Well-organized.

**What Works**:
- Two main tabs (Settings / Notebook Deployment) clearly separated
- "Notebook Deployment" section explains what it does
- "Start Deployment" button is prominent (green)
- "Labs" section with feature flags for Coming Soon pages
- Each lab feature has a toggle and brief description

**Problems Found**:
1. **"Notebook Deployment" as a primary settings section** -- Deploying notebooks is a developer/admin task. -- Move under Admin Gateway or a separate "Deployment" page
2. **Labs features are listed (Cleansing Rule Editor, SCD Audit View, Gold Layer/MLV Manager, DQ Scorecard)** -- but they also appear in the main sidebar navigation. -- Either hide Coming Soon pages from nav entirely OR show them but mark clearly in nav as "Labs"
3. **The "Start Deployment" button is potentially destructive** -- No confirmation dialog visible, no explanation of what will be deployed. -- Add confirmation step with preview of changes
4. **Mix of user settings and admin deployment in one page** -- These serve very different audiences. -- Separate into "Preferences" (user) and "Administration" (admin)

**Priority**: Low

---

### 23. DQ Scorecard -- Grade: D+

**First Impression (3-second test)**: "Coming Soon" placeholder. Not a real page.

**What Works**:
- LABS badge clearly marks this as unreleased
- Feature description explains what it WILL do
- Bullet list of planned features is helpful for stakeholders

**Problems Found**:
1. **This page is in the main navigation** -- Users will click it, see "Coming Soon", and be frustrated. -- Hide from nav or move to a "Roadmap" section
2. **"DQ Scorecard"** -- "DQ" = Data Quality, but this abbreviation is not expanded anywhere visible. -- At minimum use "Data Quality Scorecard"
3. **The wrench icon and "Coming Soon" pattern is reused across 4+ pages** -- This creates a pattern of disappointment as users explore the nav. -- Consolidate all Coming Soon features into a single "Upcoming Features" page

**Priority**: High (because it damages credibility to have non-functional nav items)

---

### 24. Cleansing Rule Editor -- Grade: D+

**First Impression (3-second test)**: Another "Coming Soon" placeholder. Same wrench icon, same pattern.

**What Works**:
- LABS badge
- Good feature description
- Mentions specific functions (normalize_text, fill_nulls, parse_datetime)

**Problems Found**:
1. **Same issues as DQ Scorecard** -- non-functional page in main nav
2. **"JSON cleansing rules applied during Bronze -> Silver transformation"** -- Triple jargon (JSON, Bronze, Silver). A business user would not understand any of this. -- "Data cleaning rules applied during processing"
3. **"Manage JSON cleansing rules"** -- JSON is an implementation detail that should never face users

**Priority**: High (same credibility issue)

---

### 25. SCD Audit View -- Grade: D+

**First Impression (3-second test)**: Another "Coming Soon" placeholder.

**What Works**:
- LABS badge
- Feature description

**Problems Found**:
1. **"SCD Type 2 change events"** -- SCD (Slowly Changing Dimension) is deeply technical data warehousing jargon. Even many data engineers would need to look this up. -- "Change History Tracker" or "Record Version Audit"
2. **"IsCurrent / IsDeleted distribution per table"** -- Raw column names in the feature description. -- "See which records are active, archived, or deleted"
3. **Same Coming Soon pattern fatigue**

**Priority**: High (jargon + Coming Soon compound)

---

### 26. Gold Layer / MLV Manager -- Grade: D+

**First Impression (3-second test)**: Another "Coming Soon" placeholder.

**What Works**:
- LABS badge
- Feature description mentions business concepts (Fact vs Dimension, DimDate)

**Problems Found**:
1. **"Gold Layer / MLV Manager"** -- Double jargon. "Gold Layer" is medallion architecture internal terminology. "MLV" (Materialized Lakehouse Views) is a Fabric-specific term. -- "Reporting Views Manager" or "Business Data Views"
2. **"Materialized Lakehouse Views"** -- This term is meaningless outside the Fabric ecosystem. -- "Pre-built reporting tables"
3. **Same Coming Soon fatigue**

**Priority**: High

---

### 27. Data Classification -- Grade: C+

**First Impression (3-second test)**: A functional page with entity/column counts and a classification table. Actually has data!

**What Works**:
- KPI cards (1,666 entities, 24,990 columns, sensitivity counts)
- Entity/Column filter tabs
- Classification table with PII/Sensitivity columns
- "Classification Engine Not Yet Active" banner is honest about state

**Problems Found**:
1. **"Classification Engine Not Yet Active"** -- The main feature of the page does not work yet. But at least it shows existing data. -- Better messaging: "Automatic classification coming soon. Manually tag entities below."
2. **Sensitivity columns appear empty** -- All rows show no classification, making the page feel useless despite having structure. -- Pre-populate with heuristic classifications (e.g., columns named "email", "phone", "ssn" are obviously PII)
3. **Column names like "AdjBatchAudit_tbl"** are raw table names -- Same issue as other pages
4. **The "0" counts for Confidential, Internal, Public** indicate no classification work has been done -- Add "Get Started" guidance

**Priority**: Medium

---

### 28. Data Catalog -- Grade: A-

**First Impression (3-second test)**: A browsable card grid of all data entities with source filters. This is one of the best pages.

**What Works**:
- Clean KPI summary (1,666 Registered Entities, 5 Data Sources, 100% Loaded)
- Source filter pills (All, etq, m3, m3c, mes, optiva) for quick scoping
- Card layout with entity name, schema, source badge, layer badge, and recency ("3d ago")
- Search bar with sort options (name, source)
- Each card has a consistent structure
- "Landing Zone" badge on each card shows current layer
- Grid layout is scannable and not overwhelming

**Problems Found**:
1. **"Landing Zone" badges on every card** -- This is internal layer terminology. -- Use "Extracted" or "Stage 1" or simply show a progress indicator (1/4 stages complete)
2. **"REGISTERED ENT..." truncated in KPI card** -- The card is too narrow. -- Either abbreviate properly ("Entities") or widen the card
3. **"dbo" schema shown under every entity** -- This is always "dbo", so it adds no information. -- Hide when all are the same, or show only when different
4. **"3d ago" recency** -- Good, but what does it refer to? Last loaded? Last modified? -- Clarify: "Last loaded 3d ago"
5. **Entity names are raw table names** -- Same recurring issue. At minimum, strip the `_tbl` suffix and convert underscores to spaces.

**Priority**: Low (this page is already strong)

---

### 29. Data Profiler -- Grade: C

**First Impression (3-second test)**: A table selector with a centered title. Very minimal, unclear purpose.

**What Works**:
- Data source dropdown with entity count
- Search filter for tables
- "LZ" badges show which layer the data is from
- Clean, simple layout

**Problems Found**:
1. **No page description or subtitle** -- "Select a source, entity, and layer to profile" is too terse. -- Add: "Analyze data distribution, null rates, value ranges, and patterns for any table"
2. **"LZ" abbreviation on every row** -- Use "Landing Zone" or better yet, a business-friendly term. -- Or show a layer selector separately
3. **Table list shows only entity names with no additional context** -- No row counts, no column counts, no last-profiled date. -- Add preview metrics to help users choose what to profile
4. **Empty right panel** -- After selecting a table, presumably profiling results appear. But there is no indication of what to expect. -- Show a sample profile or wireframe
5. **Very sparse for a page called "Data Profiler"** -- Users expect rich profiling tools, not just a selector

**Priority**: Medium

---

### 30. Column Evolution -- Grade: C+

**First Impression (3-second test)**: An empty entity selector. Same pattern as Data Journey.

**What Works**:
- Clean title and subtitle
- Entity selector dropdown
- Subtitle explains concept: "Watch columns animate as they transform through Source, Bronze, Silver, and Gold"

**Problems Found**:
1. **Empty state with no engagement** -- Same problem as Data Journey. No sample data, no suggestions. -- Show a curated example animation by default
2. **"Source, Bronze, Silver, and Gold"** -- Jargon
3. **"Animate"** in the description suggests visual animation -- this could be impressive if it works, but the empty state gives no preview of what the feature looks like
4. **No indication of what "column evolution" means** -- Why do columns evolve? What changes? -- Add: "See how columns are renamed, added, or transformed at each processing stage"

**Priority**: Low

---

### 31. Data Microscope -- Grade: B-

**First Impression (3-second test)**: A row-level inspection tool. The name "Microscope" is creative and the concept is clear.

**What Works**:
- The name "Data Microscope" with "Cross-layer row inspection" subtitle is evocative
- Entity selector with search
- Clear instruction: "Select an entity and primary key, then enter a primary key value to inspect data as it flows through Source, Landing Zone, Bronze, and Silver layers"
- The magnifying glass icon reinforces the concept

**Problems Found**:
1. **"Primary key value"** -- Business users may not know what a primary key is. -- "Enter a record identifier (e.g., Customer ID, Order Number)"
2. **"Source, Landing Zone, Bronze, and Silver layers"** -- Jargon
3. **Empty state needs an example** -- Show a demo row flowing through layers to illustrate the concept
4. **Requires the user to KNOW a specific primary key value** -- Most users would not have this ready. -- Add "Browse recent records" or "Pick a random record" option

**Priority**: Medium

---

### 32. Sankey Flow -- Grade: F

**First Impression (3-second test)**: A completely blank dark screen. Nothing is rendered.

**What Works**:
- Nothing. The page is entirely blank/dark.

**Problems Found**:
1. **The page is completely empty** -- No title, no sidebar, no content whatsoever. Just a dark rectangle. -- This appears to be a rendering failure. Either the page crashed or the Sankey diagram requires data that is not available.
2. **No error message** -- If the page cannot render, it should show an error or empty state. -- Add error boundary with "Unable to load Sankey diagram. No flow data available."
3. **No navigation visible** -- The sidebar is gone, suggesting a full-page crash or route error

**Priority**: Critical

---

### 33. Transformation Replay -- Grade: A-

**First Impression (3-second test)**: A beautiful step-by-step walkthrough of data transformations. This is one of the strongest pages.

**What Works**:
- Numbered steps (1, 2, 3...) with a vertical timeline connector -- excellent visual metaphor
- Layer badges (LANDING, BRONZE) with distinct colors at each step
- Transformation type badges (Pass-through, Rename, Add Columns) explain what happens
- Plain-English descriptions: "Raw data extracted from on-premises SQL Server and written as Parquet files"
- Technical Detail expandable sections for those who want depth
- Step counter ("Step 1 of 13" / "1 / 13 steps") provides progress context
- Entity selector at top for customization
- Layer transition markers between steps (LANDING > BRONZE)

**Problems Found**:
1. **"Parquet files" in the description** -- Implementation detail. -- "stored as optimized data files in the Landing Zone lakehouse"
2. **"Delta Lake table format"** -- Technical term in Step 2. -- "cloud data table format"
3. **Still uses "Landing Zone", "Bronze", "Silver" terminology** -- But the color coding and numbered steps make it more tolerable here because context is provided
4. **"HashedPKColumn" shown with a + badge in Step 3** -- Raw column name. -- "Unique record fingerprint column added"
5. **Notebook names shown (NB_FMD_LOAD_LANDING_BRONZE)** -- Technical detail that could be collapsed

**Priority**: Low (this page is already excellent)

---

### 34. Impact Pulse -- Grade: A-

**First Impression (3-second test)**: A visual flow diagram showing data moving from 5 source systems through processing layers. Immediately comprehensible.

**What Works**:
- Node-and-edge diagram is intuitive -- sources on left, processing stages flowing right
- Each source node shows entity count and error count
- Color-coded borders (green = healthy, red/pink = errors, yellow = partial)
- Layer nodes (Landing Zone, Bronze, Silver, Gold) show entity counts and loaded counts
- Animated connection lines suggest data flow
- Source legend at top with colored dots
- Zoom controls (+/-/fit) in bottom-left
- Timestamp ("Mar 9, 10:14 AM") and Refresh button

**Problems Found**:
1. **Source system names are raw database names** ("ETQStagingPRD", "m3fdbprd", "DI_PRD_Staging") -- Use friendly names: "ETQ Quality", "M3 ERP", "M3 Cloud"
2. **"errors" counts shown in red on every source** (29 errors, 592 errors, etc.) -- Are these CURRENT errors or historical? No time context. -- Add "since last run" or date qualifier
3. **Gold layer shows "0 entities"** -- This might alarm users. -- Add context: "Gold layer views are configured separately" or mark as "Not yet configured"
4. **"Landing Zone" / "Bronze" / "Silver" / "Gold"** -- Still internal terms, but the visual flow makes them more understandable here
5. **Small white rectangle in bottom-right corner** appears to be a rendering artifact or tooltip remnant

**Priority**: Low (strong page overall)

---

### 35. Impact Analysis -- Grade: B+

**First Impression (3-second test)**: An impact assessment page with clear KPI cards and a source-to-layer breakdown table. Good analytical tool.

**What Works**:
- KPI cards (1,666 Total Entities, 0 Full Chain, 1,666 Partial Chain, 0 Not Started) tell the health story immediately
- "Blast Radius" column with visual bars is an excellent concept -- shows relative risk per source
- Source Impact Overview table with per-layer columns (LZ, Bronze, Silver, Full Chain, Errors)
- "At-Risk Entities" section at bottom highlights specific problem tables
- Entity search for targeted analysis
- Color-coded numbers (green = loaded, red = errors)

**Problems Found**:
1. **"Full Chain: 0"** -- This means NO entities have completed the full pipeline. Alarming, but the "Partial Chain" framing softens it. -- Add context: "0 entities have completed all processing stages (Landing -> Bronze -> Silver -> Gold)"
2. **"Blast Radius" is dramatic jargon** -- While evocative, it might alarm business users. -- Consider "Impact Scope" or "Affected Coverage"
3. **"LZ" column header** -- Abbreviation without expansion
4. **The "0" values shown as grey circles** in Bronze/Silver columns look like disabled buttons or missing data. -- Use explicit "Not Started" text or "N/A"
5. **"Missing downstrea..." truncated in Partial Chain KPI** -- Text is cut off. -- Widen card or abbreviate differently

**Priority**: Medium

---

### 36. Data Lineage -- Grade: B

**First Impression (3-second test)**: A lineage table showing entities and their status across each layer. Functional but visually similar to Impact Analysis.

**What Works**:
- KPI cards (Total Entities, Landing Zone coverage, Bronze, Silver, Full Chain) with percentage coverage
- Per-entity row showing status at each layer (Loaded / Not Started)
- Source filter pills (All Sources, etq, m3, m3c, mes, optiva)
- Search functionality
- Row count with eye icon for Gold column

**Problems Found**:
1. **Very similar to Impact Analysis** -- Both pages show source-to-layer status per entity. -- Consider merging these or clearly differentiating their purpose
2. **"Not Started" appears for Bronze, Silver, and Gold on all rows** -- This makes the system look non-functional. -- Needs context: "Bronze processing runs daily at 2 AM" or similar scheduling info
3. **"0% coverage" for Silver** -- Alarming. Is this expected? -- Add target or trend context
4. **Column headers "LZ", "BRONZE", "SILVER", "GOLD"** -- Mix of abbreviation (LZ) and full words. -- Be consistent: either all abbreviated or all spelled out
5. **"ROWS" column shows eye icons** -- It is not clear what clicking the eye would do. -- Add tooltip or label

**Priority**: Medium

---

### 37. Test Audit -- Grade: B-

**First Impression (3-second test)**: A test results dashboard showing 0% pass rate with 13 failed tests. Clear but alarming.

**What Works**:
- Pass rate percentage (0%) with color coding (red = bad)
- Run timestamp and "48m ago" recency
- Summary stats (13 Total, 0 Passed, 13 Failed, 6s Duration)
- Pass/Fail Trend chart showing historical runs
- Result Breakdown donut chart
- Individual test result list with pass/fail icons
- "Run Audit" button and "History" link

**Problems Found**:
1. **All 13 tests failed (0% pass rate)** -- The dashboard itself has failing tests. This is a meta-problem -- the test audit tool shows the product has issues.
2. **Test names are generic** ("grid cells not overlapping", "clipped hidden by overflow", "with insufficient contrast") -- These are CSS/layout tests, not business data tests. -- Clarify that this is a UI/visual audit, not a data quality audit. The page name "Test Audit" is misleading.
3. **"ansparent main content area"** appears to be a truncated test name ("transparent...") -- Display full names
4. **Duplicate test names** -- "grid cells not overlapping" appears twice, "with insufficient contrast" appears twice. -- Deduplicate or add context to distinguish them

**Priority**: Medium

---

### 38. Test Swarm -- Grade: D

**First Impression (3-second test)**: "No test-swarm runs found." Empty page with a cryptic instruction.

**What Works**:
- The empty state message is at least present

**Problems Found**:
1. **"Run /test-swarm in Claude Code to get started"** -- This instruction references a specific developer tool (Claude Code) that business users would not have. -- This page is purely developer-facing and should not be in the main navigation
2. **"Test Swarm" is not a recognizable term** for business users -- No explanation of what it is or does
3. **No page title, subtitle, or description** -- Just the empty state message
4. **The entire page is a developer tool accidentally exposed to all users**

**Priority**: High (remove from main nav)

---

### 39. MRI (Machine Regression Intelligence) -- Grade: B

**First Impression (3-second test)**: A testing/quality dashboard with tabs (Overview, Visual, Backend, Swarm, History). KPI cards show all zeros, but structure is clear.

**What Works**:
- Full name expanded: "Machine Regression Intelligence" with description
- Tab structure for different test types
- KPI cards (Tests, Visual Diffs, API Tests, AI Risk, Iterations, Duration)
- "AI Risk: Low" is a unique and potentially valuable metric
- "Run MRI Scan" button is actionable
- Coverage data panel and AI Risk Analysis panel show clear layout intent

**Problems Found**:
1. **All metrics are 0/0** -- The page looks like it has never been used. -- Pre-populate with sample data or hide until first scan
2. **"Machine Regression Intelligence" is a coined term** -- Not standard industry terminology. Business users would not know what this means. -- Consider "Quality Assurance Dashboard" or "Automated Testing Hub"
3. **"Enable AI in .mriyaml to get visual analysis"** -- References a config file. Developer-facing instruction in a user-facing page. -- Hide or move to admin settings
4. **"Swarm" tab** -- Same unclear terminology as Test Swarm page
5. **"No coverage data" and "No AI analysis results yet"** -- Two empty panels with no guidance on how to populate them

**Priority**: Medium

---

## Consistency Check

### Color Usage
- **Green**: Consistently used for success/active/healthy across all pages. Good.
- **Red/Pink**: Consistently used for errors/failures. Good.
- **Orange/Amber**: Used for warnings AND for active nav items AND for the "DEV-MVP" badge. Slightly overloaded.
- **Teal/Cyan**: Used for the "Idle" engine status, some layer badges (Silver), and links. Minor inconsistency.
- **Purple**: Used for Bronze badges in some places, blue in others. Inconsistent layer coloring.

### Layer Color Mapping
- Landing Zone: Green badge in Data Catalog, blue text in Impact Pulse, green bar in Execution Matrix -- **INCONSISTENT**
- Bronze: Yellow/amber in Transformation Replay, purple in some places -- **INCONSISTENT**
- Silver: Teal in some places, grey in others -- **INCONSISTENT**
- Gold: Green in Impact Pulse -- only appears once

**Recommendation**: Establish a fixed color for each layer and use it EVERYWHERE. Suggested: Landing = Blue, Bronze = Amber, Silver = Silver/Grey, Gold = Gold/Yellow.

### Label Consistency
- "LZ" vs "Landing Zone" vs "Landing" -- used interchangeably across pages
- "BRZ" vs "Bronze" -- inconsistent abbreviation
- "SLV" vs "Silver" -- inconsistent abbreviation
- Source names: "etq" / "ETQ" / "ETQStagingPRD" -- three different representations of the same source
- "Entity" vs "Table" -- used interchangeably

### Status Badge Consistency
- "Active" (green), "Succeeded" (green), "Loaded" (green) -- all mean "ok" but use different words
- "Aborted" (orange), "Failed" (red), "Error" (red) -- "Aborted" vs "Failed" distinction is unclear to users
- "Unknown" (grey), "Not Started" (grey) -- ambiguous

### Number Formatting
- Entity counts: "1,666" (comma-separated) -- consistent and good
- Percentages: "100%", "0%", "36%" -- consistent
- Duration: "79h 41m 7s" -- good human-readable format
- Timestamps: "Mar 6, 07:31:30 AM" -- consistent format
- Recency: "3d ago", "48m ago" -- good relative time formatting

---

## Navigation Flow Assessment

### Can a user complete these key workflows?

**1. "What is the current health of my data pipelines?"**
- START: Execution Matrix (shows entity status grid)
- PROBLEM: User must understand "LZ/Bronze/Silver" to interpret the grid
- ALTERNATIVE: Engine Control shows run history but not per-entity health
- VERDICT: Partially achievable -- requires domain knowledge

**2. "Did last night's data load succeed?"**
- START: Engine Control (shows run history with timestamps)
- THEN: Click "Report" to see details
- PROBLEM: Run IDs are GUIDs, hard to identify "last night's" run
- VERDICT: Achievable but friction-heavy

**3. "Which tables have errors?"**
- START: Error Intelligence (shows error list)
- PROBLEM: All 11 errors show "Unknown Error" -- no actionable intelligence
- ALTERNATIVE: Impact Analysis shows "At-Risk Entities"
- VERDICT: Achievable via Impact Analysis, not via the page named "Error Intelligence"

**4. "Show me how data flows from source to destination"**
- START: Impact Pulse (visual flow diagram) -- BEST option
- ALTERNATIVE: Data Lineage (table view), Data Journey (single entity), Transformation Replay (step-by-step)
- PROBLEM: 4 different pages serve this purpose with different views -- confusing
- VERDICT: Achievable but user must discover the right page

**5. "I want to run a data load for specific tables"**
- START: Pipeline Runner (scoped run)
- PROBLEM: Shows post-run state, not clear how to START a new run from here
- ALTERNATIVE: Engine Control has "Start Run" button
- VERDICT: Split across two pages -- confusing

**6. "Where is my data right now?"**
- START: Data Catalog (browse all entities with current layer badge)
- THEN: Data Journey (trace a specific entity through layers)
- VERDICT: Achievable and relatively clear

### Navigation Structure Assessment

The sidebar has 20+ items divided into "OPERATIONS" and "DATA" groups. This is too many items for users to scan. The group names are generic and do not help users find what they need.

**Suggested restructuring**:

```
MONITOR (what is happening now)
  - Dashboard (merge Execution Matrix + Engine Control highlights)
  - Error Tracker (Error Intelligence renamed)
  - Run History (Execution Log renamed)

MANAGE (take action)
  - Run Pipeline (Engine Control + Pipeline Runner merged)
  - Test Pipeline (Pipeline Testing)
  - Source Registry (Source Manager renamed)

EXPLORE (understand data)
  - Data Catalog
  - Data Flow (Impact Pulse renamed)
  - Data Journey
  - Data Profiler

ADMIN (hidden by default, admin-only)
  - Control Plane -> System Configuration
  - Setup Notebook Configuration
  - Settings
  - Admin Gateway

LABS (clearly marked, separate section)
  - Data Quality Scorecard
  - Cleansing Rules
  - Change History (SCD Audit)
  - Reporting Views (Gold/MLV)
  - Data Classification
```

---

## Top 10 Recommendations Ranked by Impact

### 1. CRITICAL: Replace medallion architecture jargon with business-friendly terms
**Impact**: Affects EVERY page. "Landing Zone", "Bronze", "Silver", "Gold" are internal architecture labels that mean nothing to business analysts.
**Recommendation**: Use a user-facing vocabulary:
- Landing Zone -> "Extracted" or "Raw"
- Bronze -> "Staged" or "Standardized"
- Silver -> "Processed" or "Cleaned"
- Gold -> "Reporting" or "Business Ready"
Alternatively, use numbered stages: "Stage 1 (Extract)", "Stage 2 (Standardize)", "Stage 3 (Clean)", "Stage 4 (Report-Ready)"
**Effort**: Medium (text changes across ~20 components)

### 2. CRITICAL: Remove or hide non-functional "Coming Soon" pages from main navigation
**Impact**: 8 pages (DQ Scorecard, Cleansing Rules, SCD Audit, Gold/MLV Manager, Column Evolution empty state, Data Journey empty state, Test Swarm, Sankey Flow blank) show no functional content.
**Recommendation**: Move all Coming Soon features to a single "Upcoming Features" page linked from Settings. Only show pages in nav when they are functional.
**Effort**: Low (routing/nav changes only)

### 3. HIGH: Fix the Execution Log to show actual status data
**Impact**: The primary log viewer shows "status unknown" for every entry -- this is the first place a user would go to troubleshoot.
**Recommendation**: Fix the data pipeline that populates status. In the meantime, show raw data from available sources rather than "unknown."
**Effort**: Medium (backend fix required)

### 4. HIGH: Consolidate overlapping pages
**Impact**: Multiple pages serve similar purposes, confusing users about where to go.
**Recommendation**:
- Merge Impact Pulse + Impact Analysis + Data Lineage into a single "Data Flow" page with tabs for visual/table/detail views
- Merge Engine Control + Pipeline Runner into a single "Pipeline Operations" page
- Merge Data Journey + Column Evolution + Transformation Replay into a single "Data Explorer" page with tabs
**Effort**: High (significant frontend refactoring)

### 5. HIGH: Restructure navigation into task-oriented groups
**Impact**: 20+ nav items with unclear grouping makes the app feel overwhelming.
**Recommendation**: Reduce to 4 groups (Monitor, Manage, Explore, Admin) with 3-5 items each. See Navigation Structure Assessment above.
**Effort**: Medium

### 6. HIGH: Replace raw database/table names with friendly names throughout
**Impact**: "ETQStagingPRD", "m3fdbprd", "aaa_batchaudit_tbl", "dbo.CustomerContacts" appear on every data page.
**Recommendation**: Create a display name mapping (source_labels.json pattern already exists) and apply it consistently. Strip `_tbl` suffixes, convert underscores to spaces, show source system as "ETQ Quality" not "ETQStagingPRD."
**Effort**: Medium

### 7. MEDIUM: Improve empty states across all entity-selection pages
**Impact**: Data Journey, Column Evolution, Data Microscope, Data Profiler all show empty content until an entity is selected.
**Recommendation**: Show "Popular entities", "Recently loaded", or a curated example by default. Never show a blank page.
**Effort**: Low-Medium

### 8. MEDIUM: Establish and enforce consistent layer color coding
**Impact**: Layer badges use different colors on different pages, breaking the visual language.
**Recommendation**: Fix one color per layer: Landing=Blue, Bronze=Amber, Silver=Grey, Gold=Yellow. Apply to every badge, chart, and indicator.
**Effort**: Low (CSS/theme changes)

### 9. MEDIUM: Add contextual help tooltips to technical terms
**Impact**: Even with renamed terminology, some technical concepts need explanation.
**Recommendation**: Add (?) icons next to terms like "Incremental", "Full Load", "Watermark", "SCD", "MLV" with popover definitions.
**Effort**: Low

### 10. LOW: Remove the "DEV - MVP" badge from the top-right corner
**Impact**: Every page shows a red "DEV - MVP" badge that signals "this product is not ready" to every user.
**Recommendation**: Remove for any non-development deployment. If needed for developers, hide behind a debug flag.
**Effort**: Trivial

---

## Jargon Glossary -- Terms That Need to Be Replaced or Explained

| Current Term | What It Means | Suggested Replacement |
|---|---|---|
| Landing Zone / LZ | Raw data copied from source databases into Fabric lakehouses as parquet files | "Extracted" or "Raw Data" |
| Bronze / BRZ | Data with standardized column names, primary key hashes, and metadata columns added | "Staged" or "Standardized" |
| Silver / SLV | Cleaned, deduplicated, SCD Type 2 versioned data | "Processed" or "Cleaned" |
| Gold | Business-ready aggregated views and dimensional models | "Reporting" or "Business Ready" |
| Entity | A database table being tracked through the pipeline | "Table" or "Dataset" |
| SCD / SCD Type 2 | Slowly Changing Dimension -- a pattern for tracking historical record versions | "Version History" or "Change Tracking" |
| MLV | Materialized Lakehouse View -- a pre-computed reporting view in Fabric | "Reporting View" or "Pre-built View" |
| DQ | Data Quality | "Data Quality" (always spell out) |
| Watermark | A timestamp or ID column used to detect new/changed records for incremental loading | "Change Marker" or "Sync Point" |
| Parquet | A columnar file format optimized for analytics | (hide from users entirely) |
| Delta Lake | An open-source storage framework for lakehouse tables | (hide from users entirely) |
| Incremental Load | Loading only new/changed records since the last run | "Sync New Changes" or "Incremental Update" |
| Full Load | Reloading all records from scratch | "Full Refresh" |
| ForEach | A pipeline activity that processes items in parallel | (hide from users entirely) |
| HashedPKColumn | A SHA-256 hash computed from primary key columns | "Record Fingerprint" |
| IsActive | A boolean flag indicating whether an entity is enabled for processing | "Enabled" / "Disabled" |
| Blast Radius | The percentage of total entities affected by a source system's errors | "Impact Scope" |
| Control Plane | Central metadata configuration database | "System Configuration" |
| Pipeline | An automated data processing workflow | "Data Pipeline" or "Processing Job" |
| Notebook | A Fabric Spark notebook that executes processing logic | "Processing Script" |

---

## Final Assessment

The FMD Data dashboard has strong technical foundations and several genuinely impressive pages (Transformation Replay, Impact Pulse, Data Catalog, Engine Control). The dark theme is visually cohesive, the sidebar navigation provides structure, and the KPI card pattern at the top of pages gives good at-a-glance summaries.

However, the product is currently built BY engineers FOR engineers. Every page leaks implementation details -- medallion layer names, GUID identifiers, raw database names, notebook references, and Fabric-specific terminology. A business analyst handed this tool today would be lost within 30 seconds.

The path to a production-quality enterprise dashboard requires:
1. A vocabulary layer that translates technical internals to business concepts
2. Ruthless pruning of the navigation (20+ pages -> ~12 functional pages)
3. Completing or hiding the 8 non-functional placeholder pages
4. Investing in empty states that guide users rather than leaving them staring at blank screens

The bones are good. The muscle needs to be business-user shaped.
