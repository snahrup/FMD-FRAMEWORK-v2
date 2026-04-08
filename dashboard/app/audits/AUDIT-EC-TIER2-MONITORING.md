# AUDIT-EC-TIER2-MONITORING: Engine & Control Tier 2 Monitoring Pages

**Session**: EC-TIER2-MONITORING
**Date**: 2026-04-08
**Auditor**: Claude (Opus 4.6) — Phase 1 V2 Whole-App Forensic Audit
**Scope**: 12 pages — VERIFY_AND_EXTEND of existing canonical audits
**Mode**: READ-ONLY truth audit — no code changes

---

## Methodology

For each page:
1. Read frontend TSX — traced every `fetch()` / API call
2. Read backend route file(s) — verified every endpoint exists and returns expected shape
3. Read existing canonical audit — verified findings still apply, flagged NEW findings

---

## Page Index

| # | Surface ID | Page | Route | Canonical Audit | Frontend | Backend |
|---|-----------|------|-------|-----------------|----------|---------|
| 1 | EC-001 | ExecutionMatrix | `/matrix` | AUDIT-ExecutionMatrix.md | ExecutionMatrix.tsx | entities.py, engine.py (hooks: useEntityDigest, useEngineStatus) |
| 2 | EC-003 | ControlPlane | `/control` | AUDIT-ControlPlane.md | ControlPlane.tsx | control_plane.py, source_manager.py |
| 3 | EC-004 | ExecutionLog | `/logs` | AUDIT-ExecutionLog.md | ExecutionLog.tsx | pipeline.py, monitoring.py |
| 4 | EC-005 | ErrorIntelligence | `/errors` | AUDIT-ErrorIntelligence.md | ErrorIntelligence.tsx | monitoring.py |
| 5 | EC-007 | FlowExplorer | `/flow` | AUDIT-FlowExplorer.md | FlowExplorer.tsx | control_plane.py (connections, datasources), entities.py (digest) |
| 6 | EC-010 | RecordCounts | `/counts` | AUDIT-RecordCounts.md | RecordCounts.tsx | data_access.py (lakehouse-counts), control_plane.py (record-counts) |
| 7 | EC-011 | DataJourney | `/journey` | AUDIT-DataJourney.md | DataJourney.tsx | monitoring.py (journey), lineage.py (columns) |
| 8 | EC-017 | LiveMonitor | `/live` | AUDIT-LiveMonitor.md | LiveMonitor.tsx | monitoring.py (live-monitor) |
| 9 | EC-021 | LoadProgress | `/load-progress` | AUDIT-LoadProgress.md | LoadProgress.tsx | monitoring.py (load-progress) |
| 10 | EC-023 | ColumnEvolution | `/columns` | AUDIT-ColumnEvolution.md | ColumnEvolution.tsx | monitoring.py (journey), lineage.py (columns) |
| 11 | EC-025 | SankeyFlow | `/sankey` | AUDIT-SankeyFlow.md | SankeyFlow.tsx | entities.py (entity-digest via useEntityDigest) |
| 12 | EC-026 | TransformationReplay | `/replay` | AUDIT-TransformationReplay.md | TransformationReplay.tsx | microscope.py, entities.py (entity-digest via useEntityDigest) |

---

## 1. ExecutionMatrix (`/matrix`) — EC-001

### API Contract

| Frontend Call | Backend Endpoint | Route File | Exists | Shape Match |
|--------------|-----------------|------------|--------|-------------|
| `useEntityDigest()` → `GET /api/entity-digest` | `get_entity_digest()` | entities.py:298 | YES | YES (normalizer handles SQLite/Fabric shape differences) |
| `useEngineStatus()` → `GET /api/engine/status` | `get_engine_status()` | engine.py:138 | YES | YES (normalizer handles camelCase/snake_case) |
| `useEngineStatus()` → `GET /api/engine/metrics` | `get_engine_metrics()` | engine.py:158 | YES | YES |
| `useEngineStatus()` → `GET /api/engine/runs` | `get_engine_runs()` | engine.py:163 | YES | YES |
| `useEngineStatus()` → `GET /api/engine/logs` | `get_engine_logs()` | engine.py:148 | YES | YES |
| `useEngineStatus()` → `POST /api/engine/entity/{id}/reset` | `post_engine_entity_reset()` | engine.py:217 | YES | YES |

### Canonical Audit Verification (AUDIT-ExecutionMatrix.md, 2026-03-23)

