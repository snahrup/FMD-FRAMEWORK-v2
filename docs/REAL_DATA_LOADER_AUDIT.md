# Real Data Loader Audit

Last updated: 2026-04-24 17:47 America/New_York

## Current Verdict

The code path is now explicitly separated between Dagster dry-run orchestration and Dagster framework-mode real loading. The real-loader path is not yet runnable on this local machine because the Windows Python socket stack and Python package environment are unhealthy.

## Verified Changes

- Added `GET /api/engine/runtime`.
- Added `POST /api/engine/preflight`.
- Added `GET /api/engine/smoke-entity`.
- Added framework-mode scope guard to block accidental full-estate real loads.
- Added selectable local stack runtime mode: `dry_run` or `framework`.
- Added detailed framework event payloads in `FMD_ORCHESTRATOR`.
- Changed Dagster framework event sync so it does not blindly write zero-row synthetic task rows over real engine rows.
- Added Load Mission Control runtime badge.
- Replaced ambiguous `Bulk Snapshot Mode` toggle with explicit run type cards.
- Added a required real-load preflight gate in Load Mission Control.
- Added user-visible launch errors instead of silent console-only failures.
- Added Load Mission Control `runtimeMode`, `isDryRun`, `rowsWritten`, and `filesWritten` fields.
- Added FMD-level Dagster page tabs and aliases for Dagster catalog/assets and deployment/locations.
- Added route aliases for common demo/operator URLs.
- Added `requirements-real-loader.txt`.
- Added dashboard action audit and operator guide.

## Current Environment Blockers

### 1. Windows Python socket stack is broken

Command:

```powershell
python -c "import _overlapped"
```

Result:

```text
OSError: [WinError 10106] The requested service provider could not be loaded or initialized
```

Impact:

- Dagster cannot import because it imports `asyncio`, which imports `_overlapped` on Windows.
- Real-loader Python networking is not trustworthy.
- Pip/curl also fail at socket/DNS level.

Required fix:

- Run the elevated Windows/Python network repair helper.
- Reboot.
- Re-run runtime/preflight checks.

Local helper created:

```text
C:\Users\snahrup\Desktop\FMD_REPAIR_LOCAL_NETWORK_STACK_AS_ADMIN.bat
```

### 2. Real-loader packages are missing from the orchestrator venv

Runtime:

```text
C:\Users\snahrup\CascadeProjects\FMD_ORCHESTRATOR\.venv\Scripts\python.exe
```

Missing:

- `pyodbc`
- `polars`
- `pyarrow`
- `deltalake`
- `azure-identity`
- `azure-storage-file-datalake`
- `msal`

Install command:

```powershell
cd C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK
C:\Users\snahrup\CascadeProjects\FMD_ORCHESTRATOR\.venv\Scripts\python.exe -m pip install -r requirements-real-loader.txt
```

Current install blocker:

```text
getaddrinfo failed
```

This appears tied to the same Windows/network stack issue.

## Smoke Entity

Selected by `scripts/select_smoke_entity.py` and `/api/engine/smoke-entity`:

```json
{
  "entity_id": 599,
  "source": "MES",
  "namespace": "mes",
  "schema": "dbo",
  "table": "alel_lab_batch_hdr_tbl",
  "historical_rows": 5
}
```

## Validation Completed

### Python Compile

Passed:

```powershell
python -m py_compile dashboard/app/api/control_plane_db.py dashboard/app/api/routes/load_mission_control.py dashboard/app/api/routes/engine.py dashboard/app/api/routes/dagster.py engine/api.py engine/dagster_bridge.py engine/orchestrator.py
```

Passed:

```powershell
C:\Users\snahrup\CascadeProjects\FMD_ORCHESTRATOR\.venv\Scripts\python.exe -m py_compile C:\Users\snahrup\CascadeProjects\FMD_ORCHESTRATOR\src\fmd_orchestrator\resources.py
```

Passed:

```powershell
C:\Users\snahrup\CascadeProjects\FMD_ORCHESTRATOR\.venv\Scripts\python.exe -m py_compile C:\Users\snahrup\CascadeProjects\FMD_ORCHESTRATOR\src\fmd_orchestrator\resources.py C:\Users\snahrup\CascadeProjects\FMD_ORCHESTRATOR\src\fmd_orchestrator\cli.py C:\Users\snahrup\CascadeProjects\FMD_ORCHESTRATOR\src\fmd_orchestrator\jobs.py
```

### TypeScript Compile

Passed:

```powershell
cd C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\dashboard\app
npx tsc -b --pretty false
```

### Vite Production Build

Passed:

```powershell
cd C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\dashboard\app
npx vite build
```

Warnings only:

- `TestSwarm.tsx` is both statically and dynamically imported.
- Main bundle is larger than Vite's default 500 kB chunk warning.

### API Handler Smoke

Passed:

- `GET /api/engine/runtime`
- `POST /api/engine/preflight` dry-run mode returns a readable check payload.
- `GET /api/engine/smoke-entity` returns entity `599`.
- `POST /api/engine/start` framework mode without entity IDs returns HTTP 400 and does not create a broad real load.
- `GET /api/dagster/status` returns a readable unavailable status instead of throwing a stack trace when local Dagster is down.
- `GET /api/lmc/progress` returns `runtimeMode`, `isDryRun`, `rowsWritten`, and `filesWritten`.

### Pytest

Blocked by the local Python socket stack before tests can collect:

```powershell
C:\Users\snahrup\CascadeProjects\FMD_ORCHESTRATOR\.venv\Scripts\python.exe -m pytest engine/tests/test_api.py engine/tests/test_lmc_api.py engine/tests/test_logging_db.py -q
```

Result:

```text
OSError: [WinError 10106] The requested service provider could not be loaded or initialized
```

Direct system `python -m pytest ...` is also unavailable because `pytest` is not installed in the global Windows Python environment.

## Not Yet Complete

- Real Landing Zone smoke load is blocked by local Windows socket stack and missing Python packages.
- Bronze/Silver real smoke loads are blocked until Landing Zone smoke succeeds.
- Full route click-through audit still needs browser automation or manual route sweep after the local stack starts cleanly.
- Full-estate load remains intentionally disabled.
