# FMD Framework — Foundational Architecture Reference

> **THIS IS THE SINGLE SOURCE OF TRUTH.**
> Every Claude session working on this project MUST read this file before making changes.
> If a decision conflicts with this file, THIS FILE WINS. Update it when decisions change.

---

## 1. The Universal Path Rule

**ONE pattern. EVERYWHERE. NO EXCEPTIONS.**

```
{Namespace}/{Table}
```

| Component | Source | Example Values |
|---|---|---|
| `Namespace` | `integration.DataSource.Namespace` | `MES`, `ETQ`, `M3`, `M3C`, `OPTIVA` |
| `Table` | Entity name (SourceName / TargetName) | `MITMAS`, `OOLINE`, `MVXJDTA_CIDADR_1` |

This pattern is the same for LZ, Bronze, Silver, and Gold. No schema prefix. No date partitioning.
Namespace becomes the schema name in the Gold SQL Warehouse.

**Config source of truth:** `config.json` → `"paths"` section

### Landing Zone (Files Area)

```
Files/{Namespace}/{Table}.parquet
```

**Example:** `Files/MES/MITMAS.parquet`

### Bronze Layer (Tables Area — Delta)

```
Tables/{Namespace}/{Table}
```

**Example:** `Tables/MES/MITMAS` (Delta table, managed by Spark)

### Silver Layer (Tables Area — Delta)

```
Tables/{Namespace}/{Table}
```

Same as Bronze, different lakehouse. **Example:** `Tables/MES/MITMAS`

### Gold Layer (SQL Warehouse)

```
{Namespace}.{Table}
```

Namespace = schema. **Example:** `MES.MITMAS`

### Path Flow Summary

```
LZ Write:     Files/{Namespace}/{Table}.parquet
                          ↓
Bronze Read:  Files/{Namespace}/{Table}.parquet    ← MUST match LZ write
Bronze Write: Tables/{Namespace}/{Table}           ← Delta table
                          ↓
Silver Read:  Tables/{Namespace}/{Table}            ← MUST match Bronze write
Silver Write: Tables/{Namespace}/{Table}            ← Delta table (different LH)
                          ↓
Gold:         {Namespace}.{Table}                   ← SQL Warehouse schema.table
```

### NEVER DO THIS
- `Files/MES/MITMAS/MITMAS.parquet` — NO extra subfolder, file goes directly in namespace
- `dbo_MITMAS` — NO schema prefix
- `MES/Year/Month/Day/MITMAS` — NO date partitioning
- `MES/dbo_MITMAS` — NO schema in path
- `MES_dbo_MITMAS` — NO underscore-concatenated namespace

---

## 2. Workspace & Lakehouse GUIDs

### Workspaces (Source of Truth: config/item_config.yaml)

| Environment | Name | GUID | Metadata ID |
|---|---|---|---|
| DEV Data | INTEGRATION DATA (D) | `0596d0e7-e036-451d-a967-41a284302e8d` | 1 |
| DEV Code | INTEGRATION CODE (D) | `c0366b24-e6f8-4994-b4df-b765ecb5bbf8` | 2 |
| Config | INTEGRATION CONFIG | `e1f70591-6780-4d93-84bc-ba4572513e5c` | 3 |
| PROD Data | INTEGRATION DATA (P) | `5a54d6ec-bafb-4193-a1c3-00a3097c3660` | 4 |
| PROD Code | INTEGRATION CODE (P) | `f825b6f5-1c3d-4b5d-be8a-12e3c2523d38` | 5 |

**DEAD/OLD — DO NOT USE:**
- `a3a180ff-...` (OLD DEV_INTEGRATION DATA)
- `146fe38c-...` (OLD CODE)
- `f442f66c-...` (OLD CONFIG)

### Lakehouses

| Layer | Name | GUID | Metadata ID | Workspace |
|---|---|---|---|---|
| LZ (DEV) | LH_DATA_LANDINGZONE | `3b9a7e79-1615-4ec2-9e93-0bdebe985d5a` | 1 | DATA (D) |
| Bronze (DEV) | LH_BRONZE_LAYER | `f06393ca-c024-435f-8d7f-9f5aa3bb4cb3` | 2 | DATA (D) |
| Silver (DEV) | LH_SILVER_LAYER | `f85e1ba0-2e40-4de5-be1e-f8ad3ddbc652` | 3 | DATA (D) |
| LZ (PROD) | LH_DATA_LANDINGZONE | *TBD* | 4 | DATA (P) |
| Bronze (PROD) | LH_BRONZE_LAYER | *TBD* | 5 | DATA (P) |
| Silver (PROD) | LH_SILVER_LAYER | *TBD* | 6 | DATA (P) |

### SQL Metadata Database

