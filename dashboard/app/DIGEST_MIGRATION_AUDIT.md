# Entity Digest Engine — Migration Audit

> Generated 2026-02-28 by comprehensive codebase analysis.
> Covers every page in `dashboard/app/src/pages/`, the `useEntityDigest` hook,
> and all entity-related endpoints in `dashboard/app/api/server.py`.

---

## Architecture

| Layer | Component | TTL | Description |
|-------|-----------|-----|-------------|
| **Frontend** | `useEntityDigest` hook | 30 s (module-level singleton cache) | Shared React hook. All components that mount simultaneously share a single in-flight request. Exposes `allEntities`, `sourceList`, `totalSummary`, `findEntity`, `entitiesBySource`, plus raw `data`, `loading`, `error`, `refresh`. |
| **Backend** | `GET /api/entity-digest` | 2 min (server-side dict cache) | Thin Python wrapper. Parses optional `?source=`, `?layer=`, `?status=` query params, calls the stored proc, reshapes rows into the `DigestResponse` shape, caches the result. |
| **Database** | `execution.sp_BuildEntityDigest` | N/A (real-time) | Fabric SQL stored procedure. Joins 6+ tables (`LandingzoneEntity`, `BronzeLayerEntity`, `SilverLayerEntity`, `DataSource`, `Connection`, execution logs) in a single query. Accepts optional `@SourceFilter` parameter. |
| **Forward-compatible** | — | — | When incremental digestion (Phase 2: write-time aggregation into `execution.EntityStatusSummary`) lands, only the stored proc internals change. The Python wrapper and React hook remain identical. |

---

## Digest Entity Shape

All fields available on each `DigestEntity` object (from `useEntityDigest.ts`):

| Field | Type | Description |
|-------|------|-------------|
| `id` | `number` | `LandingzoneEntityId` |
| `tableName` | `string` | Source table name (`SourceName`) |
| `sourceSchema` | `string` | Source schema (e.g. `dbo`) |
| `source` | `string` | Data source key (e.g. `MES`, `ETQ`) |
| `isActive` | `boolean` | Whether entity is active |
| `isIncremental` | `boolean` | Incremental load flag |
| `watermarkColumn` | `string` | Column used for watermark (empty if full load) |
| `bronzeId` | `number \| null` | `BronzeLayerEntityId` (null if not registered) |
| `bronzePKs` | `string` | Primary keys configured for Bronze layer |
| `silverId` | `number \| null` | `SilverLayerEntityId` (null if not registered) |
| `lzStatus` | `"loaded" \| "pending" \| "not_started"` | Landing zone load status |
| `lzLastLoad` | `string` | ISO timestamp of last LZ load |
| `bronzeStatus` | `"loaded" \| "pending" \| "not_started"` | Bronze layer status |
| `bronzeLastLoad` | `string` | ISO timestamp of last Bronze load |
| `silverStatus` | `"loaded" \| "pending" \| "not_started"` | Silver layer status |
| `silverLastLoad` | `string` | ISO timestamp of last Silver load |
| `lastError` | `EntityError \| null` | Most recent error (`{ message, layer, time }`) |
| `diagnosis` | `string` | Human-readable status summary |
| `overall` | `"complete" \| "error" \| "pending" \| "partial" \| "not_started"` | Aggregate status across all layers |
| `connection` | `EntityConnection \| null` | `{ server, database, connectionName }` |

### Supporting Types

- **`DigestSource`** — Groups entities by data source: `{ key, name, connection, entities: DigestEntity[], summary: DigestSourceSummary }`
- **`DigestSourceSummary`** — Per-source counts: `{ total, complete, pending, error, partial, not_started }`
- **`DigestResponse`** — Top-level: `{ generatedAt, buildTimeMs, totalEntities, sources: Record<string, DigestSource> }`
- **`DigestFilters`** — Query params: `{ source?, layer?, status? }`

### Hook Return Value

