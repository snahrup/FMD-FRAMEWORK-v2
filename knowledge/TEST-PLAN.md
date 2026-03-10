# FMD Framework — Comprehensive Test Plan

> **Authority**: Steve Nahrup
> **Created**: 2026-03-09 by sage-tower
> **Scope**: All 8 critical dashboard pages + API + config validation
> **Philosophy**: Every button clicked, every number validated, every GUID cross-referenced

---

## Source of Truth — Expected Values

All tests validate against these canonical values. If reality doesn't match, the test FAILS.

### Entity Counts (HARD)

| Source | Expected Count |
|--------|---------------|
| ETQ | 29 |
| M3 ERP | 596 |
| M3 Cloud | 187 |
| MES | 445 |
| OPTIVA | 409 |
| **TOTAL** | **1,666** |

- Each source × 3 layers (LZ, Bronze, Silver) = 4,998 registrations
- These counts come from `config/entity_registration.json` and are returned by `/api/entity-digest`

### Workspace IDs (from `config/item_config.yaml`)

| Name | GUID | Must appear on |
|------|------|---------------|
| INTEGRATION DATA (D) | `0596d0e7-e036-451d-a967-41a284302e8d` | EnvironmentSetup, ConfigManager |
| INTEGRATION CODE (D) | `c0366b24-e6f8-4994-b4df-b765ecb5bbf8` | EnvironmentSetup, ConfigManager |
| INTEGRATION CONFIG | `e1f70591-6780-4d93-84bc-ba4572513e5c` | EnvironmentSetup, ConfigManager |
| INTEGRATION CODE (P) | `f825b6f5-1c3d-4b5d-be8a-12e3c2523d38` | EnvironmentSetup |
| INTEGRATION DATA (P) | `5a54d6ec-bafb-4193-a1c3-00a3097c3660` | EnvironmentSetup |

**STALE IDs that must NEVER appear**: `a3a180ff`, `146fe38c`, `f442f66c`

### Lakehouse IDs (from `dashboard/app/api/config.json`)

| Layer | GUID |
|-------|------|
| Landing Zone | `99FDC434-53E8-4E36-BDFD-82535BD25F41` |
| Bronze | `319E63D9-18DE-4208-B563-F251CBA24C6F` |
| Silver | `781CDAAE-4BB5-4BEE-A322-8339D00B9F75` |

### Pipeline IDs

| Pipeline | GUID |
|----------|------|
| PL_FMD_LOAD_ALL | `e45418a4-148f-49d2-a30f-071a1c477ba9` |
| PL_FMD_LOAD_LANDINGZONE | `3d0b3b2b-*` |
| PL_FMD_LOAD_BRONZE | `8b7008ac-*` |
| PL_FMD_LOAD_SILVER | `90c0535c-*` |
| PL_FMD_LDZ_COPY_SQL | `9a06a21d-d139-4356-81d2-6d6e0630a01b` |

### Notebook IDs (from `config/item_deployment.json` — Fabric-deployed items)

| Notebook | Fabric Item ID | Role |
|----------|---------------|------|
| NB_FMD_PROCESSING_PARALLEL_MAIN | `bf2101e2-a101-b8df-43bf-5f6ba130a279` | Parallel processing engine — orchestrates entity batches |
| NB_FMD_LOAD_BRONZE_SILVER | `556fd16b-ed49-4f7b-83a8-a79252ee54f9` | Bronze→Silver SCD Type 2 merge |
| NB_FMD_LOAD_LANDING_BRONZE | `f7be6488-6508-4bcd-8c79-296a37f52a25` | Landing Zone→Bronze load |
| NB_FMD_PROCESSING_LANDINGZONE_MAIN | `a69cb3e2-52a1-abee-4335-29721d1d5828` | LZ processing (source→LZ parquet) |
| NB_FMD_DQ_CLEANSING | `893b5a96-c402-aa9a-4302-33730740d27f` | Data quality / cleansing rules |
| NB_FMD_UTILITY_FUNCTIONS | `d8d5cb97-a785-8863-406b-2bdea5c26d5c` | Shared utility functions |
| NB_FMD_CUSTOM_NOTEBOOK_TEMPLATE | `7b50d862-3afd-b3b2-467b-d1af8943964b` | Custom notebook template |
| NB_FMD_MAINTENANCE_AGENT | `c0a1nt00-0000-0000-0000-000000000001` | Maintenance agent (**placeholder ID — needs real Fabric ID**) |
| NB_FMD_ORCHESTRATOR | *(not in item_deployment.json — deployed separately?)* | REST API orchestrator (InvokePipeline workaround) |

**These notebooks ARE the execution engine.** Pipelines trigger notebooks, notebooks do the actual data movement.

### Engine Config (from `dashboard/app/api/config.json` → `engine` section)

| Field | Expected Value | Status |
|-------|---------------|--------|
| `load_method` | `"pipeline"` | OK (fixed 2026-03-09) |
| `notebook_bronze_id` | `f7be6488-6508-4bcd-8c79-296a37f52a25` | OK (fixed 2026-03-09, matches item_deployment.json) |
| `notebook_silver_id` | `556fd16b-ed49-4f7b-83a8-a79252ee54f9` | OK (fixed 2026-03-09, matches item_deployment.json) |
| `notebook_lz_id` | `a69cb3e2-52a1-abee-4335-29721d1d5828` | OK (fixed 2026-03-09) |
| `notebook_processing_id` | `bf2101e2-a101-b8df-43bf-5f6ba130a279` | OK (fixed 2026-03-09) |
| `notebook_maintenance_id` | `""` (empty — not yet deployed to Fabric) | OK |
| `pipeline_copy_sql_id` | `9a06a21d-d139-4356-81d2-6d6e0630a01b` | OK |
| `pipeline_workspace_id` | `c0366b24-e6f8-4994-b4df-b765ecb5bbf8` | OK (CODE_DEV workspace) |
| `batch_size` | 15 | OK |
| `chunk_rows` | 500,000 | OK |
| `query_timeout` | 120 | OK |
| `pipeline_fallback` | true | OK |

