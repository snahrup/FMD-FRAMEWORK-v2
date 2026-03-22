# FMD Decisions Log

> Append-only architecture decision record.
> Every data-flow, metric, or storage change gets an entry here.
> Old decisions are marked SUPERSEDED, never deleted.
>
> **Format**: Date | Decision | Why | Impact | Supersedes
>
> Last updated: 2026-03-20

---

## Decisions

### [D-001] 2026-03-20 — Establish authoritative data truth system

**Decision**: Created 5 authoritative documents in `docs/architecture/`:
- `FMD_DATA_BIBLE.md` — human-readable data flow truth
- `FMD_DATA_REGISTRY.yaml` — machine-readable page→endpoint→table map
- `FMD_METRIC_DEFINITIONS.md` — every KPI formula and source
- `FMD_PIPELINE_TRUTH_AUDIT.md` — append-only mismatch ledger
- `FMD_DECISIONS_LOG.md` — this file

**Why**: Dashboard shows wrong/zero data despite 79K successful load entries and 7.7B rows in SQLite. Root cause: no single source of truth for which tables/endpoints are authoritative vs cached. Each Claude session reinvents understanding from scratch. Steve's bosses are seeing empty dashboards.

**Impact**: All future data-flow fixes must update these docs. Claude sessions must read `FMD_DATA_BIBLE.md` before touching dashboard data. No more chasing phantom data sources.

**Supersedes**: Ad-hoc `docs/data-source-audit.html` (still valid for page-level audit but no longer the primary reference)

---

### [D-002] 2026-03-20 — engine_task_log is the SOLE authoritative source for load status and row counts

**Decision**: `engine_task_log` is the only table that should be used for:
- Load status (succeeded/failed/skipped)
- Row counts (RowsRead, RowsWritten)
- Load freshness (created_at timestamps)
- Error analysis (ErrorType, ErrorMessage)

**Why**: The engine writes comprehensive structured logs to this table for every entity, every layer, every run. It's always current, always complete. Other sources (`lakehouse_row_counts`, `entity_status`, Fabric SQL endpoint) are either empty, stale, deprecated, or have multi-week sync lag.

**Impact**:
- `lakehouse_row_counts` demoted to optional cross-check only
- `entity_status` demoted to legacy/deprecated
- Fabric SQL endpoint demoted to ad-hoc exploration only
- All dashboard endpoints that read from the above must be migrated to `engine_task_log`

**Supersedes**: Previous assumption that `lakehouse_row_counts` + SQL endpoint were the "physical truth"

---

### [D-003] 2026-03-20 — entity_status table is DEPRECATED

**Decision**: The `entity_status` table is deprecated. It is still written by `engine/logging_db.py` for backward compatibility but should NOT be read by any dashboard endpoint.

**Why**: `entity_status` was the v2 status tracking mechanism. The v3 engine writes to both `entity_status` and `engine_task_log`, but `entity_status` updates may fail silently in some error paths, leading to disagreements between the two tables.

**Impact**: Pages currently reading `entity_status` (ExecutionMatrix, BusinessCatalog, SourceManager, BusinessSources via `/api/overview/entities`) need migration to derive status from `engine_task_log` instead.

**Supersedes**: v2 design where `entity_status` was the primary status table

---

### [D-004] 2026-03-20 — No fix is complete without updating truth docs

**Decision**: The following rule is now in effect:

> No data-flow, metric, storage, or dashboard-source fix is considered complete until `FMD_DATA_BIBLE.md`, `FMD_DATA_REGISTRY.yaml`, `FMD_METRIC_DEFINITIONS.md`, and `FMD_PIPELINE_TRUTH_AUDIT.md` are updated to reflect the change.

**Why**: Without this rule, each repair creates new undocumented truth that the next session won't know about, perpetuating the "numbers game" of chasing where data comes from.

**Impact**: Slightly slower fix velocity, massively reduced confusion and rework.

**Supersedes**: None (new policy)

---

### [D-005] 2026-03-20 — RP-01: Load Center rewired from lakehouse_row_counts to engine_task_log

**Decision**: `GET /api/load-center/status` now uses `_get_counts_from_log()` (engine_task_log) as primary data source. `lakehouse_row_counts` is optional enrichment for row counts when populated. `GET /api/load-center/source-detail` now falls back to engine_task_log.RowsWritten when physical scan is unavailable, with explicit `rowSource` field per layer.

