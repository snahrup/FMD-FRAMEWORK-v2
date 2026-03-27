# VSC-FABRIC Server Handoff — 2026-03-27

**You are a Claude Code session running directly on `vsc-fabric` (Windows Server).** Your job is to manage the FMD Framework dashboard and bulk extraction pipeline. Steve is handing you control because the push-pull-copy-paste loop between his laptop and this server is too slow.

---

## YOUR ENVIRONMENT

| Item | Value |
|------|-------|
| **Server** | `vsc-fabric` (Windows Server, domain `INTERPLASTIC\SAsnahrup`) |
| **Project path** | `C:\Projects\FMD_FRAMEWORK` |
| **Dashboard URL** | `http://localhost:8787` (local) / `http://vsc-fabric/` (LAN via IIS reverse proxy) |
| **IIS** | Reverse proxy on port 80 -> localhost:8787 with Windows Auth |
| **Dashboard service** | `nssm` service named `FMD-Dashboard` |
| **Python** | System Python 3.x |
| **Node** | Must be v22 LTS (v24 breaks better-sqlite3) |
| **ODBC Driver** | `ODBC Driver 18 for SQL Server` |
| **Auth** | Windows auth (`Trusted_Connection=yes;TrustServerCertificate=yes`) — no passwords needed |
| **VPN** | Server is ON the LAN — direct access to all source SQL Servers |
| **Shell** | PowerShell (NOT bash — adjust commands accordingly) |

---

## IMMEDIATE TASKS (in order)

### Task 1: Clean up stale extraction runs

The dashboard shows ~17,000 entities stuck in "extracting" and "in progress" from killed runs.

```powershell
cd C:\Projects\FMD_FRAMEWORK
git pull
python scripts/cleanup_stale_runs.py
```

Expected output: `Cancelled N runs, ~17000 task logs`

Verify by refreshing Mission Control at `http://localhost:8787/load-mission-control` — should show clean slate.

### Task 2: Rebuild the frontend

The React dashboard needs rebuilding so the new Table Browser (SQL Explorer with checkboxes + "Load" button) is live.

```powershell
cd C:\Projects\FMD_FRAMEWORK\dashboard\app
npm install          # if node_modules is missing/stale
npx vite build       # builds to dist/ — do NOT use npm run build (TS errors in non-critical files)
```

If `npx vite build` hangs: check Node version (`node --version` must be v22.x), try `npx vite build --debug`, or clear cache with `Remove-Item -Recurse node_modules\.vite` first.

### Task 3: Restart the dashboard service

```powershell
nssm restart FMD-Dashboard
```

If it says `START_PENDING`:
```powershell
nssm stop FMD-Dashboard confirm
nssm start FMD-Dashboard
```

Verify: `http://localhost:8787` should load. Check `nssm status FMD-Dashboard` and `netstat -ano | findstr 8787`.

### Task 4: Run bulk extraction with ODBC-level timeout

```powershell
cd C:\Projects\FMD_FRAMEWORK
python scripts/turbo_extract.py --method pyodbc --skip-existing --workers 8 --timeout 120
```

**Key flags:**
- `--skip-existing` skips tables that already have a `.parquet` file in `parquet_out/`
- `--timeout 120` = ODBC query timeout in seconds. The driver cancels the query server-side after 2 min. This is NOT a Python-level timeout — it actually kills the SQL query so the worker is freed.
- `--workers 8` = 8 parallel threads
- `--method pyodbc` = force pyodbc (most reliable)

**What to expect:**
- Fast tables (small lookup tables) will fly through at 5-15/sec
- Medium tables (10K-100K rows) take 5-30 seconds each
- Large tables (1M+ rows) may hit the 120s timeout and get skipped with `FAIL` status
- After first pass, you can re-run with `--timeout 600` to get the big ones

**Output goes to:** `C:\Projects\FMD_FRAMEWORK\parquet_out\{namespace}\{table}.parquet`

### Task 5: Verify Table Browser works

1. Navigate to `http://vsc-fabric/` (or `http://localhost:8787`)
2. Go to SQL Explorer in the sidebar
3. Expand a server -> database -> schema
4. Tables that have been extracted should show a green check + "Loaded" badge
5. Unloaded tables should show a checkbox
6. Select a few tables, click "Load" -> should register + start extraction