> **Source of truth**: `item_deployment.json` contains the actual Fabric-deployed item IDs.
> Config.json engine section was synced to match on 2026-03-09 by sage-tower.

### SQL Metadata DB

| Field | Value |
|-------|-------|
| Server | `7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433` |
| Database | `SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0` |
| SQL DB Item ID | `ed567507-5ec0-48fd-8b46-0782241219d5` |

### API Server

| Field | Value |
|-------|-------|
| Base URL | `http://127.0.0.1:8787` |
| Health endpoint | `GET /api/health` → `{"status": "ok"}` |
| Frontend URL | `http://127.0.0.1:5173` |

---

## Test Categories

| Category | Prefix | Count | What it covers |
|----------|--------|-------|---------------|
| LOAD | `T-LOAD-` | 8 | Page loads without errors |
| DATA | `T-DATA-` | 45+ | Numbers, counts, labels match expected |
| GUID | `T-GUID-` | 12+ | Workspace/lakehouse/pipeline IDs match config |
| INTERACT | `T-INT-` | 35+ | Buttons, filters, search, toggles work |
| API | `T-API-` | 20+ | Endpoint responses are correct shape and values |
| CROSS | `T-CROSS-` | 8+ | Same data shown consistently across pages |
| NEGATIVE | `T-NEG-` | 10+ | Error states, empty states, edge cases |

---

## Page 1: Execution Matrix (`/`)

### T-LOAD-01: Page loads and renders

| # | Assertion | How to verify |
|---|-----------|--------------|
| 1.1 | Page loads at `/` | `page.goto('/')` → no network errors |
| 1.2 | No console errors | Capture `page.on('console')` with level 'error', assert count = 0 |
| 1.3 | Page title or heading visible | `h1` or main heading contains "Execution" or "Matrix" |
| 1.4 | KPI cards render | At least 4 KPI card elements visible |
| 1.5 | Entity table renders | `<table>` or data grid with rows visible |
| 1.6 | Load time < 5s | Measure from navigation start to last KPI visible |

### T-DATA-01: KPI card values

| # | Card | Expected | Source |
|---|------|----------|--------|
| 1.7 | Total Entities | 1,666 (or matches `/api/entity-digest` totalEntities) | useEntityDigest hook |
| 1.8 | Success Rate % | (succeeded / total) × 100, rounded to 1 decimal | Calculated from digest |
| 1.9 | Error Count | Count of entities where overall status = "error" | entity-digest |
| 1.10 | Last Run | Status badge matches `/api/engine/status` last_run.status | engine status endpoint |

### T-DATA-02: Entity table data

| # | Assertion | How to verify |
|---|-----------|--------------|
| 1.11 | Table shows entity rows | Row count > 0 |
| 1.12 | Entity names are non-empty | Every row's "Table Name" cell has text content |
| 1.13 | Source column values are valid | Every source value is one of: ETQ, MES, M3, M3C, OPTIVA |
| 1.14 | Status badges use correct colors | "succeeded" = green, "failed" = red, "pending" = amber |
| 1.15 | Row counts are numbers | Bronze/Silver/LZ count cells contain numeric text (not NaN, not undefined) |
| 1.16 | Timestamps are parseable | Last Load Time cells parse as valid Date objects |
| 1.17 | Target Schema column present | Column header "Target Schema" exists |
| 1.18 | Data Source column present | Column header "Data Source" or "Source" exists |

### T-DATA-03: Pie chart / Layer breakdown

| # | Assertion | How to verify |
|---|-----------|--------------|
| 1.19 | Chart renders | SVG or Canvas element visible in chart area |
| 1.20 | LZ segment exists | Legend or tooltip shows "Landing Zone" or "LZ" |
| 1.21 | Bronze segment exists | Legend or tooltip shows "Bronze" |
| 1.22 | Silver segment exists | Legend or tooltip shows "Silver" |
| 1.23 | Segment counts sum to total | LZ + Bronze + Silver succeeded+failed+pending = total displayed |

### T-INT-01: Filters and search

| # | Action | Expected Result |
|---|--------|----------------|
| 1.24 | Type "ETQ" in search box | Table filters to ~29 rows (ETQ entities only) |
| 1.25 | Select "Failed" from status filter | Only rows with failed status badges shown |
| 1.26 | Select "MES" from source filter | Only MES rows shown (~445 max) |
| 1.27 | Clear search box | All rows return |
| 1.28 | Click "Table Name" column header | Rows sort alphabetically (asc), click again for desc |
| 1.29 | Click "Source" column header | Rows group by source name |
| 1.30 | Combined filter: source=ETQ + status=succeeded | Shows only ETQ entities that succeeded |

### T-INT-02: Time range and refresh

| # | Action | Expected Result |
|---|--------|----------------|
| 1.31 | Click "1h" time range | Metrics refresh, API called with `?hours=1` |
| 1.32 | Click "24h" time range | Metrics refresh, API called with `?hours=24` |
| 1.33 | Click "7d" time range | Metrics refresh, API called with `?hours=168` |
| 1.34 | Toggle auto-refresh ON | New API calls appear every 5 seconds (network tab) |
| 1.35 | Toggle auto-refresh OFF | API calls stop |
| 1.36 | Click manual refresh button | Data reloads, loading indicator shown briefly |

### T-INT-03: Entity drill-down

| # | Action | Expected Result |
|---|--------|----------------|
| 1.37 | Click on an entity row | Row expands to show detail panel |
| 1.38 | Detail panel shows log entries | At least one log entry with rows_read, rows_written, duration |
| 1.39 | Log entry timestamps are valid | Parseable ISO dates |
| 1.40 | Click expanded row again | Detail panel collapses |