**Why**: Load Center showed all zeros for every source because `lakehouse_row_counts` was empty (never auto-populated, requires manual refresh that hits a Fabric SQL endpoint with 2-3 week sync lag). Meanwhile `engine_task_log` had 79K entries with 7.7B rows of actual load history.

**Impact**:
- Load Center immediately shows real data from engine run history
- Table counts reflect entities with at least one successful load (not just registered)
- Row counts come from engine RowsWritten (latest successful run per entity per layer)
- For incremental loads, RowsWritten is the delta not total — labeled as "rows written" in UI
- Frontend subtitle changed from "Physical tables from lakehouse scan" to "Successfully loaded tables and rows from engine run history"
- `lakehouse_row_counts` remains available via "Refresh Counts" button for optional physical scan enrichment

**Supersedes**: Previous design where `lakehouse_row_counts` was the primary data source for Load Center

---

### [D-006] 2026-03-20 — RP-02: Overview KPIs rewired with two-tier freshness + loaded vs registered

**Decision**: `GET /api/overview/kpis` now uses:
1. **Two-tier freshness**: 24h recency (primary) → ever-loaded coverage (fallback). Prevents 0% after one failed run.
2. **Smarter alerts**: Never-succeeded entities + consistently-failing entities (no success in 7 days AND latest is failed). Prevents "one failed run = 1,500 alerts."
3. **Loaded vs registered**: New `loaded_entities` field (entities with at least one successful load) alongside `total_entities` (registered). Frontend shows "N / M" with clear labels.
4. **New response fields**: `freshness_ever_loaded`, `freshness_last_success`, `loaded_entities`.

**Why**: Overview page showed 0% freshness, 1,500+ alerts, and 1,728 "tables" after one failed run on 2026-03-20. The 24h-only window, latest-status-only alert logic, and registered=loaded conflation made the overview page misleading during normal operations.

**Impact**:
- Freshness never drops to 0% when data has been loaded historically
- Alerts reflect genuinely broken entities, not transient failures
- Tables card honestly shows loaded/registered distinction
- Frontend subtitle adapts: "refreshed in last 24h" vs "ever loaded" + last success timestamp
- `overview.py` sources endpoint now reads `engine_task_log` instead of `entity_status` (partial RP-03)
- `overview.py` entities endpoint now reads `engine_task_log` instead of `entity_status` (partial RP-03)

**Supersedes**: Previous implementation where freshness was 24h-only, alerts were latest-status-only, and total_entities was the only count.

---

### [D-007] 2026-03-20 — RP-03: entity_status fully deprecated — all routes read engine_task_log

**Decision**: No dashboard route reads the `entity_status` table for display purposes. All status is derived from `engine_task_log` via `get_canonical_entity_status()`.

Catalog of changes:
1. `entities.py` (`GET /api/entity-digest`) — already used `get_canonical_entity_status()` (pre-existing)
2. `control_plane.py` (`GET /api/execution-matrix`) — already used `get_canonical_entity_status()` (pre-existing)
3. `overview.py` (all endpoints) — migrated to direct engine_task_log queries (RP-02)
4. `quality_engine.py` — already queried engine_task_log directly (pre-existing)
5. `server.py` startup sync — **removed** (was writing to entity_status that nothing reads)
6. `data_access.py` sync endpoint — already a no-op (pre-existing deprecation)

Surviving intentional entity_status dependencies:
- `engine/logging_db.py` still WRITES to entity_status (backward compat for remote/sync consumers)
- `upsert_entity_status()` kept for engine backward compat
- `get_entity_status_all()` kept for admin table browser (`data_manager.py`)
- `delta_ingest.py` and `parquet_sync.py` include entity_status in sync config (remote consumers)
- CREATE TABLE and CREATE INDEX kept (schema must exist for writes)

**Why**: Pages reading `entity_status` could show different status than pages reading `engine_task_log` because `entity_status` doesn't update in all error paths. This caused "succeeded on one page, failed on another" inconsistencies (AUDIT-004).

**Impact**:
- Status is now consistent across all dashboard pages
- Single source of truth for entity status: `engine_task_log`
- Server startup is slightly faster (no filesystem scan to populate dead table)
- `entity_status` table still exists and is still written — but no user-facing page reads it

**Supersedes**: [D-003] partial — D-003 declared entity_status deprecated but routes still read it. D-007 completes the migration.

---

### [D-008] 2026-03-20 — RP-04: Incremental vs full load row counts explicitly distinguished

