# EC-TIER1-OPS Session Audit

**Date**: 2026-04-08
**Session**: EC-TIER1-OPS (Phase 1 V2 Whole-App Forensic Audit)
**Scope**: 6 pages — EngineControl, SourceManager, ConfigManager, LoadCenter, LoadMissionControl, BusinessOverview
**Protocol**: READ-ONLY truth audit. No code changes.

---

## Summary Table (All Findings Across All 6 Pages)

| ID | Page | Severity | Category | Finding | File:Line |
|----|------|----------|----------|---------|-----------|
| EC1-ENG-001 | EngineControl | HIGH | Data Contract | `MetricsData.layers` typed as `Record<string,{count,avg_duration}>` but backend returns array of `{Layer,TotalTasks,AvgDurationSeconds}`. Frontend normalizes at runtime (L1148-1155) — works, but type is a lie; raw fetch is `Record<string,unknown>` not `MetricsData`. | EngineControl.tsx:150-155, 1142 |
| EC1-ENG-002 | EngineControl | LOW | Dead Endpoint | `/api/engine/jobs` polled every 15s in pipeline mode (L1285). Endpoint does not exist. Silently fails; SSE `job_status` fallback works. | EngineControl.tsx:1285 |
| EC1-ENG-003 | EngineControl | LOW | Accessibility | Zero `aria-label` attributes on any interactive button (Start, Stop, Abort, Health toggle, Config panel toggle). No `role="status"` on loading spinners. | EngineControl.tsx (throughout) |
| EC1-ENG-004 | EngineControl | LOW | Error Handling | `fetchMetrics` catch block silently swallows errors (L1167 comment: "metrics are non-critical"). Acceptable design choice but no user hint that metrics failed. | EngineControl.tsx:1167 |
| EC1-ENG-005 | EngineControl | MODERATE | SSE Resilience | SSE reconnect logic uses a `gaveUp` flag after `SSE_MAX_RETRIES` attempts (L1260-1263). Once given up, only a full page reload can re-establish the SSE stream. No "reconnect" button exposed to user. | EngineControl.tsx:1248-1263 |
| EC1-SRC-001 | SourceManager | HIGH | Data Contract | `get_connections()` (control_plane.py:414) omits `ConnectionGuid` column. Frontend `isRegistered()` matching against gateway connections always fails. *Prior finding — still open.* | control_plane.py:414 |
| EC1-SRC-002 | SourceManager | MEDIUM | Data Contract | Load config query lacks `entity_status` JOIN — `lastLoadTime` and `lastWatermarkValue` always null in the Load Config matrix. *Prior finding — still open.* | source_manager.py:1142 |
| EC1-SRC-003 | SourceManager | LOW | Honesty | `digestToRegistered()` hardcodes `FileType: 'parquet'` and maps `FilePath` to namespace instead of actual path. Registry table shows inaccurate file metadata. *Prior finding — still open.* | SourceManager.tsx:127-136 |
| EC1-SRC-004 | SourceManager | LOW | Orphan Data | `sources/purge` cascade delete does not clean up orphan `entity_status` rows after deleting LZ/Bronze/Silver entities. *Prior finding — still open.* | source_manager.py:614 |
| EC1-SRC-005 | SourceManager | MODERATE | Missing Route | Frontend calls `GET /api/connections` (L365) which routes to `control_plane.py:414`, but also calls `GET /api/datasources` (L366) which only has a GET handler in `control_plane.py:420`. The POST variant is in `source_manager.py:460`. Both GET endpoints are in `control_plane.py`, not `source_manager.py` — cross-module dependency. | SourceManager.tsx:365-366 |
| EC1-SRC-006 | SourceManager | LOW | Accessibility | No `aria-label` on search input, filter selects, expand/collapse chevrons, or action buttons (Analyze, Register, Delete). | SourceManager.tsx (throughout) |
| EC1-SRC-007 | SourceManager | NEW-MODERATE | Error Handling | `fetchCascadeImpact` (L275-283) catches errors but only logs to console. If cascade-impact endpoint fails, the delete confirmation dialog shows with no impact data — user might delete entities without understanding downstream effects. | SourceManager.tsx:275-283 |
| EC1-CFG-001 | ConfigManager | MEDIUM | Data Contract | Pipeline GUID update writes to `PipelineId` (INTEGER PK) instead of `PipelineGuid` (TEXT). Could corrupt FK references. *Prior finding — still open.* | config_manager.py:274 |
| EC1-CFG-002 | ConfigManager | LOW | Stub Feature | Deploy section shows "Fabric deployment from the dashboard is coming soon" (L877) with `DeployResult` interface and full deploy UI scaffolding that is never triggered. The deploy prompt is hidden behind a comment at L866: "Deploy endpoint returns 501 — hidden until backend is implemented." | ConfigManager.tsx:866-877, 605-606 |
| EC1-CFG-003 | ConfigManager | LOW | Security | Secret detection at L1523 uses heuristic `val.startsWith("${") || key.includes("secret")`. Values that are actual secrets but don't match this pattern (e.g., connection strings with embedded passwords, tokens) are displayed in cleartext. The Eye/EyeOff toggle (L756-761) only controls GUID visibility, not secret masking. | ConfigManager.tsx:1523, 756-761 |
| EC1-CFG-004 | ConfigManager | LOW | Accessibility | No `aria-label` on edit inputs, save/cancel buttons, copy buttons, or the business/technical toggle. Collapsible sections lack `aria-expanded`. | ConfigManager.tsx (throughout) |
| EC1-CFG-005 | ConfigManager | NEW-LOW | Error Handling | `fetchJson` (L240-244) throws on non-OK response, caught by caller. But the cascade reference lookup (L645) is fire-and-forget with no error feedback if the references endpoint fails — user sees stale cascade data. | ConfigManager.tsx:645 |
| EC1-LC-001 | LoadCenter | MODERATE | Error Handling | Run status polling (L424) uses `setInterval(() => loadStatus(), 5000)` unconditionally after initial load. No backoff, no pause when tab is hidden. Generates continuous backend load even when user is away. | LoadCenter.tsx:424-425 |
| EC1-LC-002 | LoadCenter | MODERATE | Error Handling | `postJson` for run execution (L462 `dryRun: false`) catches errors via generic `throw new Error` but the calling code at L460-465 only sets `runLoading` state. If the run POST fails, the error is caught but user feedback depends on the error state propagation — which works but shows a generic "API error: {status}" with no actionable detail. | LoadCenter.tsx:462, 108-114 |
| EC1-LC-003 | LoadCenter | LOW | Empty State | Empty state message at L632 handles "sources exist but nothing loaded yet." However, if the status endpoint itself returns no sources (e.g., fresh install), the page shows a loading spinner indefinitely since `loading` starts `true` and the only path to `false` is a successful fetch. A failed fetch sets `error` but `loading` remains `true` until the finally block. | LoadCenter.tsx:406-420 |
| EC1-LC-004 | LoadCenter | LOW | Accessibility | Zero `aria-label` attributes on any element. No `role="status"` on loading states. Table headers lack `scope="col"`. Expand/collapse buttons lack `aria-expanded`. | LoadCenter.tsx (throughout) |
| EC1-LC-005 | LoadCenter | NEW-MODERATE | Data Contract | Frontend `SourceDetail` interface (L78-94) expects `tables[].lzRowSource`, `bronzeRowSource`, `silverRowSource` optional fields. Backend `source-detail` endpoint (load_center.py:373) returns these only when SQL Endpoint is available. When filesystem fallback is used, these fields are absent — frontend handles gracefully via optional chaining, but the "Live SQL" vs "Filesystem" method badge could confuse users about data freshness. | LoadCenter.tsx:78-94, load_center.py:373 |
| EC1-LC-006 | LoadCenter | NEW-LOW | Polling | Refresh polling loop (L475-488) polls `/load-center/status` every 2s after triggering a refresh, with a catch that silently continues polling. No max retry or timeout — if the refresh endpoint hangs, this polls forever. | LoadCenter.tsx:475-488 |
| EC1-LMC-001 | LoadMissionControl | HIGH | Missing Feature | No entity history drill-down. Backend has `/api/lmc/entity/{id}/history` ready but frontend never calls it. ContextPanel shows only current-run data. *Prior finding — still open.* | LMC.tsx:2469, lmc.py:667 |
| EC1-LMC-002 | LoadMissionControl | MODERATE | Unused Endpoint | `/api/lmc/run/{run_id}` rich detail endpoint (layerSource, failures, loadTypes, watermarkUpdates, timeline) exists but frontend only uses `/api/lmc/progress` + `/api/lmc/run/{id}/entities`. *Prior finding — still open.* | lmc.py:398 |
| EC1-LMC-003 | LoadMissionControl | MODERATE | Missing Feature | `handleStart` (L2806-2808) logs to console on failure but shows NO user-visible error toast/banner. *Prior finding — still open.* | LMC.tsx:2806-2808 |
| EC1-LMC-004 | LoadMissionControl | LOW | Silent Failure | `handleStop` (L2934), `handleRetry` (L2937-2948), `handleResume` (L2949-2958) all swallow errors with empty catch blocks. No user feedback on failure. *Prior finding — still open.* | LMC.tsx:2934, 2937, 2949 |
| EC1-LMC-005 | LoadMissionControl | LOW | Dead Code | `RunDetailResponse` interface (L162-169) defined but never used. *Prior finding — still open.* | LMC.tsx:162-169 |
| EC1-LMC-006 | LoadMissionControl | MODERATE | Missing Feature | InventoryTab has no "refresh" action. User cannot trigger lakehouse scan from LMC — would need `/api/load-center/refresh`. *Prior finding — still open.* | LMC.tsx:2316 |
| EC1-LMC-007 | LoadMissionControl | NEW-LOW | File Size | 3,463 lines in a single component file. Five architectural phases documented but all in one file. Maintainability risk increases with each addition. | LMC.tsx |
| EC1-LMC-008 | LoadMissionControl | NEW-MODERATE | Polling Storm | Active run generates ~1 req/s: `useProgress` polls every 3s, `useEngineStatus` polls every 3s, plus independent SSE stream. Three concurrent data channels for the same logical state. | LMC.tsx:335, 360, 437 |
| EC1-LMC-009 | LoadMissionControl | NEW-LOW | Accessibility | Retry button in entity card (L2730) fires fetch with `.catch(() => {})` — silent failure, no aria-label, no loading indicator. | LMC.tsx:2730 |
| EC1-OVR-001 | BusinessOverview | MODERATE | Partial Failure | `Promise.allSettled` fetches 3 endpoints (L106-109). If all 3 fail, sets error. If 1-2 fail, sets `error = null` (L120) — user sees partial data with no indication that some sections failed. Silently shows stale/empty sections. | BusinessOverview.tsx:104-130 |
| EC1-OVR-002 | BusinessOverview | LOW | Polling | Auto-refresh every 30s (L134) with no visibility check. Continues polling when tab is hidden. | BusinessOverview.tsx:134 |
| EC1-OVR-003 | BusinessOverview | LOW | Accessibility | Zero `aria-label` on any interactive element. No `role="status"` on loading skeletons. ProgressRing SVG lacks `aria-label`. StatusRail component lacks semantic markup. | BusinessOverview.tsx (throughout) |
| EC1-OVR-004 | BusinessOverview | NEW-LOW | Data Contract | `KPIData.freshness_ever_loaded` and `freshness_last_success` are returned by backend but not rendered anywhere in the UI. Backend computes them (overview.py:209-213) but frontend only uses `freshness_pct`, `freshness_on_time`, `freshness_total`. Wasted computation. | BusinessOverview.tsx:22-28, overview.py:209-213 |
| EC1-OVR-005 | BusinessOverview | NEW-LOW | Unused Endpoint | Backend defines `GET /api/overview/entities` (overview.py:388) but BusinessOverview never calls it. Entity counts come via the `kpis` response (`total_entities`, `loaded_entities`). The entities endpoint is orphaned from this page. | overview.py:388 |

