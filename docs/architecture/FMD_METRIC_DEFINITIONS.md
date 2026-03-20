# FMD Metric Definitions

> Every KPI, count, and metric the dashboard displays — defined once, here.
> If a number appears on screen and isn't defined below, it's untracked and suspect.
>
> Last audited: 2026-03-20 | Audited by: Claude Code (full codebase read)

---

## How to Read This Document

Each metric is defined with:
- **Business name**: What the user sees on screen
- **Formula**: Exact SQL or computation
- **Grain**: What one row/unit represents
- **Source table(s)**: Where the data comes from
- **Transformations**: Any filtering, windowing, or aggregation
- **Exclusions**: What's filtered out
- **Cache allowed?**: Whether a stale value is acceptable
- **Frontend surfaces**: Which pages display this metric

---

## Business Overview KPIs

### Data Freshness (%)

| Field | Value |
|-------|-------|
| **Business name** | Data Freshness |
| **Display** | Percentage + context subtitle. Two-tier: 24h recency (primary) or ever-loaded coverage (fallback). |
| **Formula (24h mode)** | `COUNT(DISTINCT entities with succeeded load in last 24h) / COUNT(DISTINCT active entities) * 100` |
| **Formula (coverage mode)** | `COUNT(DISTINCT entities with ANY succeeded load) / COUNT(DISTINCT active entities) * 100` — used when 24h freshness is 0 |
| **Grain** | Per active LZ entity |
| **Source** | `engine_task_log` (Status, created_at, EntityId), `lz_entities` (IsActive), `datasources` |
| **Exclusions** | Inactive entities (IsActive=0), system sources (CUSTOM_NOTEBOOK, LH_DATA_LANDINGZONE) |
| **New response fields** | `freshness_ever_loaded` (count), `freshness_last_success` (timestamp) |
| **Cache allowed?** | No — must be real-time from engine_task_log |
| **Frontend surfaces** | BusinessOverview (KPI card), BusinessSources |
| **Frontend behavior** | When `freshness_on_time > 0`: shows "N of M tables refreshed in last 24h". When `freshness_on_time == 0`: shows "N of M tables ever loaded" + "Last success: Xd ago". |
| **Known issue** | REPAIRED (RP-02, 2026-03-20). Was: shows 0% after one failed run. Now: falls back to coverage metric. |

### Open Alerts (count)

| Field | Value |
|-------|-------|
| **Business name** | Open Alerts |
| **Formula** | Count of entities that have NEVER succeeded (but have been attempted) UNION entities whose latest entry is failed AND no success in last 7 days. Plus quality_scores entities in bronze/unclassified tier. |
| **Grain** | Per entity |
| **Source** | `engine_task_log` (latest per entity via MAX(id)), `lz_entities`, `datasources`, `quality_scores` |
| **Exclusions** | Entities never attempted (no log entries at all), entities with a recent success (transient failures) |
| **Cache allowed?** | No |
| **Frontend surfaces** | BusinessOverview (KPI card) |
| **Known issue** | REPAIRED (RP-02, 2026-03-20). Was: one failed run inflated alerts to 1,500+. Now: only never-succeeded + consistently-failing entities count as alerts. |

### Sources Online (N / total)

| Field | Value |
|-------|-------|
| **Business name** | Sources Online |
| **Formula** | Count of datasources with `IsActive=1` / total datasources |
| **Grain** | Per datasource |
| **Source** | `datasources` (IsActive) |
| **Cache allowed?** | No |
| **Frontend surfaces** | BusinessOverview (KPI card) |
| **Known issue** | None — this is straightforward. |

### Tables (Loaded / Registered)

| Field | Value |
|-------|-------|
| **Business name** | Tables (displayed as "N / M" where N=loaded, M=registered) |
| **Formula (registered)** | `COUNT(*) FROM lz_entities WHERE IsActive=1` (excludes system sources) |
| **Formula (loaded)** | `COUNT(DISTINCT EntityId) FROM engine_task_log WHERE Status='succeeded'` (excludes system sources) |
| **Grain** | Per LZ entity |
| **Source** | `lz_entities`, `engine_task_log`, `datasources` |
| **New response fields** | `loaded_entities` (count of ever-loaded), `total_entities` (count of registered) |
| **Cache allowed?** | No |
| **Frontend surfaces** | BusinessOverview (KPI card) |
| **Frontend behavior** | Shows "loaded / registered" (e.g., "1,432 / 1,728") with subtitle "1,432 loaded of 1,728 registered" |
| **Known issue** | REPAIRED (RP-02, 2026-03-20). Was: showed only `total_entities` with no loaded/registered distinction, misleading users into thinking all registered entities had data. |

