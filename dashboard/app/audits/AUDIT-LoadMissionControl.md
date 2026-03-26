# Load Mission Control — Truth Audit

**Date**: 2026-03-25
**Auditor**: true-falcon
**Page**: `/load-mission-control` -> `LoadMissionControl.tsx` (3,280 lines)
**Backend**: `/api/lmc/*` in `load_mission_control.py`, `/api/engine/*` in `engine.py` -> `engine/api.py`
**Supersedes**: `docs/AUDIT-LoadMissionControl.md` (2026-03-23, arctic-drift) — that audit referenced the OLD `LoadProgress.tsx` / `/api/load-progress` in `monitoring.py`, which has been fully replaced.

---

## 1. Architecture Summary

```
LoadMissionControl.tsx (3,280 lines, single-file)
  ├── ScopeProvider (React Context + useReducer)
  ├── 6 custom hooks: useRuns, useProgress, useEngineStatus, useEntities, useSSE, useSources
  ├── 15 components: CommandBand, KpiStrip, PhaseRail, SourceLayerMatrix,
  │     LiveTailTab, HistoryTab, EntitiesTab, TriageTab, InventoryTab,
  │     ContextPanel, ExtractionBadge, PipelineStack, StatusBadge, LoadMissionControlInner, LoadMissionControl
  └── Endpoints called:
        /api/lmc/sources              → load_mission_control.py
        /api/lmc/runs                 → load_mission_control.py
        /api/lmc/progress             → load_mission_control.py
        /api/lmc/run/{id}/entities    → load_mission_control.py
        /api/lmc/compare              → load_mission_control.py
        /api/lmc/entity-ids-by-source → load_mission_control.py
        /api/engine/status            → engine.py → engine/api.py
        /api/engine/start             → engine.py → engine/api.py
        /api/engine/stop              → engine.py → engine/api.py
        /api/engine/retry             → engine.py → engine/api.py
        /api/engine/resume            → engine.py → engine/api.py
        /api/engine/logs/stream (SSE) → engine.py → engine/api.py
```

**State management**: React Context + `useReducer` with 14 action types. Scope object tracks: selectedRunId, selectedSources, selectedLayers, selectedStatuses, selectedEntityId, searchQuery, activeTab, contextMode, contextOpen, engineStatus, isRunActive, runSources, entityPage.

**Data source**: ALL progress data comes from `engine_task_log` table (83K+ rows). Run metadata from `engine_runs`. Entity registration from `lz_entities` + `datasources`. Physical verification from `lakehouse_row_counts`.

---

## 2. Findings Table

| # | Severity | Category | Finding | File:Line | Status |
|---|----------|----------|---------|-----------|--------|
| 1 | LOW | Dead Code | `RunDetailResponse` interface defined (L162-169) but never used anywhere. Frontend never calls `/api/lmc/run/{run_id}` detail endpoint. | LMC.tsx:162 | Open |
| 2 | MODERATE | Unused Endpoint | `/api/lmc/run/{run_id}` (detail with layerSource, failures, loadTypes, watermarkUpdates, timeline) exists in backend but frontend only uses `/api/lmc/progress` + `/api/lmc/run/{id}/entities`. Rich per-run drill-down data is available but not rendered. | lmc.py:376 | Open |
| 3 | MODERATE | Unused Endpoint | `/api/lmc/entity/{entity_id}/history` exists in backend (entity across all runs, retries, watermark history) but frontend never calls it. ContextPanel shows only current-run entity data. | lmc.py:600+ | Open |
| 4 | LOW | Silent Failure | `handleStop` (L2841-2842) swallows all errors with empty catch. User gets no feedback if stop fails. | LMC.tsx:2841 | Open |
| 5 | LOW | Silent Failure | `handleRetry` (L2845-2854) swallows errors. User gets no feedback if retry fails. | LMC.tsx:2845 | Open |
| 6 | LOW | Silent Failure | `handleResume` (L2857-2866) swallows errors. User gets no feedback if resume fails. | LMC.tsx:2857 | Open |
| 7 | MODERATE | Missing Feature | `handleStart` (L2793) logs to console on failure but shows NO user-visible error toast/banner. If entity resolution fails or engine start returns non-OK, the user just sees... nothing happen. | LMC.tsx:2806-2808 | Open |
| 8 | HIGH | Missing Feature | No entity history drill-down. When user clicks an entity in the entities tab, ContextPanel shows current-run data only. No watermark history, no cross-run comparison, no retry count. Backend has `/api/lmc/entity/{id}/history` ready. | LMC.tsx:2469 | Open |
| 9 | MODERATE | Missing Feature | HistoryTab shows entity list from a single run (same as EntitiesTab). No run-over-run history view, no trend visualization. The "Extraction Performance" comparison section (Task 9) partially addresses this with run-pair comparison, but there's no run timeline/trend. | LMC.tsx:1727 | Open |
| 10 | LOW | UX | Error retry flow: `handleRetryErrorType` fetches up to 5,000 failed entities (L2905) then filters client-side by ErrorType. Should filter server-side via query param to avoid over-fetching. | LMC.tsx:2904 | Open |
| 11 | Info | Performance | 3,280-line single-file component. Not a bug, but maintenance cost is high. The file is well-organized with clear phase comments (§1-§11). | LMC.tsx | Info |
| 12 | Info | Architecture | `useProgress` polls every 3s during active runs, 15s when idle. `useEngineStatus` polls every 3s active, 10s idle. SSE stream provides real-time events independently. This means active runs generate ~1 req/s to the backend (progress + status combined). | LMC.tsx:335,360 | Info |
| 13 | MODERATE | Missing Feature | InventoryTab renders lakehouse state (tables with data, empty, scan failed, total rows/bytes) and per-source physical counts — but has no "refresh" action. User cannot trigger a lakehouse scan from LMC. Would need to call `/api/load-center/refresh`. | LMC.tsx:2316 | Open |
| 14 | LOW | Contract Gap | `ProgressResponse.lakehouseState` is typed as `Record<string, LakehouseLayerState>` but backend key names depend on lakehouse naming in DB. If lakehouse names change, frontend silently shows nothing. No validation or fallback for expected keys. | LMC.tsx:138 | Open |