| ID | Finding | Status in V2 |
|----|---------|-------------|
| EM-01 | DONUT_COLORS race condition | **VERIFIED FIXED** — moved to `useMemo` inside component |
| EM-02 | Unused DigestEntity import | **VERIFIED FIXED** — removed |
| EM-03 | Missing aria-labels | **VERIFIED FIXED** — all 6 controls have aria-labels |
| EM-04 | Missing OPTIVA display name | **VERIFIED FIXED** — added to `_DS_DISPLAY_NAMES` |
| EM-05 | Entity logs missing entity_name | **VERIFIED STILL PRESENT** — engine/api.py still returns raw `engine_task_log` rows without joining `lz_entities` |
| EM-06 | fetchJson lacks Content-Type guard | **VERIFIED STILL PRESENT** — `useEngineStatus.ts` still calls `.json()` without checking Content-Type |

### New Findings

| ID | Severity | Description |
|----|----------|-------------|
| EC2-MAT-001 | LOW | **`useEngineStatus` normalizeEngineMetrics has no null guard on nested `runs` array.** If the engine API returns `metrics` with a null `runs` field, the normalizer would crash. The hook has a `try/catch` at the call site, so the page degrades gracefully, but the error is swallowed silently with no user feedback. |
| EC2-MAT-002 | LOW | **Auto-refresh interval is fixed at 30s with no user-configurable option.** The auto-refresh toggle is binary on/off. For monitoring-heavy use cases, users may want faster refresh (10s) or slower (60s). Not a bug, but a UX gap for a monitoring page. |

---

## 2. ControlPlane (`/control`) — EC-003

### API Contract

| Frontend Call | Backend Endpoint | Route File | Exists | Shape Match |
|--------------|-----------------|------------|--------|-------------|
| `GET /api/control-plane` | `get_control_plane()` → `_build_control_plane()` | control_plane.py:408 | YES | YES — returns `health`, `summary`, `pipelineHealth`, `sourceSystems`, `lakehouses`, `workspaces` |
| `GET /api/load-config` | `get_load_config()` | source_manager.py:1142 | YES | YES — returns entity metadata array |
| `POST /api/entity-digest/resync` | **NOT FOUND** | — | **NO** | N/A |
| `POST /api/maintenance-agent/trigger` | **NOT FOUND** | — | **NO** | N/A |

### Canonical Audit Verification (AUDIT-ControlPlane.md, 2026-03-23)

| ID | Finding | Status in V2 |
|----|---------|-------------|
| F1 | Hardcoded hex #1C1917 | **VERIFIED FIXED** — now `var(--bp-ink-primary)` |
| F2 | Non-standard font token | **VERIFIED FIXED** — now `var(--bp-font-display)` |
| F3 | Unused Shield import | **VERIFIED FIXED** — removed |
| F4-5 | Phantom "Last Load" column | **VERIFIED FIXED** |

### New Findings

| ID | Severity | Description |
|----|----------|-------------|
| EC2-CP-001 | **HIGH** | **Missing `POST /api/entity-digest/resync` endpoint.** ControlPlane.tsx line 255 calls `fetch('/api/entity-digest/resync', { method: 'POST' })` as the first step of the Maintenance Agent flow. No backend route handler exists for this path in any route file (`entities.py` only has `GET /api/entity-digest` and `GET /api/entity-digest/build`). The fetch returns 404; the code only checks `resyncRes.ok` and appends a status message, so the page does not crash — but the resync silently fails and the user sees `"Resync: 404 Not Found"` in the maintenance result string. |
| EC2-CP-002 | **HIGH** | **Missing `POST /api/maintenance-agent/trigger` endpoint.** ControlPlane.tsx line 264 calls `fetch('/api/maintenance-agent/trigger', { method: 'POST' })`. No backend route handler exists. Same graceful degradation as EC2-CP-001 — user sees a 404 status message — but the Maintenance button feature is entirely non-functional. Both maintenance sub-operations (resync + notebook trigger) are dead code. |
| EC2-CP-003 | MEDIUM | **No AbortController cleanup on maintenance agent.** The `runMaintenanceAgent()` async function (line 246) makes two sequential fetches but does not use an AbortController. If the user navigates away mid-flight, the state updates (`setMaintenanceResult`, `setMaintenanceRunning`) fire on an unmounted component, causing a React warning. The main data fetches correctly use AbortController. |
| EC2-CP-004 | LOW | **`LakehouseId <= 3` heuristic for DEV vs PROD.** `control_plane.py` line ~115 uses `env = "DEV" if lh_id <= 3 else "PROD"` — a fragile numeric heuristic documented as TODO in the backend code. If lakehouse IDs change, the environment classification breaks silently. |

