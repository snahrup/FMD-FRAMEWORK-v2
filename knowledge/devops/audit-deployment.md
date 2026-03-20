# FMD Framework Deployment Audit

> **Purpose**: Comprehensive reference for AI agents and developers who need to understand the FMD deployment system quickly.
> **Last updated**: 2026-03-09
> **Primary entry point**: `deploy_from_scratch.py` (root of repo)

---

## 1. deploy_from_scratch.py — Master Deployment Script

**Path**: `deploy_from_scratch.py` (project root)

The single orchestrator that provisions an entire FMD environment from zero. Each phase is idempotent and can be re-run safely. Phases run sequentially; the script tracks completion state in `.deploy_state.json`.

### Phase Registry

| # | Function | Description | Key Dependencies |
|---|----------|-------------|------------------|
| 1 | `phase1_auth_config` | Authenticate SP, load `config/item_config.yaml` + `config/source_systems.yaml` | SP credentials (env vars or `.env`) |
| 2 | `phase2_resolve_capacity` | Resolve Fabric capacity ID for workspace assignment | Phase 1 (SP token) |
| 3 | `phase3_create_workspaces` | Create/verify 5 Fabric workspaces (DATA Dev/Prod, CODE Dev/Prod, CONFIG) | Phase 2 (capacity ID) |
| 4 | `phase4_create_connections` | Create gateway connections to on-prem SQL sources (MES, ETQ, M3 ERP, M3 Cloud) | Phase 3 (workspace IDs), VPN, `config/source_systems.yaml` |
| 5 | `phase5_create_lakehouses` | Create 3 lakehouses (LZ, Bronze, Silver) in DATA workspace | Phase 3 |
| 6 | `phase6_create_sql_database` | Create/verify Fabric SQL Database (`SQL_INTEGRATION_FRAMEWORK`) | Phase 3 |
| 6.5 | `phase6_5_run_setup_notebook` | Upload + trigger `NB_SETUP_FMD` notebook to deploy SQL schema (tables, procs, views) | Phase 6 (SQL DB exists), Phase 3 |
| 7 | `phase7_deploy_notebooks` | Upload all Fabric notebooks to CODE workspace with GUID remapping | Phase 3, Phase 5 (lakehouse IDs for remapping) |
| 8 | `phase8_deploy_variable_libs` | Deploy Variable Libraries (`VAR_CONFIG_FMD`) to CODE + CONFIG workspaces | Phase 3 |
| 9 | `phase9_deploy_pipelines` | Deploy all pipeline JSON definitions with template ID replacement | Phase 3, Phase 5, Phase 7 (notebook IDs), Phase 8 (var lib IDs) |
| 10 | `phase10_sql_metadata` | Populate SQL metadata tables (DataSource, Connection, Lakehouse mappings) | Phase 6.5 (schema deployed), Phase 4 (connections), Phase 5 (lakehouses) |
| 11 | `phase11_update_config` | Write resolved IDs to local `config/id_registry.json` + `dashboard/app/api/config.json` | All prior phases |
| 12 | `phase12_workspace_icons` | Set custom icons on Fabric workspaces from `config/fabric_icons.xml` | Phase 3 |
| 13 | `phase13_register_entities` | Register all entities (LZ + Bronze + Silver) from `config/entity_registration.json` | Phase 10 (metadata tables populated) |
| 14 | `phase13_5_load_optimization` | Auto-discover PKs, watermark columns, row counts from on-prem sources; set incremental flags | Phase 13 (entities registered), VPN |
| 15 | — | *(number skipped in code)* | — |
| 16 | `phase15_digest_engine` | Deploy Entity Digest Engine (EntityStatusSummary table, sp_UpsertEntityStatus, sp_BuildEntityDigest, seed data) | Phase 6.5 (schema), Phase 13 (entities) |
| 17 | `phase14_validate` | Validate workspace/lakehouse/pipeline/SQL counts match expectations | All prior phases |

### Phase Dependency Graph

