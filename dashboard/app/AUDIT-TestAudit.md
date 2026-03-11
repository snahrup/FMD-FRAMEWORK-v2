# TestAudit Page Audit

Audited: 2026-03-11
File: `dashboard/app/src/pages/TestAudit.tsx` (~1066 lines)
Backend: `dashboard/app/api/server.py`

---

## Summary

TestAudit.tsx is a Playwright test audit dashboard (~1070 lines). It displays run history, pass/fail trends, test result cards with video/screenshot/trace artifacts, and allows triggering new audit runs. The page is self-contained with no shared hooks imported.

### API Endpoints Called
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/audit/history` | GET | Fetch run history array |
| `/api/audit/status` | GET | Poll running/idle status (every 3s) |
| `/api/audit/run` | POST | Trigger new Playwright audit run |
| `/api/audit/artifacts/{runId}/{testDir}/{fileName}` | GET | Serve video/screenshot/trace files |

### Components
- `ScoreBar` - Pass rate ring + progress bar + KPI chips
- `TrendChart` - Area chart of last 10 runs (pass/fail trend)
- `ResultBreakdownChart` - Pie chart of passed/failed/skipped
- `TestDurationChart` - Horizontal bar chart of slowest tests
- `TraceModal` - Playwright trace viewer iframe (lazy-loaded on click)
- `TestCard` - Expandable card with description + video/screenshot
- `RunHistoryRow` - Clickable row in history panel
- `TestAudit` (main) - Page layout, state management, polling

---

## Frontend Bugs Fixed

### 1. Anti-Flash Loading on Poll/Refresh (MEDIUM)
**Problem:** `setLoading(false)` was called at the end of every `loadHistory()` invocation (line ~900). Since `loadHistory` is called on poll completion, status transitions, and manual refresh, this would briefly flash the full-page loading spinner (setting `loading=true` then `false`) even after the page had already loaded once.
**Fix:** Added `hasLoadedOnce` ref. `setLoading(false)` is now only called on the very first successful load. Subsequent refreshes silently update data without flashing.

### 2. Stale Closures in useCallback/useEffect (CRITICAL)
**Problem:** `loadHistory` depended on `selectedRun` state (line ~901 deps), causing it to be recreated on every run selection. `checkStatus` depended on `auditStatus.status` and `loadHistory`, cascading recreation. But the `useEffect` with `[]` deps (line ~917) captured the initial stale versions of both callbacks, meaning:
- The `setInterval` polling always used the initial `checkStatus` which captured the initial `loadHistory`
- `checkStatus` compared `auditStatus.status` via a stale closure, so the `wasRunning` detection would never work after the first status change
- `loadHistory` checked `!selectedRun` via a stale closure, potentially overwriting user's selected run

**Fix:** Replaced state-in-closure pattern with refs (`selectedRunRef`, `auditStatusRef`) that are updated on every render. Both `loadHistory` and `checkStatus` now have stable deps (`[]` and `[loadHistory]`), so the `useEffect` deps are properly listed and the interval always uses current state via refs.

### 3. Division by Zero in Progress Bar Widths (LOW)
**Problem:** In `ScoreBar`, the progress bar width calculations (`run.passed / run.total * 100`, lines ~399-406) did not guard against `run.total === 0`. While the `passRate` calculation above (line ~368) did check `run.total > 0`, the inline style widths did not, risking `NaN%` CSS values.
**Fix:** Added `run.total > 0` guard to each progress bar segment's conditional rendering.

### 4. formatDuration Crash on Null/Undefined (LOW)
**Problem:** `formatDuration(ms)` would produce `NaN` output if `ms` was `undefined` or `null` (e.g., backend omits `durationMs` field). The comparison `ms < 1000` would be `false` for `undefined`, falling through to produce `NaNs` or `NaNm NaNs`.
**Fix:** Added `ms == null || isNaN(ms)` guard at top, returns `"—"`.

### 5. formatTimestamp Crash on Invalid Date (LOW)
**Problem:** `formatTimestamp(ts)` would crash or produce garbage if `ts` was null/undefined/malformed. `new Date(null)` returns epoch, `new Date(undefined)` returns Invalid Date, and `getTime()` on Invalid Date returns `NaN`, causing all comparisons to fail and `toLocaleDateString` to produce "Invalid Date".
**Fix:** Added `!ts` and `isNaN(d.getTime())` guards, returns `"—"` for invalid input.

### 6. Non-Array Response Crash in loadHistory (LOW)
**Problem:** If the backend returned a non-array response (e.g., error object), `data.length` would be `undefined`, and `setHistory(data)` would put a non-array into state, crashing any `.map()` call downstream.
**Fix:** Added `if (!Array.isArray(data)) return;` guard before processing the response.

---

## Backend Issues (Not Fixed -- Requires server.py Changes)

### B1. ALL Four /api/audit/* Endpoints Missing from server.py (CRITICAL)
**File:** `server.py` (searched all ~9,267 lines)
**Problem:** TestAudit.tsx calls four endpoints:
- `GET /api/audit/history`
- `GET /api/audit/status`
- `POST /api/audit/run`
- `GET /api/audit/artifacts/{runId}/{testDir}/{fileName}`

**None of these exist in server.py.** The page will show a permanent loading state (now gracefully handled after fix #1) because `loadHistory` catches the 404 error silently. Users clicking "Run Audit" will get an alert saying "Failed to trigger: Error: 404 Not Found". The `knowledge/engine/audit-backend.md` (line 138) lists `/api/audit/run` as a POST endpoint, but it is not implemented.

**Fix needed:** Implement all four `/api/audit/*` route handlers in `server.py`:
1. `GET /api/audit/history` - Read Playwright test result JSON files from a results directory, return as array of `RunSummary`
2. `GET /api/audit/status` - Track whether a Playwright process is currently running (PID tracking)
3. `POST /api/audit/run` - Spawn Playwright process (`npx playwright test`), return PID
4. `GET /api/audit/artifacts/{runId}/{testDir}/{fileName}` - Serve static files (videos, screenshots, traces) from test output directories

### B2. No Rate Limiting on POST /api/audit/run (LOW)
**File:** Frontend `TestAudit.tsx` line ~974
**Problem:** While the frontend disables the button during `isRunning || triggering`, there is no server-side guard against concurrent audit runs. Multiple rapid clicks before the first response arrives could spawn multiple Playwright processes.
**Fix needed:** Server-side mutex/PID check before spawning a new audit process.
