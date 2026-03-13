# AUDIT: NotebookConfig.tsx

**Date**: 2026-03-13
**Frontend**: `dashboard/app/src/pages/NotebookConfig.tsx`
**Backend handler**: `dashboard/app/api/routes/config_manager.py` (for config read/write), `server.py.bak` only (for notebook trigger/job-status)
**Endpoints consumed**:
- `GET /api/notebook-config` -- MIGRATED (config_manager.py line 425)
- `POST /api/notebook-config/update` -- MIGRATED (config_manager.py line 456)
- `POST /api/notebook/trigger` -- MISSING (was in server.py.bak line 9113)
- `GET /api/notebook/job-status?workspaceId=<ws>&notebookId=<nb>` -- MISSING (was in server.py.bak line 8722)

---

## Purpose

NotebookConfig (labeled "Setup Notebook Configuration" in the UI) is an editor for all values that the `NB_UTILITIES_SETUP_FMD` Fabric notebook reads. It displays:
1. **item_config.yaml** -- workspace GUIDs, connection GUIDs, SQL database identifiers
2. **VAR_CONFIG_FMD** variable library -- SQL endpoint, database name, workspace/database GUIDs
3. **VAR_FMD** variable library -- Key Vault URI, tenant ID, client ID, client secret name
4. **Template-to-Real ID mapping** -- pipeline GUID replacements per workspace
5. **One-click deploy** -- triggers the NB_UTILITIES_SETUP_FMD notebook remotely via Fabric Jobs API

## Data Flow

1. **On mount**: Fetches `GET /api/notebook-config` to load all config from repo files.
2. **On value edit**: POSTs to `POST /api/notebook-config/update` with `{target, section, key, newValue}` or `{target, variableName, newValue}`.
3. **On deploy**: POSTs to `POST /api/notebook/trigger` to trigger setup notebook, then polls `GET /api/notebook/job-status?workspaceId=<ws>&notebookId=<nb>` every 5 seconds.

## API Call Trace

| Frontend Call | Backend Route | Data Source | Status |
|---|---|---|---|
| `GET /api/notebook-config` | `config_manager.py:get_notebook_config()` | Reads `config/item_config.yaml` + `src/VAR_CONFIG_FMD.VariableLibrary/variables.json` + `src/VAR_FMD.VariableLibrary/variables.json` | OK |
| `POST /api/notebook-config/update` | `config_manager.py:post_notebook_config_update()` | Writes to `config/item_config.yaml` or variable library JSON files | OK |
| `POST /api/notebook/trigger` | `server.py.bak:trigger_setup_notebook()` | Fabric REST API: triggers NB_UTILITIES_SETUP_FMD | MISSING |
| `GET /api/notebook/job-status` | `server.py.bak:get_notebook_job_status()` | Fabric REST API: `GET /v1/workspaces/{ws}/items/{nb}/jobs/instances` | MISSING |

## Data Source Correctness Analysis

### GET /api/notebook-config (MIGRATED -- CORRECT)

The route reads from three file-system sources:

1. **item_config.yaml**: Minimal custom YAML parser reads workspace GUIDs, connection GUIDs, database identifiers. Returns as `itemConfig` with sub-keys `workspaces`, `connections`, `database`. Frontend correctly maps these to EditableValue components.

2. **VAR_CONFIG_FMD.VariableLibrary/variables.json**: Standard Fabric Variable Library JSON. Returns `variables[]` array with `{name, value, type, note}` per entry. Frontend iterates `varConfigFmd.variables` -- correct.

3. **VAR_FMD.VariableLibrary/variables.json**: Same format. Frontend iterates `varFmd.variables` -- correct.

4. **templateMapping**: Currently hardcoded to `{}` in the migrated route (line 451). The old server.py.bak built this from actual pipeline JSON analysis. Frontend handles empty mapping gracefully (shows empty section).

5. **missingConnections**: Currently hardcoded to `[]` (line 452). The old server.py.bak detected deactivated connections. Frontend handles empty array correctly.

**Finding**: The `templateMapping` and `missingConnections` are stub values in the migrated route. This is a **data loss** compared to the old implementation -- the Template ID Mapping section and missing connections warning will always be empty.

### POST /api/notebook-config/update (MIGRATED -- CORRECT)

Handles three targets:
- `item_config`: Reads YAML, updates key, writes back. Uses simple YAML serializer. Correct.
- `var_config_fmd`: Reads variables.json, finds variable by name, updates value, writes back. Correct.
- `var_fmd`: Same logic as var_config_fmd. Correct.

### POST /api/notebook/trigger (MISSING)

The old `trigger_setup_notebook()` function:
- Found NB_UTILITIES_SETUP_FMD by name in the CODE workspace
- Triggered it via Fabric Jobs API `POST /v1/workspaces/{ws}/items/{nb}/jobs/instances?jobType=RunNotebook`
- Returned `{success, notebookId, workspaceId}`

Frontend expects this response shape in `handleTriggerNotebook()`.

### GET /api/notebook/job-status (MISSING)

The old `get_notebook_job_status(ws_id, nb_id)` function:
- Queried `GET /v1/workspaces/{ws}/items/{nb}/jobs/instances` to list recent job instances
- Returned `{jobs: [{id, status, startTime, endTime, failureReason}]}`

Frontend expects this response shape in `startPolling()`.

## Issues Found

### 1. CRITICAL -- Deploy feature is broken: `/api/notebook/trigger` and `/api/notebook/job-status` are missing

Neither `POST /api/notebook/trigger` nor `GET /api/notebook/job-status` have been migrated to any `routes/*.py` file. The entire "Run Setup Notebook" deploy feature will fail.

- Clicking "Deploy Framework" -> "Yes, Deploy Now" will get a 404 from `/api/notebook/trigger`
- Even if trigger somehow worked, job status polling would 404 on `/api/notebook/job-status`

**Fix needed**: Create route handlers for these two endpoints, or add them to an existing routes file (e.g., `routes/admin.py` or a new `routes/notebook.py`).

### 2. MINOR -- templateMapping always empty in migrated route

`config_manager.py:get_notebook_config()` returns `"templateMapping": {}` (hardcoded). The old server built this dynamically by analyzing pipeline JSON files and mapping template GUIDs to deployed GUIDs per workspace. The "Template -> Real ID Mapping" section in the UI will always show empty.

**Impact**: Low -- this section is informational and collapsed by default.

### 3. MINOR -- missingConnections always empty

Same issue: `"missingConnections": []` is hardcoded. The old server detected connections that were deactivated during deployment. The warning banner for missing connections will never appear.

**Impact**: Low -- the warning was advisory only.

### 4. NOTE -- Config read/write is file-based, not SQLite

`GET /api/notebook-config` reads from the filesystem (`config/item_config.yaml`, `src/VAR_*.VariableLibrary/variables.json`), not from SQLite. This is correct by design -- these are repo-level config files that the Fabric setup notebook reads.

## Verdict

**Page Status: PARTIALLY BROKEN** -- Config viewing and editing works (2/4 endpoints migrated). The "Deploy Framework" feature is broken (2/4 endpoints missing: notebook trigger and job status).
