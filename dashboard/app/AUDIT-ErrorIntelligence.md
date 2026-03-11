# ErrorIntelligence Page Audit

Audited: 2026-03-11
File: `dashboard/app/src/pages/ErrorIntelligence.tsx` (~625 lines)
Backend: `dashboard/app/api/server.py` (`get_error_intelligence()` at line ~3002)

---

## Frontend Bugs Fixed

### 1. Anti-Flash Loading Pattern Missing (MEDIUM)

**Problem:** `fetchData()` unconditionally called `setLoading(true)` on every invocation, including manual refresh clicks. After the initial data load, clicking "Refresh" would flash the entire page content away (summary cards, error cards, filters) and show the spinner, then re-render everything. This is jarring UX on a page that users may refresh frequently while debugging pipeline errors.

**Fix:** Added `hasLoadedOnce` ref. `setLoading(true)` is now only called when `hasLoadedOnce.current` is false (first load). On subsequent refreshes, data updates silently in the background. Set `hasLoadedOnce.current = true` after the first successful fetch.

### 2. State Updates After Unmount (MEDIUM)

**Problem:** The `fetchData` function's `.then()` and `.catch()` handlers called `setData`, `setLoading`, and `setError` unconditionally. If the component unmounts while the fetch is in-flight (e.g., user navigates away quickly), React logs "Can't perform a React state update on an unmounted component" warnings. While React 18+ no longer throws for this, it's still a wasted state update and indicates a leak path.

**Fix:** Added `mountedRef` ref. All state setters in the fetch callbacks are now guarded by `if (mountedRef.current)`. The `useEffect` cleanup sets `mountedRef.current = false` on unmount.

### 3. TopIssueBanner Division by Zero (LOW)

**Problem:** In `TopIssueBanner`, `pct` is computed as `Math.round((topIssue.count / topIssue.totalErrors) * 100)`. If `totalErrors` were 0 (defensive edge case -- shouldn't happen in normal backend flow since `topIssue` is only set when `errors` is non-empty, but a race condition or backend bug could produce `{count: 2, totalErrors: 0}`), this would render "NaN%" in the UI.

**Fix:** Added guard: `topIssue.totalErrors > 0 ? Math.round(...) : 0`.

### 4. Unstable `catErrors` Reference Defeats useMemo (LOW)

**Problem:** In the `ErrorCard` component, `catErrors` was computed as a bare `errors.filter(...)` call (no `useMemo`). This produced a new array reference on every render. The downstream `useMemo` for `errorTypeGroups` listed `catErrors` as a dependency, but since the reference was always new, the memoization never cached -- it recomputed on every render. Same for `displayErrors` which depends on `errorTypeGroups`.

**Fix:** Wrapped `catErrors` in `useMemo` with dependencies `[errors, summary.category]`. Now `errorTypeGroups` and `displayErrors` only recompute when the actual `errors` array or `category` changes.

---

## Backend Issues (Not Fixed -- Requires server.py Changes)

### B1. Errors Capped at 100 But severityCounts Reflect Full Set (LOW)

**File:** `server.py` line ~3151

**Problem:** The response returns `'errors': errors[:100]` (capped at 100 individual records) but `severityCounts` and `totalErrors` are computed from the full untruncated `errors` list. This means when there are >100 errors, the frontend's filter/search (which operates on `data.errors`) can only search/filter 100 records, yet the summary cards show the full count. A user filtering by pipeline might see "0 results" in the card list even though the summary says "150 errors" -- because the other 50 were truncated.

**Fix needed:** Either increase the cap, paginate, or add a note in the response (`"truncated": true, "returnedCount": 100`) so the frontend can show "Showing 100 of 150 errors."

### B2. No Deduplication Between Fabric and SQL Error Types (LOW)

**File:** `server.py` line ~3055

**Problem:** Deduplication between Fabric jobs and SQL `PipelineExecution` records is done by comparing `exec_id` (from `PipelineExecutionId`) against the Fabric job `id`. These are entirely different ID spaces -- Fabric uses GUIDs, SQL uses incrementing integers. The `any(e['id'] == exec_id for e in errors)` check will never match, so if the same pipeline failure is recorded in both Fabric API and SQL logging, it appears twice in the error list (once as `source: 'fabric'`, once as `source: 'sql'`). This inflates occurrence counts and can make the "Top Issue" banner misleading.

**Fix needed:** Deduplicate by a composite key like `(pipelineName, startTime)` or by checking if the SQL row's `StartDateTime` falls within a narrow window of a Fabric job's `startTimeUtc` for the same pipeline.

---

## Architecture Notes

- **Single API call**: The page makes exactly one fetch to `/api/error-intelligence`. No polling, no intervals. The "Refresh" button triggers a manual re-fetch. This is appropriate for an error analysis page (not real-time).
- **No shared hooks**: The page does NOT use `useEngineStatus` or `useEntityDigest`. All data comes from the single error-intelligence endpoint.
- **Backend shape match is excellent**: The backend returns camelCase keys (`pipelineName`, `startTime`, `rawError`, `errorType`, etc.) which exactly match the frontend `ErrorRecord` interface. No normalization needed. The `ErrorSummary` shape also matches 1:1. This is one of the cleanest frontend-backend contracts in the dashboard.
- **Error classification is server-side**: All error categorization (`_classify_error`), context extraction (`_extract_error_context`), and severity assignment happen in Python. The frontend is purely a display layer, which is the right architecture.
- **Pipeline display names**: The frontend has a `PIPELINE_DISPLAY_NAMES` map that translates technical pipeline names to human-readable labels. This should ideally live in a shared config, but it's functional and not a bug.
