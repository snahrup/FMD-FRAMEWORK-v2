# FMD Dashboard — Frontend Component & Test Audit

> Generated 2026-03-09. Root: `dashboard/app/`
> Stack: React 19 + Vite 7 + TypeScript 5.9 + Tailwind 4 + Recharts 3 + Playwright

---

## 1. Component Directories

All paths relative to `dashboard/app/src/components/`.

### `datablender/` — Data Blender (table exploration + SQL)

| File | Export | Props | Purpose |
|------|--------|-------|---------|
| `BlendPreview.tsx` | `BlendPreview` | `{ blendId: string }` | Preview a blend recipe result |
| `BlendSuggestions.tsx` | `BlendSuggestions` | `{ sourceTableId, selectedBlendId, onSelectBlend }` | AI-powered join suggestions |
| `SqlWorkbench.tsx` | `SqlWorkbench` | `{ tableId: string }` | Interactive SQL editor against lakehouse |
| `TableBrowser.tsx` | `TableBrowser` | `{ selectedTableId, onSelectTable }` | Hierarchical table tree browser |
| `TableProfiler.tsx` | `TableProfiler` | `{ tableId: string }` | Column-level profiling (stats, nulls, cardinality) |

### `dq/` — Data Quality visualizations

| File | Export | Props | Purpose |
|------|--------|-------|---------|
| `AnimatedCounter.tsx` | `AnimatedCounter` | `{ value, prefix?, suffix?, duration?, className? }` | Smooth number animation |
| `ColumnQualityBar.tsx` | `ColumnQualityBar` | `{ label, value, total?, colorClass? }` | Horizontal quality indicator bar |
| `DqScoreRing.tsx` | `DqScoreRing` | `{ score, size?, strokeWidth?, label?, className? }` | Circular SVG score ring |
| `DqTrendChart.tsx` | `DqTrendChart` | `{ className? }` | Recharts trend line for DQ scores over time |
| `EntityHeatmap.tsx` | `EntityHeatmap` | `{ className? }` | Grid heatmap of entity quality scores |
| `EntitySparkline.tsx` | `EntitySparkline` | _(inline)_ | Mini sparkline for entity-level trends |
| `FreshnessIndicator.tsx` | `FreshnessIndicator` | _(inline)_ | Visual freshness/staleness indicator |
| `IssueSeverityDonut.tsx` | `IssueSeverityDonut` | _(inline)_ | Donut chart for issue severity breakdown |
| `SourceBreakdownCards.tsx` | `SourceBreakdownCards` | `{ className? }` | Per-source DQ summary cards |

### `impact-pulse/` — Impact Pulse flow graph

| File | Export | Props | Purpose |
|------|--------|-------|---------|
| `AnimatedEdge.tsx` | `AnimatedEdge` | _(ReactFlow edge props)_ | Animated edge for ReactFlow graphs |
| `LayerNode.tsx` | `LayerNode` | _(ReactFlow node props)_ | Custom node representing a medallion layer |

### `layout/` — App shell

| File | Export | Props | Purpose |
|------|--------|-------|---------|
| `AppLayout.tsx` | `AppLayout` | `{ children }` | Sidebar navigation + main content wrapper |

### `mri/` — MRI (visual regression / test dashboard)

| File | Export | Props | Purpose |
|------|--------|-------|---------|
| `AIAnnotationCard.tsx` | `AIAnnotationCard` | _(Props)_ | AI-generated analysis annotations |
| `BackendTestPanel.tsx` | `BackendTestPanel` | _(Props)_ | Backend API test results panel |
| `BaselineManager.tsx` | `BaselineManager` | _(Props)_ | Screenshot baseline management |
| `CoverageHeatmap.tsx` | `CoverageHeatmap` | _(Props)_ | Test coverage grid heatmap |
| `CrossBranchCompare.tsx` | `CrossBranchCompare` | _(Props)_ | Compare test results across git branches |
| `FlakeGraph.tsx` | `FlakeGraph` | _(Props)_ | Flaky test trend visualization |
| `ScreenshotGallery.tsx` | `ScreenshotGallery` | `{ diffs, aiAnalyses, runId, onSelect, filter? }` | Visual diff screenshot browser |
| `UnifiedKPIRow.tsx` | `UnifiedKPIRow` | `{ summary, visualDiffs, backendTotal, backendPassed }` | KPI summary row |
| `VisualDiffViewer.tsx` | `VisualDiffViewer` | _(Props)_ | Side-by-side screenshot diff viewer |

