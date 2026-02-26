# Bronze Pipeline Debugging Log

## Initial Context
- Objective: Fix end-to-end load for ETQ, M3 Cloud, MES, and M3 ERP.
- Workspaces: DATA=a3a180ff, CODE=146fe38c
- Lakehouses: LZ=2aef4ede, Bronze=cf57e8bf, Silver=44a0993f

## Iteration 3 — 2026-02-25 21:51 EST

### Current Entity Counts
| Data Source | DS ID | LZ Registered | LZ Processed | LZ Pending |
|---|---|---|---|---|
| MES | 4 | 445 | 52/1002 | 950 |
| ETQ | 5 | 29 | 78/185 | 107 |
| m3fdbprd | 6 | 133 | 0 | 0 (no LZ runs) |
| DI_PRD_Staging | 7 | 185 | 10/370 | 360 |

- **Bronze**: 792 registered, 0/50 processed, 1417 pending in view
- **Silver**: 791 registered, 50 pending in view

### Root Causes Found
1. **PK="N/A" crash** (line 388-400): `re.split('[, ; :]', "N/A")` → `["N/A"]` → `raise ValueError` unhandled
2. **No global error handling**: All cells after StartNotebookActivity unprotected
3. **Duplicate rows crash**: `raise ValueError("duplicated rows")` instead of dedup

### Fixes Applied & Uploaded
1. `_processing_error` flag + guard on every processing cell
2. PK="N/A" → falls back to ALL columns as composite key
3. Duplicate rows → `dropDuplicates` instead of crash
4. All errors → logged in EndNotebookActivity LogData with error details
5. Notebook exits `ERROR: <msg>` or `OK`
6. **Uploaded to Fabric**: NB_FMD_LOAD_LANDING_BRONZE (ID: e761229f-bf1a-4858-92d0-4532b249afbe) — HTTP 202

### SQL Schema Reference
- `logging.PipelineExecution`: PipelineRunGuid, PipelineName, EntityId, EntityLayer, LogType, LogDateTime, LogData (NOT PipelineExecutionId/StartDateTime/EndDateTime/Status)
- `execution.PipelineBronzeLayerEntity`: PipelineBronzeLayerEntityId, BronzeLayerEntityId, TableName, SchemaName, IsProcessed, LoadEndDateTime

### Auth Pattern (NEVER use azure.identity — it hangs)
```python
import urllib.request, urllib.parse, json, struct, pyodbc
body = urllib.parse.urlencode({
    'grant_type': 'client_credentials', 'client_id': CLIENT, 'client_secret': SECRET,
    'scope': 'https://database.windows.net/.default',
})
req = urllib.request.Request(f'https://login.microsoftonline.com/{TENANT}/oauth2/v2.0/token',
    data=body.encode(), headers={'Content-Type': 'application/x-www-form-urlencoded'})
token = json.loads(urllib.request.urlopen(req).read())['access_token']
token_bytes = token.encode('UTF-16-LE')
token_struct = struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)
conn = pyodbc.connect(conn_str, attrs_before={1256: token_struct})
```

### Critical Discovery: 91% PK = N/A
- **723/792 Bronze entities** have `PrimaryKeys = 'N/A'`
- ALL ETQ entities have PK=N/A
- This was the MAIN crash cause — every entity hit `raise ValueError("PK: N/A doesn't exist")`
- Fix: fall back to all columns as composite key

### Pipeline Triggered
- Run `994cb84a` started 2026-02-26 03:04 UTC (InProgress)
- Previous run `6fed7f56` failed after 1 hour with `FA_THROW_ERROR` (notebook crash)
- Using fixed notebook with error handling

### Lakehouse "Unidentified" Issue (RESOLVED)
- `Tables/dbo` empty folder under Bronze Lakehouse → showed as "Unidentified" in UI
- Deleted via OneLake DELETE API → resolved
- `lakehouse_schema_enabled = "True"` (string) vs `if schema_enabled == True:` (boolean) → ALWAYS False
- Notebook always uses flat path: `Tables/{NS_lower}_{Schema}_{Table}` (e.g., `etq_dbo_ETQ_Customers`)
- Lakehouse was NOT created with `schemaEnabled=true` — enabling via PATCH returns "OperationNotSupportedForItem"
- Creating SQL schemas (ETQ, M3C, MES) via analytics endpoint does NOT create physical OneLake folders
- **50 Delta tables recognized** by SQL analytics endpoint across ETQ (12), M3C (5), MES (33)

### Pipeline Run 994cb84a (Current)
- Started: 2026-02-26 03:04 UTC
- Status: InProgress (27+ min at last check)
- No entity-level logs yet (parallel notebook still processing)
- PipelineBronzeLayerEntity: 50 total, 0 processed (these are the batch from stored proc)
- Bronze view: 1417 pending entities total

### Entity Registration Status (Updated)
| Data Source | DS ID | LZ Entities | Bronze | Silver |
|---|---|---|---|---|
| MES | 4 | 445 | 445 | 445 |
| ETQ | 5 | 29 | 29 | 29 |
| M3 (m3fdbprd) | 6 | 596 | 596 | 596 |
| M3 Cloud | 7 | 185 | 185 | 185 |
| **TOTAL** | | **1,255** | **1,255** | **1,255** |

### Next Steps
- Monitor Bronze run to completion
- LZ pipeline for DS 6 (m3fdbprd) — needs first run (no data in LZ yet)
- Silver pipeline after Bronze verified
- Verify parquet in all 3 layers