```
Phase 1 (Auth)
  └─► Phase 2 (Capacity)
        └─► Phase 3 (Workspaces)
              ├─► Phase 4 (Connections) ──────────────────────────┐
              ├─► Phase 5 (Lakehouses) ──────────────────────┐    │
              │     └─► Phase 7 (Notebooks)                  │    │
              │           └─► Phase 9 (Pipelines)            │    │
              ├─► Phase 6 (SQL DB)                           │    │
              │     └─► Phase 6.5 (Setup Notebook)           │    │
              │           └─► Phase 10 (SQL Metadata) ◄──────┘────┘
              │                 └─► Phase 13 (Entities)
              │                       ├─► Phase 14 (Load Optimization)
              │                       └─► Phase 16 (Digest Engine)
              ├─► Phase 8 (Variable Libs)
              ├─► Phase 11 (Update Config) ◄── all phases
              ├─► Phase 12 (Workspace Icons)
              └─► Phase 17 (Validate) ◄── all phases
```

### State Tracking

| File | Purpose |
|------|---------|
| `.deploy_state.json` | Tracks which phases completed, resolved GUIDs, timestamps. Resumes from last success on re-run. |

---

## 2. Config Files (`config/`)

| File | Purpose | Key Fields |
|------|---------|------------|
| `item_config.yaml` | **Source of truth** for workspace IDs, connection GUIDs, SQL DB endpoint | `workspaces.workspace_data`, `workspaces.workspace_code`, `database.id`, `database.endpoint`, `connections.*` |
| `source_systems.yaml` | On-prem source database definitions. Used by Phase 4 (connections) and Phase 10 (SQL metadata). Zero Python changes to add sources. | `gateway_connections.*` (name, cred_type), `datasources.*` (connection, namespace, target_schema, type) |
| `entity_registration.json` | Entity list grouped by dataSource + schema. ~660 entities across 4 sources. | Array of `{dataSource, schema, tables[]}` |
| `id_registry.json` | Resolved workspace + database IDs. Written by Phase 11. Used by scripts that need IDs without running full deploy. | `workspaces.{DATA_DEV, CODE_DEV, CONFIG, DATA_PROD, CODE_PROD}`, `database.{db_item_id, db_endpoint}` |
| `item_deployment.json` | Notebook + pipeline item definitions for CODE workspace deployment. Maps display names to Fabric item types + IDs. | Array of `{name, type, id}` — notebooks, pipelines, variable libs |
| `item_deployment_code_business_domain.json` | Business domain notebook items for CODE workspace | Gold layer notebooks (NB_CREATE_DIMDATE, NB_CREATE_SHORTCUTS, etc.) |
| `item_deployment_data_business_domain.json` | Business domain lakehouse items for DATA workspace | `LH_GOLD_LAYER.Lakehouse` |
| `data_deployment.json` | Data workspace item definitions (lakehouses) | `{name, type, id}` for LZ/Bronze/Silver lakehouses |
| `lakehouse_deployment.json` | Lakehouse-specific config (names, types) | LZ, Bronze, Silver lakehouse definitions |
| `item_initial_setup.json` | Initial setup notebook reference | `NB_SETUP_FMD` notebook definition |
| `fabric_icons.xml` | Custom workspace icon SVG definitions | XML icon data for Phase 12 |

---

## 3. Scripts (`scripts/`)

### Deployment Scripts

| File | Purpose |
|------|---------|
| `deploy_from_scratch.py` | *(See Section 1 above — this is the root-level master script)* |
| `deploy_schema_direct.py` | Deploy SQL schema via dacpac + run phases 11/13/16 + start overnight load |
| `deploy_digest_engine.py` | Deploy/update sp_BuildEntityDigest proc + enrich Connection table with server metadata |
| `deploy_digest_phase2.py` | Deploy EntityStatusSummary table + sp_UpsertEntityStatus (pre-computed status for O(1) reads) |
| `deploy_lz_copy_pipeline.py` | Deploy PL_FMD_LDZ_COPY_SQL pipeline (single-entity copy: SQL source to LZ parquet) |
| `deploy_monitoring_views.py` | Create real-time monitoring views in SQL metadata DB (LZ/Bronze/Silver progress) |
| `deploy_pipelines.py` | Deploy all pipeline definitions to Fabric with template ID replacement |
| `deploy_signal_procs.py` | Deploy signal stored procs to bypass ADF 1MB pipeline parameter limit |
| `upload_notebooks_to_fabric.py` | Upload local notebook source files to Fabric CODE workspace with GUID remapping |
| `upload_variable_libs_to_fabric.py` | Upload Variable Libraries to Fabric CODE + CONFIG workspaces |
| `upload_pipelines.py` | Upload updated pipeline JSON files to Fabric after timeout/batch fixes |
| `upload_lz_notebook.py` | Regenerate + upload NB_FMD_LOAD_LANDINGZONE_MAIN to Fabric |
| `upload_silver_notebook.py` | Upload NB_FMD_LOAD_BRONZE_SILVER to Fabric |