### `pipeline-matrix/` — Pipeline drill-down

| File | Export | Props | Purpose |
|------|--------|-------|---------|
| `EntityDrillDown.tsx` | `EntityDrillDown` | _(Props)_ | Per-entity execution detail panel |

### `sources/` — Source onboarding

| File | Export | Props | Purpose |
|------|--------|-------|---------|
| `SourceOnboardingWizard.tsx` | `SourceOnboardingWizard` | _(Props)_ | Multi-step wizard to register new data sources |

### `sql-explorer/` — SQL object browser

| File | Export | Props | Purpose |
|------|--------|-------|---------|
| `ObjectTree.tsx` | `ObjectTree` | _(Props)_ | Server/database/schema/table tree |
| `TableDetail.tsx` | `TableDetail` | `{ table: SelectedTable }` | Column detail + preview for selected table |

### `test-swarm/` — AI test swarm dashboard

| File | Export | Props | Purpose |
|------|--------|-------|---------|
| `AgentSessionLog.tsx` | `AgentSessionLog` | `{ log, className? }` | Agent session activity log viewer |
| `ConvergenceChart.tsx` | `ConvergenceChart` | `{ data, total, isActive? }` | Pass/fail convergence over iterations |
| `ConvergenceGauge.tsx` | `ConvergenceGauge` | `{ passed, total, label, size?, className? }` | Circular gauge for convergence % |
| `DiffViewer.tsx` | `DiffViewer` | `{ files, patch, className? }` | Code diff viewer for test fixes |
| `IterationDetail.tsx` | `IterationDetail` | `{ iteration, isOpen, onToggle }` | Expandable iteration breakdown |
| `KPIRow.tsx` | `KPIRow` | `{ testsPassing, testsTotal, iterations, maxIterations, ... }` | KPI summary row for swarm runs |
| `RunTimeline.tsx` | `RunTimeline` | _(Props)_ | Timeline visualization of swarm run phases |
| `SwarmSkeleton.tsx` | `SwarmSkeleton` | _(none)_ | Loading skeleton for swarm dashboard |
| `SwarmStatusBadge.tsx` | `SwarmStatusBadge` | _(Props)_ | Status badge for swarm run state |
| `TestHeatmap.tsx` | `TestHeatmap` | _(Props)_ | Heatmap of test pass/fail across iterations |
| `TestResultsTable.tsx` | `TestResultsTable` | _(Props)_ | Sortable table of individual test results |

### Root-level components

| File | Export | Props | Purpose |
|------|--------|-------|---------|
| `BackgroundTaskToast.tsx` | `BackgroundTaskToast` | _(none)_ | Toast notifications for background engine tasks |
| `DeploymentOverlay.tsx` | `DeploymentOverlay` | _(none)_ | Full-screen deployment progress overlay |
| `EntitySelector.tsx` | `EntitySelector` | _(Props)_ | Reusable entity picker dropdown |

---

## 2. UI Primitives (`components/ui/`)

All are shadcn/ui-style components using Radix + CVA + Tailwind.

| File | Purpose |
|------|---------|
| `badge.tsx` | Colored badge with variant support |
| `button.tsx` | Button with variant/size support (CVA) |
| `card.tsx` | Card/CardHeader/CardContent/CardFooter |
| `dialog.tsx` | Modal dialog (Radix Dialog) |
| `input.tsx` | Styled text input |
| `kpi-card.tsx` | KPI metric card (value, label, trend) |
| `layer-badge.tsx` | Medallion layer badge (LZ/Bronze/Silver/Gold) |
| `select.tsx` | Dropdown select (Radix Select) |
| `sensitivity-badge.tsx` | Data sensitivity level badge (PII/Confidential/etc.) |
| `status-badge.tsx` | Pipeline/entity status badge with icon |
| `theme-toggle.tsx` | Light/dark mode toggle |

---

## 3. Custom Hooks (`hooks/`)

