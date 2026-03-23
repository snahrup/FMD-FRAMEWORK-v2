# AUDIT: DataLineage.tsx + lineage.py

**Audited:** 2026-03-23 (supersedes 2026-03-13 audit)
**Frontend:** `dashboard/app/src/pages/DataLineage.tsx` (403 lines)
**Backend:** `dashboard/app/api/routes/lineage.py` (395 lines)

---

## Summary

The Data Lineage page is **functional and truthful**. KPIs are derived from real entity-digest data, the entity list uses real statuses, and the column lineage feature correctly calls `/api/lineage/columns/{entityId}` with proper error handling. No fake data, no Math tricks, no hardcoded counts. The previous audit's BUG-1 (`/api/microscope` missing) has been resolved -- the endpoint now exists at `/api/lineage/columns/{entityId}`.

Fixes applied: accessibility gaps (missing aria-labels, keyboard navigation on table rows), and a backend crash risk when `column_metadata` table doesn't exist.

---

## Findings

### DL-01: MEDIUM — No keyboard accessibility on entity table rows (FIXED)

**Location:** `DataLineage.tsx` line 360
**Description:** Table rows are clickable (`onClick`) but lacked `role="button"`, `tabIndex`, and `onKeyDown` handler. Keyboard-only users could not select entities.
**Fix:** Added `role="button"`, `tabIndex={0}`, `aria-label`, and `onKeyDown` handler for Enter/Space keys.

### DL-02: MEDIUM — Missing aria-label on close button (FIXED)

**Location:** `DataLineage.tsx` line 153
**Description:** The X button in the detail panel had no accessible label.
**Fix:** Added `aria-label="Close detail panel"`.

### DL-03: MEDIUM — Missing aria-label on search input (FIXED)

**Location:** `DataLineage.tsx` line 303
**Description:** Search input relied on `placeholder` for context but had no `aria-label`.
**Fix:** Added `aria-label="Search entities by name, schema, or source"`.

### DL-04: MEDIUM — `_load_cached_columns` crashes if `column_metadata` table missing (FIXED)

**Location:** `lineage.py` line 181
**Description:** The `_load_cached_columns` function queries `column_metadata` but had no exception handler around the SQL query. If the table hasn't been created yet (first run, fresh DB), the query throws an unhandled `sqlite3.OperationalError` which propagates up and causes a 500.
**Fix:** Added `except Exception` block that logs at debug level and returns `None` (cache miss), letting the caller fall through to OneLake schema discovery.

### DL-05: LOW — Hex color opacity suffixes from shared LAYER_MAP (DEFERRED)

**Location:** `DataLineage.tsx` lines 47, 180, 374
**Description:** Inline styles use patterns like `${layerDef?.color}15` and `${getSourceColor(...)}15` which append hex opacity digits to hex color strings from `layers.ts`. The colors themselves are defined in `layers.ts` which is a shared utility outside audit scope.
**Reason deferred:** The hex colors originate in `layers.ts` (shared component, out of scope). Fixing requires changing the shared `LayerDef` interface and all consumers. Not containable within the two audited files.

### DL-06: LOW — "Rows" column always shows em-dash (DEFERRED)

**Location:** `DataLineage.tsx` lines 202-204, 382
**Description:** Both the entity list table and the detail panel display a hardcoded em-dash for row counts. No row count data is available in the current data model.
**Reason deferred:** This is accurate behavior -- there is no row count data source to wire up. Removing the column would be a feature change, not a bug fix.

---

## Data Flow Verification

### API Calls

| # | Frontend Call | Backend Route | Data Source | Status |
|---|-------------|---------------|-------------|--------|
| 1 | `GET /api/entity-digest` | `get_entity_digest()` in `entities.py` | `lz_entities` + `entity_status` + bronze/silver entities | CORRECT |
| 2 | `GET /api/lineage/columns/{entityId}` | `get_lineage_columns()` in `lineage.py` | `lz_entities` + `bronze_entities` + `silver_entities` + `engine_task_log` + `column_metadata` cache + OneLake parquet | CORRECT |

### KPI Truth Check

| KPI | Computation | Source | Truthful? |
|-----|------------|--------|-----------|
| Total Entities | `allEntities.length` | Entity digest count | YES |
| Landing Zone | Filter `lzStatus === "loaded"` | entity_status-derived | YES |
| Bronze | Filter `bronzeStatus === "loaded"` | entity_status-derived | YES |
| Silver | Filter `silverStatus === "loaded"` | entity_status-derived | YES |
| Full Chain | All three statuses === "loaded" | entity_status-derived | YES |
| Coverage % | `(count / totalEntities) * 100` | Derived, guarded against div-by-zero | YES |

### Backend Validation Check

| Check | Status |
|-------|--------|
| entityId validated as integer | YES (line 275, HttpError 400 on failure) |
| SQL queries use parameterized `?` | YES (all 6 queries) |
| Entity not found returns 404 | YES (line 290) |
| No user input in file paths | YES (paths come from DB lookups) |
| Error handling on OneLake reads | YES (try/except in `_read_onelake_schema` and `_get_columns_for_layer`) |

### Frontend Error Handling

| Scenario | Handling |
|----------|---------|
| Digest loading | Shows "Loading entities..." in table body |
| No entities after filter | Shows "No entities found" |
| Column API non-200 | Shows `"API returned {status}"` error text |
| Column API invalid JSON | Shows "Invalid JSON response" |
| Column API network failure | Shows "Failed to load column data" |
| Abort on unmount | AbortController cleanup in useEffect |
| No column data available | Shows "No column data available. Run a load first to capture schema." |

---

## Deferred Items

| ID | Severity | Description | Reason |
|----|----------|-------------|--------|
| DL-05 | LOW | Hex opacity suffixes from shared LAYER_MAP | Colors defined in `layers.ts` (out of scope) |
| DL-06 | LOW | Rows column shows em-dash | No row count data source exists; accurate behavior |

---

## Verdict

**Page Status: FUNCTIONAL AND TRUTHFUL**

All KPIs are real, all statuses come from `entity_status`, column lineage correctly discovers schema from OneLake parquet files with SQLite caching. No fake data, no fabrication, no misleading labels. Four fixes applied (3 accessibility, 1 backend resilience). Two low-severity items deferred as out of scope.