**Decision**: Load Center now distinguishes full-load row totals from incremental deltas in both backend response fields and frontend display.

Backend changes:
- `GET /api/load-center/status` response includes per-layer breakdown: `fullLoadTables`, `fullLoadRows`, `incrementalTables`, `incrementalDeltaRows` alongside existing `tables`/`rows`
- `GET /api/load-center/source-detail` already returns `{layer}RowSource` with values `"physical_scan"`, `"engine_log"`, `"engine_log_incremental"`

Frontend changes:
- KPI sub-labels adapt: "X rows written" (all full), "X incremental deltas" (all incremental), or "X rows written (Y deltas from Z incr.)" (mixed)
- Detail table cells show "Δ" indicator with tooltip for incremental delta values
- LayerBar shows "*" suffix when rows include incremental deltas

**Why**: `engine_task_log.RowsWritten` for incremental loads is the delta (new/changed rows from last run), not the total table size. Showing "50 rows" for a table that actually has 1M rows massively undercounts data volume. Users need to know which numbers are totals and which are deltas.

**Impact**:
- No number is silently relabeled — the distinction is explicit
- Physical scan (Refresh Counts) remains the only way to get true totals for incremental entities
- Backend response is backward-compatible (new fields are additive)

**Supersedes**: Previous display where all RowsWritten values were labeled uniformly as "rows written" regardless of load type

---

### [D-009] 2026-03-20 — RP-05: Load Center run state persisted to SQLite

**Decision**: Load Center run state is now persisted to a `load_center_runs` table in SQLite, eliminating state amnesia on navigation and restart.

Architecture:
- **In-memory `_run_state`**: Hot cache for the active run. Background thread writes progress here frequently.
- **SQLite `load_center_runs`**: Durable record. Written at key transitions: start, phase change (gap_fill → loading → engine_running), complete, fail.
- **Precedence**: `GET /api/load-center/run-status` returns in-memory state if active, falls back to SQLite for the most recent run otherwise.
- **Restart safety**: On module load, any runs marked `active=1` in SQLite are set to `phase='interrupted'` with a timestamp. This handles server crashes mid-run.

Schema:
```sql
CREATE TABLE load_center_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL, completed_at TEXT,
    phase TEXT NOT NULL DEFAULT 'starting',
    active INTEGER NOT NULL DEFAULT 1,
    plan_json TEXT, progress_json TEXT, error TEXT,
    triggered_by TEXT DEFAULT 'load_center'
);
```

**Why**: `_run_state` was a module-level dict in `load_center.py`. Lost on server restart. Lost when user navigated away and the frontend re-fetched. Produced "Load Everything" button appearing ready when a load was already running.

**Impact**:
- Run state survives page navigation and server restart
- Interrupted runs are explicitly detected and labeled
- No competing truth system — SQLite is the durable layer, in-memory is the hot cache
- `engine_task_log` remains the authoritative source for load results; `load_center_runs` tracks operational run lifecycle only

**Supersedes**: Previous in-memory-only `_run_state` dict

---

### [D-010] 2026-03-20 — RP-06: 3/20 extraction failures triaged — 3 root causes, 0 engine code bugs

**Decision**: The 3/20 extraction failures (5,655 of 5,706 tasks) have been fully triaged. Three root causes identified:
1. **VPN/network outage** (99.3%): All 5 source servers unreachable. Ops fix, not code.
2. **Watermark type mismatch** (35 entities): `seed_watermark_values()` wrote pipeline timestamps as watermarks for integer ID columns. Fix: delete bad entries + fix seed script.
3. **Missing source table** (1 entity): `ipc_CSS_INVT_LOT_MASTER_2` no longer exists. Fix: deactivate entity.

**Why**: AUDIT-009 flagged 1,595 failed entities. Investigation revealed the engine extraction code itself is correct — `build_source_query()` and `_compute_watermark()` work properly. All failures trace to upstream causes (network, bad seed data, missing table).

**Impact**:
- No engine code changes needed for the 99.3% majority (VPN fix is operational)
- 35 watermark entries need deletion from SQLite `watermarks` table
- `scripts/configure_incremental_loads.py` needs column-type-aware seeding to prevent recurrence
- 1 entity needs deactivation
- Full audit documented in `docs/architecture/RP-06_EXTRACTION_FAILURE_AUDIT.md`

**Supersedes**: None (new investigation)

---

### [D-011] 2026-03-20 — RP-06B: Watermark seeding is now column-type-aware

