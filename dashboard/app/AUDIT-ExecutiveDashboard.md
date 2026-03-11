# ExecutiveDashboard Page Audit

Audited: 2026-03-11
File: `dashboard/app/src/pages/ExecutiveDashboard.tsx` (~757 lines)
Backend: `dashboard/app/api/server.py`

---

## Frontend Bugs Fixed

### 1. `fmtNum` and `fmtPct` crash on null/undefined/NaN (MEDIUM)

**Problem:** Both helper functions called `.toLocaleString()` and `.toFixed()` directly on the `number` parameter without guarding against null, undefined, or NaN. If the backend returns a partial response with missing numeric fields, the page would crash with a TypeError.

**Fix:** Added null/NaN guards to both `fmtNum()` and `fmtPct()` — they now accept `number | null | undefined` and return safe defaults ("0" and "0.0%") for invalid inputs.

### 2. Footer text says "Auto-refreshing every 30s via SSE" (LOW)

**Problem:** The footer at line 752 claimed the page auto-refreshes every 30 seconds via SSE. In reality, the page polls every 2 minutes (120,000ms) via `setInterval` and uses no SSE whatsoever. Misleading to anyone inspecting the UI.

**Fix:** Updated footer text to "Auto-refreshing every 2 min" to match actual behavior.

### 3. Unsafe destructuring of API response fields (MEDIUM)

**Problem:** Line 483 destructured `data` with `const { overview, sources, pipelineHealth, recentActivity, issues, trends } = data` — if the backend returned a partial JSON object (missing any of these top-level keys), every downstream access would crash with "Cannot read properties of undefined." This is especially dangerous because the `/api/executive` endpoint doesn't even exist yet (see B1 below).

**Fix:** Replaced bare destructuring with null-coalesced defaults for every top-level field. Each field falls back to a safe empty structure: `overview` gets zero counts, `sources` gets `[]`, `pipelineHealth` gets zeroes, etc. This ensures the page renders gracefully even with incomplete backend data.

---

## Backend Issues (Not Fixed -- Requires server.py Changes)

### B1. `/api/executive` endpoint does not exist (CRITICAL)

**File:** `server.py` — entire `do_GET` handler (lines ~8402-8968)

**Problem:** The page fetches from `/api/executive` (line 432 of the .tsx file), but there is **no route for `/api/executive`** anywhere in `server.py`. The server's `do_GET` handler has no `elif` branch matching this path. It falls through to the catch-all `elif self.path.startswith('/api/')` at line 8960, which returns a 404 error. This means the **entire Executive Dashboard page is non-functional** — it will always display the error state ("Could not load dashboard data").

**Fix needed:** Add an `/api/executive` route to `server.py` that aggregates data from existing sources. The response shape expected by the frontend is the `ExecData` interface:

```python
elif self.path == '/api/executive':
    self._json_response(get_executive_summary())
```

The `get_executive_summary()` function would need to aggregate:
- Entity counts per layer from SQLite/entity-digest
- Source system breakdown with per-source layer counts
- Pipeline health stats from metrics_store (`get_pipeline_success_rate()`)
- Recent pipeline activity from metrics_store (`get_recent_pipeline_runs()`)
- Health trends from metrics_store (`get_health_trends()`)
- Issues (recent failures) from error-intelligence or pipeline runs

Alternatively, the frontend could be refactored to compose data from existing endpoints (`/api/entity-digest`, `/api/control-plane`, `/api/record-counts`, etc.) rather than depending on a single monolithic `/api/executive` endpoint.

### B2. `/api/source-config` endpoint does not exist (MEDIUM)

**File:** `server.py` — entire `do_GET` handler

**Problem:** The `useSourceConfig.ts` hook (imported at line 22) fetches from `/api/source-config`, but this endpoint also does not exist in `server.py`. The hook handles the error gracefully (returns empty config, line 79), so the page won't crash, but all source names will display as raw technical identifiers instead of friendly labels (e.g., "MES" instead of "Manufacturing Execution System").

**Fix needed:** Add an `/api/source-config` route that returns label/color mappings for source systems.

---

## Other Observations (No Fix Needed)

### Loading pattern is correct
The page does NOT call `setLoading(true)` inside the polling callback — loading is only `true` during the initial state. The `hasLoadedOnce` ref pattern is not needed here because the existing approach is already correct: initial loading shows spinner, subsequent polls update data silently, and the `lastHash` ref prevents unnecessary re-renders when data hasn't changed.

### `resolveSourceLabel` race condition (cosmetic)
On first render, the `useSourceConfig` module-level cache may not be populated yet, so `resolveSourceLabel()` returns the raw source name. This resolves on the next re-render after the source config fetch completes. Not a crash, just a brief flash of technical names.

### Error handling on fetch is adequate
The `fetchData` callback has a try/catch that sets the error state, and the UI conditionally shows error vs data based on both `error` and `data` states. If data was previously loaded and a subsequent poll fails, the old data remains visible (no flash to error state). This is correct behavior.
