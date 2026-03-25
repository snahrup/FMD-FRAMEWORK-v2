# Pipeline Tooling Integration — Truth Audit + Spec

**Date:** 2026-03-24
**Author:** Steve Nahrup
**Scope:** 5 packets — ConnectorX, Pandera, delta-rs writes, Presidio + Purview, Data Estate
**Source Brief:** `C:\Users\sasnahrup\Downloads\build_progress_testing.md`

---

## 1. TRUTH AUDIT

### What exists today (verified via code audit)

| Component | Current State | Real or Stubbed |
|-----------|--------------|-----------------|
| **Extraction** | pyodbc + Windows Auth → Polars DataFrame → Parquet bytes | REAL — `engine/extractor.py` (338 lines) |
| **Loading (LZ)** | Parquet upload via filesystem mount or ADLS SDK | REAL — `engine/loader.py` (403 lines) |
| **Bronze processing** | Read LZ parquet → clean → hash PKs → dedup → hash non-keys → write Delta | REAL — `engine/bronze_processor.py` (221 lines) |
| **Silver processing** | Read Bronze Delta → SCD Type 2 (inserts/updates/deletes) → write Silver Delta | REAL — `engine/silver_processor.py` (256 lines) |
| **Delta I/O** | `onelake_io.py` already uses `df.write_delta()` (Polars/delta-rs) for both filesystem + ADLS | REAL — both read and write paths work |
| **Schema validation** | None. Zero type checks, null checks, or range validation anywhere in pipeline | ABSENT |
| **Classification page** | Frontend renders real data, API routes work, pattern classifier works | REAL but EMPTY — column_metadata not populated |
| **Presidio integration** | Code path exists in `classification_engine.py`, gracefully skips if not installed | REAL but INACTIVE — package not installed |
| **Classification DB tables** | `column_metadata` + `column_classifications` tables exist in SQLite | REAL but EMPTY |
| **LoadMissionControl timing** | Elapsed + Throughput KPIs displayed, per-entity duration tracked | REAL |
| **Notebook triggering** | Fallback path for Bronze/Silver when `load_method != "local"` | REAL — used when local processing disabled |

### What the spec proposes vs what actually needs building

| Spec Proposal | Reality | Actual Work Needed |
|---------------|---------|-------------------|
| ConnectorX replaces pyodbc | Correct — clean swap point in `extractor.py` | Rewrite `DataExtractor.extract()` to use `cx.read_sql()`. Change auth from Windows Auth to SQL Auth. |
| delta-rs writes to OneLake | **Already done** — `onelake_io.py` uses `df.write_delta()` | Make local Delta the default mode. Remove notebook fallback as primary path. Minor. |
| Pandera schema validation | Correct — zero validation exists | New `engine/schemas/` module. Validation step in orchestrator between extract and load. |
| Presidio PII scanning | **Code already exists** — just not activated | Install `presidio-analyzer`. Auto-populate `column_metadata` during loads. Wire scan into post-load flow. |
| dlt framework | Unnecessary — orchestrator already handles watermarks/incremental state | **SKIP** |
| Soda Core | Would add quality gates but can build in Python | **SKIP** (revisit later) |
| PyOD outlier detection | Low signal-to-noise for string-heavy M3/MES tables | **SKIP** |
| OpenMetadata catalog | Separate platform to deploy — massive overhead | **SKIP** |

### Misleading UI / Frontend Lies

| Page | What it says | What's real |
|------|-------------|-------------|
| DataClassification.tsx | Shows "Classification Engine Not Yet Active" banner | **Accurate** — engine exists but column_metadata is empty |
| DataClassification.tsx | KPIs show 1,666 total entities | **Real** — from `lz_entities` count |
| DataClassification.tsx | All classification counts show 0 | **Accurate** — no scan has been run, tables are empty |
| LoadMissionControl.tsx | Throughput KPI shows rows/sec | **Real** — calculated from `engine_task_log` |
| LoadMissionControl.tsx | Timeline data available but no chart | **Real data, no UI** — minute-level progression returned by API but not rendered |

