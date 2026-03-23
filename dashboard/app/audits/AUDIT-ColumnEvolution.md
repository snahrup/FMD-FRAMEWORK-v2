# AUDIT: ColumnEvolution

**Audited:** 2026-03-23 (supersedes stale 2026-03-13 audit)
**File:** `dashboard/app/src/pages/ColumnEvolution.tsx` (~1018 lines)
**Backend route:** `dashboard/app/api/routes/monitoring.py` — `get_entity_journey()` (line 835)
**Hooks:** `useEntityDigest` from `@/hooks/useEntityDigest.ts`

---

## BACKEND DEPENDENCY INVESTIGATION

### Does `/api/journey` exist?

**YES. The endpoint exists and is fully functional.**

- **Location:** `dashboard/app/api/routes/monitoring.py`, line 835: `@route("GET", "/api/journey")`
- **Handler:** `get_entity_journey(params: dict) -> dict`
- **Tests:** `dashboard/app/api/tests/test_routes_monitoring.py` has 3 tests covering param validation and 404

### Response shape matches frontend expectations

The previous audit (2026-03-13) flagged a CRITICAL mismatch between the backend response shape and the frontend `JourneyData` interface. **This has been fixed.** The endpoint now returns a structured response that exactly matches the frontend's `JourneyData` type:

```python
# monitoring.py returns (lines 991-1047):
{
    "entityId": int,
    "source": { "schema", "name", "dataSourceName", "dataSourceType", "namespace", "connectionName", "connectionType" },
    "landing": { "entityId", "fileName", "filePath", "onelakeSchema", "fileType", "lakehouse", "isIncremental", "incrementalColumn", "customSelect", "customNotebook" },
    "bronze": { "entityId", "schema", "onelakeSchema", "name", "primaryKeys", "fileType", "lakehouse", "rowCount", "columns": ColumnInfo[], "columnCount" } | null,
    "silver": { "entityId", "schema", "onelakeSchema", "name", "fileType", "lakehouse", "rowCount", "columns": ColumnInfo[], "columnCount" } | null,
    "gold": null,
    "schemaDiff": [ { "columnName", "inBronze", "inSilver", "bronzeType", "silverType", "bronzeNullable", "silverNullable", "status" } ],
    "lastLoadValues": [...]
}
```

The endpoint:
- Queries SQLite for entity metadata across `lz_entities`, `datasources`, `connections`, `bronze_entities`, `silver_entities`, `lakehouses`, `watermarks`
- Fetches column data via `lineage.py` helpers (`_get_columns_for_layer`)
- Computes `schemaDiff` by comparing Bronze and Silver column lists
- Includes row counts from `lakehouse_row_counts` cache

### Page functional status: FULLY FUNCTIONAL

All features work end-to-end:
- Entity selector loads entity list via `/api/entity-digest`
- Journey data loads via `/api/journey` with correct response shape
- Column grid displays Bronze and Silver columns with type icons
- Schema diff badges (NEW, REMOVED, TYPE_CHANGED, SYSTEM) render correctly
- Layer stepper with auto-play works
- Gold layer shows honest "coming soon" placeholder

**No backend packet needed.** The previous audit's critical findings (F1-F5) are all resolved.

---

## Issues Found

### F1. LOW — Hardcoded hex colors in LAYERS and TYPE_ICON_MAP (lines 40-94)

**Problem:** ~35 hex color values that correspond to BP design tokens. For example:
- `#B45624` = `var(--bp-copper)`
- `#3D7C4F` = `var(--bp-operational)`
- `#C27A1A` = `var(--bp-caution)`
- `#F4E8DF` = `var(--bp-copper-light)`

**Mitigating factor:** These hex values are used in JavaScript objects for programmatic inline styles, including string concatenation like `${layer.color}12` (appending alpha). CSS `var()` cannot be used in JS string interpolation contexts. The pattern is common across the codebase and all values match their BP token counterparts exactly.

