# DataMicroscope Page Audit

Audited: 2026-03-11
File: `dashboard/app/src/pages/DataMicroscope.tsx` (~1125 lines)
Backend: `dashboard/app/api/server.py`
Hooks: `dashboard/app/src/hooks/useMicroscope.ts`, `dashboard/app/src/hooks/useEntityDigest.ts`
Shared components: `dashboard/app/src/components/EntitySelector.tsx`

---

## Overview

DataMicroscope is a cross-layer row inspection tool. Users select an entity, enter a primary key value, and the page displays data for that row as it appears across Source, Landing Zone, Bronze, and Silver layers in a diff-grid format. It shows cell-level change tracking (added, changed, not_present), transformation pipeline steps, SCD2 version selection for Silver, and CellPopover details on click.

### Architecture
- **EntitySelector** (shared component): Searchable grouped-by-source dropdown using DigestEntity[]
- **PkSearchInput**: Typeahead PK search with debounced autocomplete via `/api/microscope/pks`
- **DiffGrid**: 4-column (Source/Landing/Bronze/Silver) comparison grid with cell status coloring
- **CellPopover**: Click-to-inspect popover showing before/after values and transformation details
- **TransformationCards**: Visual cards for each transformation pipeline step

### API Endpoints Called
| Endpoint | Hook | Purpose |
|----------|------|---------|
| `/api/entity-digest` | `useEntityDigest` | Load entity list for selector |
| `/api/microscope?entity=N&pk=V` | `useMicroscope` | Fetch cross-layer row data |
| `/api/microscope/pks?entity=N&q=X&limit=20` | `useMicroscopePks` | PK autocomplete search |

---

## Frontend Bugs Fixed

### 1. Silver version index out-of-bounds on entity/pk change (MEDIUM)
**Problem:** `DiffGrid` stores `silverVersionIdx` in local state initialized to 0. When the parent component passes new `data` (different entity or PK), the versions array length may change. If the user had selected version 3 on entity A (which had 5 SCD2 versions), then switched to entity B (which has only 1 version), `data.silver.versions[3]` would be `undefined`. While `undefined` is falsy and many null checks would pass, the `useMemo` for column building could miss Silver columns entirely, and the version `<select>` dropdown would show a stale selection.

**Fix:** Added a `useEffect` that resets `silverVersionIdx` to 0 and clears the active popover whenever `data.entityId` or `data.pkValue` changes. Also added a `clampedIdx` that uses `Math.min(silverVersionIdx, versionCount - 1)` as a safety net against any transient state between the effect firing and the index resetting. The `<select>` value and version access both use `clampedIdx`.

**Lines:** ~359-366 (new), ~372 (clampedIdx usage)

### 2. parseInt NaN guard missing for entity ID param (LOW)
**Problem:** Line 819 used `parseInt(entityIdParam, 10)` directly. If `?entity=abc` was in the URL (user error, deep link corruption, etc.), `parseInt` returns `NaN`, which gets passed to `useMicroscope(NaN, pkParam)`. The hook would then fire a fetch to `/api/microscope?entity=NaN`, which is a wasted request that returns an error or unexpected data.

**Fix:** Parse into a temp variable, check `Number.isNaN()`, and set `entityId` to `null` if invalid. This prevents the hook from firing at all for bogus entity params.

**Lines:** ~819-820

### 3. searchParams in useCallback deps causing unnecessary re-renders (LOW)
**Problem:** `handleEntitySelect` and `handlePkSelect` both had `searchParams` in their dependency arrays. Since `searchParams` is a new object on every render (from `useSearchParams()`), these callbacks were recreated on every render, defeating the purpose of `useCallback`. This caused unnecessary re-renders of child components that received these callbacks as props (EntitySelector, PkSearchInput).

**Fix:** Switched from reading `searchParams` inside the callback to using `setSearchParams((prev) => { ... })` functional updater form. This removes `searchParams` from the dependency array entirely, making the callbacks truly stable.

**Lines:** ~831-852

---

## Backend Issues (Not Fixed -- Requires server.py Changes)

### B1. /api/microscope endpoint does not exist (CRITICAL)
**File:** `server.py` -- missing entirely
**Problem:** The `useMicroscope` hook calls `GET /api/microscope?entity=N&pk=V` but no handler exists in server.py for this path. The proxy routes all `/api/*` to `http://127.0.0.1:8787` (server.py), which will return 404 for any unrecognized path. This means the entire cross-layer row inspection feature is non-functional -- selecting an entity and entering a PK will always result in an error.

**Fix needed:** Add a `GET /api/microscope` handler in server.py's `do_GET` method that:
1. Reads `entity` (entity ID) and `pk` (primary key value) from query params
2. Looks up the entity metadata (source connection, lakehouse info, PK column)
3. Queries the source SQL Server (if VPN available), Bronze lakehouse, and Silver lakehouse for the row matching the PK
4. Builds and returns the `MicroscopeData` response shape matching the TypeScript interface in `useMicroscope.ts`

### B2. /api/microscope/pks endpoint does not exist (CRITICAL)
**File:** `server.py` -- missing entirely
**Problem:** The `useMicroscopePks` hook calls `GET /api/microscope/pks?entity=N&q=X&limit=20` for PK autocomplete. No handler exists. The PK search input will always fail silently (the hook catches errors and sets `pks` to `[]`), so users see a search box that never returns results. Without PK discovery, users must know exact PK values to use the feature at all.

**Fix needed:** Add a `GET /api/microscope/pks` handler that:
1. Reads `entity`, `q` (search query), and `limit` from query params
2. Looks up the entity's PK column name from metadata
3. Queries the Bronze lakehouse for distinct PK values matching the search (LIKE query)
4. Returns `{ values: string[], pkColumn: string }` matching the `PkSearchResult` interface

### B3. useMicroscope hook lacks anti-flash pattern (MEDIUM)
**File:** `dashboard/app/src/hooks/useMicroscope.ts` line ~137
**Problem:** `setLoading(true)` is called unconditionally on every `load()` invocation, including when `refresh()` is called. When a user clicks "Refresh" while data is already displayed, the entire DiffGrid is replaced by the loading spinner for the duration of the fetch, then snaps back. This is the classic "anti-flash" problem seen on other pages.

**Fix needed (in hook, not page):** Add a `hasLoadedOnce` ref (same pattern as `useEntityDigest`). Only call `setLoading(true)` when `!hasLoadedOnce.current`. Set `hasLoadedOnce.current = true` after the first successful load. Reset it when `entityId` or `pkValue` changes (so initial load of new data shows spinner, but refresh of same data doesn't).

---

## Code Quality Notes

- **Well-structured**: Clean separation of concerns -- DiffGrid, CellPopover, TransformationCards, PkSearchInput are all self-contained sub-components
- **Cell status logic is thorough**: `getCellStatus()` properly handles all 4 layers with sanitized name matching for source columns
- **No security issues**: No user input rendered as HTML, no dynamic innerHTML injection
- **No memory leaks**: All effects have proper cleanup (event listeners removed, mountedRef pattern used in hooks)
- **EntitySelector integration is clean**: Uses the shared component correctly with proper props
- **useSearchParams usage**: URL state management is well-implemented for deep linking (entity + pk in URL)