---

## 2. PACKET DEFINITIONS

### Packet A: ConnectorX High-Speed Extraction

**Purpose:** Replace pyodbc with ConnectorX for 5-13x faster SQL Server extraction.

**Scope:**
- Engine changes only (no new pages)
- Speed metrics surface on existing LoadMissionControl KPIs

**Engine Changes:**

1. **`engine/extractor.py`** — Rewrite `DataExtractor.extract()`:
   - Replace `pyodbc.connect()` + `cursor.execute()` + `fetchmany()` with `cx.read_sql()`
   - Output: Use `return_type="polars2"` (native Polars path, avoids Arrow→Polars conversion overhead)
   - Remove chunked fetch loop (ConnectorX handles batching internally)
   - Keep: watermark computation, binary column filtering, error diagnostics
   - Add: partitioned parallel reads for large tables (configurable `partition_on` + `partition_num`)

2. **`engine/connections.py`** — Add ConnectorX connection string builder:
   - Current: Windows Auth (`Trusted_Connection=yes`) via pyodbc
   - New: SQL Auth (`mssql://user:pass@host:port/db`) for ConnectorX
   - ConnectorX does NOT support Windows Auth — must use SQL Auth credentials
   - Credentials from config (new fields: `sql_username`, `sql_password`)
   - URL-encode special characters in password (e.g., `@` → `%40`)

3. **`engine/models.py`** — Add to `EngineConfig`:
   - `sql_username: str` — SQL Server login
   - `sql_password: str` — SQL Server password
   - `use_connectorx: bool = True` — feature flag for rollback
   - Optional per-entity: `partition_on: str`, `partition_num: int`

4. **`config/` changes:**
   - SQL Auth credentials stored in **environment variables** (never plaintext in config.json):
     - `FMD_SQL_USERNAME` — SQL Server login (e.g., `UsrSQLRead`)
     - `FMD_SQL_PASSWORD` — SQL Server password
   - `config.json` references: `"sql_username": "${FMD_SQL_USERNAME}"`, `"sql_password": "${FMD_SQL_PASSWORD}"`
   - On vsc-fabric server: set via NSSM service environment or Windows system env vars
   - Future: migrate to Azure Key Vault when available
   - `source_systems.yaml`: optional `partition_on` / `partition_num` per table

5. **`engine/requirements.txt`** — Add `connectorx`

**Auth Consideration — DEPLOYMENT BLOCKER:**
- ConnectorX uses connection-string auth (SQL login), not Windows Auth
- The entire FMD framework currently uses Windows Auth (`Trusted_Connection=yes`) on all 5 source servers
- **Pre-requisite:** DBA must create SQL login (`UsrSQLRead`) with `db_datareader` on all source databases:
  - `m3-db1` (MES, M3 FDB)
  - `M3-DB3` (ETQ, SysAid, Scheduling55)
  - `sqllogshipprd` (M3 ERP prod)
  - `sql2016live` (M3 Cloud)
  - `sqloptivalive` (OPTIVA)
- **If SQL Auth is not approved:** Keep pyodbc as primary (`use_connectorx=False`). ConnectorX becomes a future upgrade once SQL Auth is available.
- **Security:** Credentials MUST be in env vars, never in config.json or source control

**Dashboard Changes:**
- None required — existing Throughput + Elapsed KPIs on LoadMissionControl will automatically reflect speed improvements
- Optional: Add "Extraction Engine" badge (ConnectorX vs pyodbc) to run detail view

**Risk:** SQL Auth availability on source servers. If only Windows Auth is allowed, ConnectorX cannot be used. Feature flag enables rollback.

---

### Packet B: Pandera Schema Validation

**Purpose:** Add schema-as-code validation between extraction and loading to catch bad data before it reaches the Lakehouse.

