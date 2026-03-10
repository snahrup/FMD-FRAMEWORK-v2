# FMD Framework — Fabric Artifacts Audit

> Generated 2026-03-09. Source of truth for AI agents working on the Fabric layer.

---

## 1. Notebooks (`src/*.Notebook/`)

11 notebooks in the framework core. All run on `synapse_pyspark` kernel.

### Core Pipeline Notebooks

| Notebook | Purpose | Key Parameters | Calls / Dependencies |
|----------|---------|----------------|----------------------|
| `NB_FMD_LOAD_LANDINGZONE_MAIN` | Loads data from on-prem SQL sources into Landing Zone lakehouse as parquet files. Handles full and incremental loads via watermark columns. | `EntityId`, `EntityLayer`, `PipelineRunGuid`, `PipelineParentRunGuid`, `TriggerType`, `TriggerGuid`, `TargetFilePath`, `TargetFileName`, `TargetLakehouseGuid`, `WorkspaceGuid`, `LastLoadValue`, `SourceDataRetrieval`, `SourceSchema`, `SourceName`, `DatasourceName`, `ConnectionGuid`, `NotebookExecutionId` | `sp_AuditNotebook`, `sp_UpsertEntityStatus`. Reads `VAR_CONFIG_FMD` + `VAR_FMD` variable libraries. Writes parquet to OneLake via `notebookutils.lakehouse`. |
| `NB_FMD_PROCESSING_LANDINGZONE_MAIN` | Post-processing after LZ copy. Moves files, renames, handles schema drift detection. | Same pipeline-injected params as LZ_MAIN | `sp_AuditNotebook`. File operations via `notebookutils.fs`. |
| `NB_FMD_LOAD_LANDING_BRONZE` | Reads parquet from Landing Zone, applies SCD Type 1/2 merge logic, writes Delta tables to Bronze lakehouse. Adds `_IsCurrent`, `_ValidFrom`, `_ValidTo`, `_Checksum` audit columns. | `EntityId`, `EntityLayer`, `PipelineRunGuid`, `PipelineParentRunGuid`, `TriggerType`, `TriggerGuid`, `TargetFilePath`, `TargetFileName`, `TargetLakehouseGuid`, `WorkspaceGuid`, `NotebookExecutionId`, `SourceSchema`, `SourceName` | `sp_AuditNotebook`, `sp_UpsertEntityStatus`. Reads `VAR_CONFIG_FMD` + `VAR_FMD`. PySpark Delta merge operations. |
| `NB_FMD_LOAD_BRONZE_SILVER` | Reads Delta tables from Bronze, applies cleansing/transformation rules from metadata DB, writes to Silver lakehouse. | `EntityId`, `EntityLayer`, `PipelineRunGuid`, `PipelineParentRunGuid`, `TriggerType`, `TriggerGuid`, `TargetFilePath`, `TargetFileName`, `TargetLakehouseGuid`, `WorkspaceGuid`, `NotebookExecutionId`, `SourceSchema`, `SourceName` | `sp_AuditNotebook`, `sp_UpsertEntityStatus`. Reads `VAR_CONFIG_FMD` + `VAR_FMD`. Reads DQ rules from metadata DB. PySpark Delta operations. |
| `NB_FMD_DQ_CLEANSING` | Applies data quality and cleansing rules to entities. Rules are metadata-driven from the SQL database. | `EntityId`, `EntityLayer`, `PipelineRunGuid`, `TargetLakehouseGuid`, `WorkspaceGuid`, `SourceSchema`, `SourceName` | `sp_AuditNotebook`. Reads cleansing rules from metadata DB. PySpark transformations. |
| `NB_FMD_ORCHESTRATOR` | REST API-based orchestrator notebook. Triggers LZ, Bronze, and Silver pipelines sequentially via Fabric REST API using SP token. Workaround for InvokePipeline SP auth limitation. | None (self-contained). Reads config from `VAR_CONFIG_FMD`. | Calls Fabric REST API `POST /v1/workspaces/{ws}/items/{pipeline}/jobs/instances?jobType=Pipeline`. Polls job status. |
| `NB_FMD_PROCESSING_PARALLEL_MAIN` | Parallel processing engine. Reads entity batches from metadata DB and processes them concurrently using `mssparkutils.notebook.runMultiple`. | `PipelineRunGuid`, `PipelineParentRunGuid`, `TriggerType`, `TriggerGuid`, `WorkspaceGuid`, `EntityLayer` | `mssparkutils.notebook.runMultiple` to call `NB_FMD_LOAD_LANDING_BRONZE` or `NB_FMD_LOAD_BRONZE_SILVER` in parallel. Reads entity queue from metadata DB views. |