---

## Page 2: Engine Control (`/engine`)

### T-LOAD-02: Page loads and renders

| # | Assertion |
|---|-----------|
| 2.1 | Page loads at `/engine` without errors |
| 2.2 | No console errors |
| 2.3 | Engine status badge visible (idle/running/stopping/error) |
| 2.4 | Control buttons visible (Execute, Stop, etc.) |
| 2.5 | Layer selector visible (Landing/Bronze/Silver checkboxes) |
| 2.6 | Load time < 5s |

### T-DATA-04: Engine status display

| # | Data Point | Validation |
|---|------------|-----------|
| 2.7 | Status badge | Text matches `/api/engine/status` → status field |
| 2.8 | Status badge color | idle=gray, running=green, stopping=amber, error=red |
| 2.9 | Uptime display | Matches `uptime_seconds` from API, formatted correctly |
| 2.10 | Engine version | Displayed, matches API response `engine_version` |
| 2.11 | Duration KPI | If last_run exists, shows formatted duration (amber) |
| 2.12 | Rows KPI | If last_run exists, shows TotalRowsRead as formatted number |
| 2.13 | Current run ID | If running, shows UUID matching `current_run_id` from API |
| 2.14 | Load method | Shows "local" or "pipeline" text |

### T-INT-04: Engine control buttons

| # | Action | Expected Result |
|---|--------|----------------|
| 2.15 | Execute button clickable when idle | Button is enabled, not grayed out |
| 2.16 | Stop button disabled when idle | Button is grayed out / not clickable |
| 2.17 | Click Execute (Plan mode) | POST to `/api/engine/plan`, execution plan renders |
| 2.18 | Execution plan shows entity count | plan.entity_count displayed |
| 2.19 | Execution plan shows layer breakdown | plan.layer_plan[] items displayed |
| 2.20 | Execution plan shows warnings | plan.warnings[] displayed if any |
| 2.21 | Layer checkboxes toggle | Check/uncheck Landing/Bronze/Silver, state updates |
| 2.22 | Mode toggle (Run/Plan) | Toggle between actual execution and dry-run |
| 2.23 | Retry button | Enabled only after failed run, POST to `/api/engine/retry` |

### T-INT-05: Live log panel

| # | Action | Expected Result |
|---|--------|----------------|
| 2.24 | Log panel visible during run | Panel element exists with scrollable content |
| 2.25 | SSE connection established | EventSource to `/api/engine/logs/stream` opens |
| 2.26 | Log entries appear in real-time | New entries append as they arrive |
| 2.27 | Log panel scrollable | Can scroll up to see older entries |

### T-DATA-05: Polling behavior

| # | Check | Expected |
|---|-------|----------|
| 2.28 | Engine status polls every 5s | Network tab shows recurring GET /api/engine/status |
| 2.29 | Fabric jobs poll every 15s | Network tab shows recurring GET /api/engine/jobs |
| 2.30 | Health polls every 10s | Network tab shows recurring GET /api/engine/health |

---

## Page 3: Control Plane (`/control`)

### T-LOAD-03: Page loads and renders

| # | Assertion |
|---|-----------|
| 3.1 | Page loads at `/control` without errors |
| 3.2 | No console errors |
| 3.3 | Source breakdown cards visible |
| 3.4 | Layer completion bars visible |
| 3.5 | Load time < 5s (should be <2s from SQLite) |

### T-DATA-06: Entity counts match truth

| # | Data Point | Expected Value | Source |
|---|------------|---------------|--------|
| 3.6 | Total entities | 1,666 | `/api/control-plane` total count |
| 3.7 | ETQ card count | 29 | Source breakdown |
| 3.8 | MES card count | 445 | Source breakdown |
| 3.9 | M3 ERP card count | 596 | Source breakdown |
| 3.10 | M3 Cloud card count | 187 | Source breakdown |
| 3.11 | OPTIVA card count | 409 | Source breakdown |
| 3.12 | Source counts sum | 29+445+596+187+409 = 1,666 | Arithmetic validation |

### T-DATA-07: Layer completion

| # | Data Point | Validation |
|---|------------|-----------|
| 3.13 | LZ progress bar | Shows % = (LZ succeeded / 1666) × 100 |
| 3.14 | Bronze progress bar | Shows % = (Bronze succeeded / 1666) × 100 |
| 3.15 | Silver progress bar | Shows % = (Silver succeeded / 1666) × 100 |
| 3.16 | Progress bar colors | Green for completed portion, gray for remaining |
| 3.17 | Percentage label matches bar | Text "XX%" matches visual fill width |

### T-DATA-08: Status aggregation

| # | Check | Validation |
|---|-------|-----------|
| 3.18 | Succeeded + Failed + Pending = Total | Per layer, counts must sum to total |
| 3.19 | Status badges correct colors | succeeded=green, failed=red, pending=amber |
| 3.20 | No "unknown" or "null" statuses | Every entity has a valid status string |

### T-INT-06: Control plane interactions

| # | Action | Expected Result |
|---|--------|----------------|
| 3.21 | Click Resync button | POST to `/api/entity-digest/resync`, loading indicator, counts refresh |
| 3.22 | Polling at 30s intervals | Network tab shows recurring GET /api/control-plane every 30s |
| 3.23 | Tab visibility pause | Switch to another browser tab, polling pauses; switch back, resumes |
| 3.24 | Source card click | Navigates to source detail or expands entity list (if implemented) |

---

## Page 4: Live Monitor (`/monitor`)

### T-LOAD-04: Page loads and renders

| # | Assertion |
|---|-----------|
| 4.1 | Page loads at `/monitor` without errors |
| 4.2 | No console errors |
| 4.3 | Activity log area visible |
| 4.4 | Time window selector visible |

### T-DATA-09: Live activity data