```ts
{
  data: DigestResponse | null,      // Raw response
  loading: boolean,
  error: string | null,
  refresh: () => void,              // Invalidates cache + re-fetches
  allEntities: DigestEntity[],      // Flat list across all sources
  sourceList: DigestSource[],       // Sources sorted by key
  totalSummary: DigestSourceSummary, // Aggregate summary
  findEntity: (tableName, schema?) => DigestEntity | undefined,
  entitiesBySource: (sourceKey) => DigestEntity[],
}
```

---

## Page Migration Status

| Page | File | Original Endpoint(s) | Data Points Used | Digest Equivalent | Status |
|------|------|---------------------|------------------|-------------------|--------|
| **RecordCounts** | `pages/RecordCounts.tsx` | `GET /api/entities`, `GET /api/bronze-entities`, `GET /api/silver-entities`, `GET /api/lakehouse-counts` | Entity metadata, source mapping, Bronze/Silver registration, row counts | `useEntityDigest().allEntities` for entity metadata; `/api/lakehouse-counts` still needed for physical row counts | **PARTIAL** — Entity metadata can use digest, but lakehouse row counts require a separate endpoint (physical Spark queries, not metadata) |
| **AdminGovernance** | `pages/AdminGovernance.tsx` | `GET /api/entities`, `GET /api/bronze-entities`, `GET /api/silver-entities`, `GET /api/connections`, `GET /api/datasources`, `GET /api/pipelines`, `GET /api/workspaces`, `GET /api/lakehouses`, `GET /api/stats` | Entity counts, source breakdown, infrastructure inventory, stats | `useEntityDigest()` replaces `/api/entities`, `/api/bronze-entities`, `/api/silver-entities`; other endpoints (connections, datasources, pipelines, workspaces, lakehouses, stats) remain | **DONE** |
| **FlowExplorer** | `pages/FlowExplorer.tsx` | `GET /api/entities`, `GET /api/bronze-entities`, `GET /api/silver-entities`, `GET /api/connections`, `GET /api/datasources`, `GET /api/pipelines` | Entity list for medallion layer visualization, infrastructure for flow graph | `useEntityDigest()` replaces `/api/entities`, `/api/bronze-entities`, `/api/silver-entities`; connections, datasources, pipelines still fetched individually | **DONE** |
| **DataJourney** | `pages/DataJourney.tsx` | `GET /api/entities` (for entity picker), `GET /api/journey?entity={id}` (for journey detail), `GET /api/blender/profile` (for column profiling) | Entity picker list, per-entity journey trace, column profiles | `useEntityDigest().allEntities` replaces `/api/entities` in the picker; `/api/journey` and `/api/blender/profile` remain (specialized per-entity detail) | **DONE** |
| **SourceManager** | `pages/SourceManager.tsx` | `GET /api/entities`, `GET /api/gateway-connections`, `GET /api/connections`, `GET /api/datasources`, `GET /api/load-config`, `GET /api/analyze-source`, `POST /api/register-bronze-silver`, `POST /api/load-config`, `POST /api/connections`, `POST /api/entities/bulk-delete`, `DELETE /api/entities/{id}`, `GET /api/entities/cascade-impact` | Entity list (read), registration mutations, load config, source analysis | `useEntityDigest()` + `invalidateDigestCache()` replaces `GET /api/entities` for the read side; all mutation endpoints remain (register, delete, analyze, load-config) | **DONE** |
| **EntityDrillDown** | `components/pipeline-matrix/EntityDrillDown.tsx` | (was part of PipelineMatrix, used inline entity data) | Per-source entity list with layer status, drill-down filtering | `useEntityDigest(filters)` with `source`, `layer`, `status` filters | **DONE** |
| **ControlPlane** | `pages/ControlPlane.tsx` | `GET /api/control-plane`, `GET /api/load-config` | Server-aggregated control plane snapshot, load configuration | N/A — server pre-aggregates data | **NOT MIGRATED** |
| **PipelineMonitor** | `pages/PipelineMonitor.tsx` | `GET /api/pipelines`, `GET /api/pipeline-executions`, `GET /api/workspaces`, `GET /api/fabric-jobs`, `GET /api/copy-executions`, `GET /api/notebook-executions`, `GET /api/pipeline-activity-runs`, `GET /api/pipeline/failure-trace`, `POST /api/pipeline/trigger` | Pipeline execution history, Fabric job status, activity runs, failure traces | N/A — pipeline execution data, not entity metadata | **NOT MIGRATED** |
| **PipelineRunner** | `pages/PipelineRunner.tsx` | `GET /api/runner/sources`, `GET /api/runner/entities`, `GET /api/runner/state`, `POST /api/runner/prepare`, `POST /api/runner/trigger`, `POST /api/runner/restore` | Runner sources, entity selection for pipeline runs, run state | N/A — specialized runner shape (notebook params, pipeline selection) | **NOT MIGRATED** |
| **ExecutionLog** | `pages/ExecutionLog.tsx` | `GET /api/pipeline-executions`, `GET /api/copy-executions`, `GET /api/notebook-executions` | Historical execution log entries | N/A — execution history, not entity metadata | **NOT MIGRATED** |
| **ErrorIntelligence** | `pages/ErrorIntelligence.tsx` | `GET /api/error-intelligence` | Error patterns, failure analysis | N/A — server pre-aggregates error intelligence data | **NOT MIGRATED** |
| **LiveMonitor** | `pages/LiveMonitor.tsx` | `GET /api/live-monitor` | Real-time pipeline run status, in-flight jobs | N/A — real-time monitoring, not entity metadata | **NOT MIGRATED** |
| **NotebookDebug** | `pages/NotebookDebug.tsx` | `GET /api/notebook-debug/notebooks`, `GET /api/notebook-debug/entities`, `GET /api/notebook-debug/job-status`, `POST /api/notebook-debug/run` | Notebook inventory, entity params for debug runs, job status | N/A — specialized notebook runner shape | **NOT MIGRATED** |
| **ConfigManager** | `pages/ConfigManager.tsx` | `GET /api/config-manager`, `GET /api/config-manager/references`, `POST /api/config-manager/update`, `POST /api/deploy-pipelines` | Raw metadata table rows, GUID references, config updates | N/A — raw config table CRUD, not entity metadata | **NOT MIGRATED** |
| **NotebookConfig** | `pages/NotebookConfig.tsx` | `GET /api/notebook-config`, `POST /api/notebook-config/update` | Notebook variable library config, trigger/status | N/A — notebook configuration, not entity metadata | **NOT MIGRATED** |
| **Settings** | `pages/Settings.tsx` | `GET /api/notebook-config`, `GET /api/fabric/workspaces`, `GET /api/fabric/connections`, `GET /api/fabric/security-groups`, `GET /api/notebook/job-status`, `POST /api/notebook-config/update`, `POST /api/deploy/wipe-and-trigger`, `GET /api/deploy/preflight` | Deployment settings, Fabric resource discovery, notebook trigger | N/A — deployment/infra management, not entity metadata | **NOT MIGRATED** |
| **DataBlender** | `pages/DataBlender.tsx` | `GET /api/purview/status` | Purview catalog status | N/A — Purview integration, not entity metadata | **NOT MIGRATED** |
| **ExecutiveDashboard** | `pages/ExecutiveDashboard.tsx` | `GET /api/executive` | Server pre-aggregated executive summary | N/A — server pre-aggregates executive KPIs | **NOT MIGRATED** |
| **PipelineMatrix** | `pages/PipelineMatrix.tsx` | `GET /api/pipeline-matrix` | Server pre-aggregated source-by-layer matrix | N/A — server pre-aggregates matrix data (but EntityDrillDown within it IS migrated) | **NOT MIGRATED** |
| **SqlExplorer** | `pages/SqlExplorer.tsx` | `/api/sql-explorer/*` (servers, databases, schemas, tables, columns, preview, lakehouse variants) | Live SQL Server / Lakehouse object tree browsing | N/A — live SQL introspection, not entity metadata | **NOT MIGRATED** |
| **DqScorecard** | `pages/DqScorecard.tsx` | None (Labs placeholder) | None | N/A | **N/A — PLACEHOLDER** |
| **CleansingRuleEditor** | `pages/CleansingRuleEditor.tsx` | None (Labs placeholder) | None | N/A | **N/A — PLACEHOLDER** |
| **ScdAudit** | `pages/ScdAudit.tsx` | None (Labs placeholder) | None | N/A | **N/A — PLACEHOLDER** |
| **GoldMlvManager** | `pages/GoldMlvManager.tsx` | None (Labs placeholder) | None | N/A | **N/A — PLACEHOLDER** |