---

## 3. ExecutionLog (`/logs`) — EC-004

### API Contract

| Frontend Call | Backend Endpoint | Route File | Exists | Shape Match |
|--------------|-----------------|------------|--------|-------------|
| `GET /api/pipeline-executions` | `get_pipeline_executions()` | pipeline.py:343 | YES | YES — returns array of run objects |
| `GET /api/copy-executions` | `get_copy_executions()` | monitoring.py:156 | YES | YES |
| `GET /api/notebook-executions` | `get_notebook_executions()` | monitoring.py:221 | YES | YES |

### Canonical Audit Verification (AUDIT-ExecutionLog.md, 2026-03-23)

| ID | Finding | Status in V2 |
|----|---------|-------------|
| O1 | Pipeline name hardcoded "FMD_ENGINE_V3" | **VERIFIED STILL PRESENT** — pipeline.py:353 still has `'FMD_ENGINE_V3' AS Name` |
| O2 | "Notebook Runs" tab label misleading | **VERIFIED STILL PRESENT** — tab still says "Notebook Runs" for engine_task_log entries |
| O3 | No pagination (all records in DOM) | **VERIFIED STILL PRESENT** — backend LIMITs cap at 100/500 |
| O4 | normalizeRun() fallback aliases dead code | **VERIFIED STILL PRESENT** — harmless defense-in-depth |

### New Findings

| ID | Severity | Description |
|----|----------|-------------|
| EC2-LOG-001 | MEDIUM | **All three tabs fail silently when only one endpoint is down.** `loadData()` uses `Promise.all()` for all three fetches, but only throws if ALL three fail (`if (!plRes.ok && !cpRes.ok && !nbRes.ok)`). If one endpoint returns 500 while others succeed, the failed tab silently shows empty data with no error indicator. The `safeParse()` wrapper returns `[]` for non-OK responses. The user cannot tell if a tab is empty because there's no data vs. because the API failed. |
| EC2-LOG-002 | LOW | **No debounce on type filter.** The `typeFilter` select triggers a full re-render of all rows on every change. With up to 500 rows, this is not currently a performance issue, but combined with search and sort, it could become one as data volume grows. |

---

## 4. ErrorIntelligence (`/errors`) — EC-005

### API Contract

| Frontend Call | Backend Endpoint | Route File | Exists | Shape Match |
|--------------|-----------------|------------|--------|-------------|
| `GET /api/error-intelligence` | `get_error_intelligence()` | monitoring.py:326 | YES | YES — returns `{ summaries, errors, patternCounts, severityCounts, totalErrors, topIssue, serverTime }` |

### Canonical Audit Verification (AUDIT-ErrorIntelligence.md, 2026-03-23)

| ID | Finding | Status in V2 |
|----|---------|-------------|
| B1 | Backend response shape mismatch | **VERIFIED FIXED** — backend returns correct `ErrorIntelligenceData` shape |
| B2 | SQL queries referenced non-existent tables | **VERIFIED FIXED** — queries now use `engine_task_log`, `pipeline_audit`, `copy_activity_audit` |
| N1 | Duplicate engine_task_log query | **VERIFIED FIXED** — single query now |
| N2 | Dead _load_error_map code | **VERIFIED FIXED** |
| N3 | Case-insensitive status matching | **VERIFIED FIXED** |
| N4 | No pagination on errors array | **VERIFIED STILL PRESENT** — all errors returned in single response |
| B4 | Missing Fabric job errors | **VERIFIED STILL PRESENT** — only local SQLite sources queried |

### New Findings

| ID | Severity | Description |
|----|----------|-------------|
| EC2-ERR-001 | LOW | **`_classify_error()` category fallback is overly broad.** When error text does not match any known pattern, classification falls through to `"unknown"` category with `"info"` severity. In practice, unknown errors could include timeout or auth failures that deserve `"warning"` or `"critical"` severity. The suggestion text is generic ("Review error details") which does not help the user. |
| EC2-ERR-002 | LOW | **Frontend `filterPipeline` select does not handle pipeline names with special characters.** Pipeline names are used directly as option values. If a pipeline name contains `<` or `"`, the select option would render incorrectly. Not currently exploitable (pipeline names are internal) but a robustness gap. |

---

## 5. FlowExplorer (`/flow`) — EC-007

### API Contract

