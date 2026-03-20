# FMD Data Bible

> **The single source of truth for where data lives, how it flows, what is authoritative, and what is not.**
> Every Claude session, every developer, every future maintainer reads this FIRST.
>
> Last audited: 2026-03-20 | Audited by: Claude Code (full codebase read, not memory)

---

## 1. The Pipeline: How Data Flows

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Source SQL       │     │  Landing Zone     │     │  Bronze Layer    │     │  Silver Layer     │
│  Servers (VPN)    │────▶│  (Parquet files)  │────▶│  (Delta tables)  │────▶│  (Delta + SCD2)   │
│                   │     │                   │     │                  │     │                   │
│  MES, ETQ, M3,   │     │  OneLake LH_LZ    │     │  OneLake LH_BRZ  │     │  OneLake LH_SLV   │
│  M3C, OPTIVA     │     │  Files/{NS}/{T}   │     │  Tables/{NS}/{T} │     │  Tables/{NS}/{T}  │
└──────────────────┘     └──────────────────┘     └──────────────────┘     └──────────────────┘
        │                         │                        │                        │
        │ pyodbc                  │ filesystem/ADLS         │ polars+deltalake       │ polars+deltalake
        │ Windows auth            │ parquet (snappy)        │ Delta merge            │ SCD Type 2 merge
        │                         │                        │                        │
        └─────────────────────────┴────────────────────────┴────────────────────────┘
                                           │
                                    ALL LOGGED TO
                                           │
                                           ▼
                              ┌──────────────────────┐
                              │  SQLite Control Plane │
                              │  fmd_control_plane.db │
                              │                      │
                              │  engine_task_log     │ ◀── AUTHORITATIVE for row counts
                              │  engine_runs         │ ◀── AUTHORITATIVE for run summaries
                              │  watermarks          │ ◀── AUTHORITATIVE for incremental state
                              │  lz_entities         │ ◀── AUTHORITATIVE for entity registry
                              └──────────────────────┘
