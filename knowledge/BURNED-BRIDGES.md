# BURNED BRIDGES: Dead Ends, Failed Approaches, and Hard-Won Lessons

> **EVERY AI AGENT MUST READ THIS FILE BEFORE DOING ANY WORK.**
> If you propose something listed here as "DEAD", you are wasting time and tokens.
> These lessons were learned over weeks of debugging. Do not repeat them.
>
> Last updated: 2026-03-09

---

## The #1 Rule

**STOP. THINK. SEARCH BEFORE YOU CODE.**

The old approach was rapid-fire one-off fixes in a single session. That created cascading bugs because:
1. No tests existed to catch regressions
2. No one verified the root cause before applying a fix
3. Fixes were applied to symptoms, not causes
4. The SQL Analytics Endpoint sync lag made us think things were broken when they weren't (see Section 3)

**The new approach**: Understand the problem fully, write a test that reproduces it, fix it, verify the test passes, QA reviews. No exceptions.

---

## 1. Pipeline Method Evolution (3 Attempts)

The FMD Framework orchestrates a sequential pipeline chain: Landing Zone, then Bronze, then Silver. Getting this to work with Service Principal (SP) authentication took three attempts over two weeks.

### Attempt 1: InvokePipeline Chain -- DEAD, DO NOT RETRY

**What we tried**: `PL_FMD_LOAD_ALL` used Fabric's `InvokePipeline` activity to chain LOAD_ALL to LOAD_LANDINGZONE to LOAD_BRONZE to LOAD_SILVER sequentially.

**Why it is dead**: **Fabric limitation BY DESIGN** -- InvokePipeline ignores ServicePrincipal connections entirely. It always uses "Pipeline Default Identity" (the interactive user token). When triggered via SP API, there is no user token, so it fails with `BadRequest`. This is NOT a configuration issue. It is unfixable.

**Evidence of exhaustive testing**:
- We tried two different connection objects:
  - V1: `6b2e33a1-...` (`CON_FMD_FABRIC_PIPELINES`, privacyLevel=None) -- failed
  - V2: `365d6ac6-...` (`CON_FMD_FABRIC_PIPELINES_V2`, privacyLevel=Organizational) -- also failed