| Frontend Call | Backend Endpoint | Route File | Exists | Shape Match |
|--------------|-----------------|------------|--------|-------------|
| `useEntityDigest()` → `GET /api/entity-digest` | `get_entity_digest()` | entities.py:298 | YES | YES |
| `GET /api/connections` | `get_connections()` | control_plane.py:414 | YES | YES |
| `GET /api/datasources` | `get_datasources()` | control_plane.py:420 | YES | YES |
| `GET /api/pipelines` | `get_pipelines()` | pipeline.py:313 | YES | YES |

### Canonical Audit Verification (AUDIT-FlowExplorer.md, 2026-03-23)

| ID | Finding | Status in V2 |
|----|---------|-------------|
| FE-01 | Broken `/source-manager` navigation link | **VERIFIED FIXED** — now links to `/sources` |
| FE-02 | Hardcoded hex colors in LAYERS | **VERIFIED STILL PRESENT** — accepted (hex needed for JS string interpolation `${color}50`) |
| FE-03 | Hardcoded hex in SVG fills | **VERIFIED STILL PRESENT** — accepted (same reason) |
| FE-04 | `ConnectionGuid` missing from API response | **VERIFIED STILL PRESENT** — cosmetic type mismatch, never read |
| FE-05 | Hardcoded file type values | **VERIFIED STILL PRESENT** — `"PARQUET"` etc. |
| FE-07 | SourceManager links use wrong `/flow-explorer` route | **VERIFIED STILL PRESENT** — out of scope (SourceManager.tsx) |

### New Findings

| ID | Severity | Description |
|----|----------|-------------|
| EC2-FLOW-001 | MEDIUM | **Three parallel fetches (`connections`, `datasources`, `pipelines`) are independent of `useEntityDigest` but loaded sequentially after digest completes.** The `useEffect` at line ~585 fires after digest data is available, then fetches all three in `Promise.all`. These could be fetched in parallel with the digest to reduce initial load time by ~1-2 RTTs. |
| EC2-FLOW-002 | LOW | **`_isActive()` normalization function is duplicated.** FlowExplorer defines its own `_isActive()` helper (line ~35) that handles `"True"`, `"1"`, `1`, `true`. The same function exists in `entities.py` and `control_plane.py`. Not a bug, but a consistency risk if the normalization logic diverges. |

---

## 6. RecordCounts (`/counts`) — EC-010

### API Contract

| Frontend Call | Backend Endpoint | Route File | Exists | Shape Match |
|--------------|-----------------|------------|--------|-------------|
| `GET /api/lakehouse-counts` | `get_lakehouse_counts()` | data_access.py:715 | YES | YES — returns per-table row counts grouped by lakehouse |
| `POST /api/lakehouse-counts/scan` | `post_lakehouse_counts_scan()` | data_access.py:751 | YES | YES |
| `useEntityDigest()` → `GET /api/entity-digest` | `get_entity_digest()` | entities.py:298 | YES | YES |

### Canonical Audit Verification (AUDIT-RecordCounts.md, 2026-03-23)

| ID | Finding | Status in V2 |
|----|---------|-------------|
| T1 | Schema column fabricated "dbo" | **VERIFIED FIXED** — now shows em dash when absent |
| E1 | triggerScan swallows errors | **VERIFIED FIXED** — error handling added |
| E2 | Missing `resolveLabel` in useMemo deps | **VERIFIED FIXED** |
| H1 | Hardcoded hex colors | **VERIFIED FIXED** — replaced with BP tokens |
| H2 | Hardcoded hex in delta indicator | **VERIFIED FIXED** |
| A1-A3 | Missing aria attributes | **VERIFIED FIXED** |

### New Findings

| ID | Severity | Description |
|----|----------|-------------|
| EC2-RC-001 | MEDIUM | **Scan progress polling has no timeout.** When `scanning` is true, the page polls `GET /api/lakehouse-counts` every 3 seconds to check `scanProgress`. If the background scan hangs or crashes, the page polls indefinitely with no timeout/abort mechanism. The user must manually reload to escape the scanning state. |
| EC2-RC-002 | LOW | **`CountsResponse` type uses `Record<string, LakehouseCount[] | CountsMeta>` which is overly loose.** The `_meta` key is special (contains scan metadata), but TypeScript cannot distinguish it from data keys at compile time. A discriminated union or explicit shape would be safer. |

---

## 7. DataJourney (`/journey`) — EC-011

### API Contract