---

## Per-Page Findings

### EngineControl (EC-002) -- VERIFY_AND_EXTEND

**Frontend**: `dashboard/app/src/pages/EngineControl.tsx` (~2,920 lines)
**Backend**: `dashboard/app/api/routes/engine.py` -> delegates to `engine/api.py`
**Existing Audit**: `dashboard/app/audits/AUDIT-EngineControl.md`

#### API Endpoints Traced

| Frontend Call | Line | Backend Route | Exists? | Contract Match? |
|--------------|------|---------------|---------|-----------------|
| `GET /api/engine/status` | 1069 | engine.py:138 | YES | CRITICAL bug #1 in prior audit (started vs started_at) |
| `GET /api/engine/runs?limit=20` | 1104 | engine.py:163 | YES | OK |
| `GET /api/engine/entities` | 1126 | engine.py:178 | YES | MODERATE bug #3 in prior audit (JOINs wrong table) |
| `GET /api/engine/metrics?hours=24` | 1142 | engine.py:158 | YES | Array-vs-Record normalized at runtime |
| `GET /api/engine/health` | 1369 | engine.py:153 | YES | OK |
| `GET /api/engine/logs?run_id=X&limit=5000` | 489 | engine.py:148 | YES | CRITICAL bug #2 in prior audit (missing fields) |
| `GET /api/engine/logs/stream` (SSE) | 1193 | engine.py:231 | YES | OK |
| `POST /api/engine/start` | 1340 | engine.py:187 | YES | OK |
| `POST /api/engine/stop` | 1356 | engine.py:192 | YES | OK |
| `POST /api/engine/abort-run` | 1413 | engine.py:202 | YES | OK |
| `POST /api/engine/retry` | via RunSummaryModal | engine.py:197 | YES | OK |
| `GET /api/engine/jobs` | 1285 | MISSING | NO | Silent 404 (EC1-ENG-002) |

