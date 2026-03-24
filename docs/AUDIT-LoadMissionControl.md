# Load Mission Control — Truth Audit

**Date**: 2026-03-23
**Auditor**: arctic-drift
**Current page**: `/load-progress` → `LoadProgress.tsx`
**Backend**: `/api/load-progress` in `monitoring.py`

---

## 1. SQLite Data Inventory

### Tables Involved (with actual row counts)

| Table | Rows | Purpose | Used by current page? |
|-------|------|---------|-----------------------|
| `engine_runs` | 41 | Run-level metadata (status, timing, entity counts) | YES — via `/api/load-progress` → `recentRuns` |
| `engine_task_log` | 83,264 | Per-entity per-layer per-run detail (THE richest table) | NO — not queried by `/api/load-progress` at all |
| `entity_status` | 5,571 | Layer × entity status tracking | NO — not queried |
| `watermarks` | 121 | Incremental load watermark values | NO — not queried |
| `pipeline_audit` | 77 | Run start/end audit log | NO — not queried by load-progress |
| `copy_activity_audit` | 17,907 | Per-entity copy audit (legacy format) | NO — not queried |
| `lz_entities` | 1,728 | Entity registration (active entities) | YES — total count only |
| `datasources` | 8 | Source system definitions | YES — names for per-source counts |
| `pipeline_lz_entity` | 1,034 | LZ file tracking | NO |
| `pipeline_bronze_entity` | 1,595 | Bronze processing tracking | NO |
| `lakehouse_row_counts` | 5,909 | Physical row counts per table | NO |

**FINDING: The current page uses 3 of 10 relevant tables. `engine_task_log` (83K rows of rich per-entity data) is completely ignored.**

### engine_runs — Schema + Real Data

```
RunId TEXT PK | Mode TEXT | Status TEXT | TotalEntities INT | SucceededEntities INT |
FailedEntities INT | SkippedEntities INT | TotalRowsRead INT | TotalRowsWritten INT |
TotalBytesTransferred INT | TotalDurationSeconds REAL | Layers TEXT | EntityFilter TEXT |
TriggeredBy TEXT | ErrorSummary TEXT | StartedAt TEXT | EndedAt TEXT | updated_at TEXT
```

**BUG FOUND**: Run-level `SucceededEntities`/`FailedEntities` are ALWAYS 0 for InProgress and Aborted runs.
The actual counts are only in `engine_task_log`. Cross-check:

| RunId | engine_runs.Succeeded | engine_runs.Failed | Actual task_log succeeded | Actual task_log failed |
|-------|----------------------|-------------------|--------------------------|----------------------|
| ef237f41 (current) | 0 | 0 | 108 | 23 |
| 5d33f922 (aborted) | 0 | 0 | 319 | 1,197 |
| 5b1dae5e (failed) | 0 | 1,595 | 0 | 1,592 |

**IMPLICATION**: For any run that's InProgress or was Aborted, the `engine_runs` summary is WRONG. Must always derive real counts from `engine_task_log`.

### engine_task_log — Schema + Real Data (THE KEY TABLE)

```
id INT PK AUTO | RunId TEXT | EntityId INT | Layer TEXT | Status TEXT |
SourceServer TEXT | SourceDatabase TEXT | SourceTable TEXT | SourceQuery TEXT |
RowsRead INT | RowsWritten INT | BytesTransferred INT | DurationSeconds REAL |
TargetLakehouse TEXT | TargetPath TEXT | WatermarkColumn TEXT | WatermarkBefore TEXT |
WatermarkAfter TEXT | LoadType TEXT | ErrorType TEXT | ErrorMessage TEXT |
ErrorStackTrace TEXT | ErrorSuggestion TEXT | LogData TEXT(JSON) | created_at TEXT
```

**This table has EVERYTHING.** Per entity: source server, database, table, the exact SQL query, rows read/written, bytes, duration, watermark before/after, load type (full/incremental), error classification, error message, error suggestion, and the full JSON log envelope.

### Layer Distribution (All Time)

| Layer | Succeeded | Failed | Skipped |
|-------|-----------|--------|---------|
| landing | 25,437 | 10,186 | 402 |
| bronze | 23,414 | 588 | 386 |
| silver | 21,951 | 558 | 345 |

**Bronze and Silver DO have data.** The current page completely ignores them.

### Current Run (ef237f41) Stats

