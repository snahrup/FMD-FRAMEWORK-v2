# Real Data Loader Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Dagster-backed FMD dashboard from a dry-run orchestration demo into a real, auditable data loader that extracts source rows, writes Landing Zone Parquet, writes Bronze/Silver Delta outputs, and presents only functioning user actions.

**Architecture:** Dagster owns orchestration state, run graph visibility, retries, and operator control. The existing FMD engine owns source extraction, OneLake writes, Bronze/Silver processing, watermarks, and row/file audit. The dashboard reads from one truth path: `engine_runs`, `engine_task_log`, physical lakehouse scans, and Dagster health/run metadata.

**Tech Stack:** Python engine, Dagster OSS, SQLite control-plane DB, Microsoft Fabric/OneLake, React + TypeScript + Vite dashboard.

---

## Non-Negotiable Definition Of Done

- [ ] A user can start a real scoped load from the dashboard without knowing Dagster internals.
- [ ] A user cannot accidentally mistake a dry run for a real load.
- [ ] A one-table Landing Zone smoke run produces `RowsRead > 0`, `RowsWritten > 0`, and a real Parquet artifact.
- [ ] A one-table Bronze smoke run reads Landing Zone output and produces Delta output.
- [ ] A one-table Silver smoke run reads Bronze output and produces Delta output.
- [ ] Load Mission Control, Load Center, Execution Matrix, Error Intelligence, Execution Log, Engine Control, Control Plane, Live Monitor, Validation, Pipeline Testing, Dagster pages, Data Estate, and Replay pages either work or have non-confusing disabled states with clear reason text.
- [ ] Every visible button either performs a real action, opens a real page, or is removed.
- [ ] The UI shows runtime mode, load method, selected scope, current layer, row/file counters, and failure reason.
- [ ] Dagster event sync cannot overwrite or double-count real FMD engine audit rows.
- [ ] Final audit includes Python compile/tests, TypeScript compile, production build, API smoke checks, UI route sweep, and a real-loader readiness report.

---

## File Ownership Map

### FMD Dashboard Repo: `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK`

- `dashboard/app/api/config.json`: runtime defaults, Dagster mode, load method, paths.
- `dashboard/app/.codex-preview/start-local-stack.ps1`: local developer stack launch; must support dry-run and framework mode explicitly.
- `engine/dagster_bridge.py`: dashboard-to-Dagster launch adapter.
- `engine/api.py`: `/api/engine/*`, run creation, event polling, Dagster event reconciliation.
- `engine/orchestrator.py`: real loader entry point and layer execution.
- `engine/logging_db.py`: authoritative row/file audit writes.
- `engine/preflight.py`: dependency, VPN, OneLake, source connectivity checks.
- `dashboard/app/api/control_plane_db.py`: SQLite schema/migrations and canonical task log mapping.
- `dashboard/app/api/routes/engine.py`: dashboard API wrapper for engine routes.
- `dashboard/app/api/routes/dagster.py`: Dagster health/page metadata.
- `dashboard/app/api/routes/load_mission_control.py`: real-time run status, counters, source/layer matrix.
- `dashboard/app/api/routes/load_center.py`: canonical entity/layer truth.
- `dashboard/app/api/routes/data_estate.py`: estate KPIs.
- `dashboard/app/api/routes/transformation_replay.py`: data replay endpoint.
- `dashboard/app/src/pages/LoadMissionControl.tsx`: operator start/stop/monitor UX.
- `dashboard/app/src/pages/DagsterConsole.tsx`: embedded Dagster pages.
- `dashboard/app/src/pages/TransformationReplay.tsx`: replay/explainability UX.
- `dashboard/app/src/pages/DataEstate.tsx`: estate KPIs and route errors.
- `dashboard/app/src/components/layout/AppLayout.tsx`: navigation and route grouping.
- `dashboard/app/src/App.tsx`: route registry.

### FMD Orchestrator Repo: `C:\Users\snahrup\CascadeProjects\FMD_ORCHESTRATOR`

