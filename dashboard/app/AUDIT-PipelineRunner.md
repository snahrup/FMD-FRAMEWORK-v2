# PipelineRunner Page Audit

**Audited**: 2026-03-10
**File**: `dashboard/app/src/pages/PipelineRunner.tsx` (907 lines)
**Backend**: `dashboard/app/api/server.py` — runner_* functions (lines 2235-2607)

---

## Architecture Overview

The PipelineRunner is a 4-step wizard (Source > Layer > Review > Running) that enables
scoped pipeline execution. It temporarily deactivates non-selected entities in the
metadata database, triggers a Fabric pipeline via REST API, then provides a restore
mechanism to reactivate all entities afterward.

### API Endpoints Used

| Endpoint | Method | Handler | Purpose |
|----------|--------|---------|---------|
| `/api/runner/sources` | GET | `runner_get_sources()` | Entity counts per source per layer |
| `/api/runner/entities?dataSourceId=X` | GET | `runner_get_entities(X)` | Entity list for single source |
| `/api/runner/state` | GET | `runner_get_state()` | Current runner scope state |
| `/api/runner/prepare` | POST | `runner_prepare_scope()` | Deactivate non-selected entities |
| `/api/runner/trigger` | POST | `runner_trigger()` | Trigger Fabric pipeline |
| `/api/runner/restore` | POST | `runner_restore()` | Reactivate all entities |

---

## Frontend Bugs Fixed

### 1. Type mismatch on `RunnerState.deactivated` (line 52)

**Was**: `deactivated?: { lz: number; bronze: number; silver: number }`
**Fixed to**: `deactivated?: { lz: number | number[]; bronze: number | number[]; silver: number | number[] }`

The backend's `_runner_state['deactivated']` contains **arrays of entity IDs** (used for
restore), not counts. The frontend never renders this field directly (it uses `affected`
for counts), so this was a silent type mismatch. Fixed for correctness.

### 2. Stale entity mode on source toggle (line 372)

**Problem**: When a user selected a single source, switched to "custom" entity mode,
picked specific entities, then toggled a second source — the entity panel hid but
`entityMode` remained `'custom'` with stale entity IDs. If they then deselected the
second source (back to single), the stale entity selection would reappear.

**Fix**: Reset `entityMode`, `entities`, `selectedEntityIds`, `entitySearch`, and
`expandedSource` whenever `toggleSource` fires.

### 3. Entity count always used landing layer (line 413, 731)

**Problem**: `totalEntitiesInScope` and the per-source entity count in the Review step
always used `s.entities.landing.active` regardless of which layer was selected. If bronze
or silver had fewer active entities than landing, the review would show an inflated count.

**Fix**: Use `s.entities[selectedLayer]` when layer is landing/bronze/silver, fall back
to landing for 'full' mode.

---

## Backend Issues (Not Fixed — Server-Side Changes Needed)

### B1. `runner_get_state()` returns full entity ID lists

`runner_get_state()` at line 2604 returns the raw `_runner_state` dict which includes
`deactivated.lz`, `deactivated.bronze`, `deactivated.silver` — each an array of entity
IDs (up to ~1,600 IDs per array). This payload is fetched on every page load and the
frontend doesn't use the ID arrays at all.

**Recommendation**: Return a sanitized version of `_runner_state` that replaces the
deactivated ID arrays with just their counts:

```python
def runner_get_state() -> dict:
    _load_runner_state()
    state = dict(_runner_state)
    if state.get('deactivated'):
        state['deactivated'] = {
            k: len(v) if isinstance(v, list) else v
            for k, v in state['deactivated'].items()
        }
    state.pop('selectedEntityIds', None)
    return state
```

### B2. Missing Optiva in `_DS_DISPLAY_NAMES` (line 128)

The runner uses `_DS_DISPLAY_NAMES` for display names but this map only contains 4 of
the 5 sources (MES, ETQ, M3, M3 Cloud). Optiva is missing. The frontend falls back to
`resolveSourceLabel()` via the source-config API, so users see the correct label, but
the server-sent `displayName` field returns the raw DB name for Optiva.

