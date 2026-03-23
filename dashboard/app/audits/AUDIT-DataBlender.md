# AUDIT-DBL: Data Blender Page Audit (Wave 2)

**Audited**: 2026-03-23
**Page**: `dashboard/app/src/pages/DataBlender.tsx`
**Components**: TableBrowser, TableProfiler, BlendSuggestions, BlendPreview, SqlWorkbench
**Backend**: `dashboard/app/api/routes/data_access.py` (Blender endpoints only)

---

## Summary

9 findings total: 7 FIXED, 2 DEFERRED.

All 3 handoff items from AUDIT-DP resolved. The backend had moved from Fabric SQL to local polars profiling since the prior audit (2026-03-13), fixing the old BUG 1/BUG 3 issues. This audit focused on the current codebase: input sanitization, error handling, dead code, design tokens, and truth accuracy.

---

## Handoff Items from AUDIT-DP

### DBL-H01: `POST /api/blender/query` — lakehouse param not sanitized (from DBL-NOTE-01)
**Severity**: HIGH
**Status**: FIXED
**Description**: The `lakehouse` param was used raw in path construction (`mount / f"{lakehouse}.Lakehouse"`), allowing path traversal (e.g., `../../etc`). The profiler endpoints (`/api/blender/profile`, `/api/blender/sample`) already used `_sanitize()`, but `/api/blender/query` did not.
**Fix**: Applied `_sanitize()` to `lakehouse` param at line 1032 of `data_access.py`.

### DBL-H02: `POST /api/blender/query` — `top_n` regex uses original SQL (from DBL-NOTE-02)
**Severity**: LOW
**Status**: FIXED
**Description**: The `re.sub` removed the TOP keyword from `sql`, then `re.search` for `top_n` read from `params.get("sql", "")` (the original). This was inconsistent but not broken since the original still had TOP. However, the ordering was wrong: `re.sub` ran before `re.search`, so if there was a bug in the sub, the search would still find it in the original. Fixed to use `raw_sql` consistently and reordered to search-then-sub.
**Fix**: Introduced `raw_sql` variable; `top_match` now reads from `raw_sql`; `re.sub` runs after.

### DBL-H03: `GET /api/purview/status` — error leaks internal exception details (from DBL-NOTE-03)
**Severity**: MEDIUM
**Status**: FIXED
**Description**: The endpoint returned `"error": str(e)` in the response, which could expose internal paths, hostnames, or token details from the exception message.
**Fix**: Removed `"error": str(e)` from the response dict. The `"status": "unreachable"` field already communicates the failure. The exception is still logged server-side via `log.warning`.

---

## Additional Findings

### DBL-01: Hardcoded hex color in page title
**Severity**: LOW
**Status**: FIXED
**File**: `DataBlender.tsx:96`
**Description**: Title used `color: "#1C1917"` instead of design token `var(--bp-ink-primary)`.
**Fix**: Replaced with `var(--bp-ink-primary)`.

### DBL-02: Unused `useCallback` import
**Severity**: LOW (dead code)
**Status**: FIXED
**File**: `DataBlender.tsx:1`
**Description**: `useCallback` imported from React but never used in the component.
**Fix**: Removed from import.

### DBL-03: SqlWorkbench calls `.json()` on non-ok response
**Severity**: MEDIUM
**Status**: FIXED
**File**: `SqlWorkbench.tsx:66`
**Description**: `fetch('/api/blender/query')` response was parsed with `.json()` without checking `resp.ok` first. A 400/500 response with non-JSON body (e.g., HTML error page) would throw a parse error, losing the actual error message.
**Fix**: Added `resp.ok` check; on failure, attempts to parse JSON for error message, falls back to generic HTTP status message.

### DBL-04: Misleading error message in TableBrowser
**Severity**: LOW (truth bug)
**Status**: FIXED
**File**: `TableBrowser.tsx:97`
**Description**: Error state showed "Offline -- showing sample data" but no sample/fallback data was loaded. The tree was empty.
**Fix**: Changed to "API offline -- no tables available" which accurately describes the state.

