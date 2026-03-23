# AUDIT-LM: Live Monitor Page Audit

**Files**: `dashboard/app/src/pages/LiveMonitor.tsx`, `dashboard/app/api/routes/monitoring.py`
**Audited**: 2026-03-23
**Previous audit**: 2026-03-13 (many issues from that audit have since been fixed in the codebase)

---

## Summary

8 findings across frontend and backend. 6 fixed, 2 deferred.

---

## Findings

### LM-01 | CRITICAL | "All time" filter returns zero results | FIXED
- **Location**: `monitoring.py` lines 58-87
- **Description**: When the user selects "All time" from the dropdown, the frontend sends `minutes=0`. The backend constructs `WHERE LogDateTime >= datetime('now', '-0 minutes')` which equals `datetime('now')` — returning only events from this exact second, effectively zero results. The "All time" option is broken.
- **Fix**: When `minutes <= 0`, skip the WHERE time filter entirely so all rows are returned (still limited by LIMIT clause).

### LM-02 | HIGH | Hardcoded hex colors throughout LiveMonitor.tsx | FIXED
- **Location**: `LiveMonitor.tsx` — 20+ inline style occurrences
- **Description**: Colors like `#1C1917`, `#78716C`, `#A8A29E`, `#57534E`, `#EDEAE4`, `#FEFDFB`, `#F9F7F3`, `#B93A2A`, `#3D7C4F`, `#C27A1A`, `#B45624`, `#FBEAE8`, `rgba(0,0,0,0.04)` used instead of design tokens. This breaks theme consistency and prevents centralized color changes.
- **Fix**: Replaced all hex/rgba values with corresponding `var(--bp-*)` design tokens: `--bp-ink-primary`, `--bp-ink-secondary`, `--bp-ink-tertiary`, `--bp-ink-muted`, `--bp-canvas`, `--bp-surface-1`, `--bp-surface-inset`, `--bp-copper`, `--bp-caution`, `--bp-operational`, `--bp-fault`, `--bp-fault-light`, `--bp-border-subtle`.

### LM-03 | MEDIUM | Missing accessibility on collapsible sections | FIXED
- **Location**: `LiveMonitor.tsx` — 6 CardHeader elements
- **Description**: All 6 collapsible sections (Pipeline Runs, Entity Progress, Notebooks, Copy Activity, Bronze, Landing Zone) use `onClick` on CardHeader but lack `role="button"`, `aria-expanded`, `tabIndex`, and keyboard navigation. Screen readers cannot identify them as interactive, and keyboard users cannot toggle them.
- **Fix**: Added `role="button"`, `tabIndex={0}`, `aria-expanded={expandedSections.<key>}`, and `onKeyDown` handler (Enter/Space) to all 6 section headers.

### LM-04 | MEDIUM | Missing aria-label on time window select | FIXED
- **Location**: `LiveMonitor.tsx` line 362
- **Description**: The time window `<select>` dropdown has no `aria-label` or associated `<label>` element.
- **Fix**: Added `aria-label="Time window filter"`.

### LM-05 | MEDIUM | Bronze entity duration always zero | FIXED
- **Location**: `monitoring.py` lines 115-125
- **Description**: The `bronzeEntities` query aliased both `InsertDateTime` and `LoadEndDateTime` from the same column (`t.created_at`), so the frontend's duration calculation (`LoadEndDateTime - InsertDateTime`) always yields 0s.
- **Fix**: Changed `LoadEndDateTime` to compute from `created_at + DurationSeconds` when DurationSeconds is available, otherwise NULL.

### LM-06 | LOW | Unused computed variable `nbStarts` | FIXED
- **Location**: `LiveMonitor.tsx` line 315
- **Description**: `nbStarts` (count of StartNotebookActivity events) is computed but never rendered or referenced.
- **Fix**: Removed the unused variable.

### LM-07 | LOW | Missing count fields from backend | DEFERRED
- **Location**: `monitoring.py` lines 102-109
- **Description**: Frontend reads `lzPipelineTotal`, `brzPipelineTotal`, `slvPipelineTotal`, `brzViewPending`, `slvViewPending` from the counts response. Backend does not return these fields. The frontend's `num()` helper silently defaults them to 0, so "Queued" and "Pending" labels always show 0.
- **Reason for deferral**: These fields have no clear data source in the current engine architecture. The old `pipeline_lz_entity` / `pipeline_bronze_entity` tables (which would have fed "queued" counts) are empty and deprecated. Adding fabricated counts would be worse than showing 0. This should be addressed when the engine provides a proper "in-queue" tracking mechanism.

### LM-08 | LOW | Copy events duplicate column alias | DEFERRED
- **Location**: `monitoring.py` line 81
- **Description**: The copy events query selects `CopyActivityName` twice: once as itself and once as `EntityName`. While harmless (SQLite handles this fine and the frontend uses `EntityName`), it's redundant.
- **Reason for deferral**: Cosmetic SQL issue with zero user impact. Not worth the risk of a change in an audit pass.

---

## Cross-file observations for other audit agents

### For AUDIT-LP (LoadProgress)
- `/api/load-progress` endpoint (monitoring.py lines 537-596) uses a CTE with `ROW_NUMBER() OVER (PARTITION BY ...)` on `engine_task_log` — verify this works correctly when there are multiple runs for the same entity.
- The `overall.lzLoaded` sums both `landing` and `landingzone` layer keys — confirm the engine consistently uses one or the other.

### For AUDIT-IP (ImpactPulse)
- No ImpactPulse-specific endpoints found in `monitoring.py`. If ImpactPulse uses `/api/executive` or `/api/error-intelligence`, note that both endpoints are in this file.
- `/api/executive` (line 603) inserts a health_trend_snapshot on every GET request — this means each page load creates a DB row. Could cause table growth if polled frequently.

### General monitoring.py note
- `/api/error-intelligence` (line 318) and `/api/stats` (line 495) are not LiveMonitor endpoints — they were NOT modified in this audit. Previous audit B7/B8 noted these had wrong table names, but the current code appears to have been fixed since then (uses correct table names now).