- Both connections work fine for *direct* pipeline triggers via REST API. They ONLY fail inside InvokePipeline.
- `PL_FMD_LOAD_ALL` was recreated multiple times during debugging (final ID: `e45418a4-148f-49d2-a30f-071a1c477ba9`).
- **Source**: [Fabric Community confirmation](https://community.fabric.microsoft.com/t5/Fabric-platform/InvokePipeline-activity-ignores-Service-Principal-connection/m-p/4967320)

**What remains in the codebase**: Pipeline JSON files still have dead InvokePipeline activities. Ignore them.

**DO NOT**: Try to fix InvokePipeline auth. Try a different connection type. Try a V3 connection. Try different privacy levels. Try different workspace roles. It will not work. Microsoft has confirmed this is by design.

---

### Attempt 2: Local Direct Load via Python Engine -- WORKS BUT LIMITED

**What we built**: `engine/orchestrator.py` extracts from source SQL via pyodbc, uploads to OneLake via ADLS SDK. Also `scripts/run_load_all.py` -- a standalone REST API orchestrator that triggers each Fabric notebook directly via SP token.

**How `run_load_all.py` works**:
```
python scripts/run_load_all.py                # Full chain: LZ -> Bronze -> Silver
python scripts/run_load_all.py --skip-lz      # Skip LZ, run Bronze + Silver
python scripts/run_load_all.py --only bronze   # Run only Bronze
python scripts/run_load_all.py --only silver   # Run only Silver
python scripts/run_load_all.py --only lz       # Run only LZ
```

Gets SP token from `dashboard/app/api/.env`, triggers each notebook via `POST /v1/workspaces/{ws}/items/{id}/jobs/instances?jobType=RunNotebook`, polls the job location URL every 15-30 seconds until completion, then triggers the next step. Each step runs regardless of the previous step's result so partial loads still propagate.

**Limitations**:
- Requires VPN to on-prem SQL servers (for local engine mode)
- Runs on Steve's laptop or vsc-fabric server only
- Not schedulable within Fabric
- Good for ad-hoc triggering, not for unattended production runs

---

### Attempt 3: Notebook Method -- CURRENT, ACTIVE, PREFERRED

**What works**: Two complementary approaches, both using REST API to trigger notebooks directly.

**3a. Engine API (`engine/api.py`) -- Dashboard-Triggered**:
1. Dashboard sends POST to `/api/engine/start` with `load_method: "pipeline"`
2. `_pipeline_preflight_check()` validates queue tables + entity activation
3. `engine/notebook_trigger.py` discovers notebook IDs by display name (NOT hardcoded GUIDs)
4. Triggers notebooks via Fabric REST API using SP token
5. Creates UUID `run_id`, writes SQL run record via `sp_UpsertEngineRun`
6. Background poller thread (`_poll_fabric_jobs()`) polls Fabric every 30s
7. `_publish_run_summary()` sends SSE events for dashboard live updates

**3b. Fabric Notebook Orchestrator (`src/NB_FMD_ORCHESTRATOR.Notebook/`) -- Scheduled**:
Replaces `PL_FMD_LOAD_ALL` entirely. Uses `notebookutils.credentials.getToken()` for auth (notebook's built-in identity), then triggers each pipeline directly via REST API. Same sequential pattern but runs natively inside Fabric with no external dependencies.

**Notebook chain (in order)**:
| Step | Notebook | What it does |
|------|----------|-------------|
| LZ | `NB_FMD_PROCESSING_LANDINGZONE_MAIN` | Copies from source SQL -> LZ parquet |
| Bronze | `NB_FMD_LOAD_LANDING_BRONZE` | LZ parquet -> Bronze delta tables |
| Silver | `NB_FMD_LOAD_BRONZE_SILVER` | Bronze delta -> Silver SCD2 tables |

**Pipeline IDs** (in CODE workspace `c0366b24-e6f8-4994-b4df-b765ecb5bbf8`):
- LOAD_LANDINGZONE: `3d0b3b2b-a069-40dc-b735-d105f9e66838`
- LOAD_BRONZE: `8b7008ac-b4da-4861-9e1f-6b99d9f2f1e3`
- LOAD_SILVER: `90c0535c-c5dc-43a3-b51e-c44ef1808a60`

**Key files**:
- `engine/notebook_trigger.py` -- Dynamic notebook discovery + trigger
- `engine/api.py` -- REST API with preflight checks + run tracking
- `src/NB_FMD_ORCHESTRATOR.Notebook/notebook-content.py` -- In-Fabric scheduled orchestrator
- `scripts/run_load_all.py` -- Standalone Python orchestrator (backup/ad-hoc)

**DO NOT**: Hardcode notebook GUIDs. The NotebookTrigger class resolves by display name. Schedule `NB_FMD_ORCHESTRATOR` via Fabric's built-in scheduler for recurring production runs.

---

## 2. Bronze/Silver Activation Fix (4 Compounding Root Causes)

Bronze and Silver Fabric notebooks completed in 30-40 seconds with zero data loaded. The notebooks received empty entity arrays and had nothing to process. This took an entire debugging session to diagnose because **all 4 bugs had to be fixed together** -- fixing 1-2 made it look like nothing changed.

### Root Cause 1: IsActive=0 on 1,637 of 1,666 Bronze Entities

**Bug**: `sp_UpsertBronzeLayerEntity` and `sp_UpsertSilverLayerEntity` stored procedures default `@IsActive=0` on INSERT. Even though `deploy_from_scratch.py` Phase 13 passed `@IsActive=1`, the stored procs silently ignored it and defaulted to inactive. No error, just zero rows returned from views that filter on `IsActive=1`.

**Fix (one-time)**: `scripts/fix_bronze_silver_queue.py` -- bulk UPDATE to set IsActive=1 on all Bronze/Silver entities where the parent LZ entity is active.

**Fix (permanent)**: `deploy_from_scratch.py` Phase 13 now runs explicit activation queries AFTER entity registration:
```sql
-- Force-activate Bronze where parent LZ is active
UPDATE b SET b.IsActive = 1
FROM config.BronzeLayerEntity b
INNER JOIN config.LandingzoneEntity lz ON b.LandingzoneEntityId = lz.LandingzoneEntityId
WHERE lz.IsActive = 1 AND b.IsActive = 0

-- Same pattern for Silver (joins through Bronze to LZ)
UPDATE s SET s.IsActive = 1
FROM config.SilverLayerEntity s
INNER JOIN config.BronzeLayerEntity b ON s.BronzeLayerEntityId = b.BronzeLayerEntityId
INNER JOIN config.LandingzoneEntity lz ON b.LandingzoneEntityId = lz.LandingzoneEntityId
WHERE lz.IsActive = 1 AND b.IsActive = 1 AND s.IsActive = 0
```

**DO NOT**: Trust that sp_Upsert procs honor the @IsActive parameter. Always verify after bulk registration.

### Root Cause 2: Empty Pipeline Queue Tables

**Bug**: `execution.PipelineLandingzoneEntity` and `execution.PipelineBronzeLayerEntity` had **zero rows**. These are the work queue tables that notebooks read to know what to process. The notebook views (`vw_LoadToBronzeLayer`, `vw_LoadToSilverLayer`) use INNER JOIN to these tables -- zero queue rows means zero entities to process, so notebooks exit instantly.

**Fix (one-time)**: `scripts/fix_bronze_silver_queue.py` populates both tables with INSERT WHERE NOT EXISTS.

**Fix (permanent)**: Phase 13 seeds queue tables for all active entities immediately after registration.

**DO NOT**: Assume queue tables are auto-populated. They require explicit seeding. If notebooks complete instantly with zero rows, check these tables first.

### Root Cause 3: Pipeline Mode Not Tracking Runs

**Bug**: `engine/api.py` fired notebooks and returned immediately. Never created a SQL run record, never set engine status to "running", never polled for completion. This meant no run tracking in the metadata DB, the dashboard couldn't show live progress, and there was no audit trail.

**Fix**: `api.py` pipeline mode overhauled with 5 additions:
1. `_pipeline_preflight_check()` -- validates queue tables + entity activation BEFORE triggering notebooks. Returns error list (empty = pass).
2. Run tracking -- creates UUID `run_id`, writes SQL run record (`InProgress`) via `sp_UpsertEngineRun`, sets `engine.status`
3. Background poller -- `_poll_fabric_jobs()` thread polls Fabric job locations every 30 seconds, updates SQL on completion
4. `_publish_run_summary()` -- SSE event for dashboard live update on run completion
5. `/api/engine/health` endpoint -- now includes queue/activation warnings

### Root Cause 4: Missing LastLoadValue Records

**Bug**: 714 entities (55% of all entities) had empty `SourceName`, causing `LK_GET_LASTLOADDATE` lookup failures. Additionally, 1,070 of 1,666 LZ entities had no `execution.LandingzoneEntityLastLoadValue` record. Views INNER JOIN to this table, so missing rows = missing entities.

**Fix (permanent)**:
- Phase 13 calls `table.strip()` to prevent whitespace in SourceName during registration
- Phase 13 auto-seeds LastLoadValue records with default values for all registered entities (INSERT WHERE NOT EXISTS)
- Phase 14 excludes `rowversion`/`timestamp` from watermark candidates (binary types cannot be compared as varchar in SQL WHERE clauses)

**Diagnostic checklist** -- if notebooks complete quickly with zero rows, check in this order:
1. IsActive flags on Bronze/Silver entities
2. Queue table population (PipelineLandingzoneEntity + PipelineBronzeLayerEntity)
3. LastLoadValue records exist for all LZ entities
4. SourceName is not empty/whitespace on any entity
5. Run tracking is writing SQL records

---

## 3. SQL Analytics Endpoint Sync Lag -- THE PHANTOM BUG FACTORY

**This was the ROOT CAUSE of 2-3 weeks of phantom bugs.** Every agent working on this project MUST understand this issue.

### The Problem

Fabric Lakehouses expose two query endpoints:

| Storage Type | Consistency Model | Notes |
|---|---|---|
| `SQL_INTEGRATION_FRAMEWORK` (Fabric SQL Database) | **ACID / Strong** -- reads always current | Metadata DB, always reliable |
| Lakehouse via SQL Analytics Endpoint | **Eventually consistent** -- can lag minutes to HOURS | NEVER trust for post-load verification |
| Lakehouse via Spark/notebook | **Strong** -- reads Delta log directly | Use this for verification |

The SQL Analytics Endpoint runs on a background sync process. After writing data to a Lakehouse table via notebook, querying via SQL Analytics Endpoint can return STALE data (or no data at all for new tables).

### How We Wasted 2-3 Weeks

Every time we loaded data and then queried to verify, we got stale results. This led to:
- Unnecessary re-runs of notebooks that had actually succeeded
- False bug reports against loading notebooks that were working correctly
- Rewriting stored procedures that were actually fine
- Debugging "missing data" that was actually present but not yet synced to the analytics endpoint
- Those "fixes" for non-existent bugs introduced REAL bugs

### The Fix

**ALWAYS force-refresh the SQL Analytics Endpoint before trusting any lakehouse query:**
```
POST /v1/workspaces/{ws}/sqlEndpoints/{id}/refreshMetadata
Body: {"timeout": {"timeUnit": "Minutes", "value": 2}}
```

**Rule**: If you need to verify data after a load, use a Spark notebook query or the Fabric REST API to read the Delta table directly. Do NOT use the SQL Analytics Endpoint for post-load verification unless you have refreshed it first and waited for the refresh to complete.

**DO NOT**: Debug a "missing data" issue without first refreshing the endpoint. If data was just written, wait or refresh. This single issue caused more wasted effort than all other bugs combined.

---

## 4. Authentication Gotchas

### NEVER Use azure.identity

The `azure.identity` Python library **hangs indefinitely** in this environment. We discovered this early and wasted hours on it. All authentication is done via raw HTTP token requests using `urllib`.

**What works**:
```python
import urllib.request, urllib.parse, json

token_url = f"https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token"
data = urllib.parse.urlencode({
    "grant_type": "client_credentials",
    "client_id": CLIENT_ID,
    "client_secret": CLIENT_SECRET,
    "scope": SCOPE,
}).encode()
req = urllib.request.Request(token_url, data=data)
resp = json.loads(urllib.request.urlopen(req).read())
token = resp["access_token"]
```

**DO NOT**: Import `azure.identity`, `DefaultAzureCredential`, `ClientSecretCredential`, or anything from the Azure SDK auth stack. It will hang your process with no error.

### SQL Auth Scope is NOT What You Expect

**CORRECT scope**: `https://analysis.windows.net/powerbi/api/.default`
**WRONG scope**: `https://analysis.windows.net/powerbi/api/.default`

Using the wrong scope gets you a valid token that Fabric SQL rejects silently. This is a Fabric-specific quirk -- the SQL Database in Fabric is part of the Power BI API surface, NOT the Azure SQL surface. Every blog post and Stack Overflow answer will tell you to use `database.windows.net`. They are wrong for Fabric.

### Token Struct Format for pyodbc

The SP token must be injected into pyodbc via `attrs_before` using a specific binary struct:

```python
import struct
token_bytes = token.encode('utf-8')
token_struct = struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)
conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct})
```

**WRONG format**: `struct.pack('<IH...', ...)` -- this is the format from many blog posts and Microsoft docs examples. It does NOT work with Fabric SQL Databases. The correct format is `<I{len}s` (little-endian unsigned int length prefix followed by the raw bytes).

### pyodbc Silent Rollback Bug

`query_sql()` in the dashboard backend had a bug where stored procedures that return result sets were NOT getting committed. The code checked if `cursor.description` was None to decide whether to commit. Stored procs like `sp_UpsertDataSource` end with `SELECT DataSourceId FROM @OutputTable`, which returns a result set. Since `description` was not None, commit was skipped. `conn.close()` then implicitly rolled back the transaction (pyodbc default is `autocommit=False`).

**Fix**: Added `conn.commit()` after `cursor.fetchall()` on the result-set branch.

**Affected procs**: `sp_UpsertDataSource`, `sp_UpsertConnection`, and any proc ending with `SELECT ... FROM @OutputTable`.

### Service Principal Reference

- **Tenant**: `ca81e9fd-06dd-49cf-b5a9-ee7441ff5303`
- **Client (App) ID**: `ac937c5d-4bdd-438f-be8b-84a850021d2d`
- **SP Object ID**: `6baf0291-1868-4867-82d2-eb8d077438ba`
- **Client secret location**: `dashboard/app/api/.env` (NEVER commit this file)
- **Fabric API scope**: `https://api.fabric.microsoft.com/.default`
- **SQL scope**: `https://analysis.windows.net/powerbi/api/.default`

### Source Database Connection Rules

- **Auth**: `Trusted_Connection=yes;TrustServerCertificate=yes` (Windows auth via VPN)
- **Hostnames**: Short names ONLY -- `m3-db1`, `M3-DB3`, `sqllogshipprd`, `sql2016live`
- **DO NOT** append `.ipaper.com` suffix -- it causes connection failures
- **Driver**: `ODBC Driver 18 for SQL Server`

---

## 5. Deployment Gotchas

### deploy_from_scratch.py is the ONLY Deployment Method

**NB_SETUP_FMD was NEVER executed.** The notebook exists in the repo and in Fabric but was never run as the deployment mechanism. All deployment was done via custom Python scripts:
- `deploy_from_scratch.py` -- Full 17-phase greenfield deployment
- `create_variable_libraries.py` -- Created VAR_FMD and VAR_CONFIG_FMD (2/24)
- `fix_pipeline_guids.py` -- Fixed all cross-reference GUIDs in 13 pipelines (2/24)

**17 phases**: Auth, Capacity, Workspaces, Connections, Lakehouses, SQL DB, Setup Notebook, Notebooks, Variable Libraries, Pipelines, SQL Metadata, Local Config, Entity Registration, Load Optimization, Workspace Icons, Entity Digest Engine, Validate

**DO NOT**: Try to "fix deployment" by running NB_SETUP_FMD. Use `deploy_from_scratch.py` exclusively.

### Workspace IDs Changed (Old IDs are DEAD)

The project went through a workspace reorganization. Old workspace IDs appear throughout the codebase. Here is the mapping:

| Purpose | OLD ID (DEAD -- DO NOT USE) | NEW ID (CURRENT) |
|---------|----------------------------|-------------------|
| DATA (Dev) | `a3a180ff-fbc2-48fd-a65f-27ae7bb6709a` | `0596d0e7-e036-451d-a967-41a284302e8d` |
| CODE (Dev) | `146fe38c-f6c3-4e9d-a18c-5c01cad5941e` | `c0366b24-e6f8-4994-b4df-b765ecb5bbf8` |
| CONFIG | `f442f66c-eac6-46d7-80c9-c8b025c86fbe` | `e1f70591-6780-4d93-84bc-ba4572513e5c` |
| CODE (Prod) | -- | `f825b6f5-1c3d-4b5d-be8a-12e3c2523d38` |
| DATA (Prod) | -- | `5a54d6ec-bafb-4193-a1c3-00a3097c3660` |
| SQL DB Item | -- | `ed567507-5ec0-48fd-8b46-0782241219d5` |

**Rule**: Correct workspaces start with `INTEGRATION`. Anything prefixed `DEV_` or `OLD_` is dead. If you see `a3a180ff`, `146fe38c`, or `f442f66c` anywhere, it is referencing a deleted workspace.

The config bundle on `vsc-fabric` remote server had STALE workspace IDs (`a3a180ff`) -- fixed 3/3 to match current IDs.

### Pipeline GUID Remapping is MANDATORY After Re-deployment

Pipeline JSON files in `src/**/*.DataPipeline/pipeline-content.json` contain **anchor GUIDs** -- hardcoded references to other pipelines, notebooks, lakehouses, and connections. When items are re-deployed to Fabric, they get NEW GUIDs, but the JSON still references OLD GUIDs.

**After ANY pipeline re-deployment**: Run `scripts/fix_pipeline_guids.py` to remap all cross-reference GUIDs. Without this, pipelines fail with "item not found" errors.

### Duplicate Lakehouse Name Bug

`deploy_from_scratch.py` had a bug where it picked the wrong lakehouse when multiple lakehouses shared the same name (DEV vs PROD). Fixed by always picking the **lowest ID per name** (which is the DEV instance). All 596 entities are on DEV lakehouses (LH 1/2/3, not PROD 4/5/6).

### Fabric UI Import of .ipynb Fails

Attempting to import notebooks via the Fabric UI (drag-and-drop or import button) fails with a 400 error for complex notebooks like NB_SETUP_FMD.

**What works**: Use the Fabric REST API programmatically:
1. Create empty notebook: `POST /v1/workspaces/{ws}/items`
2. Upload content: `POST /v1/workspaces/{ws}/items/{id}/updateDefinition` with ipynb base64

**ALWAYS upload programmatically.** We have full API access. Never upload manually via the UI.

### OLD SQL Endpoint is DEAD

The old Fabric SQL endpoint (`x6eps4powstuxhgxdjmpmo3fsa-...datawarehouse.fabric.microsoft.com`) no longer works. To get the current endpoint:
```
GET /v1/workspaces/{CONFIG_WS}/sqlDatabases/{DB_ID}
```
Read `.properties.connectionString` from the response.

---

## 6. Development Rules (Hard-Won)

### NEVER Modify pipeline-content.json Directly

The files in `src/**/*.DataPipeline/pipeline-content.json` are Fabric pipeline definitions with complex GUID cross-references. Manual edits WILL break the GUID chain. If you need to change pipeline behavior:
1. Make changes in Fabric UI
2. Export the updated pipeline
3. Run `fix_pipeline_guids.py` to ensure all references are correct

### Pipeline Execution Order is ALWAYS LZ -> Bronze -> Silver

This is the medallion architecture. Data flows one direction only:
- **Landing Zone**: Raw copy from source SQL databases into parquet files
- **Bronze**: Parquet files loaded into Delta tables (append/overwrite)
- **Silver**: SCD Type 2 merge from Bronze into Silver delta tables

Running Bronze before LZ or Silver before Bronze will result in zero rows because upstream data doesn't exist yet.

### Pipeline Timeout Settings (DO NOT REDUCE)

These were increased after timeout-related failures killed legitimate long-running loads:

| Activity Type | Old Timeout (CAUSED FAILURES) | Current Timeout |
|--------------|------|-----------------|
| Copy Activity | 1 hour | **4 hours** |
| ExecutePipeline | 1 hour | **6 hours** |
| ForEach | 1 hour | **12 hours** |

The outer timeout (ForEach) must be greater than inner timeouts for proper error attribution.

### ForEach batchCount = 15

All ForEach activities in pipeline JSONs use `batchCount: 15` to limit parallel execution. Without this, 659 entities hitting the Fabric SQL metadata DB in parallel causes HTTP 429 throttling. One run took **13 hours 43 minutes** because of uncapped parallelism.

### Rowversion/Timestamp Columns Cannot Be Watermarks

Phase 14 (Load Optimization) auto-discovers watermark columns for incremental loading. Binary types like `rowversion` and `timestamp` CANNOT be compared as varchar in SQL WHERE clauses. These are now excluded from watermark candidates. Watermark priority: rowversion > *Modified* datetime > *Created* datetime > identity > none.

### Notebook-Specific Fixes Already Applied

| Issue | Fix | DO NOT revert |
|-------|-----|---------------|
| `%run` broken under SP API | Inlined all `%run` references | Do not re-introduce `%run` |
| `schema_enabled` string comparison | `str(schema_enabled).lower() == 'true'` (was `== True` on a string) | Do not use `==` for bool-string comparison |
| Missing pipeline context params | Added zero-GUID defaults in PARAMETERS cell | Do not remove defaults |
| Recursive `notebook.run()` | Fabric doesn't support it -- set CHUNK_SIZE = 99999 | Do not use recursive notebook calls |
| Bare audit logging crashes | Wrapped in try/except | Logging must never crash processing |

### Infrastructure Rules

| Rule | Detail |
|------|--------|
| Node.js on vsc-fabric | MUST be v22 LTS. v24 breaks better-sqlite3 (used by Nexus). |
| Fabric timestamps | Real UTC. Do NOT strip Z suffix. Browser handles UTC->local. Steve is Eastern (UTC-5). |
| GUID resolution | Dynamic by display name, NOT hardcoded. NotebookTrigger resolves at runtime. |
| Preflight checks | `engine/preflight.py` and `_pipeline_preflight_check()` exist. Use them before every run. |

---

## 7. Stored Procedure Gotchas

### sp_Upsert Procs Default to IsActive=0

Both `sp_UpsertBronzeLayerEntity` and `sp_UpsertSilverLayerEntity` have `@IsActive=0` as their default parameter value. Even if you pass `@IsActive=1`, the proc may ignore it. The permanent fix in `deploy_from_scratch.py` Phase 13 runs explicit UPDATE statements to force activation after registration.

### Stored Procs That Return Result Sets Need Explicit Commit

Any stored procedure that ends with a SELECT statement (returning data to the caller) will NOT auto-commit in pyodbc. You MUST call `conn.commit()` explicitly after reading the result set, or `conn.close()` will implicitly rollback.

### Key SQL Objects Reference

| Object | Schema | Purpose |
|--------|--------|---------|
| `PipelineLandingzoneEntity` | execution | LZ->Bronze work queue (IsProcessed flag, FilePath, FileName) |
| `PipelineBronzeLayerEntity` | execution | Bronze->Silver work queue (IsProcessed flag) |
| `LandingzoneEntityLastLoadValue` | execution | MUST have a row per LZ entity (even empty LoadValue) |
| `vw_LoadToBronzeLayer` | execution | View that joins Bronze entities + queue + IsActive filter |
| `vw_LoadToSilverLayer` | execution | View that joins Silver entities + queue + IsActive filter |
| `sp_GetBronzelayerEntity` | execution | Queries vw_LoadToBronzeLayer, STRING_AGG into JSON |
| `sp_GetSilverlayerEntity` | execution | Queries vw_LoadToSilverLayer, STRING_AGG into JSON |
| `sp_UpsertEngineRun` | execution | Creates/updates engine run tracking records |
| `sp_InsertEngineTaskLog` | execution | Individual task-level logging within a run |
| `sp_UpsertEntityStatus` | execution | Write-time entity status aggregation |
| `sp_BuildEntityDigest` | execution | Reads summary table (fast path) with 6-table fallback |

---

## 8. File Ownership Quick Reference

| System | Key Files | Owner |
|--------|-----------|-------|
| Engine backend | `engine/*.py` | Engine Lead |
| API server | `dashboard/app/api/server.py` | API Lead |
| Dashboard UI | `dashboard/app/src/**` | Frontend Lead |
| Notebooks & pipelines | `src/*.Notebook/`, `src/*.DataPipeline/` | Fabric Engineer |
| Deployment & config | `deploy_from_scratch.py`, `scripts/`, `config/` | DevOps Lead |
| Tests | `dashboard/app/tests/`, `engine/tests/` | QA Engineer |

---

## 9. Things That Actually Work

Not everything is a burned bridge. Here is what works reliably:

| Component | Status | Notes |
|-----------|--------|-------|
| Notebook orchestrator | WORKS | `NB_FMD_ORCHESTRATOR` via Fabric scheduler |
| `run_load_all.py` | WORKS | Ad-hoc from laptop/server with VPN |
| `deploy_from_scratch.py` | WORKS | 17-phase full deployment, dry-run tested |
| Direct pipeline triggers via REST API | WORKS | SP auth works for direct triggers (just not InvokePipeline) |
| Entity registration cascade | WORKS | `register_entity()` auto-creates Bronze + Silver |
| Load optimization (Phase 14) | WORKS | Auto-discovers PKs, watermarks, row counts |
| Entity Digest Engine | WORKS | `sp_BuildEntityDigest`, write-time aggregation, 1735 entities seeded |
| Optiva copy pipeline | WORKS | `PL_FMD_LDZ_COPY_SQL` -- 100/100 runs succeeded, ~18s each |
| Dashboard on vsc-fabric | WORKS | IIS reverse proxy, Windows Auth, port 8787 |
| Engine preflight checks | WORKS | Queue validation + entity activation checks before every run |
| SSE live dashboard updates | WORKS | `_publish_run_summary()` pushes completion events |

---

## 10. Local SQLite Control Plane (CURRENT ARCHITECTURE)

### Why

The Fabric SQL Analytics Endpoint has 0-30+ minute sync lag (see Section 3). This made the dashboard unreliable -- entity counts, pipeline status, and control plane data were stale or missing after every load. Weeks of phantom bugs traced back to this single issue.

### What Changed

**Local SQLite replaces Fabric SQL as the primary source of truth for all control plane / dashboard reads.** Fabric SQL remains as the secondary store (notebooks inside Fabric still write to it).

| Component | Role |
|-----------|------|
| `dashboard/app/api/control_plane_db.py` | **NEW** — SQLite WAL mode, 16 tables mirroring Fabric SQL schema. Primary read source for dashboard. |
| `engine/logging_db.py` | **MODIFIED** — Dual-write: local SQLite (primary) + Fabric SQL (secondary/best-effort). If Fabric SQL write fails, local data is still consistent. |
| `engine/orchestrator.py` | **MODIFIED** — Passes `local_db` module to AuditLogger for dual-write. |
| `dashboard/app/api/server.py` | **MODIFIED** — Control plane reads switch from `query_sql()` to local SQLite via `cpdb.*` functions. |
| `deploy_from_scratch.py` | **MODIFIED** — Phase 13b seeds local SQLite during entity registration. |
| Background sync thread | Every 5 minutes, catches notebook-initiated runs from Fabric SQL that bypassed the local engine. |

### Entity Counts (Corrected)

| Source | Entities |
|--------|----------|
| ETQ | 29 |
| M3 ERP | 596 |
| M3 Cloud | 187 |
| MES | 445 |
| Optiva | 409 |
| **Total** | **1,666 entities x 3 layers = 4,998 registrations** |

All 5 sources registered. All entities active.

### Rules for All Agents

- **DO NOT** add new `query_sql()` calls for control plane data — use `cpdb.*` (control_plane_db) instead.
- `query_sql()` is **STILL needed** for admin, DataBlender, DQ, and other non-control-plane endpoints.
- **DO NOT touch**: Fabric SQL stored procedures, the `query_sql()` function itself, `metrics_store.py`, or Engine `MetadataDB`/`SourceConnection` classes.
- **DO NOT** bypass the dual-write in `logging_db.py` — both stores must stay in sync.

**DO NOT**: Add new `query_sql()` calls for any data that `control_plane_db.py` already serves. The local SQLite is the primary source of truth for dashboard reads. Fabric SQL is secondary.

---

## 11. The Development Rules Going Forward

1. **No one-off fixes without tests.** Write a test that reproduces the bug FIRST.
2. **No fixing symptoms.** Find the root cause. If unsure, read this document again.
3. **No touching files outside your ownership zone** without coordination.
4. **No trusting SQL Analytics Endpoint queries** without refreshing first.
5. **No hardcoding GUIDs.** Everything resolves dynamically or reads from config.
6. **No reverting to InvokePipeline.** It is dead. Accept it.
7. **No deploying without preflight.** `engine/preflight.py` and `_pipeline_preflight_check()` exist for a reason.
8. **No using azure.identity.** Use raw urllib token requests.
9. **No modifying pipeline-content.json directly.** Export from Fabric UI, then run `fix_pipeline_guids.py`.
10. **No reducing pipeline timeouts.** The current values were set after production failures.
11. **No adding new `query_sql()` calls for control plane data.** Use `cpdb.*` (control_plane_db) instead. See Section 10.
