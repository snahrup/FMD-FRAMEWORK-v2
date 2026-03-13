# AUDIT: TestSwarm.tsx

**Date**: 2026-03-13
**Frontend**: `dashboard/app/src/pages/TestSwarm.tsx`
**Backend handler**: NONE -- no `/api/test-swarm/*` endpoints exist in either the migrated `routes/*.py` files or the old `server.py.bak`.
**Endpoints consumed**:
- `GET /api/test-swarm/runs`
- `GET /api/test-swarm/runs/:runId/convergence`
- `GET /api/test-swarm/runs/:runId/iteration/:n`

---

## Purpose

TestSwarm is a dashboard for monitoring Claude Code `/test-swarm` runs. It displays KPI cards (tests passing, iterations, duration, files/lines changed), a run timeline, a convergence chart, a pass-rate gauge, a test heatmap, and collapsible iteration details. Multiple runs are shown in a selector; the page polls every 10 seconds for updates.

## Data Flow

1. **On mount**: Fetches `GET /api/test-swarm/runs` to get the run list. Auto-selects the first run. Sets up 10-second polling interval.
2. **On run selection**: Fetches `GET /api/test-swarm/runs/:runId/convergence` for chart data. Eagerly fetches up to 10 iterations via `GET /api/test-swarm/runs/:runId/iteration/:n` for heatmap data.
3. **On iteration expand**: Fetches iteration detail if not already cached.
4. **Every 10 seconds**: Re-fetches run list to detect status changes.

## API Call Trace

| Frontend Call | Backend Route | Data Source | Status |
|---|---|---|---|
| `GET /api/test-swarm/runs` | NONE | NONE | MISSING |
| `GET /api/test-swarm/runs/:runId/convergence` | NONE | NONE | MISSING |
| `GET /api/test-swarm/runs/:runId/iteration/:n` | NONE | NONE | MISSING |

## Data Source Correctness Analysis

### Expected data source

The test-swarm data would come from the Claude Code `/test-swarm` skill, which writes run data to the local filesystem. A `.test-swarm.yaml` config file exists at `dashboard/app/.test-swarm.yaml`. The expected data store would be:

- JSON files written by the test-swarm skill (likely in a `.test-swarm/` directory or similar)
- Possibly a SQLite table (none exists in the schema for test-swarm data)

Since no backend endpoints exist, the data source question is moot -- there is nothing to validate.

### Frontend data expectations

The frontend expects:

1. **Run list**: `RunListEntry[]` with `{runId: string, summary: {status, startedAt, completedAt, totalDuration, iterations, testsBefore, testsAfter, testsFixed, filesChanged, config}}`
2. **Convergence**: `ConvergencePoint[]` with `{iteration, passed, failed, delta}`
3. **Iteration detail**: `IterationData` with `{iteration, timestamp, duration, testsBefore, testsAfter, filesChanged, summary, agentLog, diff, persistentFailures, tests[]}`

These are custom data structures specific to the test-swarm feature. No SQLite tables in the control plane schema match this data.

### Frontend error handling

The page handles missing endpoints gracefully:
- `fetchRuns`: Sets `error` state on HTTP failure. Shows error banner: "Make sure the dashboard API is running and test-swarm has been used at least once."
- `fetchRunDetail` and `fetchIteration`: Silently swallow errors ("best effort").
- When `runs.length === 0`: Shows empty state with instructions to run `/test-swarm` in Claude Code.

## Issues Found

### 1. CRITICAL -- All three `/api/test-swarm/*` endpoints are completely unimplemented

No route handler exists for any path starting with `/api/test-swarm/` in either:
- The migrated `routes/*.py` files
- The old `server.py.bak`

This means the endpoints were NEVER implemented -- unlike NotebookDebug which was in server.py.bak but not migrated, TestSwarm's backend simply does not exist.

**Impact**: The page loads but shows the empty state ("No test-swarm runs found"). If a user has run the `/test-swarm` skill, the data exists on disk but is not served by any API.

**Fix needed**: Create `dashboard/app/api/routes/test_swarm.py` that:
1. Scans the test-swarm output directory for run data (JSON files)
2. Registers `GET /api/test-swarm/runs` returning the run list
3. Registers `GET /api/test-swarm/runs/{runId}/convergence` returning convergence data
4. Registers `GET /api/test-swarm/runs/{runId}/iteration/{n}` returning iteration detail

### 2. NOTE -- No SQLite table for test-swarm data

The `SCHEMA_REFERENCE.txt` contains no table related to test-swarm data. The feature expects file-based storage, not SQLite. This is by design -- test-swarm is a Claude Code skill that writes to the local filesystem.

### 3. NOTE -- Page degrades gracefully

Despite missing endpoints, the page does not crash. It shows an appropriate empty state message. The 10-second polling will continue to 404 but errors are caught.

## Verdict

**Page Status: BROKEN (by design)** -- 0/3 endpoints exist. The backend was never implemented. The frontend is well-built and handles the missing backend gracefully, but no data will ever appear until someone implements the route handlers. This is not a regression from the server refactor -- the endpoints never existed in the first place.
