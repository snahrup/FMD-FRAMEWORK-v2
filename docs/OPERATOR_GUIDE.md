# FMD v3 — Operator Guide

Everything in this guide happens through the dashboard. No terminal access required.

---

## Getting Started

Open the dashboard in your browser: **http://localhost:8787**

You'll see two main pages:

| Page | What it shows |
|------|---------------|
| **Execution Matrix** (home page) | Entity-level status across Landing Zone, Bronze, and Silver layers |
| **Engine Control** (`/engine`) | Start/stop loads, view run history, health checks |

---

## Daily Operations

### Starting a Load

1. Navigate to **Engine Control** in the sidebar
2. Click **Start Run**
3. Select which layers to run:
   - **Landing Zone** — copies data from source databases to the lakehouse
   - **Bronze** — transforms raw files into Delta tables
   - **Silver** — applies business rules and SCD2 merge
4. Click **Launch**
5. Watch real-time progress in the Live Activity panel

### Checking Results

After a run completes:
- **Execution Matrix** shows green/red status for every entity across all layers
- Click any entity row to see detailed logs
- **Summary cards** at the top show success rate, total rows, and active errors

### Handling Failures

When entities fail (red status):
1. Click the failed entity in the Execution Matrix to see the error message
2. Each error includes a **plain-English suggestion** for what to fix
3. Common fixes:
   - **Connection timeout** → Check VPN is connected
   - **Source table not found** → Table may have been renamed or dropped
   - **OneLake 403** → Service principal permissions need updating
4. Once fixed, go to **Engine Control** → find the failed run → click **Retry Failed**

### Running a Health Check

1. Go to **Engine Control**
2. Click **System Health**
3. Review each check:
   - **Fabric SQL** — can we reach the metadata database?
   - **Source Systems** — can we connect to each on-prem database?
   - **OneLake** — can we write to the lakehouse?
   - **Stored Procedures** — are all required SQL objects present?
   - **Active Entities** — do we have entities configured to load?

All checks should show green. Red checks include diagnostic messages.

---

## Adding New Tables

1. Go to **Source Manager** in the sidebar
2. Click **Add Source** (if the database isn't registered yet)
3. Fill in the connection details (server, database, credentials)
4. Click **Discover Tables** — the system connects to the source and lists all tables
5. Select the tables you want to load
6. Click **Register** — tables are added to all three layers automatically
7. Go to **Engine Control** → **Start Run** to load the new tables

---

## Understanding the Execution Matrix

The matrix shows every entity as a row with three status columns:

| Status | Meaning |
|--------|---------|
| Green checkmark | Successfully loaded in the last run |
| Red X | Failed in the last run (click for details) |
| Gray circle | Never been loaded |
| Yellow clock | Pending / waiting to be processed |

### Filters

- **Source** dropdown — filter by database (MES, ETQ, M3 Cloud, etc.)
- **Status** dropdown — show only failed, succeeded, or never-run entities
- **Search** box — find a specific table by name
- **Time range** — show results from last 1h, 6h, 24h, or 7d

### Resetting an Entity

If an entity needs a full reload (instead of incremental):
1. Find the entity in the matrix
2. Click the **Reset** button in the Actions column
3. Confirm the reset
4. Run the engine — that entity will do a full load instead of incremental

---

## Monitoring Runs

### Real-Time View

During a run, the **Engine Control** page shows:
- Progress counter (entities processed / total)
- Live log stream (scrolling terminal view)
- Entity results as they complete
- Estimated time remaining

### Run History

The bottom of Engine Control shows the last 20 runs:
- **Status** — succeeded, failed, or stopped
- **Duration** — how long the run took
- **Entities** — how many succeeded/failed/skipped
- **Triggered By** — who started it (dashboard, schedule, retry)

Click any run to expand and see per-entity results.

---

## Troubleshooting

### "Engine is not responding"

The engine runs inside the dashboard server. If the dashboard is accessible but the engine shows "offline":
1. Check the server logs in `dashboard/app/api/fmd-dashboard.log`
2. The engine initializes on first request — try clicking **System Health**

### "Cannot connect to source database"

1. Verify VPN is connected
2. Run **System Health** to see which source is unreachable
3. Check the source server is online and accepting connections

### "OneLake write failed (403)"

The service principal may have lost permissions:
1. Verify the SP has Contributor access to the data workspace
2. Check the client secret hasn't expired
3. The secret is stored in `dashboard/app/api/.env` as `FABRIC_CLIENT_SECRET`

### "Bronze/Silver notebook failed"

The notebooks run in Fabric (Spark):
1. Check the Fabric workspace for notebook run status
2. Common issues: Spark session timeout, Delta table schema mismatch
3. The engine triggers notebooks via REST API — the notebooks themselves handle Delta operations

---

## Architecture Overview

```
Source Databases  ──→  Python Engine  ──→  OneLake Landing Zone
(on-prem SQL)          (this server)       (Parquet files)
                                                │
                                                ▼
                                        Fabric Notebooks
                                        (Bronze: Delta tables)
                                        (Silver: SCD2 merge)
                                                │
                                                ▼
                                          Power BI / Reports
```

The engine reads its configuration from the **Fabric SQL metadata database** — the same database that stores all entity definitions, connection info, and execution history. Everything is driven by data, not code.