- `src/fmd_orchestrator/resources.py`: Dagster resource that delegates to dry-run or framework mode.
- `src/fmd_orchestrator/cli.py`: local launch/smoke commands.
- `src/fmd_orchestrator/jobs.py`: Dagster job/op wiring.
- `workspace_grpc.yaml`: Dagster UI code location.
- `.runs/*.jsonl`: per-run event bridge files.

---

## Phase 1: Runtime Mode And Safety Groundwork

### Task 1.1: Add explicit runtime-mode config API

**Files:**
- Modify: `dashboard/app/api/routes/engine.py`
- Modify: `engine/api.py`
- Test: `engine/tests/test_api.py`

- [ ] Add `GET /api/engine/runtime` that returns:

```json
{
  "orchestrator": "dagster",
  "dagsterRuntimeMode": "dry_run",
  "loadMethod": "local",
  "frameworkPath": "C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK",
  "dagsterUrl": "http://127.0.0.1:3006",
  "realLoadEnabled": false,
  "dryRun": true,
  "warnings": [
    "Dry-run mode validates orchestration only. It does not extract source rows or write lakehouse data."
  ]
}
```

- [ ] Add a test that sets `dagster.runtime_mode = "dry_run"` and asserts `realLoadEnabled` is `false`.
- [ ] Add a test that sets `dagster.runtime_mode = "framework"` and asserts `realLoadEnabled` is `true`.
- [ ] Ensure runtime endpoint never exposes secrets.

### Task 1.2: Add real-load preflight endpoint

**Files:**
- Modify: `engine/api.py`
- Modify: `dashboard/app/api/routes/engine.py`
- Test: `engine/tests/test_api.py`

- [ ] Add `POST /api/engine/preflight` with body:

```json
{
  "entity_ids": [123],
  "layers": ["landing"],
  "runtime_mode": "framework"
}
```

- [ ] Return grouped checks:

```json
{
  "ok": false,
  "checks": [
    {"id": "runtime_mode", "label": "Dagster runtime mode", "status": "failed", "message": "Configured mode is dry_run."},
    {"id": "python_deps", "label": "Python dependencies", "status": "passed", "message": "pyodbc, polars, pyarrow, deltalake are importable."},
    {"id": "vpn", "label": "VPN/source reachability", "status": "warning", "message": "VPN could not be verified locally."},
    {"id": "onelake", "label": "OneLake target", "status": "failed", "message": "ONELAKE_MOUNT_PATH is not set and ADLS credentials were not verified."}
  ]
}
```

- [ ] Do not perform a load in preflight.
- [ ] If entity IDs are supplied, validate they exist and are active.

### Task 1.3: Make local stack mode selectable

**Files:**
- Modify: `dashboard/app/.codex-preview/start-local-stack.ps1`

- [ ] Add a parameter:

```powershell
param(
    [ValidateSet("dry_run", "framework")]
    [string]$RuntimeMode = "dry_run"
)
```

- [ ] Pass `$RuntimeMode` into both Dagster code-server and webserver environment as `FMD_ORCHESTRATOR_MODE`.
- [ ] Print the selected mode at startup.
- [ ] Keep default as `dry_run` until smoke tests prove framework mode.

---

## Phase 2: Real Dagster-To-Framework Execution

### Task 2.1: Preserve real framework result details in Dagster events

**Files:**
- Modify: `C:\Users\snahrup\CascadeProjects\FMD_ORCHESTRATOR\src\fmd_orchestrator\resources.py`
- Test: `C:\Users\snahrup\CascadeProjects\FMD_ORCHESTRATOR\tests\test_resources.py`

- [ ] Expand normalized framework results to include fields from `RunResult`:

```python
{
    "entity_id": getattr(item, "entity_id", None),
    "layer": getattr(item, "layer", layer),
    "status": getattr(item, "status", "unknown"),
    "rows_read": getattr(item, "rows_read", 0),
    "rows_written": getattr(item, "rows_written", 0),
    "bytes_transferred": getattr(item, "bytes_transferred", 0),
    "duration_seconds": getattr(item, "duration_seconds", 0),
    "target_path": getattr(item, "target_path", ""),
    "load_type": getattr(item, "load_type", "framework"),
    "error": getattr(item, "error", None),
}
```

