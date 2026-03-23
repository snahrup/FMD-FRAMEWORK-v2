# AUDIT-LP: LoadProgress.tsx

**Date**: 2026-03-23
**Auditor**: Claude (Opus)
**Frontend**: `dashboard/app/src/pages/LoadProgress.tsx`
**Backend**: `GET /api/load-progress` in `dashboard/app/api/routes/monitoring.py`
**Status**: FIXES APPLIED

---

## Executive Summary

The Load Progress page had a critical API response shape mismatch: the backend endpoint (implemented since the last audit) returns `{sources, recentRuns, overall: {totalEntities, lzLoaded, brzLoaded, slvLoaded}}` but the frontend expected `{overall: {TotalEntities, LoadedEntities, PendingEntities, PctComplete, ...}, bySource: [...], recentActivity: [...], loadedEntities: [...]}`. All progress indicators rendered zeroes or empty states because every field name was wrong.

Additionally: hardcoded hex colors instead of design tokens, a hardcoded 5-column grid violating N-source scalability rules, missing loading state, a fabricated schema default, missing ARIA attributes, and a dead import.

---

## Findings

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| LP-01 | **CRITICAL** | API response shape mismatch: frontend types (`TotalEntities`, `LoadedEntities`, `bySource`, etc.) do not match backend fields (`totalEntities`, `lzLoaded`, `sources`, etc.). All progress data rendered as zero/empty. | **FIXED** — Added `adaptApiResponse()` that maps the real backend shape to the frontend `LoadData` type |
| LP-02 | **HIGH** | Backend does not provide `recentActivity`, `loadedEntities`, or `concurrencyTimeline` data. The Live Activity feed, All Entities table, and Concurrency Timeline chart can never show data. | **DEFERRED** — Needs monitoring.py changes to add these queries. Frontend now correctly shows empty states. |
| LP-03 | **MEDIUM** | 20+ hardcoded hex colors (`#57534E`, `#A8A29E`, `#78716C`, `#FEFDFB`, `#F9F7F3`, `#EDEAE4`, `#1C1917`, `rgba(0,0,0,0.08)`) instead of design tokens. | **FIXED** — All replaced with `var(--bp-ink-secondary)`, `var(--bp-ink-muted)`, `var(--bp-ink-tertiary)`, `var(--bp-surface-1)`, `var(--bp-surface-inset)`, `var(--bg-muted)`, `var(--bp-ink-primary)`, `var(--bp-border)` |
| LP-04 | **MEDIUM** | Source progress cards use `xl:grid-cols-5`, hardcoding 5 sources. Violates Rule 12 (scale to N sources). | **FIXED** — Replaced with `grid-template-columns: repeat(auto-fill, minmax(200px, 1fr))` |
| LP-05 | **MEDIUM** | No loading state — page shows blank content during initial fetch. | **FIXED** — Added loading spinner with "Loading progress data..." message |
| LP-06 | **LOW** | Schema column shows fabricated "dbo" when no schema is present (`e.Schema \|\| "dbo"`) — a truth bug. | **FIXED** — Changed to show em dash when schema is absent |
| LP-07 | **LOW** | Tab bar missing `role="tablist"`, `role="tab"`, and `aria-selected` attributes. | **FIXED** — Added proper ARIA tab attributes |
| LP-08 | **LOW** | Unused import: `HardDrive` from lucide-react, never referenced in JSX. | **FIXED** — Removed from import |
| LP-09 | **LOW** | `pendingBySource` field in `LoadData` interface is populated but never rendered anywhere. Dead data. | NOTED — No fix needed, harmless |
| LP-10 | **LOW** | `recentlyLoaded` animation logic (lines ~270-278) slices from the front of `loadedEntities` assuming newest-first sort. Fragile assumption if backend sort order changes. | NOTED — Not causing issues currently since `loadedEntities` is always empty |

---

## Deferred Items (require monitoring.py changes)

### LP-02: Missing backend data for activity/entities/timeline

The backend `/api/load-progress` endpoint only returns:
- Per-source entity counts and LZ/Bronze/Silver loaded counts
- Recent engine runs
- Overall totals

It does NOT return:
- `recentActivity` (recent copy activity events with table names, log types, timestamps)
- `loadedEntities` (per-entity detail: schema, table, rows copied, duration, status)
- `concurrencyTimeline` (time-bucketed concurrent thread counts)

The frontend has full UI for all three sections (activity feed, entity table, concurrency chart), but they will always render empty states until the backend is enhanced.

**Recommendation**: Add these queries to the `/api/load-progress` handler in monitoring.py:
1. `recentActivity` from `copy_activity_audit` joined to `lz_entities`/`datasources`
2. `loadedEntities` from `lz_entities` LEFT JOIN `engine_task_log` for status/rows/duration
3. `concurrencyTimeline` from time-bucketed `copy_activity_audit` events

### AUDIT-LM Handoff Items

From the LiveMonitor audit:

1. **ROW_NUMBER CTE correctness**: The `ROW_NUMBER() OVER (PARTITION BY EntityId, Layer ORDER BY created_at DESC)` CTE at line 551-555 of monitoring.py correctly partitions by both EntityId AND Layer, then picks `rn = 1`. This means for multiple runs of the same entity on the same layer, only the latest run's status is used. This is correct behavior for "current status" semantics.

2. **`landing` vs `landingzone` layer key**: Line 568 uses `LOWER(es_lz.Layer) IN ('landing','landingzone')` to handle both variants. Line 599 in the overall counts does `status_map.get("landing", 0) + status_map.get("landingzone", 0)`. Both correctly handle the inconsistency. The frontend adapter passes this through faithfully.

---

## Files Modified

- `dashboard/app/src/pages/LoadProgress.tsx` — All fixes applied (LP-01, LP-03 through LP-08)

## Files NOT Modified (read-only)

- `dashboard/app/api/routes/monitoring.py` — LP-02 deferred