| Property | Value |
|---|---|
| Server | `7xuydsw5a3hutnnj5z2ed72tam-sec7pymam6ju3bf4xjcxeuj6lq.database.fabric.microsoft.com,1433` |
| Database | `SQL_INTEGRATION_FRAMEWORK-ed567507-5ec0-48fd-8b46-0782241219d5` |
| Item GUID | `ed567507-5ec0-48fd-8b46-0782241219d5` |
| Auth | Service Principal token (scope: `https://analysis.windows.net/powerbi/api/.default`) |
| Driver | `ODBC Driver 18 for SQL Server` |

### Service Principal

| Property | Value |
|---|---|
| Tenant | `ca81e9fd-06dd-49cf-b5a9-ee7441ff5303` |
| Client ID | `ac937c5d-4bdd-438f-be8b-84a850021d2d` |
| SP Object ID | `6baf0291-1868-4867-82d2-eb8d077438ba` |
| Secret | `${FABRIC_CLIENT_SECRET}` env var |

---

## 3. Source Systems

| Namespace | Server | Database | Entity Count | Connection Name |
|---|---|---|---|---|
| `MES` | `m3-db1` | `mes` | 445 | `CON_FMD_M3DB1_MES` |
| `ETQ` | `M3-DB3` | `ETQStagingPRD` | 29 | `CON_FMD_M3DB3_ETQSTAGINGPRD` |
| `M3` | `sqllogshipprd` | `m3fdbprd` | 596 | `CON_FMD_M3DB1_M3` |
| `M3C` | `sql2016live` | `DI_PRD_Staging` | 187 | `CON_FMD_M3DB1_M3CLOUD` |
| `OPTIVA` | `sqloptivalive` | `OptivaLive` | 409 | `CON_FMD_SQLOPTIVALIVE_OPTIVALIVE` |

**Auth**: Windows auth via VPN (`Trusted_Connection=yes;TrustServerCertificate=yes`)
**NEVER use `.ipaper.com` suffix** — just short hostname.

---

## 4. Pipeline Architecture

### Pipeline Chain

```
PL_FMD_LOAD_ALL
├── PL_FMD_LOAD_LANDINGZONE  →  NB_FMD_LOAD_LANDINGZONE_MAIN (notebook orchestrator)
│   └── PL_FMD_LDZ_COPY_SQL  (per-entity copy via pipeline)
├── PL_FMD_LOAD_BRONZE       →  NB_FMD_PROCESSING_PARALLEL_MAIN
│   └── NB_FMD_LOAD_LANDING_BRONZE (per-entity notebook)
└── PL_FMD_LOAD_SILVER        →  NB_FMD_PROCESSING_PARALLEL_MAIN
    └── NB_FMD_LOAD_BRONZE_SILVER (per-entity notebook)
```

### Pipeline GUIDs (CODE_DEV workspace)

| Pipeline | GUID |
|---|---|
| PL_FMD_LDZ_COPY_SQL | `9a06a21d-d139-4356-81d2-6d6e0630a01b` |
| PL_FMD_LOAD_LANDINGZONE | `3d0b3b2b-a069-40dc-b735-d105f9e66838` |
| PL_FMD_LOAD_BRONZE | `8b7008ac-b4da-4861-9e1f-6b99d9f2f1e3` |
| PL_FMD_LOAD_SILVER | `90c0535c-c5dc-43a3-b51e-c44ef1808a60` |

### Notebook GUIDs

| Notebook | GUID |
|---|---|
| NB_FMD_LOAD_LANDINGZONE_MAIN | `efbd2436-83bf-4cad-b92e-f489dc255506` |
| NB_FMD_LOAD_LANDING_BRONZE | `a2712a97-ebde-4036-b704-4892b8c4f7af` |
| NB_FMD_LOAD_BRONZE_SILVER | `8ce7bc73-35ac-4844-8937-969b7d99ec3e` |

### CRITICAL: InvokePipeline Does NOT Work with SP Auth

Fabric's InvokePipeline activity ignores Service Principal connections by design.
**Workaround**: `scripts/run_load_all.py` — REST API orchestrator that triggers each pipeline directly.

---

## 5. SQL Metadata Schema (Key Tables & Views)

### Integration Schema (Configuration)
- `integration.DataSource` — Source system definitions (Namespace, ConnectionId)
- `integration.LandingzoneEntity` — LZ entity registration (Name, FilePath, FileName, FileType)
- `integration.BronzeLayerEntity` — Bronze entity registration (Schema, Name, FileType)
- `integration.SilverLayerEntity` — Silver entity registration (Schema, Name, FileType)
- `integration.Lakehouse` — Lakehouse definitions (Name, Guid, WorkspaceId)
- `integration.Workspace` — Workspace definitions (Name, Guid)
- `integration.Connection` — Connection definitions (Name, Guid, ServerName, DatabaseName)

