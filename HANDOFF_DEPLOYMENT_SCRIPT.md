# Handoff: Full From-Scratch Deployment Script

## Mission
Build `deploy_from_scratch.py` — a single Python script that replicates EVERYTHING the notebook `setup/NB_SETUP_FMD.ipynb` does, so we can deploy a complete FMD Framework from zero on a new Fabric capacity without ever opening the notebook.

## Context
- The notebook (`NB_SETUP_FMD.ipynb`) is the current "source of truth" for greenfield deployment
- We have partial automation (`finalize_deployment.py`, `deploy_pipelines.py`, `fix_prod_guids.py`) but they only handle POST-deployment tasks
- The gap: workspace creation, lakehouse creation, SQL DB creation, connection creation, notebook deployment, pipeline shell creation, environment/variable library deployment

## What the Notebook Does (14 steps, in order)

| # | Step | Fabric API | Automated? |
|---|------|-----------|------------|
| 1 | Download GitHub sources | GitHub API zipball | NO |
| 2 | Load config files (item_config.yaml etc.) | Local file read | NO |
| 3 | Authenticate | `notebookutils.credentials.getToken('pbi')` | YES (SP OAuth in existing scripts) |
| 4 | Create domain (optional, skipped) | Fabric API | SKIP |
| 5 | Create 4x connections | `POST /v1/connections` | NO — SQL+Pipelines work via API; ADF+Notebooks must be manual |
| 6 | Create DEV workspaces (Code+Data) | `POST /v1/workspaces` | NO |
| 7 | Create PROD workspaces (Code+Data) | `POST /v1/workspaces` | NO |
| 8 | Create CONFIG workspace | `POST /v1/workspaces` | NO |
| 9 | Create 6x lakehouses | `POST /v1/workspaces/{ws}/items` (type=Lakehouse) | NO |
| 10 | Create SQL database | `POST /v1/workspaces/{ws}/items` (type=SQLDatabase) | NO |
| 11 | Deploy environments, notebooks, variable library | `POST /v1/workspaces/{ws}/items` + `updateDefinition` | PARTIAL (notebook upload exists) |
| 12 | Deploy 44 pipeline shells | `POST /v1/workspaces/{ws}/items` (type=DataPipeline) | NO (only definition UPDATE exists) |
| 13 | Workspace icons | Internal PBI metadata API | EXISTS but broken (403 with SP) |
| 14 | SQL metadata population | pyodbc + stored procs | EXISTS (`finalize_deployment.py`) |

## Files to Reference

### Notebook (the source of truth)
- `setup/NB_SETUP_FMD.ipynb` — full deployment flow
- `src/NB_UTILITIES_SETUP_FMD.Notebook/notebook-content.py` — helper functions: `create_or_get_fmd_connection()`, `deploy_workspaces()`, `deploy_item()`, `set_workspace_icon()`, `invoke_fabric_request()`

### Existing automation (reuse what works)
- `finalize_deployment.py` — SQL metadata + config file updates (lines 85-340)
- `scripts/deploy_pipelines.py` — pipeline definition deployment with ID replacement
- `fix_prod_guids.py` — PROD GUID replacement mapping

### Config files the script must read
- `config/item_config.yaml` — workspace GUIDs, connection GUIDs, DB info
- `config/item_deployment.json` — item definitions (pipeline names, types)
- `config/data_deployment.json` — data item definitions (lakehouses)
- `config/lakehouse_deployment.json` — lakehouse config
- `src/*/pipeline-content.json` — pipeline source JSONs (22 pipelines)

### Auth credentials
- Tenant: `ca81e9fd-06dd-49cf-b5a9-ee7441ff5303`
- Client ID: `ac937c5d-4bdd-438f-be8b-84a850021d2d`
- Client secret: in `dashboard/app/api/.env` as `FABRIC_CLIENT_SECRET`
- Token endpoint: `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`
- Scope: `https://api.fabric.microsoft.com/.default`

## Architecture of the New Script

