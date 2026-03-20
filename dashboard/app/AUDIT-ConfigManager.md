# ConfigManager Page Audit

Audited: 2026-03-11
File: `dashboard/app/src/pages/ConfigManager.tsx` (~1601 lines)
Backend: `dashboard/app/api/server.py`

---

## Summary

ConfigManager is the largest page in the dashboard. It provides a unified view of every dynamic
configuration value across the FMD framework: metadata DB entities (workspaces, lakehouses,
connections, data sources, pipelines), pipeline JSON parameter defaults, variable libraries,
dashboard server config, and live Fabric entity resolution. It supports inline editing of any
value, cascade GUID updates across all locations, mismatch detection, and one-click pipeline
deployment to Fabric.

### API Endpoints Used

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/config-manager` | GET | `get_config_manager()` line 5558 | Load all config data |
| `/api/config-manager/update` | POST | `update_config_value()` line 7373 | Update any config value |
| `/api/config-manager/references?guid=` | GET | `find_guid_references()` line 7500 | Find cascade refs |
| `/api/deploy-pipelines` | POST | `deploy_pipelines_to_fabric()` line 7836 | Deploy pipelines |

### Response Shape Analysis

- `get_config_manager()` returns PascalCase DB fields (`WorkspaceId`, `WorkspaceGuid`, `Name`,
  `IsActive`, `LakehouseGuid`, `ConnectionGuid`, `PipelineGuid`, `DataSourceId`, `ConnectionId`,
  etc.) and the frontend correctly accesses these PascalCase properties throughout. No shape
  mismatches detected.
- `dashboardConfig` returns the raw `config.json` which contains non-string values (numbers,
  booleans) in the `engine` and `server` sections. The frontend typed this as
  `Record<string, Record<string, string>>` which was incorrect -- see Bug 4 below.

---

## Frontend Bugs Fixed

### 1. EditableCell onSave rejection leaves permanent saving state (MEDIUM)
**Problem:** In `EditableCell` (lines 314-316 and 322-325), the `onSave(draft).then(...)` chain
had no `.catch()` or `.finally()`. If the save promise rejected (network error, server error),
`setSaving(false)` and `setEditing(false)` would never execute, leaving the input permanently
in a disabled "saving" state with no way to cancel.
**Fix:** Added `.catch(() => {}).finally(() => setSaving(false))` to both the Enter key handler
and the Save button click handler. On success, editing closes; on failure, saving state resets
so the user can retry or cancel.

### 2. CascadeModal initial selection uses wrong indices (MEDIUM)
**Problem:** In `CascadeModal` (line 494-496), the initial `selected` state was built by
filtering out `yaml_readonly` entries and then mapping with `(_, i) => i`, which produces
indices 0, 1, 2... from the *filtered* array. But the checkbox render loop at line 532 uses
indices from the *full* `prompt.references` array. If a `yaml_readonly` entry appeared before
non-readonly entries, the wrong checkboxes would be pre-selected.
**Fix:** Changed to `.map((r, i) => ({ r, i })).filter(({ r }) => ...).map(({ i }) => i)` which
preserves the original array indices through the filter operation.

### 3. Fix All Mismatches button silently fails on error (MEDIUM)
**Problem:** The "Fix All Mismatches" button handler (line 806) called `doUpdateDirect()` in a
loop with `await` but had no `try/catch`. If any update failed, the remaining updates would be
skipped and `load()` / `setShowDeployPrompt(true)` would never execute -- the button would
appear to do nothing.
**Fix:** Wrapped the entire handler in `try/catch` that logs errors to the updateLog.

### 4. handleCascadeConfirm silently fails on error (MEDIUM)
**Problem:** `handleCascadeConfirm` (line 659) called `doUpdateDirect()` in a loop with no
error handling. A single failed cascade update would abort the remaining updates and leave the
modal dismissed without feedback.
**Fix:** Added `try/catch` around the loop, logging errors to updateLog. `setCascadePrompt(null)`
and `load()` always execute regardless of errors.

### 5. Dashboard config non-string values cause type mismatch (LOW)
**Problem:** The dashboard config section (line 1541) cast config values as
`Record<string, string>` but `config.json` contains numbers (`port: 8787`, `batch_size: 15`)
and booleans (`pipeline_fallback: true`). This caused `val?.startsWith?.("${")` to require
the unusual double-optional-chain pattern, and `val || ""` would incorrectly turn `0` to `""`.
**Fix:** Renamed parameter to `rawVal`, added `const val = rawVal == null ? "" : String(rawVal)`
to normalize all values to strings before use. Removed the double-optional-chain since `val`
is now always a string.

---

## Backend Issues (Not Fixed -- Requires server.py Changes)

### B1. SQL Injection in update_config_value (CRITICAL)
**File:** `server.py` lines 7378-7460
**Problem:** All `UPDATE` statements in `update_config_value()` use string interpolation
(f-strings) to build SQL queries with user-supplied values:
```python
# BAD (vulnerable — DO NOT USE):
# query_sql("UPDATE integration.Workspace SET WorkspaceGuid = '" + new_guid + "' WHERE WorkspaceId = " + str(ws_id))

# GOOD — parameterized query (FIXED):
query_sql("UPDATE integration.Workspace SET WorkspaceGuid = ? WHERE WorkspaceId = ?", [new_guid, ws_id])
```
A malicious GUID value like `'; DROP TABLE integration.Workspace; --` would execute arbitrary
SQL. This affects workspace, lakehouse, connection, datasource, and pipeline_db update targets.
**Fix needed:** Use parameterized queries (`?` placeholders) throughout.

### B2. dashboardConfig returns raw config.json without filtering sensitive sections (LOW)
**File:** `server.py` lines 5651-5656
**Problem:** `get_config_manager()` returns the entire `config.json` including the `engine`
section with notebook/pipeline IDs and the `paths` section with OneLake path templates. While
`client_secret` is masked by `${FABRIC_CLIENT_SECRET}` env var substitution, these sections
are implementation details that shouldn't be editable from the Config Manager UI.
**Fix needed:** Either filter to only return the expected sections (`fabric`, `sql`, `server`,
`purview`, `logging`) or add a whitelist of editable sections.

---

## No Issues Found In

- **Anti-flash loading:** Page does not poll. Single initial `load()` call with loading state
  that only shows spinner on first load (`loading && !data` check at line 707). No fix needed.
- **PascalCase/camelCase shapes:** All DB field access matches backend response (PascalCase).
- **Null property access:** `resolveGuid` and all data access paths use optional chaining or
  explicit null checks. Entity properties accessed with `|| ""` fallbacks throughout.
- **Stale closures:** `load` is memoized with `useCallback([])`, `resolveGuid` depends on
  `[data]`. No stale closure risks.
- **Hook imports:** Page uses `useState`, `useEffect`, `useCallback` -- all correctly imported.
  No shared hooks (`useEngineStatus`, `useEntityDigest`) are imported by this page.
