# TOOLS.md — Frontend Lead Available Tools

## MCP Tools

### TestSprite (Test Generation & Execution)
Your primary testing tool. Generates test plans and executes them against the dashboard.

- `mcp__TestSprite__testsprite_generate_frontend_test_plan` — Generate a test plan for a page or component
- `mcp__TestSprite__testsprite_generate_code_and_execute` — Generate test code and run it
- `mcp__TestSprite__testsprite_rerun_tests` — Re-run failed tests
- `mcp__TestSprite__testsprite_open_test_result_dashboard` — View results
- `mcp__TestSprite__testsprite_generate_code_summary` — Summarize tested code

**Usage pattern**: When completing a page or component, generate a frontend test plan first, then execute it. Fix failures before marking the task done.

```
mcp__TestSprite__testsprite_generate_frontend_test_plan({
  "target": "dashboard/app/src/pages/RecordCounts.tsx",
  "scope": "component rendering, API integration, empty/error states"
})
```

### Chrome DevTools (Runtime Inspection)
For debugging rendering issues, network requests, and performance.

- Inspect DOM elements and computed styles
- Monitor network requests to `/api/*` endpoints
- Check console for errors and warnings
- Profile render performance on heavy pages

### git (CLI)
Direct git operations for branching, committing, and managing worktrees.

- `git checkout -b ui/{branch-name}` — feature branches
- `git diff` — review changes before commit
- `git log --oneline -10` — recent history

### github
For PR management and code review.

- Create PRs with clear descriptions
- Request reviews from API Lead or CTO
- Review PRs that touch API response consumption

## Build Tools

### TypeScript Compiler
```bash
cd dashboard/app && npx tsc --noEmit
```
Run after every change. Zero errors is the gate for any commit.

### Vite Dev Server
```bash
cd dashboard/app && npm run dev
```
Hot module replacement for development. Runs on port 5173, proxies API to 8787.

### Vite Production Build
```bash
cd dashboard/app && npm run build
```
Output to `dashboard/app/dist/`. The API server serves this directory as static files.

### Playwright (E2E Tests)
```bash
cd dashboard/app && npx playwright test
```
Config at `dashboard/app/playwright.config.ts`. Use for full page integration tests.

## API Endpoints You Consume

These are the endpoints your pages call. If you need a new endpoint, file a request with the API Lead.

### Entity & Pipeline Data
| Endpoint | Method | Used By | Returns |
|----------|--------|---------|---------|
| `/api/entities` | GET | SourceManager, RecordCounts, ControlPlane | Entity list with layer status |
| `/api/bronze-entities` | GET | PipelineMatrix | Bronze layer entities |
| `/api/silver-entities` | GET | PipelineMatrix | Silver layer entities |
| `/api/pipeline-view` | GET | PipelineMonitor | Pipeline execution overview |
| `/api/pipeline-matrix` | GET | PipelineMatrix | Entity x Pipeline cross-ref |
| `/api/pipelines` | GET | PipelineRunner | Pipeline definitions |

### Execution & Monitoring
| Endpoint | Method | Used By | Returns |
|----------|--------|---------|---------|
| `/api/pipeline-executions` | GET | ExecutionLog, ExecutionMatrix | Run history |
| `/api/copy-executions` | GET | ExecutionMatrix | Copy activity details |
| `/api/notebook-executions` | GET | NotebookDebug | Notebook run history |
| `/api/control-plane` | GET | ControlPlane | Aggregated operational snapshot |
| `/api/stats` | GET | ExecutiveDashboard | KPI numbers |
| `/api/executive` | GET | ExecutiveDashboard | Executive summary |
| `/api/error-intelligence` | GET | ErrorIntelligence | Error pattern analysis |
| `/api/fabric-jobs` | GET | LiveMonitor | Active Fabric job status |

### Configuration
| Endpoint | Method | Used By | Returns |
|----------|--------|---------|---------|
| `/api/source-config` | GET | SourceManager, hooks | Source system config |
| `/api/config-manager` | GET | ConfigManager | System configuration |
| `/api/notebook-config` | GET | NotebookConfig | Notebook parameters |
| `/api/admin/config` | GET | AdminGovernance | Admin settings |
| `/api/health` | GET | AppLayout (heartbeat) | Server health |