### Utility / Setup Notebooks

| Notebook | Purpose | Key Parameters | Calls / Dependencies |
|----------|---------|----------------|----------------------|
| `NB_FMD_CUSTOM_NOTEBOOK_TEMPLATE` | Template for custom data extraction notebooks (e.g., API sources). Includes standard audit logging boilerplate. **WARNING: overwritten on redeploy.** | Same pipeline params as LZ notebooks | `sp_AuditNotebook`. Reads `VAR_CONFIG_FMD` + `VAR_FMD`. User adds custom extraction logic. |
| `NB_FMD_UTILITY_FUNCTIONS` | Shared utility functions used by `NB_UTILITIES_SETUP_FMD`. Not called directly by pipelines. | None (library notebook) | Provides: `run_fab_command()`, `get_cluster_url()`, `create_fabric_domain()`, `update_variable_library()`, `copy_to_tmp()`, `replace_ids_in_folder()`. |
| `NB_UTILITIES_SETUP_FMD` | Full environment setup notebook. Creates workspaces, domains, lakehouses, deploys SQL schema, uploads artifacts via Fabric CLI. | `key_vault_uri_name`, `key_vault_tenant_id`, `key_vault_client_id`, `key_vault_client_secret`, `lakehouse_schema_enabled` | Uses `NB_FMD_UTILITY_FUNCTIONS` (inline). Fabric CLI (`fab` commands). Creates SQL schemas, stored procs, tables. |
| `NB_FMD_MAINTENANCE_AGENT` | Autonomous maintenance agent. Monitors pipeline health, identifies failed entities, can retrigger loads. Designed for scheduled execution. | Reads config from variable libraries | Queries metadata DB for failed/stale entities. Can trigger notebook runs via `mssparkutils.notebook.run`. |

### Stored Procedures Called by Notebooks

| Stored Procedure | Schema | Called By | Purpose |
|-----------------|--------|-----------|---------|
| `sp_AuditNotebook` | `logging` | All pipeline notebooks | Logs notebook start/end/error events |
| `sp_AuditPipeline` | `logging` | Pipeline activities (not notebooks) | Logs pipeline start/end events |
| `sp_AuditCopyActivity` | `logging` | Pipeline copy activities | Logs copy activity metrics |
| `sp_UpsertEntityStatus` | `execution` | LZ, Bronze, Silver notebooks | Updates entity status summary table |
| `sp_UpsertLandingzoneEntity` | `integration` | Entity registration | Creates/updates LZ entity metadata |
| `sp_UpsertPipelineLandingzoneEntity` | `integration` | Pipeline activities | Queues entities for processing |
| `sp_UpsertLandingzoneEntityLastLoadValue` | `integration` | Pipeline activities | Updates watermark/last load tracking |

---

## 2. Pipelines (`src/*.DataPipeline/`)

23 pipelines total. All use `VAR_CONFIG_FMD` variable library for SQL DB connection. Connection to metadata DB via `FabricSqlDatabase` type using `fmd_config_database_guid` / `fmd_config_workspace_guid`.

### Orchestration Pipelines

| Pipeline | Type | Activities | Purpose |
|----------|------|------------|---------|
| `PL_FMD_LOAD_ALL` | Orchestrator | 3x `InvokePipeline` (LZ → Bronze → Silver), `sp_AuditPipeline` start/end | Master pipeline. Chains LZ, Bronze, Silver sequentially. **NOTE: InvokePipeline does not support SP auth** — use `scripts/run_load_all.py` or `NB_FMD_ORCHESTRATOR` instead. |
| `PL_FMD_LOAD_LANDINGZONE` | Layer orchestrator | `Lookup` (entity list from `vw_LoadToLandingzone`), `ForEach` (batchCount=15) → `InvokePipeline` per source type | Reads active LZ entities from metadata DB, routes each to the correct COPY or COMMAND pipeline based on source type. |
| `PL_FMD_LOAD_BRONZE` | Layer orchestrator | `sp_AuditPipeline` start, `Lookup` (entity list from `vw_LoadToBronzeLayer`), `ForEach` (batchCount=15) → `Notebook` activity calling `NB_FMD_LOAD_LANDING_BRONZE`, `sp_AuditPipeline` end | Reads Bronze-pending entities, invokes Bronze notebook per entity in parallel batches. |
| `PL_FMD_LOAD_SILVER` | Layer orchestrator | `sp_AuditPipeline` start, `Lookup` (entity list from `vw_LoadToSilverLayer`), `ForEach` (batchCount=15) → `Notebook` activity calling `NB_FMD_LOAD_BRONZE_SILVER`, `sp_AuditPipeline` end | Reads Silver-pending entities, invokes Silver notebook per entity in parallel batches. |