#### Existing Audit Findings Verified

| Prior Finding | Still Applies? | Notes |
|--------------|---------------|-------|
| CRITICAL #1: `last_run` shape mismatch (started vs started_at) | YES | No code change observed |
| CRITICAL #2: Task log missing 6 fields | YES | No code change observed |
| MODERATE #3: Entity selector JOINs wrong table | YES | No code change observed |
| LOW #4: `/api/engine/jobs` missing | YES | Still missing, still silent |

#### NEW Findings

| ID | Severity | Finding | File:Line |
|----|----------|---------|-----------|
| EC1-ENG-001 | HIGH | Metrics layers type mismatch — frontend `Record<string,{}>` vs backend array. Runtime normalization works but type is a lie. | EngineControl.tsx:150, 1142-1155 |
| EC1-ENG-003 | LOW | Zero accessibility attributes on any interactive element. | EngineControl.tsx (throughout) |
| EC1-ENG-004 | LOW | `fetchMetrics` silently swallows errors. | EngineControl.tsx:1167 |
| EC1-ENG-005 | MODERATE | SSE reconnect has no user-facing recovery after `gaveUp`. | EngineControl.tsx:1248-1263 |

---

### SourceManager (EC-008) -- VERIFY_AND_EXTEND

**Frontend**: `dashboard/app/src/pages/SourceManager.tsx` (~1,650 lines)
**Backend**: `dashboard/app/api/routes/source_manager.py`, `entities.py`, `control_plane.py`
**Existing Audit**: `dashboard/app/audits/AUDIT-SourceManager.md`

