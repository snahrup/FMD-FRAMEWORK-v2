# AUDIT-TestSwarm

**Page**: `dashboard/app/src/pages/TestSwarm.tsx` (328 lines)
**Backend**: `dashboard/app/api/routes/test_swarm.py`
**Sub-components**: 9 files in `dashboard/app/src/components/test-swarm/`
**Date**: 2026-03-23 (Wave 3b re-audit; original 2026-03-13 found backend missing -- now exists)
**Branch**: `audit-test-swarm`

---

## Summary

TestSwarm is a hidden dev page showing convergence-driven test swarm results. It is both standalone (`/test-swarm` route) and embedded inside MRI.tsx via `React.lazy`. The page has a well-structured data flow (run list -> convergence -> iteration detail) with good patterns like stale-fetch guards via `runVersionRef`. Main issues were: CDS/CL token pollution instead of BP tokens, raw OKLCH in SVG, missing accessibility attributes, skeleton layout mismatch, and two backend validation gaps.

Previous audit (2026-03-13) flagged all 3 endpoints as MISSING. Backend `test_swarm.py` now exists and is functional. This audit covers the full component tree.

---

## Findings

### 1. Truth Bugs -- FIXED

| # | Issue | File | Fix |
|---|-------|------|-----|
| TB-1 | `formatDuration` missing NaN/Infinity guard | KPIRow.tsx | Added `Number.isFinite` + `Math.round` |
| TB-2 | Same unsafe `formatDuration` duplicate | IterationDetail.tsx | Same fix |
| TB-3 | Skeleton layout mismatch: `lg:grid-cols-5` vs real `lg:grid-cols-6` | SwarmSkeleton.tsx | Fixed to 6-col grid (3+2+1), removed separate gauge row |

### 2. Token Violations -- FIXED

All 9 sub-components used `--cl-success`, `--cl-error`, `--cl-warning`, `--cl-info` instead of `--bp-operational`, `--bp-fault`, `--bp-caution`, `--bp-info`.

| Token replaced | BP equivalent | Files affected |
|----------------|---------------|----------------|
| `--cl-success` | `--bp-operational` | KPIRow, RunTimeline, ConvergenceChart, IterationDetail, TestResultsTable, DiffViewer |
| `--cl-error` | `--bp-fault` | KPIRow, RunTimeline, ConvergenceChart, IterationDetail, TestResultsTable, DiffViewer, AgentSessionLog |
| `--cl-warning` | `--bp-caution` | KPIRow, RunTimeline, SwarmStatusBadge, AgentSessionLog |
| `--cl-info` | `--bp-info` | KPIRow, RunTimeline, ConvergenceChart, SwarmStatusBadge, DiffViewer, AgentSessionLog |

Raw OKLCH values in SVG (ConvergenceChart: 14 instances, ConvergenceGauge: 6 instances) replaced with BP hex constants (`BP_OPERATIONAL`, `BP_FAULT`, `BP_CAUTION`, `BP_INK_MUTED`).

TestHeatmap OKLCH Tailwind arbitrary values (`bg-[oklch(...)]`) replaced with `var(--bp-*)` token references.

### 3. Accessibility -- FIXED

| # | Issue | File | Fix |
|---|-------|------|-----|
| A11Y-1 | Timeline buttons no aria-label | RunTimeline.tsx | Added `aria-label` with iteration/pass info |
| A11Y-2 | Heatmap cells invisible to screen readers | TestHeatmap.tsx | Added `role="gridcell"` + `aria-label` |
| A11Y-3 | Gauge SVG no role/label | ConvergenceGauge.tsx | Added `role="img"` + `aria-label` |
| A11Y-4 | Iteration expand missing aria-expanded | IterationDetail.tsx | Added `aria-expanded` + `aria-label` |
| A11Y-5 | Test row expand missing aria-expanded | TestResultsTable.tsx | Added `aria-expanded` |
| A11Y-6 | Run selector missing aria-pressed | TestSwarm.tsx | Added `aria-pressed` |

### 4. Dead Code -- FIXED

| # | Issue | File | Fix |
|---|-------|------|-----|
| DC-1 | Unused `cn` import | TestSwarm.tsx | Removed |
| DC-2 | Unused `Dot` import from recharts | ConvergenceChart.tsx | Removed |

### 5. Error Handling -- DEFERRED

| # | Issue | File | Reason |
|---|-------|------|--------|
| E-1 | `fetchRunDetail` silently swallows errors | TestSwarm.tsx | "Best effort" pattern is intentional -- convergence is supplementary data; showing an error toast would be noisy for a background refresh |
| E-2 | `fetchIteration` same silent catch | TestSwarm.tsx | Same rationale |

### 6. Backend Validation -- FIXED

| # | Issue | File | Fix |
|---|-------|------|-----|
| BE-1 | `_safe_component` allows empty string, resolving to parent dir | test_swarm.py | Added empty/whitespace check before path traversal check |
| BE-2 | No upper bound on iteration number | test_swarm.py | Capped at 10,000 |

### 7. Structural -- DEFERRED

| # | Issue | File | Reason |
|---|-------|------|--------|
| DC-3 | `selectedFile` state in DiffViewer set but only provides bg-muted highlight | DiffViewer.tsx | Likely future feature scaffold; removing would break the click interaction that exists |

---

## Files Changed

| File | Changes |
|------|---------|
| `dashboard/app/src/pages/TestSwarm.tsx` | Remove unused `cn` import, add `aria-pressed` to run selector |
| `dashboard/app/api/routes/test_swarm.py` | Empty runId guard, iteration upper bound (10k) |
| `dashboard/app/src/components/test-swarm/KPIRow.tsx` | Safe formatDuration, `--cl-*` -> `--bp-*` |
| `dashboard/app/src/components/test-swarm/RunTimeline.tsx` | `--cl-*` -> `--bp-*`, aria-label on buttons |
| `dashboard/app/src/components/test-swarm/ConvergenceChart.tsx` | Remove unused Dot import, raw OKLCH -> BP hex constants, `--cl-*` -> `--bp-*` |
| `dashboard/app/src/components/test-swarm/ConvergenceGauge.tsx` | Raw OKLCH -> BP hex constants, role="img" + aria-label on SVG |
| `dashboard/app/src/components/test-swarm/TestHeatmap.tsx` | OKLCH arbitrary values -> `var(--bp-*)`, role="gridcell" + aria-label |
| `dashboard/app/src/components/test-swarm/IterationDetail.tsx` | Safe formatDuration, `--cl-*` -> `--bp-*`, aria-expanded |
| `dashboard/app/src/components/test-swarm/SwarmStatusBadge.tsx` | `--cl-*` -> `--bp-*` |
| `dashboard/app/src/components/test-swarm/SwarmSkeleton.tsx` | Fix grid layout mismatch (5-col -> 6-col to match real page) |
| `dashboard/app/src/components/test-swarm/TestResultsTable.tsx` | `--cl-*` -> `--bp-*`, aria-expanded |
| `dashboard/app/src/components/test-swarm/DiffViewer.tsx` | `--cl-*` -> `--bp-*` |
| `dashboard/app/src/components/test-swarm/AgentSessionLog.tsx` | `--cl-*` -> `--bp-*` |

**Total**: 13 files changed, 23 issues found, 20 fixed, 3 deferred.