---

## Load Center KPIs

### Landing Zone / Bronze / Silver Table Count

| Field | Value |
|-------|-------|
| **Business name** | LZ Tables / Bronze Tables / Silver Tables |
| **Formula** | `COUNT(DISTINCT EntityId) FROM engine_task_log WHERE Layer='landing' AND Status='succeeded'` |
| **Grain** | Per entity per layer |
| **Source** | `engine_task_log` (primary), `lakehouse_row_counts` (optional enrichment) |
| **Cache allowed?** | No — this is a primary KPI |
| **Frontend surfaces** | LoadCenter (KPI cards + source table) |
| **Known issue** | REPAIRED (RP-01, 2026-03-20). Was: read empty `lakehouse_row_counts`. Now: reads `engine_task_log` via `_get_counts_from_log()`. |

### Landing Zone / Bronze / Silver Row Count

| Field | Value |
|-------|-------|
| **Business name** | LZ Rows / Bronze Rows / Silver Rows |
| **Formula** | `SUM(RowsWritten) FROM engine_task_log WHERE Layer='landing' AND Status='succeeded' AND id IN (SELECT MAX(id) FROM engine_task_log WHERE Status='succeeded' GROUP BY EntityId, Layer)` |
| **Grain** | Per entity per layer (latest successful load) |
| **Source** | `engine_task_log` (primary), `lakehouse_row_counts` (physical scan enrichment when available) |
| **Cache allowed?** | No |
| **Frontend surfaces** | LoadCenter (KPI cards + source table + source detail) |
| **CRITICAL CAVEAT** | For INCREMENTAL loads, `RowsWritten` is the DELTA (new rows only), not the total table size. Now explicitly distinguished: backend returns `fullLoadRows` + `incrementalDeltaRows`. Frontend shows Δ indicator for deltas and context-aware KPI labels. |
| **Known issue** | REPAIRED (RP-01 + RP-04, 2026-03-20). RP-01: rewired to engine_task_log. RP-04: full vs incremental row distinction. True physical totals for incremental entities still require Refresh Counts (design limitation). |

### Gaps

| Field | Value |
|-------|-------|
| **Business name** | Gaps |
| **Formula** | Count of entities that have physical data in LZ but are missing from Bronze or Silver |
| **Grain** | Per entity |
| **Source (current)** | Cross-reference `lakehouse_row_counts` across layers |
| **Source (correct)** | Cross-reference `engine_task_log` successful entries across layers |
| **Frontend surfaces** | LoadCenter (KPI card + gap list) |

---

## Execution Matrix KPIs

### Success Rate (%)

| Field | Value |
|-------|-------|
| **Business name** | Success Rate |
| **Formula** | `COUNT(entities with latest Status='succeeded') / COUNT(all entities with any log entry) * 100` |
| **Grain** | Per entity (latest status) |
| **Source** | `engine_task_log` (via entity-digest endpoint) |
| **Frontend surfaces** | ExecutionMatrix (KPI donut chart) |

### Layer Health (Succeeded / Failed / Pending per layer)

| Field | Value |
|-------|-------|
| **Business name** | Layer Health bars |
| **Formula** | Group entities by latest status per layer |
| **Grain** | Per entity per layer |
| **Source** | `engine_task_log` (via `get_canonical_entity_status()`) |
| **Frontend surfaces** | ExecutionMatrix |
| **Known issue** | REPAIRED (RP-03, 2026-03-20). Was: used `entity_status` (deprecated). Now: derives from `engine_task_log`. |

### Last Run

| Field | Value |
|-------|-------|
| **Business name** | Last Run |
| **Formula** | `SELECT * FROM engine_runs ORDER BY StartedAt DESC LIMIT 1` |
| **Grain** | Per run |
| **Source** | `engine_runs` |
| **Frontend surfaces** | ExecutionMatrix (KPI card), EngineControl |

---

## Engine Control KPIs

### Engine Status