#### API Endpoints Traced

| Frontend Call | Line | Backend Route | Exists? | Contract Match? |
|--------------|------|---------------|---------|-----------------|
| `GET /api/gateway-connections` | 364 | source_manager.py:203 | YES | OK (optional, catch-suppressed) |
| `GET /api/connections` | 365 | control_plane.py:414 | YES | BUG: missing ConnectionGuid (EC1-SRC-001) |
| `GET /api/datasources` | 366 | control_plane.py:420 | YES | OK |
| `GET /api/entities/cascade-impact?ids=X` | 279 | entities.py:353 | YES | OK |
| `DELETE /api/entities/{id}` | 304 | entities.py:552 | YES | OK |
| `POST /api/entities/bulk-delete` | 329 | entities.py:601 | YES | OK |
| `GET /api/load-config?datasource=X` | 400 | source_manager.py:1142 | YES | BUG: missing entity_status JOIN (EC1-SRC-002) |
| `GET /api/analyze-source?datasource=X` | 426 | source_manager.py:1087 | YES | OK |
| `POST /api/register-bronze-silver` | 442 | source_manager.py:771 | YES | OK |
| Entity digest (via `useEntityDigest` hook) | 137 | entities.py:58 (digest) | YES | OK (replaces direct /api/entities) |