```

### 1.1 Landing Zone Extraction

| Step | Component | What happens |
|------|-----------|-------------|
| 1 | `engine/extractor.py` | Connects to source SQL Server via pyodbc (Windows auth, VPN required) |
| 2 | `engine/extractor.py` | Executes `SELECT * FROM [schema].[table]` (or `WHERE watermark > X` for incremental) |
| 3 | `engine/extractor.py` | Reads rows in chunks (500K default), filters binary columns, builds Polars DataFrame |
| 4 | `engine/extractor.py` | Writes to Parquet bytes (snappy compression, in-memory) |
| 5 | `engine/loader.py` | Uploads Parquet to OneLake via filesystem mount or ADLS REST API |
| 6 | `engine/logging_db.py` | Writes `engine_task_log` row (RowsRead, RowsWritten, Bytes, Duration, Status) |
| 7 | `engine/logging_db.py` | Updates `watermarks` table (for incremental entities) |

**OneLake LZ path**: `LH_DATA_LANDINGZONE.Lakehouse/Files/{Namespace}/{Table}.parquet`

### 1.2 Bronze Processing

| Step | Component | What happens |
|------|-----------|-------------|
| 1 | `engine/bronze_processor.py` | Reads LZ Parquet from OneLake |
| 2 | `engine/bronze_processor.py` | Hashes PK columns, deduplicates, hashes non-key columns for change detection |
| 3 | `engine/bronze_processor.py` | Delta merge into Bronze table (insert new, update changed) |
| 4 | `engine/logging_db.py` | Writes `engine_task_log` row (layer=bronze) |

**OneLake Bronze path**: `LH_BRONZE_LAYER.Lakehouse/Tables/{Namespace}/{Table}/`

### 1.3 Silver Processing (SCD Type 2)

| Step | Component | What happens |
|------|-----------|-------------|
| 1 | `engine/silver_processor.py` | Reads Bronze Delta table |
| 2 | `engine/silver_processor.py` | Joins against existing Silver to detect inserts/updates/deletes |
| 3 | `engine/silver_processor.py` | Adds SCD columns: IsCurrent, RecordStartDate, RecordEndDate, IsDeleted |
| 4 | `engine/silver_processor.py` | Delta merge into Silver table |
| 5 | `engine/logging_db.py` | Writes `engine_task_log` row (layer=silver) |

**OneLake Silver path**: `LH_SILVER_LAYER.Lakehouse/Tables/{Namespace}/{Table}/`

---

## 2. Storage Layers

### 2.1 SQLite Control Plane (`fmd_control_plane.db`)

**Location**: `dashboard/app/api/fmd_control_plane.db`
**Mode**: WAL (concurrent reads OK)

This is the LOCAL database that the dashboard backend reads. The engine writes here. The dashboard reads here. This is where truth lives for the dashboard.

#### Authoritative Tables (engine writes, dashboard reads)

| Table | Purpose | Written by | Row count |
|-------|---------|-----------|-----------|
| **engine_task_log** | Per-entity per-layer execution log | `engine/logging_db.py` | ~79K (grows every run) |
| **engine_runs** | Run-level summaries | `engine/logging_db.py` | ~33 (one per run) |
| **watermarks** | Incremental load high watermarks | `engine/logging_db.py` | ~1,200 |
| **lz_entities** | Landing Zone entity registry | `deploy_from_scratch.py`, source manager | 1,728 |
| **bronze_entities** | Bronze entity registry | `deploy_from_scratch.py`, source manager | 1,728 |
| **silver_entities** | Silver entity registry | `deploy_from_scratch.py`, source manager | 1,728 |
| **datasources** | Source system definitions | `deploy_from_scratch.py`, source manager | 8 (5 active) |
| **connections** | SQL Server connection configs | `deploy_from_scratch.py`, source manager | 5+ |
| **quality_scores** | Data quality KPIs per entity | Quality refresh job | 1,725 |

#### Cache Tables (DO NOT use for frontend truth)

| Table | Purpose | Populated by | Why it's unreliable |
|-------|---------|-------------|-------------------|
| **lakehouse_row_counts** | Physical table scan cache | `POST /api/load-center/refresh` (hits Fabric SQL endpoint) | Empty unless manually triggered; SQL endpoint has 2-3 week sync lag |
| **health_trend_snapshots** | 24h health KPI snapshots | Background aggregation | Stale if not refreshed; hourly granularity |
| **entity_status** | Entity status per layer | `engine/logging_db.py` (backward compat) | **DEPRECATED** — status should be derived from `engine_task_log` |

#### Metadata Tables (dashboard-managed, not engine)

| Table | Purpose |
|-------|---------|
| admin_config | UI settings (hidden pages, etc.) |
| column_metadata | Column definitions from schema discovery |
| column_classifications | Data sensitivity classifications |
| business_glossary | Business term definitions |
| entity_annotations | Entity business metadata |
| server_labels | SQL Server hostname display names |
| import_jobs | Source import job tracking |
| sync_metadata | Background sync state |

#### Gold Studio Tables (19 tables, all `gs_` prefixed)

All Gold Studio tables are managed by `dashboard/app/api/routes/gold_studio.py`. They are self-contained and do not interact with engine data flow. See `FMD_DATA_REGISTRY.yaml` for complete list.

### 2.2 OneLake (Fabric Lakehouses)

| Lakehouse | GUID | Contents | Format |
|-----------|------|----------|--------|
| LH_DATA_LANDINGZONE | `3b9a7e79-...` | Source table extracts | Parquet files in `Files/{NS}/{Table}.parquet` |
| LH_BRONZE_LAYER | (from item_config.yaml) | Deduplicated + change-tracked tables | Delta tables in `Tables/{NS}/{Table}/` |
| LH_SILVER_LAYER | (from item_config.yaml) | SCD Type 2 historical tables | Delta tables in `Tables/{NS}/{Table}/` |

**Workspace**: INTEGRATION DATA (D) — `0596d0e7-e036-451d-a967-41a284302e8d`

### 2.3 Fabric SQL Analytics Endpoint

**CRITICAL WARNING**: The SQL Analytics Endpoint has a **2-3 week sync lag** with the actual lakehouse contents. Do NOT trust it for current row counts. See `sql-endpoint-sync-lag` memory file.

Used only by:
- `POST /api/load-center/refresh` — populates `lakehouse_row_counts` cache
- `GET /api/blender/sample` — ad-hoc data sampling
- `GET /api/sql-explorer/lakehouse-*` — lakehouse browsing
- Gold Studio schema discovery

**Never use for**: dashboard KPIs, row counts, freshness metrics, or any truth the user sees on the main pages.

---

## 3. What Is Authoritative

### The Golden Rule

> **`engine_task_log` is the single source of truth for what has been loaded, when, how many rows, and whether it succeeded.**

Everything the engine does gets logged here. Every entity, every layer, every run. Row counts, durations, errors, watermarks — all here.

### Source Classification

| Source | Classification | Use for | Do NOT use for |
|--------|---------------|---------|---------------|
| `engine_task_log` | **AUTHORITATIVE** | Row counts, load status, success/failure, freshness, error analysis | — |
| `engine_runs` | **AUTHORITATIVE** | Run summaries, total metrics, run duration | — |
| `lz_entities` / `bronze_entities` / `silver_entities` | **AUTHORITATIVE** | Entity registry, what's registered, source mapping | Row counts (these are registrations, not loads) |
| `watermarks` | **AUTHORITATIVE** | Incremental load state | — |
| `datasources` | **AUTHORITATIVE** | Source system definitions | — |
| `quality_scores` | **DERIVED** | Quality KPIs (computed from engine_task_log + column_metadata) | Raw load status |
| `lakehouse_row_counts` | **CACHE — DO NOT USE FOR FRONTEND TRUTH** | Optional cross-check against Fabric | Dashboard KPIs, main page counts, anything user-facing |
| `entity_status` | **LEGACY — DO NOT USE** | Nothing (backward compat only) | Anything — derive status from engine_task_log instead |
| `health_trend_snapshots` | **CACHE** | Historical trend visualization only | Current state |
| Fabric SQL Endpoint | **EXTERNAL — STALE** | Ad-hoc exploration, schema discovery | Row counts, freshness, any dashboard truth |

---

## 4. Dashboard Data Dependencies

### 4.1 How Pages Get Their Data

Every dashboard page calls REST endpoints in `dashboard/app/api/routes/`. Those endpoints query SQLite. The frontend NEVER queries SQLite or Fabric directly.

```
Frontend Page  ──▶  REST API Endpoint  ──▶  SQLite Query  ──▶  Response JSON
```

### 4.2 Page → Endpoint → Table Map (Summary)

| Page | Primary Endpoints | Authoritative Tables | Known Issues |
|------|------------------|---------------------|-------------|
| **BusinessOverview** | `/api/overview/kpis`, `/sources`, `/activity` | engine_task_log, engine_runs, lz_entities, datasources | 24h freshness window may show 0% if last success >24h ago |
| **LoadCenter** | `/api/load-center/status`, `/source-detail` | **READS FROM `lakehouse_row_counts` (EMPTY CACHE)** | **BUG: Shows all zeros. Should read from `engine_task_log`** |
| **ExecutionMatrix** | `/api/entity-digest` | engine_task_log, lz_entities, entity_status, datasources | Uses entity_status (deprecated) alongside engine_task_log |
| **EngineControl** | `/api/engine/status`, `/logs`, `/health` | engine_runs, engine_task_log | Working correctly |
| **ErrorIntelligence** | `/api/error-intelligence` | engine_task_log | Working correctly |
| **BusinessAlerts** | `/api/alerts` | engine_task_log, lz_entities, datasources | Working correctly |
| **BusinessCatalog** | `/api/gold/domains`, `/overview/entities`, `/mdm/quality/scores` | lz_entities, quality_scores, entity_annotations | Working correctly |
| **BusinessSources** | `/api/overview/kpis`, `/sources`, `/entities` | engine_task_log, lz_entities, datasources | Working correctly |

**Full page→endpoint→table mapping**: See `FMD_DATA_REGISTRY.yaml`

### 4.3 Known Mismatches (as of 2026-03-20)

| # | What's Wrong | Root Cause | Impact | Fix |
|---|-------------|-----------|--------|-----|
| **M1** | Load Center shows all zeros | `/api/load-center/status` reads `lakehouse_row_counts` (empty cache) instead of `engine_task_log` | Load Center page useless | Rewrite status endpoint to use `_get_counts_from_log()` as primary |
| **M2** | Load Center source drill-down shows "—" for all rows | `/api/load-center/source-detail` prefers physical scan rows; falls back to nothing when cache empty | Drill-down useless | Use engine_task_log RowsWritten as fallback when physical scan unavailable |
| **M3** | Overview freshness shows 0% after failed run | Freshness KPI uses 24h window; last SUCCESSFUL run was 3/17, but 3/20 run failed | Misleading KPI | Show "last successful" freshness alongside 24h freshness |
| **M4** | Entity counts confused with physical table counts | Registration count (1,666 entities) ≠ loaded table count ≠ physical parquet file count | User confusion | Always label: "X registered, Y loaded, Z with data" |
| **M5** | `entity_status` disagrees with `engine_task_log` | Both written by engine, but `entity_status` is legacy and may not update in all code paths | Inconsistent status on pages that read entity_status | Migrate all reads to engine_task_log; stop writing entity_status |

---

## 5. Row Count Sources — The Complete Truth

There are **four different ways** to get "row counts" in this system. They measure different things and should NEVER be conflated.

| Source | What It Measures | Authoritative? | Stale Risk | Used By |
|--------|-----------------|---------------|------------|---------|
| `engine_task_log.RowsWritten` | Rows the engine measured during extraction/transform | **YES** | None (written at extraction time) | Overview KPIs, Engine Control, Error Intelligence |
| `engine_task_log.RowsRead` | Rows read from source (same as RowsWritten for LZ; may differ for Bronze/Silver) | **YES** | None | Engine metrics |
| `lakehouse_row_counts.row_count` | Physical row count from Fabric SQL endpoint scan | **NO — CACHE** | Very high (SQL endpoint 2-3 week lag + manual refresh required) | **Load Center (BUG — should not be primary)** |
| `entity_status` counts | Count of entities by status | **NO — LEGACY** | Medium (may not update in all paths) | Some pages (should be migrated) |

### The Critical Distinction

> **"Registered" ≠ "Loaded" ≠ "Physical rows in lakehouse"**

- **Registered**: Entity exists in `lz_entities` table. Metadata only. No data moved.
- **Loaded**: Entity has at least one `engine_task_log` entry with `Status='succeeded'`. Data was extracted and written.
- **Physical rows**: Actual row count in the Delta/Parquet file on OneLake. Only knowable via filesystem scan or SQL endpoint query (both slow/stale).

For dashboard purposes, **"Loaded"** (from engine_task_log) is the right answer 99% of the time.

### RowsWritten for Incremental Loads

**CAVEAT**: For incremental loads, `engine_task_log.RowsWritten` is the **delta** (new rows since last watermark), NOT the total table row count. To get total rows for an incremental entity, you'd need to SUM all successful RowsWritten entries — or scan the physical file.

For full loads, RowsWritten IS the total row count.

---

## 6. Authentication

| Context | Method | Scope/Details |
|---------|--------|--------------|
| Source SQL Servers | Windows Auth (pyodbc) | `Trusted_Connection=yes` over VPN. Short hostnames only (no `.ipaper.com`). |
| Fabric SQL Database | Service Principal OAuth | Scope: `https://analysis.windows.net/powerbi/api/.default` (NOT `database.windows.net`) |
| Fabric REST API | Service Principal OAuth | Scope: `https://api.fabric.microsoft.com/.default` |
| OneLake (ADLS) | Service Principal OAuth | Scope: `https://storage.azure.com/.default` |
| Token struct | pyodbc attrs_before | `struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)` |

