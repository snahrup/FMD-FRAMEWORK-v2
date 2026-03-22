# FMD Pipeline Truth Audit

> Append-only audit ledger. Brutally honest.
> Each entry documents: what SHOULD happen, what ACTUALLY happens, and whether it's real or stubbed.
>
> **Append new entries at the bottom. Never delete or edit existing entries — mark them SUPERSEDED instead.**
>
> Last audited: 2026-03-20 | Audited by: Claude Code (full codebase read, not memory)

---

## Audit Format

```
### [AUDIT-NNN] Title
- **Stage**: Which pipeline/page/component
- **Expected**: What should happen
- **Actual**: What actually happens right now
- **Real vs Stubbed**: Is the implementation real or faking it?
- **Mismatch**: What's wrong
- **Impact**: What the user sees / what breaks
- **Root cause**: Why it's wrong
- **Repair priority**: P0 (blocks everything) / P1 (major UX) / P2 (misleading) / P3 (cosmetic)
- **Status**: OPEN | REPAIRED | SUPERSEDED
- **Repair packet**: (assigned after triage)
```

---

## Audit Entries

### [AUDIT-001] Load Center status endpoint reads empty cache table
- **Stage**: Load Center page — `/api/load-center/status`
- **Expected**: Shows table counts and row counts per source per layer from actual load history
- **Actual**: ~~Shows all zeros for every source, every layer~~
- **Real vs Stubbed**: Real endpoint, ~~wrong data source~~ now correct
- **Mismatch**: ~~Endpoint reads `lakehouse_row_counts` (empty cache table) instead of `engine_task_log`~~
- **Impact**: ~~Load Center page is completely useless~~
- **Root cause**: `get_load_center_status()` was querying `lakehouse_row_counts`. Now rewired to `_get_counts_from_log()` (engine_task_log) as primary, with `lakehouse_row_counts` as optional enrichment for row counts when populated.
- **Repair priority**: P0
- **Status**: REPAIRED (RP-01, 2026-03-20)
- **Repair packet**: RP-01
- **Residual**: Row counts for incremental loads show latest run's delta, not physical total. Now properly labeled with Δ indicator (RP-04).

### [AUDIT-002] Load Center source drill-down shows dashes for row counts
- **Stage**: Load Center page — `/api/load-center/source-detail`
- **Expected**: Shows per-table row counts when you expand a source
- **Actual**: ~~Shows "—" for every LZ/Bronze/Silver column~~
- **Real vs Stubbed**: Real endpoint, now with correct fallback chain
- **Mismatch**: ~~Preferred phys_rows (empty), fell back to None~~
- **Impact**: ~~Drill-down table is empty~~
- **Root cause**: Now fixed: prefers physical scan rows when available, falls back to engine_task_log.RowsWritten. Each cell includes `rowSource` field so frontend knows what's being shown.
- **Repair priority**: P0
- **Status**: REPAIRED (RP-01, 2026-03-20)
- **Repair packet**: RP-01
- **Residual**: Same incremental delta caveat as AUDIT-001. Now properly labeled with Δ indicator (RP-04).

### [AUDIT-003] Overview freshness KPI shows 0% after failed run
- **Stage**: BusinessOverview — `/api/overview/kpis`
- **Expected**: Shows percentage of entities with recent successful loads
- **Actual**: ~~Shows 0% because the most recent run (2026-03-20) failed~~ Now shows two-tier freshness: 24h recency when available, ever-loaded coverage as fallback
- **Real vs Stubbed**: Real computation, now correct
- **Mismatch**: ~~24h freshness window returns 0% when last success was 3+ days ago~~ Fixed: fallback to coverage + last success timestamp
- **Impact**: ~~Overview page shows system is broken (0% fresh)~~ Now shows coverage (e.g., "88.5% ever loaded") with "Last success: 3d ago"
- **Root cause**: Was: `overview.py:45-68` uses `datetime('now', '-24 hours')` as cutoff. Now: two-tier logic with coverage fallback and `freshness_last_success` field.
- **Repair priority**: P1
- **Status**: REPAIRED (RP-02, 2026-03-20)
- **Repair packet**: RP-02