| Field | Value |
|-------|-------|
| **Business name** | Engine Status |
| **Formula** | In-memory state from engine/api.py (idle/running/stopping/error) |
| **Source** | In-memory (not persisted) |
| **Frontend surfaces** | EngineControl |

### Run Metrics (Total Rows Read/Written, Duration, Bytes)

| Field | Value |
|-------|-------|
| **Business name** | Various run metrics |
| **Formula** | Direct read from `engine_runs` columns |
| **Source** | `engine_runs` (TotalRowsRead, TotalRowsWritten, TotalBytesTransferred, TotalDurationSeconds) |
| **Frontend surfaces** | EngineControl |
| **Cache allowed?** | No |

---

## Error Intelligence KPIs

### Error Count by Severity

| Field | Value |
|-------|-------|
| **Business name** | Total Errors / Critical / Warnings / Info |
| **Formula** | `SELECT ErrorType, COUNT(*) FROM engine_task_log WHERE Status != 'succeeded' GROUP BY ErrorType` |
| **Grain** | Per error type |
| **Source** | `engine_task_log` |
| **Frontend surfaces** | ErrorIntelligence (KPI cards + error list) |
| **Cache allowed?** | No |

---

## Alert Definitions

### Never-Loaded Alert

| Field | Value |
|-------|-------|
| **Trigger** | Entity in `lz_entities` with no matching row in `engine_task_log` |
| **Severity** | Warning |
| **Source** | `lz_entities` LEFT JOIN `engine_task_log` |

### Stale Data Alert

| Field | Value |
|-------|-------|
| **Trigger** | Entity's latest successful load is older than N days |
| **Severity** | Warning |
| **Source** | `engine_task_log` (MAX(created_at) per entity) |

### Failed Load Alert

| Field | Value |
|-------|-------|
| **Trigger** | Entity's latest `engine_task_log` entry has Status='failed' |
| **Severity** | Critical |
| **Source** | `engine_task_log` |

### Offline Source Alert

| Field | Value |
|-------|-------|
| **Trigger** | Datasource with IsActive=0 or all entities failed with connection errors |
| **Severity** | Critical |
| **Source** | `datasources`, `engine_task_log` |

---

## Quality Scores

### Entity Quality Score

| Field | Value |
|-------|-------|
| **Business name** | Quality Score |
| **Formula** | Composite of completeness, freshness, consistency, uniqueness |
| **Grain** | Per entity |
| **Source** | `quality_scores` (derived from `engine_task_log` + `column_metadata`) |
| **Cache allowed?** | Yes (derived metric, refreshed on demand) |
| **Frontend surfaces** | BusinessCatalog, ExecutionMatrix, SourceManager |

---

## Gold Studio Metrics

### Specimen / Entity / Cluster / Canonical / Spec Counts

| Field | Value |
|-------|-------|
| **Formula** | `SELECT COUNT(*) FROM gs_specimens/gs_extracted_entities/gs_clusters/gs_canonical_entities/gs_gold_specs` |
| **Source** | Gold Studio tables (all `gs_` prefixed) |
| **Frontend surfaces** | GoldLedger (KPI row) |
| **Cache allowed?** | No |

### Certification Rate

| Field | Value |
|-------|-------|
| **Formula** | `COUNT(gs_catalog_entries WHERE status='certified') / COUNT(gs_catalog_entries) * 100` |
| **Source** | `gs_catalog_entries` |
| **Frontend surfaces** | GoldLedger, GoldValidation |

---

## Metric Anti-Patterns — DO NOT DO

| Anti-Pattern | Why It's Wrong | What To Do Instead |
|-------------|---------------|-------------------|
| Show `lz_entities` count as "loaded tables" | Registration ≠ loaded. Inflates real progress. | Query `engine_task_log` for entities with Status='succeeded' |
| Show `lakehouse_row_counts` as current row counts | Cache table, usually empty, SQL endpoint has weeks of lag | Use `engine_task_log.RowsWritten` (latest successful per entity) |
| Show `entity_status` as current status | Legacy table, may not update in all paths | Derive from `engine_task_log` MAX(id) per entity per layer |
| Sum ALL `RowsWritten` for a table across runs | Double-counts: each full load re-writes all rows | Use only the LATEST successful entry's RowsWritten |
| Show incremental `RowsWritten` as total rows | Incremental = delta only, not total | Label as "rows in last load" or SUM all incremental loads |