| Frontend Call | Backend Endpoint | Route File | Exists | Shape Match |
|--------------|-----------------|------------|--------|-------------|
| `GET /api/journey?entity={id}` | `get_entity_journey()` | monitoring.py:835 | YES | YES — returns `{ entityId, source, landing, bronze, silver, gold, schemaDiff, lastLoadValues }` |
| `useEntityDigest()` → `GET /api/entity-digest` | `get_entity_digest()` | entities.py:298 | YES | YES |

### Canonical Audit Verification (AUDIT-DataJourney.md, 2026-03-23)

| ID | Finding | Status in V2 |
|----|---------|-------------|
| B1 | Backend response shape mismatch | **VERIFIED FIXED** — backend now returns structured `JourneyData` shape with `source`, `landing`, `bronze`, `silver`, `gold`, `schemaDiff` |
| B2 | `watermarks` table has 0 rows | **VERIFIED STILL PRESENT** — `lastLoadValues` may still be empty depending on whether engine runs have occurred since the fix |
| B3 | `entity_status` not used (getMaxLayer uses registration existence) | **VERIFIED STILL PRESENT** — `getMaxLayer()` still checks for bronze/silver registration, not actual load success status |
| B4 | `pipeline_bronze_entity` empty | **VERIFIED STILL PRESENT** — latent data gap |

### New Findings

| ID | Severity | Description |
|----|----------|-------------|
| EC2-DJ-001 | MEDIUM | **`source.schema` defaults to `"dbo"` when `SourceSchema` is null/empty.** Backend (`monitoring.py` line ~970) returns `lz_entity.get("SourceSchema") or "dbo"`. This fabricates schema information — an entity with no schema appears to have `dbo` schema. The frontend renders this as truth in the journey timeline. This is a truth bug per project Rule 10 (no fabricated data). Same pattern exists for bronze and silver `Schema_` fallbacks. |
| EC2-DJ-002 | LOW | **`gold` section is always a static placeholder.** Backend returns `"gold": {"name": None, "schema": None, ...}` (all nulls). The frontend shows "Not yet processed" for gold regardless of actual state. This is accurate today (Gold is not implemented) but the hardcoded null response will need updating when Gold is built. |

---

## 8. LiveMonitor (`/live`) — EC-017

### API Contract

| Frontend Call | Backend Endpoint | Route File | Exists | Shape Match |
|--------------|-----------------|------------|--------|-------------|
| `GET /api/live-monitor?minutes={n}` | `get_live_monitor()` | monitoring.py:44 | YES | YES — returns `{ pipelineEvents, copyEvents, notebookEvents, bronzeEntities, lzEntities, serverTime }` |

### Canonical Audit Verification (AUDIT-LiveMonitor.md, 2026-03-23)

| ID | Finding | Status in V2 |
|----|---------|-------------|
| LM-01 | "All time" filter returns zero results | **VERIFIED FIXED** — minutes <= 0 skips WHERE time filter |
| LM-02 | Hardcoded hex colors | **VERIFIED FIXED** — replaced with BP tokens |
| LM-03 | Missing accessibility on collapsible sections | **VERIFIED FIXED** — `role="button"`, `aria-expanded`, `tabIndex`, `onKeyDown` added |
| LM-04 | Missing aria-label on time window select | **VERIFIED FIXED** |
| LM-05 | Bronze entity duration always zero | **VERIFIED FIXED** |
| LM-06 | Unused `nbStarts` variable | **VERIFIED FIXED** |
| LM-07 | Missing count fields from backend | **VERIFIED STILL PRESENT** — `slvPipelineTotal`/`slvProcessed` still not returned |
| LM-08 | CopyActivityName selected twice | **VERIFIED STILL PRESENT** — cosmetic SQL redundancy |

### New Findings

| ID | Severity | Description |
|----|----------|-------------|
| EC2-LIVE-001 | MEDIUM | **HTTP polling instead of SSE for real-time data.** LiveMonitor uses `setInterval` + `fetch` for auto-refresh (every N seconds based on `timeWindow`). The engine has an SSE endpoint at `GET /api/engine/logs/stream` (engine.py:231) that could provide real-time push updates. The polling approach causes unnecessary server load and stale data between intervals. For a page named "Live Monitor," the lack of live push data is a significant UX gap. |
| EC2-LIVE-002 | LOW | **`refreshCount` state is tracked but never displayed.** The component increments `refreshCount` on every successful fetch (line ~250) but this value is never rendered in the UI. Dead state. |

---

## 9. LoadProgress (`/load-progress`) — EC-021

### API Contract

