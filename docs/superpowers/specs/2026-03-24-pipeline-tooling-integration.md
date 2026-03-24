# Pipeline Tooling Integration — Truth Audit + Spec

**Date:** 2026-03-24
**Author:** Steve Nahrup
**Scope:** 4 packets — ConnectorX, Pandera, delta-rs writes, Presidio
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
   - Output: Arrow table → convert to Polars (or use `return_type="polars"` directly)
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
   - `config.json` or env vars: SQL Auth credentials for each source server
   - `source_systems.yaml`: optional `partition_on` / `partition_num` per table

5. **`engine/requirements.txt`** — Add `connectorx`

**Auth Consideration:**
- ConnectorX uses connection-string auth (SQL login), not Windows Auth
- Need SQL Server login with read access to all source databases
- The spec references `UsrSQLRead` — verify this account exists on DEV/PROD servers
- If Windows Auth is the only option, keep pyodbc as fallback (`use_connectorx=False`)

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

4. **`engine/logging_db.py`** — New table + stored proc:
   - `schema_validations` table: `run_id, entity_id, layer, passed, error_count, errors_json, validated_at`
   - `sp_InsertSchemaValidation` stored proc

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

1. **`engine/orchestrator.py`** — Change default `load_method`:
   - Current: Defaults to notebook mode, local is opt-in
   - New: Default to `"local"` for Bronze + Silver
   - Keep notebook path as documented fallback (don't delete code)
   - Config: `load_method: "local" | "notebook"` (default changes from `"notebook"` to `"local"`)

2. **`engine/onelake_io.py`** — Verify + harden:
   - Write path already uses `df.write_delta()` with `schema_mode: "overwrite"` ✅
   - Timezone stripping already handles `timestampNtz` requirement ✅
   - ADLS fallback already works with SP token ✅
   - **Add:** Delta table compaction after N writes (VACUUM / OPTIMIZE)
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
   - `spacy` + `en_core_web_lg` model download

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

**Dashboard Changes:**

1. **Enhance `DataClassification.tsx`:**
   - Remove "Classification Engine Not Yet Active" banner (it will be active)
   - Add "Last Scan" timestamp + "Scan Now" button
   - Add PII confidence column to entity table
   - Add column-level drilldown: click entity → see columns with PII types + confidence scores
   - Add sensitivity badge to columns (🔴 PII, 🟡 Confidential, 🟢 Public)

2. **Enhance existing API routes** (`dashboard/app/api/routes/classification.py`):
   - All 4 endpoints already work ✅
   - Add: `GET /api/classification/entity/{entity_id}/columns` — column-level detail with PII types
   - Add: `POST /api/classification/entity/{entity_id}/override` — manual sensitivity override

3. **Cross-page integration:**
   - Add PII badge to DataProfiler column cards
   - Add "Sensitive" indicator to DataMicroscope column lineage view
   - Add classification status to entity digest (useEntityDigest hook)

---

## 3. BUILD ORDER

```
Packet C (delta-rs default) → Packet A (ConnectorX) → Packet B (Pandera) → Packet D (Presidio)
```

**Rationale:**
1. **Packet C first** — smallest change, biggest risk reduction (eliminates notebook dependency). Makes all subsequent testing faster.
2. **Packet A second** — extraction speed. Every test run after this is 5-13x faster.
3. **Packet B third** — schema validation. Now that extraction is fast, validation overhead is proportionally smaller.
4. **Packet D last** — classification is governance, not speed/reliability. Depends on column_metadata being populated (which requires loads to run).

## 4. DEPENDENCIES & RISKS

| Risk | Packet | Mitigation |
|------|--------|-----------|
| SQL Auth not available on source servers | A | Feature flag `use_connectorx`. Keep pyodbc as fallback. |
| ConnectorX Windows build issues | A | Pre-test `pip install connectorx` on vsc-fabric server |
| Presidio NLP model size (~500MB) | D | Download once, cache. Only run on-demand, not every load. |
| Schema validation false positives | B | Start in `warn` mode. Don't block loads until schemas stabilize. |
| OneLake write failures without notebook fallback | C | Keep notebook code paths intact. Config toggle for rollback. |
| Pandera Polars compatibility | B | Pandera has native Polars support since v0.18. Pin version. |

## 5. NEW FILES CREATED

| Packet | New Files |
|--------|-----------|
| A | None (modifies existing `extractor.py`, `connections.py`, `models.py`) |
| B | `engine/schemas/__init__.py`, `engine/schemas/base.py`, `engine/schemas/m3_schemas.py`, `engine/schemas/mes_schemas.py`, `engine/schemas/etq_schemas.py`, `engine/schema_validator.py`, `dashboard/app/api/routes/schema_validation.py`, `dashboard/app/src/pages/SchemaValidation.tsx` |
| C | None (modifies existing `orchestrator.py`, `onelake_io.py`, `bronze_processor.py`, `silver_processor.py`) |
| D | None (modifies existing files, installs package) |

## 6. PER-PACKET INTERFACE DESIGN NEEDS

| Packet | Page | Design Needed |
|--------|------|--------------|
| A | LoadMissionControl.tsx | Minor — add extraction engine badge to run detail. No new page. |
| B | **SchemaValidation.tsx (NEW)** | Full /interface-design pass needed |
| C | LoadMissionControl.tsx | Minor — add processing mode indicator. No new page. |
| D | DataClassification.tsx (ENHANCE) | Full /interface-design pass needed — PII drilldown, sensitivity badges, scan controls |

**Two pages need /interface-design:** SchemaValidation (new) and DataClassification (enhance).