### Landing Zone COPY Pipelines (data movement)

| Pipeline | Source Type | Copy Activity | Connection Type |
|----------|-------------|---------------|-----------------|
| `PL_FMD_LDZ_COPY_SQL` | SQL Server (on-prem) | `CP_source_to_landingzone` — `AzureSqlSource` → `ParquetSink` (Lakehouse Files) | Dynamic `@pipeline().parameters.ConnectionGuid` |
| `PL_FMD_LDZ_COPY_FROM_ADF` | Azure Data Factory | Copy from ADF-linked source → Lakehouse parquet | Dynamic connection |
| `PL_FMD_LDZ_COPY_FROM_ADLS_01` | Azure Data Lake Storage | `DelimitedTextSource` (AzureBlobFS) → `DelimitedTextSink` (Lakehouse) | Dynamic connection |
| `PL_FMD_LDZ_COPY_FROM_ASQL_01` | Azure SQL Database | SQL source → Lakehouse parquet | Dynamic connection |
| `PL_FMD_LDZ_COPY_FROM_FTP_01` | FTP | FTP file source → Lakehouse | Dynamic connection |
| `PL_FMD_LDZ_COPY_FROM_ONELAKE_FILES_01` | OneLake Files | OneLake file copy → Lakehouse | Dynamic connection |
| `PL_FMD_LDZ_COPY_FROM_ONELAKE_TABLES_01` | OneLake Tables | OneLake table copy → Lakehouse | Dynamic connection |
| `PL_FMD_LDZ_COPY_FROM_ORACLE_01` | Oracle Database | Oracle source → Lakehouse parquet | Dynamic connection |
| `PL_FMD_LDZ_COPY_FROM_SFTP_01` | SFTP | SFTP file source → Lakehouse | Dynamic connection |
| `PL_FMD_LDZ_COPY_FROM_CUSTOM_NB` | Custom Notebook | `ForEach` → runs `NB_FMD_PROCESSING_LANDINGZONE_MAIN` per entity | Dynamic — notebook handles extraction |

All COPY pipelines share a common pattern:
- **Pre-copy**: `sp_AuditCopyActivity` (Start), `sp_UpsertPipelineLandingzoneEntity` (queue tracking)
- **Copy**: Source-specific copy activity → Lakehouse parquet/CSV
- **Post-copy success**: `sp_AuditCopyActivity` (End), `sp_UpsertLandingzoneEntityLastLoadValue` (watermark update)
- **Post-copy failure**: `sp_AuditCopyActivity` (Error)
- **Timeout**: Copy 4hr, ForEach 12hr
- **Sink**: Lakehouse Files as snappy-compressed parquet

### Landing Zone COMMAND Pipelines (notebook-based extraction)

| Pipeline | Source Type | Activity Pattern |
|----------|-------------|------------------|
| `PL_FMD_LDZ_COMMAND_ADF` | Azure Data Factory | `sp_AuditPipeline` start → custom command activity → audit end |
| `PL_FMD_LDZ_COMMAND_ADLS` | Azure Data Lake Storage | Same pattern |
| `PL_FMD_LDZ_COMMAND_ASQL` | Azure SQL Database | Same pattern |
| `PL_FMD_LDZ_COMMAND_FTP` | FTP | Same pattern |
| `PL_FMD_LDZ_COMMAND_NOTEBOOK` | Custom Notebook | Same pattern, routes to user-defined notebook |
| `PL_FMD_LDZ_COMMAND_ONELAKE` | OneLake | Same pattern |
| `PL_FMD_LDZ_COMMAND_ORACLE` | Oracle | Same pattern |
| `PL_FMD_LDZ_COMMAND_SFTP` | SFTP | Same pattern |

All COMMAND pipelines follow the same activity sequence: `sp_AuditPipeline` (start) → source-specific command execution → `sp_AuditPipeline` (end). EntityLayer = `Landingzone`.

### Tooling Pipelines

| Pipeline | Purpose |
|----------|---------|
| `PL_TOOLING_POST_ASQL_TO_FMD` | Onboarding pipeline. Reads CSV metadata, looks up datasource + connection, registers entities via `ForEach` → `sp_UpsertLandingzoneEntity` + `sp_UpsertBronzeLayerEntity` + `sp_UpsertSilverLayerEntity`. |

### Common Pipeline Parameters

All COPY/COMMAND pipelines receive these parameters from the parent `LOAD_LANDINGZONE` ForEach:

