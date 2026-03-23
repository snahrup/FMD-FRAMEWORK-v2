# AUDIT-PR: Pipeline Runner Page Audit

**Audited**: 2026-03-23
**Files**: `dashboard/app/src/pages/PipelineRunner.tsx`, `dashboard/app/api/routes/pipeline.py`

---

## Summary

14 findings across both files. 10 fixed in this PR, 4 deferred.

The most critical fix was the entity endpoint returning wrong column names (no JOINs to bronze/silver, PascalCase instead of camelCase), which made the entire entity drill-down table non-functional. All hardcoded hex colors (50+) were replaced with `var(--bp-*)` design tokens. Accessibility improvements added (aria-labels, keyboard navigation, table roles). Backend input sanitization added to all Fabric API-facing parameters.

---

## Findings

### PR-01 | CRITICAL | Entity endpoint column mismatch + missing JOINs | FIXED

**File**: `pipeline.py` `get_runner_entities()`
**Problem**: Backend returned raw SQLite column names (`LandingzoneEntityId`, `SourceSchema`, `IsActive`) but frontend expects camelCase (`lzEntityId`, `sourceSchema`, `lzActive`). Additionally, no JOINs to `bronze_entities` or `silver_entities` -- bronze/silver columns were always `undefined`.
**Impact**: Entity table showed blank names, broken selection, all status icons wrong.
**Fix**: Rewrote query with proper `AS` aliases and `LEFT JOIN` to bronze_entities and silver_entities.

### PR-02 | HIGH | Unsanitized GUIDs in Fabric API URLs | FIXED

**File**: `pipeline.py` multiple routes
**Problem**: `workspaceGuid`, `pipelineGuid`, `jobInstanceId`, and `pipelineName` parameters were passed directly into Fabric REST API URLs without sanitization in `get_pipeline_activity_runs`, `get_pipeline_run_snapshot`, `get_pipeline_failure_trace`, `sse_pipeline_stream`, and `post_pipeline_trigger`. The `_sanitize()` helper existed but was unused on these routes.
**Impact**: Potential URL injection via crafted GUID parameters.
**Fix**: Applied `_sanitize()` to all user-supplied parameters that are interpolated into URLs.

### PR-03 | HIGH | Missing input validation on prepare endpoint | FIXED

**File**: `pipeline.py` `post_runner_prepare()`
**Problem**: `dataSourceIds` array elements not validated as integers. `entityIds` not validated. `layer` not validated against allowed values.
**Impact**: Could pass arbitrary types/values into runner state.
**Fix**: Added type checking, integer coercion, and layer allowlist validation.

### PR-04 | MEDIUM | 50+ hardcoded hex colors | FIXED

**File**: `PipelineRunner.tsx`
**Problem**: Colors like `#B45624`, `#78716C`, `#F9F7F3`, `#1C1917`, `#A8A29E`, `#3D7C4F`, `#C27A1A`, `#B93A2A`, `#F4E8DF`, `#FEFDFB`, `#EDEAE4`, and multiple `rgba()` values were hardcoded instead of using `var(--bp-*)` design tokens.
**Fix**: Replaced all with corresponding tokens: `--bp-copper`, `--bp-ink-tertiary`, `--bp-surface-inset`, `--bp-ink-primary`, `--bp-ink-muted`, `--bp-operational`, `--bp-caution`, `--bp-fault`, `--bp-copper-light`, `--bp-surface-1`, `--bg-muted`, `--bp-border`, `--bp-border-subtle`, `--bp-border-strong`, `--bp-copper-soft`.

### PR-05 | MEDIUM | Missing accessibility: aria-labels, keyboard nav, roles | FIXED

**File**: `PipelineRunner.tsx`
**Problem**: Source card buttons had no `aria-pressed` or `aria-label`. Entity table rows were click-only with no keyboard support. Table lacked `role="grid"` and `aria-label`. Status icons had no `aria-label`. Search input had no `aria-label`. Decorative checkboxes not marked `aria-hidden`.
**Fix**: Added `aria-pressed`/`aria-label` to source cards, `tabIndex={0}`/`onKeyDown` (Enter/Space) to entity rows, `role="grid"` and `aria-label` on table, `scope="col"` on headers, `aria-label` on status icons and search input, `aria-hidden` on decorative checkbox indicators.