| Layer | Status | Count | Rows Read | Bytes | Duration(s) |
|-------|--------|-------|-----------|-------|-------------|
| landing | succeeded | 108 | 4,682,540 | 26,814,935 | 11,271s |
| landing | failed | 23 | 0 | 0 | 75s |

**Only landing layer entries so far** (run is still InProgress).

### Per-Source Progress (Current Run)

| Source | Total | Succeeded | Failed | Rows Read | Bytes |
|--------|-------|-----------|--------|-----------|-------|
| DI_PRD_Staging | 187 | 34 | 0 | 443,228 | 17,016,760 |
| ETQStagingPRD | 29 | 1 | 21 | 9,754 | 90,536 |
| MES | 444 | 3 | 2 | 111 | 25,228 |
| m3fdbprd | 597 | 35 | 0 | 40,576 | 1,609,914 |
| optivalive | 335 | 38 | 0 | 4,644,031 | 8,705,566 |

### Load Types (Current Run)

| Type | Count |
|------|-------|
| full | 107 |
| incremental | 24 |

### Watermarks

121 entities have watermarks (out of 1,592 active). The `watermarks` table tracks `LoadValue` and `LastLoadDatetime`. The `engine_task_log` separately tracks `WatermarkBefore`/`WatermarkAfter` per task execution.

### Retry Detection

No retries detected in current run (each entity appears once per layer). Retries WOULD show as multiple `engine_task_log` rows for the same `EntityId + Layer + RunId`.

---

## 2. Current API Endpoint Audit

### GET /api/load-progress (monitoring.py:545)

**Returns:**
```json
{
  "sources": [{ "DataSourceId", "dataSourceName", "totalEntities", "lzLoaded", "brzLoaded", "slvLoaded" }],
  "recentRuns": [{ "RunId", "Mode", "Status", "TotalEntities", "SucceededEntities", "FailedEntities", "TotalDurationSeconds", "StartedAt", "EndedAt" }],
  "overall": { "totalEntities", "lzLoaded", "brzLoaded", "slvLoaded" },
  "serverTime": "ISO"
}
```

**Problems:**
1. `recentRuns` uses `engine_runs` summary fields which are ALWAYS 0 for InProgress/Aborted runs
2. No per-entity detail at all — no entity names, no errors, no task log data
3. `sources` has per-layer loaded counts (lz/brz/slv) but frontend ONLY uses `lzLoaded`
4. No way to query a specific run — always returns all-time aggregates
5. No error breakdown, no load type breakdown, no throughput data

### GET /api/engine/runs (engine.py → engine/api.py)

Returns run list. Delegates to engine/api.py. Not used by LoadProgress page at all.

### GET /api/engine/logs (engine.py → engine/api.py)

Returns task log entries. **This is the richest endpoint but LoadProgress never calls it.**

### GET /api/engine/logs/stream (SSE)

Real-time SSE stream of engine log events. **Exists, never used by LoadProgress.**

### GET /api/engine/status

Returns engine status (idle/running/stopping). **Not used by LoadProgress.**

---

## 3. Current Frontend Audit

### LoadProgress.tsx — What It Renders

| Section | Data Source | Real Data? | Issues |
|---------|------------|------------|--------|
| Overall Progress hero | `/api/load-progress` → overall | PARTIAL | Shows LZ only, Bronze/Silver ignored |
| Stacked progress bar | `/api/load-progress` → sources | YES | Only LZ loaded counts per source |
| Source cards | `/api/load-progress` → sources | YES | Only shows LZ progress |
| Concurrency Timeline | `concurrencyTimeline` | ALWAYS EMPTY | Backend never returns this field |
| Live Activity tab | `recentActivity` | ALWAYS EMPTY | `adaptApiResponse()` sets `recentActivity: []` |
| All Entities tab | `loadedEntities` | ALWAYS EMPTY | `adaptApiResponse()` sets `loadedEntities: []` |

**FINDING: 3 of 6 sections are PERMANENTLY EMPTY. The adapter function at line 142 always returns empty arrays for recentActivity, loadedEntities, and concurrencyTimeline because the backend doesn't return those shapes.**

### TypeScript Interfaces vs Backend Reality

| Interface | Used? | Backend provides? |
|-----------|-------|-------------------|
| `OverallProgress` | YES | PARTIAL — no RunStarted/LastActivity/ElapsedSeconds from `/api/load-progress` (adapted from recentRuns) |
| `SourceProgress` | YES | YES — adapted from sources array |
| `RecentActivity` | YES | NO — always empty array |
| `LoadedEntity` | YES | NO — always empty array |
| `ConcurrencyPoint` | YES | NO — always empty array |