- [ ] Add layer summary in event details:

```python
"summary": {
    "succeeded": succeeded,
    "failed": failed,
    "skipped": skipped,
    "rows_read": rows_read,
    "rows_written": rows_written,
    "bytes_transferred": bytes_transferred,
}
```

- [ ] Keep dry-run events unchanged except add `summary.rows_read = 0` and `summary.rows_written = 0`.

### Task 2.2: Stop synthetic Dagster rows from masking real framework rows

**Files:**
- Modify: `engine/api.py`
- Test: `engine/tests/test_api.py`

- [ ] In `_sync_dagster_event_to_task_log`, branch on `mode`.
- [ ] If `mode == "dry_run"`, continue inserting synthetic task rows with `RowsRead = 0`, `RowsWritten = 0`, and `LoadType = "dry_run"`.
- [ ] If `mode == "framework"`, do not insert synthetic rows when real task rows already exist for `RunId + EntityId + Layer`.
- [ ] If framework events contain detailed results and the real engine did not write a row, insert a fallback row using event details and `LoadType = "framework_event_fallback"`.
- [ ] Update `engine_runs.TotalRowsRead`, `TotalRowsWritten`, and `TotalBytesTransferred` from actual `engine_task_log` aggregates, not event entity counts.

### Task 2.3: Make framework-mode launch fail fast when unsafe

**Files:**
- Modify: `engine/dagster_bridge.py`
- Modify: `engine/api.py`
- Test: `engine/tests/test_api.py`

- [ ] Before launching framework mode, require at least one explicit entity ID unless body includes:

```json
{"confirm_full_estate_real_load": true}
```

- [ ] If no explicit entity IDs and no confirmation, return HTTP 400:

```json
{
  "error": "Real framework mode requires explicit entity_ids or confirm_full_estate_real_load=true."
}
```

- [ ] Keep dry-run mode allowed for broad scopes.

---

## Phase 3: Dashboard Load UX

### Task 3.1: Replace ambiguous bulk snapshot default with explicit run type

**Files:**
- Modify: `dashboard/app/src/pages/LoadMissionControl.tsx`

- [ ] Replace the current “Bulk Snapshot Mode” toggle with a required run-type selector:

```ts
type RunIntent = "orchestration_check" | "real_smoke_load" | "real_scoped_load" | "full_estate_load";
```

- [ ] Labels:
- `Orchestration Check`: dry run; no data movement.
- `Real Smoke Load`: one entity; real data movement.
- `Real Scoped Load`: selected entities/sources; real data movement.
- `Full Estate Load`: all active entities; requires typed confirmation.

- [ ] Disable `Start Pipeline` until the required preflight passes for real run types.

### Task 3.2: Surface runtime mode in the header and modal

**Files:**
- Modify: `dashboard/app/src/pages/LoadMissionControl.tsx`

- [ ] Fetch `/api/engine/runtime`.
- [ ] Header shows `Dagster dry-run` or `Dagster framework mode`.
- [ ] Modal shows:

```text
Dry run: validates Dagster graph only.
Real load: extracts source rows and writes lakehouse data.
```

- [ ] When dry-run mode is active, all real-load run types are disabled with reason text.

### Task 3.3: Make run counters unambiguous

**Files:**
- Modify: `dashboard/app/src/pages/LoadMissionControl.tsx`
- Modify: `dashboard/app/api/routes/load_mission_control.py`

- [ ] API returns `runtimeMode`, `isDryRun`, `rowsWritten`, `filesWritten`, `loadTypeBreakdown`.
- [ ] UI labels:
- Dry run: `Checks Passed`, `Checks Failed`, `Rows Written: 0 expected`.
- Real run: `Tables Loaded`, `Tables Failed`, `Rows Written`, `Files Written`.
- [ ] Display a visible warning when latest run is dry-run.

