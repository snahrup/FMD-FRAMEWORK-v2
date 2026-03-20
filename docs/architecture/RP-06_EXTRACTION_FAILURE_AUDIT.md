# RP-06: 3/20 Extraction Failure Audit

> Truth-first failure analysis of the 2026-03-20 engine run.
> Audited: 2026-03-20 | Source: `engine_task_log` in `fmd_control_plane.db`

---

## Executive Summary

**5,706 tasks attempted across 3 runs on 3/20. 5,655 failed (99.1%). 51 succeeded.**

All failures are in the **Landing Zone layer only** — Bronze/Silver never ran because LZ had nothing to process.

Four distinct root causes, ordered by blast radius:

| # | Root Cause | Failures | Entities | % of Total | Fixable? |
|---|-----------|----------|----------|-----------|----------|
| RC-1 | VPN/network down | 5,618 | 1,592 | 99.3% | Ops — not a code fix |
| RC-2 | Watermark type mismatch | 35 | 35 | 0.6% | Code fix in seed script |
| RC-3 | Missing source object | 1 | 1 | <0.1% | Entity deactivation |
| RC-4 | Date string conversion | 1 | 1 | <0.1% | Watermark value fix |

---

## RC-1: VPN/Network Connectivity (5,618 failures)

### What happened
All 5 source SQL Servers were unreachable for most of 3/20. The engine attempted 3 runs:

| Run | Window (UTC) | Tasks | Failed | Succeeded |
|-----|-------------|-------|--------|-----------|
| `384aef43` | 00:00–00:58 | 812 | 812 | 0 |
| `5b1dae5e` | 02:19–11:24 | 3,184 | 3,184 | 0 |
| `6434b533` | 16:35–19:06 | 1,713 | 1,662 | 51 |

Run 3 had a brief connectivity window (~8 minutes, 16:35–16:43) where 51 entities succeeded across all 5 sources. Then connectivity dropped again.

### Error signatures
- **5,096 instances**: `Named Pipes Provider: Could not open a connection to SQL Server [53]` (network unreachable)
- **522 instances**: `Named Pipes Provider: Could not open a connection to SQL Server [64]` (host unreachable)

### Pattern extends to prior days
- **3/19**: 225 tasks, ALL failed with timeout — VPN was already down
- **3/17**: 4,431 tasks, 4,268 succeeded — last healthy run
- **3/16**: 10,553 tasks, 8,283 succeeded, 2,104 failed (mixed: timeouts + OOM + schema evolution)

### Impact
No new data loaded since **2026-03-17**. All 5 sources stale by 3 days.

### Recommendation
This is an **operational/infrastructure** issue, not a code bug. The engine's circuit breaker (added in `692b98b`) should prevent burning 9+ hours of retries when no sources are reachable. Verify:
1. VPN is currently connected and stable
2. All 5 source servers respond to connectivity test
3. Run a targeted test extraction (1 entity per source) before full re-run

---

## RC-2: Watermark Type Mismatch (35 failures)

### What happened
35 entities have **integer ID watermark columns** (e.g., `lab_record_id`, `M3XferID`, `SEQU`) but their stored watermark value is a **timestamp string** (`2026-03-17T04:25:48Z`).

The engine builds: `WHERE [int_col] > ?` with param `'2026-03-17T04:25:48Z'`
SQL Server responds: `Conversion failed when converting the nvarchar value '2026-03-17T04:25:48Z' to data type int`

### Root cause
`scripts/configure_incremental_loads.py:seed_watermark_values()` (lines 376-377):
```python
# Bug: seeds ALL watermarks with the LZ execution timestamp
# regardless of whether the watermark column is a datetime or integer
seed_value = last_load.strftime('%Y-%m-%d %H:%M:%S') if hasattr(last_load, 'strftime') else str(last_load)
```

This function seeds **every** incremental entity's watermark with the `MAX(LoadEndDateTime)` from the pipeline execution history — the timestamp of the pipeline run, NOT the actual `MAX(watermark_column)` from the source data.

For datetime watermark columns, this accidentally works (datetime > datetime comparison).
For integer ID columns, it writes a timestamp where an integer is expected → type mismatch.

