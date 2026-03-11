# MRI Page Audit
Audited: 2026-03-11

## Frontend Bugs Fixed

### 1. LOW — Unused import `CheckCircle2`
**Problem:** `CheckCircle2` was imported from `lucide-react` on line 13 but never referenced in the JSX or any logic. Causes unnecessary bundle weight and triggers linter warnings.
**Fix:** Removed `CheckCircle2` from the import statement.

### 2. MEDIUM — `formatElapsed` crashes or produces nonsense on edge-case inputs
**Problem:** `formatElapsed` did not guard against negative numbers, `NaN`, or `Infinity`. A negative `scanElapsed` (possible if `Date.now()` clock skew occurs) would produce output like `-1m -30s`. Floating-point values (e.g., `65.7`) would produce `65.7s` in the seconds portion due to the `%` operator preserving decimals.
**Fix:** Added guard: `if (!Number.isFinite(s) || s < 0) return "0s"` and `Math.floor(s)` before computing minutes/seconds.

### 3. MEDIUM — `selectedDiff` holds stale object reference after data refresh
**Problem:** When `mri.visualDiffs` refreshes from the API (e.g., during polling or manual refresh), the `selectedDiff` state still holds the old object from the previous fetch. The `VisualDiffViewer` would display stale `mismatchPercentage`, `mismatchPixels`, and `status` values until the user manually re-selects the diff. Additionally, if the selected test was removed from the latest run, the viewer would display a phantom diff that no longer exists.
**Fix:** Added a `useEffect` that watches `mri.visualDiffs` and syncs `selectedDiff` to the fresh object by matching on `testName`. If the test no longer exists in the new data, `selectedDiff` is cleared to `null`.

## Backend Issues

### 1. HIGH — No `/api/mri/*` endpoints exist in server.py
**Problem:** The `useMRI` hook makes requests to 10+ endpoints, none of which exist in `server.py`:
- `GET /api/mri/runs` — run list
- `GET /api/mri/status` — scan active status
- `GET /api/mri/runs/{runId}/convergence` — convergence data
- `GET /api/mri/runs/{runId}/visual-diffs` — visual diff results
- `GET /api/mri/runs/{runId}/backend-results` — API test results
- `GET /api/mri/runs/{runId}/ai-analyses` — AI analysis results
- `GET /api/mri/runs/{runId}/flake-results` — flake detection data
- `GET /api/mri/runs/{runId}/iteration/{n}` — iteration detail
- `GET /api/mri/baselines` — baseline list
- `POST /api/mri/baselines/{testName}` — accept baseline
- `POST /api/mri/baselines/accept-all` — accept all baselines
- `POST /api/mri/run` — trigger MRI scan
- `POST /api/mri/api-tests/run` — trigger API tests

Every API call will return 404, causing the `error` state to be set on mount. The page will render but show the error banner and empty data throughout.
**Fix needed:** Implement all `/api/mri/*` endpoints in `server.py`, or add a proxy/router to a separate MRI backend service.

### 2. MEDIUM — Hook stale closure in `status?.active` effect (useMRI.ts line 313)
**Problem:** The `useEffect` at line 313 has dependency array `[status?.active]` but its callback references `scanning`, `startScanTimer`, `stopScanTimer`, and `fetchTopLevel` — all of which are omitted from deps. The `scanning` boolean is captured at the time the effect runs and never updated, so the `!scanning` guard on line 314 can be stale. If `scanning` changes independently of `status?.active`, the effect won't re-evaluate. Additionally, `startScanTimer` and `stopScanTimer` are stable (empty deps in `useCallback`), so omitting them is safe in practice, but `fetchTopLevel` changes when `selectedRunId` changes, which means the effect could call a stale version of `fetchTopLevel`.
**Fix needed:** Add `scanning`, `startScanTimer`, `stopScanTimer`, `fetchTopLevel` to the dependency array, or restructure the effect to avoid the stale closure.

### 3. MEDIUM — `triggerRun` poll interval leaks on unmount (useMRI.ts line 344)
**Problem:** The `triggerRun` callback creates a `setInterval` (line 344) and a `setTimeout` safety net (line 355) that are assigned to local variables. If the component unmounts while a scan is in progress, these intervals are never cleared — they continue firing `fetchJSON` and `setStatus` calls against an unmounted component (React state updates on unmounted component). The 5-minute `setTimeout` cleanup is the only safeguard.
**Fix needed:** Store the poll interval ID in a `useRef` and add a cleanup `useEffect` that clears it on unmount, similar to how `pollRef` and `scanTimerRef` are handled.

### 4. LOW — No unmount cleanup for `scanTimerRef` (useMRI.ts)
**Problem:** The `scanTimerRef` interval is started in `startScanTimer` and cleared in `stopScanTimer`, but there is no top-level `useEffect` with an unmount cleanup (`return () => clearInterval(scanTimerRef.current)`) to guarantee the timer is cleared if the component unmounts while a scan is active.
**Fix needed:** Add a cleanup effect: `useEffect(() => () => { if (scanTimerRef.current) clearInterval(scanTimerRef.current); }, []);`

### 5. LOW — `fetchTopLevel` dependency on `selectedRunId` causes polling churn (useMRI.ts line 209)
**Problem:** `fetchTopLevel` includes `selectedRunId` in its `useCallback` dependency array (line 209) because it reads `selectedRunId` to decide whether to auto-select. This means every time `selectedRunId` changes, `fetchTopLevel` is recreated, which triggers the polling `useEffect` (line 263-268) to clear and restart its interval. On the first load, this causes a double-fetch: the initial effect fires `fetchTopLevel`, which sets `selectedRunId`, which recreates `fetchTopLevel`, which restarts the polling interval and immediately fires another fetch.
**Fix needed:** Move the auto-select logic out of `fetchTopLevel` into a separate effect that watches `runs`, or use a ref for `selectedRunId` inside `fetchTopLevel` to avoid the dependency.