### [AUDIT-004] entity_status table disagrees with engine_task_log
- **Stage**: ~~Multiple pages (ExecutionMatrix, BusinessCatalog, SourceManager, BusinessSources)~~ All consumer routes now read engine_task_log
- **Expected**: Entity status is consistent across all pages
- **Actual**: ~~Pages reading `entity_status` may show different status~~ All pages now derive status from `engine_task_log` via `get_canonical_entity_status()`
- **Real vs Stubbed**: Both tables are real, but entity_status is fully deprecated — no route reads it
- **Mismatch**: ~~Two sources of truth~~ Eliminated: single source (engine_task_log)
- **Impact**: ~~Entity shown as "succeeded" on one page, "failed" on another~~ Status is now consistent across all pages
- **Root cause**: `entity_status` was the v2 status tracking. All routes now use `get_canonical_entity_status()` which derives from engine_task_log. Dead startup sync removed. entity_status table still exists and is still written by engine for backward compat, but no dashboard route reads it.
- **Repair priority**: P1
- **Status**: REPAIRED (RP-03, 2026-03-20)
- **Repair packet**: RP-03
- **Surviving intentional dependencies**: engine/logging_db.py still WRITES to entity_status (backward compat for remote sync consumers). `upsert_entity_status()` and `get_entity_status_all()` kept for admin table browser. delta_ingest and parquet_sync still include entity_status in their sync config.

### [AUDIT-005] Registered entity count displayed as "loaded" count
- **Stage**: ~~Multiple pages~~ BusinessOverview (fixed), other pages still pending
- **Expected**: Clear distinction between "registered" (metadata exists) and "loaded" (data extracted)
- **Actual**: ~~Some pages show `lz_entities` count as if it means "tables with data"~~ BusinessOverview now shows "loaded / registered" (e.g., "1,432 / 1,728") with clear subtitle
- **Real vs Stubbed**: Real data, ~~misleading label~~ now honestly labeled on BusinessOverview
- **Mismatch**: ~~1,728 registered entities ≠ number of entities with successful loads~~ Fixed on Overview: shows both counts
- **Impact**: ~~User thinks 1,728 tables have data~~ Overview now distinguishes. Other pages may still conflate.
- **Root cause**: UI labels didn't distinguish registered vs loaded. Backend now returns both `total_entities` and `loaded_entities`.
- **Repair priority**: P2
- **Status**: PARTIALLY REPAIRED (RP-02, 2026-03-20) — BusinessOverview fixed, other pages still need migration
- **Repair packet**: RP-02

### [AUDIT-006] lakehouse_row_counts never auto-populated
- **Stage**: Background data refresh
- **Expected**: `lakehouse_row_counts` should auto-refresh on some schedule
- **Actual**: Only populated when user manually clicks "Refresh Counts" button, which triggers a Fabric SQL endpoint query
- **Real vs Stubbed**: Real mechanism, but requires manual trigger
- **Mismatch**: Cache table is designed as if it's regularly populated, but nothing populates it automatically
- **Impact**: ~~Table is almost always empty, making any endpoint that reads it useless~~ Reduced impact: Load Center no longer depends on this table for primary data. When populated, it enriches row counts. When empty, engine_task_log provides the data.
- **Root cause**: No cron/scheduler/startup hook to populate it. Only `POST /api/load-center/refresh` fills it, and that requires user action.
- **Repair priority**: P3 (demoted — no longer blocks Load Center functionality)
- **Status**: PARTIALLY REPAIRED (RP-01, 2026-03-20) — impact reduced, not eliminated
- **Repair packet**: RP-01 (impact reduced by switching primary to engine_task_log)

### [AUDIT-007] Incremental RowsWritten displayed as total row count
- **Stage**: Load Center — `/api/load-center/status` and `/api/load-center/source-detail`
- **Expected**: Row counts clearly distinguish full-load totals from incremental deltas
- **Actual**: ~~For incremental loads, RowsWritten shown as plain "rows"~~ Now: backend returns `fullLoadRows`, `incrementalDeltaRows`, `incrementalTables` per layer. Frontend shows context-aware labels and Δ indicators.
- **Real vs Stubbed**: Real data, now correctly labeled
- **Mismatch**: ~~A table with 1M total rows that had 50 new rows shows "50 rows"~~ Now shows "50 Δ" with tooltip "Incremental delta (not total)"
- **Impact**: ~~Massive undercount~~ Users can now see which numbers are full totals and which are deltas
- **Root cause**: `engine_task_log.RowsWritten` is per-load, not cumulative. Now: backend splits row counts by load type, frontend adapts labels accordingly.
- **Repair priority**: P2
- **Status**: REPAIRED (RP-04, 2026-03-20)
- **Repair packet**: RP-04
- **Residual**: True physical total for incremental entities still requires a lakehouse scan (Refresh Counts button). The engine doesn't track cumulative totals — only per-run deltas. This is a design limitation, not a bug.