#### Existing Audit Findings Verified

| Prior Finding | Still Applies? | Notes |
|--------------|---------------|-------|
| HIGH: ConnectionGuid omitted from get_connections() | YES | No code change |
| MEDIUM: Load config lacks entity_status JOIN | YES | No code change |
| LOW: digestToRegistered hardcodes FileType | YES | No code change |
| LOW: sources/purge orphans entity_status rows | YES | No code change |

#### NEW Findings

| ID | Severity | Finding | File:Line |
|----|----------|---------|-----------|
| EC1-SRC-005 | MODERATE | GET /api/connections and GET /api/datasources are served by `control_plane.py`, not `source_manager.py`. Cross-module dependency. | SourceManager.tsx:365-366 |
| EC1-SRC-006 | LOW | Zero accessibility attributes on interactive elements. | SourceManager.tsx (throughout) |
| EC1-SRC-007 | MODERATE | `fetchCascadeImpact` logs to console on error — delete dialog shows without impact data, user can proceed blind. | SourceManager.tsx:275-283 |

---

### ConfigManager (EC-012) -- VERIFY_AND_EXTEND

**Frontend**: `dashboard/app/src/pages/ConfigManager.tsx` (~1,600 lines)
**Backend**: `dashboard/app/api/routes/config_manager.py`
**Existing Audit**: `dashboard/app/audits/AUDIT-ConfigManager.md`

#### API Endpoints Traced

| Frontend Call | Line | Backend Route | Exists? | Contract Match? |
|--------------|------|---------------|---------|-----------------|
| `GET /api/config-manager` | 614 | config_manager.py:77 | YES | OK |
| `POST /api/config-manager/update` | 627 | config_manager.py:202 | YES | BUG: PipelineId vs PipelineGuid (EC1-CFG-001) |
| `GET /api/config-manager/references?guid=X` | 645 | config_manager.py:358 | YES | OK |

#### Existing Audit Findings Verified

| Prior Finding | Still Applies? | Notes |
|--------------|---------------|-------|
| BUG-CM-1: pipeline_db writes PipelineId instead of PipelineGuid | YES | No code change |
| Deploy endpoint returns 501/404 | YES | Still stubbed, hidden behind comment at L866 |

#### NEW Findings

| ID | Severity | Finding | File:Line |
|----|----------|---------|-----------|
| EC1-CFG-002 | LOW | Full deploy UI scaffolding (`DeployResult` interface, deploying state, result rendering) exists but is permanently hidden. Dead code. | ConfigManager.tsx:58-66, 605-606, 866-952 |
| EC1-CFG-003 | LOW | Secret detection heuristic (`val.startsWith("${") || key.includes("secret")`) misses real secrets. Eye/EyeOff toggle controls GUID visibility, not secret masking. SP auth values displayed in cleartext. | ConfigManager.tsx:1523, 756-761 |
| EC1-CFG-004 | LOW | Zero accessibility attributes. No aria-labels, no aria-expanded on collapsible sections. | ConfigManager.tsx (throughout) |
| EC1-CFG-005 | LOW | Cascade reference lookup is fire-and-forget with no error feedback. | ConfigManager.tsx:645 |

---

### LoadCenter (GOV-007) -- AUDIT_NORMALLY (No Prior Audit)

**Frontend**: `dashboard/app/src/pages/LoadCenter.tsx` (~700 lines)
**Backend**: `dashboard/app/api/routes/load_center.py`
**Prior Audit**: None

