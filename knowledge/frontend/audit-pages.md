# FMD Dashboard — Frontend Page Audit

> Generated 2026-03-09. Source: `dashboard/app/src/pages/`, `App.tsx`, `AppLayout.tsx`.
> Backend API: `dashboard/app/api/server.py` (Flask).

## Table of Contents

- [Route Table](#route-table)
- [Navigation Groups](#navigation-groups)
- [Page Detail by Category](#page-detail-by-category)
  - [Operations](#operations)
  - [Data](#data)
  - [Governance](#governance)
  - [Admin](#admin)
  - [Testing](#testing)
  - [Settings & Setup](#settings--setup)
  - [Labs (Feature-Flagged)](#labs-feature-flagged)
- [Shared Hooks & Contexts](#shared-hooks--contexts)
- [Data Flow Patterns](#data-flow-patterns)

---

## Route Table

All routes defined in `dashboard/app/src/App.tsx`. Every route renders inside `<BackgroundTaskProvider>` and `<AppLayout>`.

| Route | Component | File |
|-------|-----------|------|
| `/` | `ExecutionMatrix` | `pages/ExecutionMatrix.tsx` |
| `/engine` | `EngineControl` | `pages/EngineControl.tsx` |
| `/control` | `ControlPlane` | `pages/ControlPlane.tsx` |
| `/logs` | `ExecutionLog` | `pages/ExecutionLog.tsx` |
| `/errors` | `ErrorIntelligence` | `pages/ErrorIntelligence.tsx` |
| `/admin` | `AdminGateway` | `pages/AdminGateway.tsx` |
| `/flow` | `FlowExplorer` | `pages/FlowExplorer.tsx` |
| `/sources` | `SourceManager` | `pages/SourceManager.tsx` |
| `/blender` | `DataBlender` | `pages/DataBlender.tsx` |
| `/counts` | `RecordCounts` | `pages/RecordCounts.tsx` |
| `/journey` | `DataJourney` | `pages/DataJourney.tsx` |
| `/config` | `ConfigManager` | `pages/ConfigManager.tsx` |
| `/notebook-config` | `NotebookConfig` | `pages/NotebookConfig.tsx` |
| `/runner` | `PipelineRunner` | `pages/PipelineRunner.tsx` |
| `/validation` | `ValidationChecklist` | `pages/ValidationChecklist.tsx` |
| `/notebook-debug` | `NotebookDebug` | `pages/NotebookDebug.tsx` |
| `/live` | `LiveMonitor` | `pages/LiveMonitor.tsx` |
| `/settings` | `Settings` | `pages/Settings.tsx` |
| `/setup` | `EnvironmentSetup` | `pages/EnvironmentSetup.tsx` |
| `/sql-explorer` | `SqlExplorer` | `pages/SqlExplorer.tsx` |
| `/load-progress` | `LoadProgress` | `pages/LoadProgress.tsx` |
| `/profile` | `DataProfiler` | `pages/DataProfiler.tsx` |
| `/columns` | `ColumnEvolution` | `pages/ColumnEvolution.tsx` |
| `/microscope` | `DataMicroscope` | `pages/DataMicroscope.tsx` |
| `/sankey` | `SankeyFlow` | `pages/SankeyFlow.tsx` |
| `/replay` | `TransformationReplay` | `pages/TransformationReplay.tsx` |
| `/pulse` | `ImpactPulse` | `pages/ImpactPulse.tsx` |
| `/test-audit` | `TestAudit` | `pages/TestAudit.tsx` |
| `/test-swarm` | `TestSwarm` | `pages/TestSwarm.tsx` |
| `/mri` | `MRI` | `pages/MRI.tsx` |
| `/lineage` | `DataLineage` | `pages/DataLineage.tsx` |
| `/classification` | `DataClassification` | `pages/DataClassification.tsx` |
| `/catalog` | `DataCatalog` | `pages/DataCatalog.tsx` |
| `/impact` | `ImpactAnalysis` | `pages/ImpactAnalysis.tsx` |
| `/labs/cleansing` | `CleansingRuleEditor` | `pages/CleansingRuleEditor.tsx` |
| `/labs/scd-audit` | `ScdAudit` | `pages/ScdAudit.tsx` |
| `/labs/gold-mlv` | `GoldMlvManager` | `pages/GoldMlvManager.tsx` |
| `/labs/dq-scorecard` | `DqScorecard` | `pages/DqScorecard.tsx` |

**Total: 38 routed pages** (30 core + 4 governance + 4 labs).

---

## Navigation Groups

Defined in `dashboard/app/src/components/layout/AppLayout.tsx` as `CORE_GROUPS`. Labs group is dynamically built from feature flags via `buildLabsGroup()`. Page visibility controlled from Admin Gateway.

| Group | Pages |
|-------|-------|
| **Operations** | Execution Matrix, Engine Control, Validation, Load Progress, Live Monitor, Control Plane, Error Intelligence, Execution Log, Pipeline Runner, Pipeline Testing |
| **Data** | Source Manager, Data Flow (Sankey), Impact Pulse, Data Blender, Flow Explorer, Data Journey, Column Evolution, Data Profiler, Data Microscope, Transformation Replay, Record Counts, SQL Explorer |
| **Governance** | Data Lineage, Data Classification, Data Catalog, Impact Analysis |
| **Admin** | Admin, MRI, Test Swarm, Test Audit, Config Manager, Notebook Config, Settings, Environment Setup |
| **Labs** *(conditional)* | Cleansing Rules, SCD Audit, Gold / MLV, DQ Scorecard |

Pages can be hidden via Admin Gateway > Page Visibility tab (stored via `pageVisibility` lib). Hidden pages remain accessible via direct URL.

---

## Page Detail by Category

### Operations

| Page | Component | Route | Purpose | API Endpoints | Data Pattern | Key State |
|------|-----------|-------|---------|---------------|--------------|-----------|
| Execution Matrix | `ExecutionMatrix` | `/` | Home page. KPI cards (total entities, errors, success rate), layer health breakdown (LZ/Bronze/Silver), entity drill-down. | `/engine/status`, `/engine/metrics?hours=N`, `/engine/runs?limit=20`, `/engine/logs?entity_id=N` | **Polling 5s (toggle) + useEntityDigest** | Engine status, metrics, runs, auto-refresh ref |
| Engine Control | `EngineControl` | `/engine` | Start/stop/retry engine runs. Execution plan, dry-run, live log streaming, job tracking, health checks. | `/engine/status`, `/engine/runs`, `/engine/entities`, `/engine/metrics?hours=24`, `/engine/plan`, `/engine/start` (POST), `/engine/stop` (POST), `/engine/retry` (POST), `/engine/abort-run` (POST), `/engine/health`, `/engine/jobs`, `/engine/logs?run_id=N`, `/engine/logs/stream` (SSE) | **SSE + Polling 5s/15s/10s** | Engine status, runs, log buffer, entity selector, health report |
| Control Plane | `ControlPlane` | `/control` | High-level entity status summary with server-aggregated metrics, resync and maintenance agent triggers. | `/api/control-plane`, `/api/load-config`, `/api/entity-digest/resync` (POST), `/api/maintenance-agent/trigger` (POST) | **Polling 30s (visibility-aware)** | Control plane data, load config |
| Execution Log | `ExecutionLog` | `/logs` | Searchable/filterable log of all pipeline, copy, and notebook executions. | `/api/pipeline-executions`, `/api/copy-executions`, `/api/notebook-executions` | **One-shot** | Execution records, filters, search |
| Error Intelligence | `ErrorIntelligence` | `/errors` | Aggregated error analysis with pattern detection, severity classification, and actionable suggestions. | `/api/error-intelligence` | **One-shot (manual refresh)** | Error summaries, patterns, severity counts |
| Pipeline Runner | `PipelineRunner` | `/runner` | Wizard-based pipeline trigger (source > layer > review > run). Entity filtering per source. | `/runner/sources`, `/runner/state`, `/runner/entities?dataSourceId=N`, `/runner/prepare` (POST), `/runner/trigger` (POST), `/runner/restore` (POST) | **One-shot + state polling during run** | Wizard step, source selection, layer choice, runner state |
| Validation Checklist | `ValidationChecklist` | `/validation` | Pre-flight validation of entity load status across all layers. Source-level breakdown. | `/setup/validate` | **One-shot (manual refresh)** | Validation data, source expansion |
| Pipeline Testing | `NotebookDebug` | `/notebook-debug` | Debug individual notebooks against specific entities. Job status polling after trigger. | `/notebook-debug/notebooks`, `/notebook-debug/entities?layer=N`, `/notebook-debug/run` (POST), `/notebook-debug/job-status?notebookId=N` | **One-shot + polling while job active** | Notebooks, entities, job status, poll ref |
| Live Monitor | `LiveMonitor` | `/live` | Real-time feed of pipeline events, notebook events, copy activities. Configurable time window. | `/api/live-monitor?minutes=N` | **Polling (user-configurable, default ~10s)** | Events, counts, time window, auto-refresh |
| Load Progress | `LoadProgress` | `/load-progress` | Real-time load progress tracker across all layers. Auto-refresh with configurable interval. | `/api/load-progress` | **Polling (user-configurable, default 5s)** | Progress data, refresh interval |
| Notebook Config | `NotebookConfig` | `/notebook-config` | View/edit notebook parameters in Fabric. Upload updates. Job status tracking. | `/notebook-config`, `/notebook-config/update` (POST) | **One-shot + polling during upload** | Notebook config data, job status, elapsed timer |

### Data

| Page | Component | Route | Purpose | API Endpoints | Data Pattern | Key State |
|------|-----------|-------|---------|---------------|--------------|-----------|
| Source Manager | `SourceManager` | `/sources` | Entity CRUD. View/edit/delete entities per data source. Load config viewer. Source analysis. Onboarding wizard. | `/api/gateway-connections`, `/api/connections`, `/api/datasources`, `/api/load-config?datasource=N`, `/api/analyze-source?datasource=N`, `/api/register-bronze-silver` (POST), `/api/entities/cascade-impact?ids=N`, `/api/entities/{id}` (DELETE), `/api/entities/bulk-delete` (POST), `/api/connections` (POST) | **One-shot + useEntityDigest** | Connections, datasources, load config, entity digest, pending updates |
| Flow Explorer | `FlowExplorer` | `/flow` | Interactive architecture diagram: connections, pipelines, data flow paths. Entity flow + framework architecture views. | `/connections`, `/datasources`, `/pipelines` | **One-shot + useEntityDigest** | Connections, datasources, pipelines, view mode |
| Data Blender | `DataBlender` | `/blender` | Exploration sandbox: lakehouse table browser, profiler, SQL workbench. Sub-components (SqlWorkbench, TableProfiler). | `/api/purview/status` + sub-component lakehouse APIs | **One-shot + sub-component fetches** | Active tab, selected table, purview status |
| Record Counts | `RecordCounts` | `/counts` | Bronze vs Silver row count comparison matrix with match/mismatch status, delta, and CSV export. | `/api/lakehouse-counts` | **One-shot + useEntityDigest** | Counts data, counts meta, sort/filter state |
| Data Journey | `DataJourney` | `/journey` | Per-entity journey visualization through all medallion layers with step-by-step column/row detail. | `/api/journey?entity=N` | **On-demand per entity + useEntityDigest** | Journey data, active layer, entity selection |
| Column Evolution | `ColumnEvolution` | `/columns` | Animated column-level transformation timeline for an entity across Source/LZ/Bronze/Silver layers. | `/api/journey?entity=N` | **On-demand + useEntityDigest, autoplay setInterval** | Journey data, active layer, autoplay ref |
| Data Profiler | `DataProfiler` | `/profile` | Statistical profiling: column distributions, null rates, cardinality, data types. | `/api/microscope/{entity_id}` | **On-demand + useEntityDigest** | Profile data, selected entity, source filter |
| Data Microscope | `DataMicroscope` | `/microscope` | Row-level drill-through. Pick a PK, see source vs bronze vs silver values side-by-side. | `/api/microscope?entity=N&pk=V` | **On-demand + useEntityDigest, useMicroscope, useMicroscopePks** | Microscope data, search query, selected entity |
| Sankey Flow | `SankeyFlow` | `/sankey` | Sankey diagram of entity flows across layers (source > LZ > Bronze > Silver). | None (digest only) | **useEntityDigest only** | Entity digest, layout state |
| Transformation Replay | `TransformationReplay` | `/replay` | Step-by-step replay of Bronze-to-Silver transformations showing column-level changes. | Transformation endpoints | **On-demand + useEntityDigest** | Replay data, selected entity |
| SQL Explorer | `SqlExplorer` | `/sql-explorer` | Browse on-prem SQL Server databases: object tree, table details, column metadata. Deep-link support. | Sub-component APIs via `ObjectTree` and `TableDetail` (`/api/sql-explorer/*`) | **On-demand** | Selected table, sidebar width |

### Governance

| Page | Component | Route | Purpose | API Endpoints | Data Pattern | Key State |
|------|-----------|-------|---------|---------------|--------------|-----------|
| Data Lineage | `DataLineage` | `/lineage` | Column-level lineage: how columns flow through Source/LZ/Bronze/Silver. Per-entity detail panel. | `/api/microscope/{entity_id}` | **On-demand + useEntityDigest, resolveSourceLabel** | Selected entity, lineage detail |
| Data Classification | `DataClassification` | `/classification` | Sensitivity classification of columns (PII, financial, internal, etc.). Heatmap view by source. | None (client-side derived) | **useEntityDigest + resolveSourceLabel** | Classification data, source filter, view mode |
| Data Catalog | `DataCatalog` | `/catalog` | Searchable catalog of all entities with detail modal (Overview, Columns, Lineage, Quality tabs). | None (digest only) | **useEntityDigest + resolveSourceLabel** | Search, source filter, sort, selected entity modal |
| Impact Analysis | `ImpactAnalysis` | `/impact` | Upstream/downstream dependency analysis. What breaks if a source table changes. | None (derived from digest) | **useEntityDigest only** | Selected entity, impact graph |

### Admin

| Page | Component | Route | Purpose | API Endpoints | Data Pattern | Key State |
|------|-----------|-------|---------|---------------|--------------|-----------|
| Admin Gateway | `AdminGateway` | `/admin` | Hub with 5 tabs: Environment, Page Visibility, General, Deployment, Governance. Embeds `SetupSettings`, `DeploymentManager`, `AdminGovernance`, `GeneralTab`. | `/setup/current-config` | **One-shot** | Active tab, config data, hidden pages |
| Admin Governance | `AdminGovernance` | *(embedded in Admin Gateway)* | Full metadata governance view: connections, datasources, pipelines, workspaces, lakehouses, stats. | `/connections`, `/datasources`, `/pipelines`, `/workspaces`, `/lakehouses`, `/stats` | **One-shot + useEntityDigest, resolveSourceLabel** | All metadata collections |
| Config Manager | `ConfigManager` | `/config` | View/edit framework SQL configuration. Cascade impact analysis for changes. | `/config-manager`, `/config-manager/references` | **One-shot** | Config data, cascade refs |
| Executive Dashboard | `ExecutiveDashboard` | *(not in nav)* | Executive-level KPIs: pipeline success rates, entity coverage, data freshness. | `/executive` | **Polling 120s** | Executive data |

### Testing

| Page | Component | Route | Purpose | API Endpoints | Data Pattern | Key State |
|------|-----------|-------|---------|---------------|--------------|-----------|
| MRI | `MRI` | `/mri` | Machine Regression Intelligence hub. 5 tabs: Overview, Visual, Backend, Swarm, History. Lazy-loads TestSwarm. | Delegates to sub-components (useMRI hook, BackendTestPanel, FlakeGraph, CoverageHeatmap, CrossBranchCompare) | **Tab-based delegation** | Active tab, MRI data |
| Test Audit | `TestAudit` | `/test-audit` | Playwright test run history. Results, screenshots, videos, traces. Stats charts. Test description catalog. | `/test-audit/runs`, `/test-audit/run` (POST), `/test-audit/status` | **One-shot + polling 3s while running** | Run history, audit status, selected run |
| Test Swarm | `TestSwarm` | `/test-swarm` | AI-driven fix loop. Convergence charts, iteration detail, heatmaps. Run timeline. | `/test-swarm/runs`, `/test-swarm/runs/{id}/convergence`, `/test-swarm/runs/{id}/iteration/{n}` | **Polling 10s** | Runs, selected run, convergence data, iteration detail |

### Settings & Setup

| Page | Component | Route | Purpose | API Endpoints | Data Pattern |
|------|-----------|-------|---------|---------------|--------------|
| Settings | `Settings` | `/settings` | Labs feature flag toggles (Cleansing, SCD Audit, Gold MLV, DQ Scorecard). Deployment manager embed. | Feature flags via `getLabsFlags`/`setLabsFlag` (localStorage), deploy endpoints via DeploymentManager | **Local state + sub-component** |
| Environment Setup | `EnvironmentSetup` | `/setup` | Three-mode setup: Provision All, 6-step Wizard, or Settings view. Provisions Fabric resources. | `/setup/current-config`, `/setup/validate`, `/setup/create-workspace` (POST), `/setup/create-lakehouse` (POST), `/setup/create-sql-database` (POST), `/fabric/workspaces`, `/setup/capacities`, `/setup/provision-all` (POST), `/setup/save-config` (POST) | **On-demand** |

**Setup sub-components** (in `pages/setup/`):

| Component | File | Purpose |
|-----------|------|---------|
| `ProvisionAll` | `setup/ProvisionAll.tsx` | One-click provisioning: creates workspaces, lakehouses, SQL DB, connections |
| `SetupSettings` | `setup/SetupSettings.tsx` | Manual workspace/lakehouse/connection/DB selection via dropdowns |
| `SetupWizard` | `setup/SetupWizard.tsx` | 6-step guided configuration wizard |
| `CapacityStep` | `setup/steps/CapacityStep.tsx` | Wizard step 1: select Fabric capacity |
| `WorkspaceStep` | `setup/steps/WorkspaceStep.tsx` | Wizard step 2: select/create 5 workspaces |
| `ConnectionStep` | `setup/steps/ConnectionStep.tsx` | Wizard step 3: map Fabric connections |
| `LakehouseStep` | `setup/steps/LakehouseStep.tsx` | Wizard step 4: select/create lakehouses |
| `DatabaseStep` | `setup/steps/DatabaseStep.tsx` | Wizard step 5: select/create SQL database |
| `ReviewStep` | `setup/steps/ReviewStep.tsx` | Wizard step 6: review, save, validate |
| `FabricDropdown` | `setup/components/FabricDropdown.tsx` | Reusable dropdown that fetches Fabric resources from API |
| `StepIndicator` | `setup/components/StepIndicator.tsx` | Visual step progress indicator |
| `ValidationResults` | `setup/components/ValidationResults.tsx` | Save/validation result display |

**Settings sub-components** (in `pages/settings/`):

| Component | File | Purpose |
|-----------|------|---------|
| `DeploymentManager` | `settings/DeploymentManager.tsx` | Full deploy orchestration UI with SSE streaming, phase progress, resume |
| `PreDeploymentPanel` | `settings/PreDeploymentPanel.tsx` | Pre-deploy configuration checklist |
| `PhaseProgressTracker` | `settings/PhaseProgressTracker.tsx` | Visual phase progress bars |
| `LiveLogPanel` | `settings/LiveLogPanel.tsx` | Terminal-style log viewer with auto-scroll (max 500 lines) |
| `PostDeploymentSummary` | `settings/PostDeploymentSummary.tsx` | Post-deploy results: items deployed, ID mappings, status |
| `ResumeBanner` | `settings/ResumeBanner.tsx` | Resume failed deployment banner |
| `AgentCollaboration` | `settings/AgentCollaboration.tsx` | Claude agent collaboration log viewer with markdown rendering |

### Labs (Feature-Flagged)

All Labs pages are **placeholder stubs** (Coming Soon). Gated by feature flags in `localStorage` managed through the Settings page.

| Page | Component | Route | Flag Key | Status |
|------|-----------|-------|----------|--------|
| Cleansing Rule Editor | `CleansingRuleEditor` | `/labs/cleansing` | `cleansingRuleEditor` | Stub |
| SCD Audit View | `ScdAudit` | `/labs/scd-audit` | `scdAuditView` | Stub |
| Gold / MLV Manager | `GoldMlvManager` | `/labs/gold-mlv` | `goldMlvManager` | Stub |
| DQ Scorecard | `DqScorecard` | `/labs/dq-scorecard` | `dqScorecard` | Stub |

---

## Admin Gateway Tabs

The `/admin` route renders `AdminGateway`, which has 5 tabs:

| Tab ID | Label | Embedded Component |
|--------|-------|--------------------|
| `environment` | Environment | `SetupSettings` |
| `pages` | Page Visibility | Inline toggle grid |
| `general` | General | `GeneralTab` (from `Settings`) |
| `deployment` | Deployment | `DeploymentManager` |
| `governance` | Governance | `AdminGovernance` |

---

## Shared Hooks & Contexts

Located in `dashboard/app/src/hooks/` and `dashboard/app/src/contexts/`.

| Hook / Context | File | Purpose | Used By |
|----------------|------|---------|---------|
| `useEntityDigest` | `hooks/useEntityDigest.ts` | Module-level singleton cache (30s TTL, request dedup) for entity metadata from `/api/entity-digest`. Returns `allEntities`, `sourceList`, `totalSummary`, `refresh()`. | ExecutionMatrix, ControlPlane, FlowExplorer, SourceManager, RecordCounts, DataJourney, ColumnEvolution, DataProfiler, DataMicroscope, SankeyFlow, ImpactPulse, TransformationReplay, DataLineage, DataClassification, DataCatalog, ImpactAnalysis, AdminGovernance, LoadProgress |
| `useMicroscope` | `hooks/useMicroscope.ts` | Row-level data inspection for a specific entity across layers. | DataMicroscope |
| `useMicroscopePks` | `hooks/useMicroscope.ts` | PK search/discovery for a specific entity. | DataMicroscope |
| `useMRI` | `hooks/useMRI.ts` | Machine Regression Intelligence scoring hook. | MRI |
| `useSourceConfig` / `resolveSourceLabel` | `hooks/useSourceConfig.ts` | Source display label resolution (raw server name to human label). | AdminGovernance, DataCatalog, DataClassification, DataLineage, SourceManager |
| `BackgroundTaskProvider` | `contexts/BackgroundTaskContext.tsx` | Global context wrapping all routes. Manages background task state (e.g., running deployments). | App-wide (wraps `<AppLayout>`) |
| `getLabsFlags` / `setLabsFlag` | `lib/featureFlags.ts` | `localStorage`-based feature flags controlling Labs page nav visibility. | Settings |
| `getHiddenPages` / `updateHiddenPages` | `lib/pageVisibility.ts` | Page visibility management for sidebar nav. | AdminGateway |

---

## Data Flow Patterns

### SSE (Server-Sent Events) — 2 sources

Real-time streaming via `EventSource`. Connection maintained while component is mounted.

| Page | SSE Endpoint | Purpose |
|------|-------------|---------|
| Engine Control | `/api/engine/logs/stream` | Real-time task log streaming during engine runs |
| Deployment Manager (in Settings/Admin) | `/api/deploy/stream` | Live deployment phase progress and log streaming |

### Polling (setInterval) — 11 pages

Periodic re-fetch at fixed intervals. Some pages use visibility-aware polling (pause when tab hidden).

| Page | Interval | Endpoints Polled |
|------|----------|-----------------|
| Execution Matrix | 5s (toggle) | `/engine/status`, `/engine/metrics`, `/engine/runs` |
| Engine Control | 5s + 15s + 10s | `/engine/status` (5s), `/engine/jobs` (15s), `/engine/health` (10s) |
| Control Plane | 30s (visibility-aware) | `/api/control-plane`, `/api/load-config` |
| Executive Dashboard | 120s | `/executive` |
| Impact Pulse | 30s | `/api/live-monitor?minutes=30` |
| Live Monitor | Configurable (~10s default) | `/api/live-monitor?minutes=N` |
| Load Progress | Configurable (default 5s) | `/api/load-progress` |
| Notebook Config | During upload only | `/notebook-config` job status |
| Notebook Debug | While job active | `/notebook-debug/job-status` |
| Test Swarm | 10s | `/test-swarm/runs` |
| Test Audit | 3s (while running) | `/test-audit/status` |

### One-Shot Fetch (useEffect on mount)

Single fetch when component mounts. Manual refresh via button.

| Page | Endpoints |
|------|-----------|
| Execution Log | `/api/pipeline-executions`, `/api/copy-executions`, `/api/notebook-executions` |
| Error Intelligence | `/api/error-intelligence` |
| Admin Gateway | `/setup/current-config` |
| Admin Governance | `/connections`, `/datasources`, `/pipelines`, `/workspaces`, `/lakehouses`, `/stats` |
| Record Counts | `/api/lakehouse-counts` (+ useEntityDigest) |
| Data Blender | `/api/purview/status` (+ sub-component fetches) |
| Config Manager | `/config-manager` |
| Pipeline Runner | `/runner/sources`, `/runner/state` |

### On-Demand (User Interaction)

Data fetched only when user selects an entity or triggers an action.

| Page | Trigger | Endpoints |
|------|---------|-----------|
| Data Journey | Entity selection | `/api/journey?entity=N` |
| Column Evolution | Entity selection | `/api/journey?entity=N` |
| Data Profiler | Entity selection | `/api/microscope/{id}` |
| Data Microscope | Entity + PK search | `/api/microscope?entity=N&pk=V` |
| Data Lineage | Entity selection | `/api/microscope/{id}` |
| Transformation Replay | Entity selection | Transformation endpoints |
| SQL Explorer | Server/table selection | `/api/sql-explorer/*` |
| Source Manager | Analyze/register/delete | `/analyze-source`, `/register-bronze-silver`, `/entities/*`, `/load-config` |
| Pipeline Runner | Prepare/trigger | `/runner/prepare`, `/runner/trigger` |
| Notebook Debug | Run trigger | `/notebook-debug/run` (POST) |
| Environment Setup | Provision/save | `/setup/provision-all`, `/setup/save-config`, `/setup/create-*` |

### Digest-Only (No Direct API)

Pages that derive all data from the `useEntityDigest` hook with no additional API calls.

| Page | What It Derives |
|------|----------------|
| Data Catalog | Entity listing, search, detail modal |
| Data Classification | Sensitivity classification (client-side derived) |
| Impact Analysis | Dependency analysis |
| Sankey Flow | Entity flow diagram |

---

## API Base URL Pattern

All pages use one of two patterns:
- `const API = "/api"` — most pages (proxied in dev, direct in prod)
- `const API = import.meta.env.VITE_API_URL || ""` — TestAudit, TestSwarm (supports remote API)

Standard fetch helper used across most pages:
```typescript
async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
```

---

## Architecture Notes

1. **No Redux/Zustand** — State is local `useState`/`useReducer` per page. Cross-page state flows through `useEntityDigest` (singleton cache) and `BackgroundTaskProvider` (context).

2. **Entity Digest is the backbone** — 18+ pages rely on `useEntityDigest` as their primary data source. It has a 30-second TTL module-level cache with request deduplication.

3. **Labs pages are stubs** — All 4 labs pages (`/labs/*`) export placeholder components. Gated behind feature flags in sidebar nav but always routed.

4. **Setup wizard is self-contained** — The `/setup` route has its own component tree with typed config (`EnvironmentConfig` in `pages/setup/types.ts`).

5. **DeploymentManager reused** — Embedded in both `/settings` and `/admin` (Deployment tab).

6. **Page visibility is client-side** — `localStorage`-based, managed via `@/lib/pageVisibility`. The server also stores hidden pages in `admin_config.json`.

7. **Admin Gateway is a super-page** — Embeds 4 other pages/components via tabs (SetupSettings, DeploymentManager, AdminGovernance, GeneralTab).

---

## File Inventory

```
dashboard/app/src/
  App.tsx                              # Route definitions (38 routes)
  contexts/
    BackgroundTaskContext.tsx           # Global background task state
  hooks/
    useEntityDigest.ts                 # Singleton entity cache (30s TTL)
    useMicroscope.ts                   # Row-level data inspection + PK search
    useMRI.ts                          # MRI scoring
    useSourceConfig.ts                 # Source label resolution
  components/layout/
    AppLayout.tsx                      # Sidebar nav, 5 groups + dynamic Labs
  pages/
    ExecutionMatrix.tsx                # Home page — entity heatmap (polling 5s)
    EngineControl.tsx                  # Engine start/stop/monitor (SSE + polling)
    ControlPlane.tsx                   # High-level status (polling 30s)
    ExecutionLog.tsx                   # Execution history table (one-shot)
    ErrorIntelligence.tsx              # Error pattern analysis (one-shot)
    ValidationChecklist.tsx            # Layer validation (one-shot)
    LoadProgress.tsx                   # Per-source progress bars (polling 5s)
    LiveMonitor.tsx                    # Real-time event feed (polling ~10s)
    PipelineRunner.tsx                 # Wizard pipeline trigger (on-demand)
    NotebookDebug.tsx                  # Notebook testing tool (polling while active)
    NotebookConfig.tsx                 # Notebook config editor (one-shot)
    SourceManager.tsx                  # Entity/connection management (one-shot + digest)
    FlowExplorer.tsx                   # Architecture diagram (one-shot + digest)
    DataBlender.tsx                    # Lakehouse sandbox (one-shot)
    DataJourney.tsx                    # Per-entity layer journey (on-demand)
    ColumnEvolution.tsx                # Column schema comparison (on-demand + autoplay)
    DataProfiler.tsx                   # Statistical profiling (on-demand)
    DataMicroscope.tsx                 # Row-level data viewer (on-demand)
    TransformationReplay.tsx           # Bronze-to-Silver replay (on-demand)
    SankeyFlow.tsx                     # Sankey data flow diagram (digest-only)
    ImpactPulse.tsx                    # Real-time impact metrics (polling 30s)
    RecordCounts.tsx                   # Bronze/Silver row counts (one-shot + digest)
    SqlExplorer.tsx                    # On-prem SQL browser (on-demand)
    DataLineage.tsx                    # Column lineage visualization (on-demand)
    DataClassification.tsx             # Sensitivity classification (digest-only)
    DataCatalog.tsx                    # Entity catalog + detail modal (digest-only)
    ImpactAnalysis.tsx                 # Dependency impact analysis (digest-only)
    AdminGateway.tsx                   # Admin hub with 5 tabs (one-shot)
    AdminGovernance.tsx                # Full metadata governance (one-shot + digest)
    ExecutiveDashboard.tsx             # Executive KPIs (polling 120s)
    MRI.tsx                            # Machine Regression Intelligence (tab-based)
    TestSwarm.tsx                      # AI fix loop dashboard (polling 10s)
    TestAudit.tsx                      # Playwright test history (polling 3s while running)
    ConfigManager.tsx                  # Raw config editor (one-shot)
    EnvironmentSetup.tsx               # Setup wizard / provisioning (on-demand)
    Settings.tsx                       # Feature flags + deploy manager (local state)
    CleansingRuleEditor.tsx            # Labs stub
    ScdAudit.tsx                       # Labs stub
    GoldMlvManager.tsx                 # Labs stub
    DqScorecard.tsx                    # Labs stub
  pages/setup/
    types.ts                           # EnvironmentConfig, FabricEntity, wizard types
    ProvisionAll.tsx                    # One-click provisioning
    SetupSettings.tsx                  # Manual Fabric resource selection
    SetupWizard.tsx                    # 6-step guided wizard
    components/FabricDropdown.tsx      # Reusable Fabric resource picker
    components/StepIndicator.tsx       # Visual step progress
    components/ValidationResults.tsx   # Save/validation result display
    steps/CapacityStep.tsx             # Wizard step 1
    steps/WorkspaceStep.tsx            # Wizard step 2
    steps/ConnectionStep.tsx           # Wizard step 3
    steps/LakehouseStep.tsx            # Wizard step 4
    steps/DatabaseStep.tsx             # Wizard step 5
    steps/ReviewStep.tsx               # Wizard step 6
  pages/settings/
    DeploymentManager.tsx              # Deploy orchestration (SSE)
    PreDeploymentPanel.tsx             # Pre-deploy config
    PhaseProgressTracker.tsx           # Phase progress bars
    LiveLogPanel.tsx                   # Terminal log viewer
    PostDeploymentSummary.tsx          # Deploy results display
    ResumeBanner.tsx                   # Resume failed deploy banner
    AgentCollaboration.tsx             # Agent log viewer
```