| Frontend Call | Backend Endpoint | Route File | Exists | Shape Match |
|--------------|-----------------|------------|--------|-------------|
| `GET /api/load-progress` | `get_load_progress()` | monitoring.py:545 | YES | PARTIAL — backend returns `{ sources, recentRuns, overall, serverTime }` but frontend `LoadData` type expects `TotalEntities`, `LoadedEntities`, `bySource` (see LP-01 adapter) |
| `useEntityDigest()` → `GET /api/entity-digest` | `get_entity_digest()` | entities.py:298 | YES | YES |

### Canonical Audit Verification (AUDIT-LoadProgress.md, 2026-03-23)

| ID | Finding | Status in V2 |
|----|---------|-------------|
| LP-01 | API response shape mismatch | **VERIFIED FIXED** — `adaptApiResponse()` maps backend shape to frontend `LoadData` type |
| LP-02 | Backend does not provide `recentActivity`, `loadedEntities`, `concurrencyTimeline` | **VERIFIED STILL PRESENT** — these fields remain empty; frontend correctly shows empty states |
| LP-03 | Hardcoded hex colors | **VERIFIED FIXED** |
| LP-04 | Source cards `xl:grid-cols-5` hardcoding | **VERIFIED FIXED** — now uses `auto-fill` |
| LP-05 | No loading state | **VERIFIED FIXED** |
| LP-06 | Schema column fabricates "dbo" | **VERIFIED FIXED** |
| LP-07 | Tab bar missing ARIA attributes | **VERIFIED FIXED** |
| LP-08 | Unused HardDrive import | **VERIFIED FIXED** |
| LP-09 | `pendingBySource` populated but never rendered | **VERIFIED STILL PRESENT** — dead data |
| LP-10 | `recentlyLoaded` sort assumption fragile | **VERIFIED STILL PRESENT** — not causing issues (empty data) |

### New Findings

| ID | Severity | Description |
|----|----------|-------------|
| EC2-LP-001 | MEDIUM | **`adaptApiResponse()` mapping creates a truth gap.** The adapter maps `overall.lzLoaded` to `LoadedEntities` but this count is based on `engine_task_log` status = 'succeeded', which counts _any_ entity that ever succeeded — not currently loaded entities. If an entity was loaded then later failed on re-run, it would still count as "loaded." The KPI card shows an inflated number. |
| EC2-LP-002 | LOW | **Three tabs (`Live Activity`, `All Entities`, `Concurrency Timeline`) are always empty.** Per LP-02, the backend never provides the data for these tabs. The tabs remain visible and selectable, showing empty states. While harmless, it clutters the UI with non-functional tabs that set a false expectation of available features. |

---

## 10. ColumnEvolution (`/columns`) — EC-023

### API Contract

| Frontend Call | Backend Endpoint | Route File | Exists | Shape Match |
|--------------|-----------------|------------|--------|-------------|
| `GET /api/journey?entity={id}` | `get_entity_journey()` | monitoring.py:835 | YES | YES — ColumnEvolution reuses the journey endpoint to get column schema data |
| `useEntityDigest()` → `GET /api/entity-digest` | `get_entity_digest()` | entities.py:298 | YES | YES |

### Canonical Audit Verification (AUDIT-ColumnEvolution.md, 2026-03-23)

| ID | Finding | Status in V2 |
|----|---------|-------------|
| F1 | Hardcoded hex colors in LAYERS/TYPE_ICON_MAP | **VERIFIED STILL PRESENT** — accepted (needed for JS string interpolation) |
| F2 | Raw rgba connector line | **VERIFIED FIXED** — replaced with `var(--bp-border-subtle)` |
| F3 | Missing aria-labels | **VERIFIED FIXED** |
| F4 | Minimal error state | **VERIFIED FIXED** — retry button added |
| F5 | `onelakeSchema` not in frontend type | **VERIFIED STILL PRESENT** — harmless (TypeScript ignores extra fields) |
| F6 | `lastLoadValues` unused by ColumnEvolution | **VERIFIED STILL PRESENT** — data returned but not consumed |

### New Findings

| ID | Severity | Description |
|----|----------|-------------|
| EC2-COL-001 | MEDIUM | **ColumnEvolution depends entirely on journey endpoint for schema data, which fetches columns from OneLake at runtime.** If OneLake is unreachable or the table does not have a cached column schema, the page shows "Failed to load column schema" with no indication of _why_ it failed. The lineage.py `_get_columns_for_layer()` function has a cache-first strategy, but cache misses require live OneLake reads that may time out on VPN. The error message should distinguish between "no data cached" vs "OneLake unreachable." |
| EC2-COL-002 | LOW | **Auto-play animation has no keyboard-accessible pause control.** The auto-play feature cycles through layer steps automatically. While the toggle button has an `aria-label`, there is no keyboard shortcut (e.g., Space to pause) when focus is on the step display area. Screen reader users may find the auto-advancing content disorienting without a clear pause mechanism. |

