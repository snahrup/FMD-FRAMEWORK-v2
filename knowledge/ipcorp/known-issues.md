# Known Issues and Lessons Learned

> **Purpose**: Critical gotchas, pitfalls, and hard-won lessons specific to IP Corp's environment and the FMD Framework deployment
> **Last Updated**: March 2026

---

## Critical: SQL Analytics Endpoint Sync Lag

**ROOT CAUSE of 2-3 weeks of phantom bugs.** The Lakehouse SQL Analytics Endpoint is **eventually consistent**, NOT strongly consistent.

| Component | Consistency |
|-----------|-------------|
| `SQL_INTEGRATION_FRAMEWORK` (Fabric SQL Database) | **ACID / Strong** -- reads always current |
| LZ / Bronze / Silver Lakehouses | **Eventually consistent** -- 0s to 30+ min lag |

### What Happens
- After data is written to a Lakehouse (notebooks, pipelines, Copy activities), the SQL endpoint can take 0 seconds to 30+ minutes to reflect changes
- The first query after a write can "freeze" a stale snapshot for ALL subsequent queries
- Multiple lakehouses in one workspace increases lag (we have 3 in the DATA workspace)

### The Fix
```
POST /v1/workspaces/{workspace}/sqlEndpoints/{endpoint_id}/refreshMetadata
Body: {"timeout": {"timeUnit": "Minutes", "value": 2}}
```

**RULE**: Never trust a lakehouse SQL query without refreshing first. If results look wrong, force-refresh the endpoint, re-query, THEN diagnose.

**Reference**: Microsoft Known Issue KI-1092

---

## Authentication Gotchas

### Source Database Auth
| Rule | Detail |
|------|--------|
| Use Windows Auth via VPN | `Trusted_Connection=yes;TrustServerCertificate=yes` |
| Short hostnames only | Do NOT append `.ipaper.com` |
| Driver | `ODBC Driver 18 for SQL Server` |

### Fabric SQL Database Auth
| Rule | Detail |
|------|--------|
| Use SP token | NOT user credentials |
| Scope | `https://analysis.windows.net/powerbi/api/.default` (NOT `database.windows.net`) |
| Token struct | `struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)` |
| Wrong struct variant | `<IH...` will fail silently -- do NOT use |

### MCP Database Auth (Dev/Test Environments)
| Rule | Detail |
|------|--------|
| Use SQL Authentication | Windows Auth (INTERPLASTIC\SNahrup) has NO database access on dev servers |
| Account | `UsrSQLRead` |

---

## InvokePipeline Does NOT Support SP Auth

**Fabric limitation BY DESIGN**: The `InvokePipeline` activity ignores Service Principal connection and uses "Pipeline Default Identity" (user token). When triggered via SP API, the chain LOAD_ALL --> LOAD_LANDINGZONE/BRONZE/SILVER fails with `BadRequest`.

**Workaround**: `scripts/run_load_all.py` -- REST API orchestrator that triggers each pipeline directly via SP token.

**Also**: `src/NB_FMD_ORCHESTRATOR.Notebook/` -- Fabric notebook orchestrator for in-Fabric scheduling.

---

## Pipeline Root Causes (All Fixed)

These 4 compounding issues caused cascading pipeline failures. All have been permanently fixed in `deploy_from_scratch.py`:

| Root Cause | Impact | Fix |
|------------|--------|-----|
| **714 entities with empty SourceName** | LK_GET_LASTLOADDATE lookup failures (55% of all failures) | Phase 13: `table.strip()` prevents whitespace |
| **Fabric SQL 429 throttling** | 659 entities hitting metadata DB in parallel | ForEach `batchCount: 15` on all activities |
| **OutOfMemory on large tables** | 21+ copy failures | Copy timeout extended to 4 hours |
| **ForEach 1hr timeout** | Killed activities that would eventually succeed | ForEach timeout extended to 12 hours |

---

## Bronze/Silver Activation Issues

Three root causes found and fixed (March 2026):