### Migration Summary

| Status | Count | Pages |
|--------|-------|-------|
| **DONE** | 5 | AdminGovernance, FlowExplorer, DataJourney, SourceManager, EntityDrillDown |
| **PARTIAL** | 1 | RecordCounts (entity metadata migrateable, lakehouse counts are not) |
| **NOT MIGRATED** | 12 | ControlPlane, PipelineMonitor, PipelineRunner, ExecutionLog, ErrorIntelligence, LiveMonitor, NotebookDebug, ConfigManager, NotebookConfig, Settings, DataBlender, ExecutiveDashboard, PipelineMatrix, SqlExplorer |
| **N/A (Placeholder)** | 4 | DqScorecard, CleansingRuleEditor, ScdAudit, GoldMlvManager |

---

## Backend Endpoint Status

### Entity-Related Endpoints (Digest Targets)

| Endpoint | Method | Purpose | Digest Replacement | Status |
|----------|--------|---------|-------------------|--------|
| `GET /api/entities` | GET | LZ entity list (`integration.LandingzoneEntity` joined with `DataSource`) | `useEntityDigest().allEntities` | **DEPRECATED** — kept for backward compat; no frontend pages should call this for read-side |
| `GET /api/bronze-entities` | GET | Bronze entity list (`integration.BronzeLayerEntity`) | `useEntityDigest().allEntities` (`.bronzeId`, `.bronzeStatus`, `.bronzePKs`) | **DEPRECATED** — kept for backward compat |
| `GET /api/silver-entities` | GET | Silver entity list (`integration.SilverLayerEntity`) | `useEntityDigest().allEntities` (`.silverId`, `.silverStatus`) | **DEPRECATED** — kept for backward compat |
| `GET /api/entity-digest` | GET | **The digest endpoint** — calls `execution.sp_BuildEntityDigest` | This IS the digest | **ACTIVE** — primary entity data source |
| `GET /api/stats` | GET | Dashboard stats (active counts, entity breakdown) | Partially overlaps with `useEntityDigest().totalSummary` | **KEPT** — still consumed by AdminGovernance for non-entity stats |

