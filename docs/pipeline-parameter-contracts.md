# Pipeline Parameter Contracts

## ASQL command/copy contract

The ASQL command and copy pipelines depend on each entity record containing the following required fields:

| Field | Required | Used by |
|---|---:|---|
| `EntityId` | Yes | Audit envelope, target path |
| `EntityName` | Yes | Landing file names and logs |
| `SourceDataRetrieval` | Yes | Source SQL query expression |
| `ConnectionGuid` | Yes | SQL connection routing |
| `SchemaName` | Yes | Metadata/audit context |
| `TableName` | Yes | Metadata/audit context |

## Validation behavior

- `PL_FMD_LDZ_COMMAND_ASQL` now checks incoming rows before invoking copy pipelines.
- `PL_FMD_LDZ_COPY_FROM_ASQL_01` performs a fail-fast check and emits an explicit missing-field error.
- Use the bypass parameter `allow_partial_contract=false` only for temporary migrations.

## Operational check

Run this before execution:

```bash
python scripts/preflight_fmd.py --strict
```