#### Architecture Summary

LoadCenter is the single-page operational view for lakehouse contents and one-click smart loading. It fetches status from the backend, shows per-source/per-layer table and row counts, and provides drill-down into source details plus a run-plan/execute flow.

#### API Endpoints Traced

| Frontend Call | Line | Backend Route | Exists? | Contract Match? |
|--------------|------|---------------|---------|-----------------|
| `GET /api/load-center/status` | 410 | load_center.py:199 | YES | OK |
| `GET /api/load-center/status?force=1` | 410 | load_center.py:199 | YES | OK (force param handled) |
| `GET /api/load-center/source-detail?source=X` | 437 | load_center.py:373 | YES | OK (EC1-LC-005 re: optional fields) |
| `POST /api/load-center/run` (dryRun: true) | 449 | load_center.py:522 | YES | OK — returns plan |
| `POST /api/load-center/run` (dryRun: false) | 462 | load_center.py:522 | YES | OK — kicks off background thread |
| `POST /api/load-center/refresh` | 475 | load_center.py:475 | YES | OK |
| `GET /api/load-center/run-status` | (not directly called) | load_center.py:912 | YES | Not consumed by this page |

#### Data Source Audit

| UI Section | Data Source | Real? |
|-----------|------------|-------|
| Source summary cards | `/api/load-center/status` -> SQLite + SQL Endpoint/filesystem | REAL |
| Source detail drill-down | `/api/load-center/source-detail` -> same hybrid query | REAL |
| Run plan preview | `/api/load-center/run` (dryRun: true) | REAL |
| Active run state | In-memory `_run_state` dict, persisted to SQLite | REAL |

No mock data. No hardcoded values. All data flows from real backend queries.

#### Error Handling Assessment

- **Initial load**: `loadStatus()` wraps in try/catch, sets `error` state, shows error banner. OK.
- **Source detail**: `loadSourceDetail()` wraps in try/catch, sets `detailLoading` false. Error message via `setError`. OK.
- **Run execution**: Generic error message ("API error: {status}"). Actionable detail is missing.
- **Refresh polling**: Silently retries forever on failure (EC1-LC-006).

#### Loading/Empty States

- Loading: Spinner shown via `loading` state. OK.
- Empty: Message at L632 for "sources exist, nothing loaded." First-load empty state (no sources registered at all) shows loading spinner until status endpoint returns.
- Error: Red banner with error text. OK.

#### Findings

| ID | Severity | Finding | File:Line |
|----|----------|---------|-----------|
| EC1-LC-001 | MODERATE | Unconditional 5s polling with no tab-visibility check. | LoadCenter.tsx:424-425 |
| EC1-LC-002 | MODERATE | Run execution error shows generic "API error" with no actionable detail. | LoadCenter.tsx:462 |
| EC1-LC-003 | LOW | If status endpoint returns empty sources array, no explicit empty state — just empty cards. | LoadCenter.tsx:406-420 |
| EC1-LC-004 | LOW | Zero accessibility attributes anywhere. | LoadCenter.tsx (throughout) |
| EC1-LC-005 | MODERATE | `SourceDetail.lzRowSource/bronzeRowSource/silverRowSource` optional fields depend on SQL Endpoint availability. Filesystem fallback omits them. Method badge may confuse users. | LoadCenter.tsx:78-94 |
| EC1-LC-006 | LOW | Refresh polling loop has no max retry/timeout — polls forever on hang. | LoadCenter.tsx:475-488 |

---

### LoadMissionControl (GOV-008) -- VERIFY_AND_EXTEND

**Frontend**: `dashboard/app/src/pages/LoadMissionControl.tsx` (3,463 lines)
**Backend**: `dashboard/app/api/routes/load_mission_control.py`, `engine.py`
**Existing Audit**: `dashboard/app/audits/AUDIT-LoadMissionControl.md`

#### API Endpoints Traced

