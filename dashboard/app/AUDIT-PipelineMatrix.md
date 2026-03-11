# PipelineMatrix Page Audit

**Audited**: 2026-03-10
**File**: `dashboard/app/src/pages/PipelineMatrix.tsx`
**Sub-components**: `dashboard/app/src/components/pipeline-matrix/EntityDrillDown.tsx`, `dashboard/app/src/hooks/useEntityDigest.ts`

---

## CRITICAL BUG FIXED (Frontend)

### BUG-1: `/api/pipeline-matrix` endpoint does not exist [SEVERITY: P0 - Page completely broken]

**Root cause**: The page called `fetch("${API}/api/pipeline-matrix")` but no such endpoint exists in `server.py`. The page always showed an error state.

**Fix applied**: Rewired `fetchData()` to call two existing endpoints in parallel:
- `GET /api/entity-digest` -- provides per-source entity status across all medallion layers
- `GET /api/control-plane` -- provides recent pipeline run data (gracefully optional)

Added `buildMatrixData()` function that transforms the entity-digest + control-plane responses into the `MatrixData` shape. Handles both backend response formats:
- **SQLite path**: `sources` is an array of `{name, displayName, entities[], statusCounts}`
- **Fabric SQL path**: `sources` is a dict of `{key, name, connection, entities[], summary}`

### BUG-2: Hardcoded empty API base URL

**Root cause**: Line 24 had `const API = ""` instead of using `import.meta.env.VITE_API_URL || ""`.

**Fix applied**: Changed to `const API = import.meta.env.VITE_API_URL || ""` for consistency with all other hooks/pages.

### BUG-3: Removed unused `RecentRun` interface

The `RecentRun` interface was defined but never used in any rendering code. Removed to reduce dead code.

---

## Backend Issues (NOT fixed -- document only)

### BACKEND-1: `_sqlite_entity_digest` returns different shape than Fabric SQL path [SEVERITY: Medium]

**File**: `server.py:976-982` (SQLite) vs `server.py:4638-4648` (Fabric SQL)

The SQLite path returns:
```json
{
  "sources": [ {name, displayName, entities, statusCounts} ],
  "statusCounts": {...},
  "totalEntities": N,
  "_source": "sqlite"
}
```

The Fabric SQL path returns:
```json
{
  "sources": { "KEY": {key, name, connection, entities, summary} },
  "generatedAt": "...",
  "buildTimeMs": N,
  "totalEntities": N
}
```

**Impact**: Any consumer of `/api/entity-digest` must handle both formats. The `useEntityDigest` hook (`DigestResponse.sources`) types it as `Record<string, DigestSource>` but the SQLite path returns an array. Currently only works because the SQLite path has different key names (`statusCounts` vs `summary`), so downstream code silently gets undefined values.

**Recommendation**: Normalize `_sqlite_entity_digest` to return the same dict-based structure as the Fabric SQL path.

### BACKEND-2: `_sqlite_entity_digest` dead code at line 830-832

```python
bronze_by_lz = {}
for b in bronze_ents:
    pass  # Dead loop — body is literally `pass`
```

The variable `bronze_by_lz` is immediately overwritten at line 838. The `bronze_ents = cpdb.get_bronze_entities()` call at line 820 is wasted.

### BACKEND-3: Backslash path separators in route matching (server.py:8470-8472)

```python
elif self.path == '\api\notebook-executions':
elif self.path == '\api\schema':
```

These use backslash `\` instead of forward slash `/`. On Windows this might accidentally work via path normalization, but these routes will never match on Linux/macOS/production. Compare with the correct form at line 8474: `elif self.path.startswith('/api/entity-digest'):`.

**Affected routes**: `/api/notebook-executions`, `/api/schema`, and possibly others (search for `\\api\\` in do_GET).

### BACKEND-4: SQL injection in `build_entity_digest` (server.py:4517)

```python
safe_src = source_filter.replace("'", "''")
rows = query_sql(f"EXEC execution.sp_BuildEntityDigest @SourceFilter = '{safe_src}'")
```

Single-quote escaping is not sufficient SQL injection prevention. Should use parameterized queries (`_execute_parameterized` is available in the same file).

---

## Frontend Code Quality Notes (no fix needed)

### NOTE-1: `<style>` tag in JSX for animations (line 739-749)

The `flowParticle` and `pulseGlow` keyframes are defined via an inline `<style>` tag and re-injected on every render. Also, EntityDrillDown has its own inline `<style>` for `slideInRight`. These should ideally be in `index.css` (`fadeIn` is already there).

Not a bug -- works correctly. Just style organization.

### BUG-4 (FIXED): Pipeline status `"Succeeded"` missing from color map

`PIPELINE_STATUS_COLOR` had `"Completed"` but not `"Succeeded"`. The control-plane returns `"Succeeded"` for completed runs, so they showed in gray instead of green.

**Fix applied**: Added `Succeeded: "text-[var(--cl-success)]"` to `PIPELINE_STATUS_COLOR`.

### NOTE-3: ActivePipelineBanner filters for `InProgress` and `NotStarted`

The banner uses `p.status === "InProgress" || p.status === "NotStarted"` which matches the control-plane's output format. This is correct.

---

## Data Flow Summary

```
PipelineMatrix.tsx
  |
  +-- fetchData() calls:
  |     GET /api/entity-digest  -->  server.py build_entity_digest()
  |     GET /api/control-plane  -->  server.py get_control_plane() [pipeline runs]
  |
  +-- buildMatrixData() transforms responses into MatrixData
  |
  +-- SourceCard components render per-source medallion flow
  |     |
  |     +-- LayerNode (click) --> setDrillDown()
  |
  +-- EntityDrillDown (slide-in panel)
        |
        +-- useEntityDigest({ source, layer, status })
              |
              +-- GET /api/entity-digest?source=X&layer=Y&status=Z
```

## Files Modified

| File | Change |
|------|--------|
| `dashboard/app/src/pages/PipelineMatrix.tsx` | Replaced broken `/api/pipeline-matrix` with `/api/entity-digest` + `/api/control-plane`. Added `buildMatrixData()`. Fixed API base URL. Removed unused `RecentRun` type. Added `Succeeded` to `PIPELINE_STATUS_COLOR`. |