---

## Phase 4: Remove Or Fix Confusing Features

### Task 4.1: Audit every dashboard route and button

**Files:**
- Review: `dashboard/app/src/App.tsx`
- Review: `dashboard/app/src/components/layout/AppLayout.tsx`
- Review: `dashboard/app/src/pages/*.tsx`

- [ ] Build a route/button matrix with columns:
- Route
- Primary action buttons
- API endpoint used
- Works in dry-run
- Works in framework mode
- Action required: keep, rename, disable, remove

- [ ] Save the matrix to `docs/DASHBOARD_ACTION_AUDIT.md`.

### Task 4.2: Remove dead or misleading buttons

**Files:**
- Modify: pages identified by Task 4.1

- [ ] Remove buttons that call no endpoint.
- [ ] Rename buttons that still work but are misleading.
- [ ] Disable buttons that require framework mode or VPN with clear reason text.
- [ ] Any disabled button must include visible adjacent reason text, not just a disabled cursor.

### Task 4.3: Dagster embedded pages must fit inside FMD

**Files:**
- Modify: `dashboard/app/src/pages/DagsterConsole.tsx`
- Modify: `dashboard/app/src/components/layout/AppLayout.tsx`
- Modify: `dashboard/app/api/routes/dagster.py`

- [ ] FMD left nav includes Dagster-equivalent entries:
- Overview
- Runs
- Catalog
- Jobs
- Automation
- Lineage
- Deployment
- [ ] Embedded iframe content fits in available width/height.
- [ ] If Dagster refuses iframe or content is visually clipped, show a clean fallback card with `Open Dagster` and the exact reason.

---

## Phase 5: Real Data Smoke Ladder

### Task 5.1: Select a safe smoke entity

**Files:**
- Create: `scripts/select_smoke_entity.py`

- [ ] Query active entities ordered by smallest known or estimated row count.
- [ ] Exclude known monster tables.
- [ ] Print:

```json
{
  "entity_id": 123,
  "source": "ETQ",
  "schema": "dbo",
  "table": "SomeSmallTable",
  "reason": "Active entity with no recent failures and small historical row count."
}
```

### Task 5.2: Landing Zone smoke run

**Command:**

```powershell
cd C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK
python -m engine.worker --run-id smoke-landing-001 --layers landing --entity-ids 123 --triggered-by smoke-test
```

- [ ] Expected: `engine_runs.Status = Succeeded`.
- [ ] Expected: matching `engine_task_log` row has `RowsRead > 0` and `RowsWritten > 0`.
- [ ] Expected: target path exists in OneLake or ADLS.

### Task 5.3: Bronze smoke run

**Command:**

```powershell
cd C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK
python -m engine.worker --run-id smoke-bronze-001 --layers bronze --entity-ids 123 --triggered-by smoke-test
```

- [ ] Expected: Bronze processor writes Delta output.
- [ ] Expected: `engine_task_log.Layer = bronze` has `RowsWritten > 0`.

### Task 5.4: Silver smoke run

**Command:**

```powershell
cd C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK
python -m engine.worker --run-id smoke-silver-001 --layers silver --entity-ids 123 --triggered-by smoke-test
```

- [ ] Expected: Silver processor writes Delta output.
- [ ] Expected: SCD columns are present where applicable.
- [ ] Expected: `engine_task_log.Layer = silver` has `RowsWritten >= 0` and no silent failure.

### Task 5.5: Dagster framework smoke run

**Command:**

```powershell
cd C:\Users\snahrup\CascadeProjects\FMD_ORCHESTRATOR
.\.venv\Scripts\python.exe -m fmd_orchestrator.cli launch `
  --mode framework `
  --framework-path C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK `
  --run-id smoke-dagster-framework-001 `
  --layers landing `
  --entity-ids 123 `
  --triggered-by smoke-test
```

- [ ] Expected: Dagster run succeeds.
- [ ] Expected: event log exists.
- [ ] Expected: FMD dashboard shows real rows/files, not dry-run checks.