| File | Exports | Purpose |
|------|---------|---------|
| `useEntityDigest.ts` | `useEntityDigest(filters?)`, `invalidateDigestCache()` | Fetches entity digest from `/api/entity-digest`. Module-level singleton cache with 30s TTL and request deduplication. Returns `{ entities, totals, loading, error, refresh }`. |
| `useMicroscope.ts` | `useMicroscope(entityId, pkValue)`, `useMicroscopePks(entityId, layer?, search?)`, `invalidateMicroscopeCache()` | Row-level data inspection. Fetches individual records across layers. Returns `{ data, loading, error, refresh }` and `{ pks, pkColumn, loading, error }`. |
| `useMRI.ts` | `useMRI(options?)` | MRI visual regression test data. Fetches run history, screenshot diffs, AI analyses. Returns run list, selected run detail, comparison data, loading states. |
| `useSourceConfig.ts` | `useSourceConfig()`, `resolveSourceLabel(raw)`, `getSourceColor(raw)`, `invalidateSourceConfig()` | Centralized source display names and colors. Reads from `/api/source-labels`. Returns `{ sources, labelMap, colorMap, loading }`. |

---

## 4. Type Definitions (`types/`)

| File | Key Exports | Purpose |
|------|-------------|---------|
| `blender.ts` | `DataLayer`, `Sensitivity`, `JoinType`, `Cardinality`, `ColumnDataType`, `LakehouseTable`, `ColumnProfile`, `LiveTableProfile`, `ColumnMetadata`, `TableProfile`, `SampleData`, `QueryResult`, `BlendSuggestion`, `BlendRecipe`, `PurviewEntity` | Data Blender + profiling types |
| `dashboard.ts` | `PipelineStatus`, `ErrorSeverity`, `PipelineLayer`, `ConnectionHealth`, `Layer`, `Status`, `Severity`, `PipelineRun`, `PipelineError`, `ErrorSummary`, `SourceSystem`, `EntityInventory`, `HealthScorecard`, `DataLineageNode`, `DataLineageConnection` | Core dashboard/pipeline types |
| `governance.ts` | `SensitivityLevel`, `CertificationStatus`, `DataQualityTier`, `ClassifiedBy`, `ColumnClassification`, `MedallionLayer`, `LineageRelationshipType`, `LineageNode`, `LineageEdge`, `ColumnLineage`, `ColumnSnapshot`, `DataOwner`, `DataTag`, `CatalogEntity`, `ImpactNode` | Governance, classification, lineage, catalog |
| `sqlExplorer.ts` | `SourceServer`, `SourceDatabase`, `SourceSchema`, `SourceTable`, `SourceColumn`, `TableInfo`, `TablePreview`, `SelectedTable`, `FabricLakehouse`, `OneLakeFileEntry` | SQL Object Explorer types |

---

## 5. Lib / Utilities (`lib/`)

| File | Key Exports | Purpose |
|------|-------------|---------|
| `utils.ts` | `cn(...inputs)`, `getSourceDisplayName(raw)` | Tailwind class merge (`clsx` + `twMerge`), legacy source display name wrapper |
| `statusColors.ts` | `StatusConfig`, `STATUS_MAP`, `resolveStatus(raw)`, `statusTextColor(raw)`, `statusCssVar(raw)`, `qualityColor(pct)`, `qualityLabel(pct)` | Canonical status-to-color/icon mapping. Single source of truth for all status rendering. |
| `typeIcons.ts` | `TypeIconConfig`, `TYPE_ICON_MAP`, `resolveTypeIcon(rawType)`, `TYPE_CATEGORIES` | SQL/Spark data type to Lucide icon + color mapping |
| `formatters.ts` | `formatTimestamp()`, `formatRelativeTime()`, `formatDuration()`, `formatDurationMs()`, `formatRowCount()`, `formatRowCountCompact()`, `formatPercent()`, `formatBytes()` | Display formatters for numbers, dates, durations, byte sizes |
| `featureFlags.ts` | `LabsFlags`, `getLabsFlags()`, `setLabsFlags()`, `setLabsFlag()`, `anyLabsEnabled()` | LocalStorage-backed feature flags for Labs pages |
| `layers.ts` | `LayerDef`, `LAYERS`, `LAYER_MAP`, `SOURCE_COLORS`, `getSourceColor()` | Medallion layer definitions + source color palette |
| `pageVisibility.ts` | _(functions for page visibility API)_ | Server-persisted admin control over sidebar nav items. Cache with 30s TTL. |
| `mockData.ts` | `mockPipelines`, `mockErrors`, `mockHealth`, `errorPatterns`, `errorSummaries`, `generateSourceSystems()`, `generateEntityInventory()`, `generateHealthScorecard()`, `generateDataLineage()` | Mock data for development/demo mode |

