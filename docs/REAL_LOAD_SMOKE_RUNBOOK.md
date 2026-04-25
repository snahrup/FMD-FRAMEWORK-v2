# Real Load Smoke Runbook

Use this before claiming the loader is moving real data. The goal is one
small entity through Landing, Bronze, and Silver with a machine-readable
receipt that proves database state and physical OneLake artifacts agree.

## Run

```powershell
cd C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK
pwsh .\scripts\run_real_smoke_load.ps1
```

The runner selects the safest active smoke entity unless you pin one:

```powershell
pwsh .\scripts\run_real_smoke_load.ps1 -EntityId 599
```

If the dashboard API is running and you want API preflight to be mandatory:

```powershell
pwsh .\scripts\run_real_smoke_load.ps1 -RequireApiPreflight
```

## What Counts As Passing

- `engine_runs.Status` is terminal and `Succeeded`.
- `engine_task_log` has succeeded rows for the selected entity in Landing,
  Bronze, and Silver.
- Landing has non-zero `RowsRead`, `RowsWritten`, and `BytesTransferred`.
- Bronze has non-zero `RowsRead` and `RowsWritten`.
- Silver has non-zero `RowsRead`; zero writes are only a warning on repeat SCD
  runs because no changes may be detected.
- Landing target Parquet exists on the OneLake mount.
- Bronze and Silver target Delta folders exist and contain `_delta_log`.
- Silver Delta metadata includes the SCD Type 2 columns.

## Output

Receipts are written under:

```text
.runs\real-smoke\<run-id>\receipt.json
```

The receipt includes the run id, entity id, Mission Control URL, audited target
paths, resolved local paths, row counts, byte counts, and every pass/fail check.

## Important Guardrail

If `ONELAKE_MOUNT_PATH` is not configured, the verifier cannot physically inspect
local OneLake artifacts. By default that is treated as a failure because DB-only
success is not proof of real data movement. Use `-AllowUnverifiedArtifacts` only
when the run intentionally uses remote ADLS paths and a separate remote artifact
check has been completed.