---

## SOURCE DATABASE CONNECTIONS

All accessible directly from this server (LAN, no VPN needed):

| Source | Server | Database | Entities |
|--------|--------|----------|----------|
| MES | `m3-db1` | `mes` | 316 |
| ETQ | `M3-DB3` | `ETQStagingPRD` | 13 |
| M3 ERP | `sqllogshipprd` | `m3fdbprd` | 574 |
| OPTIVA | (check connections table) | `optivalive` | 256 |
| **Total** | | | **1,159** |

**Connection string pattern:**
```
DRIVER={ODBC Driver 18 for SQL Server};SERVER={server};DATABASE={database};Trusted_Connection=yes;TrustServerCertificate=yes;
```

Short hostnames only — do NOT append `.ipaper.com`.

---

## KEY FILES

| File | Purpose |
|------|---------|
| `scripts/turbo_extract.py` | Bulk SQL Server -> Parquet extraction (BCP/arrow-odbc/pyodbc) |
| `scripts/entities_export.json` | 1,159 entity definitions (JSON, avoids needing the SQLite DB) |
| `scripts/cleanup_stale_runs.py` | Cancel orphaned "running"/"extracting" records in dashboard DB |
| `dashboard/app/api/server.py` | Dashboard HTTP server (Python, serves API + React static files) |
| `dashboard/app/api/fmd_control_plane.db` | SQLite control plane DB (runs, entities, connections, config) |
| `dashboard/app/api/routes/sql_explorer.py` | SQL Explorer API (browse tables, register, enrichment) |
| `dashboard/app/src/pages/SqlExplorer.tsx` | Table Browser UI (checkboxes, Load button, Loaded badges) |
| `config/item_config.yaml` | Fabric workspace GUIDs (source of truth) |

---

## ENTITIES JSON KEY MAPPING

The `entities_export.json` uses these keys:

```json
{"id": 1, "schema": "CUSJDTA", "table": "CUSCONGB", "source": "m3fdbprd", "server": "sqllogshipprd", "database": "m3fdbprd", "avg_duration": 11.5, "avg_rows": 157284}
```

`turbo_extract.py` normalizes these on load to match the DB column names:
- `table` -> `source_name`
- `schema` -> `source_schema`
- `source` -> `ds_name`
- (derived) `namespace` from lookup: `m3fdbprd`->`m3`, `MES`->`mes`, `ETQStagingPRD`->`etq`, `optivalive`->`optiva`

**Output path pattern:** `parquet_out/{namespace}/{source_name}.parquet`

---

## DASHBOARD DB SCHEMA (key tables)

### engine_runs
Tracks extraction runs. Key columns:
- `RunId` (TEXT PK), `Status` (TEXT), `TotalEntities`, `SucceededEntities`, `FailedEntities`
- `StartedAt`, `EndedAt`, `TotalDurationSeconds`, `TotalRowsRead`, `TotalBytesTransferred`
- `HeartbeatAt`, `CompletedUnits`, `EtaSeconds`

**Valid statuses:** `running`, `Completed`, `Succeeded`, `Failed`, `Aborted`, `Interrupted`, `cancelled`

### engine_task_log
Per-entity extraction results:
- `RunId`, `EntityId`, `Status`, `RowsRead`, `BytesTransferred`, `DurationSeconds`
- `Method` (bcp/arrow-odbc/pyodbc), `Error`, `StartedAt`

**Valid statuses:** `extracting`, `succeeded`, `failed`, `skipped`, `cancelled`

### lz_entities / bronze_entities / silver_entities
Entity registrations for each medallion layer. Cascade: LZ -> Bronze -> Silver.

### connections
Registered SQL Server connections (ServerName, DatabaseName, ConnectionId).

### datasources
Source systems (Name, ConnectionId, DataSourceId).

---

## COMMON OPERATIONS

### Check what's already extracted
```powershell
# Count parquet files per namespace
Get-ChildItem -Path parquet_out -Recurse -Filter *.parquet | Group-Object DirectoryName | Select-Object Count, Name
```

### Check dashboard service health
```powershell
nssm status FMD-Dashboard
netstat -ano | findstr 8787
```