---

## 3. Items Verified CORRECT

These are working end-to-end and should NOT be broken by future work:

| # | What | Verified How |
|---|------|-------------|
| V1 | **Scope enforcement** — `handleStart` resolves source names → entity_ids via `/api/lmc/entity-ids-by-source`, hard-fails on empty, passes `entity_ids` + `source_filter` + `resolved_entity_count` to `/api/engine/start` | Code review L2793-2839, proven in canary runs |
| V2 | **Source contract** — `SourceInfo { name, displayName, entityCount }` matches backend `/api/lmc/sources` exactly | Code review |
| V3 | **Progress contract** — `ProgressResponse` matches backend `/api/lmc/progress` response shape (run, layers, bySource, errorBreakdown, loadTypeBreakdown, throughput, verification, lakehouseState, lakehouseBySource) | Code review |
| V4 | **Entity contract** — `TaskEntity` matches backend `/api/lmc/run/{id}/entities` response shape including physical verification fields (lz/brz/slv_physical_rows, scanned_at) | Code review |
| V5 | **Engine status** — `EngineStatusResponse` matches backend `/api/engine/status` (status, current_run_id, last_run with worker_pid, worker_alive, heartbeat_at, current_layer, completed_units, resumable) | Code review |
| V6 | **SSE live feed** — `useSSE` connects to `/api/engine/logs/stream`, handles reconnect with exponential backoff (max 30s), processes `log`, `entity_result`, `run_complete`, `run_error` events | Code review L417-475 |
| V7 | **Scoped-run banner** — Shows when `runSources.length > 0` with source badges and "Show All Sources" clear button | Code review L2969-3001 |
| V8 | **Auto-run selection** — When engine starts running, auto-selects the active run ID and refetches run list | Code review L2763-2768 |
| V9 | **Watermark strategy telemetry** — `ExtractionMethod` written to `engine_task_log`, visible in entity drill-down | Proven in Fix 2 canary |
| V10 | **Run comparison** — `/api/lmc/compare` endpoint wired to frontend History tab with side-by-side stats, speedup ratio, matched entity durations | Code review L2746-2787 |
| V11 | **Matrix cell click** — Clicking a Source×Layer cell filters entities tab to that source+layer combination | Code review L266-272 |
| V12 | **Pagination** — Entities tab uses server-side pagination (limit=100, offset from entityPage) | Code review L2870-2878 |

---

## 4. API Contract Audit

### Endpoints Called by Frontend