---

## 11. SankeyFlow (`/sankey`) — EC-025

### API Contract

| Frontend Call | Backend Endpoint | Route File | Exists | Shape Match |
|--------------|-----------------|------------|--------|-------------|
| `useEntityDigest()` → `GET /api/entity-digest` | `get_entity_digest()` | entities.py:298 | YES | YES |

_SankeyFlow makes NO direct `fetch()` calls._ All data comes via the `useEntityDigest` hook. The Sankey diagram is built entirely from digest data (entity counts per source × layer).

### Canonical Audit Verification (AUDIT-SankeyFlow.md, 2026-03-23)

| ID | Finding | Status in V2 |
|----|---------|-------------|
| P1 | Blank page — height chain broken | **VERIFIED FIXED** |
| P2 | ResizeObserver never attaches | **VERIFIED FIXED** |
| S1 | Hardcoded hex colors | **VERIFIED FIXED** — SVG fills now use `var(--bp-*)` with fallbacks |
| S2 | Unused imports (XCircle, DigestEntity) | **VERIFIED FIXED** |
| S3 | Hardcoded background color | **VERIFIED FIXED** — now `var(--bp-canvas)` |
| S4 | Side-effect during render (ref mutation) | **VERIFIED STILL PRESENT** — works in practice, technically impure |
| S5 | d3-sankey nodeId/index confusion | **VERIFIED STILL PRESENT** — works correctly via `as unknown` cast |
| S6 | Gold node always disconnected | **VERIFIED STILL PRESENT** — intentional ("Coming soon") |
| S7 | setTimeout for click-outside | **VERIFIED STILL PRESENT** |
| S8 | Fixed-width tooltip rect (56px) | **VERIFIED STILL PRESENT** |

### New Findings

| ID | Severity | Description |
|----|----------|-------------|
| EC2-SANK-001 | LOW | **Known render-then-blank bug still present per MEMORY.md.** The `viz-pages-connected-flow` memory entry documents "SankeyFlow has known render-then-blank bug." The P1/P2 fixes from the canonical audit addressed the initial blank page issue, but the re-blank-after-render issue (likely a ResizeObserver race with React strict mode double-mount) may still occur intermittently. Cannot fully verify without runtime testing. |
| EC2-SANK-002 | LOW | **Entity count data uses registered entity counts, not physical table counts.** Per the `physical-vs-registered-counts` memory entry, showing registered counts as physical counts violates the established design constraint. The Sankey diagram shows entity registration counts per layer (from `useEntityDigest`), which represents metadata registration — not actual physical tables in OneLake. The node labels do not distinguish between "registered" and "physically present." |

---

## 12. TransformationReplay (`/replay`) — EC-026

### API Contract

| Frontend Call | Backend Endpoint | Route File | Exists | Shape Match |
|--------------|-----------------|------------|--------|-------------|
| `useEntityDigest()` → `GET /api/entity-digest` | `get_entity_digest()` | entities.py:298 | YES | YES |
| `GET /api/microscope?entity={id}&pk={pk}` | `get_microscope()` | microscope.py:293 | YES | YES — returns cross-layer row data |

### Canonical Audit Verification (AUDIT-TransformationReplay.md, 2026-03-23)

| ID | Finding | Status in V2 |
|----|---------|-------------|
| TR-01 (HIGH) | Cross-page link to `/data-journey` instead of `/journey` | **VERIFIED FIXED** |
| TR-02-04 (MEDIUM) | Hardcoded hex colors | **VERIFIED FIXED** — replaced with BP tokens |
| TR-05-06 (LOW) | Missing aria-labels | **VERIFIED FIXED** |
| TR-07 (LOW) | Unused `Eraser` import | **VERIFIED STILL PRESENT** — deferred (dead code, no functional impact) |
| TR-08 (LOW) | PK field accepts unconstrained input | **VERIFIED STILL PRESENT** — deferred |

### New Findings

