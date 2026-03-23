# AUDIT-CP: Control Plane Page Audit

**Date**: 2026-03-23
**Frontend**: `dashboard/app/src/pages/ControlPlane.tsx` (778 lines)
**Backend**: `dashboard/app/api/routes/control_plane.py` (lines 406-409 `/api/control-plane`)
**Backend**: `dashboard/app/api/routes/source_manager.py` (lines 1142-1174 `/api/load-config`)
**Endpoints called by page**: `/api/control-plane`, `/api/load-config`, `/api/entity-digest/resync`, `/api/maintenance-agent/trigger`

---

## Summary Table

| # | Category | Finding | Severity | Status |
|---|----------|---------|----------|--------|
| 1 | Hardcoded hex | `#1C1917` in h1 title — should be `var(--bp-ink-primary)` | Low | FIXED |
| 2 | Token compliance | `--font-display` used instead of `--bp-font-display` | Low | FIXED |
| 3 | Dead code | `Shield` imported from lucide-react but never used | Low | FIXED |
| 4 | Honesty | "Last Load" column always shows "never" — `/api/load-config` never returns `lastLoadTime` | Medium | FIXED (column removed) |
| 5 | Dead code | `lastLoadTime` and `lastWatermarkValue` in `EntityMeta` interface — never populated by API | Low | FIXED (fields removed) |
| 6 | Honesty | "DEV + PROD split: N each" hardcodes `Math.ceil(total/2)` — fabricated split | Medium | FIXED (replaced with inactive count) |
| 7 | Error handling | Maintenance button calls `/api/entity-digest/resync` and `/api/maintenance-agent/trigger` — neither endpoint exists. `fetch().json()` on a 404 HTML response throws parse error | High | FIXED (added response.ok checks) |
| 8 | Accessibility | Search input, source filter select, auto-refresh checkbox missing `aria-label` | Low | FIXED |
| 9 | Empty states | Metadata tab: no message when entity list is empty (no error, just blank table) | Low | FIXED |
| 10 | Empty states | Connections tab: no message when `activeSources` is empty | Low | FIXED |
| 11 | Backend | Lakehouse DEV/PROD classification hardcoded as `LakehouseId <= 3` — fragile magic number | Medium | NOTED (TODO comment added) |
| 12 | Backend | `_SOURCE_COLORS` array contains hardcoded hex values (`#3b82f6`, etc.) | Low | Deferred — shared route |

---

## Detailed Findings

### F1: Hardcoded hex color `#1C1917` (FIXED)

**Line 303**: `color: "#1C1917"` in the page title `<h1>`.
This value is identical to `--bp-ink-primary` defined in `index.css`.
**Fix**: Replaced with `var(--bp-ink-primary)`.

### F2: Non-standard font token (FIXED)

**Line 303**: `fontFamily: "var(--font-display)"` uses the legacy CSS variable.
The design system defines `--bp-font-display` as the canonical token.
**Fix**: Replaced with `var(--bp-font-display)`.

### F3: Unused import `Shield` (FIXED)

**Line 13**: `Shield` is imported from `lucide-react` but never referenced in the component.
**Fix**: Removed from import list.

### F4-5: Phantom "Last Load" column (FIXED)

The `EntityMeta` interface declared `lastLoadTime` and `lastWatermarkValue` fields, and the table rendered a "Last Load" column. However, the `/api/load-config` endpoint query does not JOIN `entity_status` and never returns these fields. Every entity showed "never" regardless of actual load history.

**Fix**: Removed the two dead interface fields and the "Last Load" table column. If load times are needed, the backend query must be updated to JOIN `entity_status.LoadEndDateTime`.

### F6: Fabricated pipeline split (FIXED)

**Line 720**: Displayed "DEV + PROD split: {Math.ceil(total/2)} each" — this assumes pipelines are evenly split between environments, which is not derived from any data.

**Fix**: Replaced with an "Inactive" count that shows `total - active` when they differ. This uses real data.

### F7: Maintenance button calls nonexistent endpoints (FIXED)

`runMaintenanceAgent()` POSTs to:
- `/api/entity-digest/resync` — does not exist in any route file
- `/api/maintenance-agent/trigger` — does not exist in any route file

Both return 404 HTML pages. The original code called `.json()` on the response without checking `response.ok`, causing a JSON parse error that masked the real issue.

**Fix**: Added `response.ok` checks before parsing JSON. Errors now show the HTTP status instead of crashing.

**Note**: These endpoints need to be implemented for the Maintenance button to be functional. Currently it will always show "404 Not Found" status messages.

### F8: Missing aria-labels (FIXED)

Added `aria-label` attributes to:
- Auto-refresh checkbox
- Entity search input
- Data source filter select dropdown

### F9-10: Missing empty states (FIXED)

- **Metadata tab**: Added empty state for when no entities are loaded (distinct from filter-no-match)
- **Connections tab**: Added empty state for when no active sources exist

### F11: Lakehouse DEV/PROD magic number (NOTED)

**control_plane.py line 176**: `env = "DEV" if lh_id <= 3 else "PROD"` uses a hardcoded integer threshold. This is fragile — if lakehouse IDs change during redeployment, the classification breaks silently.

**Fix**: Added a TODO comment. A proper fix would use a name-based convention (e.g., lakehouses with "DEV" in the name) or an explicit `Environment` column in the lakehouses table.

### F12: Backend hardcoded hex colors in `_SOURCE_COLORS` (Deferred)

**control_plane.py lines 425-435**: The `_SOURCE_COLORS` array contains hardcoded hex values and Tailwind class strings. This palette is used by `/api/source-config` which serves multiple pages (not just Control Plane).

**Deferred — shared route**: This palette is consumed by `useSourceConfig` hook across multiple pages. Changing it here could affect other pages.

---

## Not Found (Clean)

| Check | Result |
|-------|--------|
| SQL injection in backend | No user input reaches SQL in `/api/control-plane`; `/api/load-config` uses parameterized queries |
| Hardcoded source counts | None found — UI scales to N sources via `.map()` |
| Fake data / stub responses | None — all data comes from SQLite queries |
| `rgba()` colors | None found |