**Recommendation:** Accept as-is. Converting would require `getComputedStyle()` at runtime, adding complexity for no visual benefit. If the design system ever changes token values, a global find/replace of the hex codes will work.

### F2. LOW — Connector line used raw rgba() (line 428) [FIXED]

**Problem:** `rgba(128,128,128,0.15)` used for inactive connector lines between layer steps.
**Fix applied:** Replaced with `var(--bp-border-subtle)`.

### F3. LOW — Missing aria-labels on interactive elements [FIXED]

**Problem:** Multiple buttons lacked accessible labels:
- Auto-play toggle button
- Layer step buttons
- Entity selector search input
- Clear selection button
- Refresh button

**Fix applied:** Added `aria-label` to all interactive elements. Added `aria-current="step"` to the active layer button.

### F4. LOW — Error state was minimal (lines 903-908) [FIXED]

**Problem:** Error state showed just `{error}` text with an icon. No way to retry, and the generic "API 404" message was not user-friendly.

**Fix applied:** Enhanced error state with:
- Larger icon and "Failed to load column schema" heading
- Error detail in muted text below
- Retry button that re-fetches the journey data

### F5. INFO — `onelakeSchema` field returned by backend but not in frontend type

The backend returns `onelakeSchema` on `landing`, `bronze`, and `silver` objects. The frontend `JourneyData` type does not declare `onelakeSchema` on `landing`. This is harmless (TypeScript just ignores unknown fields), but the type could be tightened.

### F6. INFO — `lastLoadValues` returned by backend but unused by ColumnEvolution

The backend returns `lastLoadValues` (watermark history) which ColumnEvolution does not consume. This is shared with DataJourney which does use it. No action needed.

---

## Frontend Logic Review

| Function | Logic | Correct? |
|----------|-------|----------|
| `buildDisplayColumns(data, 0/1)` | Source/LZ: Bronze columns minus system columns | YES |
| `buildDisplayColumns(data, 2)` | Bronze: all columns, mark BRONZE_SYSTEM_COLUMNS as "system" | YES |
| `buildDisplayColumns(data, 3)` | Silver: annotate from schemaDiff, then append bronze_only as "removed" | YES |
| `computeDiffSummary()` | Count added/removed/typeChanged between previous and current | YES |
| `getMaxLayerIndex()` | Returns 3 if silver, 2 if bronze, 1 otherwise | YES |
| `SYSTEM_COLUMNS` sets | Match actual FMD pipeline output | YES |
| Auto-play interval | 2s loop through reachable layers | YES |
| `diffName()` helper | Handles both `columnName` and `column` field names | YES |

---

## Mock / Hardcoded Data Check

| Item | Status |
|------|--------|
| Entity list | LIVE from `/api/entity-digest` |
| Journey data | LIVE from `/api/journey` |
| Column schemas | LIVE from lineage helpers (cached lakehouse column data) |
| Schema diff | LIVE computed by backend from Bronze vs Silver columns |
| Layer definitions | HARDCODED `LAYERS` array (cosmetic, correct) |
| System column names | HARDCODED sets matching actual FMD pipeline column names |
| Gold layer | Placeholder ("coming soon") -- correct, Gold not yet wired |
| Auto-play timing | 2000ms interval (cosmetic) |

---

## Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 0 | Previous audit's critical findings (F1-F5) have all been resolved |
| LOW | 4 | Hardcoded hex (accepted), rgba connector (fixed), missing aria-labels (fixed), minimal error state (fixed) |
| INFO | 2 | Extra backend fields not in TS types, unused `lastLoadValues` |

**Bottom line:** The page is fully functional. The backend `/api/journey` endpoint exists, returns the correct structured response, and all frontend features work as designed. The previous audit's critical findings about shape mismatches and missing column data have been resolved since 2026-03-13. Fixes applied: better error handling with retry, aria-labels, and one hardcoded rgba replaced with a BP token.

**No follow-up backend packet needed.**