### PR-06 | MEDIUM | Unused imports | FIXED

**File**: `PipelineRunner.tsx`
**Problem**: `ChevronDown` and `ChevronUp` imported from lucide-react but never used.
**Fix**: Removed both imports.

### PR-07 | MEDIUM | Missing empty state for sources | FIXED

**File**: `PipelineRunner.tsx`
**Problem**: When no data sources exist (empty `sources` array), the page shows an empty grid with no explanation.
**Fix**: Added empty state with Database icon and helpful message.

### PR-08 | MEDIUM | Entity endpoint error message too terse | FIXED

**File**: `pipeline.py` `get_runner_entities()`
**Problem**: Error message "dataSourceId is required" didn't mention the integer constraint.
**Fix**: Changed to "dataSourceId is required and must be a positive integer".

### PR-09 | CRITICAL | Prepare endpoint is a no-op -- no entity deactivation | DEFERRED

**File**: `pipeline.py` `post_runner_prepare()`
**Problem**: The handler records scope in memory but never runs SQL to deactivate out-of-scope entities. `kept`, `affected`, `deactivated` are always zero/empty. The "safe scoped execution" promise is hollow.
**Reason deferred**: Implementing actual entity deactivation requires careful SQL UPDATEs to `lz_entities`, `bronze_entities`, `silver_entities` with rollback safety. High-risk change that could deactivate production entities if done incorrectly. Needs its own PR with thorough testing.

### PR-10 | CRITICAL | Restore endpoint is a no-op -- no entity reactivation | DEFERRED

**File**: `pipeline.py` `post_runner_restore()`
**Problem**: Resets in-memory state but never runs SQL to re-activate entities. Paired with PR-09.
**Reason deferred**: Must be implemented alongside PR-09. Cannot be done safely in isolation.

### PR-11 | MEDIUM | Running state shows all zeros | DEFERRED

**File**: `pipeline.py` `post_runner_prepare()`
**Problem**: On the "Scoped Run Active" screen, "Entities In Scope" and "Temporarily Deactivated" always show 0/0/0 because prepare never computes actual counts.
**Reason deferred**: Depends on PR-09 being implemented first. The counts will naturally become correct once prepare actually performs deactivation.

### PR-12 | LOW | RunPoller threads never cleaned up | DEFERRED

**File**: `pipeline.py` `_run_pollers` dict
**Problem**: Completed `_RunPoller` instances are never removed from `_run_pollers`. Over time, this accumulates stale poller objects in memory.
**Reason deferred**: Low impact (pollers are daemon threads, small memory footprint). Cleanup logic would add complexity for minimal gain. Would need a TTL-based eviction or explicit cleanup on final event.

### PR-13 | LOW | deploy-pipelines returns 501 stub | INFO

**File**: `pipeline.py` `post_deploy_pipelines()`
**Observation**: Returns a 501 "not yet migrated" error. This is intentional per the code comment (avoids circular imports with server.py). Not a bug, but noted for completeness. Frontend does not call this endpoint.

### PR-14 | LOW | Entity table `onMouseEnter`/`onMouseLeave` inline style manipulation | INFO

**File**: `PipelineRunner.tsx`
**Observation**: Entity table rows use inline `onMouseEnter`/`onMouseLeave` handlers to set `backgroundColor` via `ev.currentTarget.style`. This works but is a non-standard pattern vs CSS `:hover`. Not fixing because it's functional and changing it would be a style refactor.

---

## Deferred Items Summary

| ID | Severity | Reason |
|----|----------|--------|
| PR-09 | CRITICAL | Entity deactivation is high-risk; needs own PR with testing |
| PR-10 | CRITICAL | Paired with PR-09; cannot be done independently |
| PR-11 | MEDIUM | Depends on PR-09 |
| PR-12 | LOW | Minimal impact, cleanup adds complexity |

---

## Files Modified

| File | Changes |
|------|---------|
| `dashboard/app/src/pages/PipelineRunner.tsx` | Replaced 50+ hardcoded hex/rgba colors with design tokens, added aria-labels and keyboard navigation, added empty state, removed unused imports |
| `dashboard/app/api/routes/pipeline.py` | Fixed entity endpoint query (JOINs + aliases), sanitized all URL-interpolated params, added input validation on prepare endpoint |
