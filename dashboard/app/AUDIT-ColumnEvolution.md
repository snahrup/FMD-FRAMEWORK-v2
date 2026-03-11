# ColumnEvolution Page Audit

Audited: 2026-03-11
File: `dashboard/app/src/pages/ColumnEvolution.tsx` (~1009 lines)
Backend: `dashboard/app/api/server.py`

---

## Summary

The ColumnEvolution page lets users select an entity and visualize its column schema transforming through the medallion layers (Source -> Landing Zone -> Bronze -> Silver -> Gold). It uses a single API endpoint (`/api/journey`) to fetch the full journey data, then builds display columns with diff annotations for each layer.

**API endpoints used:**
- `GET /api/journey?entity={id}` -> `get_entity_journey()` (server.py line 3422)
- `GET /api/entity-digest` -> via `useEntityDigest` hook (entity list for selector)

**Shared hooks imported:**
- `useEntityDigest` from `@/hooks/useEntityDigest.ts` (already has `hasLoadedOnce` anti-flash pattern)

---

## Frontend Bugs Fixed

### 1. Loading flash on refresh — anti-flash pattern missing (MEDIUM)
**Problem:** `loadJourney` called `setLoading(true)` on every invocation, including refreshes via the Refresh button. When a user refreshes column data for an entity that's already displayed, the entire content area briefly flashes to the "Loading column schema..." spinner, then back to the data. This is jarring and unnecessary.
**Fix:** Added a `hasLoadedOnce` ref. On first load, `setLoading(true)` fires normally. On subsequent refreshes, data updates silently without the spinner flash. The ref resets when switching entities via `handleEntitySelect`.

### 2. NaN entity ID sent to API (LOW)
**Problem:** `loadJourney` accepted any `number` including `NaN` (from `parseInt("abc", 10)`). While the backend validates `entity_id.isdigit()` and returns 400, the fetch would still fire with `?entity=NaN`, wasting a round-trip and briefly showing a loading state.
**Fix:** Added `if (isNaN(id) || id <= 0) return;` guard at the top of `loadJourney`.

### 3. getTypeStyle crash on null/undefined dataType (LOW)
**Problem:** `getTypeStyle(dataType)` calls `dataType.toLowerCase()` directly. If a column from the API has a null or undefined `DATA_TYPE` (edge case with unusual Fabric column types), this would throw `TypeError: Cannot read properties of null`.
**Fix:** Changed to `(dataType || "").toLowerCase()` to safely fall through to the default type style.

---

## Backend Issues (Not Fixed -- Requires server.py Changes)

### B1. Entity-not-found returns 200 instead of 404 (LOW)
**File:** `server.py` line ~8596 + line ~3444
**Problem:** When `get_entity_journey()` returns `{'error': 'Entity X not found'}`, the handler sends it via `self._json_response()` which defaults to status 200. The frontend handles this correctly by checking `data.error`, but returning 200 for a not-found case is semantically incorrect and could confuse API consumers.
**Fix needed:** The handler should check if the result has an `error` key and call `self._error_response(result['error'], 404)` instead.

### B2. IsIncremental may be wrong in SQLite mode (LOW)
**File:** `server.py` line ~3539
**Problem:** `lz.get('IsIncremental') == 'True'` compares against the string `'True'`. In SQLite mode, boolean fields are stored as integers (`1`/`0`), so this comparison always returns `False` — every entity would appear as non-incremental in the journey view.
**Fix needed:** Use `str(lz.get('IsIncremental', '')).lower() in ('true', '1')` or a more robust boolean coercion.

### B3. No try/except around get_entity_journey call (LOW)
**File:** `server.py` line ~8596
**Problem:** The `/api/journey` handler calls `get_entity_journey(int(entity_id))` without its own try/except. If an unexpected exception occurs (e.g., database timeout, permission error), it falls through to the top-level catch-all at line 8966 which returns a generic 500. This works but provides no journey-specific error context.
**Fix needed:** Wrap in try/except with a more descriptive error message.

---

## Architecture Notes

- **Clean separation**: Pure helper functions (`buildDisplayColumns`, `computeDiffSummary`, `getTypeStyle`) are testable and well-structured.
- **No polling**: This page does not auto-refresh journey data (unlike ControlPlane/LiveMonitor). The auto-play feature only cycles through layer views, not API calls. No polling-related anti-flash issues.
- **Schema diff logic is sound**: The `_build_schema_diff` backend function and the `buildDisplayColumns` frontend function correctly handle all cases: unchanged, type_changed, added_in_silver, bronze_only.
- **Field casing is consistent**: Backend returns `COLUMN_NAME`, `DATA_TYPE`, etc. (PascalCase from INFORMATION_SCHEMA), and the frontend `ColumnInfo` interface matches exactly.
- **`schemaDiff` field naming**: Backend uses `columnName` (camelCase), frontend `SchemaDiffEntry` handles both `columnName` and `column` via the `diffName()` helper.