### Entity Mutation Endpoints (Not Replaceable by Digest)

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `POST /api/entities` | POST | Register new LZ entity | **ACTIVE** — write operation |
| `DELETE /api/entities/{id}` | DELETE | Delete single entity | **ACTIVE** — write operation |
| `POST /api/entities/bulk-delete` | POST | Bulk delete entities | **ACTIVE** — write operation |
| `GET /api/entities/cascade-impact` | GET | Preview cascade impact before delete | **ACTIVE** — specialized query |
| `POST /api/register-bronze-silver` | POST | Register Bronze + Silver for an entity | **ACTIVE** — write operation |
| `POST /api/source-tables` | POST | Discover tables from source SQL Server | **ACTIVE** — write operation |
| `POST /api/sources/purge` | POST | Purge all entities for a data source | **ACTIVE** — write operation |

### Non-Entity Endpoints (Digest Not Applicable)

| Endpoint | Method | Purpose | Consumed By |
|----------|--------|---------|-------------|
| `GET /api/gateway-connections` | GET | Fabric gateway connections | SourceManager |
| `GET /api/connections` | GET | Registered connections | AdminGovernance, FlowExplorer, SourceManager |
| `GET /api/datasources` | GET | Registered data sources | AdminGovernance, FlowExplorer, SourceManager |
| `GET /api/pipelines` | GET | Pipeline registry | AdminGovernance, FlowExplorer, PipelineMonitor |
| `GET /api/workspaces` | GET | Workspace registry | AdminGovernance, PipelineMonitor |
| `GET /api/lakehouses` | GET | Lakehouse registry | AdminGovernance |
| `GET /api/pipeline-executions` | GET | Pipeline execution history | PipelineMonitor, ExecutionLog |
| `GET /api/copy-executions` | GET | Copy activity executions | PipelineMonitor, ExecutionLog |
| `GET /api/notebook-executions` | GET | Notebook executions | PipelineMonitor, ExecutionLog |
| `GET /api/fabric-jobs` | GET | Fabric REST API job status | PipelineMonitor |
| `GET /api/pipeline-activity-runs` | GET | Activity runs for a pipeline job | PipelineMonitor |
| `GET /api/pipeline/failure-trace` | GET | Failure trace for a run | PipelineMonitor |
| `GET /api/pipeline/run-snapshot` | GET | Pipeline run snapshot | PipelineMonitor |
| `GET /api/pipeline/stream` | GET | SSE pipeline run stream | PipelineMonitor |
| `POST /api/pipeline/trigger` | POST | Trigger pipeline | PipelineMonitor |
| `GET /api/runner/sources` | GET | Runner data sources | PipelineRunner |
| `GET /api/runner/entities` | GET | Runner entities by datasource | PipelineRunner |
| `GET /api/runner/state` | GET | Runner active state | PipelineRunner |
| `POST /api/runner/prepare` | POST | Prepare runner (set entity flags) | PipelineRunner |
| `POST /api/runner/trigger` | POST | Trigger runner pipeline | PipelineRunner |
| `POST /api/runner/restore` | POST | Restore runner state | PipelineRunner |
| `GET /api/live-monitor` | GET | Real-time pipeline monitor | LiveMonitor |
| `GET /api/error-intelligence` | GET | Error pattern analysis | ErrorIntelligence |
| `GET /api/control-plane` | GET | Aggregated control plane view | ControlPlane |
| `GET /api/journey` | GET | Per-entity data journey | DataJourney |
| `GET /api/lakehouse-counts` | GET | Physical row counts per lakehouse | RecordCounts |
| `GET /api/schema` | GET | Database schema discovery | Internal |
| `GET /api/health` | GET | Health check | Internal |
| `GET /api/onboarding` | GET | Onboarding wizard state | SourceOnboardingWizard |
| `POST /api/onboarding` | POST | Onboarding registration | SourceOnboardingWizard |
| `POST /api/onboarding/step` | POST | Onboarding step advance | SourceOnboardingWizard |
| `POST /api/onboarding/delete` | POST | Onboarding rollback | SourceOnboardingWizard |
| `GET /api/blender/*` | GET | Data Blender (table browse, profile, sample, query) | DataBlender |
| `GET /api/purview/*` | GET | Purview integration | DataBlender |
| `GET /api/config-manager` | GET | Raw config table data | ConfigManager |
| `POST /api/config-manager/update` | POST | Config table mutations | ConfigManager |
| `GET /api/config-manager/references` | GET | GUID cross-references | ConfigManager |
| `GET /api/notebook-config` | GET | Notebook variable library | NotebookConfig, Settings |
| `POST /api/notebook-config/update` | POST | Update notebook config | NotebookConfig, Settings |
| `GET /api/notebook-debug/*` | GET | Notebook debug runner | NotebookDebug |
| `POST /api/notebook-debug/run` | POST | Trigger debug notebook run | NotebookDebug |
| `GET /api/fabric/workspaces` | GET | Fabric workspace list | Settings |
| `GET /api/fabric/connections` | GET | Fabric connection list | Settings |
| `GET /api/fabric/security-groups` | GET | Entra security groups | Settings |
| `GET /api/fabric/resolve-workspace` | GET | Resolve workspace name | Settings |
| `GET /api/notebook/job-status` | GET | Notebook job status | Settings |
| `POST /api/notebook/trigger` | POST | Trigger notebook | NotebookDebug |
| `GET /api/deploy/*` | GET | Deployment state/preflight/stream | Settings |
| `POST /api/deploy/*` | POST | Deployment start/cancel/wipe | Settings |
| `POST /api/deploy-pipelines` | POST | Deploy pipelines to Fabric | ConfigManager |
| `GET /api/analyze-source` | GET | Analyze source for load optimization | SourceManager |
| `GET /api/load-config` | GET | Load optimization config | SourceManager, ControlPlane |
| `POST /api/load-config` | POST | Save load config changes | SourceManager |
| `GET /api/diag/stored-procs` | GET | Diagnostic: list stored procs | Internal |

