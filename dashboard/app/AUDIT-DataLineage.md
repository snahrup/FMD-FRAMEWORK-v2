# DataLineage Page Audit
Audited: 2026-03-11

## Frontend Bugs Fixed

### 1. HIGH — Silent fetch failure in loadColumns (no error handling)
**Problem:** `loadColumns` checked `res.ok` but did nothing on failure — silently returned, leaving the user on a permanent "Loading column data..." spinner. The `catch` block was empty (`catch { /* */ }`), so network errors and JSON parse errors were also swallowed silently.
**Fix:** Added proper error state (`fetchError`). Non-ok responses now set a descriptive error message. JSON parse errors are caught separately. A `fetchError` display block was added to the column lineage UI between the loading spinner and the empty-state message.

### 2. HIGH — Memory leak / React state update on unmounted component in loadColumns
**Problem:** `loadColumns` calls `setColumns` and `setLoading` after an async `fetch`, but if the `EntityLineageDetail` component unmounts mid-fetch (user closes the panel or selects a different entity), these calls fire on an unmounted component. React warns about this, and it represents a memory leak since the fetch stays in flight.
**Fix:** Added an `AbortController` via `abortRef`. Each `loadColumns` call aborts any prior in-flight request. A cleanup `useEffect` aborts on unmount. State updates are guarded by `!controller.signal.aborted` checks. Abort errors are silently ignored.

### 3. MEDIUM — Null connection renders "undefined/undefined" in detail panel subtitle
**Problem:** Line `{entity.connection?.server}/{entity.connection?.database}` — when `connection` is `null` (per the `DigestEntity` type, `connection: EntityConnection | null`), optional chaining returns `undefined` for both, rendering the string `"undefined/undefined"` visually in the subtitle.
**Fix:** Changed to a conditional expression: `{entity.connection ? \` \u00b7 ${entity.connection.server}/${entity.connection.database}\` : ""}` — omits the server/database segment entirely when connection is null.

### 4. MEDIUM — Unused imports cause larger bundle and lint warnings
**Problem:** Six unused imports: `ChevronRight`, `ChevronDown`, `Filter`, `Maximize2` (lucide-react icons), `LAYERS` (from `@/lib/layers`), `LineageRelationshipType` (from `@/types/governance`). Also two unused component-scoped symbols: `LayerBadge` (UI component), `LayerColumn` (interface), and `EntityLineage` (interface). The `digest` prop on `EntityLineageDetail` was received but never read.
**Fix:** Removed all unused imports, the dead `LayerColumn` interface, the dead `EntityLineage` interface, and the unused `digest` prop from `EntityLineageDetail` (both the signature and the call site).

## Backend Issues

### 1. HIGH — /api/microscope/{id} endpoint does not exist
**File:** server.py (no matching route found)
**Problem:** `EntityLineageDetail.loadColumns` calls `fetch(\`/api/microscope/${entity.id}\`)` on line 88. This endpoint is not defined anywhere in `server.py`. The column lineage feature will always fail with a 404, which is now at least surfaced to the user (see fix #1 above) instead of silently swallowed.
**Fix needed:** Implement `GET /api/microscope/{id}` in server.py. Expected response shape based on frontend consumption:
```json
{
  "source": { "columns": [{ "name": "ColA" }, ...] },
  "landing": { "columns": [{ "name": "ColA" }, ...] },
  "bronze": { "columns": [{ "name": "ColA" }, { "name": "HashedPKColumn" }, ...] },
  "silver": { "columns": [{ "name": "ColA" }, { "name": "IsDeleted" }, ...] }
}
```
Each layer key is optional. The endpoint should query the SQL metadata DB or lakehouse schema for the given entity ID and return column names per layer. A `DataMicroscope.tsx` page already exists in the codebase and may have similar backend logic that can be reused.

## Notes
- **Anti-flash pattern**: Not needed here. The page uses `useEntityDigest` which has a module-level singleton cache (30s TTL). On mount, if the cache is warm, the hook resolves synchronously within a single React batch, so `digestLoading` never visibly flashes true. The page does not do background polling or manual refresh calls.
- **Division by zero in KPIs**: Already guarded — all percentage calculations use `totalEntities ? (x / totalEntities * 100) : 0`.
- **Key props**: Entity list uses `e.id` as key (stable numeric ID). Column list uses column name as key (unique within the set). Both are correct.
- **Null guards on search**: `e.tableName?.toLowerCase()`, `e.sourceSchema?.toLowerCase()`, `e.source?.toLowerCase()` all use optional chaining. These fields are typed as non-optional strings in `DigestEntity`, so the guards are defensive but harmless.