| Parameter | Type | Source |
|-----------|------|--------|
| `ConnectionGuid` | String | Entity metadata |
| `DatasourceName` | String | Entity metadata |
| `EntityId` | Int32 | Entity metadata |
| `SourceDataRetrieval` | String | SQL query or table reference |
| `SourceName` | String | Table name |
| `SourceSchema` | String | Schema name |
| `TargetFileName` | String | Parquet filename |
| `TargetFilePath` | String | OneLake path |
| `TargetLakehouseGuid` | String | LZ lakehouse ID |
| `WorkspaceGuid` | String | Data workspace ID |
| `LastLoadValue` | String | Watermark for incremental |

### Pipeline Timeouts

| Activity Type | Timeout |
|--------------|---------|
| Copy Activity | 4 hours |
| ExecutePipeline / InvokePipeline | 6 hours |
| ForEach | 12 hours |
| Stored Procedure | 1 hour |
| Notebook | 12 hours |

---

## 3. Variable Libraries (`src/*.VariableLibrary/`)

4 variable libraries total (2 core, 2 business domain).

### `VAR_CONFIG_FMD` — Framework Configuration

| Variable | Type | Purpose |
|----------|------|---------|
| `fmd_fabric_db_connection` | String | Fabric SQL Database server hostname (e.g., `*.database.fabric.microsoft.com,1433`) |
| `fmd_fabric_db_name` | String | SQL database name with item GUID suffix |
| `fmd_config_workspace_guid` | String | CONFIG workspace GUID (`e1f70591-...`) |
| `fmd_config_database_guid` | String | SQL Database item GUID (`ed567507-...`) |

### `VAR_FMD` — Runtime Defaults

| Variable | Type | Purpose |
|----------|------|---------|
| `key_vault_uri_name` | String | Azure Key Vault URI for secret retrieval |
| `key_vault_tenant_id` | String | AAD tenant ID (`ca81e9fd-...`) |
| `key_vault_client_id` | String | Service Principal app ID (`ac937c5d-...`) |
| `key_vault_client_secret` | String | Service Principal secret |
| `lakehouse_schema_enabled` | String | `"True"` — enables schema-based lakehouse tables |

### `VAR_GOLD_CODE_FMD` (business domain)

| Variable | Type | Purpose |
|----------|------|---------|
| `key_vault_uri_name` | String | Key Vault URI for gold layer |
| `key_vault_tenant_id` | String | AAD tenant ID |
| `key_vault_client_id` | String | SP app ID |
| `key_vault_client_secret` | String | SP secret |

### `VAR_GOLD_SHORTCUTS_FMD` (business domain)

| Variable | Type | Purpose |
|----------|------|---------|
| `SourceWorkspaceId` | String | Source workspace for shortcut creation |
| `SourceLakehouseId` | String | Source lakehouse ID |
| `SourceSchema` | String | Schema to read tables from |
| `Shortcut_TargetWorkspaceId` | String | Gold workspace target |
| `Shortcut_TargetLakehouseId` | String | Gold lakehouse target |
| `Shortcut_TargetSchema` | String | Target schema for shortcuts |

---

## 4. Business Domain Notebooks (`src/business_domain/`)

5 notebooks for Gold layer and cross-workspace operations.

| Notebook | Language | Lakehouse | Purpose |
|----------|----------|-----------|---------|
| `NB_CREATE_DIMDATE` | PySpark | `LH_GOLD_LAYER` | Generates a `DimDate` dimension table with full BI attributes (day/week/month/quarter/year, ISO week, fiscal periods, holiday flags). PySpark DataFrame operations with `dim_date_df()` function. Date range parameterized. |
| `NB_CREATE_SHORTCUTS` | PySpark | Gold workspace | Creates OneLake shortcuts from Silver lakehouse tables to Gold lakehouse. Uses Fabric REST API (`/v1/workspaces/{ws}/items/{lh}/shortcuts`). Table list hardcoded in notebook. Reads `VAR_GOLD_SHORTCUTS_FMD` for workspace/lakehouse IDs. |
| `NB_LOAD_GOLD` | PySpark | Default | Empty template notebook. Placeholder for custom Gold layer loading logic. |
| `NB_MLV_DEMO_GOLD` | SparkSQL | `LH_GOLD_LAYER` | Creates Materialized Lake Views (MLVs) in `gold` schema. Defines: `gold.FactOrderLines` (Sales join), `gold.DimOrders`, `gold.DimCustomer` (with BuyingGroups join). All filter `IsCurrent=1` for SCD2. |
| `NB_MLV_EXAMPLE` | SparkSQL | User-specified | Empty MLV template. Shows `CREATE MATERIALIZED LAKE VIEW` syntax for users to define their own views. |