### Orchestration & Execution Scripts

| File | Purpose |
|------|---------|
| `run_load_all.py` | REST API orchestrator: triggers LZ/Bronze/Silver notebooks directly via SP token (replaces broken InvokePipeline) |
| `overnight_deploy_and_load.py` | Fire-and-forget: wait for NB_SETUP_FMD, run phases 11/13/16, start full load |
| `overnight_run_lz.py` | Trigger PL_FMD_LOAD_LANDINGZONE and monitor to completion |
| `overnight_push_flags.py` | Push incremental flags + reactivate entities + fix MES LoadValues |
| `overnight_poll_registration.py` | Pre-flight: poll Optiva registration, export entity inventory, get pipeline GUIDs |
| `overnight_final_report.py` | Post-run verification report from SQL metadata DB |
| `poll_and_chain_silver.py` | Poll Bronze notebook job, auto-trigger Silver when done |
| `run_silver_pipeline.py` | Trigger and monitor PL_FMD_LOAD_SILVER via Fabric REST API |
| `trigger_bronze_pipeline.py` | Trigger and monitor Bronze pipeline via Fabric REST API |
| `run_load_optimization.py` | Run load optimization analysis (PK/watermark discovery) standalone |
| `optiva_full_load.py` | Full medallion load for Optiva source: LZ, Bronze, Silver |
| `optiva_lz_retry.py` | Optiva LZ retry with error investigation + selective deactivation |
| `configure_incremental_loads.py` | Discover and configure incremental load candidates from source SQL tables |
| `push_incremental_flags.py` | Push incremental flags from `entities_to_analyze.json` to Fabric SQL DB |
| `refresh_load_analysis.py` | Re-analyze source SQL tables for incremental load candidates |

### Diagnostic & Investigation Scripts

| File | Purpose |
|------|---------|
| `check_notebook_jobs.py` | List all notebooks in CODE workspace and their recent job instances |
| `check_bronze_pipeline.py` | Fetch Bronze pipeline definition from Fabric API and print activities |
| `check_entity_paths.py` | Check paths/GUIDs from Bronze view and verify LZ file existence |
| `check_lz_and_runs.py` | Check if Landing Zone has data and if LZ pipeline has ever run |
| `check_onelake_files.py` | Check if LZ files exist in OneLake |
| `check_onelake_detailed.py` | Detailed OneLake file check with actual path output |
| `diagnose_bronze.py` | Deep diagnosis of database state vs what pipeline sees |
| `diagnose_and_fix_queues.py` | Diagnose and fix pipeline queue table issues |
| `diagnose_sourcename.py` | Diagnose SourceName issues in metadata |
| `diagnose_sourcename_v2.py` | Find SourceName values with leading/trailing whitespace or subtle issues |
| `diag_bronze_notebook.py` | Diagnose Bronze notebook execution issues |
| `investigate_bronze_silver.py` | Investigate unprocessed Bronze entities + Silver tracking |
| `investigate_bronze_silver_followup.py` | Follow-up: fix reserved word errors, check LZ status |
| `investigate_bronze_silver_views.py` | Get full view/proc definitions for Bronze pending logic |
| `investigate_bronze_unprocessed.py` | Investigate 174 unprocessed Bronze entities |
| `investigate_lz_failure.py` | Investigate latest LZ pipeline failure |
| `investigate_mes_bug.py` | Investigate MES-specific pipeline bug |
| `live_monitor.py` | Real-time pipeline monitor (polls SQL + Fabric API) |
| `monitor_final_lz.py` | Monitor final LZ run, reactivate entities, trigger Bronze |
| `monitor_lz_pipeline.py` | Monitor LZ pipeline to completion, investigate failures |
| `status_matrix.py` | Automated status matrix from SQL metadata + control plane |
| `gap_analysis.py` | Comprehensive gap analysis across all sources and layers |
| `gap_report.py` | Full gap report for LZ/Bronze/Silver across all data sources |
| `get_actual_run.py` | Get actual pipeline run details from Fabric |
| `preflight_path_audit.py` | Validate OneLake file paths match SQL metadata expectations |
| `fabric_sql_exec.py` | Execute arbitrary SQL against Fabric SQL DB (interactive auth) |
| `find_never_loaded_entities.py` | Find entities that have never been loaded |
| `analyze_optiva_tables.py` | Analyze Optiva source tables |
| `test_bronze_direct.py` | Direct Bronze pipeline test |
| `test_schema_notebook.py` | Test schema notebook execution |

