# DataClassification.tsx Audit -- 2026-03-11

## Data Flow

```
Fabric SQL DB
    |
    v (entity-digest endpoint, 2min server TTL)
useEntityDigest() hook (30s client TTL, module-level singleton cache)
    |
    v
useClassificationData() -- pure client-side derivation (no backend classification API yet)
    |
    v
DataClassification.tsx
```

Classification data is entirely synthesized client-side from entity metadata. All counts are hardcoded to 0 because the classification engine has not been built yet. The page is a scaffold waiting for `integration.ColumnClassification` and `ColumnMetadata` tables.

## Bugs Found and Fixed

### BUG 1: Anti-flash loading pattern on background refresh (FIXED)
- **File**: `dashboard/app/src/pages/DataClassification.tsx`, line 254 (original)
- **Problem**: The entity table rendered `Loading...` whenever `loading` was true. The `useEntityDigest` hook sets `loading = true` on every `load()` call (line 147 in `useEntityDigest.ts`), including when the 30s client-side cache expires and a background re-fetch fires. This caused the entire entity table to flash to "Loading..." and back on every refresh cycle, even though stale data was already displayed.
- **Fix**: Changed condition from `loading` to `loading && allEntities.length === 0` so the loading indicator only appears on the first fetch when no data exists yet. Subsequent refreshes keep the existing table visible.

### BUG 2: Missing empty state when filters match nothing (FIXED)
- **File**: `dashboard/app/src/pages/DataClassification.tsx`, line 253-277 (original)
- **Problem**: When `filtered` was empty (e.g., search term matches no entities, or a source filter has no results) and `loading` was false, the `<tbody>` rendered zero `<tr>` elements. The user saw a table header with completely empty space below it -- no indication that the filter returned nothing.
- **Fix**: Added an explicit empty-state row: "No entities match the current filters." when search/source filter is active, or "No entities found." when unfiltered.

### BUG 3: Unused imports (FIXED)
- **File**: `dashboard/app/src/pages/DataClassification.tsx`, lines 6, 12-15, 16
- **Removed imports**:
  - `SensitivityBadge` from `@/components/ui/sensitivity-badge` -- never rendered (only `CertificationBadge` is used)
  - `Eye`, `Globe`, `Building`, `ShieldAlert`, `Filter` from `lucide-react` -- none appear in JSX
  - `cn` from `@/lib/utils` -- never called

## Issues NOT Present (Verified Clean)

- **Null guards on `.toLowerCase()`**: Line 100-101 uses optional chaining (`e.tableName?.toLowerCase()`, `e.sourceSchema?.toLowerCase()`). Safe.
- **Division by zero**: No percentage calculations exist at runtime. `coveragePercent` is hardcoded to `0` and passed to `formatPercent()` which handles null/undefined.
- **Key prop issues**: Entity rows use `e.id` (unique integer PK), source filter buttons use `s` (unique source string), heatmap rows use `src.source`. All stable keys.
- **Dynamic Tailwind classes**: All class names are static string literals. No template-literal concatenation for Tailwind classes.
- **Index-as-key**: Not used anywhere.

## Backend Issues (NOT fixed -- document only)

### ISSUE B1: No classification backend exists
- **File**: N/A (no endpoint)
- **Problem**: The page title says "Data Classification" but there is no `/api/classification` or equivalent endpoint. All classification data (`bySensitivity`, `coveragePercent`, `heatmap`) is derived purely client-side with every value hardcoded to 0. The `useClassificationData` hook (line 38) is a placeholder that estimates column counts as `entities.length * 15`.
- **Impact**: The page is functional as an entity browser with layer status, but the classification features (sensitivity heatmap, PII detection, coverage %) are non-operational scaffolding.
- **Dependency**: Requires `ColumnMetadata` table populated by Bronze/Silver notebook loads, plus a classification engine (pattern-based or AI-powered) to write to `integration.ColumnClassification`.

### ISSUE B2: Heatmap CSS variables may not resolve
- **File**: `dashboard/app/src/pages/DataClassification.tsx`, lines 216-218
- **Problem**: The heatmap cells use `var(--bg-muted)` and `var(--text-muted)` as inline style fallbacks. Standard shadcn/ui theme uses `--muted` and `--muted-foreground`, not `--bg-muted` / `--text-muted`. If these custom properties are not defined in the theme, the cells will have transparent backgrounds and invisible text.
- **Impact**: Low while all counts are 0 (the `count > 0` branch that uses hex colors is never reached, so ALL cells hit the fallback path). Will become visible once real classification data exists.
- **Note**: NOT fixed because this is currently dead UI (all counts are 0) and the correct CSS variable names depend on the project's theme configuration.

## API Endpoint Summary

| Endpoint | Method | Used By This Page | SQLite Fallback | Notes |
|----------|--------|-------------------|-----------------|-------|
| `/api/entity-digest` | GET | Yes (via `useEntityDigest`) | NO | Primary data source for entity list |
| `/api/classification/*` | -- | No (does not exist) | -- | Needed for real classification data |

## Data Contract Verification

### `useEntityDigest` response vs page usage
| Frontend Field | DigestEntity Field | Used? | Safe? |
|----------------|-------------------|-------|-------|
| `e.id` | `id: number` | Key prop | Yes |
| `e.tableName` | `tableName: string` | Display + search | Yes (optional chaining) |
| `e.sourceSchema` | `sourceSchema: string` | Display + search | Yes (optional chaining) |
| `e.source` | `source: string` | Filter + display | Yes (.filter(Boolean) on source extraction) |
| `e.lzStatus` | `lzStatus: "loaded" \| "pending" \| "not_started"` | Layer badges | Yes |
| `e.bronzeStatus` | `bronzeStatus: "loaded" \| ...` | Layer badges | Yes |
| `e.silverStatus` | `silverStatus: "loaded" \| ...` | Layer badges | Yes |