---

## 6. Pages (`pages/`)

### Core pages (40 route-mapped pages)

| Route | Page File | Purpose |
|-------|-----------|---------|
| `/` | `ExecutionMatrix.tsx` | **Homepage** — entity grid with LZ/Bronze/Silver status |
| `/engine` | `EngineControl.tsx` | Engine run control, KPIs, execution plans |
| `/control` | `ControlPlane.tsx` | Entity counts, pipeline layer sections, connections |
| `/logs` | `ExecutionLog.tsx` | Searchable execution history |
| `/errors` | `ErrorIntelligence.tsx` | Error analysis with root cause + suggested fixes |
| `/admin` | `AdminGateway.tsx` | Admin portal with governance controls |
| `/flow` | `FlowExplorer.tsx` | Pipeline flow graph visualization |
| `/sources` | `SourceManager.tsx` | Source system management |
| `/blender` | `DataBlender.tsx` | Table browser + SQL workbench + blend engine |
| `/counts` | `RecordCounts.tsx` | Row count tracking across layers |
| `/journey` | `DataJourney.tsx` | Entity lifecycle journey visualization |
| `/config` | `ConfigManager.tsx` | Configuration editor |
| `/notebook-config` | `NotebookConfig.tsx` | Notebook parameter configuration |
| `/runner` | `PipelineRunner.tsx` | Manual pipeline trigger UI |
| `/validation` | `ValidationChecklist.tsx` | Deployment validation checks |
| `/notebook-debug` | `NotebookDebug.tsx` | Notebook execution debugging |
| `/live` | `LiveMonitor.tsx` | Real-time pipeline monitoring |
| `/settings` | `Settings.tsx` _(via imports)_ | Settings hub |
| `/setup` | `EnvironmentSetup.tsx` | Environment provisioning wizard |
| `/sql-explorer` | `SqlExplorer.tsx` | Source SQL server object browser |
| `/load-progress` | `LoadProgress.tsx` | Load progress tracking per entity |
| `/profile` | `DataProfiler.tsx` | Table/column profiling |
| `/columns` | `ColumnEvolution.tsx` | Column schema change tracking |
| `/microscope` | `DataMicroscope.tsx` | Row-level data inspection across layers |
| `/sankey` | `SankeyFlow.tsx` | Sankey diagram of data flow volumes |
| `/replay` | `TransformationReplay.tsx` | Replay transformation logic step-by-step |
| `/pulse` | `ImpactPulse.tsx` | Impact pulse ReactFlow graph |
| `/test-audit` | `TestAudit.tsx` | Playwright test audit results |
| `/test-swarm` | `TestSwarm.tsx` | AI test swarm dashboard |
| `/mri` | `MRI.tsx` | Visual regression testing dashboard |
| `/lineage` | `DataLineage.tsx` | Column-level lineage visualization |
| `/classification` | `DataClassification.tsx` | Data sensitivity classification |
| `/catalog` | `DataCatalog.tsx` | Searchable data catalog |
| `/impact` | `ImpactAnalysis.tsx` | Change impact analysis |
| `/labs/cleansing` | `CleansingRuleEditor.tsx` | DQ cleansing rule editor (Labs) |
| `/labs/scd-audit` | `ScdAudit.tsx` | SCD Type 2 audit viewer (Labs) |
| `/labs/gold-mlv` | `GoldMlvManager.tsx` | Gold MLV management (Labs) |
| `/labs/dq-scorecard` | `DqScorecard.tsx` | DQ scorecard (Labs) |

### Settings sub-pages (`pages/settings/`)

| File | Purpose |
|------|---------|
| `AgentCollaboration.tsx` | Multi-agent collaboration settings |
| `DeploymentManager.tsx` | Deployment trigger + phase management |
| `LiveLogPanel.tsx` | Real-time deployment log streaming |
| `PhaseProgressTracker.tsx` | 17-phase deployment progress UI |
| `PostDeploymentSummary.tsx` | Post-deploy summary report |
| `PreDeploymentPanel.tsx` | Pre-deploy validation panel |
| `ResumeBanner.tsx` | Resume interrupted deployment banner |
| `types.ts` | Settings-specific type definitions |

### Setup wizard sub-pages (`pages/setup/`)