| # | Check | Validation |
|---|-------|-----------|
| 4.5 | Activity entries have timestamps | Every log entry has a parseable timestamp |
| 4.6 | Entity names are valid | Non-empty strings |
| 4.7 | Status values are valid | One of: succeeded, failed, running, pending |
| 4.8 | Row counts are numbers | Non-negative integers |

### T-INT-07: Monitor interactions

| # | Action | Expected Result |
|---|--------|----------------|
| 4.9 | Change time window to 5m | API called with `?minutes=5`, fewer entries shown |
| 4.10 | Change time window to 60m | API called with `?minutes=60`, more entries shown |
| 4.11 | Auto-refresh fires | New API calls at configured interval (~10s) |
| 4.12 | Status badges color-coded | Green/red/amber/blue for different statuses |

---

## Page 5: Record Counts (`/records`)

### T-LOAD-05: Page loads and renders

| # | Assertion |
|---|-----------|
| 5.1 | Page loads at `/records` without errors |
| 5.2 | No console errors |
| 5.3 | "Load Counts" button visible |
| 5.4 | Summary cards area visible (5 cards) |

### T-DATA-10: Summary cards

| # | Card | Validation |
|---|------|-----------|
| 5.5 | Bronze card | Shows count of bronze tables + total row count |
| 5.6 | Silver card | Shows count of silver tables + total row count |
| 5.7 | Matched card | Shows count + match rate % |
| 5.8 | Mismatched card | Shows count + single-layer count |
| 5.9 | Total card | Shows unique table count |
| 5.10 | Match rate % formula | matched / total × 100, matches displayed value |
| 5.11 | Card icons correct | Bronze=Table2(amber), Silver=Sparkles(violet), Matched=CheckCircle2(green), Mismatched=AlertTriangle(amber) |

### T-DATA-11: Table data