### [AUDIT-008] "Load Everything" button run state lost on page navigation
- **Stage**: Load Center — `/api/load-center/run`
- **Expected**: Run state persists and is trackable across page navigations
- **Actual**: ~~Run state is in-memory dict only~~ Now: persisted to `load_center_runs` table in SQLite at key transitions (start, phase change, complete, fail). In-memory dict is hot cache for active runs; SQLite is the durable record.
- **Real vs Stubbed**: Real mechanism, now durable
- **Mismatch**: ~~In-memory state vs expected persistent state~~ Resolved: SQLite is the durable store
- **Impact**: ~~Button shows "Load Everything" after navigation~~ Now: run state survives navigation and server restart. Interrupted runs detected on startup.
- **Root cause**: Was: `_run_state` module-level dict, lost on restart. Now: `load_center_runs` table with precedence logic (in-memory if active, else SQLite).
- **Repair priority**: P2
- **Status**: REPAIRED (RP-05, 2026-03-20)
- **Repair packet**: RP-05
- **Precedence model**: In-memory `_run_state` (hot, most current for active runs) → SQLite `load_center_runs` (durable, survives restart). On startup, any "active" runs in SQLite are marked "interrupted".

### [AUDIT-009] Engine task log has 1,595 failed entities from latest run
- **Stage**: Engine execution — 2026-03-20 run
- **Expected**: Source tables extracted successfully
- **Actual**: 51 succeeded, 5,655 failed across 3 runs over ~19 hours
- **Real vs Stubbed**: Real failure — three distinct root causes identified
- **Mismatch**: All entities failing extraction
- **Impact**: No new data loaded since 2026-03-17
- **Root cause**: INVESTIGATED (RP-06). Three root causes: (1) VPN/network outage — 99.3% of failures, all 5 sources unreachable (AUDIT-012); (2) Watermark type mismatch — 35 entities with timestamp values on integer ID columns (AUDIT-013); (3) Missing source table — 1 entity (AUDIT-014)
- **Repair priority**: P0 (RC-1 ops) / P1 (RC-2 code)
- **Status**: SUPERSEDED by AUDIT-012, AUDIT-013, AUDIT-014
- **Repair packet**: RP-06

### [AUDIT-010] Bronze/Silver processing depends on LZ files existing
- **Stage**: Pipeline chain: LZ → Bronze → Silver
- **Expected**: Bronze processes only entities that have LZ files
- **Actual**: Bronze processor reads LZ parquet files from OneLake. If LZ extraction failed, there's nothing to process.
- **Real vs Stubbed**: Real
- **Mismatch**: N/A — this is working as designed, but means a failed LZ run cascades to empty Bronze and Silver
- **Impact**: When LZ fails, entire pipeline produces nothing
- **Root cause**: By design — Bronze depends on LZ. But needs better error messaging.
- **Repair priority**: P3
- **Status**: OPEN (informational)

### [AUDIT-011] Gold Studio extraction is real but clustering/validation are naive
- **Stage**: Gold Studio pipeline
- **Expected**: Full ML-based entity clustering, comprehensive validation
- **Actual**: SQL parser extraction (Packet G) is real and working. Clustering uses exact name matching (not fuzzy/ML). Validation runs 3 structure checks only (sql_present, columns_defined, target_name_set). Schema discovery is stubbed (job created but immediately completed with no logic).
- **Real vs Stubbed**: Extraction=REAL, Clustering=NAIVE (exact name match, hardcoded 80% confidence), Validation=STRUCTURE-ONLY (3 checks), Schema Discovery=STUBBED, Reconciliation=MANUAL-ONLY
- **Mismatch**: ~~Frontend suggests sophisticated capabilities that aren't fully implemented~~ Now: frontend labels honestly disclose maturity level of each capability
- **Impact**: ~~Users may trust cluster suggestions or validation results that are incomplete~~ Reduced: honest labels set correct expectations
- **Root cause**: Gold Studio is still under development. Packets A-G complete, remaining work documented.
- **Repair priority**: P3
- **Status**: PARTIALLY REPAIRED (RP-07, 2026-03-22) — honest labels added to frontend. Backend capabilities unchanged.
- **Repair packet**: RP-07
- **Changes**: (1) Clusters page: stats strip shows "name-only" qualifier on confidence, maturity notice below stats, "Promote to Canonical" → "Mark Standalone". (2) Validation page: "Validation Rules" → "Validation Checks" with "structure only" notice, "Run Validation" → "Run Structure Check", reconciliation section labeled "manual entry only". (3) Schema discovery: no frontend change needed (not exposed as UI button).