---

## Pages Not Migrated (with Rationale)

### Server Pre-Aggregates Data

| Page | Endpoint | Rationale |
|------|----------|-----------|
| **ControlPlane** | `/api/control-plane` | The server builds a custom control plane snapshot that joins pipeline configs, execution stats, environment state, and load config into a single response. This is a cross-domain aggregate, not entity metadata. |
| **ExecutiveDashboard** | `/api/executive` | Server computes executive KPIs (completion percentages, pipeline health scores, SLA metrics) from multiple SQL queries. The digest is entity-focused; the executive endpoint is metric-focused. |
| **PipelineMatrix** | `/api/pipeline-matrix` | Server pre-aggregates a source-by-layer matrix with pipeline status. Note: the **EntityDrillDown** component within PipelineMatrix IS migrated to use the digest for its entity-level detail. |
| **ErrorIntelligence** | `/api/error-intelligence` | Server performs error pattern analysis (grouping, frequency, root-cause correlation). Not entity metadata. |

### Not Entity-Related

| Page | Endpoint(s) | Rationale |
|------|-------------|-----------|
| **PipelineMonitor** | `/api/pipelines`, `/api/pipeline-executions`, `/api/fabric-jobs`, etc. | Pipeline execution monitoring — tracks runs, jobs, activity runs, failure traces. Operates on pipeline objects, not entity metadata. |
| **PipelineRunner** | `/api/runner/*` | Specialized pipeline runner with entity selection, prepare/trigger/restore workflow. The runner needs notebook-level entity params (different shape from digest). |
| **ExecutionLog** | `/api/pipeline-executions`, `/api/copy-executions`, `/api/notebook-executions` | Historical execution log — time-series run records, not entity state. |
| **LiveMonitor** | `/api/live-monitor` | Real-time monitoring of in-flight pipeline runs. Time-sensitive, not entity metadata. |
| **NotebookDebug** | `/api/notebook-debug/*` | Notebook debug runner — specialized entity-per-notebook parameterization with job status tracking. |
| **ConfigManager** | `/api/config-manager`, `/api/config-manager/references` | Raw metadata table CRUD. Operates on config rows (connections, datasources, lakehouses, pipelines, workspaces) — not entity state. |
| **NotebookConfig** | `/api/notebook-config` | Notebook variable library management (workspace IDs, lakehouse IDs, connection strings). Infrastructure config, not entity metadata. |
| **Settings** | `/api/fabric/*`, `/api/deploy/*`, `/api/notebook-config` | Deployment management, Fabric resource discovery, notebook triggers. Infrastructure/DevOps tooling. |
| **DataBlender** | `/api/purview/*`, `/api/blender/*` | Purview catalog integration and lakehouse data profiling/sampling. Cross-platform data exploration, not entity pipeline metadata. |
| **SqlExplorer** | `/api/sql-explorer/*` | Live SQL Server and Lakehouse object tree browsing with column introspection and data preview. Source-system exploration, not framework metadata. |

