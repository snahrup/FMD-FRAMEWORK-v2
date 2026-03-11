# NotebookDebug Page Audit

Audited: 2026-03-11

## Frontend Bugs Fixed

1. **CRITICAL** - Dynamic Tailwind classes never render
   **Problem**: Layer selection buttons used template-literal Tailwind classes like `` `bg-${info.color}-50` `` (lines 286-296, 313, 336 in original). Tailwind's JIT compiler cannot detect dynamically constructed class names, so these classes are never generated -- all three layer buttons render with no color styling.
   **Fix**: Replaced `color: string` in `LAYER_INFO` with pre-composed class strings (`activeBg`, `activeBorder`, `badgeBg`, `badgeText`, `dotColor`) containing full Tailwind classes. Applied via `cn()` helper.

2. **CRITICAL** - `showAdvanced` state shared between two unrelated toggles
   **Problem**: The "Advanced options" toggle (Step 1, line 414) and the "Technical details" toggle (Results section, line 562) both read/wrote the same `showAdvanced` state. Clicking "Technical details" in the results would also expand the advanced notebook/chunk options in Step 1, and vice versa.
   **Fix**: Added separate `showDetails` state for the results "Technical details" collapsible. The two sections are now independent.

3. **MEDIUM** - `friendlyTime()` crashes on invalid/empty ISO string
   **Problem**: `new Date("")` or `new Date(undefined)` produces an Invalid Date, and calling `.toLocaleTimeString()` on it throws in some browsers or returns "Invalid Date" string. Called at lines 526 (running status) and 631 (job history) where `startTime` can be empty string from the API.
   **Fix**: Added guards: return `"--"` for falsy input or when `isNaN(d.getTime())`.

4. **MEDIUM** - No anti-flash loading pattern
   **Problem**: On initial mount, `loading` is set to `true` immediately and the summary area shows "Loading..." before any data has ever been fetched. On subsequent layer switches, the UI flashes from data -> "Loading..." -> data, losing context.
   **Fix**: Added `hasLoadedOnce` ref. First load shows "Loading...", subsequent loads show "Refreshing..." while preserving the previous entity count in the summary.

5. **MEDIUM** - `.toUpperCase()` crash risk on namespace
   **Problem**: `ns.toUpperCase()` in the data source dropdown (line 335) crashes if `ns` is `undefined` or `null`. The backend can return entities without a `namespace` field.
   **Fix**: Changed to `(ns || "").toUpperCase()`.

6. **LOW** - `jobInstanceId` display shows just "..." when empty
   **Problem**: `runResult.jobInstanceId?.slice(0, 12) + "..."` evaluates to `"..."` when `jobInstanceId` is an empty string (which happens when the Fabric API returns no Location header).
   **Fix**: Added ternary: show truncated ID if truthy, otherwise show `"--"`.

7. **LOW** - `failureReason.message` undefined in job history
   **Problem**: When `job.failureReason` exists but `.message` is undefined, the fallback `.slice(0, 60)` would throw `TypeError: Cannot read properties of undefined`.
   **Fix**: Changed to `(job.failureReason.message || "Unknown error").slice(0, 60)`.

8. **LOW** - 10 unused icon imports
   **Problem**: `Timer`, `Activity`, `AlertTriangle`, `Layers`, `Zap`, `ArrowRight`, `Server`, `FlaskConical`, `Eye`, `EyeOff` were imported but never used. Adds to bundle size.
   **Fix**: Removed all unused imports.

## Backend Issues

1. **server.py:8737** - MEDIUM - Job status route uses prefix match with query string baked in
   **Problem**: `self.path.startswith('/api/notebook-debug/job-status?')` requires the `?` to be present. A request to `/api/notebook-debug/job-status` (no query params) would fall through to 404 instead of returning a helpful error.
   **Fix needed**: Match path without `?`, then validate query params exist.

2. **server.py:7331** - LOW - `notebook_debug_job_status` does not match GET handler name
   **Problem**: The GET handler at line 8741-8747 routes `notebookId`-only requests to `get_notebook_job_status()` (a different function than `notebook_debug_job_status`). This returns `{jobs: [...]}` format. The frontend handles both shapes, so no functional bug, but the indirection is confusing and the two functions have different error handling.
   **Fix needed**: Consider consolidating into a single function or documenting the routing clearly.

3. **server.py:7151-7233** - LOW - Landing zone entities return different shape than bronze/silver
   **Problem**: The landing zone branch returns `{entities, totalCount, notebookParams, _note}` and early-returns before the shared bronze/silver code path. The `_note` field hints that landing zone uses pipelines not notebooks, but the frontend's "Run Test" button will still trigger a notebook run for landing zone, which may fail silently.
   **Fix needed**: Frontend could show a warning or disable notebook-based run for the landing layer.