**Scope:**
- New engine module (`engine/schemas/`)
- New dashboard page (Schema Validation)
- New API routes
- New control_plane_db table

**Engine Changes:**

1. **New module: `engine/schemas/`**
   - `__init__.py` — Schema registry: `dict[str, type]` mapping `source.table` → Pandera schema class
   - `m3_schemas.py` — Pandera DataFrameModel classes for M3 tables (MITMAS, OOLINE, CIDMAS, etc.)
   - `mes_schemas.py` — Pandera DataFrameModel classes for MES tables
   - `etq_schemas.py` — Pandera DataFrameModel classes for ETQ tables
   - `base.py` — Base schema with common fields (RecordLoadDate, hashed columns)
   - Schema generation: Start with top 20 most-loaded tables, expand over time
   - All schemas use `strict=False` (allow extra columns) + `coerce=True` (type coercion)

2. **New: `engine/schema_validator.py`**
   - `validate_extraction(df: pl.DataFrame, source: str, table: str) -> ValidationResult`
   - Returns: passed/failed, error count, error details (column, check, message)
   - Tables without registered schemas pass with a warning (no blocking)
   - Validation runs AFTER extraction, BEFORE Parquet write

3. **`engine/orchestrator.py`** — Wire validation into extraction flow:
   - After `DataExtractor.extract()` returns DataFrame
   - Before `OneLakeLoader.upload()` writes Parquet
   - If validation fails: log error, mark entity as `failed` with validation errors, skip upload
   - Configurable: `validation_mode: "enforce" | "warn" | "off"` (default: "warn" initially)

4. **`dashboard/app/api/control_plane_db.py`** — New SQLite table (NOT Fabric SQL DB):
   - `schema_validations` table: `run_id, entity_id, layer, passed, error_count, errors_json, validated_at`
   - Lives in SQLite control-plane DB alongside `column_classifications`, `quality_scores`, etc.
   - Engine writes results via `POST /api/schema-validation/result` (same pattern as engine task logging)
   - Dashboard API routes read directly from SQLite — no cross-boundary access needed
   - **Rationale:** Validation results are consumed by the dashboard, not the Fabric SQL metadata DB. SQLite keeps the query path simple.

**Dashboard Changes:**

1. **New page: `SchemaValidation.tsx`**
   - KPI strip: Total validated, Passed, Failed, Warnings, Coverage %
   - Run-level view: Per-run validation results (expandable per entity)
   - Entity drilldown: Column-level errors (which column, which check, what value failed)
   - Schema health: Which entities have schemas registered vs not
   - Filter by: source, run, status (pass/fail/warn)

2. **New API routes: `dashboard/app/api/routes/schema_validation.py`**
   - `GET /api/schema-validation/summary` — aggregate pass/fail counts
   - `GET /api/schema-validation/run/{run_id}` — per-run results
   - `GET /api/schema-validation/entity/{entity_id}` — entity history
   - `GET /api/schema-validation/coverage` — which entities have schemas

3. **Navigation:** Add "Schema Validation" under Quality group in sidebar

**Rollout Strategy:**
- Phase 1: `validation_mode: "warn"` — log failures but don't block loads
- Phase 2: After schemas stabilize, switch to `validation_mode: "enforce"` for critical tables
- Phase 3: Expand schema coverage beyond top 20 tables

---

### Packet C: delta-rs Direct Writes (Default Mode)

**Purpose:** Make local Delta processing the default path, eliminating Fabric notebook dependency for Bronze/Silver loads.

**Scope:**
- Engine config change (minor)
- No new pages — metrics already surface on LoadMissionControl

**Engine Changes:**