**Recommendation**: Add `'optivalive': 'Optiva'` to `_DS_DISPLAY_NAMES`.

### B3. No pipeline completion polling

After triggering a pipeline, the frontend enters the "running" step but has no mechanism
to poll for completion status. The user must manually click "Restore All Entities" when
they believe the pipeline has finished. There is no auto-detection of pipeline completion
or failure.

The `jobInstanceId` is stored in runner state and could be used to poll the Fabric Jobs
API (`/api/fabric-jobs` already exists) for completion status.

**Recommendation**: Add a polling interval on the "running" step that checks
`/api/fabric-jobs` for the `jobInstanceId` and auto-transitions to a "completed" state
when the job finishes. Show a status badge (Running / Succeeded / Failed).

### B4. Runner state persistence is file-based only

`_runner_state` is persisted to `.runner_state.json` in the API directory. If the server
process crashes between prepare and restore, the state file allows recovery. However:

- The file is a flat JSON with no checksums or version markers
- If the file gets corrupted, all deactivated entity IDs are lost and the user must
  manually reactivate entities in the SQL database
- There is no expiry / auto-restore mechanism if the user forgets to restore

**Recommendation**: Add a `maxDurationSeconds` field to runner state and have the server
auto-restore on startup if the state has been active longer than the threshold.

### B5. `runner_prepare_scope` batches UPDATE with raw `cursor.execute(sql, batch)`

Lines 2464-2470 batch entity ID lists and pass them as params to an IN clause. The batch
variable is a Python list passed directly as the `params` argument. This works correctly
with pyodbc (which unpacks list elements as positional params), but the pattern is
somewhat fragile — a single batch of 500 IDs generates a very long IN clause.

No action needed — this is a code quality note, not a bug.

---

## Data Contract Verification

| Frontend Field | Backend Source | Match |
|---------------|---------------|-------|
| `RunnerSource.dataSourceId` | `DataSourceId` | OK |
| `RunnerSource.name` | `ds['Name']` | OK |
| `RunnerSource.displayName` | `_ds_display_name(ds['Name'])` | OK (see B2) |
| `RunnerSource.connectionName` | `conn_map[ds['ConnectionId']]` | OK |
| `RunnerSource.isActive` | `ds['IsActive']` | OK (note: string "True"/"1" from pyodbc) |
| `RunnerSource.entities.*` | Layer count queries | OK |
| `RunnerEntity.lzEntityId` | `LandingzoneEntityId` | OK |
| `RunnerEntity.isIncremental` | `_to_bool(IsIncremental)` | OK |
| `RunnerState.active` | `_runner_state['active']` | OK |
| `RunnerState.kept` | Counts dict | OK |
| `RunnerState.affected` | Counts dict | OK |
| `RunnerState.deactivated` | ID lists (fixed type) | OK |
| `RunnerState.pipelineTriggered` | Pipeline name string | OK |
| `RunnerState.triggeredAt` | Unix timestamp (seconds) | OK |

### `isActive` type coercion note

`RunnerSource.isActive` is typed as `boolean` in the frontend, but `_execute_parameterized`
converts all values to strings (line 3930: `str(v)`). The `query_sql` function likely does
the same. So `isActive` arrives as the string `"True"` or `"1"`, which is truthy in JS but
not strictly `=== true`. The SourceCard component never directly checks `source.isActive`,
so this is currently harmless, but any future code that does `if (source.isActive === true)`
would fail.

---

## Components Reviewed

- `StepIndicator` — Pure UI, no issues
- `SourceCard` — Uses `source.displayName || getSourceDisplayName(source.name)`, correct fallback chain
- `EntityTable` — Filtering, selection, toggle-all all work correctly
- `PipelineRunner` (main) — Issues documented above, 3 fixed

## Error Handling Assessment

- `fetchJson` / `postJson`: Properly throw on non-OK responses with error text
- `executeRun`: Catch block correctly fetches runner state after partial failure
- `restoreScope`: Catch block shows error, does not reset runner state on failure (correct)
- Loading state: Shows spinner on initial load, error message on failure
- Entity loading: Silently catches errors and shows empty list (acceptable)