### Affected entities (35 total)

**MES (m3-db1)**: 21 entities — `alel_*`, `anv_*` tables with integer ID watermarks
**M3 ERP (sqllogshipprd)**: 7 entities — `MVXJDTA_*` tables with `SEQU` (integer) watermark
**ETQ (M3-DB3)**: 7 entities — `M3Xfer`, `TypesXref`, `tblCust*`, `tblFix*`, `tblMat*`, `tblSupplier*`

### Evidence
All 35 entities in `watermarks` table have identical `LoadValue = '2026-03-17T04:25:48Z'` — the timestamp of the 3/17 run, not a real column value.

### Fix required
Two-part repair:

**Part A — Fix the seed script** (`scripts/configure_incremental_loads.py`):
- For integer watermark columns: query `SELECT MAX([wm_col]) FROM source_table` on the actual source
- For datetime watermark columns: current behavior is acceptable
- Add column type detection before seeding

**Part B — Repair the 35 corrupted watermarks**:
- For each affected entity, either:
  - Query `SELECT MAX([wm_col])` from the source table and update the watermark, OR
  - Delete the watermark entry (forces a full-load cycle, which re-seeds correctly via `_compute_watermark`)
- The engine's `_compute_watermark()` (extractor.py:279) correctly computes `MAX(wm_col)` after extraction, so once the initial bad value is fixed, subsequent runs self-correct

### Recommendation
**Simplest safe fix**: Delete the 35 bad watermark entries from the `watermarks` table. This forces the engine to treat them as full loads on next run, which correctly seeds the watermark via `_compute_watermark()`. Then fix the seed script to prevent recurrence.

---

## RC-3: Missing Source Object (1 failure)

### What happened
Entity references `dbo.ipc_CSS_INVT_LOT_MASTER_2` on `m3-db1/mes`, but this table doesn't exist on the source server.

Error: `Invalid object name 'dbo.ipc_CSS_INVT_LOT_MASTER_2'` (SQL error 42S02)

### Recommendation
Deactivate this entity (`IsActive = 0`). It's likely been dropped or renamed at the source.

---

## RC-4: Date String Conversion (1 failure)

### What happened
Entity `M3-DB3/ETQStagingPRD.dbo.X_Materials_20241008` fails with:
`Conversion failed when converting date and/or time from character string` (SQL error 22007)

Same root cause as RC-2 — watermark value is a timestamp string being compared to a date/datetime column with an incompatible format.

### Recommendation
Same fix as RC-2: delete the watermark entry, let full-load re-seed it correctly.

---

## Recommended Repair Order

1. **Verify VPN connectivity** — ping all 5 source servers
2. **Delete 35+1 bad watermark entries** from SQLite `watermarks` table (RC-2 + RC-4)
3. **Deactivate entity for missing table** `ipc_CSS_INVT_LOT_MASTER_2` (RC-3)
4. **Fix `seed_watermark_values()`** in `configure_incremental_loads.py` to detect column types (prevents recurrence)
5. **Test extraction** — 1 entity per source, verify connectivity + query success
6. **Full run** — once test passes, run full extraction

### Blast radius assessment
- Steps 1-3: Zero code changes to the engine. SQLite data fixes only.
- Step 4: Script fix. Only runs manually. No production runtime impact.
- Steps 5-6: Operational. The engine code itself is correct — `build_source_query()` and `_compute_watermark()` work properly. The failures are all upstream: network down + bad seed data.

---

## Appendix: Source Server Status on 3/20

| Server | Database | Failed | Succeeded | Success Rate |
|--------|----------|--------|-----------|-------------|
| sqllogshipprd | m3fdbprd | 2,132 | 17 | 0.8% |
| m3-db1 | mes | 1,538 | 1 | 0.06% |
| SQLOptivaLive | OptivaLive | 1,206 | 12 | 1.0% |
| sql2016live | DI_PRD_Staging | 680 | 16 | 2.3% |
| M3-DB3 | ETQStagingPRD | 63 | 5 | 7.4% |

All sources had some successes during the brief connectivity window in run 3 (16:35-16:43 UTC), confirming the engine code works — the issue is purely network availability.
