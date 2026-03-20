# Page Truth Audit: EngineControl

**Date:** 2026-03-19
**Auditor:** bright-falcon
**Route:** `/engine`
**Health:** 🟡 Fragile

---

## 1. Purpose

> Nerve center for the FMD v3 Python loading engine — start/stop/plan/monitor data pipeline runs with live streaming logs.

**Primary user jobs:**
1. Start, stop, and plan data pipeline runs (LZ/Bronze/Silver)
2. Stream live logs and entity results via SSE
3. Review run history with drill-down reports
4. Retry failed entities from past runs
5. View 24h metrics (slowest entities, top errors, layer breakdown)

---

## 2. File Map

| Role | File | Lines |
|------|------|-------|
| Page component | `dashboard/app/src/pages/EngineControl.tsx` | 2,945 |
| API route | `dashboard/app/api/routes/engine.py` | 415 |
| Engine API | `engine/api.py` | 1,414 |

---

## 3. Backend Dependencies

| Endpoint | Method | Data Source | Status |
|----------|--------|-------------|--------|
| `/engine/status` | GET | Engine singleton + SQLite | ✅ Real — shape mismatch in `last_run` |
| `/engine/start` | POST | Engine.run() in thread | ✅ Real |
| `/engine/stop` | POST | Engine.stop(force=True) | ✅ Real |
| `/engine/plan` | GET | Engine.run(mode="plan") | ✅ Real |
| `/engine/logs` | GET | SQLite `engine_task_log` | ✅ Real |
| `/engine/logs/stream` | GET (SSE) | In-memory ring buffer (10K) | ✅ Real |
| `/engine/retry` | POST | Engine.run() with failed IDs | ✅ Real |
| `/engine/abort-run` | POST | SQLite UPDATE + Engine.stop() | ✅ Real |
| `/engine/health` | GET | Engine.preflight() | ✅ Real |
| `/engine/metrics` | GET | SQLite time-windowed | ✅ Real — layers shape mismatch |
| `/engine/runs` | GET | SQLite `engine_runs` | ✅ Real |
| `/engine/entities` | GET | SQLite multi-table JOIN | ✅ Real |
| **`/engine/jobs`** | GET | — | ❌ **GHOST — endpoint does not exist, frontend polls every 15s** |

---

## 4. Data Contracts

### `/engine/status` — `last_run` type incomplete
Backend returns 13 fields (`run_id`, `status`, `mode`, `started_at`, `finished_at`, `total`, `succeeded`, `failed`, `skipped`, `total_rows`, `duration_seconds`, `layers`, `triggered_by`, `elapsed_seconds`). Frontend type declares 5 fields. Not a crash but wasted data.

### `/engine/metrics` — `layers` is array, not Record
Backend returns `[{Layer, TotalTasks, AvgDurationSeconds, ...}]`. Frontend type says `Record<string, {count, avg_duration}>`. Runtime normalization code handles this correctly — type lies but code works.

### `/engine/jobs` — Ghost endpoint
Frontend polls `/api/engine/jobs` every 15s at line 1280. Endpoint does not exist. Always 404. Silently swallowed.

---

## 5. State Matrix

| State | Trigger | Handled? | What renders |
|-------|---------|----------|-------------|
| Loading | Initial fetch | ✅ | Spinner + "Connecting to FMD Engine..." |
| Error | Status fetch fail | ✅ | Full-page error with retry |
| Empty (no runs) | First visit | ✅ | "No runs recorded yet" |
| Success | Data loaded | ✅ | Status bar + run history |
| SSE active | Run started | ✅ | Live log panel with auto-scroll |
| SSE disconnected | 5 retries exhausted | ❌ | **No visual indicator — only console.warn** |
| Run history fail | Fetch error | ❌ | **Silently swallowed** |
| Metrics fail | Fetch error | ❌ | **Section stays hidden** |
| Entity list fail | Fetch error | ⚠️ | Misleading "Server may need a restart" hint |

---

## 6. Real vs Stubbed Behavior

| Feature | Classification | Evidence |
|---------|---------------|----------|
| Start run (local + notebook) | 🟢 Real | Background thread, SSE streams results |
| Stop (force) | 🟢 Real | Cancels futures, aborts run |
| Plan (dry run) | 🟢 Real | Computes without executing |
| SSE log streaming | 🟢 Real | Ring buffer, late-joiner catch-up |
| SSE reconnection | 🟢 Real | Exponential backoff, 5 retries |
| Entity selector | 🟢 Real | Full search, bulk select/deselect |
| Retry failed entities | 🟢 Real | Queries failed IDs, new run |
| Abort run/all | 🟢 Real | DB update + engine stop |
| Run summary modal | 🟢 Real | By-source, by-layer, error groups |
| Health checks | 🟢 Real | Delegates to engine.preflight() |
| 24h metrics | 🟢 Real | Layer breakdown, slowest entities |
| Fabric job tracker | 🟡 Partial | Renders from SSE events but polls ghost endpoint |
| Entity reset (watermark) | ⚫ Missing | Backend exists, no UI button |
| Engine settings | ⚫ Missing | Backend GET/POST exist, no UI panel |