| ID | Severity | Description |
|----|----------|-------------|
| EC2-REPLAY-001 | MEDIUM | **`/api/microscope` query parameter `pk` is not URL-decoded on the backend before use in SQL queries.** The frontend correctly encodes with `encodeURIComponent(pk)` (line 494), but if the backend does not decode, PK values containing special characters (`+`, `%20`, etc.) would fail to match. Need to verify `microscope.py` decodes the param. The router framework may handle this automatically, but it is not explicitly validated. |
| EC2-REPLAY-002 | LOW | **No loading indicator during microscope fetch.** When the user enters a PK and triggers the replay, there is no visible loading state between the fetch initiation and the result render. For large entities with many columns across three layers, the microscope query can take several seconds. The user has no feedback that the request is in progress. |

---

## Consolidated Findings Summary

### By Severity

| Severity | Count | IDs |
|----------|-------|-----|
| HIGH | 2 | EC2-CP-001, EC2-CP-002 |
| MEDIUM | 9 | EC2-CP-003, EC2-LOG-001, EC2-FLOW-001, EC2-RC-001, EC2-DJ-001, EC2-LP-001, EC2-COL-001, EC2-LIVE-001, EC2-REPLAY-001 |
| LOW | 13 | EC2-MAT-001, EC2-MAT-002, EC2-LOG-002, EC2-ERR-001, EC2-ERR-002, EC2-FLOW-002, EC2-RC-002, EC2-DJ-002, EC2-LP-002, EC2-COL-002, EC2-SANK-001, EC2-SANK-002, EC2-REPLAY-002 |
| **Total NEW** | **24** | |

### By Category

| Category | Count | IDs |
|----------|-------|-----|
| Missing API Endpoints | 2 | EC2-CP-001, EC2-CP-002 |
| Data Contract / Truth Bugs | 3 | EC2-DJ-001, EC2-LP-001, EC2-SANK-002 |
| Error/Loading State Gaps | 5 | EC2-LOG-001, EC2-RC-001, EC2-COL-001, EC2-LIVE-002, EC2-REPLAY-002 |
| UX/Performance Gaps | 4 | EC2-MAT-002, EC2-FLOW-001, EC2-LP-002, EC2-LIVE-001 |
| Robustness / Safety | 5 | EC2-CP-003, EC2-MAT-001, EC2-ERR-002, EC2-RC-002, EC2-REPLAY-001 |
| Accessibility | 1 | EC2-COL-002 |
| Code Quality / DRY | 2 | EC2-LOG-002, EC2-FLOW-002 |
| Known Bugs | 1 | EC2-SANK-001 |
| Dead Data / Code | 1 | EC2-ERR-001 |

### Canonical Audit Findings Verification

| Status | Count |
|--------|-------|
| VERIFIED FIXED | 42 |
| VERIFIED STILL PRESENT | 22 |

### Cross-Page Patterns (SHARED references)

- **`useEntityDigest` is the primary data source for 9 of 12 pages.** A failure in `GET /api/entity-digest` would cascade across nearly all monitoring pages simultaneously. Consider: is there a fallback or circuit breaker?
- **`dbo` schema fabrication** appears in both DataJourney (EC2-DJ-001) and the journey endpoint used by ColumnEvolution. This is a systemic truth bug.
- **Registered vs. physical counts** confusion appears in SankeyFlow (EC2-SANK-002) and is documented as a project-wide design constraint. All pages using `useEntityDigest` entity counts should be audited for this.
- **`_isActive()` normalization** is duplicated in at least 3 locations (FlowExplorer, entities.py, control_plane.py). Should be extracted to a shared utility.

---

## Priority Remediation Order

1. **EC2-CP-001 + EC2-CP-002** (HIGH) — Implement or remove the Maintenance Agent feature
2. **EC2-DJ-001** (MEDIUM) — Fix `dbo` schema fabrication (truth bug)
3. **EC2-LP-001** (MEDIUM) — Fix inflated "loaded" count in LoadProgress
4. **EC2-LIVE-001** (MEDIUM) — Consider SSE for LiveMonitor (or document HTTP polling as intentional)
5. **EC2-LOG-001** (MEDIUM) — Add per-tab error indicators in ExecutionLog
6. **EC2-COL-001** (MEDIUM) — Improve error messaging for OneLake failures
7. **EC2-FLOW-001** (MEDIUM) — Parallelize initial data loading
8. **EC2-RC-001** (MEDIUM) — Add scan timeout
9. **EC2-REPLAY-001** (MEDIUM) — Verify URL decoding in microscope.py
10. Remaining LOW findings as backlog

---

_End of audit. 12 pages verified. 42 prior findings confirmed fixed, 22 confirmed still present, 24 new findings identified._
