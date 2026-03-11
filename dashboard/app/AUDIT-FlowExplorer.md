# FlowExplorer Page Audit

Audited: 2026-03-11
File: `dashboard/app/src/pages/FlowExplorer.tsx` (~1397 lines post-fix)
Backend: `dashboard/app/api/server.py`

---

## Frontend Bugs Fixed

### 1. Anti-Flash Loading on Refresh (MEDIUM)

**Problem:** `loadAuxData` called `setAuxLoading(true)` on every invocation, including manual refreshes. Since `auxLoading` feeds into the combined `loading` gate, every refresh re-showed the full-page loading spinner, causing a visual flash and destroying all expanded/selected UI state.

**Fix:** Added `auxLoadedOnce` ref. After the first successful load, subsequent calls skip `setAuxLoading(true)` — data updates silently in the background, exactly like the shared `useEntityDigest` hook already does.

---

### 2. Auxiliary Error Blocks Entire Page (MEDIUM)

**Problem:** `const error = digestError || auxError` meant that if the three auxiliary fetches (`/api/connections`, `/api/datasources`, `/api/pipelines`) failed (e.g., Fabric SQL unreachable), the entire page showed a fatal error screen — even though the entity digest (SQLite-backed, always available) had loaded successfully. The Data Flow view only needs digest data; connections/pipelines are only needed for the Framework Architecture view and minor details.

**Fix:** Removed `auxError` from the page-blocking error gate. Added an inline amber warning banner at the top of the page when `auxError` is set, with a retry button. The Data Flow view remains fully usable.

---

### 3. `fmt()` Crash on NaN/Undefined Input (LOW)

**Problem:** `fmt(n)` called `n.toLocaleString("en-US")` directly. If any computed stat was `NaN` or `undefined` (e.g., from an empty `sourceGroups` reduce), this would throw a runtime error. While the current code paths make this unlikely, the function had no guard.

**Fix:** Changed signature to `fmt(n: number | null | undefined)` with a null/NaN guard returning `"0"`.

---

### 4. `IsActive` Check Fragile Against Backend Variance (MEDIUM)

**Problem:** All `IsActive` comparisons used `=== "True"` (exact string match). The backend has multiple code paths:
- Fabric SQL `query_sql()` returns values as strings: `"True"`, `"False"`, `"1"`, `"0"`
- SQLite path may return integers (`1`, `0`) or booleans (`true`, `false`)

Any backend change or SQLite migration would silently break all pipeline/connection filtering (active counts show 0, architecture view shows no paths).

**Fix:** Added `_isActive(v)` helper that normalizes `"True"`, `"1"`, `1`, `true` to boolean. Replaced all 4 occurrences of `=== "True"` checks.

---

### 5. Unsafe Array Index in Progress Color Lookup (LOW)

**Problem:** `LAYERS[LAYERS.findIndex(l => l.key === selectedFlow.maxLayer)].color` — if `findIndex` returned `-1` (no match), `LAYERS[-1]` would be `undefined` and `.color` would crash. While the current type system makes this unlikely (maxLayer is a typed union), it's fragile against future changes.

**Fix:** Changed to `(LAYERS.find(l => l.key === selectedFlow.maxLayer) ?? LAYERS[0]).color` which always returns a valid layer.

---

## Backend Issues (Not Fixed — Requires server.py Changes)

### B1. `/api/connections`, `/api/datasources`, `/api/pipelines` Have No SQLite Fallback (MEDIUM)

**File:** `server.py` lines ~1592-1605, ~2146-2147

**Problem:** These three endpoints call `query_sql()` which hits Fabric SQL directly. Unlike `/api/entity-digest` and `/api/control-plane` which have SQLite-first fallback paths, these endpoints fail entirely when Fabric SQL is unreachable (VPN down, token expired, throttled). The FlowExplorer page calls all three on mount.

**Fix needed:** Add SQLite fallback reads, similar to the entity-digest pattern:
```python
def get_registered_connections() -> list[dict]:
    if _cpdb_available():
        try:
            return cpdb.get_connections()
        except Exception:
            pass
    return query_sql('SELECT ConnectionId, ...')
```

### B2. `get_pipelines()` Uses `SELECT *` — Schema Coupling (LOW)

**File:** `server.py` line ~2146

**Problem:** `get_pipelines()` does `SELECT * FROM integration.Pipeline` which returns all columns in the table. If columns are added/renamed in the SQL schema, the response shape changes unpredictably. The frontend only needs `PipelineId`, `PipelineGuid`, `WorkspaceGuid`, `Name`, `IsActive`.

**Fix needed:** Explicit column list:
```python
def get_pipelines() -> list[dict]:
    return query_sql(
        'SELECT PipelineId, PipelineGuid, WorkspaceGuid, Name, IsActive '
        'FROM integration.Pipeline ORDER BY PipelineId'
    )
```

---

## Summary

| # | Bug | Severity | Fixed |
|---|-----|----------|-------|
| 1 | Anti-flash loading on refresh | MEDIUM | YES |
| 2 | Aux error blocks entire page | MEDIUM | YES |
| 3 | `fmt()` crash on NaN/undefined | LOW | YES |
| 4 | `IsActive` check fragile | MEDIUM | YES |
| 5 | Unsafe array index in progress color | LOW | YES |
| B1 | No SQLite fallback for aux endpoints | MEDIUM | NO (server.py) |
| B2 | `SELECT *` in get_pipelines | LOW | NO (server.py) |