```python
# deploy_from_scratch.py
#
# Usage: python deploy_from_scratch.py [--env dev|prod|all] [--skip-existing] [--dry-run]
#
# Phases:
#   Phase 1: Auth + Config Loading
#   Phase 2: Create Workspaces (5x: DATA D, CODE D, DATA P, CODE P, CONFIG)
#   Phase 3: Create Connections (SQL + Pipelines via API; warn about manual ADF/Notebooks)
#   Phase 4: Create Lakehouses (3x per DATA workspace = 6 total)
#   Phase 5: Create SQL Database (1x in CONFIG workspace)
#   Phase 6: Deploy Notebooks (upload .ipynb via API)
#   Phase 7: Deploy Variable Library / Environment
#   Phase 8: Create Pipeline Shells (22x per CODE workspace)
#   Phase 9: Update Pipeline Definitions (ID replacement — reuse deploy_pipelines.py logic)
#   Phase 10: Populate SQL Metadata (reuse finalize_deployment.py logic)
#   Phase 11: Update Local Config Files
#   Phase 12: Workspace Icons (attempt, graceful fail)
```

## Key Fabric API Patterns

### Create workspace
```
POST https://api.fabric.microsoft.com/v1/workspaces
{"displayName": "INTEGRATION DATA (D)", "capacityId": "<capacity_guid>"}
```

### Create item (lakehouse, pipeline, notebook, etc.)
```
POST https://api.fabric.microsoft.com/v1/workspaces/{ws_id}/items
{"displayName": "LH_DATA_LANDINGZONE", "type": "Lakehouse"}
```

### Update item definition (for pipelines, notebooks with content)
```
POST https://api.fabric.microsoft.com/v1/workspaces/{ws_id}/items/{item_id}/updateDefinition
{"definition": {"parts": [{"path": "pipeline-content.json", "payload": "<base64>", "payloadType": "InlineBase64"}]}}
```

### Create connection (SQL type)
```
POST https://api.fabric.microsoft.com/v1/connections
{
  "displayName": "CON_FMD_FABRIC_SQL",
  "connectionDetails": {"type": "SQL", "parameters": [...]},
  "credentialDetails": {"credentialType": "ServicePrincipal", ...}
}
```

## Important Notes

1. **Idempotent**: Each step should check if the resource already exists before creating. The notebook's `create_or_get_fmd_connection()` pattern is the model — create if missing, return existing if found.

2. **Mapping table**: The notebook builds an in-memory `mapping_table` of old_id→new_id as items are created. The script needs this too, for pipeline definition ID replacement.

3. **Capacity IDs**: The script needs Fabric capacity GUIDs for workspace assignment. These are different per environment (dev vs prod). Check the notebook's config block for the pattern.

4. **ADF + Notebooks connections**: These CANNOT be created via REST API (Fabric limitation). The script should warn the user to create them manually and pause for GUID input.

5. **Pipeline definition deployment**: Reuse the `TEMPLATE_TO_REAL` ID replacement logic from `scripts/deploy_pipelines.py`. Template GUIDs in the source JSONs must be replaced with real GUIDs per workspace.

6. **SQL Database creation returns endpoint**: After creating the SQL DB, the API returns the server FQDN. Capture this for config file updates.

7. **No yaml dependency**: Previous session hit a pip install issue. Use `json` or manual string writing for config files, not PyYAML.

## Current Workspace GUIDs (for reference / testing)

### Development
- INTEGRATION DATA (D): `a3a180ff-fbc2-48fd-a65f-27ae7bb6709a`
- INTEGRATION CODE (D): `146fe38c-f6c3-4e9d-a18c-5c01cad5941e`
- INTEGRATION CONFIG: `f442f66c-eac6-46d7-80c9-c8b025c86fbe`

### Production
- INTEGRATION DATA (P): `4c4b6bf5-8728-4aac-a132-b008a11b96d7`
- INTEGRATION CODE (P): `1284458c-1976-46a6-b9d8-af17c7d11a59`

### Connections
- CON_FMD_FABRIC_SQL: `0f86f6a1-9f84-44d1-b977-105b5179c678`
- CON_FMD_FABRIC_PIPELINES: `6b2e33a1-b441-4137-b41d-260ffa8258cf`
- CON_FMD_FABRIC_NOTEBOOKS: `f4d3220c-0cd3-4f76-9641-b4154e192645`
- CON_FMD_ADF_PIPELINES: `00000000-0000-0000-0000-000000000000` (placeholder)

### SQL Database
- ID: `501d6b17-fcee-47f3-bbb3-54e05f2a3fc0`
- Endpoint: `7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433`
