# Runbook: Reprocess and Backfill

1. Identify failed entities (`scripts/fmd_diag.py entity-failures --run-id <runId>`).
2. Verify watermark and idempotency state before rerun.
3. Re-run target copy pipeline for selected entities.
4. Validate no duplicate rows in landing/bronze.
5. Re-enable normal schedules.

## Safety guards
- Never update watermark until copy + downstream validation succeed.
- Keep a rollback snapshot of affected control rows.
