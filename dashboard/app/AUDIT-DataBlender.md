# DataBlender Page Audit

**Audited**: 2026-03-10
**Page**: `dashboard/app/src/pages/DataBlender.tsx`
**Components**: TableBrowser, TableProfiler, BlendSuggestions, BlendPreview, SqlWorkbench

---

## Frontend Bugs Fixed

### 1. Metadata-sourced tables could not be profiled or queried (CRITICAL)
**Files**: `TableProfiler.tsx`, `SqlWorkbench.tsx`, `DataBlender.tsx`, `TableBrowser.tsx`

Tables from the metadata DB (IDs like `lz-123`, `br-456`, `sv-789`) had no way to resolve their lakehouse/schema/table name for the profile API call. The old code only parsed `lh-` prefixed IDs (lakehouse-discovered tables) and fell back to a `mockTables.find()` lookup that never matched real data.

**Fix**: Changed the component chain to pass the full `BlenderTable` object (with lakehouse, schema, name) from `TableBrowser` through `DataBlender` down to `TableProfiler` and `SqlWorkbench` via a new `tableMeta` prop. This enables profiling and querying for ALL table types, not just lakehouse-discovered ones.

### 2. Dead mock data dependencies
**Files**: `TableBrowser.tsx`, `TableProfiler.tsx`, `BlendSuggestions.tsx`

- `TableBrowser` imported `mockTables` but fetches from `/api/blender/tables` -- never used mock data
- `TableProfiler` imported `getTableProfile` and `mockTables` -- `getTableProfile` was never called, `mockTables.find()` always returned null for real table IDs
- `BlendSuggestions` imported `mockBlendSuggestions` but hardcodes an empty array

**Fix**: Removed all unused mock imports.

### 3. Unused React state variables in TableProfiler
**File**: `TableProfiler.tsx` (outer component)

`sortKey`, `setSortKey`, `sortAsc`, `setSortAsc` were declared in the outer `TableProfiler` but only used inside `LiveProfileView`. Dead code.

**Fix**: Removed from outer component. `LiveProfileView` already has its own sort state.

### 4. Unused imports across all components
- `TableProfiler.tsx`: `Clock` (lucide icon) -- never rendered
- `BlendPreview.tsx`: `useState` (React) -- component has no state
- `DataBlender.tsx`: `Badge` (UI component) -- never rendered
- `BlendSuggestions.tsx`: `mockBlendSuggestions` -- never used

**Fix**: Removed all unused imports.

---

## Backend Issues (Not Fixed -- Document Only)

### B1. No SQLite fallback for `/api/blender/tables`
**File**: `server.py:1480` (`get_blender_tables()`)

The function calls `query_sql()` which hits the Fabric SQL Database directly. Unlike other endpoints (entities, connections, datasources), there is no `_cpdb_available()` check or SQLite fallback. If the Fabric SQL endpoint is slow or unreachable, the table browser shows nothing.

**Severity**: Medium. The lakehouse discovery layer (Layer 2) provides partial fallback, but metadata-sourced tables (with entity IDs, layer assignments, data source names) are lost.

### B2. No SQLite fallback for `/api/blender/profile`
**File**: `server.py:1265` (`profile_lakehouse_table()`)

Profiling queries go directly to lakehouse SQL analytics endpoints via `query_lakehouse()`. No caching, no fallback. Each profile request fires a potentially expensive `COUNT(DISTINCT ...)` + `MIN/MAX` query across all columns.

**Severity**: Low. Profiling is inherently a live operation -- you need the actual lakehouse endpoint to get real column statistics. But the 50-column cap (line 1274) is good defense.

### B3. SQL injection surface in `execute_blender_query`
**File**: `server.py:1443`

The blender query endpoint accepts raw SQL from the frontend. It has keyword blocklist validation (line 1449-1451) but this is bypassable. For example:
- `SELECT * FROM t; DROP TABLE t --` would pass the starts-with-SELECT check
- Multi-statement execution depends on the pyodbc driver config

**Severity**: Low-Medium. The lakehouse SQL analytics endpoint is read-only by default (Fabric enforces this at the engine level), so even if injection succeeds, DDL/DML would fail. The keyword blocklist is defense-in-depth, not the primary security boundary.

### B4. Lakehouse endpoint cache never invalidates
**File**: `server.py:1165` (`discover_lakehouse_endpoints()`)

The `_lakehouse_endpoints` dict is populated once and never refreshed. If a new lakehouse is created or an endpoint URL changes, the server must be restarted.

**Severity**: Low. Lakehouse endpoints rarely change. The `/api/blender/endpoints` endpoint exists but doesn't have a force-refresh mechanism.

### B5. Purview status check fires on every page load
**File**: `DataBlender.tsx:19-21`

The `checkPurview()` call runs in a `useEffect([], [])` on mount. This means every navigation to the DataBlender page fires a Purview API request. If Purview is not configured (`PURVIEW_ACCOUNT` is empty), the server returns immediately, but if it IS configured and the token exchange is slow, this blocks the status indicator.

**Severity**: Low. The indicator is non-blocking (it renders independently of the main content), and the call is fire-and-forget. But it could be cached client-side.

### B6. BlendSuggestions and BlendPreview are stub implementations
**Files**: `BlendSuggestions.tsx`, `BlendPreview.tsx`

Both components are empty shells. `BlendSuggestions` hardcodes `suggestions = []` with a TODO comment. `BlendPreview` just shows a placeholder message. There are no backend endpoints for blend suggestion generation.

**Severity**: N/A (known incomplete feature). The mock data in `blenderMockData.ts` has full `BlendSuggestion` objects that could be served from a future API.

---

## API Endpoint Summary

| Endpoint | Method | Backend Function | SQLite Fallback | Notes |
|----------|--------|-----------------|-----------------|-------|
| `/api/blender/tables` | GET | `get_blender_tables()` | NO | Merges metadata DB + live lakehouse discovery |
| `/api/blender/endpoints` | GET | `discover_lakehouse_endpoints()` | N/A | Fabric REST API, cached in memory |
| `/api/blender/profile` | GET | `profile_lakehouse_table()` | NO | Live profiling via lakehouse SQL endpoint |
| `/api/blender/sample` | GET | `sample_lakehouse_table()` | NO | Not used by frontend |
| `/api/blender/query` | POST | `execute_blender_query()` | NO | Raw SQL execution, read-only enforced |
| `/api/purview/status` | GET | `purview_status()` | N/A | Checks Purview connectivity |
| `/api/purview/search` | GET | `purview_search()` | N/A | Searches Purview catalog |
| `/api/purview/entity/:guid` | GET | `purview_get_entity()` | N/A | Gets single Purview entity |

---

## Data Contract Verification

### `/api/blender/tables` response vs `BlenderTable` interface
- Server returns: `{id, name, layer, lakehouse, schema, source, dataSource?}`
- Frontend expects: `{id, name, layer, lakehouse, schema, dataSource?}`
- **Match**: YES. `source` field is extra but unused by frontend (harmless).

### `/api/blender/profile` response vs `LiveTableProfile` type
- Server returns: `{lakehouse, schema, table, rowCount, columnCount, profiledColumns, columns[], error?}`
- Frontend expects: `LiveTableProfile` with same shape
- **Match**: YES. Column objects include `completeness` and `uniqueness` which map to the `ColumnProfile` type.

### `/api/blender/query` response vs `QueryResult` type
- Server returns: `{success?, error?, rowCount?, rows?, sql?}`
- Frontend expects: `QueryResult` with `{success?, error?, rowCount?, rows?, sql?}`
- **Match**: YES.
