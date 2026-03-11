# DataCatalog Page Audit
Audited: 2026-03-11

## Frontend Bugs Fixed

### 1. HIGH — Anti-flash loading pattern missing
**Problem:** `loading` from `useEntityDigest` is set to `true` on every `load()` call, including when the 30s client-side cache expires and re-fetches. This causes the entire entity grid to be replaced with 6 skeleton placeholder cards on every background refresh, creating a visible flash even when data was already displayed.
**Fix:** Added `hasLoadedOnce` ref (set to `true` after first successful load). Skeleton cards now only show on initial load (`showSkeleton = loading && !hasLoadedOnce.current`). Subsequent refreshes keep the existing grid visible while data updates in the background.

### 2. HIGH — No error state UI
**Problem:** `useEntityDigest` returns an `error` string but the component only destructured `{ allEntities, loading }`, completely ignoring errors. If the `/api/entity-digest` endpoint fails (network error, server down, HTTP 500), the user sees an empty grid with "No entities match your search" — indistinguishable from a genuinely empty dataset.
**Fix:** Destructured `error` from the hook. Added an error card (red border, `AlertCircle` icon, error message) that displays when `error` is truthy and no data has loaded yet. If data was previously loaded, the stale data remains visible (no flash) and the error is suppressed to avoid disrupting the user.

### 3. LOW — Unused import: `CertificationBadge`
**Problem:** `CertificationBadge` was imported from `@/components/ui/sensitivity-badge` on line 9 but never referenced anywhere in the file. Dead import increases bundle size (tree-shaking may not eliminate it if the module has side effects) and adds confusion for future readers.
**Fix:** Removed the import.

### 4. LOW — Defensive guard on `entity.lastError.message`
**Problem:** `entity.lastError` is typed as `EntityError | null` where `EntityError` has a `message` property. The code guards `entity.lastError` for truthiness before accessing `.message`. However, if the backend ever returns a raw string instead of the expected `{message, layer, time}` object (e.g., a different error path or API version mismatch), `entity.lastError.message` would be `undefined`, rendering nothing in the error display.
**Fix:** Added defensive handling: `typeof entity.lastError === "string" ? entity.lastError : entity.lastError.message ?? "Unknown error"`. This handles both the expected object shape and a hypothetical raw-string shape without breaking.

## Items Verified Safe (No Fix Needed)

### Division by zero on `loadedPct`
Already guarded: `allEntities.length > 0 ? ... : 0` on line 254.

### Null safety on search filtering
Already uses optional chaining: `e.tableName?.toLowerCase()`, `e.sourceSchema?.toLowerCase()`, `e.source?.toLowerCase()` on line 240.

### `bronzePKs.split(",")` crash
Protected by the `hasPKs` guard (line 35) which checks truthiness, non-empty, and not "N/A" before the `.split()` on line 147 is reachable. The backend always returns `bronzePKs` as a string (with `or ''` fallback in both SQLite and Fabric SQL code paths).

### Key prop issues
All `.map()` calls use stable keys: layer cards use `l.key`, tabs use `t`, source buttons use `s`, sort buttons use `k`, entity cards use `e.id`, PK badges use `pk`.

### `entity.connection` null safety
Already uses optional chaining: `entity.connection?.server`, `entity.connection?.database`.

## Backend Issues

### 1. LOW — No dedicated `/api/data-catalog` endpoint
**Problem:** The DataCatalog page relies entirely on `/api/entity-digest`, which is a general-purpose endpoint shared by multiple pages. There is no catalog-specific endpoint that could provide additional catalog metadata (descriptions, tags, owners, data classification). The page currently shows placeholder tabs for "Columns", "Lineage", and "Quality" with no data behind them.
**Fix needed:** Not urgent. The current approach of reusing `/api/entity-digest` is correct for the entity grid. Catalog-specific features (column metadata, lineage graph data, DQ scores) would each need their own endpoint when those features are built out. No backend change required for current functionality.