### Execution Schema (Runtime)
- `execution.PipelineRun` — Pipeline run tracking
- `execution.PipelineLandingzoneEntity` — Per-entity LZ execution status
- `execution.PipelineBronzeLayerEntity` — Per-entity Bronze execution status
- `execution.PipelineSilverLayerEntity` — Per-entity Silver execution status
- `execution.EntityStatusSummary` — Aggregated entity status for dashboard

### Key Views
- `execution.vw_LoadSourceToLandingzone` — LZ entity worklist (drives the LZ notebook)
- `execution.vw_LoadToBronzeLayer` — Bronze entity worklist
- `execution.vw_LoadToSilverLayer` — Silver entity worklist

### Key Stored Procs
- `sp_UpsertPipelineLandingzoneEntity` — Register/update LZ entity execution
- `sp_UpsertPipelineBronzeLayerEntity` — Register/update Bronze entity execution
- `sp_UpsertPipelineSilverLayerEntity` — Register/update Silver entity execution
- `sp_UpsertEntityStatus` — Update EntityStatusSummary for dashboard
- `sp_BuildEntityDigest` — Build entity digest for dashboard
- `sp_AuditPipeline` — Audit pipeline run start/end
- `sp_AuditCopyActivity` — Audit individual copy activity

---

## 6. Metadata Path Values — WHAT MUST BE STORED

When registering entities or updating after a load, these are the CORRECT values.
The pattern is always `{Namespace}/{Table}`. No schema prefix.

### LandingzoneEntity Registration
```sql
EXEC sp_UpsertPipelineLandingzoneEntity
    @Filename = '{Table}.parquet',              -- e.g., 'MITMAS.parquet'
    @FilePath = '{Namespace}',                   -- e.g., 'MES' (just the namespace folder)
    @IsProcessed = 'False',
    @LandingzoneEntityId = '{EntityId}'
```

### Pipeline Copy Parameters
```
TargetFilePath = '{Namespace}'                   -- e.g., 'MES' (just the folder)
TargetFileName = '{Table}.parquet'               -- e.g., 'MITMAS.parquet'
```

Result on OneLake: `Files/{Namespace}/{Table}.parquet` — flat, one level deep.

### Bronze Source Parameters (reads from LZ)
```
SourceFilePath = '{Namespace}'                   -- MUST match what LZ wrote
SourceFileName = '{Table}.parquet'               -- MUST match what LZ wrote
```

### Bronze/Silver Delta Table Name
```
Target = '{Namespace}/{Table}'                   -- e.g., 'MES/MITMAS'
```

---

## 7. Dashboard

- **Server**: `dashboard/app/api/server.py` (Python, port 8787)
- **Frontend**: `dashboard/app/src/` (React + TypeScript + Vite)
- **Config**: `dashboard/app/api/config.json` (all GUIDs, tuning, SQL connection)
- **Remote URL**: `http://vsc-fabric/` (IIS reverse proxy, Windows Auth)

---

## 8. Engine v3

- **Location**: `engine/` directory
- **API**: `engine/api.py` — REST endpoints at `/api/engine/*`
- **Orchestrator**: `engine/orchestrator.py` — Batch processing with adaptive throttle
- **Loader**: `engine/loader.py` — OneLake file upload (local mode) or pipeline trigger
- **Models**: `engine/models.py` — Entity data model

---

## 9. Deployment

- **Script**: `deploy_from_scratch.py` (17 phases)
- **Entity config**: `config/entity_registration.json`
- **Item config**: `config/item_config.yaml`
- **NEVER use NB_SETUP_FMD for deployment** — always use deploy_from_scratch.py

---

## 10. Rules — DO NOT VIOLATE

1. **Path format**: `{Namespace}/{Table}` — EVERYWHERE. LZ, Bronze, Silver, Gold. No exceptions.
2. **No schema prefix**: `MITMAS`, not `dbo_MITMAS`. The table name IS the SourceName/TargetName as-is.
3. **No date partitioning**: No `Year/Month/Day` subfolders. Ever.
4. **Path config lives in config.json** → `"paths"` section. Don't hardcode path patterns.
5. **All GUIDs come from config/item_config.yaml** — never hardcode in notebooks.
6. **Workspace names start with INTEGRATION** — anything prefixed `DEV_` or `OLD_` is dead.
7. **SP auth scope**: `https://analysis.windows.net/powerbi/api/.default` (NOT `database.windows.net`).
8. **Token struct**: `struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)`.
9. **Source server names**: Short hostnames only, no `.ipaper.com` suffix.
10. **Table names with natural underscores are preserved**: `MVXJDTA_CIDADR_1` stays as-is.
11. **Always update this file when architectural decisions change.**

---

*Last updated: 2026-03-05*