### [AUDIT-012] 3/20 extraction: 99.3% failures caused by VPN/network outage
- **Stage**: Engine extraction — 2026-03-20 (3 runs)
- **Expected**: LZ extraction succeeds for all 1,592 entities
- **Actual**: 5,618 of 5,656 failures are Named Pipes connection timeouts (error 53/64). All 5 source servers unreachable. VPN was down from at least 3/19 through most of 3/20. Brief ~8min connectivity window in run 3 allowed 51 entities to succeed.
- **Real vs Stubbed**: Real infrastructure failure
- **Mismatch**: Engine retried for 9+ hours against unreachable servers
- **Impact**: No new data since 2026-03-17. All sources stale by 3 days.
- **Root cause**: VPN/network outage. NOT a code bug. Engine circuit breaker (692b98b) should limit retry burn.
- **Repair priority**: P0 (ops — verify VPN, then re-run)
- **Status**: REPAIRED (RP-06C, 2026-03-22) — VPN verified reachable (all 5 sources), test extraction succeeded (1 entity per source), watermark remediation executed (255 deleted), phantom entities deactivated (3). Safe to run full extraction.
- **Repair packet**: RP-06C
- **Detail**: See `docs/architecture/RP-06C_CONNECTIVITY_VERIFICATION.md`

### [AUDIT-013] 35 entities have timestamp watermarks on integer ID columns
- **Stage**: Watermark seeding — `scripts/configure_incremental_loads.py`
- **Expected**: Watermark value matches the data type of the watermark column (int → int, datetime → datetime)
- **Actual**: `seed_watermark_values()` writes `MAX(LoadEndDateTime)` (a pipeline execution timestamp) as the watermark for ALL incremental entities, regardless of column type. Integer ID columns (`lab_record_id`, `M3XferID`, `SEQU`, etc.) get timestamp strings.
- **Real vs Stubbed**: Real bug in seed script
- **Mismatch**: `WHERE [int_col] > '2026-03-17T04:25:48Z'` → SQL Server conversion error
- **Impact**: 35 entities permanently fail incremental extraction until watermark values are corrected
- **Root cause**: `seed_watermark_values()` line 377 uses pipeline execution timestamp, not `MAX(watermark_column)` from source data. Engine's runtime `_compute_watermark()` is correct — only the seed script is wrong.
- **Repair priority**: P1
- **Status**: REPAIRED (RP-06B, 2026-03-20) — 255 bad entries (not just 35) identified and remediation script created. Seed script hardened with column-type awareness.
- **Repair packet**: RP-06B
- **Fix applied**: (1) `scripts/remediate_watermarks.py` deletes all 255 bad entries + deactivates 3 phantom entity registrations. (2) `scripts/configure_incremental_loads.py:seed_watermark_values()` now column-type-aware: datetime cols get timestamp seed, integer cols get `MAX(wm_col)` from source or are skipped (forces safe full-load re-seed via `_compute_watermark()`)

### [AUDIT-014] Entity references non-existent source table
- **Stage**: Entity registration — `dbo.ipc_CSS_INVT_LOT_MASTER_2` on m3-db1/mes
- **Expected**: Registered entities reference existing source tables
- **Actual**: Table does not exist on source server (SQL error 42S02: Invalid object name)
- **Real vs Stubbed**: Real — table was likely dropped or renamed at source
- **Mismatch**: Entity registered for a phantom table
- **Impact**: 1 entity fails every run
- **Root cause**: Source table removed after entity registration. No validation step checks for this.
- **Repair priority**: P3
- **Status**: REPAIRED (RP-06B, 2026-03-20) — remediation script deactivates all 3 active registrations (including typo variant with space in name)
- **Repair packet**: RP-06B
- **Fix applied**: `scripts/remediate_watermarks.py` deactivates entities 597, 1725, 1727 (entity 1667 was already inactive)

---

## Superseded Entries

_(None yet — this is the initial audit)_
