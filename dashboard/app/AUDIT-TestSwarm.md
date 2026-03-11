# TestSwarm Page Audit

**File**: `dashboard/app/src/pages/TestSwarm.tsx` (330 lines)
**Backend handler**: NONE -- no `/api/test-swarm` endpoints exist in `server.py`
**Endpoints consumed**: `GET /api/test-swarm/runs`, `GET /api/test-swarm/runs/:id/convergence`, `GET /api/test-swarm/runs/:id/iteration/:n`
**Date**: 2026-03-11

---

## Architecture Summary

TestSwarm is a dashboard for monitoring Claude Code `/test-swarm` runs. It polls `/api/test-swarm/runs` every 10 seconds, then fetches convergence data and per-iteration details for the selected run. The page renders KPI cards, a timeline visualization, a convergence chart, a pass-rate gauge, a test heatmap, and collapsible iteration detail panels.

### Data Flow
1. Frontend polls `GET /api/test-swarm/runs` every 10s to get the run list
2. On run selection, fetches `/api/test-swarm/runs/:id/convergence` for chart data
3. Eagerly fetches up to 10 iterations for heatmap via `/api/test-swarm/runs/:id/iteration/:n`
4. On-demand fetches individual iterations when user clicks timeline nodes

### Component Tree
- `TestSwarm` (page)
  - `SwarmSkeleton` (loading state)
  - `SwarmStatusBadge` (status pill in run selector)
  - `KPIRow` (5 KPI cards: tests, iterations, duration, files, lines)
  - `RunTimeline` (horizontal node timeline with framer-motion)
  - `ConvergenceChart` (recharts area chart)
  - `ConvergenceGauge` (SVG radial gauge)
  - `TestHeatmap` (test x iteration grid)
  - `IterationDetail` (collapsible panels with `TestResultsTable`, `DiffViewer`, `AgentSessionLog`)

---

## Frontend Bugs Fixed

### 1. HIGH -- `fetchRuns` recreated on every run selection, tearing down the polling interval

**Problem:** `fetchRuns` had `selectedRunId` in its `useCallback` dependency array (line 90). Every time the user selected a different run, `fetchRuns` was recreated. Because the polling `useEffect` (line 117-121) depended on `fetchRuns`, this tore down the interval and immediately re-invoked `fetchRuns` -- causing an unnecessary full re-fetch of all runs on every click.

Additionally, `selectedRunId` was captured as a stale closure value inside `fetchRuns`. The auto-select guard `!selectedRunId` on line 81 used the value from the closure at callback creation time, not the current value.

**Fix:** Replaced the `selectedRunId` dependency with a `useRef` (`selectedRunIdRef`). The ref is updated synchronously on every render, so `fetchRuns` always reads the current value without being recreated. `fetchRuns` now has an empty dependency array, so the polling interval is created once and never torn down.

### 2. HIGH -- Second useEffect reset all detail state on every 10s poll

**Problem:** The second `useEffect` (line 123-137) had `runs` in its dependency array. Since `fetchRuns` updates `runs` every 10 seconds, this effect re-fired every poll cycle. Inside the effect, `setIterations(new Map())`, `setSelectedIteration(null)`, and `setOpenIteration(null)` were called unconditionally whenever `selectedRunId` was truthy. This meant: every 10 seconds, the user's currently open iteration detail panel was closed, their timeline selection was cleared, and all cached iteration data was thrown away and re-fetched.

**Fix:** Removed `runs` from the dependency array. The effect now only fires when `selectedRunId` actually changes. Added an eslint-disable comment documenting the intentional omission. The eager iteration fetch uses the `runs` snapshot available at selection time, which is sufficient -- the iteration count for a selected run does not change between polls.

### 3. MEDIUM -- Race condition: stale iteration fetches pollute state after run switch

**Problem:** When the user switched runs, `setIterations(new Map())` cleared state, then N concurrent `fetchIteration` calls were fired for the new run. But if the user switched runs again before those resolved, the in-flight responses from the previous run would still call `setIterations(prev => new Map(prev).set(n, data))`, writing iteration data from run A into the state that should only contain run B data.

**Fix:** Added a `runVersionRef` counter (incremented on each run switch). Each `fetchIteration` call receives the version at dispatch time and checks it against the current version before writing to state. If the version has changed (user switched runs), the response is silently discarded.

### 4. LOW -- Unused `formatTime` function

**Problem:** `formatTime` was defined (line 52-54) but never called anywhere in the file. Dead code.

**Fix:** Removed the function.

### 5. LOW -- `formatDuration` edge cases for non-finite and negative values

**Problem:** `formatDuration` did not handle `NaN`, `Infinity`, `-Infinity`, or negative values. Passing `NaN` would produce `NaNms`. Passing a negative value would produce nonsensical output like `-500ms` or incorrect minute/second calculations.

**Fix:** Added a guard at the top: `if (!Number.isFinite(ms) || ms < 0) return "0ms"`. Also added `Math.round()` to the sub-1000ms path to avoid fractional millisecond display.

### 6. LOW -- Timeline `active` flag used array index instead of iteration value

**Problem:** The `active` flag for timeline nodes was computed as `c.iteration === convergence.length - 1`. This compared the iteration number (a data value, e.g. 1, 2, 3) against a 0-based array index. If the convergence array started at iteration 0, this worked by coincidence. But if the array contained only iterations starting at 1 (e.g. `[1, 2, 3]` with length 3), the last node (iteration 3) would never match `length - 1` (which is 2), so the live pulse indicator would never appear.

**Fix:** Replaced with `convergence[convergence.length - 1].iteration` -- reads the actual iteration value from the last element in the array.

---

## Backend Issues (NOT FIXED)

### 1. CRITICAL -- All three `/api/test-swarm/*` endpoints are missing from server.py

**Problem:** The page fetches three endpoints that do not exist in `server.py`:
- `GET /api/test-swarm/runs` -- run list
- `GET /api/test-swarm/runs/:id/convergence` -- convergence data for a run
- `GET /api/test-swarm/runs/:id/iteration/:n` -- iteration detail

The `DashboardHandler.do_GET` method has no handler for any path starting with `/api/test-swarm`. All three fetches will return 404, which `fetchRuns` handles by setting the error state. `fetchRunDetail` and `fetchIteration` silently swallow the errors ("best effort").

**Fix needed:** Add route handlers in `server.py` `do_GET` method that serve test-swarm data. The data source would likely be the `.test-swarm.yaml` file (found at `dashboard/app/.test-swarm.yaml`) and/or a local SQLite table or JSON files written by the `/test-swarm` Claude Code skill.

### 2. LOW -- `SwarmStatusBadge` receives `as never` type cast

**Problem:** On line 199/215, the status string from the API is cast via `(run.summary?.status || "idle") as never`. This bypasses TypeScript's type checking entirely. If the backend returns a status value not in the `SwarmStatus` union (e.g. `"cancelled"`, `"timeout"`), the badge would silently fall back to `STATUS_CONFIG.idle` via the `|| STATUS_CONFIG.idle` guard in the component, but the type system provides no safety here.

**Fix needed:** This is really a frontend typing issue. The `as never` cast should be replaced with a proper type assertion or the `SwarmStatus` type should be widened to accept `string` with a runtime fallback. However, since the backend does not exist yet, the status values are undefined and this cast is a placeholder.