---

## 5. Antigravity Scripts (`src/antigravity/`)

Local Python utilities for Fabric operations that run outside of Fabric (from developer laptop or CI/CD). All require VPN for on-prem SQL access or SP token for Fabric API.

| Script | Purpose | Key Details |
|--------|---------|-------------|
| `check_sp.py` | Verifies Service Principal authentication against Fabric SQL Database. Connects using SP token (ODBC + `attrs_before` struct), queries `integration.Lakehouse` table. | Uses `database.windows.net` scope (note: differs from `analysis.windows.net/powerbi/api` scope used elsewhere). |
| `check_notebook_trigger.py` | Checks status of Fabric notebook jobs triggered via REST API. Polls job status endpoint. | Uses Fabric REST API `GET /v1/workspaces/{ws}/items/{nb}/jobs/instances/{jobId}`. SP token auth via `analysis.windows.net/powerbi/api/.default` scope. |
| `extract_m3_schema.py` | Connects to M3 ERP on-prem database (`m3fdbprd` on `m3-db1`), discovers all tables with data (rows > 0), writes entity config to `config/entity_registration.json`. | SQL auth with `UsrSQLRead` user. Groups by schema. Output feeds into `deploy_from_scratch.py` Phase 13 entity registration. |
| `fabric_notebook_runner.py` | Triggers Fabric notebook execution via REST API and polls until completion. Supports passing parameters to notebooks. | SP token auth. `POST /v1/workspaces/{ws}/items/{nb}/jobs/instances?jobType=RunNotebook`. Returns job status (Completed/Failed/Cancelled). |
| `standalone_register_entities.py` | Bulk entity registration. Reads `config/entity_registration.json`, connects to Fabric SQL metadata DB, registers entities across all 3 layers (LZ → Bronze → Silver) using stored procedures. | Calls `sp_UpsertLandingzoneEntity`, `sp_UpsertBronzeLayerEntity`, `sp_UpsertSilverLayerEntity`. Chunk-based processing. Gets lakehouse IDs from metadata DB. |

---

## 6. Architecture Quick Reference

### Data Flow

```
On-Prem SQL ──► PL_FMD_LOAD_LANDINGZONE ──► PL_FMD_LDZ_COPY_SQL ──► LH_LANDINGZONE (parquet)
                                                                            │
                                                                            ▼
                                         PL_FMD_LOAD_BRONZE ──► NB_FMD_LOAD_LANDING_BRONZE ──► LH_BRONZE_LAYER (Delta, SCD2)
                                                                                                      │
                                                                                                      ▼
                                         PL_FMD_LOAD_SILVER ──► NB_FMD_LOAD_BRONZE_SILVER ──► LH_SILVER_LAYER (Delta, cleansed)
                                                                                                      │
                                                                                                      ▼
                                         NB_CREATE_SHORTCUTS / NB_MLV_DEMO_GOLD ──► LH_GOLD_LAYER (MLVs, shortcuts)
```

### Key Connections

| Connection ID | Name | Type | Purpose |
|--------------|------|------|---------|
| `0f86f6a1-9f84-44d1-b977-105b5179c678` | `SQL_FMD_FRAMEWORK` | FabricSqlDatabase | Metadata DB (stored procs, entity config) |
| Dynamic per entity | Source connections | Various (SQL, ADLS, FTP, SFTP, Oracle, OneLake) | On-prem/cloud source data |

### Metadata DB Views (used by pipelines)

| View | Schema | Used By |
|------|--------|---------|
| `vw_LoadToLandingzone` | `execution` | `PL_FMD_LOAD_LANDINGZONE` |
| `vw_LoadToBronzeLayer` | `execution` | `PL_FMD_LOAD_BRONZE` |
| `vw_LoadToSilverLayer` | `execution` | `PL_FMD_LOAD_SILVER` |

### File Locations

| Artifact Type | Repo Path |
|--------------|-----------|
| Core notebooks | `src/*.Notebook/notebook-content.py` |
| Pipelines | `src/*.DataPipeline/pipeline-content.json` |
| Variable libraries | `src/*.VariableLibrary/variables.json` |
| Business domain | `src/business_domain/` |
| Antigravity scripts | `src/antigravity/*.py` |
| Entity registration config | `config/entity_registration.json` |
| Item deployment config | `config/item_deployment.json` |
| Deploy script | `deploy_from_scratch.py` |
| REST API orchestrator | `scripts/run_load_all.py` |
