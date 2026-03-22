# Page Truth Audit: LoadCenter

**Date:** 2026-03-19 (original) | **Updated:** 2026-03-22 (RP-08 re-audit)
**Auditor:** bright-falcon (original) | sharp-tower (re-audit)
**Route:** `/load-center`
**Health:** 🟢 Functional (upgraded from 🟡 Fragile — RP-01/04/05/08 applied)

---

## 1. Purpose

> Single source of truth for physical lakehouse contents — table/row counts per source per layer, gap detection, and one-click smart loading.

**Primary user jobs:**
1. See what's physically loaded per source per layer (LZ/Bronze/Silver)
2. Spot gaps — tables that landed in LZ but not Bronze/Silver
3. Drill into a source for per-table row counts
4. Refresh counts from live SQL Endpoint scan
5. Execute "Load Everything" — smart load with gap-fill

---

## 2. File Map

| Role | File | Lines |
|------|------|-------|
| Page component | `dashboard/app/src/pages/LoadCenter.tsx` | ~780 |
| API route | `dashboard/app/api/routes/load_center.py` | ~930 |

---

## 3. Backend Dependencies

| Endpoint | Method | Data Source | Status |
|----------|--------|-------------|--------|
| `/api/load-center/status` | GET | SQLite: `engine_task_log` (primary) + `lakehouse_row_counts` (enrichment) + entity tables | ✅ Real (RP-01) |
| `/api/load-center/source-detail` | GET | Same tables | ✅ Real (RP-01) |
| `/api/load-center/refresh` | POST | Fabric SQL Endpoint | ⚠️ Fragile — VPN + SP token required. ~~Hardcoded 2s timeout~~ → poll-based (RP-08) |
| `/api/load-center/run` | POST | SQLite entities → engine/start or Fabric notebooks | ✅ Real (~~_build_source_lookup crash~~ fixed in RP-01 rewrite) |
| `/api/load-center/run-status` | GET | In-memory `_run_state` + SQLite `load_center_runs` | ✅ Real (RP-05). ~~Orphan~~ — frontend gets run state via `/status` response. |

### External Dependencies
- [x] Requires Fabric token (SQL Endpoint for refresh)
- [ ] Requires VPN — not directly, but SQL Endpoint may route through it
- [ ] Requires engine running — only for actual load execution
- [ ] Requires OneLake mount — no

---

## 4. Data Contracts

### `/api/load-center/run` — ~~CRITICAL CRASH~~ FIXED
~~Both "Preview Run" and "Load Everything" call this endpoint. The handler calls `_build_source_lookup()` at line 422, which is undefined.~~

**Fixed in RP-01 rewrite.** The entire `/run` endpoint was rewritten. It now:
1. Queries all active entities with Bronze/Silver/watermark state
2. Categorizes into fullLoad / incremental / gapFill / needsOptimize
3. Dry run returns the plan
4. Non-dry run starts worker thread → engine/start → notebook fallback

### Row counts — semantic mismatch (known limitation)
Row counts come from `engine_task_log.RowsWritten` (last successful load), NOT current physical row counts. Incremental loads show deltas with Δ indicator (RP-04). Physical totals available via "Refresh Counts" button.

---

## 5. State Matrix

| State | Trigger | Handled? | What renders |
|-------|---------|----------|-------------|
| Loading | Initial fetch | ✅ | Spinner |
| Error | Fetch fail | ✅ | Red error banner |
| Empty | No data | ✅ | Empty state with guidance (RP-08) |
| Success | Data loaded | ✅ | KPIs + source rows |
| Run active | Load running | ✅ | Auto-refresh 5s, run banner |
| Refreshing | POST /refresh | ✅ | Button disabled, poll for completion (RP-08) |
| Re-fetching | Subsequent load | ❌ | **No indicator — spinner gated on `!status`** |

---

## 6. Real vs Stubbed Behavior

| Feature | Classification | Evidence |
|---------|---------------|----------|
| Table counts per source per layer | 🟢 Real | `engine_task_log` (RP-01) |
| Row counts per source per layer | 🟢 Real | `engine_task_log.RowsWritten` with Δ labels (RP-04) |
| Gap detection | 🟢 Real | Cross-layer comparison |
| Source drill-down | 🟢 Real | `/source-detail` endpoint |
| Refresh from SQL Endpoint | 🟢 Real but fragile | Requires Fabric availability |
| Preview Run (dry run) | 🟢 Real | ~~_build_source_lookup crash~~ fixed in RP-01 rewrite |
| Load Everything | 🟢 Real | ~~Same crash~~ fixed in RP-01 rewrite |
| Gap-fill auto-registration | 🟢 Real | `_ensure_bronze_registration` / `_ensure_silver_registration` |
| Notebook trigger fallback | 🟢 Real | Falls back when engine unavailable |
| Run progress auto-refresh | 🟢 Real | 5s polling via `/status` response |
| Run state persistence | 🟢 Real | SQLite `load_center_runs` table (RP-05) |

---

## 7. Mutation Flows

| Action | Endpoint | Risk |
|--------|----------|------|
| Refresh | POST `/load-center/refresh` | Mostly safe — read-only from Fabric. Uses `_refresh_lock` + `_refresh_running` flag. |
| Dry Run | POST `/load-center/run` (dryRun:true) | ✅ Safe — read-only categorization |
| Run | POST `/load-center/run` (dryRun:false) | ⚠️ Triggers engine or notebooks — irreversible |

**Thread safety:** `_run_state` uses `.clear()` + `.update()` under `_run_lock` (RP-05). `_refresh_running` uses `_refresh_lock`.

---

## 8. Root-Cause Bug Clusters

### ~~Cluster A: `_build_source_lookup` undefined — CRITICAL~~ FIXED (RP-01)
The entire `/run` endpoint was rewritten in RP-01. The function no longer exists or is referenced.

### Cluster B: Stale data presented as live truth — KNOWN LIMITATION
Row counts from `engine_task_log` reflect last load, not current state. RP-04 added Δ labels for incremental loads. Physical scan via "Refresh Counts" is the only way to get true totals.

### ~~Cluster C: Refresh timing mismatch~~ FIXED (RP-08)
~~Frontend waits 3s then reloads.~~ Now polls backend for refresh completion.

### ~~Cluster D: Thread safety~~ FIXED (RP-05)
`_run_state` uses `.clear()` + `.update()` under `_run_lock`. `_refresh_running` uses `_refresh_lock`.

---

## 9. Remaining Items

| Priority | Issue | Effort | Status |
|----------|-------|--------|--------|
| 1 | ~~Fix `_build_source_lookup`~~ | — | FIXED (RP-01) |
| 2 | ~~Fix refresh timing~~ | S | FIXED (RP-08) |
| 3 | ~~Add empty state~~ | S | FIXED (RP-08) |
| 4 | ~~Fix thread safety~~ | S | FIXED (RP-05) |
| 5 | Re-fetch indicator during status reload | S | OPEN (P3) |
| 6 | Confirmation before "Load Everything" | S | OPEN (P3) |
| 7 | Source filter for run (load specific sources) | M | OPEN (P3) |

---

## 10. Repair History

| Packet | Date | What |
|--------|------|------|
| RP-01 | 2026-03-20 | Rewired data source from `lakehouse_row_counts` to `engine_task_log`. Eliminated `_build_source_lookup` crash. |
| RP-04 | 2026-03-20 | Added full vs incremental distinction with Δ labels. |
| RP-05 | 2026-03-20 | Run state persisted to SQLite. Thread safety via locks. |
| RP-08 | 2026-03-22 | Fixed refresh polling, added empty state, updated stale audit doc. |
