# ValidationChecklist Page Audit

Audited: 2026-03-11
File: `dashboard/app/src/pages/ValidationChecklist.tsx` (~812 lines)
Backend: `engine/api.py` (`_handle_validation` at line ~1021, `_handle_start` at line ~408)

---

## Frontend Bugs Fixed

### 1. Anti-Flash Loading Pattern Missing (MEDIUM)

**Problem:** The `fetchData` callback never set `loading` back to `true` on subsequent polls. The initial `useState(true)` covered the first load, but after that, `loading` was always `false`. This made the refresh spinner (`RefreshCw` icon in the header) dead code — it could never display because the condition `loading && data` was always false after the first successful fetch. Additionally, if the page ever re-rendered between polls, the loading gate `loading && !data` at the top could flash the loading skeleton on slow re-mounts.

**Fix:** Added `hasLoadedOnce` ref and a separate `refreshing` state. On first load, `setLoading(true)` shows the full-page skeleton. On subsequent polls, `setRefreshing(true)` drives the small `RefreshCw` spinner in the header without causing a full-page flash. The header condition was changed from `loading && data` to `refreshing`.

**Lines changed:** 1 (added `useRef` import), 149-150 (new state/ref), 152-166 (fetchData logic), 339 (spinner condition).

### 2. Dead Refresh Spinner (MEDIUM)

**Problem:** The `RefreshCw` spinner in the header bar (line ~339 original) used `{loading && data && ...}` as its condition. Since `loading` was only `true` during the initial load (when `data` is `null`), the conjunction `loading && data` was always `false`. The user had no visual feedback that background polling was active.

**Fix:** Replaced `loading && data` with the new `refreshing` state variable, which is `true` only during background re-fetches (not the initial load). The spinner now correctly appears during each 15-second poll cycle.

**Lines changed:** 339.

---

## Backend Issues (Not Fixed — Requires engine/api.py Changes)

### B1. Race Condition in POST /engine/start Response (LOW)

**File:** `engine/api.py` lines ~497-505

**Problem:** The `_handle_start` function starts the engine run in a background thread (`_run_thread.start()`) and immediately returns `engine.current_run_id` in the response. However, `current_run_id` is set inside `engine.run()` (orchestrator.py:217), which executes in the background thread. Due to the lack of synchronization, the response may return `run_id: null` if the background thread hasn't reached the assignment yet.

The frontend displays this as "Run started: null (N entities)" — not a crash, but confusing.

**Fix needed:** Either (a) generate the run_id before spawning the thread and pass it in, or (b) add a threading.Event that the API waits on briefly (e.g., 2s timeout) until `current_run_id` is set.

### B2. Misleading Column Alias: LzFailed / BronzeFailed / SilverFailed (LOW)

**File:** `engine/api.py` lines ~1046, ~1062, ~1080

**Problem:** The SQL queries alias `IsProcessed = 0` counts as `LzFailed`, `BronzeFailed`, `SilverFailed`. In the execution tracking schema, `IsProcessed = 0` means "attempted but not yet complete" — i.e., **pending**, not **failed**. The frontend correctly labels these as "Pending" in the checklist detail and `LayerDetail` component, but the variable names throughout the response are misleading.

**Fix needed:** Rename aliases to `LzPending`, `BronzePending`, `SilverPending` in the SQL queries and update the `LayerStatus` TypeScript interface to match. Low priority since the UI is correct.

### B3. No SQLite Caching for Validation Endpoint (LOW)

**File:** `engine/api.py` line ~1021 / `server.py` do_GET routing

**Problem:** Unlike `/engine/status` and `/engine/runs` (which have SQLite-first paths with Fabric SQL fallback), the `/engine/validation` endpoint always queries the Fabric SQL metadata database directly via `_query_sql`. With 15-second polling, this generates ~4 Fabric SQL queries per poll (7 SQL statements total). For a low-traffic dashboard this is fine, but multiple browser tabs or users could trigger throttling.

**Fix needed:** Consider adding SQLite caching similar to the control plane pattern, or increasing the poll interval for this endpoint (e.g., 30s or 60s since validation data changes slowly).

---

## Code Quality Observations (No Fix Needed)

### Type Safety: Well-Structured

- The `num()` helper (line 95) safely coerces any value to a number, preventing `NaN` propagation.
- All `.find()` results are guarded with optional chaining (`lz?.LzLoaded`) before being passed to `num()`.
- The `ValidationData` interface correctly matches the backend response shape from `_handle_validation`.
- PascalCase field names (`DataSource`, `LzLoaded`, etc.) match the SQL column aliases passed through `_safe_row`.

### SummaryCard .toLocaleString() — Safe

Line 760: `value.toLocaleString()` is safe because `value` is typed as `number` and always receives output from the `num()` helper, which guarantees a numeric return.

### Selection Model — Consistent

The "Select All" checkbox checks against all `filteredEntities` (not just the 200 rendered), which is consistent with the "Select Filtered" button behavior. The "All Missing LZ/Bronze/Silver" buttons query from `data.entities` (unfiltered) and replace the selection entirely, which is the intended UX.

### Error Handling — Adequate

Both `fetchJson` and `postJson` have proper error paths. The `handleLaunchSelected` catch block displays errors in a banner. The initial load has both a loading skeleton and an error state. Background poll errors set the `error` state but don't blank the existing data (correct behavior).
