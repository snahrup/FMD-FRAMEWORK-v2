# AdminGovernance Page Audit

Audited: 2026-03-11

## Frontend Bugs Fixed

1. **CRITICAL — Anti-flash loading: full page blanks on refresh**
   - Problem: `loadMetadata()` unconditionally calls `setMetaLoading(true)` on every invocation, including refreshes. Combined with the early-return loading guard (line 199), the entire page unmounts and shows a spinner even when data is already displayed. The `useEntityDigest` hook has its own `hasLoadedOnce` guard, but the metadata fetch path did not.
   - Fix: Added `hasLoadedMetaOnce` ref. `setMetaLoading(true)` is now only called when `hasLoadedMetaOnce.current` is false. Set to `true` after first successful load. Imported `useRef` from React.

2. **MEDIUM — Invalid HTML: `<div>` nested inside `<span>` and `<p>` elements**
   - Problem: Six instances of `<div className="w-2 h-2 ... rounded-full">` used as dot indicators inside `<span>` (entity count badges, lines 304/308/312) and inside `<p>` (expanded panel layer headings, lines 549/572/589). Block elements inside inline/phrasing elements is invalid HTML, causes hydration warnings in SSR, and unpredictable rendering in some browsers.
   - Fix: Changed all six `<div>` dot indicators to `<span>` with `inline-block` added to preserve sizing behavior.

3. **MEDIUM — Dynamic Tailwind classes not compiled by JIT**
   - Problem: Pipeline category badge (line 775) used string interpolation for Tailwind classes: `` text-${cat.color}-600 dark:text-${cat.color}-400 bg-${cat.color}-50 dark:bg-${cat.color}-950/20 ``. Tailwind's JIT compiler scans source files for complete class names — dynamically constructed strings are never detected, so these classes are missing from the CSS bundle. Badges render with no color styling.
   - Fix: Replaced `color` property with `badgeClass` containing the full static class strings for each category. Tailwind can now detect and compile all five color variants.

4. **MEDIUM — Expensive derived arrays recomputed on every render**
   - Problem: `activePipelines`, `pipelinesByCategory`, `devWorkspaces`, `prodWorkspaces`, `configWorkspaces`, `sourceLanes`, and `orphanConnections` were computed as plain expressions in the render body. Every state change (including hover/expand) triggers re-render, re-running all these filter/map chains against 1,666+ entities and 26+ pipelines unnecessarily.
   - Fix: Wrapped all seven derived computations in `useMemo` with appropriate dependency arrays.

## Backend Issues

1. **server.py:2147 — `get_pipelines()` returns `SELECT *` with no explicit column list**
   - Problem: The `Pipeline` interface on the frontend expects `PipelineId`, `PipelineGuid`, `WorkspaceGuid`, `Name`, `IsActive`. `SELECT *` works today but is fragile — any schema change (column add/rename) silently changes the API shape. The other metadata endpoints (`get_registered_connections`, `get_registered_datasources`) use explicit column lists.
   - Fix needed: Change to `SELECT PipelineId, PipelineGuid, WorkspaceGuid, Name, IsActive FROM integration.Pipeline ORDER BY PipelineId`.

2. **server.py:3862 — `get_workspaces()` returns `SELECT *` with no explicit column list**
   - Problem: Same issue as above. Frontend `Workspace` interface expects only `WorkspaceId`, `WorkspaceGuid`, `Name`.
   - Fix needed: Change to `SELECT WorkspaceId, WorkspaceGuid, Name FROM integration.Workspace ORDER BY WorkspaceId`.

3. **server.py:3865 — `get_lakehouses()` returns `SELECT *` with no explicit column list**
   - Problem: Same issue. Frontend `Lakehouse` interface expects `LakehouseId`, `LakehouseGuid`, `WorkspaceGuid`, `Name`, `IsActive`.
   - Fix needed: Change to `SELECT LakehouseId, LakehouseGuid, WorkspaceGuid, Name, IsActive FROM integration.Lakehouse ORDER BY LakehouseId`.

4. **server.py:4458-4461 — `get_dashboard_stats()` counts use `IsActive = 1` (integer) but frontend interfaces use `'True'` (string)**
   - Problem: The SQL queries use `WHERE IsActive = 1` which is correct for SQL Server bit columns. However, `query_sql()` returns these as string `'True'`/`'False'` in the JSON response (pyodbc converts bit to Python bool, then `json.dumps` serializes to string via the row-to-dict logic). The frontend filters on `=== 'True'` which matches. No runtime bug currently, but the inconsistency between SQL `1` and frontend `'True'` is a latent risk if the serialization layer changes.
   - Fix needed: No immediate fix required — document the convention.