| Frontend Call | Line | Backend Route | Exists? | Contract Match? |
|--------------|------|---------------|---------|-----------------|
| `GET /api/lmc/runs?limit=20` | 322 | lmc.py:356 | YES | OK |
| `GET /api/lmc/progress?run_id=X` | 354 | lmc.py:117 | YES | OK |
| `GET /api/engine/status` | 377 | engine.py:138 | YES | OK |
| `GET /api/lmc/run/{id}/entities?...` | 417 | lmc.py:546 | YES | OK |
| `GET /api/engine/logs/stream` (SSE) | 437 | engine.py:231 | YES | OK |
| `GET /api/lmc/sources` | 495 | lmc.py:63 | YES | OK |
| `GET /api/lmc/entity-ids-by-source?sources=X` | 2894 | lmc.py:86 | YES | OK |
| `GET /api/lmc/compare?run_a=X&run_b=Y` | 2870 | lmc.py:736 | YES | OK |
| `POST /api/engine/start` | 2910 | engine.py:187 | YES | OK |
| `POST /api/engine/stop` | 2934 | engine.py:192 | YES | OK (silent catch) |
| `POST /api/engine/retry` | 2730, 2940, 3020, 3044 | engine.py:197 | YES | OK (all silent catch) |
| `POST /api/engine/resume` | 2952 | engine.py:207 | YES | OK (silent catch) |

**Backend endpoints NOT called by frontend:**

| Endpoint | Line | Notes |
|----------|------|-------|
| `GET /api/lmc/run/{run_id}` | lmc.py:398 | Rich per-run detail — unused |
| `GET /api/lmc/entity/{id}/history` | lmc.py:667 | Entity across-runs history — unused |

#### Existing Audit Findings Verified

| Prior # | Finding | Still Applies? |
|---------|---------|---------------|
| 1 | Dead code: `RunDetailResponse` unused | YES |
| 2 | Unused: `/api/lmc/run/{run_id}` detail | YES |
| 3 | Unused: `/api/lmc/entity/{id}/history` | YES |
| 4 | Silent failure: `handleStop` | YES |
| 5 | Silent failure: `handleRetry` | YES |
| 6 | Silent failure: `handleResume` | YES |
| 7 | Missing user feedback on `handleStart` failure | YES |
| 8 | No entity history drill-down | YES |
| 9 | HistoryTab = EntitiesTab (no run-over-run trend) | YES |
| 10 | Error filtering is client-side only | YES |
| 13 | InventoryTab has no refresh action | YES |
| 14 | `lakehouseState` keys depend on DB naming | YES |

All 12 checked prior findings remain open. No code changes observed on this page since the 2026-03-25 audit.

#### NEW Findings

| ID | Severity | Finding | File:Line |
|----|----------|---------|-----------|
| EC1-LMC-007 | LOW | 3,463 lines in a single file. Five architectural phases all co-located. | LMC.tsx |
| EC1-LMC-008 | MODERATE | Active run creates polling storm: useProgress (3s) + useEngineStatus (3s) + SSE — three concurrent data channels for same state. | LMC.tsx:335, 360, 437 |
| EC1-LMC-009 | LOW | Inline retry button (L2730) has `.catch(() => {})`, no aria-label, no loading state. | LMC.tsx:2730 |

---

### BusinessOverview (BP-001) -- AUDIT_NORMALLY (No Prior Audit)

**Frontend**: `dashboard/app/src/pages/BusinessOverview.tsx` (~560 lines)
**Backend**: `dashboard/app/api/routes/overview.py`
**Prior Audit**: None

#### Architecture Summary

BusinessOverview is the default landing page for Business Portal mode. It displays KPI cards (freshness, alerts, sources, entities), a source health table, and an activity feed. Uses `Promise.allSettled` to fetch three endpoints in parallel with graceful partial failure.

#### API Endpoints Traced

| Frontend Call | Line | Backend Route | Exists? | Contract Match? |
|--------------|------|---------------|---------|-----------------|
| `GET /api/overview/kpis` | 107 | overview.py:35 | YES | OK (see EC1-OVR-004 re: unused fields) |
| `GET /api/overview/sources` | 108 | overview.py:235 | YES | OK |
| `GET /api/overview/activity` | 109 | overview.py:316 | YES | OK |