---

## Phase 6: Route And Feature Verification

### Task 6.1: Backend smoke checks

**Commands:**

```powershell
cd C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK
python -m py_compile dashboard/app/api/control_plane_db.py dashboard/app/api/routes/load_mission_control.py dashboard/app/api/routes/engine.py dashboard/app/api/routes/dagster.py engine/api.py engine/dagster_bridge.py engine/orchestrator.py
```

```powershell
cd C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK
pytest engine/tests/test_api.py engine/tests/test_lmc_api.py engine/tests/test_logging_db.py -q
```

- [ ] Expected: compile passes.
- [ ] Expected: tests pass or failures are documented with exact root cause.

### Task 6.2: Frontend compile/build

**Commands:**

```powershell
cd C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\dashboard\app
npx tsc -b --pretty false
npx vite build
```

- [ ] Expected: TypeScript passes.
- [ ] Expected: Vite production build passes.

### Task 6.3: API route sweep

**Endpoints:**

- `/api/engine/runtime`
- `/api/engine/preflight`
- `/api/engine/status`
- `/api/engine/runs`
- `/api/lmc/progress`
- `/api/lmc/runs`
- `/api/load-center/entities`
- `/api/dagster/status`
- `/api/data-estate/summary`
- `/api/transformation-replay/runs`

- [ ] Each endpoint returns 200 or an intentional, user-readable 4xx.
- [ ] No route returns Python stack traces to the UI.

### Task 6.4: UI route sweep

**Routes:**

- `/overview`
- `/story`
- `/data-estate`
- `/load-center`
- `/sources`
- `/mission-control`
- `/execution-matrix`
- `/errors`
- `/execution-log`
- `/engine`
- `/control-plane`
- `/live`
- `/validation`
- `/pipeline-testing`
- `/dagster`
- `/dagster/runs`
- `/dagster/jobs`
- `/dagster/catalog`
- `/replay`

- [ ] Each route renders without a 500.
- [ ] Each primary CTA either works, is disabled with reason text, or is removed.
- [ ] No page claims data was loaded when latest run is dry-run.

---

## Phase 7: Final Audit And Release Notes

### Task 7.1: Create final audit report

**Files:**
- Create: `docs/REAL_DATA_LOADER_AUDIT.md`

- [ ] Include:
- Runtime mode status.
- What was tested.
- Exact run IDs.
- Row/file counts.
- Known limitations.
- Buttons removed/renamed/disabled.
- Remaining production hardening items.

### Task 7.2: Create operator guide

**Files:**
- Create: `docs/REAL_DATA_LOADER_OPERATOR_GUIDE.md`

- [ ] Include:
- How to start dry-run orchestration check.
- How to start real smoke load.
- How to read Load Mission Control.
- How to open Dagster run details.
- How to triage failures.
- How to stop/resume/retry safely.

### Task 7.3: Final verification gate

**Commands:**

```powershell
cd C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK
git status --short
```

```powershell
cd C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\dashboard\app
npx tsc -b --pretty false
npx vite build
```

```powershell
cd C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK
python -m py_compile dashboard/app/api/control_plane_db.py dashboard/app/api/routes/load_mission_control.py dashboard/app/api/routes/engine.py dashboard/app/api/routes/dagster.py engine/api.py engine/dagster_bridge.py engine/orchestrator.py
```

- [ ] Do not call the work complete until these pass or the exact blocker is written in `docs/REAL_DATA_LOADER_AUDIT.md`.

---

## Execution Order

1. Implement Phase 1 endpoints and UI runtime awareness.
2. Implement Phase 2 framework event reconciliation.
3. Implement Phase 3 Load Mission Control run intent UX.
4. Run local dry-run regression to ensure the demo path still works.
5. Run preflight for framework mode.
6. Fix environment/dependency blockers found by preflight.
7. Run real engine smoke outside Dagster.
8. Run real Dagster framework smoke.
9. Audit every route/button.
10. Remove/disable confusing UI actions.
11. Run final verification and write audit/operator docs.