| Endpoint | Method | Frontend Hook | Backend Handler | Contract Match? |
|----------|--------|---------------|----------------|----------------|
| `/api/lmc/sources` | GET | `useSources` | `get_lmc_sources` | MATCH |
| `/api/lmc/runs` | GET | `useRuns` | `get_lmc_runs` | MATCH (frontend uses subset) |
| `/api/lmc/progress?run_id=X` | GET | `useProgress` | `get_lmc_progress` | MATCH |
| `/api/lmc/run/{id}/entities` | GET | `useEntities` | `get_lmc_run_entities` | MATCH |
| `/api/lmc/compare` | GET | inline effect | `get_lmc_compare` | MATCH |
| `/api/lmc/entity-ids-by-source` | GET | `handleStart` | `get_entity_ids_by_source` | MATCH |
| `/api/engine/status` | GET | `useEngineStatus` | `_handle_status` | MATCH |
| `/api/engine/start` | POST | `handleStart` | `_handle_start` | MATCH |
| `/api/engine/stop` | POST | `handleStop` | `_handle_stop` | MATCH |
| `/api/engine/retry` | POST | `handleRetry/RetryEntity/RetryErrorType` | `_handle_retry` | MATCH |
| `/api/engine/resume` | POST | `handleResume` | `_handle_resume` | MATCH |
| `/api/engine/logs/stream` | SSE | `useSSE` | `_handle_logs_stream` | MATCH |

### Backend Endpoints NOT Called by Frontend

| Endpoint | What It Provides | Potential Value |
|----------|-----------------|-----------------|
| `/api/lmc/run/{id}` | Full run detail: layerSource matrix, failures, loadTypes, watermarkUpdates, timeline | Run drill-down page, failure analysis |
| `/api/lmc/entity/{id}/history` | Entity across all runs, watermark progression, retry detection | Entity deep-dive panel |
| `/api/engine/plan` | Dry-run plan (read-only) | Pre-launch preview ("what WOULD run?") |
| `/api/engine/health` | Preflight connectivity checks | Pre-run diagnostics |
| `/api/engine/metrics` | Aggregated metrics (slowest entities, top errors, per-layer breakdown) | Performance dashboard |
| `/api/engine/entity/{id}/reset` | Reset entity watermark | Self-service watermark management |
| `/api/engine/validation` | Cross-layer entity status audit | Validation checklist |
| `/api/load-center/refresh` | Trigger lakehouse physical scan | Inventory refresh action |

---

## 5. Data Source Audit

All data flows use **real queries against real tables**. No stubs, no hardcoded data, no mocks.

| UI Section | Data Source | Real? | Notes |
|-----------|------------|-------|-------|
| Command Band (run selector, actions) | `/api/lmc/runs` + `/api/engine/status` | REAL | |
| KPI Strip (entities, rows, bytes, duration, throughput) | `/api/lmc/progress` → `engine_task_log` GROUP BY | REAL | |
| Phase Rail (LZ→Bronze→Silver progress) | `/api/lmc/progress` → `layers` dict | REAL | |
| Source×Layer Matrix | `/api/lmc/progress` → `bySource` + `layers` + `lakehouseBySource` | REAL | |
| Live Tail tab | `/api/engine/logs/stream` SSE | REAL | |
| History tab | `/api/lmc/run/{id}/entities` (same data as Entities) | REAL | |
| Entities tab | `/api/lmc/run/{id}/entities` with server-side pagination/filtering | REAL | |
| Triage tab | `/api/lmc/progress` → `errorBreakdown` | REAL | |
| Inventory tab | `/api/lmc/progress` → `verification` + `lakehouseState` + `lakehouseBySource` | REAL | |
| Context Panel (entity details) | Client-side from entities array | REAL (single-run only) | |
| Run Comparison | `/api/lmc/compare` | REAL | |
| Empty state ("Ready to Go") | Static content | N/A | Appropriate |

---

## 6. Repair Sequence (Priority-Ordered)

Findings that should be addressed, grouped by dependency:

### Priority A: User Feedback on Actions (Findings #4, #5, #6, #7)
All action handlers swallow errors silently. Users click buttons and nothing happens when things fail. Add toast/banner notifications for success and failure of start/stop/retry/resume.

### Priority B: Entity History Drill-Down (Findings #2, #3, #8)
Backend has `/api/lmc/run/{id}` and `/api/lmc/entity/{id}/history` ready. Wire ContextPanel to show:
- Cross-run history for selected entity
- Watermark progression
- Retry count
- Full error detail with suggestion

### Priority C: Server-Side Error Filtering (Finding #10)
Add `error_type` query param to `/api/lmc/run/{id}/entities` to avoid fetching 5,000 entities client-side for error-type retry.

### Priority D: Inventory Refresh Action (Finding #13)
Add "Refresh Scan" button to InventoryTab that calls `/api/load-center/refresh`.

### Priority E: Dead Code Cleanup (Finding #1)
Remove unused `RunDetailResponse` interface.
