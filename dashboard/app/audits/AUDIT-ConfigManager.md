# AUDIT: ConfigManager.tsx

**Page**: `dashboard/app/src/pages/ConfigManager.tsx`
**Backend**: `dashboard/app/api/routes/config_manager.py`
**Audited**: 2026-03-13

---

## Summary

ConfigManager is a comprehensive configuration management page that aggregates data from SQLite tables, YAML files, pipeline JSON configs, variable libraries, and dashboard config.json. It calls three backend endpoints and two Fabric live-API endpoints. The SQLite queries are all correct. There is one significant bug: the Fabric API deploy endpoint returns a 404.

**Verdict**: PASS with 1 backend issue (non-SQLite)

---

## API Calls Traced

### 1. `GET /api/config-manager`

**Frontend** (line 615): `fetchJson<ConfigData>("/config-manager")`

**Backend** (`config_manager.py` line 77): `get_config_manager()`

| Data Source | SQL / Query | Correct Table? | Correct Columns? |
|---|---|---|---|
| Workspaces | `SELECT WorkspaceId, WorkspaceGuid, Name FROM workspaces ORDER BY WorkspaceId` | YES (`workspaces`) | YES |
| Lakehouses | `SELECT LakehouseId, LakehouseGuid, WorkspaceGuid, Name FROM lakehouses ORDER BY LakehouseId` | YES (`lakehouses`) | YES |
| Connections | `SELECT ConnectionId, ConnectionGuid, Name, Type, IsActive FROM connections ORDER BY ConnectionId` | YES (`connections`) | YES |
| Datasources | `SELECT DataSourceId, ConnectionId, Name, Namespace, Type, Description, IsActive FROM datasources ORDER BY DataSourceId` | YES (`datasources`) | YES |
| Pipelines | `SELECT PipelineId, Name, IsActive FROM pipelines ORDER BY PipelineId` | YES (`pipelines`) | YES |
| item_config.yaml | File read from `config/item_config.yaml` | N/A (file) | N/A |
| Pipeline JSON | Glob `src/*.DataPipeline/pipeline-content.json` | N/A (file) | N/A |
| Variable Library | `src/VAR_CONFIG_FMD.VariableLibrary/variables.json` + `valueSets/*.json` | N/A (file) | N/A |
| Dashboard config | `dashboard/app/api/config.json` | N/A (file) | N/A |
| Mismatches | Cross-referencing YAML workspace GUIDs vs pipeline defaults and DB records | Correct logic | Correct |

**GUID Reference Finder (line 646)**: `fetchJson<...>("/config-manager/references?guid=...")`

**Backend** (`config_manager.py` line 345): `get_config_references()`

- Searches `workspaces.WorkspaceGuid` -- CORRECT
- Searches `lakehouses.LakehouseGuid` and `lakehouses.WorkspaceGuid` -- CORRECT
- Searches `connections.ConnectionGuid` -- CORRECT
- Scans pipeline JSON files for GUID occurrences -- CORRECT

### 2. `POST /api/config-manager/update`

**Frontend** (line 628): `postJson<...>("/config-manager/update", body)`

**Backend** (`config_manager.py` line 202): `post_config_update()`

All UPDATE statements use parameterized queries (`?` placeholders) -- CORRECT.

Supported targets:
| Target | SQL | Correct? |
|---|---|---|
| `workspace` | `UPDATE workspaces SET WorkspaceGuid/Name = ? WHERE WorkspaceId = ?` | YES |
| `lakehouse` | `UPDATE lakehouses SET LakehouseGuid/WorkspaceGuid/Name = ? WHERE LakehouseId = ?` | YES |
| `connection` | `UPDATE connections SET ConnectionGuid/Type/Name = ? WHERE ConnectionId = ?` | YES |
| `datasource` | `UPDATE datasources SET Name/Namespace/Type/ConnectionId/IsActive = ? WHERE DataSourceId = ?` | YES |
| `pipeline_db` | `UPDATE pipelines SET PipelineId/Name/IsActive = ? WHERE PipelineId = ?` | YES |
| `pipeline_param` | File write to `pipeline-content.json` | N/A |
| `pipeline_guid_replace` | Regex replace in `pipeline-content.json` files | N/A |
| `dashboard_config` | File write to `config.json` | N/A |

### 3. `POST /api/deploy-pipelines`

**Frontend** (line 882): `postJson<DeployResult>("/deploy-pipelines", {})`

**Backend** (`pipeline.py` line 422): `post_deploy_pipelines()`

This deploys pipeline JSON to Fabric via REST API. Not a SQLite data source issue -- uses Fabric API credentials from `config.json`.

---

## Bugs Found

### BUG-CM-1: `pipeline_db` target updates PipelineId instead of PipelineGuid (MINOR)

**File**: `config_manager.py` line 274
**Code**: `db.execute("UPDATE pipelines SET PipelineId = ? WHERE PipelineId = ?", (params["newGuid"].strip(), p_id))`

The `newGuid` parameter is written to `PipelineId` (an INTEGER column) rather than `PipelineGuid` (a TEXT column). The pipelines table has both `PipelineId INTEGER PRIMARY KEY` and `PipelineGuid TEXT`. Updating PipelineId with a GUID string will change the primary key and could break FK references.

**Severity**: Medium -- incorrect column target, but the UI may not exercise this path frequently.

---

## Verdict

- All 5 SQLite SELECT queries use correct table names and column names
- All 7 UPDATE targets use parameterized queries (security: PASS)
- GUID reference finder correctly searches all relevant tables
- Mismatch detection logic correctly cross-references YAML vs DB vs pipeline JSON
- 1 bug: `pipeline_db` update target writes to wrong column (`PipelineId` vs `PipelineGuid`)