| # | Check | Validation |
|---|-------|-----------|
| 5.12 | Table Name column | Every row has non-empty table name |
| 5.13 | Schema column | Monospace, non-empty |
| 5.14 | Data Source column | Shows source name or "(unlinked)" in gray |
| 5.15 | Bronze Rows column | Numeric, right-aligned, amber color (#f59e0b) |
| 5.16 | Silver Rows column | Numeric, right-aligned, violet color (#8b5cf6) |
| 5.17 | Delta column | |Bronze - Silver|, amber+bold if > 0, gray if 0 |
| 5.18 | Status badge | "Match" (green) / "Mismatch" (amber) / "Bronze only" (gray) / "Silver only" (gray) |
| 5.19 | Journey link | Route icon links to `/journey?table=X&schema=Y` |
| 5.20 | Row numbers use tabular-nums | CSS `font-variant-numeric: tabular-nums` on number cells |

### T-INT-08: Search, filter, sort

| # | Action | Expected Result |
|---|--------|----------------|
| 5.21 | Search "ETQ" | Table filters to ETQ tables only |
| 5.22 | Filter "Matched" | Only green-badge rows shown |
| 5.23 | Filter "Mismatched" | Only amber-badge rows shown |
| 5.24 | Filter "Bronze only" | Only single-layer bronze rows |
| 5.25 | Sort by Delta desc | Largest mismatches at top |
| 5.26 | Sort by Table Name asc | Alphabetical |
| 5.27 | "Showing X of Y" label | Matches visible vs total row count |

### T-INT-09: Actions

| # | Action | Expected Result |
|---|--------|----------------|
| 5.28 | Click "Load Counts" | API call to `/api/lakehouse-counts`, loading indicator, data populates |
| 5.29 | Click "Force Refresh" | API call with `?force=1`, bypasses cache |
| 5.30 | Cache age displays | Shows "Xs ago" in monospace after load |
| 5.31 | Click "Export CSV" | Downloads CSV file with current filtered data |
| 5.32 | Demo mode indicator | If mock data, amber "Demo Data" badge visible |

---

## Page 6: Source Manager (`/sources`)

### T-LOAD-06: Page loads and renders

| # | Assertion |
|---|-----------|
| 6.1 | Page loads at `/sources` without errors |
| 6.2 | No console errors |
| 6.3 | Gateway connections section visible |
| 6.4 | Registered data sources section visible |
| 6.5 | Source groups collapsible |

### T-DATA-12: Source inventory

| # | Check | Expected |
|---|-------|----------|
| 6.6 | All 5 sources listed | ETQ, MES, M3 ERP, M3 Cloud, OPTIVA groups visible |
| 6.7 | ETQ entity count | 29 entities shown |
| 6.8 | MES entity count | 445 entities shown |
| 6.9 | M3 ERP entity count | 596 entities shown |
| 6.10 | M3 Cloud entity count | 187 entities shown |
| 6.11 | OPTIVA entity count | 409 entities shown |
| 6.12 | Total matches | Sum of all source groups = 1,666 |

### T-DATA-13: Entity details

| # | Check | Validation |
|---|-------|-----------|
| 6.13 | LandingzoneEntityId present | Every entity row shows an integer ID |
| 6.14 | Table name non-empty | Every entity has a table name |
| 6.15 | Schema non-empty | Every entity has a source schema |
| 6.16 | IsActive flag | Shows active/inactive indicator |
| 6.17 | IsIncremental flag | Shows incremental/full-load indicator |
| 6.18 | Watermark column | If incremental, shows watermark column name |

### T-INT-10: Multi-select and bulk operations

| # | Action | Expected Result |
|---|--------|----------------|
| 6.19 | Click entity checkbox | Entity selected (checkbox checked) |
| 6.20 | Click source group checkbox | All entities in group selected |
| 6.21 | Partial selection indicator | Group checkbox shows indeterminate when some selected |
| 6.22 | Bulk register button | Enabled when entities selected, POST to `/api/register-bronze-silver` |
| 6.23 | Bulk delete button | Enabled when selected, shows confirmation dialog |
| 6.24 | Confirmation dialog | Shows entity count, requires explicit confirm |

### T-INT-11: Search and navigation

| # | Action | Expected Result |
|---|--------|----------------|
| 6.25 | Search by entity name | Filters across all source groups |
| 6.26 | Expand/collapse source group | Click toggle, group opens/closes |
| 6.27 | Expand All button | All source groups expand |
| 6.28 | Collapse All button | All source groups collapse |
| 6.29 | Add Source button | Opens onboarding wizard modal |

### T-INT-12a: Source Onboarding Wizard (CRITICAL — Zero-Friction Flow)

> This is the #1 UX gap. Adding a source must be ONE seamless operation.

| # | Step | Expected Result |
|---|------|----------------|
| 6.30 | Click "Add Source" button | Onboarding wizard modal opens |
| 6.31 | Step 1: Enter connection details | Server, database, auth fields. "Test Connection" button. |
| 6.32 | Click "Test Connection" | API validates SQL connectivity, shows success/failure |
| 6.33 | Step 2: Table discovery | System queries INFORMATION_SCHEMA.TABLES, displays all tables with checkboxes |
| 6.34 | All tables selected by default | User can deselect specific tables, but default is ALL |
| 6.35 | Table count shown | "Found X tables in [database]" |
| 6.36 | Step 3: Auto-analysis | System auto-discovers PKs, watermark columns, load method per table |
| 6.37 | Progress indicator during analysis | Spinner/progress bar while analyzing (can take 30-60s) |
| 6.38 | Load method classification shown | Each table shows "Incremental" or "Full Load" with detected watermark column |
| 6.39 | Binary watermark types excluded | rowversion/timestamp columns NOT offered as watermarks (known bad — BURNED-BRIDGES) |
| 6.40 | Step 4: Confirm | Summary: "X tables, Y incremental, Z full load. Register across LZ + Bronze + Silver?" |
| 6.41 | Click Confirm | Registers ALL entities across ALL 3 layers in one operation |
| 6.42 | Registration succeeds | Each table gets: LZ entity (IsActive=1), Bronze entity (IsActive=1), Silver entity |
| 6.43 | No separate layer registration | User NEVER sees "register bronze" or "register silver" as separate steps |
| 6.44 | Entities appear immediately | New source group visible in SourceManager with correct entity count |
| 6.45 | Entities ready to run | New entities appear in pipeline queues, "Load All" works immediately |
| 6.46 | Summary shown | "Added X tables from [source]. Y incremental, Z full load. Ready to run." |
| 6.47 | Error partial success | If some tables fail analysis, register what worked, show failure report |

### T-INT-12b: "Load Everything" Button

| # | Action | Expected Result |
|---|--------|----------------|
| 6.48 | "Load All" button visible | On EngineControl or SourceManager, single button to run full pipeline |
| 6.49 | Click "Load All" | Triggers LZ → Bronze → Silver for ALL entities, ALL sources |
| 6.50 | No layer checkboxes required | Default is all layers — user doesn't need to know about layers |
| 6.51 | Live progress shown | Entity-by-entity progress, layer-by-layer progress bars |
| 6.52 | Completion summary | "Loaded X/Y entities. Z failed. Click to see failures." |

---

## Page 7: Environment Setup (`/setup`)

### T-LOAD-07: Page loads and renders

| # | Assertion |
|---|-----------|
| 7.1 | Page loads at `/setup` without errors |
| 7.2 | No console errors |
| 7.3 | Mode selector with 3 tabs visible (Provision/Wizard/Settings) |
| 7.4 | Default mode loads correctly |

### T-DATA-14: Environment config display

| # | Check | Expected Value | Source |
|---|-------|---------------|--------|
| 7.5 | Data workspace ID | `0596d0e7-e036-451d-a967-41a284302e8d` | item_config.yaml |
| 7.6 | Code workspace ID | `c0366b24-e6f8-4994-b4df-b765ecb5bbf8` | item_config.yaml |
| 7.7 | Config workspace ID | `e1f70591-6780-4d93-84bc-ba4572513e5c` | item_config.yaml |
| 7.8 | SQL DB endpoint | Contains `7xuydsw5a3hutnnj5z2ed72tam` | config.json |
| 7.9 | No stale workspace IDs | Text content does NOT contain `a3a180ff`, `146fe38c`, `f442f66c` |

### T-GUID-01: Workspace GUID validation

| # | Check | Method |
|---|-------|--------|
| 7.10 | All displayed GUIDs match config | Extract all GUID-pattern text, cross-reference against item_config.yaml |
| 7.11 | No unknown GUIDs | Every GUID on page exists in config or is a known dynamic ID |
| 7.12 | Workspace names match IDs | "INTEGRATION DATA (D)" next to `0596d0e7-*` |

### T-INT-12: Mode switching

| # | Action | Expected Result |
|---|--------|----------------|
| 7.13 | Click Provision tab | ProvisionAll component renders |
| 7.14 | Click Wizard tab | SetupWizard component renders |
| 7.15 | Click Settings tab | SetupSettings component renders |
| 7.16 | Active tab styling | Selected tab has bg-background + shadow |
| 7.17 | Inactive tab styling | Unselected tabs have text-muted-foreground |
| 7.18 | Config loads on mount | `/api/load-config` called, data populates |

---

## Page 8: Execution Log (`/logs`)

### T-LOAD-08: Page loads and renders

| # | Assertion |
|---|-----------|
| 8.1 | Page loads at `/logs` without errors |
| 8.2 | No console errors |
| 8.3 | Tab bar with 3 tabs visible (Pipelines/Copies/Notebooks) |
| 8.4 | Data table renders with rows |
| 8.5 | View mode toggle visible (Business/Technical) |

### T-DATA-15: Pipeline execution data

| # | Check | Validation |
|---|-------|-----------|
| 8.6 | Pipeline names non-empty | Every row has a PipelineName |
| 8.7 | Status values valid | One of: succeeded, failed, inprogress, running, cancelled, queued |
| 8.8 | StartTime parseable | Valid ISO timestamp |
| 8.9 | Duration formatted | Shows "XhYm" or "Xs" or "<1s" format |
| 8.10 | Status badge colors | succeeded=green, failed=red, running=blue, cancelled=gray |
| 8.11 | Newest first by default | First row has most recent timestamp |

### T-DATA-16: Tab data

| # | Tab | Endpoint | Validation |
|---|-----|----------|-----------|
| 8.12 | Pipelines | `/api/pipeline-executions` | Returns PipelineRun[] |
| 8.13 | Copies | `/api/copy-executions` | Returns PipelineRun[] |
| 8.14 | Notebooks | `/api/notebook-executions` | Returns PipelineRun[] |

### T-INT-13: Tabs, filters, views

| # | Action | Expected Result |
|---|--------|----------------|
| 8.15 | Click "Copies" tab | Table refreshes with copy execution data |
| 8.16 | Click "Notebooks" tab | Table refreshes with notebook execution data |
| 8.17 | Click "Pipelines" tab | Returns to pipeline data |
| 8.18 | Toggle to Technical view | Raw data fields shown instead of business summaries |
| 8.19 | Toggle back to Business view | Human-readable summaries shown |
| 8.20 | Filter by "Failed" status | Only failed rows visible |
| 8.21 | Filter by "Succeeded" status | Only succeeded rows visible |
| 8.22 | Search by pipeline name | Table filters to matching rows |
| 8.23 | Click row to expand | Detail panel opens with full raw data |
| 8.24 | Sort by duration | Click Duration header, sorts asc/desc |

---

## API Endpoint Tests (T-API)

### T-API-01: Health and status

| # | Endpoint | Method | Expected |
|---|----------|--------|----------|
| A.1 | `/api/health` | GET | `{"status": "ok", "sql": "...", "mode": "production"}` |
| A.2 | `/api/engine/status` | GET | Has: status, current_run_id, uptime_seconds, engine_version |
| A.3 | `/api/engine/health` | GET | Returns 200 |
| A.4 | `/api/load-config` | GET | Returns config object |

### T-API-02: Entity digest

| # | Endpoint | Method | Expected |
|---|----------|--------|----------|
| A.5 | `/api/entity-digest` | GET | Has: sources, totalEntities |
| A.6 | `/api/entity-digest` | GET | totalEntities >= 1666 |
| A.7 | `/api/entity-digest` | GET | sources array has 5 entries |
| A.8 | `/api/entity-digest` | GET | Response time < 3000ms |

### T-API-03: Control plane

| # | Endpoint | Method | Expected |
|---|----------|--------|----------|
| A.9 | `/api/control-plane` | GET | Returns aggregated entity status |
| A.10 | `/api/control-plane` | GET | Contains source systems breakdown |
| A.11 | `/api/control-plane` | GET | Contains layer completion data |
| A.12 | `/api/control-plane` | GET | Response time < 5000ms (< 2000ms from SQLite) |

### T-API-04: Engine endpoints

| # | Endpoint | Method | Expected |
|---|----------|--------|----------|
| A.13 | `/api/engine/metrics?hours=24` | GET | Has: layers[], slowest_entities[], top_errors[] |
| A.14 | `/api/engine/runs?limit=5` | GET | Returns array of run objects |
| A.15 | `/api/engine/plan` | POST | Returns PlanResult with entity_count, layer_plan |
| A.16 | `/api/engine/entities` | GET | Returns entity list |

### T-API-05: Pipeline executions

| # | Endpoint | Method | Expected |
|---|----------|--------|----------|
| A.17 | `/api/pipeline-executions` | GET | Returns PipelineRun[] array |
| A.18 | `/api/copy-executions` | GET | Returns PipelineRun[] array |
| A.19 | `/api/notebook-executions` | GET | Returns PipelineRun[] array |

### T-API-06: Source management

| # | Endpoint | Method | Expected |
|---|----------|--------|----------|
| A.20 | `/api/gateway-connections` | GET | Returns connection objects |
| A.21 | `/api/connections` | GET | Returns SQL Server connections |
| A.22 | `/api/datasources` | GET | Returns Fabric datasources |
| A.23 | `/api/lakehouse-counts` | GET | Returns table count data |

---

## Cross-Page Consistency Tests (T-CROSS)

| # | Check | Pages | Validation |
|---|-------|-------|-----------|
| C.1 | Entity total consistent | ExecutionMatrix, ControlPlane, SourceManager | Same total entity count on all 3 pages |
| C.2 | Source counts consistent | ControlPlane, SourceManager | ETQ/MES/M3/M3C/OPTIVA counts match between pages |
| C.3 | Engine status consistent | ExecutionMatrix, EngineControl | Same status badge text on both pages |
| C.4 | Last run info consistent | ExecutionMatrix, EngineControl, ExecutionLog | Same run_id, status, duration across pages |
| C.5 | Entity digest data consistent | ExecutionMatrix, RecordCounts | Both use useEntityDigest, should show same totals |
| C.6 | Workspace IDs consistent | EnvironmentSetup, ConfigManager | Same GUIDs on both pages |
| C.7 | Layer status consistent | ControlPlane, ExecutionMatrix | LZ/Bronze/Silver pass/fail counts match |
| C.8 | Pipeline names consistent | EngineControl, ExecutionLog | Pipeline names in plan match names in log |

---

## Negative / Edge Case Tests (T-NEG)

| # | Scenario | Expected Behavior |
|---|----------|------------------|
| N.1 | API server down | Pages show error message, not blank screen |
| N.2 | Empty entity list | "No entities found" message, not crash |
| N.3 | Search with no results | "No matches" indicator, table doesn't break |
| N.4 | Very long entity name | Text truncates with ellipsis, no layout break |
| N.5 | Null timestamps | Shows "N/A" or "-", not "Invalid Date" |
| N.6 | Zero row counts | Shows "0", not empty or "NaN" |
| N.7 | Failed API response (500) | Error toast or banner, not unhandled exception |
| N.8 | Rapid filter changes | No race conditions, final state matches last selection |
| N.9 | Browser back/forward | Page state preserved, no blank renders |
| N.10 | Page visible after tab switch | Data refreshes on visibility, no stale display |
| N.11 | Concurrent refresh + filter | No UI freeze, both operations complete |

---

## GUID Validation Tests (T-GUID)

| # | Check | Pages | Method |
|---|-------|-------|--------|
| G.1 | No stale workspace `a3a180ff` | ALL pages | `page.content()` must not contain `a3a180ff` |
| G.2 | No stale workspace `146fe38c` | ALL pages | `page.content()` must not contain `146fe38c` |
| G.3 | No stale workspace `f442f66c` | ALL pages | `page.content()` must not contain `f442f66c` |
| G.4 | DATA_DEV workspace if shown | EnvironmentSetup | Contains `0596d0e7` |
| G.5 | CODE_DEV workspace if shown | EnvironmentSetup | Contains `c0366b24` |
| G.6 | CONFIG workspace if shown | EnvironmentSetup | Contains `e1f70591` |
| G.7 | LZ lakehouse GUID if shown | Any page displaying lakehouse | Contains `99FDC434` (case-insensitive) |
| G.8 | Bronze lakehouse GUID if shown | Any page | Contains `319E63D9` (case-insensitive) |
| G.9 | Silver lakehouse GUID if shown | Any page | Contains `781CDAAE` (case-insensitive) |
| G.10 | Pipeline IDs match config | EngineControl, ExecutionLog | Any displayed pipeline GUID matches known list |
| G.11 | SQL DB endpoint correct | EnvironmentSetup | Contains `7xuydsw5a3hutnnj5z2ed72tam` |
| G.12 | No hardcoded "localhost" in GUIDs | ALL pages | No GUID-like strings that are actually test placeholders |

---

---

# TIER 2 — Pipeline Operations & Data Quality (14 pages)

> After all 8 critical pages pass, shore up these. They cover pipeline ops, data quality, and config management.

## Page 9: Pipeline Monitor (`/pipeline` → redirects, or via nav)

| # | Route | Tests |
|---|-------|-------|
| 9.1 | `/pipeline` or via PipelineMatrix | Page loads without errors, no console errors |
| 9.2 | | Pipeline list renders with names matching known pipeline IDs |
| 9.3 | | Status badges show correct colors for each pipeline state |
| 9.4 | | Run history table shows recent executions |

## Page 10: Error Intelligence (`/errors`)

| # | Tests |
|---|-------|
| 10.1 | Page loads, no console errors |
| 10.2 | Error list populated from API (or shows "No errors" if clean) |
| 10.3 | Error grouping/aggregation works (by entity, by error type) |
| 10.4 | Error details expandable |
| 10.5 | Filter by source/layer/time range |

## Page 11: Admin Gateway (`/admin`)

| # | Tests |
|---|-------|
| 11.1 | Page loads, no console errors |
| 11.2 | Gateway connections listed |
| 11.3 | Connection status indicators (green/red) |
| 11.4 | Refresh button works |

## Page 12: Flow Explorer (`/flow`)

| # | Tests |
|---|-------|
| 12.1 | Page loads, no console errors |
| 12.2 | Flow visualization renders (SVG/Canvas) |
| 12.3 | Pipeline chain visible: LZ → Bronze → Silver |
| 12.4 | Nodes clickable, show detail panel |

## Page 13: Data Blender (`/blender`)

| # | Tests |
|---|-------|
| 13.1 | Page loads, no console errors |
| 13.2 | SQL workbench area renders |
| 13.3 | Table profiler component loads |
| 13.4 | Query execution returns results |

## Page 14: Config Manager (`/config`)

| # | Tests |
|---|-------|
| 14.1 | Page loads, no console errors |
| 14.2 | Config JSON displayed correctly |
| 14.3 | Workspace IDs match `item_config.yaml` source of truth |
| 14.4 | No stale workspace IDs (`a3a180ff`, `146fe38c`, `f442f66c`) |
| 14.5 | Edit/save functionality works (if enabled) |
| 14.6 | Engine config section shows correct load_method |
| 14.7 | Notebook IDs displayed match `item_deployment.json` |

## Page 15: Notebook Config (`/notebook-config`)

| # | Tests |
|---|-------|
| 15.1 | Page loads, no console errors |
| 15.2 | All 8 notebooks listed with correct names |
| 15.3 | Notebook IDs match `item_deployment.json` |
| 15.4 | Notebook status indicators (deployed/not deployed) |

## Page 16: Pipeline Runner (`/runner`)

| # | Tests |
|---|-------|
| 16.1 | Page loads, no console errors |
| 16.2 | Pipeline selection dropdown populated |
| 16.3 | Run button triggers API call |
| 16.4 | Status updates during execution |
| 16.5 | Results displayed on completion |

## Page 17: Validation Checklist (`/validation`)

| # | Tests |
|---|-------|
| 17.1 | Page loads, no console errors |
| 17.2 | Checklist items rendered |
| 17.3 | Pass/fail indicators per check |
| 17.4 | Run validation button triggers checks |

## Page 18: Notebook Debug (`/notebook-debug`)

| # | Tests |
|---|-------|
| 18.1 | Page loads, no console errors |
| 18.2 | Notebook list populated |
| 18.3 | Debug output area renders |

## Page 19: SQL Explorer (`/sql-explorer`)

| # | Tests |
|---|-------|
| 19.1 | Page loads, no console errors |
| 19.2 | Object tree renders with schemas/tables |
| 19.3 | Table click shows column detail |
| 19.4 | Query editor accepts SQL input |
| 19.5 | Execute query returns results in grid |
| 19.6 | Schema names match expected (integration, execution, logging) |

## Page 20: Load Progress (`/load-progress`)

| # | Tests |
|---|-------|
| 20.1 | Page loads, no console errors |
| 20.2 | Progress bars for each layer (LZ/Bronze/Silver) |
| 20.3 | Entity counts match 1,666 per layer |
| 20.4 | Real-time updates during active loads |
| 20.5 | Source breakdown matches expected counts |

## Page 21: Data Journey (`/journey`)

| # | Tests |
|---|-------|
| 21.1 | Page loads, no console errors |
| 21.2 | Entity journey visualization renders |
| 21.3 | Shows path: Source → LZ → Bronze → Silver → Gold |
| 21.4 | Accepts `?table=X&schema=Y` query params (linked from RecordCounts) |
| 21.5 | Timestamps at each stage are valid |

## Page 22: Settings (`/settings`)

| # | Tests |
|---|-------|
| 22.1 | Page loads, no console errors |
| 22.2 | Settings sections render (Agent Collaboration, Live Log, Post-Deployment Summary) |
| 22.3 | Settings changes persist |

---

# TIER 3 — Data Governance & Advanced Analytics (18 pages)

> Nice-to-have. These are newer pages, some may be stubs. Validate they at least load and don't crash.

## Data Governance Pages

| # | Page | Route | Minimum Tests |
|---|------|-------|--------------|
| 23 | **DQ Scorecard** | `/labs/dq-scorecard` | Loads, no errors, score visualization renders |
| 24 | **Cleansing Rule Editor** | `/labs/cleansing` | Loads, no errors, rule list renders, add/edit/delete works |
| 25 | **SCD Audit** | `/labs/scd-audit` | Loads, no errors, SCD type display per entity |
| 26 | **Gold MLV Manager** | `/labs/gold-mlv` | Loads, no errors, MLV list renders |
| 27 | **Admin Governance** | *(via nav)* | Loads, no errors, governance policies listed |
| 28 | **Data Classification** | `/classification` | Loads, no errors, classification tags render |
| 29 | **Data Catalog** | `/catalog` | Loads, no errors, searchable entity catalog |

## Advanced Analytics Pages

| # | Page | Route | Minimum Tests |
|---|------|-------|--------------|
| 30 | **Data Profiler** | `/profile` | Loads, no errors, column statistics render |
| 31 | **Column Evolution** | `/columns` | Loads, no errors, schema change history renders |
| 32 | **Data Microscope** | `/microscope` | Loads, no errors, detailed entity inspection works |
| 33 | **Sankey Flow** | `/sankey` | Loads, no errors, Sankey diagram SVG renders |
| 34 | **Transformation Replay** | `/replay` | Loads, no errors, transformation steps render |
| 35 | **Impact Pulse** | `/pulse` | Loads, no errors, impact visualization renders |
| 36 | **Impact Analysis** | `/impact` | Loads, no errors, dependency graph renders |
| 37 | **Data Lineage** | `/lineage` | Loads, no errors, lineage graph renders |

## Testing & Observability Pages

| # | Page | Route | Minimum Tests |
|---|------|-------|--------------|
| 38 | **Test Audit** | `/test-audit` | Loads, no errors, test history renders |
| 39 | **Test Swarm** | `/test-swarm` | Loads, no errors, swarm status renders |
| 40 | **MRI Dashboard** | `/mri` | Loads, no errors, run history renders, screenshots display |

---

## Tier 2/3 Per-Page Minimum Assertions

Every page in Tier 2 and Tier 3 gets AT MINIMUM these checks:

| # | Check | How |
|---|-------|-----|
| T2.1 | Page loads at its route | `page.goto(route)`, no timeout |
| T2.2 | No console errors | `page.on('console', level='error')` count = 0 |
| T2.3 | No unhandled exceptions | No uncaught promise rejections |
| T2.4 | Main content area renders | At least one heading or data element visible |
| T2.5 | No "undefined" or "NaN" in page text | `page.textContent()` does not contain "undefined" or "NaN" |
| T2.6 | No blank/white screen | Page has visible content, not just empty shell |
| T2.7 | Navigation back works | Click browser back, previous page loads correctly |
| T2.8 | No stale GUIDs | Page content does not contain `a3a180ff`, `146fe38c`, `f442f66c` |

---

## Test Execution Order

1. **API tests first** (T-API) — validate backend works before testing UI
2. **Tier 1 page load tests** (T-LOAD) — confirm all 8 critical pages render
3. **Tier 1 data validation** (T-DATA) — check every number and label
4. **Tier 1 GUID validation** (T-GUID) — cross-reference every ID
5. **Tier 1 interaction tests** (T-INT) — click every button, apply every filter
6. **Cross-page consistency** (T-CROSS) — same data on multiple pages
7. **Negative tests** (T-NEG) — error states and edge cases
8. **Tier 2 pages** — pipeline ops, data quality, config management (14 pages)
9. **Tier 3 pages** — governance, analytics, observability (18 pages)

---

## Total Test Count

| Category | Tests |
|----------|-------|
| **Tier 1 Critical (8 pages)** | |
| Page loads (T-LOAD) | ~48 |
| Data validation (T-DATA) | ~85 |
| GUID validation (T-GUID) | ~12 |
| Interactions (T-INT) | ~88 (includes onboarding wizard) |
| API endpoints (T-API) | ~23 |
| Cross-page (T-CROSS) | ~8 |
| Negative (T-NEG) | ~11 |
| **Tier 2 (14 pages)** | |
| Per-page validation | ~70 (8 baseline + specific per page) |
| **Tier 3 (18 pages)** | |
| Per-page baseline | ~144 (8 checks × 18 pages) |
| **TOTAL** | **~489 test assertions across 40 pages** |