| Issue | Detail |
|-------|--------|
| **IsActive=0 on 1,637/1,666 Bronze entities** | `sp_Upsert` procs defaulted to inactive despite `@IsActive=1` |
| **Empty pipeline queue tables** | `PipelineLandingzoneEntity` + `PipelineBronzeLayerEntity` had 0 rows |
| **Pipeline mode not tracking runs** | `api.py` fired notebooks but never wrote SQL run records or set engine status |

---

## Deployment Gotchas

| Gotcha | Detail |
|--------|--------|
| **Variable Library Boolean type rejected** | Fabric API rejects Boolean -- use String with "true"/"false" |
| **updateDefinition is async (202)** | Must poll the Location header for completion |
| **Deleted item name cooldown** | Fabric won't let you recreate with same name for ~60 seconds |
| **Pipeline cross-reference GUIDs** | InvokePipeline activities have hardcoded pipelineId fields that must match actual workspace item IDs |
| **Zero GUID = same workspace** | `00000000-0000-0000-0000-000000000000` in InvokePipeline workspaceId means "current workspace" |
| **Connection.Type case sensitivity** | Pipeline Switch uses `@toUpper(item().ConnectionType)`. DB stored `SqlServer` but Switch expected `SQL` |
| **Default parameter stale GUIDs** | Deploy script creates pipelines from repo definitions which have old template GUIDs as defaults |
| **Config bundle workspace IDs** | Config bundle on VSC-Fabric server had STALE workspace IDs (`a3a180ff` old) -- must match local (`0596d0e7`) |

---

## Data Quirks

### M3 ERP
| Quirk | Detail |
|-------|--------|
| 6-character names | All table/field names are cryptic `PPNNNN` format -- use Metadata Publisher (MDP) to decode |
| Dates as integers | YYYYMMDD format -- cast via `CAST(CAST(column AS VARCHAR) AS DATE)` |
| Implied decimals | Some qty fields store 1000 meaning 10.00 -- divide by 100 |
| Schema differences | On-Prem: `MVXJDTA.Table`; Cloud: no prefix |
| Company filter required | Without `WHERE xxCONO = [company]`, returns cross-company data |
| Log-shipping delay | ~30 minutes from production |

### MES
| Quirk | Detail |
|-------|--------|
| Batch ID format | Numeric strings with possible leading spaces -- always use `TRIM()` when joining |
| Archive tables | `_ARC` suffix for historical data |
| Temp tables | `tmp_*`, `x_*`, `X_*` prefixes -- do NOT use for production |

### Load Optimization
| Quirk | Detail |
|-------|--------|
| Rowversion/timestamp columns | Binary types can't be compared as varchar -- excluded from watermark candidates |

---

## Business Rules: What NOT to Assume

| Assumption | Reality |
|------------|---------|
| All companies have MES data | NO -- only Interplastic & HK Research |
| Data is real-time | NO -- log-shipping has 30-min delay; SQL endpoint has variable lag |
| PlantPAx exists | NO -- it's FactoryTalk Batch |
| Salesforce is system of record | NO -- M3 is the source of truth |
| M3 Cloud has schema prefix | NO -- only On-Prem has schema |
| Companies can see each other's financials | NO -- complete isolation required (CIO mandate) |
| NAC has manufacturing data | NO -- distribution only, no MES |
| DiverData is a source system | NO -- it's a data warehouse with truncate/reload ETL from M3 |

---

## Power BI Gotchas

### YTD Margin Calculation
**Problem**: Can't aggregate a percentage with DATESYTD
```dax
-- WRONG: Margin% YTD = CALCULATE([Margin %], DATESYTD('Date Table'[Date]))
-- RIGHT: Margin% YTD = DIVIDE([Margin YTD], [Sales Amt YTD], 0) * 100
```

### Yesterday's Sales Always Blank
**Problem**: Uses `TODAY()` but data may not include today-1 yet. Use `MAX('Sales Data'[invoice_date])` instead.

### IsPast Filter for YTD Comparisons
Always use `'Date Table'[IsPast] = TRUE()` when comparing YTD to LYTD to prevent comparing full prior year to partial current year.

---

## Related Files

- [gotchas/known-issues.md](gotchas/known-issues.md) -- Original known issues file (January 2026 snapshot)
- [fabric-environment.md](fabric-environment.md) -- Workspace IDs, connection details
- [source-databases.md](source-databases.md) -- Database connection details
