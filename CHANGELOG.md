# Changelog

All notable changes to the FMD Framework project are documented here.

## [2026-03-13] — Data Source Purge, OneLake FS Integration, Entity Discovery

### Added
- **OneLake filesystem scanner** (`data_access.py`): Scans local OneLake mount to index tables across LZ/Bronze/Silver lakehouses in ~0.02s. Replaces all Fabric SQL Analytics Endpoint calls for record counts and entity status.
- **Entity status sync** (`server.py`): Runs `sync_entity_status_from_filesystem()` on server startup to populate SQLite from OneLake filesystem state.
- **`POST /api/entity-status/sync`** endpoint for manual filesystem re-sync from the dashboard.
- **`POST /api/engine/optimize-all`** endpoint (`engine.py`): Connects to all on-prem source databases over VPN, discovers primary keys and watermark columns, classifies entities as incremental or full-load, updates SQLite. First run: 1,341 PKs (78%), 325 incremental (18.9%).
- **`POST /api/source-manager/discover-all`** endpoint (`source_manager.py`): Queries each SQL source, finds unregistered non-empty tables, auto-registers with LZ/Bronze/Silver cascade. First run: 58 new entities (1,666 → 1,724 total).
- **Source Manager UI buttons**: "Optimize All" (blue) and "Discover & Register" (amber) in the Load Optimization tab toolbar.
- `pyarrow>=14.0.0` to `engine/requirements.txt`.
- 7 new UX audit screenshots for previously uncaptured pages.

### Changed
- **Optimizer threshold** (`engine/optimizer.py`): `MAX_INCREMENTAL_PRIORITY` 3 → 4 to include identity columns as watermark candidates.
- **Admin routes** (`admin.py`): Added config reload and entity registration endpoints (+72 lines).
- **Control plane routes** (`control_plane.py`): Refactored entity count aggregation (+29 lines).
- **Entities routes** (`entities.py`): Improved entity status queries (+24 lines).
- **AppLayout** (`AppLayout.tsx`): Added sidebar navigation items for new pages (+51 lines).
- **AdminGateway** (`AdminGateway.tsx`): Added admin action buttons (+20 lines).
- Standardized `ONELAKE_LOCAL_DIR` → `ONELAKE_MOUNT_PATH` env var across `delta_ingest.py` and `parquet_sync.py`.
- Replaced all `datetime.utcnow()` calls with `datetime.now(timezone.utc)` in `control_plane_db.py`, `metrics_store.py`, `control_plane.py`.
- Updated 28 UX audit screenshots with current page states.

### Removed
- **`server.py.bak`** (9,267-line monolith backup) — the decomposition is complete.
- **`generateMockCounts()`** hardcoded fake data generator from `RecordCounts.tsx` (-70 lines).

### Fixed
- Leading whitespace in entity name `' ipc_CSS_INVT_LOT_MASTER_2'` auto-stripped during discovery.
- `pathlib.Path.iterdir()` hang on OneLake virtual mount — switched to `os.listdir()`.

---

## [2026-03-12] — 42-Page Dashboard Audit, Backend Data Source Fixes

### Fixed
- Audited all 42 dashboard pages and fixed 25+ backend data source bugs where pages called endpoints returning empty arrays, wrong schemas, or stale cached data.
- Audit documentation in `dashboard/app/AUDIT-*.md` files.

---

## [2026-03-11] — Server Refactor (Monolith Decomposition)

### Added
- Route-based architecture: `dashboard/app/api/routes/` with 10 route modules decomposed from 9,267-line `server.py` monolith.
- `router.py` with `@route` and `@sse_route` decorators, `HttpError`, automatic JSON serialization, CORS, query string parsing.
- 25 Jira subtasks (MT-94 through MT-118) tracking the decomposition.

### Changed
- Server startup now uses route autodiscovery instead of a single handler class.
- All endpoints migrated from `do_GET`/`do_POST` methods to `@route`-decorated functions.

---

## [2026-03-10] — Dashboard Audit Batches 1-7

### Fixed
- 42/42 pages audited across 7 batches, 170+ backend bugs fixed.
- 12 `AUDIT-*.md` documents with backend issue annotations.

---

## [2026-03-09] — Entity Registration Complete

### Added
- 1,666 entities registered across 5 production sources (ETQ: 29, M3 ERP: 596, M3C: 187, MES: 445, Optiva: 409).
- Full LZ + Bronze + Silver cascade registration (4,998 entity registrations total).
- `register_entity()` with automatic Bronze/Silver cascade in single atomic operation.

---

## [2026-03-06] — Bronze/Silver Activation Fix

### Fixed
- Root cause analysis and fix for Bronze/Silver layer activation failures.
- Details in `memory/bronze-silver-activation-fix.md`.

---

## [2026-03-02] — Engine v3, Entity Digest Engine

### Added
- Engine v3: 25 files, full endpoint suite, SP auth fix.
- Entity Digest Engine: `sp_BuildEntityDigest`, `sp_UpsertEntityStatus`, `EntityStatusSummary` table.
- `useEntityDigest` hook with module-level singleton cache (30s TTL, request dedup).
- Phase 16 in deploy script for Entity Digest deployment.

### Fixed
- `loader.py` per-entity lakehouse/workspace GUIDs (not config-level).
- Pipeline timeouts: Copy 1h→4h, ExecutePipeline 1h→6h, ForEach 1h→12h.
- 714 entities with empty SourceName causing lookup failures.
- ForEach `batchCount: 15` on all activities to prevent Fabric SQL throttling.