### Misleading UI

1. **Fabric job polling** — Polls `/api/engine/jobs` which 404s. Job panel empty in pipeline mode unless SSE events arrive.
2. **Entity selector "Server may need a restart"** — Generic hint when real issue is DB connection or empty table.
3. **SSE disconnected** — No visual indicator when SSE permanently fails after 5 retries.
4. **Status bar `last_run`** — Shows only status + duration, wastes 8 backend fields.

---

## 7. Mutation Flows

| Action | Endpoint | Method | Safety | Risk |
|--------|----------|--------|--------|------|
| Start run | `/engine/start` | POST | 409 if already running + button disabled | Safe |
| Stop | `/engine/stop` | POST | Checks engine is running | **No confirmation dialog** |
| Retry | `/engine/retry` | POST | 409 if running + button disabled | Safe |
| Abort run | `/engine/abort-run` | POST | Checks run exists | **No confirmation dialog** |
| Abort all | `/engine/abort-run` (all:true) | POST | Bulk update | **No confirmation, affects all users** |

---

## 8. Root-Cause Bug Clusters

### Cluster A: Ghost Endpoint (`/engine/jobs`)
Frontend polls endpoint that doesn't exist. Constant 404s in pipeline mode.
- **Fix:** Implement endpoint or remove polling code

### Cluster B: Incomplete Type Contracts
`EngineStatus.last_run` declares 5 of 13 fields. `MetricsData.layers` type doesn't match backend.
- **Fix:** Update types, use extra data in status bar

### Cluster C: Silent Error Swallowing
Runs, metrics, and entity fetch failures are invisible to user. SSE disconnect shows nothing.
- **Fix:** Add lightweight error/stale indicators

### Cluster D: No Confirmation on Destructive Actions
Stop, Abort, Abort All fire immediately on click.
- **Fix:** Add confirmation dialogs

---

## 9. Minimal Repair Order

| Priority | Fix | Cluster | Effort | Impact |
|----------|-----|---------|--------|--------|
| 1 | Remove or implement `/engine/jobs` polling | A | S | Critical — eliminates constant 404s |
| 2 | Show SSE-disconnected indicator | C | S | High — users know when streaming failed |
| 3 | Fix `last_run` type, use extra data in status bar | B | S | Medium — richer status display |
| 4 | Add confirmation dialogs for Stop/Abort/Abort All | D | S | Medium — prevents accidental stops |
| 5 | Show error states for runs/metrics/entities failures | C | S | Medium — transparency |
| 6 | Fix entity selector "restart" hint | C | S | Low — accuracy |

---

## 10. Proposed Packet Sequence

### Packet A: Truth & Alignment
- [ ] Remove `/engine/jobs` polling block (or implement endpoint)
- [ ] Update `EngineStatus.last_run` type to match backend's 13 fields
- [ ] Update `MetricsData.layers` type to `Array<{Layer, TotalTasks, ...}>`
- [ ] Add SSE-disconnected visual indicator

### Packet B: Page Shell
- [ ] Add error/stale indicators for runs, metrics, entity fetches
- [ ] Fix entity selector "server restart" hint
- [ ] Add "SSE gave up — polling active" banner

### Packet C: Core Workflows
- [ ] Add confirmation dialog for Stop
- [ ] Add confirmation dialog for Abort All
- [ ] Enrich status bar with last-run succeeded/failed/rows counts

### Packet D: Hardening & Polish
- [ ] Consolidate `TaskLog`/`LogEntry` into unified type
- [ ] Wire entity reset (watermark clear) to UI button
- [ ] Consider wiring engine settings to a settings panel

---

## 11. Verification Checklist

- [ ] All API endpoints return real data (not mock/stub)
- [ ] Loading, error, and empty states render correctly
- [ ] SSE streaming works and shows disconnect state
- [ ] No console errors or unhandled promise rejections (especially 404s)
- [ ] Stop/Abort have confirmation dialogs
- [ ] Status bar shows full last-run data
- [ ] Page works with 0 runs, 1 run, and 100+ runs