### Check extraction progress (while running)
```powershell
# The turbo_extract console output shows real-time progress
# Or query the DB:
python -c "import sqlite3; conn = sqlite3.connect('dashboard/app/api/fmd_control_plane.db'); r = conn.execute('SELECT Status, COUNT(*) FROM engine_task_log WHERE RunId = (SELECT RunId FROM engine_runs ORDER BY StartedAt DESC LIMIT 1) GROUP BY Status'); [print(x) for x in r.fetchall()]"
```

### Kill a hung extraction
```powershell
taskkill /F /IM python.exe
python scripts/cleanup_stale_runs.py
```

### Re-run extraction for failed tables only
After a full run, tables that timed out can be retried with a longer timeout:
```powershell
python scripts/turbo_extract.py --method pyodbc --skip-existing --workers 4 --timeout 600
```
(Lower workers + higher timeout for the remaining big tables)

---

## WORKSPACE GUIDs (from item_config.yaml)

| Workspace | GUID |
|-----------|------|
| DATA (Dev) | `0596d0e7-e036-451d-a967-41a284302e8d` |
| CODE (Dev) | `c0366b24-e6f8-4994-b4df-b765ecb5bbf8` |
| CONFIG | `e1f70591-6780-4d93-84bc-ba4572513e5c` |
| DATA (Prod) | `5a54d6ec-bafb-4193-a1c3-00a3097c3660` |
| CODE (Prod) | `f825b6f5-1c3d-4b5d-be8a-12e3c2523d38` |
| SQL DB Item | `ed567507-5ec0-48fd-8b46-0782241219d5` |

**OLD/DEAD (do NOT use):** `a3a180ff`, `146fe38c`, `f442f66c`

---

## KNOWN ISSUES

1. **`npm run build` has TS errors** — Use `npx vite build` directly (skips tsc check). The TS errors are in non-critical files and don't affect runtime.

2. **Data Lineage page shows misleading statuses** — Bronze/Silver show "Succeeded" for entities that are only registered, not actually loaded. This is a display bug (conflates registration with data presence). Not blocking.

3. **SQL Endpoint sync lag** — After writing to lakehouses, the SQL Analytics Endpoint can take minutes to reflect changes. Force-refresh before trusting lakehouse queries. See `sql-endpoint-sync-lag.md` in project memory.

4. **M3C (DI_PRD_Staging) entities** — The namespace map has `di_prd_staging` -> `m3c`. If you see entities from `sql2016live`/`DI_PRD_Staging`, they map to the `m3c` namespace.

---

## NSSM SERVICE DETAILS

If you need to check or modify the FMD-Dashboard service:

```powershell
nssm get FMD-Dashboard Application       # What executable runs
nssm get FMD-Dashboard AppParameters      # Command-line args
nssm get FMD-Dashboard AppDirectory       # Working directory
nssm edit FMD-Dashboard                   # GUI editor
```

The service should be running `python server.py` from `C:\Projects\FMD_FRAMEWORK\dashboard\app\api`.

---

## RECENT GIT HISTORY

```
2dabc35 fix(scripts): cleanup_stale_runs catches 'extracting' and 'Interrupted' statuses
e20f441 fix(scripts): correct column name EndedAt in cleanup_stale_runs
e4569d0 feat(scripts): add cleanup_stale_runs.py for orphaned engine runs
5fa8059 fix(scripts): use ODBC query timeout instead of useless future.result timeout
0ee249d fix(scripts): normalize JSON entity keys in turbo_extract get_entities
c59bf31 feat(scripts): add --timeout flag to turbo_extract (default 300s)
9b4e732 chore: regenerate entities_export.json — 1159 entities, no phantoms
373e7f9 feat(sql-explorer): Table Browser — browse, select, and load tables into warehouse
fab8d4c feat(scripts): turbo_extract now logs to dashboard DB
```

---

## TL;DR — JUST DO THIS

```powershell
cd C:\Projects\FMD_FRAMEWORK
git pull
python scripts/cleanup_stale_runs.py
cd dashboard\app
npm install
npx vite build
cd C:\Projects\FMD_FRAMEWORK
nssm restart FMD-Dashboard
python scripts/turbo_extract.py --method pyodbc --skip-existing --workers 8 --timeout 120
```
