# Page Truth Audit: LoadCenter

**Date:** 2026-03-19
**Auditor:** bright-falcon
**Route:** `/load-center`
**Health:** 🟡 Fragile

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
| Page component | `dashboard/app/src/pages/LoadCenter.tsx` | 713 |
| API route | `dashboard/app/api/routes/load_center.py` | 774 |

---

## 3. Backend Dependencies

| Endpoint | Method | Data Source | Status |
|----------|--------|-------------|--------|
| `/api/load-center/status` | GET | SQLite: `lakehouse_row_counts` + `engine_task_log` + entity tables | ✅ Real |
| `/api/load-center/source-detail` | GET | Same tables | ✅ Real |
| `/api/load-center/refresh` | POST | Fabric SQL Endpoint | ⚠️ Fragile — VPN + SP token required |
| `/api/load-center/run` | POST | SQLite entities | 🔴 **BROKEN — `_build_source_lookup` is undefined** |
| `/api/load-center/run-status` | GET | In-memory `_run_state` | ⚠️ Orphan — frontend never calls it |

### External Dependencies
- [x] Requires Fabric token (SQL Endpoint for refresh)
- [ ] Requires VPN — not directly, but SQL Endpoint may route through it
- [ ] Requires engine running — only for actual load execution
- [ ] Requires OneLake mount — no

---

## 4. Data Contracts

### `/api/load-center/run` — CRITICAL CRASH
Both "Preview Run" and "Load Everything" call this endpoint. The handler calls `_build_source_lookup()` at line 422, which is undefined. **NameError at runtime — 500 on every call.**

### Row counts — semantic mismatch
Row counts come from `engine_task_log.RowsWritten` (last successful load), NOT current physical row counts. If rows are deleted or tables truncated after load, counts are stale.

---

## 5. State Matrix

| State | Trigger | Handled? | What renders |
|-------|---------|----------|-------------|
| Loading | Initial fetch | ✅ | Spinner |
| Error | Fetch fail | ✅ | Red error banner |
| Empty | No data | ❌ | **KPIs show 0, empty table, no guidance** |
| Success | Data loaded | ✅ | KPIs + source rows |
| Run active | Load running | ✅ | Auto-refresh 5s, run banner |
| Refreshing | POST /refresh | ⚠️ | Button disabled, **hardcoded 3s timeout doesn't match actual duration** |
| Re-fetching | Subsequent load | ❌ | **No indicator — spinner gated on `!status`** |

---

## 6. Real vs Stubbed Behavior

| Feature | Classification | Evidence |
|---------|---------------|----------|
| Table counts per source per layer | 🟢 Real | SQLite `lakehouse_row_counts` |
| Row counts per source per layer | 🟢 Real | `engine_task_log` merge |
| Gap detection | 🟢 Real | Cross-layer comparison |
| Source drill-down | 🟢 Real | `/source-detail` endpoint |
| Refresh from SQL Endpoint | 🟢 Real but fragile | Requires Fabric availability |
| **Preview Run (dry run)** | 🔴 **Broken** | `_build_source_lookup` undefined |
| **Load Everything** | 🔴 **Broken** | Same crash |
| Gap-fill auto-registration | 🟡 Real but unreachable | Code exists, blocked by crash |
| Notebook trigger fallback | 🟡 Real but unreachable | Code exists, blocked by crash |
| Run progress auto-refresh | 🟢 Real | 5s polling |
| MethodBadge component | ⚫ Dead code | Defined but never rendered |

### Misleading UI

1. **"Load Everything" button** — Appears clickable, crashes on click (500)
2. **"Preview Run" button** — Same crash
3. **Row counts as physical truth** — Actually from last load's `RowsWritten`, not current state
4. **"Refresh Counts"** — Only refreshes table counts, not row counts from engine log
5. **Green check on source rows** — Equal table counts ≠ same tables
6. **"Physical tables from lakehouse scan"** subtitle — Data is from cache, could be days old

---

## 7. Mutation Flows

| Action | Endpoint | Risk |
|--------|----------|------|
| Refresh | POST `/load-center/refresh` | Mostly safe — read-only from Fabric. Race condition on `_refresh_running` flag. |
| Dry Run | POST `/load-center/run` (dryRun:true) | **BROKEN — crashes before execution** |
| Run | POST `/load-center/run` (dryRun:false) | **BROKEN — crashes before execution** |

**Thread safety issues:** `_run_state` is reassigned outside lock. `_refresh_running` is a global bool without atomic access.

---

## 8. Root-Cause Bug Clusters

### Cluster A: `_build_source_lookup` undefined — CRITICAL
Both run buttons crash. The entire "smart load" feature is dead.
- **Fix:** Implement the function or remove the call (source lookup may not even be needed)

### Cluster B: Stale data presented as live truth
Row counts from `engine_task_log` reflect last load, not current state. Subtitle implies live scan.
- **Fix:** Add staleness warning, clarify data source in UI

### Cluster C: Refresh timing mismatch
Frontend waits 3s then reloads, but actual SQL Endpoint queries take 10-60+ seconds.
- **Fix:** Poll for completion instead of hardcoded timeout

### Cluster D: Thread safety
`_run_state` and `_refresh_running` accessed from multiple threads without consistent locking.
- **Fix:** Use mutable dict with lock, never reassign

---

## 9. Minimal Repair Order

| Priority | Fix | Cluster | Effort | Impact |
|----------|-----|---------|--------|--------|
| 1 | Fix `_build_source_lookup` — implement or remove | A | S | Critical — unblocks entire smart load |
| 2 | Fix refresh timing — poll instead of 3s timeout | C | S | High — refresh actually works |
| 3 | Add empty state for fresh installs | — | S | Medium — UX |
| 4 | Fix thread safety on `_run_state` | D | S | Medium — prevents race conditions |
| 5 | Add staleness warning when data > 1h old | B | S | Low — transparency |
| 6 | Show re-fetch indicator during refresh | — | S | Low — UX |

---

## 10. Proposed Packet Sequence

### Packet A: Truth & Alignment
- [ ] Fix or remove `_build_source_lookup` call
- [ ] Fix thread safety (use `.clear()` + `.update()` under lock)
- [ ] Fix green-check logic to compare table sets, not just counts

### Packet B: Page Shell
- [ ] Add empty state for fresh installs
- [ ] Add staleness warning when scannedAt > 1 hour
- [ ] Add re-fetch indicator during status reload
- [ ] Remove MethodBadge dead code

### Packet C: Core Workflows
- [ ] Fix refresh flow — poll for completion instead of hardcoded timeout
- [ ] Wire frontend to run-status endpoint (or fold into status poll)
- [ ] Replace self-call HTTP to engine/start with direct function call

### Packet D: Hardening & Polish
- [ ] Add confirmation before "Load Everything"
- [ ] Add error recovery — allow retry without page refresh
- [ ] Add source filter to run (currently loads everything always)

---

## 11. Verification Checklist

- [ ] "Load Everything" executes without crash
- [ ] "Preview Run" shows accurate plan
- [ ] Refresh waits for actual completion before reloading
- [ ] Empty state renders on fresh install
- [ ] Staleness is visible when data is old
- [ ] Thread safety verified under concurrent access
- [ ] No console errors or 500s