---

## 7. Configuration Sources

| File | What it contains | Read by |
|------|-----------------|---------|
| `config/item_config.yaml` | Workspace GUIDs, lakehouse GUIDs, pipeline GUIDs | `deploy_from_scratch.py`, engine config |
| `dashboard/app/api/config.json` | Engine runtime config (tenant, client, lakehouses, tunables) | `engine/config.py` |
| `config/entity_registration.json` | Entity definitions for initial registration | `deploy_from_scratch.py` Phase 13 |
| `.env` | Environment variable overrides | `engine/config.py` |

---

## 8. Rules for Future Sessions

### MANDATORY — Read Before Touching Dashboard Data

1. **If a page shows "0 rows" or "0 tables"**: Check which API endpoint it calls, then check which SQLite table that endpoint queries. If it's `lakehouse_row_counts` or `entity_status`, that's the bug — switch to `engine_task_log`.

2. **Never add a new cache table** for something `engine_task_log` already tracks. The engine logs everything. Query it.

3. **Never use the Fabric SQL Analytics Endpoint for dashboard truth.** It has a 2-3 week sync lag. It's for ad-hoc exploration only.

4. **"Registered" is not "Loaded"**: `lz_entities` count ≠ tables with data. Always check `engine_task_log` for actual load status.

5. **Incremental RowsWritten is a delta**: Don't display it as "total rows in table." For total, SUM all successful entries or scan the file.

6. **Update this bible**: Any change to data flow, new cache layer, new table, or new endpoint MUST be reflected here. No fix is complete until these docs are updated.

### Enforcement

> **No data-flow, metric, storage, or dashboard-source fix is considered complete until `FMD_DATA_BIBLE.md`, `FMD_DATA_REGISTRY.yaml`, and `FMD_PIPELINE_TRUTH_AUDIT.md` are updated to reflect the change.**