### Data Exploration
| Endpoint | Method | Used By | Returns |
|----------|--------|---------|---------|
| `/api/blender/tables` | GET | SqlWorkbench | Available tables |
| `/api/blender/query` | POST | SqlWorkbench | SQL query results |
| `/api/blender/profile` | GET | TableProfiler | Column profiling data |
| `/api/sql-explorer/servers` | GET | ObjectTree | SQL server list |
| `/api/sql-explorer/lakehouses` | GET | ObjectTree | Lakehouse list |

### Setup & Onboarding
| Endpoint | Method | Used By | Returns |
|----------|--------|---------|---------|
| `/api/setup/*` | GET/POST | EnvironmentSetup wizard | Fabric provisioning |
| `/api/onboarding` | GET/POST | SourceOnboardingWizard | Source registration flow |
| `/api/runner/*` | GET | PipelineRunner | Runner state and sources |

### Write Operations
| Endpoint | Method | Used By | Purpose |
|----------|--------|---------|---------|
| `/api/entities` | POST | SourceOnboardingWizard | Register entities |
| `/api/entities/bulk-delete` | POST | SourceManager | Remove entities |
| `/api/sources/purge` | POST | AdminGovernance | Purge source data |
| `/api/source-config/label` | POST | SourceManager | Update source labels |

## File Reference

### Pages (44 files in `src/pages/`)
| Status | Pages |
|--------|-------|
| **Production-ready** | ControlPlane, PipelineMatrix, SourceManager, RecordCounts, ExecutionMatrix, EngineControl, ExecutionLog, PipelineMonitor, ConfigManager, LiveMonitor, PipelineRunner, EnvironmentSetup |
| **Functional, needs polish** | ExecutiveDashboard, DataJourney, FlowExplorer, AdminGovernance, ValidationChecklist, NotebookDebug, AdminGateway, SqlExplorer, DataBlender |
| **In progress** | DataMicroscope, ImpactPulse, MRI, TestSwarm, DataCatalog, DataLineage, DataProfiler, LoadProgress, SankeyFlow |
| **Stub/placeholder** | ColumnEvolution, TransformationReplay, DataClassification, TestAudit, ImpactAnalysis, ScdAudit, ErrorIntelligence, GoldMlvManager, CleansingRuleEditor, NotebookConfig, DqScorecard |

### Component Directories
| Directory | Purpose | Key Files |
|-----------|---------|-----------|
| `src/components/ui/` | shadcn/ui + custom primitives | StatusBadge, KpiCard, LayerBadge, SensitivityBadge, Dialog |
| `src/components/dq/` | Data quality visualizations | EntityHeatmap, ColumnQualityBar, DqTrendChart, SourceBreakdownCards |
| `src/components/pipeline-matrix/` | Pipeline matrix features | EntityDrillDown |
| `src/components/sql-explorer/` | SQL browser components | ObjectTree, TableDetail |
| `src/components/datablender/` | SQL workbench components | SqlWorkbench, TableProfiler |
| `src/components/sources/` | Source management | SourceOnboardingWizard |
| `src/components/layout/` | App shell | AppLayout |
| `src/components/impact-pulse/` | Impact analysis | (in progress) |
| `src/components/mri/` | MRI scan UI | (in progress) |
| `src/components/test-swarm/` | Test execution UI | (in progress) |

### Hooks
| Hook | Purpose | Used By |
|------|---------|---------|
| `useEntityDigest` | Fetch aggregated entity status (30s TTL, deduped) | RecordCounts, ControlPlane |
| `useMRI` | Fetch MRI scan data | MRI page |
| `useMicroscope` | Fetch microscope/drill-down data | DataMicroscope |
| `useSourceConfig` | Fetch source system configuration | SourceManager, onboarding |

### Types
| File | Defines |
|------|---------|
| `src/types/dashboard.ts` | Core entity, pipeline, execution types |
| `src/types/governance.ts` | Admin and governance types |
| `src/types/sqlExplorer.ts` | SQL explorer types |
| `src/types/blender.ts` | Data blender/workbench types |

### Styling
- **Theme**: Dark glassmorphism — `index.css` custom properties define colors, gradients, glass effects
- **Framework**: Tailwind CSS for layout, spacing, responsive
- **Components**: shadcn/ui for primitives, custom for domain-specific
- **Charts**: Recharts for data visualization
- **Graphs**: Cytoscape.js for DataLineage, FlowExplorer (heavy — lazy-load)
