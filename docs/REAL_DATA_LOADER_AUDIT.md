# Real Data Loader Audit

Last updated: 2026-04-25 America/New_York

## Current Verdict

The code path is now explicitly separated between Dagster dry-run orchestration and Dagster framework-mode real loading. The next proof gate is a one-entity real smoke load that produces a receipt proving both database truth and physical Landing/Bronze/Silver artifacts.

The user's normal shell has since repaired `_overlapped` and installed the real-loader package set into the orchestrator venv. This Codex process still inherits the old Windows socket-provider failure, so it should not be used to launch the real source load. Use a fresh PowerShell terminal for the real smoke command below.

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
- Added `scripts/run_real_smoke_load.ps1`.
- Added `scripts/verify_real_smoke_load.py`.
- Added `docs/REAL_LOAD_SMOKE_RUNBOOK.md`.
- Added dashboard action audit and operator guide.
- Added Mission Control `missionTruth` so terminal/dry-run runs cannot display contradictory running/remaining/row KPIs.

## Current Environment Status

### 1. Windows Python socket stack

User-verified fresh shell result:

```powershell
python -c "import _overlapped; print('socket stack ok')"
```

Result:

```text
socket stack ok
```

Codex inherited-process caveat:

```text
OSError: [WinError 10106] The requested service provider could not be loaded or initialized
```

Impact:

- Real smoke loads should be launched from a fresh user PowerShell session, not from this Codex process.
- Browser/server tests from this Codex process remain unreliable until the hosting process is restarted.

### 2. Real-loader packages

Installed into:

```text
C:\Users\snahrup\CascadeProjects\FMD_ORCHESTRATOR\.venv\Scripts\python.exe
```

Installed package set includes:

- `pyodbc`
- `polars`
- `pyarrow`
- `deltalake`
- `azure-identity`
- `azure-storage-file-datalake`
- `msal`

Validation command:

```powershell
cd C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK
C:\Users\snahrup\CascadeProjects\FMD_ORCHESTRATOR\.venv\Scripts\python.exe -m pip install -r requirements-real-loader.txt
```

## Real Smoke Command

Run this from a fresh PowerShell terminal:

```powershell
cd C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK
pwsh .\scripts\run_real_smoke_load.ps1
```

Outputs:

- Worker log: `.runs\real-smoke\<run-id>\worker.log`
- Machine receipt: `.runs\real-smoke\<run-id>\receipt.json`
- UI review URL: `http://127.0.0.1:5288/mission-control?run=<run-id>`

The verifier intentionally fails `dagster://` target paths because those prove orchestration only, not physical lakehouse output.

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

Full pytest remains blocked from this Codex process by the inherited Windows socket-provider failure before tests can collect:

```powershell
C:\Users\snahrup\CascadeProjects\FMD_ORCHESTRATOR\.venv\Scripts\python.exe -m pytest engine/tests/test_api.py engine/tests/test_lmc_api.py engine/tests/test_logging_db.py -q
```

Result:

```text
OSError: [WinError 10106] The requested service provider could not be loaded or initialized
```

Direct system `python -m pytest ...` is also unavailable because `pytest` is not installed in the global Windows Python environment.

### Real Smoke Verifier Unit Tests

Passed:

```powershell
python -m unittest engine.tests.test_real_smoke_verifier -v
```

Coverage:

- Accepts the actual engine behavior where all layer task rows can be logged against the landing entity id.
- Rejects `dagster://` receipt paths as non-physical artifacts.
- Verifies Silver Delta metadata includes SCD Type 2 columns when a local OneLake mount is available.

## Not Yet Complete

- Real Landing Zone smoke load still needs to be run from a fresh user PowerShell terminal.
- Bronze/Silver real smoke loads still need receipt proof from that same run.
- Full route click-through audit still needs browser automation or manual route sweep after the local stack starts cleanly.
- Full-estate load remains intentionally disabled.
