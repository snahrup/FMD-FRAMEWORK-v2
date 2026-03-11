# SqlExplorer Page Audit

**Audited**: 2026-03-11
**Page**: `dashboard/app/src/pages/SqlExplorer.tsx`
**Components**: ObjectTree, TableDetail
**Types**: `dashboard/app/src/types/sqlExplorer.ts`

---

## Frontend Bugs Fixed

### 1. Memory leak: document event listeners not cleaned up on unmount (MEDIUM)
**File**: `SqlExplorer.tsx`

`handleMouseDown` attaches `mousemove` and `mouseup` listeners to `document`. These are only removed inside `onMouseUp`. If the component unmounts while a resize drag is in progress (e.g., user navigates away mid-drag), the listeners remain attached to `document` permanently -- leaking memory and causing stale state updates on an unmounted component.

**Fix**: Added a `cleanupRef` that stores the `onMouseUp` function whenever a drag starts. A `useEffect` cleanup function calls `cleanupRef.current?.()` on unmount, which removes both document listeners and resets body styles. `onMouseUp` also clears the ref to avoid double-cleanup.

### 2. Stale closure and unnecessary re-creation of handleMouseDown (LOW)
**File**: `SqlExplorer.tsx`

`handleMouseDown` had `[sidebarWidth]` in its `useCallback` dependency array, causing it to be recreated on every width change during a drag (potentially hundreds of times per resize). The `sidebarWidth` value was captured as `startWidth` at mousedown time, but the dependency meant the callback identity changed on every render during resize -- unnecessary churn.

**Fix**: Replaced direct `sidebarWidth` read with `sidebarWidthRef.current` (a ref synced on every render). The `useCallback` dependency array is now `[]` -- the callback is created once and never recreated. The ref always provides the current width at mousedown time.

---

## Items Investigated -- Not Bugs

### initialSelection IS consumed by ObjectTree
The `initialSelection` memo is passed to `ObjectTree` which has a dedicated `useEffect` (guarded by a `deepLinkApplied` ref) that auto-expands the tree to the matching server/database/schema/table on mount. This is working as designed.

### No unused imports
All imports are used: `useState`, `useCallback`, `useRef`, `useMemo`, `useEffect` (added by this audit), `useSearchParams`, `ObjectTree`, `TableDetail`, `Database`, `Server`, `Table2`, `ArrowRight`, `SelectedTable`.

### No key prop issues
`SqlExplorer.tsx` has no `.map()` calls or dynamic list rendering. The `EmptyState` component renders only static content.

---

## Backend Issues (Not Fixed -- Document Only)

### B1. `server` parameter used unsanitized in pyodbc connection strings
**File**: `server.py` (lines 1714, 1766, 1790, 1814, 1875)

All `sql_explorer_*` functions pass the `server` parameter directly into the pyodbc connection string (`SERVER={server}`) without calling `_sanitize_sql_str()`. While `database`, `schema`, and `table` are sanitized, the `server` value comes straight from the query string. A crafted server value with semicolons could inject arbitrary ODBC connection string properties (e.g., `server=;AttachDbFilename=...`).

**Severity**: Medium. The dashboard runs on an internal network with Windows Auth, but the attack surface exists. The server value should be validated against a known-good list (the registered connections) or at minimum stripped of `;` characters.

### B2. SQL injection in row count queries via f-string interpolation
**File**: `server.py` (lines 1847-1853, 1888-1893)

The `sql_explorer_columns` and `sql_explorer_preview` functions use `_sanitize_sql_str()` for bracket-delimited identifiers in the `SELECT` query, but the row count query uses single-quoted string literals: `WHERE s.name = '{s_sch}' AND t.name = '{s_tbl}'`. The `_sanitize_sql_str` function only escapes single quotes (`'` to `''`), which is adequate defense for string literals, but parameterized queries would be safer and more maintainable.

**Severity**: Low. The quote-doubling in `_sanitize_sql_str` is a valid SQL Server escaping technique, but it's defense-in-depth at best. Parameterized queries via `cursor.execute(sql, params)` would eliminate the risk entirely.

### B3. No timeout or cancellation for preview queries
**File**: `server.py` (line 1880)

`sql_explorer_preview` executes `SELECT TOP {limit} *` with a connection timeout of 30s, but no query-level timeout. On large tables with no useful indexes, this can block for the full 30s (or longer if the connection timeout only applies to the connect phase). The frontend has no way to cancel an in-flight preview request.

**Severity**: Low. The `TOP` clause limits result size, and the connection timeout provides a ceiling, but a `SET LOCK_TIMEOUT` or `cursor.timeout` would give finer control.