**Backend endpoint NOT called by frontend:**

| Endpoint | Line | Notes |
|----------|------|-------|
| `GET /api/overview/entities` | overview.py:388 | Orphaned — not consumed by this page |

#### Data Source Audit

| UI Section | Data Source | Real? |
|-----------|------------|-------|
| KPI Cards (freshness, alerts, sources, entities) | `/api/overview/kpis` -> `engine_task_log`, `entity_status`, `datasources` | REAL |
| Source Health Table | `/api/overview/sources` -> `datasources` + `engine_task_log` | REAL |
| Activity Feed | `/api/overview/activity` -> `engine_task_log` ORDER BY created_at DESC | REAL |

No mock data. No hardcoded values. All from real SQLite queries.

#### Error Handling Assessment

- **Parallel fetch**: `Promise.allSettled` handles partial failure gracefully. If all 3 fail, shows error banner. If 1-2 fail, shows partial data with NO indication of partial failure (EC1-OVR-001).
- **Catch block**: Generic `err.message` or "Failed to load overview data". OK for total failure.
- **30s auto-refresh**: No visibility check (EC1-OVR-002).

#### Loading/Empty States

- **Loading**: Full skeleton UI (KPIRowSkeleton, shimmer animations). Excellent UX.
- **Error**: Red banner with error text and "Loading..." indicator gone. OK.
- **Empty sources**: Shows "No data sources configured yet" at L467. OK.
- **Partial data**: Silent — no indicator (EC1-OVR-001).

#### Findings

| ID | Severity | Finding | File:Line |
|----|----------|---------|-----------|
| EC1-OVR-001 | MODERATE | Partial endpoint failure shows no warning. 1-2 of 3 endpoints can fail silently. | BusinessOverview.tsx:104-130 |
| EC1-OVR-002 | LOW | 30s auto-refresh with no tab-visibility check. | BusinessOverview.tsx:134 |
| EC1-OVR-003 | LOW | Zero accessibility attributes. ProgressRing SVG lacks aria-label. | BusinessOverview.tsx (throughout) |
| EC1-OVR-004 | LOW | `freshness_ever_loaded` and `freshness_last_success` computed by backend but never rendered. | BusinessOverview.tsx:22-28, overview.py:209-213 |
| EC1-OVR-005 | LOW | `GET /api/overview/entities` defined in backend but orphaned from this page. | overview.py:388 |

---

## Cross-Cutting Patterns

### 1. Universal Accessibility Gap
All 6 pages have zero `aria-label`, `aria-expanded`, `role="status"`, or `scope="col"` attributes. This is a systemic pattern, not per-page — likely best addressed via shared component library updates rather than per-page fixes. See AUDIT-SHARED-INFRASTRUCTURE.md for shared infrastructure findings.

### 2. Silent Error Swallowing
5 of 6 pages have at least one `.catch(() => {})` or catch block that only logs to console. Pattern: action buttons (start/stop/retry/resume/refresh) fire-and-forget with no user feedback on failure.

### 3. Unconditional Polling
3 of 6 pages (LoadCenter, LoadMissionControl, BusinessOverview) poll on fixed intervals with no `document.visibilitychange` check. Wastes bandwidth and backend resources when the tab is inactive.

### 4. All Data is Real
All 6 pages source data from real SQLite queries via the backend. No mock data, no hardcoded sample data, no stubs serving fake numbers. The only "stub" is ConfigManager's deploy feature (hidden behind a comment).

---

## Statistics

| Metric | Count |
|--------|-------|
| Total findings (all 6 pages) | 33 |
| CRITICAL | 0 (prior CRITICALs in EngineControl still open but already documented) |
| HIGH | 3 (1 new: EC1-ENG-001; 2 prior: EC1-SRC-001, EC1-LMC-001) |
| MODERATE | 13 |
| LOW | 17 |
| Prior findings verified still open | 20 |
| NEW findings this session | 13 |
| Pages with prior audits | 4 (EngineControl, SourceManager, ConfigManager, LoadMissionControl) |
| Pages with fresh audits | 2 (LoadCenter, BusinessOverview) |