---

## 4. Available Endpoints NOT Being Used

| Endpoint | What it provides | Useful for |
|----------|-----------------|------------|
| `/api/engine/status` | Engine state (idle/running), current run ID | Run header status |
| `/api/engine/logs?run_id=X` | Per-entity task log with FULL detail | Entity drill-down, error detail |
| `/api/engine/logs/stream` (SSE) | Real-time log events | Live event feed |
| `/api/engine/runs` | Run history list | Run selector |
| `/api/engine/metrics` | Throughput metrics | KPI strip |
| `/api/engine/health` | Preflight health checks | Pre-run diagnostics |

---

## 5. Packet Plan — What Each Packet Can Safely Build

### Packet A: Backend Endpoints (no frontend)

New/enhanced endpoints needed:

1. **`GET /api/load-progress/run/{run_id}`** — Per-run detail
   - Source: `engine_task_log` WHERE RunId = ? + `lz_entities` + `datasources`
   - Returns: per-layer per-source counts, entity list with status/rows/errors, error breakdown, load type breakdown
   - SQL: All queries proven above to work

2. **`GET /api/load-progress/run/{run_id}/entities`** — Per-entity detail for a run
   - Source: `engine_task_log` WHERE RunId = ?
   - Returns: full entity list with all task_log columns
   - Supports: ?source=X, ?status=X, ?layer=X, ?search=X filters

3. **`GET /api/load-progress/entity/{entity_id}/history`** — Entity across all runs
   - Source: `engine_task_log` WHERE EntityId = ? + `watermarks`
   - Returns: all task_log rows for an entity (shows retries + historical runs)

4. **Enhance existing `/api/load-progress`** — Add real counts from task_log
   - Fix: Derive SucceededEntities/FailedEntities from `engine_task_log` not `engine_runs` summary
   - Add: Per-layer progress (not just LZ)
   - Add: Error type breakdown
   - Add: Load type breakdown (incremental vs full)

### Packet B: Run Header + KPI Strip

- Data from: `/api/engine/status` + enhanced `/api/load-progress`
- Renders: Run selector, status indicator, entity counts, rows, bytes, throughput, duration
- Start/Stop buttons delegating to `/api/engine/start` and `/api/engine/stop`
- SSE connection to `/api/engine/logs/stream` for live updates

### Packet C: Layer Progress Lanes

- Data from: Packet A's `/api/load-progress/run/{run_id}`
- Renders: Three progress lanes (LZ → Bronze → Silver) with per-source breakdowns
- All data proven to exist in task_log layer distribution

### Packet D: Live Event Stream

- Data from: `/api/engine/logs/stream` SSE
- Renders: Real-time event feed replacing the permanently-empty "Live Activity" tab
- Error events show ErrorType + ErrorMessage + ErrorSuggestion from task_log

### Packet E: Entity Detail + Drill-Down

- Data from: Packet A's `/api/load-progress/run/{run_id}/entities`
- Renders: Searchable/filterable entity table with expandable rows
- Expand shows: SQL query, watermark before/after, error detail, source info

### Packet F: Optimization Visibility

- Data from: `watermarks` table + `lz_entities.IsIncremental` + task_log LoadType
- Renders: Incremental vs full breakdown, watermark status, newly optimized entities

### Packet G: Polish + Integration

- End-to-end test: Start run → watch stream → drill into errors
- Empty states for all sections
- Error states for all fetches
- Animation and transitions per design system

---

## 6. Risk Registry

| Risk | Mitigation |
|------|------------|
| `engine_runs` summary counts are wrong for InProgress/Aborted | ALWAYS derive from `engine_task_log` group-by |
| SSE stream may not work from laptop (engine runs on vsc-fabric) | Fall back to polling with clear indicator |
| `concurrencyTimeline` has no backend — was always empty | Don't build it until we have real data. Defer to Packet G if at all |
| Bronze/Silver task_log entries only appear AFTER LZ completes | Show "Waiting for LZ" state in Bronze/Silver lanes |
| 83K task_log rows — queries could be slow | Index on (RunId, Layer, Status) and use LIMIT/pagination |
| `recentActivity` and `loadedEntities` were always empty | Remove the adapter hack, build real data flow from task_log |
