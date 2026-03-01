# Runbook: Troubleshoot Fabric Pipeline Failures

## Decision tree

1. **Auth failure**: run `scripts/fmd_diag.py connections`; validate env vars.
2. **Metadata/contract failure**: check explicit Fail activity message for missing field.
3. **Copy timeout/failure**: inspect retry policy violations with `scripts/lint_pipelines.py --strict`.
4. **Notebook failure**: validate bronze/silver notebook logs and run ID correlation.
5. **Workspace mismatch**: ensure `Data_WorkspaceGuid` was provided explicitly.

## Useful commands

```bash
python scripts/fmd_diag.py preflight
python scripts/fmd_diag.py run-summary --run-id <runId>
python scripts/fmd_diag.py entity-failures --run-id <runId>
```