### Fix Scripts (One-Time Patches)

| File | Purpose |
|------|---------|
| `fix_null_sourcename.py` | Fix 714 entities with empty SourceName (caused 55% of pipeline failures) |
| `fix_bronze_silver_queue.py` | Fix Bronze/Silver entity activation + populate pipeline queue tables |
| `fix_entity_paths.py` | Migrate entity metadata to correct `{Namespace}/{Table}` path format |
| `fix_foreach_batch_count.py` | Set `batchCount: 15` on ForEach activities (was unlimited, overwhelmed SQL DB) |
| `fix_pipeline_timeouts.py` | Increase pipeline timeouts (Copy 1h->4h, ExecutePipeline 1h->6h, ForEach 1h->12h) |
| `fix_rowversion_watermarks.py` | Remove rowversion/timestamp columns from watermark candidates (binary can't compare as varchar) |
| `fix_case_sensitivity.py` | Fix NotebookParams case sensitivity between pipeline and notebook |
| `fix_pipeline_and_upload_nb.py` | Revert IfCondition to uppercase + upload DQ notebook |
| `fix_metadata_reactivate.py` | Reactivate entities and check Bronze/Silver views |
| `fix_optiva_bad_entities.py` | Deactivate 168 Optiva entities with UserErrorInvalidTableName |
| `fix_and_retrigger_lz.py` | Fix LZ root causes and re-trigger for Optiva |
| `fix_silver_proc.py` | Fix Silver stored procedure issues |
| `fix_sourcename_cleanup.py` | Clean up SourceName metadata |

### Migration Scripts

| File | Purpose |
|------|---------|
| `migrate_datasource_namespace.py` | Update DataSource.Namespace to target_schema values from source_systems.yaml |
| `migrate_onelake_paths.py` | Move OneLake LZ files to correct `{Namespace}/{Table}` structure |
| `register_missing_sources.py` | Register entities for MES, ETQ, M3 Cloud sources (discover tables from on-prem SQL) |
| `reset_bronze_for_silver.py` | Reset PipelineBronzeLayerEntity.IsProcessed for Silver reprocessing |
| `create_silver_entity_proc.py` | Create sp_UpsertPipelineSilverLayerEntity stored procedure |

### Utility Scripts

| File | Purpose |
|------|---------|
| `fmd_config.py` | Shared config module (SP credentials, workspace IDs, SQL connection helpers) |
| `centralized_id_registry.py` | Centralized GUID registry management |
| `nuke_environment.py` | Soft nuke (clear run data/orphan parquet) or hard nuke (delete workspaces). Use with caution. |

### Jira Scripts

| File | Purpose |
|------|---------|
| `jira_close_mt37_mt17.py` | Close MT-37 and MT-17 Jira tickets |
| `jira_digest_update.py` | Update Jira with digest engine status |
| `jira_fetch_comments.py` | Fetch comments from Jira tickets |
| `jira_hours_audit.py` | Audit logged hours in Jira |
| `jira_hours_audit_v2.py` | Audit logged hours (v2) |
| `jira_hours_fix_20260303.py` | Fix hours logged on 2026-03-03 |
| `jira_mirroring_ticket.py` | Create mirroring ticket in Jira |
| `jira_update_20260302.py` | Jira update for 2026-03-02 |
| `jira_update_20260302_engine.py` | Jira update for engine work on 2026-03-02 |
| `jira_update_20260303.py` | Jira update for 2026-03-03 |
| `jira_update_20260306.py` | Jira update for 2026-03-06 |
| `jira_update_comments.py` | Update Jira comments |
| `jira_update_descriptions.py` | Update Jira descriptions |
| `jira_update_mt86.py` | Update MT-86 ticket |
| `post_jira_comments.py` | Post comments to Jira tickets |
| `verify_jira.py` | Verify Jira configuration/connectivity |
| `redistribute_worklogs.py` | Redistribute worklogs across Jira tickets |
| `execute_worklog_moves.py` | Execute planned worklog moves |

### PowerShell Scripts

| File | Purpose |
|------|---------|
| `provision-remote-server.ps1` | Full server provisioning: Chrome, Claude Desktop, Claude Code, Nexus, MCP, NSSM, ODBC, FMD Dashboard |
| `provision-launcher.ps1` | Thin wrapper for `provision-remote-server.ps1` (reads env vars, passes params) |
| `deploy-to-server.ps1` | Run on VSC-Fabric: git pull + npm build + restart dashboard service |
| `refresh-config-bundle.ps1` | Export local config files into `scripts/config-bundle/` for server deployment |
| `teardown-claude-tools.ps1` | Remove Claude tools + Nexus from server (inverse of provisioning, keeps dashboard) |
| `teardown-launcher.ps1` | Thin wrapper for `teardown-claude-tools.ps1` |

### Agent/Hook Scripts

| File | Purpose |
|------|---------|
| `ralph_discipline_hook.py` | Ralph agent discipline hook |
| `ralph_setup.py` | Ralph agent setup |
| `ralph_stop_hook.py` | Ralph agent stop hook |

### SQL Scripts

| File | Purpose |
|------|---------|
| `create_source_onboarding.sql` | Create source onboarding tracker table (dashboard-only, not core framework) |
| `create_sp_GetLandingzoneEntity.sql` | Create missing sp_GetLandingzoneEntity stored proc (omitted from original DACPAC) |
| `MT15_register_connections.sql` | Register source system connections + entities (manual SQL for MT-15/MT-16) |
| `silver_showcase_queries.sql` | Silver layer cross-source showcase queries for demo purposes |

---

## 4. Engine Modules (`engine/`)

The v3 engine is a Python REST API that runs data loads (LZ/Bronze/Silver) via Fabric notebooks and REST API calls.

| File | Purpose |
|------|---------|
| `api.py` | REST API handlers for `/api/engine/*` routes. Engine singleton, background thread execution. |
| `auth.py` | SP authentication for 3 token scopes: Fabric SQL (PowerBI API scope), Fabric REST, OneLake (ADLS) |
| `config.py` | Configuration loader. Reads `dashboard/app/api/config.json` + `.env`, builds `EngineConfig`. |
| `connections.py` | pyodbc connection management for Fabric SQL DB (SP token) and on-prem sources (Windows auth) |
| `extractor.py` | Data extraction: pyodbc read, Polars DataFrame, Parquet output. Full + incremental loads. |
| `loader.py` | Write Parquet to OneLake LZ via ADLS Gen2 API. Per-entity lakehouse/workspace GUIDs. |
| `logging_db.py` | Structured JSON logging to SQL audit tables (sp_UpsertEngineRun, sp_InsertEngineTaskLog) |
| `models.py` | Data models: EngineConfig, EntityWorkItem, RunStatus, LogEnvelope |
| `notebook_trigger.py` | Trigger Fabric notebooks via REST API (Bronze/Silver processing) |
| `orchestrator.py` | Main run loop: get worklist, extract/upload/log per entity, trigger Bronze, trigger Silver |
| `pipeline_runner.py` | Trigger PL_FMD_LDZ_COPY_SQL per entity via Fabric REST API (alternative to local extraction) |
| `preflight.py` | Pre-run health checks: SP tokens, SQL connectivity, OneLake reachability, entity worklist sanity |
| `smoke_test.py` | End-to-end validation of engine stack |
| `tests/test_models.py` | Unit tests for engine data models |

---

## 5. GitHub Workflows (`.github/workflows/`)

| File | Trigger | Purpose |
|------|---------|---------|
| `codeql.yml` | Push/PR to `main` + weekly Monday 6am UTC | CodeQL security analysis for Python + JavaScript/TypeScript |
| `semgrep.yml` | Push/PR to `main` | Semgrep static analysis using project rules (`.semgrep.yml`) + auto rules |

Both workflows are security-focused. There is **no CI/CD pipeline for deployment** -- deployment is manual via `deploy_from_scratch.py` and the PowerShell provisioning scripts.

---

## 6. Project Configuration Files

### `.gitignore`

```
node_modules/, dist/, build/             # Dependencies + build output
.windsurf/, .vscode/, .idea/             # IDE/editor
.env, .env.local, .env.*.local           # Environment secrets
__pycache__/, *.pyc, .venv/, venv/       # Python
.mcp-servers/                            # MCP servers (cloned locally)
.semgrep/                                # Semgrep cache
.repomap.tags.cache.v1/                  # RepoMapper cache
openmemory.md                            # OpenMemory
```

### `.semgrep.yml`

Custom Semgrep rules (7 rules):

| Rule | Severity | What it catches |
|------|----------|-----------------|
| `hardcoded-secret-in-python` | ERROR | Variables named secret/password/token with string literals in Python |
| `sql-injection-format-string` | ERROR | f-strings in `cursor.execute()` calls (Python) |
| `sql-injection-percent-format` | ERROR | %-formatting in `cursor.execute()` calls (Python) |
| `dangerous-inner-html` | WARNING | Dynamic innerHTML injection in React/TSX components |
| `fmd-hardcoded-guid` | WARNING | Hardcoded GUIDs in `engine/*.py` or `src/**/*.py` (should come from config) |
| `fmd-no-ipaper-suffix` | ERROR | Using `.ipaper.com` suffix (must use short hostname only) |
| `fmd-wrong-token-scope` | ERROR | Using `database.windows.net` scope (must use `analysis.windows.net/powerbi/api`) |

### `.semgrepignore`

Excludes: `node_modules/`, `.mcp-servers/`, `.claude/`, `.git/`, `.ralphy*`, `.mri/`, `dashboard/app/dist/`, `*.min.js`, `*.min.css`, `*.lock`, `package-lock.json`

### `.mcp.json`

MCP server configuration for Claude Code sessions. Defines which MCP tools are available in the project context.

### `.mri.yaml`

MRI test framework configuration:
- **Test command**: `npx playwright test` (JSON output), max 3 iterations
- **Scope**: `dashboard/app/src/**/*.{ts,tsx}` (excludes test files)
- **Visual regression**: enabled, threshold 0.1
- **AI analysis**: enabled, model `claude-sonnet-4-6`, visual diff analysis on
- **API tests**: base_url `http://localhost:8787`, test_dir `.mri/api-tests`
- **Focus areas**: Digest engine migration, engine control monitoring, pipeline matrix, source manager, cross-page consistency

### `.deploy_state.json`

Runtime state file tracking deployment progress. Written/read by `deploy_from_scratch.py`. Contains resolved GUIDs, phase completion timestamps, and error state.

---

## 7. Key Architectural Facts

### Authentication
- **Service Principal**: App ID `ac937c5d`, Object ID `6baf0291`
- **Tenant**: `ca81e9fd-06dd-49cf-b5a9-ee7441ff5303`
- **Fabric SQL scope**: `https://analysis.windows.net/powerbi/api/.default` (NOT `database.windows.net`)
- **Token struct**: `struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)`

### Workspaces (Current / Correct)
| Alias | Name | ID |
|-------|------|----|
| DATA_DEV | INTEGRATION DATA (D) | `0596d0e7-e036-451d-a967-41a284302e8d` |
| CODE_DEV | INTEGRATION CODE (D) | `c0366b24-e6f8-4994-b4df-b765ecb5bbf8` |
| CONFIG | INTEGRATION CONFIG | `e1f70591-6780-4d93-84bc-ba4572513e5c` |
| DATA_PROD | INTEGRATION DATA (P) | `5a54d6ec-bafb-4193-a1c3-00a3097c3660` |
| CODE_PROD | INTEGRATION CODE (P) | `f825b6f5-1c3d-4b5d-be8a-12e3c2523d38` |

### Source Systems (VPN Required)
| Source | Server | Database | Entities |
|--------|--------|----------|----------|
| MES | `m3-db1` | `mes` | 445 |
| ETQ | `M3-DB3` | `ETQStagingPRD` | 29 |
| M3 Cloud | `sql2016live` | `DI_PRD_Staging` | 185 |
| M3 ERP | `m3-db1` | `m3fdbprd` | ~3,973 (not all registered) |

### Config Bundle (`scripts/config-bundle/`)

Pre-packaged configuration deployed to the VSC-Fabric remote server by `provision-remote-server.ps1` (Phase 12 of provisioning):

| File/Dir | Purpose |
|----------|---------|
| `dashboard-config.json` | Dashboard API config: server host/port, Fabric tenant/client IDs, SQL connection, Purview |
| `dashboard-.env` | Environment variables for dashboard server process |
| `.claude/` | Claude Code settings for remote server sessions |
| `claude-desktop/` | Claude Desktop configuration for remote server |

### Items Deployed to Fabric (from `item_deployment.json`)

| Type | Count | Names |
|------|-------|-------|
| Notebook | 8 | NB_FMD_PROCESSING_PARALLEL_MAIN, NB_FMD_LOAD_BRONZE_SILVER, NB_FMD_LOAD_LANDING_BRONZE, NB_FMD_CUSTOM_NOTEBOOK_TEMPLATE, NB_FMD_PROCESSING_LANDINGZONE_MAIN, NB_FMD_UTILITY_FUNCTIONS, NB_FMD_DQ_CLEANSING, NB_FMD_MAINTENANCE_AGENT |
| DataPipeline | 21 | 9 COPY pipelines (ASQL, ADLS, FTP, SFTP, Oracle, OneLake Files/Tables, ADF, CustomNB), 8 COMMAND pipelines, LOAD_BRONZE, LOAD_SILVER, LOAD_LANDINGZONE, LOAD_ALL, TOOLING_POST_ASQL_TO_FMD |
| Environment | 1 | ENV_FMD |
| VariableLibrary | 2 | VAR_FMD, VAR_CONFIG_FMD |

### SQL Database

| Property | Value |
|----------|-------|
| Item ID | `ed567507-5ec0-48fd-8b46-0782241219d5` |
| Endpoint | `7xuydsw5a3hutnnj5z2ed72tam-sec7pymam6ju3bf4xjcxeuj6lq.database.fabric.microsoft.com,1433` |
| Auth scope | `https://analysis.windows.net/powerbi/api/.default` (NOT `database.windows.net`) |
| Token struct | `struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)` |

### Known Gotchas
1. **InvokePipeline does NOT work with SP auth** -- use `run_load_all.py` or `NB_FMD_ORCHESTRATOR` instead
2. **SQL Analytics Endpoint has sync lag** -- always force-refresh before trusting lakehouse queries
3. **rowversion/timestamp columns cannot be watermarks** -- binary types fail varchar comparison
4. **ForEach batch count must be limited** (15) -- unlimited parallelism overwhelms Fabric SQL DB with 429s
5. **Never use `.ipaper.com` suffix** on server hostnames -- use short names only
6. **azure.identity hangs on Windows** -- always use urllib for token auth

### Remote Server (VSC-Fabric)
- **Dashboard**: `http://vsc-fabric/` (port 80 via IIS reverse proxy to localhost:8787)
- **Provisioning**: `scripts/provision-remote-server.ps1` (must run as Administrator)
- **Deploy updates**: `scripts/deploy-to-server.ps1` (git pull + npm build + restart)
- **Services**: `nssm status Nexus` / `nssm status FMD-Dashboard`
- **Node version**: Must be v22 LTS (v24 breaks better-sqlite3)