| File | Purpose |
|------|---------|
| `ProvisionAll.tsx` | One-click full environment provisioning |
| `SetupSettings.tsx` | Setup configuration settings |
| `SetupWizard.tsx` | Multi-step setup wizard shell |
| `types.ts` | Setup-specific type definitions |

#### Setup wizard steps (`pages/setup/steps/`)

| File | Purpose |
|------|---------|
| `CapacityStep.tsx` | Fabric capacity selection |
| `ConnectionStep.tsx` | Source connection configuration |
| `DatabaseStep.tsx` | SQL database provisioning |
| `LakehouseStep.tsx` | Lakehouse creation/selection |
| `ReviewStep.tsx` | Final review before provisioning |
| `WorkspaceStep.tsx` | Workspace selection/creation |

#### Setup wizard components (`pages/setup/components/`)

| File | Purpose |
|------|---------|
| `FabricDropdown.tsx` | Fabric resource dropdown picker |
| `StepIndicator.tsx` | Step progress indicator |
| `ValidationResults.tsx` | Step validation results display |

### Non-routed pages

| File | Purpose |
|------|---------|
| `AdminGovernance.tsx` | Governance sub-page (accessed via AdminGateway) |
| `ExecutiveDashboard.tsx` | Executive-level KPI dashboard |
| `PipelineMatrix.tsx` | Pipeline execution matrix view |
| `PipelineMonitor.tsx` | Pipeline monitoring (mock data based) |

---

## 7. Tests (`tests/`)

### Test Infrastructure

| Item | Value |
|------|-------|
| **Framework** | Playwright 1.58 |
| **Config** | `playwright.config.ts` |
| **Browser** | Chromium only |
| **Workers** | 1 (serial execution) |
| **Timeout** | 60s per test |
| **Base URL** | `http://localhost:5173` (Vite dev server) |
| **Screenshots** | Every test (viewport only) |
| **Video** | Every test (1280x720 webm, converted to mp4 by global teardown) |
| **Traces** | Full trace for every test |
| **Reporter** | HTML + JSON (`test-results/results.json`) |
| **Run command** | `npm run test:audit` |

### Test Files

| File | Tests | Description |
|------|-------|-------------|
| `fmd-dashboard-audit.spec.ts` | 25 | **Cross-page consistency audit** — scrapes every dashboard page, collects entity counts/statuses, then cross-validates numbers match across pages. Serial execution, data shared via `.audit-data.json`. |
| `mri-test-plan.spec.ts` | ~50+ | **Prioritized regression suite (P0-P3)** — API health checks, page load verification, feature-specific tests, navigation, and screenshot capture for every page. |
| `global-teardown.ts` | _(teardown)_ | Post-test cleanup — converts webm videos to mp4 |
| `.audit-data.json` | _(data)_ | Shared state between serial audit tests |

### Audit Test Coverage (fmd-dashboard-audit.spec.ts)

Pages scraped and cross-validated:
1. Execution Matrix, 2. Engine Control, 3. Validation, 4. Live Monitor, 5/5b. Control Plane + Connections, 6. Error Intelligence, 7. Execution Log, 8. Pipeline Runner, 9. Source Manager, 10. Data Blender, 11. Flow Explorer, 12. Record Counts, 13. Data Profiler, 14. Sankey Flow, 15. Pipeline Testing, 16. Impact Pulse, 17. Load Progress, 18. Executive Dashboard, 19. Column Evolution, 20. Data Journey, 21. Data Microscope, 22. Transformation Replay, 23. SQL Explorer, 24. Admin Gateway, 25. Cross-page consistency check

### MRI Test Plan Coverage (mri-test-plan.spec.ts)

