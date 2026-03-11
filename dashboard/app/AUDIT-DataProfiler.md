# DataProfiler Page Audit

Audited: 2026-03-11
File: `dashboard/app/src/pages/DataProfiler.tsx` (~1102 lines)
Backend: `dashboard/app/api/server.py`

---

## Summary

DataProfiler is a self-contained page with an entity picker (powered by `useEntityDigest` hook) and a table profiler view that calls `/api/blender/profile`. It has three view modes: Table, Missing Matrix, and Quality Ranking. The page has no polling or auto-refresh — it fetches once when a table is selected.

### API Endpoints Used
| Endpoint | Handler | Purpose |
|----------|---------|---------|
| `/api/blender/profile?lakehouse=&schema=&table=` | `profile_lakehouse_table()` (line ~1265) | Profiles a lakehouse table: row count + per-column stats |
| `/api/entity-digest` (via `useEntityDigest`) | `_sqlite_entity_digest()` or `build_entity_digest()` | Entity list for the picker |

### Shared Hooks
| Hook | File | Usage |
|------|------|-------|
| `useEntityDigest` | `src/hooks/useEntityDigest.ts` | Provides `allEntities`, `sourceList`, `loading` for EntityPicker |

---

## Frontend Bugs Fixed

### 1. Backend error response silently ignored (MEDIUM)
**Problem:** The backend `profile_lakehouse_table()` can return `{error: "...", columns: [...]}` (server.py lines 1294, 1297) when the profile query fails or returns no results. The frontend cast the response directly as `ProfileData` without checking for an `error` field, so the error message was lost and the page either showed empty data or crashed trying to render raw column metadata (which lacks `completeness`/`uniqueness` fields).
**Fix:** Added explicit check for `data.error` before treating the response as profile data (line ~683).

### 2. Missing `completeness`/`uniqueness` fields cause NaN and crashes (CRITICAL)
**Problem:** The backend only sets `completeness` and `uniqueness` on column profiles when `row_count > 0` (server.py lines 1324-1327). For empty tables, these fields are `undefined`. The frontend `ProfileColumn` interface declares them as `number` but they could be missing, causing:
- `qualityScore()` to return `NaN` (completeness used without fallback)
- KPI bars rendering with `NaN%` width
- `.toFixed()` calls on undefined values throwing TypeError
**Fix:** Added normalization in `loadProfile()` that defaults all numeric fields to 0 via `?? 0` (lines 687-694). Also fixed `qualityScore()` to use `?? 0` for `completeness` (line 148).

### 3. Division by zero in Avg KPI cards (MEDIUM)
**Problem:** The Avg Completeness and Avg Uniqueness KPI cards computed `reduce(...) / profile.columns.length` without checking if `columns.length` is 0. When a profile has zero profiled columns (edge case with error fallback), this produces `NaN`.
**Fix:** Added `profile.columns.length > 0` guard with fallback to 0 (lines 883-898).

### 4. Missing React key on Fragment in table rows (LOW)
**Problem:** The column table rows used `<>...</>` (keyless Fragment) as the wrapper for the `<tr>` + optional `<ColumnDetailPanel>` pair inside `.map()`. The `key` was placed on the inner `<tr>` instead of the Fragment, which causes a React warning about missing keys in lists and can lead to incorrect reconciliation when expanding/collapsing detail panels.
**Fix:** Imported `Fragment` from React and replaced `<>` with `<Fragment key={col.name}>` (line 958). Removed the now-redundant `key` from the inner `<tr>`.

---

## Backend Issues (Not Fixed -- Requires server.py Changes)

### B1. Profile error response returns raw column metadata (LOW)
**File:** `server.py` line ~1294
**Problem:** When the profile SQL query fails, the error response includes `columns` from `get_lakehouse_columns()` — these are raw INFORMATION_SCHEMA rows with fields like `COLUMN_NAME`, `DATA_TYPE`, `IS_NULLABLE` (PascalCase SQL metadata), NOT the profiled `ProfileColumn` shape the frontend expects. If the frontend didn't check for `data.error` (now fixed), it would try to render these mismatched objects.
**Fix needed:** Either omit `columns` from error responses, or normalize them to the `ProfileColumn` shape with zeroed stats.

### B2. No try/catch around profile endpoint handler (LOW)
**File:** `server.py` line ~8606
**Problem:** The handler calls `profile_lakehouse_table()` directly without try/catch. If an unexpected exception occurs (e.g., token expiry, connection timeout), the HTTP handler's generic error handling kicks in, but it may return a 500 with an HTML error page rather than a JSON error — the frontend `res.json()` would then throw a parse error with an unhelpful message.
**Fix needed:** Wrap in try/except and return `{'error': str(e)}` with proper status code.

---

## Notes

- **Unused imports**: `Link` (from react-router-dom) and `Info` (from lucide-react) are imported but never used. Not bugs, just lint noise.
- **No polling/refresh**: The page fetches once per table selection. No anti-flash concerns since there's no periodic re-fetch.
- **50-column limit**: Backend only profiles the first 50 columns (server.py line 1274). The frontend shows `profiledColumns` count but doesn't warn if columns were skipped.
- **EntityPicker schema mapping**: Uses `selectedEntity.source` as the schema param, which is correct for lakehouses where tables are organized under source-name schemas (e.g., `MES.tablename`).