### Labs Placeholders (No API Calls)

| Page | Description | Future Digest Potential |
|------|-------------|----------------------|
| **DqScorecard** | Data quality scorecard — coming soon | **Yes** — when DQ metrics are stored in metadata DB, the digest could include a `dqScore` field per entity. |
| **CleansingRuleEditor** | Cleansing rule visual editor — coming soon | **Maybe** — rules are per-entity config, but editing requires its own CRUD endpoints. |
| **ScdAudit** | SCD Type 2 change audit — coming soon | **Maybe** — could surface change counts via digest, but detailed audit data is per-run. |
| **GoldMlvManager** | Gold layer MLV management — coming soon | **No** — MLVs are Silver-to-Gold transformations, a different axis from entity pipeline status. |

---

## RecordCounts: Special Case (PARTIAL)

RecordCounts currently calls three entity endpoints **plus** `/api/lakehouse-counts`:

```
Original:
  GET /api/entities          → Entity metadata + DataSource mapping
  GET /api/bronze-entities   → Bronze registration state
  GET /api/silver-entities   → Silver registration state
  GET /api/lakehouse-counts  → Physical row counts from Spark SQL (actual data)
```

**What the digest replaces:** The first three calls. Entity metadata, Bronze/Silver registration, source mapping, and active/incremental flags are all in `DigestEntity`.

