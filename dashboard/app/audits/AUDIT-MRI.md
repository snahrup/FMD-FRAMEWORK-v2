# AUDIT: MRI.tsx (Machine Regression Intelligence)

**File**: `dashboard/app/src/pages/MRI.tsx` (380 lines)
**Audited**: 2026-03-13
**Verdict**: BACKEND MISSING — all 11 API endpoints referenced by `useMRI` hook have no backend implementation

---

## Page Overview

MRI is a comprehensive testing dashboard with 5 tabs (Overview, Visual, Backend, Swarm, History). It provides visual screenshot diffing, backend API testing, AI analysis, flake detection, and baseline management. The page itself is fully built but entirely dependent on a backend that does not exist.

---

## Data Sources

### 1. useMRI Hook — 11 API Endpoints (ALL MISSING)

| Endpoint | Method | Purpose | Backend Status |
|----------|--------|---------|----------------|
| `/api/mri/runs` | GET | List all MRI run entries | **404 — no route** |
| `/api/mri/status` | GET | Check if scan is active | **404 — no route** |
| `/api/mri/runs/{runId}/convergence` | GET | Iteration convergence data | **404 — no route** |
| `/api/mri/runs/{runId}/visual-diffs` | GET | Screenshot diff results | **404 — no route** |
| `/api/mri/runs/{runId}/backend-results` | GET | API test results | **404 — no route** |
| `/api/mri/runs/{runId}/ai-analyses` | GET | AI analysis annotations | **404 — no route** |
| `/api/mri/runs/{runId}/flake-results` | GET | Flake detection results | **404 — no route** |
| `/api/mri/runs/{runId}/iteration/{n}` | GET | Single iteration detail | **404 — no route** |
| `/api/mri/baselines` | GET | Baseline screenshots | **404 — no route** |
| `/api/mri/baselines/{testName}` | POST | Accept a new baseline | **404 — no route** |
| `/api/mri/baselines/accept-all` | POST | Accept all baselines | **404 — no route** |
| `/api/mri/run` | POST | Trigger a new MRI scan | **404 — no route** |
| `/api/mri/api-tests/run` | POST | Trigger backend API tests | **404 — no route** |

**Verification**: Searched all files in `dashboard/app/api/routes/` and `dashboard/app/api/server.py` — no MRI routes exist. Also searched `server.py.bak` — no MRI routes there either. This is a frontend-only feature awaiting backend implementation.

---

## Frontend Components (fully built, no data)

| Component | Tab | Purpose |
|-----------|-----|---------|
| `UnifiedKPIRow` | Overview | KPI cards for test counts, visual diffs, AI risk |
| `CoverageHeatmap` | Overview | Test coverage matrix |
| `AIAnnotationCard` | Overview, Visual | AI risk analysis cards |
| `ScreenshotGallery` | Overview, Visual | Thumbnail grid of screenshots |
| `VisualDiffViewer` | Visual | Side-by-side/overlay screenshot comparison |
| `BaselineManager` | Visual | Accept/reject baseline screenshots |
| `FlakeGraph` | Visual | Flake detection graph |
| `BackendTestPanel` | Backend | API test result table |
| `TestSwarm` (lazy) | Swarm | Autonomous fix loop |
| `CrossBranchCompare` | History | Cross-branch run comparison |

---

## Error Handling

The `useMRI` hook handles missing backend gracefully:
- `fetchTopLevel()` catches errors and sets `error` state → displayed as a red banner
- `fetchRunDetail()` catches errors silently (partial data is accepted)
- Individual component arrays (`visualDiffs`, `backendResults`, etc.) stay as empty arrays
- The page renders but shows empty states for all data-dependent sections

---

## SQLite Tables Used

None. MRI does not query the control plane SQLite database at all. It has its own separate (unimplemented) data model stored via the MRI API endpoints.

---

## Issues Found

### CRITICAL: Entire MRI backend is missing

- **All 13 API endpoints** referenced by `useMRI` hook have no backend handlers
- The page renders but shows an error banner and empty data everywhere
- This is clearly a planned feature with a fully built frontend awaiting backend implementation
- **No data correctness issue per se** — there is simply no data to be correct or incorrect about

---

## Summary

MRI is a complete frontend implementation with zero backend support. All 13 API endpoints return 404. The page handles this gracefully (error banner + empty states), but the feature is non-functional. This appears to be a deliberate development sequence: frontend first, backend later. No incorrect data is displayed — the page simply has nothing to show.
