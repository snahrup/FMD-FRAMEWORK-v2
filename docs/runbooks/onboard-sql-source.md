# Runbook: Onboard New SQL Source

1. Confirm prerequisites (`scripts/preflight_fmd.py --strict`).
2. Register source metadata in control tables (`execution.SourceConnection`, `execution.SourceEntity`).
3. Validate contract fields (`EntityId`, `EntityName`, `SourceDataRetrieval`, `ConnectionGuid`).
4. Trigger `PL_FMD_LOAD_LANDINGZONE` with explicit `Data_WorkspaceGuid`.
5. Review audit results via pipeline/copy logs and `scripts/fmd_diag.py run-summary`.
6. Promote to Bronze/Silver using `PL_FMD_LOAD_ALL`.

## Rollback
- Disable source in control metadata.
- Reset watermark for affected entities.
- Re-run for targeted entity only.