**What the digest cannot replace:** `/api/lakehouse-counts` issues a Spark SQL `SELECT COUNT(*)` against physical lakehouse Delta tables. This is live data introspection, not metadata. It requires a separate endpoint with its own caching strategy (currently has a file-based cache with force-refresh support).

**Migration path:** Replace the three entity calls with `useEntityDigest()`, keep `/api/lakehouse-counts` as-is. The page would mount the digest for entity metadata and the counts endpoint for physical row counts, then join them client-side by table name.

---

## Future: Incremental Digestion (Phase 2)

### Current Architecture (Phase 1 — Read-Time Aggregation)

```
Pipeline Notebooks write to:        Digest reads from:
  integration.LandingzoneEntity  ←─── sp_BuildEntityDigest joins 6+ tables
  integration.BronzeLayerEntity      on every request (cached 2 min)
  integration.SilverLayerEntity
  execution.PipelineExecution
  execution.PipelineExecutionError
  integration.Connection
  integration.DataSource
```

Every digest request rebuilds the entity state from normalized source tables. This works well at current scale (659 entities, ~200ms build time) but will slow down as entity count and execution history grow.

### Phase 2 Plan: Write-Time Aggregation

```
Pipeline Notebooks write to:           Digest reads from:
  integration.LandingzoneEntity    ──→  execution.EntityStatusSummary
  integration.BronzeLayerEntity    ──→    (single denormalized table,
  integration.SilverLayerEntity    ──→     updated by notebooks on each load)
  execution.PipelineExecution
```

**New table:** `execution.EntityStatusSummary`
- One row per entity
- Updated by pipeline notebooks at the end of each load (Bronze notebook writes `bronzeStatus`, Silver notebook writes `silverStatus`, etc.)
- Pre-computed `overall` status, `lastError`, `diagnosis`
- `sp_BuildEntityDigest` changes from a 6-table join to a single `SELECT * FROM execution.EntityStatusSummary`

**What changes:**
- Stored proc internals (single table read instead of multi-join)
- Pipeline notebooks (add a final step to upsert into `EntityStatusSummary`)

**What stays identical:**
- Python `build_entity_digest()` function (same input/output shape)
- `GET /api/entity-digest` endpoint (same URL, same query params, same response)
- `useEntityDigest` React hook (same API, same types, same caching)
- Every migrated page (zero frontend changes)

This is the key design principle: **the digest is a stable contract**. Consumers code against the `DigestEntity` shape once. Performance optimizations happen behind the stored proc boundary.

---

## Appendix: File Locations

| Component | Path |
|-----------|------|
| useEntityDigest hook | `dashboard/app/src/hooks/useEntityDigest.ts` |
| Backend server | `dashboard/app/api/server.py` |
| Backend digest function | `server.py` line ~3125 (`build_entity_digest`) |
| Backend digest cache | `server.py` line ~3121 (`_digest_cache`, `_DIGEST_TTL = 120`) |
| AdminGovernance (migrated) | `dashboard/app/src/pages/AdminGovernance.tsx` |
| FlowExplorer (migrated) | `dashboard/app/src/pages/FlowExplorer.tsx` |
| DataJourney (migrated) | `dashboard/app/src/pages/DataJourney.tsx` |
| SourceManager (migrated) | `dashboard/app/src/pages/SourceManager.tsx` |
| EntityDrillDown (migrated) | `dashboard/app/src/components/pipeline-matrix/EntityDrillDown.tsx` |
| RecordCounts (partial) | `dashboard/app/src/pages/RecordCounts.tsx` |
