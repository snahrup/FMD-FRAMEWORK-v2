# Real Data Loader Operator Guide

Last updated: 2026-04-24

## What Changed

FMD now treats Dagster orchestration checks and real data loads as separate run types.

- **Orchestration Check** validates Dagster graph execution, scope, layer ordering, and event sync. It does not extract source rows or write lakehouse data.
- **Real Smoke Load** runs one safe entity through the real framework path. It is only available when Dagster is in framework mode and runtime preflight passes.
- **Real Scoped Load** runs selected source/entity scope through the real framework path. It requires explicit scope.
- **Full Estate Load** stays disabled until scoped smoke loads prove the environment and audit path.

## Required Runtime State

Before real loading can run:

- Dagster runtime mode must be `framework`.
- Python must import `_overlapped` successfully on Windows.
- The FMD API/Dagster Python environment must include `pyodbc`, `polars`, `pyarrow`, `deltalake`, `azure-identity`, `azure-storage-file-datalake`, `msal`, and `requests`.
- Source SQL servers must be reachable through VPN.
- OneLake write access must work through either `ONELAKE_MOUNT_PATH` or ADLS credentials.

## Local Stack Commands

Dry-run mode:

```powershell
cd C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK
pwsh .\dashboard\app\.codex-preview\start-local-stack.ps1 -RuntimeMode dry_run
```

Framework mode:

```powershell
cd C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK
pwsh .\dashboard\app\.codex-preview\start-local-stack.ps1 -RuntimeMode framework
```

## Install Real-Loader Python Packages

Install into the same Python environment used by the FMD API/Dagster local stack:

```powershell
cd C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK
C:\Users\snahrup\CascadeProjects\FMD_ORCHESTRATOR\.venv\Scripts\python.exe -m pip install -r requirements-real-loader.txt
```

If this fails with `getaddrinfo failed` or `_overlapped` / WinError 10106, the Windows network stack is not healthy enough for real loading. Run the existing elevated network/Python repair helper, reboot, then retry.

## Smoke Entity

The current safe smoke candidate is exposed through:

```text
GET /api/engine/smoke-entity
```

Current selected candidate:

```json
{
  "entity_id": 599,
  "source": "MES",
  "schema": "dbo",
  "table": "alel_lab_batch_hdr_tbl"
}
```

## Smoke Test Ladder

1. Start in dry-run mode and confirm the dashboard loads.
2. Switch to framework mode.
3. Open Load Mission Control and choose `Real Smoke Load`.
4. Click `Run Preflight`. The dashboard must show passing checks before `Start Pipeline` is enabled.
5. Run Real Smoke Load from Load Mission Control.
6. Verify `engine_task_log.RowsRead > 0` and `RowsWritten > 0`.
7. Verify the Landing Zone Parquet exists.
8. Run Bronze for the same entity.
9. Run Silver for the same entity.
10. Only then enable Real Scoped Load for a selected source.

## Reading Load Mission Control

- Runtime badge says whether you are in `Dagster dry run` or `Dagster framework`.
- Dry-run KPI labels are checks, not loaded tables.
- Real-run KPI labels are loaded/failed/remaining tables plus rows/files.
- A dry-run warning appears whenever the selected run has `LoadType = dry_run`.
- Real run buttons stay blocked until preflight passes. A failed preflight shows the exact failing check in the modal.

## Dagster Pages Inside FMD

The FMD left nav mirrors the relevant Dagster pages:

- Overview -> `/dagster`
- Runs -> `/dagster/runs`
- Catalog -> `/dagster/catalog`
- Jobs -> `/dagster/jobs`
- Automation -> `/dagster/automation`
- Lineage -> `/dagster/lineage`
- Deployment -> `/dagster/deployment`

If the iframe cannot load because Dagster is down or blocked, the page shows a direct `Open Dagster` fallback instead of leaving the user with a blank frame.

Aliases also work when a user naturally uses Dagster terminology:

- Assets -> `/dagster/assets` maps to FMD Catalog.
- Locations -> `/dagster/locations` maps to FMD Deployment.
- Asset Graph -> `/dagster/asset-graph` maps to FMD Lineage.