**Decision**: `seed_watermark_values()` in `scripts/configure_incremental_loads.py` now detects whether a watermark column is datetime or integer before seeding:
- **Datetime columns**: Seeded from pipeline execution timestamp (existing behavior, which is safe for datetime comparisons)
- **Integer/identity columns**: Seeded from `MAX([wm_col])` captured during discovery, or skipped if unavailable (forces full-load, which self-seeds correctly via `_compute_watermark()`)
- **Unknown type**: Skipped (safe default)

One-time remediation: `scripts/remediate_watermarks.py` deletes 255 corrupted watermark entries and deactivates 3 phantom entity registrations for non-existent table `ipc_CSS_INVT_LOT_MASTER_2`.

**Why**: The original `seed_watermark_values()` wrote pipeline execution timestamps as watermark values for ALL incremental entities regardless of column type. This caused 35+ SQL type conversion errors on integer watermark columns and incorrect incremental windows on 220+ datetime columns.

**Impact**:
- Watermark seeding will never produce type mismatches again
- Discovery step now captures `MAX(wm_col)` for identity columns (reusable for seeding)
- 255 entities will do one full-load cycle on next run, then self-correct via `_compute_watermark()`
- 3 phantom entity registrations deactivated (will no longer fail every run)
- Remediation script is idempotent — safe to re-run

**Supersedes**: None (new fix for bug discovered in RP-06 audit)

---

### [D-012] 2026-03-22 — RP-07: Gold Studio honest labels — frontend discloses feature maturity

**Decision**: Gold Studio frontend pages now honestly label the maturity level of each capability:

1. **Clustering**: Stats strip shows "name-only" qualifier on confidence metric. Maturity notice below stats: "Clustering uses exact name matching within each division. Confidence is fixed at 80%. Fuzzy and schema-aware matching are planned."
2. **"Promote to Canonical"** → renamed to **"Mark Standalone"** (button only sets provenance flag, doesn't create canonical entity)
3. **Validation**: "Validation Rules" → "Validation Checks" with subtitle "Structure only — checks SQL, columns, and target name. Data validation and reconciliation are planned." Button changed from "Run Validation" → "Run Structure Check."
4. **Reconciliation**: Section labeled "Manual entry only — automatic legacy-vs-gold comparison is planned."
5. **Schema Discovery**: No frontend change (not exposed as a button). Backend stub documented in AUDIT-011.

**Why**: AUDIT-011 identified that Gold Studio frontend implies sophisticated capabilities (ML clustering, comprehensive validation, automated reconciliation) that don't exist yet. Users seeing "80% confidence" or "Validated" status may over-trust results that are based on trivial checks. Honest labels set correct expectations without removing functionality.

**Impact**:
- No backend changes — all capabilities still work exactly as before
- Users can clearly distinguish what's real vs planned
- No features removed — only labels made honest
- GoldMlvManager.tsx already had honest "Coming Soon" / "Labs" labels (no change needed)

**Supersedes**: None (first honest-label pass for Gold Studio)

---

### [D-013] 2026-03-22 — RP-08: Load Center refresh polling + empty state

**Decision**: Two Load Center UX fixes:
1. **Refresh polling**: `handleRefresh` now polls `GET /status` every 2s until `refreshRunning` becomes false, instead of a hardcoded 2s `setTimeout`. Each poll updates the UI with fresh data, so the user sees progress in real time.
2. **Empty state**: When `status.sources` is empty (no loaded data), the page now shows a guidance panel with icon, explanation text, and action buttons (Preview Run + Refresh from SQL Endpoint) instead of a blank table.

**Why**: The hardcoded 2s timeout was a known fragile pattern — SQL Endpoint scans can take 10-30s depending on Fabric load, so the frontend would reload before the scan completed and show stale data. The empty state was missing entirely — new installs or fresh environments showed zeros with no explanation of what to do.

**Impact**:
- Refresh button stays in "refreshing" state until the scan actually finishes
- UI updates progressively during the poll (user sees counts ticking up)
- Max poll duration: ~2 minutes (60 iterations × 2s), then gives up gracefully
- Empty state guides new users toward Source Manager registration and first load
- No backend changes required — all fixes are frontend-only

**Supersedes**: None

---

## Template for New Entries

```
### [D-NNN] YYYY-MM-DD — Title

**Decision**: What was decided

**Why**: What prompted this decision

**Impact**: What changes as a result

**Supersedes**: [D-XXX] or "None"
```