### DBL-05: Hardcoded hex colors in layerConfig
**Severity**: LOW
**Status**: FIXED
**File**: `blenderMockData.ts:9-13`
**Description**: Layer colors used hardcoded hex values (`#3b82f6`, `#d97706`, etc.) instead of design tokens. These are used by TableBrowser and BlendSuggestions for layer indicator dots.
**Fix**: Changed to `var(--bp-layer-*, <fallback-hex>)` format with CSS custom property + hex fallback for environments where tokens aren't defined.

### DBL-06: `post_blender_query` returns `str(e)` on SQL execution failure
**Severity**: LOW
**Status**: DEFERRED
**File**: `data_access.py:1114`
**Description**: The catch-all `except Exception as e: return {"error": str(e)}` could expose internal details. However, for a SQL workbench, the polars SQL error message is useful user feedback ("table not found", "column ambiguous"). Sanitizing would degrade the debugging UX.
**Reason deferred**: The SQL workbench is a power-user tool. Polars errors are SQL-related, not config/secrets. The risk is low and the utility is high. If a stricter security posture is needed later, wrap `str(e)` with a filter that redacts file paths.

### DBL-07: BlendSuggestions/BlendPreview are stubs with unused imports
**Severity**: N/A (known incomplete feature)
**Status**: DEFERRED
**Files**: `BlendSuggestions.tsx`, `BlendPreview.tsx`
**Description**: `BlendSuggestions` imports `cn`, `Badge`, `layerConfig`, and `BlendSuggestion` type, all used only in the `BlendCard` subcomponent which is unreachable (suggestions array is always empty). `BlendPreview` is a static placeholder. These are intentional stubs for a future feature.
**Reason deferred**: Removing imports would break the component when the feature is eventually built. The dead code is contained and clearly marked with TODO.

---

## API Endpoint Summary (Current State)

| Endpoint | Method | Sanitized? | Error Handling | Notes |
|----------|--------|-----------|----------------|-------|
| `/api/blender/tables` | GET | N/A (SQLite) | Returns `[]` on error | Correct |
| `/api/blender/endpoints` | GET | N/A (SQLite) | Returns `{}` on error | Correct |
| `/api/blender/profile` | GET | YES (`_sanitize`) | `HttpError` chain | Correct |
| `/api/blender/sample` | GET | YES (`_sanitize`) | `HttpError` chain | Correct |
| `/api/blender/query` | POST | YES (`_sanitize`) | SELECT-only + catch | Fixed (was missing sanitize) |
| `/api/purview/status` | GET | N/A | Graceful degradation | Fixed (was leaking error) |
| `/api/purview/search` | GET | N/A | Returns `[]` | Correct |

---

## Data Contract Verification (Re-verified)

### `/api/blender/tables` -> `BlenderTable` interface
- Backend returns: `{id, name, layer, lakehouse, schema, source, dataSource?}`
- Frontend expects: `{id, name, layer, lakehouse, schema, dataSource?}`
- **Match**: YES.

### `/api/blender/profile` -> `LiveTableProfile` type
- Backend returns: `{lakehouse, schema, table, rowCount, columnCount, profiledColumns, sampled?, sampleSize?, columns[], error?}`
- Frontend expects: `{lakehouse, schema, table, rowCount, columnCount, profiledColumns, columns[], error?}`
- **Match**: YES. Extra fields (`sampled`, `sampleSize`) are harmless.

### `/api/blender/query` -> `QueryResult` type
- Backend returns: `{success?, error?, rowCount?, rows?, sql?}`
- Frontend expects: `{success?, error?, rowCount?, rows?, sql?}`
- **Match**: YES.

---

## Files Modified

| File | Changes |
|------|---------|
| `dashboard/app/api/routes/data_access.py` | DBL-H01: sanitize lakehouse in query endpoint; DBL-H02: fix top_n regex ordering; DBL-H03: remove error leak from purview status |
| `dashboard/app/src/pages/DataBlender.tsx` | DBL-01: design token for title color; DBL-02: remove unused useCallback import |
| `dashboard/app/src/components/datablender/SqlWorkbench.tsx` | DBL-03: check resp.ok before .json() |
| `dashboard/app/src/components/datablender/TableBrowser.tsx` | DBL-04: fix misleading error message |
| `dashboard/app/src/data/blenderMockData.ts` | DBL-05: design tokens for layer colors |