| Priority | Test Group | Tests |
|----------|-----------|-------|
| P0 | API Health | 8 endpoint tests (health, config, digest, engine, control plane, source labels, entities, pipeline-view) |
| P0 | Execution Matrix | 5 tests (grid render, layer columns, source breakdown, target schema, screenshot) |
| P0 | Engine Control | 4 tests (status, KPI cards, dry run button, screenshot) |
| P0 | Control Plane | 3 tests (entity counts, pipeline layers, screenshot) |
| P1 | Record Counts | 3 tests |
| P1 | Source Manager | 2 tests |
| P1 | Execution Log | 2 tests |
| P1 | Pipeline Monitor | 2 tests |
| P1 | Error Intelligence | 2 tests |
| P1 | Pipeline Matrix | 2 tests |
| P1 | Navigation | 3 tests (sidebar, console errors, 404) |
| P2 | Data Journey, Flow Explorer, Data Blender, Validation, Live Monitor, Config Manager, Record Counts filters | 2 tests each |
| P3 | Data Profiler, Column Evolution, Sankey Flow, Load Progress, Executive Dashboard, Data Microscope, Transformation Replay, SQL Explorer, Impact Pulse, Data Lineage, Data Classification, Data Catalog, Impact Analysis | 2 tests each |
| P3 | Labs pages (Cleansing, SCD Audit, Gold MLV, DQ Scorecard) | 2 tests each |
| P3 | Test Audit, Test Swarm, MRI | 2 tests each |

### Test Swarm Configuration (`.test-swarm.yaml`)

| Setting | Value |
|---------|-------|
| Test command | `npx playwright test --reporter=json` |
| Max iterations | 5 |
| Model | `claude-sonnet-4-6` |
| Max turns/iteration | 25 |
| Timeout/iteration | 600s |
| Convergence threshold | 0 (all tests must pass) |
| Conductor URL | `http://localhost:3777` (Nexus) |

---

## 8. Package.json Summary

### Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `react` | 19.2 | UI framework |
| `react-router-dom` | 7.13 | Client-side routing |
| `tailwindcss` | 4.2 | Utility-first CSS |
| `recharts` | 3.7 | Chart library (bar, line, area, pie) |
| `@xyflow/react` | 12.10 | ReactFlow for graph/flow diagrams |
| `cytoscape` + `cytoscape-dagre` | 3.33 + 2.5 | Graph layout engine (lineage) |
| `d3-sankey` + `d3-shape` | 0.12 + 3.2 | Sankey diagrams |
| `framer-motion` | 12.35 | Animations |
| `gsap` | 3.14 | Advanced animations |
| `lucide-react` | 0.574 | Icon library |
| `@radix-ui/*` | various | Headless UI primitives (dialog, select, popover, separator, slot) |
| `class-variance-authority` | 0.7 | Component variant API |
| `clsx` + `tailwind-merge` | 2.1 + 3.4 | Class name utilities |
| `date-fns` | 4.1 | Date formatting |
| `react-markdown` | 10.1 | Markdown rendering |
| `react-day-picker` | 9.13 | Date picker |

### Scripts

| Script | Command |
|--------|---------|
| `dev` | `vite` |
| `build` | `tsc -b && vite build` |
| `lint` | `eslint .` |
| `preview` | `vite preview` |
| `test:audit` | `npx playwright test fmd-dashboard-audit.spec.ts --reporter=html` |

### Dev Dependencies

| Package | Purpose |
|---------|---------|
| `@playwright/test` 1.58 | E2E testing |
| `typescript` 5.9 | Type checking |
| `vite` 7.3 | Build tool |
| `@vitejs/plugin-react` 5.1 | React fast refresh |
| `eslint` 9.39 + plugins | Linting |

---

## 9. Architecture Notes

### Data Flow
- **API base**: `/api/` (proxied by Vite to Flask backend at `dashboard/app/api/server.py`)
- **State management**: No global store (Redux/Zustand). Each page fetches its own data via `fetch()` or custom hooks.
- **Caching**: Module-level singleton caches in hooks (`useEntityDigest`, `useSourceConfig`, `useMicroscope`) with 30s TTL and request deduplication.
- **Feature flags**: `localStorage`-backed via `lib/featureFlags.ts`. Labs pages gated behind flags.

### Styling
- Tailwind 4 with `@tailwindcss/vite` plugin (no PostCSS config needed)
- Dark mode via CSS variables and Tailwind dark: variants
- shadcn/ui-inspired component patterns (Radix + CVA)
- Custom CSS variables: `--cl-success`, `--cl-error`, `--cl-warning`, `--cl-info`

### Component Count Summary

| Category | Count |
|----------|-------|
| Feature component directories | 8 |
| Feature component files | 42 |
| UI primitive files | 11 |
| Root-level components | 3 |
| Custom hooks | 4 |
| Type definition files | 4 |
| Lib/utility files | 8 |
| Page files (routed) | 38 |
| Page files (sub-pages/steps) | 21 |
| Test spec files | 2 |
| **Total frontend files** | **~133** |