1. **`engine/config.py`** — Change fallback default:
   - `models.py` already defaults `load_method` to `"local"` (line 313)
   - But `config.py` line 130 overrides: `engine_section.get("load_method", "notebook")` — fallback is `"notebook"`
   - **Fix:** Change `config.py` line 130 fallback from `"notebook"` to `"local"`
   - Also explicitly set `"load_method": "local"` in `dashboard/app/api/config.json` engine section
   - Keep notebook path as documented fallback (don't delete code)
   - Config: `load_method: "local" | "notebook" | "pipeline"` (runtime-changeable via API)

2. **`engine/onelake_io.py`** — Verify + harden:
   - Write path already uses `df.write_delta()` with `schema_mode: "overwrite"` ✅
   - Timezone stripping already handles `timestampNtz` requirement ✅
   - ADLS fallback already works with SP token ✅
   - **Add:** Delta table compaction every 10 writes per table (VACUUM with 7-day retention, configurable via `EngineConfig.delta_compact_interval` and `delta_vacuum_retention_days`)
   - **Add:** Write verification — read back row count after write, compare to input

3. **`engine/bronze_processor.py`** — Minor hardening:
   - Add write verification (row count check after `write_delta`)
   - Log Delta table version after write

4. **`engine/silver_processor.py`** — Minor hardening:
   - Same write verification
   - Log SCD statistics (inserts, updates, deletes, unchanged) more prominently

**Dashboard Changes:**
- Optional: Add "Processing Mode" indicator to run detail (Local vs Notebook)
- Speed improvement will automatically reflect in existing Throughput/Elapsed KPIs

**Risk:** Low — local processing already works and is tested. The change is making it the default.

---

### Packet D: Presidio Classification (Activate Existing)

**Purpose:** Activate the existing classification pipeline by installing Presidio, auto-populating column metadata during loads, and enhancing the DataClassification page.

**Scope:**
- Install package + wire auto-population
- Enhance existing page (not new page)
- Small engine change (schema capture during loads)

**Engine Changes:**

1. **`engine/requirements.txt`** — Add:
   - `presidio-analyzer`
   - `presidio-anonymizer` (for future masking)
   - `spacy` + `en_core_web_sm` model (~12MB, per prior MDM spec decision — upgrade to `en_core_web_lg` later if accuracy insufficient)

2. **`engine/orchestrator.py`** — Wire schema capture into post-load flow:
   - After successful LZ upload: query Fabric SQL Endpoint for column metadata
   - Call existing `_cache_columns()` from `lineage.py` to populate `column_metadata`
   - This triggers classification pipeline to have data to work with

3. **`dashboard/app/api/services/classification_engine.py`** — Already complete:
   - `classify_by_pattern()` — works ✅
   - `classify_by_presidio()` — works if installed ✅
   - Just needs `presidio-analyzer` in the environment

4. **Auto-classification trigger:**
   - After schema capture completes, auto-run pattern classification
   - Presidio scan runs on-demand (POST /api/classification/scan) or scheduled
   - Don't run Presidio on every load — it's slow (NLP model per column per sample)

**Database Changes:**

1. **New table: `classification_type_mappings`**
   - Maps internal classification types → Microsoft Purview classification IDs
   - Columns: `internal_type` (e.g., "PERSON"), `purview_type` (e.g., "MICROSOFT.PERSONAL.NAME"), `sensitivity_label` (e.g., "Confidential"), `description`, `is_active`
   - Pre-seeded with all Presidio entity type → Purview mappings
   - Extensible: add custom mappings for domain-specific classifications

2. **New table: `purview_sync_log`**
   - Tracks sync history: `sync_id`, `direction` ("push"|"pull"), `status`, `entities_synced`, `classifications_synced`, `started_at`, `completed_at`, `error`
   - Enables "last synced" display and audit trail

**Dashboard Changes:**

1. **Enhance `DataClassification.tsx`:**
   - Remove "Classification Engine Not Yet Active" banner (it will be active)
   - Add "Last Scan" timestamp + "Scan Now" button
   - Add PII confidence column to entity table
   - Add column-level drilldown: click entity → see columns with PII types + confidence scores
   - Add sensitivity badge to columns (🔴 PII, 🟡 Confidential, 🟢 Public)

2. **Purview Integration Panel (hero feature for exec demos):**
   - **Prominent "Microsoft Purview" section** at top of DataClassification page
   - Purview logo + connection status indicator (Connected / Ready to Connect / Not Configured)
   - **"Sync to Purview" button** — one-click push of all classifications to Purview catalog
   - **"Import from Purview" button** — pull Purview's classifications into our system
   - **Sync status card:** Last synced timestamp, entities synced count, classifications pushed count
   - **Mapping coverage indicator:** "47/52 classification types mapped to Purview" with progress ring
   - **Sync history table:** Recent sync operations with direction, status, counts
   - When Purview is NOT configured: Panel shows "Ready for Purview" state with setup instructions + a visual showing the mapping is already built — demonstrates forethought
   - **Key demo moment:** Exec sees "1,247 columns classified → Sync to Purview" button → instantly understand the pipeline feeds into enterprise governance

3. **Enhance existing API routes** (`dashboard/app/api/routes/classification.py`):
   - All 4 endpoints already work ✅
   - Add: `GET /api/classification/entity/{entity_id}/columns` — column-level detail with PII types
   - Add: `POST /api/classification/entity/{entity_id}/override` — manual sensitivity override
   - Add: `GET /api/classification/purview/status` — Purview connection state + mapping coverage
   - Add: `POST /api/classification/purview/sync` — trigger Purview sync (push)
   - Add: `POST /api/classification/purview/import` — trigger Purview import (pull)
   - Add: `GET /api/classification/purview/history` — sync history log
   - Add: `GET /api/classification/purview/mappings` — type mapping table (editable)

4. **Cross-page integration:**
   - Add PII badge to DataProfiler column cards
   - Add "Sensitive" indicator to DataMicroscope column lineage view
   - Add classification status to entity digest (useEntityDigest hook)
   - Add "Purview Synced" badge on classified entities (shows governance compliance)

**Purview API Integration (future Packet E, but UI scaffolded now):**
- Purview REST API: `POST /catalog/api/atlas/v2/entity/bulk` for pushing classifications
- Purview REST API: `GET /catalog/api/atlas/v2/glossary` for pulling terms
- Auth: Same SP token flow (add `https://purview.azure.net/.default` scope)
- The sync script is a lightweight future addition — the UI, mapping table, and data model are built NOW

---

## 3. BUILD ORDER

```
Packet C (delta-rs default) → Packet A (ConnectorX) → Packet B (Pandera) → Packet D (Presidio + Purview) → Packet E (Data Estate)
```

**Rationale:**
1. **Packet C first** — smallest change, biggest risk reduction (eliminates notebook dependency). Makes all subsequent testing faster.
2. **Packet A second** — extraction speed. Every test run after this is 5-13x faster.
3. **Packet B third** — schema validation. Now that extraction is fast, validation overhead is proportionally smaller.
4. **Packet D fourth** — classification is governance, not speed/reliability. Depends on column_metadata being populated (which requires loads to run).
5. **Packet E last** — Data Estate visualization. Requires all other packets to be working so it has real data to display. This is the crown jewel demo page.

---

### Packet E: Data Estate Visualization (Crown Jewel)

**Purpose:** A premium, animated, executive-grade visualization of the entire data pipeline — sources through governance. The page that makes execs say "they've thought about everything." If this can't be made genuinely next-level, it doesn't ship.

**Scope:**
- New page: `DataEstate.tsx`
- New API route aggregating cross-system metrics
- Full `/interface-design` treatment — premium motion, animation, transitions

**Design Requirements (non-negotiable):**

1. **Living Pipeline Flow** — NOT a static diagram
   - Animated data particles flowing: Source Systems → Landing Zone → Bronze → Silver → Gold
   - Each node is interactive — hover shows live stats, click drills into detail page
   - Flow speed reflects actual throughput (faster flow = higher rows/sec)
   - Particle color reflects data quality (green = healthy, amber = warnings, red = failures)
   - Seamless spring-based transitions when data updates (Framer Motion)

2. **Source System Constellation**
   - Left side: Source systems (MES, ETQ, M3 ERP, M3 Cloud, OPTIVA, etc.) as nodes
   - Each source shows: entity count, last extraction time, health status
   - Connection lines animate during active loads
   - Sources scale to N (dynamic — never hardcoded)

3. **Lakehouse Layer Progression**
   - Center: Medallion layers as elevated cards or zones
   - Per-layer metrics: entity coverage %, physical row counts, last load time
   - Layer-to-layer arrows show transformation status
   - Schema validation health badge per layer (from Packet B)

4. **Classification & Governance Overlay**
   - Right side or overlay: Classification coverage heatmap
   - PII detection count with sensitivity breakdown
   - Purview sync status badge (prominent — "Synced" / "Ready" / "Pending")
   - "Governance Score" composite metric — combines classification coverage + schema validation + freshness

5. **Premium Motion & Animation (MANDATORY)**
   - Page entrance: Staggered fade-in of zones (left → center → right), 300-500ms per zone
   - Data particles: Continuous subtle flow animation (CSS/canvas, not JS-heavy)
   - Hover states: Cards lift with spring physics (Framer Motion `whileHover`)
   - Transitions: Layout changes use `AnimatePresence` + `layout` prop
   - Number changes: Animated counters (already have `AnimatedCounter.tsx` component)
   - Status changes: Smooth color transitions (not instant swaps)
   - Drill-through: Click node → page transition with shared-element animation (node expands into detail page)
   - Idle state: Subtle ambient motion — particles drift, nodes breathe slightly
   - Performance: 60fps on mid-range hardware. Use `will-change`, GPU-composited layers, `requestAnimationFrame` for canvas elements

6. **Responsive Layout**
   - Full-width hero section (no sidebar compression)
   - Adapts from horizontal flow (wide screens) to vertical flow (narrow)
   - Touch-friendly on tablet for exec demos

7. **Data Sources:**
   - Source systems: `GET /api/overview/sources`
   - Layer stats: `GET /api/lmc/progress` + `GET /api/entity-digest`
   - Classification: `GET /api/classification/summary`
   - Schema validation: `GET /api/schema-validation/summary` (from Packet B)
   - Purview: `GET /api/classification/purview/status` (from Packet D)
   - Freshness: `GET /api/overview/activity`

**New Files:**
- `dashboard/app/src/pages/DataEstate.tsx` — main page
- `dashboard/app/src/components/estate/` — component directory:
  - `PipelineFlow.tsx` — animated source → layer flow (canvas or SVG)
  - `SourceNode.tsx` — individual source system card
  - `LayerZone.tsx` — medallion layer card with metrics
  - `GovernancePanel.tsx` — classification + Purview overlay
  - `DataParticle.tsx` — animated particle system
  - `GovernanceScore.tsx` — composite governance metric ring
- `dashboard/app/api/routes/data_estate.py` — aggregation endpoint

**New API Routes:**
- `GET /api/estate/overview` — single aggregated response combining source stats, layer stats, classification coverage, schema health, Purview status, and freshness — avoids frontend making 6+ separate calls

**Navigation:** Add "Data Estate" as the FIRST item in sidebar, above all other groups. This is the landing page for demos.

**Quality Gate:** This page goes through `/interface-design` with maximum premium treatment. If the design doesn't hit "exec-demo-ready" quality, it gets revised until it does. No shipping a mediocre version.

---

## 4. DEPENDENCIES & RISKS

| Risk | Packet | Mitigation |
|------|--------|-----------|
| SQL Auth not available on source servers | A | Feature flag `use_connectorx`. Keep pyodbc as fallback. |
| ConnectorX Windows build issues | A | Pre-test `pip install connectorx` on vsc-fabric server |
| Presidio NLP model size (~500MB) | D | Download once, cache. Only run on-demand, not every load. |
| Schema validation false positives | B | Start in `warn` mode. Don't block loads until schemas stabilize. |
| OneLake write failures without notebook fallback | C | Keep notebook code paths intact. Config toggle for rollback. |
| Pandera Polars compatibility | B | Pandera has native Polars support since v0.18. Pin version. |
| Data Estate animation performance | E | Canvas for particles, CSS for transitions. Profile on target hardware. Degrade gracefully. |
| Data Estate looking mediocre | E | Full /interface-design pass. Revise until premium. Do not ship if it doesn't hit the bar. |

## 5. NEW FILES CREATED

| Packet | New Files |
|--------|-----------|
| A | None (modifies existing `extractor.py`, `connections.py`, `models.py`) |
| B | `engine/schemas/__init__.py`, `engine/schemas/base.py`, `engine/schemas/m3_schemas.py`, `engine/schemas/mes_schemas.py`, `engine/schemas/etq_schemas.py`, `engine/schema_validator.py`, `dashboard/app/api/routes/schema_validation.py`, `dashboard/app/src/pages/SchemaValidation.tsx` |
| C | None (modifies existing `orchestrator.py`, `onelake_io.py`, `bronze_processor.py`, `silver_processor.py`) |
| D | `dashboard/app/api/routes/purview.py` (Purview sync routes, separated from classification) |
| E | `dashboard/app/src/pages/DataEstate.tsx`, `dashboard/app/src/components/estate/PipelineFlow.tsx`, `dashboard/app/src/components/estate/SourceNode.tsx`, `dashboard/app/src/components/estate/LayerZone.tsx`, `dashboard/app/src/components/estate/GovernancePanel.tsx`, `dashboard/app/src/components/estate/DataParticle.tsx`, `dashboard/app/src/components/estate/GovernanceScore.tsx`, `dashboard/app/api/routes/data_estate.py` |

## 6. PER-PACKET INTERFACE DESIGN NEEDS

| Packet | Page | Design Needed |
|--------|------|--------------|
| A | LoadMissionControl.tsx | Minor — add extraction engine badge to run detail. No new page. |
| B | **SchemaValidation.tsx (NEW)** | Full /interface-design pass needed |
| C | LoadMissionControl.tsx | Minor — add processing mode indicator. No new page. |
| D | **DataClassification.tsx (MAJOR ENHANCE)** | Full /interface-design pass — PII drilldown, sensitivity badges, Purview integration panel, sync controls, mapping coverage |
| E | **DataEstate.tsx (NEW — CROWN JEWEL)** | Maximum /interface-design treatment. Premium motion, animation, exec-demo quality. Multiple design iterations expected. |

**Three pages need /interface-design:** SchemaValidation (new), DataClassification (major enhance with Purview), DataEstate (new — premium).

## 7. TEST PLANS

### Packet A (ConnectorX) — Verification

1. **Comparative extraction:** Extract same table (e.g., `MITMAS`) via pyodbc AND ConnectorX. Compare row counts, column names, data types, and a checksum of first 1000 rows. Must match exactly.
2. **Partitioned read:** Extract a large table (e.g., `OOLINE`) with `partition_on` + `partition_num=4`. Verify row count matches non-partitioned read.
3. **Incremental watermark:** Run incremental extraction with ConnectorX. Verify watermark value matches pyodbc result for same query.
4. **Feature flag rollback:** Set `use_connectorx=False`, verify extraction falls back to pyodbc cleanly.
5. **Connection failure:** Test with wrong SQL credentials. Verify error message is clear and diagnostic.
6. **Binary column filtering:** Verify geometry/geography/xml columns are still excluded in output.

### Packet B (Pandera) — Verification

1. **Schema pass:** Extract a table with a registered schema. Verify validation passes and result is logged to `schema_validations`.
2. **Schema fail:** Inject a bad row (null PK, wrong type) into test data. Verify validation catches it.
3. **No schema:** Extract a table WITHOUT a registered schema. Verify it passes with a warning (not blocked).
4. **Warn mode:** Set `validation_mode: "warn"`. Extract bad data. Verify load proceeds but warning is logged.
5. **Enforce mode:** Set `validation_mode: "enforce"`. Extract bad data. Verify load is blocked and entity marked failed.
6. **Schema import safety:** Introduce a syntax error in a schema file. Verify orchestrator starts without crashing (try/except around schema import).
7. **Dashboard:** Verify SchemaValidation page shows results after a run with mixed pass/fail.

### Packet C (delta-rs Default) — Verification

1. **Config change:** Verify `config.py` fallback is `"local"`. Start engine. Confirm `load_method=local` in status API.
2. **Bronze local:** Run Bronze processing for 5 entities. Verify Delta tables written to OneLake. Compare row counts to LZ parquet source.
3. **Silver local:** Run Silver processing. Verify SCD columns added. Check insert/update/delete counts in logs.
4. **Write verification:** Verify row count read-back matches written count for each entity.
5. **Notebook fallback:** Set `load_method: "notebook"` via API. Verify notebook path still works.
6. **Delta compaction:** Write to same table 11 times. Verify compaction triggered on 10th write.

### Packet D (Presidio + Purview) — Verification

1. **Presidio install:** `pip install presidio-analyzer` + `python -m spacy download en_core_web_sm`. Verify no import errors.
2. **Schema capture:** Run LZ load. Verify `column_metadata` table populated for loaded entities.
3. **Pattern classification:** Trigger scan. Verify columns with PII-like names (email, ssn, phone) get classified.
4. **Presidio scan:** Trigger Presidio scan on a source with known PII (e.g., employee names). Verify `pii_entities` populated.
5. **Purview mappings:** Verify `classification_type_mappings` table is seeded with all Presidio→Purview type mappings.
6. **Purview UI:** Navigate to DataClassification page. Verify Purview panel shows "Ready for Purview" state with mapping coverage.
7. **Cross-page badges:** Verify PII badge appears on DataProfiler for classified columns.

### Packet E (Data Estate) — Verification

1. **Data aggregation:** Hit `GET /api/estate/overview`. Verify response includes source stats, layer stats, classification coverage, schema health.
2. **Empty state:** Load page with no run data. Verify graceful empty state (see below).
3. **Animation performance:** Open page on mid-range laptop. Verify 60fps using Chrome DevTools Performance tab.
4. **Source scaling:** Add a new source system to config. Verify it appears in Data Estate without code changes.
5. **Drill-through:** Click a source node → verify navigation to correct detail page.
6. **Responsive:** Test at 1920px, 1440px, 1024px widths. Verify layout adapts.

## 8. PACKET E — EMPTY STATE DESIGN

When the Data Estate page has no data (first visit, no loads run yet), it MUST NOT show a grid of zeros. Instead:

**Empty State Flow:**
- Pipeline flow diagram renders with **ghost nodes** — faded, dashed outlines showing where sources and layers WILL appear
- Center message: "Your data estate is being set up. Run your first load to see data flow through the pipeline."
- Each ghost node shows what it represents: "Sources (0 connected)", "Landing Zone (0 entities)", etc.
- Purview panel shows "Ready for Purview" with mapping coverage count
- Subtle pulse animation on the "Run First Load" call-to-action
- As each component gets data (sources registered, first load completes, first classification runs), the corresponding ghost node transitions to a LIVE node with spring animation

**Partially Populated State:**
- If sources are registered but no loads have run: Source nodes are live, layer nodes are ghosts
- If LZ loaded but no Bronze: LZ node is live, Bronze/Silver/Gold are ghosts
- Animated particles only flow between LIVE nodes — no particles for ghost connections
- This creates a natural visual progression that rewards the user for completing each step
