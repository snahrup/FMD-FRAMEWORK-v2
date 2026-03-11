# ImpactAnalysis Page Audit
Audited: 2026-03-11

## Frontend Bugs Fixed

### 1. LOW — Unused import `Table2`
**Problem:** `Table2` from `lucide-react` was imported (line 14) but never referenced anywhere in the component. Dead code that inflates the bundle.
**Fix:** Removed `Table2` from the lucide-react import statement.

### 2. LOW — Invalid HTML: `<p>` inside `<button>`
**Problem:** At-risk entity buttons (line ~387-388) contained `<p>` elements for the table name and schema. Per HTML spec, `<button>` only accepts phrasing content; `<p>` is flow content. This causes DOM nesting validation warnings and potential layout issues in strict renderers.
**Fix:** Replaced `<p>` with `<span className="block ...">` to preserve visual block layout while using valid phrasing content inside `<button>`.

### 3. MEDIUM — Empty propagation text when no downstream layers active
**Problem:** The impact summary text (line ~102) produced "would propagate through ." with an empty string between "through" and the period when an entity had no active downstream layers (e.g., a `not_started` entity). The `.filter().map().join()` chain returned an empty string, and the sentence was always rendered regardless.
**Fix:** Extract the active layers array, `filter(Boolean)` to remove any undefined labels, then conditionally render either the propagation sentence or "has no active downstream layers yet." based on whether any active layers exist.

### 4. LOW — Unused variable `withErrors`
**Problem:** `withErrors` (line 171) was computed via `allEntities.filter((e) => e.lastError).length` but never referenced in JSX or any other expression. Dead code that runs a filter on every render for no purpose.
**Fix:** Removed the unused variable.

## Backend Issues

### 1. NONE — No backend issues found

The `/api/entity-digest` endpoint (server.py:8449) correctly handles query parameters, delegates to `build_entity_digest()` (server.py:4463), and the response shape matches the `DigestEntity` TypeScript interface. The SQLite primary path (`_sqlite_entity_digest`, server.py:789) produces all required fields: `id`, `tableName`, `sourceSchema`, `source`, `lzStatus`, `bronzeStatus`, `silverStatus`, `lastError`, `connection`, etc.

## Items Reviewed — No Issues Found

- **Anti-flash loading pattern**: Not needed. `useEntityDigest` has a module-level singleton cache (30s TTL) that returns instantly on cache hit. React 18 batching prevents `loading=true` from rendering when the promise resolves synchronously from cache. The page gates the source overview table on `!loading` (line 293), and KPIs gracefully show "0" during the sub-frame initial load.
- **Null/undefined guards**: All `.toLowerCase()` calls use optional chaining (`e.tableName?.toLowerCase()`, `e.sourceSchema?.toLowerCase()` at line 124). `resolveSourceLabel` handles null/undefined inputs. `connection?.server` uses optional chaining.
- **Division by zero**: `blastPct` calculation (line 322) guards with `src.total > 0`. `allEntities.length` as divisor is safe because `sourceBreakdown` is derived from `allEntities` — if the array is empty, `sourceBreakdown` is empty and the loop never executes.
- **Stale closures**: `handleSelect` has no deps (only calls setters and a pure function). `exportReport` correctly depends on `[impactResult]`. `suggestions` useMemo correctly depends on `[allEntities, search]`.
- **Memory leaks**: No intervals, no event listeners, no subscriptions. `URL.createObjectURL` is properly revoked after download. `useEntityDigest` handles unmount via `mountedRef`.
- **Key prop issues**: All keys are stable identifiers (`l.layer`, `e.id`, `src.source`), not array indices.
- **Dynamic Tailwind classes**: All class names are complete string literals via `cn()`. No template-literal fragments.
