# TOOLS.md — API Lead Available Tools

## MCP Tools

### mssql-powerdata (Fabric SQL Metadata DB)
Your primary data source. This MCP server connects to the Fabric SQL Database that holds all FMD metadata.

- **Server**: `7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433`
- **Database**: `SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0`
- **Auth**: Service Principal token via `https://analysis.windows.net/powerbi/api/.default` scope
- **Key schemas**:
  - `integration.*` — Entity definitions, connections, datasources, lakehouses, pipelines
  - `execution.*` — Pipeline runs, copy activities, notebook executions, entity status summaries
- **Key tables**:
  - `integration.Entity` — All 659+ registered entities
  - `integration.Connection` — Source database connections
  - `integration.Datasource` — Source system definitions
  - `integration.LandingzoneEntity` / `integration.BronzeLayerEntity` / `integration.SilverLayerEntity` — Layer-specific entity config
  - `execution.PipelineExecution` — Pipeline run history
  - `execution.CopyActivity` — Individual copy activity results
  - `execution.EntityStatusSummary` — Digest engine rollup
- **Key stored procedures**:
  - `execution.sp_BuildEntityDigest` — Aggregated entity status
  - `execution.sp_UpsertEntityStatus` — Write entity load results
  - `execution.sp_AuditPipeline` / `execution.sp_AuditCopyActivity` — Execution logging
  - `integration.sp_UpsertPipelineLandingzoneEntity` / `sp_UpsertPipelineBronzeLayerEntity` — Entity registration

**Usage patterns**:
```
mcp__mssql-powerdata__query("SELECT TOP 10 * FROM integration.Entity")
mcp__mssql-powerdata__query("EXEC execution.sp_BuildEntityDigest")
```

### github
For version control operations, PR management, and code review.

- Create branches, commit, push
- Open PRs, request reviews, merge
- Read PR comments and review feedback

**Usage patterns**:
```
mcp__github__create_branch("api/MT-99-new-endpoint")
mcp__github__create_pull_request(title, body, base="main", head="api/MT-99-new-endpoint")
```

### git (CLI)
Direct git operations for branching, committing, and managing worktrees.

- `git checkout -b api/{branch-name}` — feature branches
- `git diff` — review changes before commit
- `git log --oneline -10` — recent history

## API Endpoints You Maintain

These are the routes in `server.py` that you own. Reference this list when scoping changes.

### GET Endpoints (Read)
| Route | Purpose | SQL Source |
|-------|---------|------------|
| `/api/entities` | All entities with optional filters | `integration.Entity` JOIN chain |
| `/api/bronze-entities` | Bronze layer entities | `integration.BronzeLayerEntity` |
| `/api/silver-entities` | Silver layer entities | `integration.SilverLayerEntity` |
| `/api/pipeline-view` | Pipeline execution overview | `execution.PipelineExecution` |
| `/api/bronze-view` | Bronze layer execution view | Aggregated bronze status |
| `/api/silver-view` | Silver layer execution view | Aggregated silver status |
| `/api/pipelines` | Pipeline definitions | `integration.Pipeline` |
| `/api/pipeline-executions` | Execution history | `execution.PipelineExecution` |
| `/api/copy-executions` | Copy activity details | `execution.CopyActivity` |
| `/api/notebook-executions` | Notebook run history | `execution.NotebookExecution` |
| `/api/control-plane` | Aggregated operational snapshot | Multi-table + cached JSON |
| `/api/stats` | Dashboard KPI stats | Aggregated counts |
| `/api/executive` | Executive summary | Multi-table rollup |
| `/api/pipeline-matrix` | Entity x Pipeline matrix | Cross-join status |
| `/api/source-config` | Source system configuration | `integration.Datasource` + `Connection` |
| `/api/config-manager` | System config viewer | `config.json` + DB config |
| `/api/health` | Health check | Connectivity test |
| `/api/error-intelligence` | Error pattern analysis | `execution.CopyActivity` errors |
| `/api/blender/*` | SQL workbench endpoints | Direct SQL execution |
| `/api/sql-explorer/*` | Cross-server SQL browser | Multiple SQL sources |
| `/api/setup/*` | Environment setup wizard | Fabric REST API |
| `/api/admin/*` | Admin panel operations | `admin_config.json` + DB |
| `/api/mri/*` | MRI scan results | MRI run data |
| `/api/test-swarm/*` | Test swarm results | Test execution data |

### POST Endpoints (Write)
| Route | Purpose |
|-------|---------|
| `/api/source-tables` | Fetch tables from source SQL server |
| `/api/connections` | Create/update connection |
| `/api/datasources` | Create/update datasource |
| `/api/entities` | Register new entities |
| `/api/entities/bulk-delete` | Bulk entity removal |
| `/api/sources/purge` | Purge source data |
| `/api/onboarding` | Source onboarding wizard |
| `/api/onboarding/step` | Advance onboarding step |
| `/api/blender/query` | Execute SQL query |
| `/api/setup/create-workspace` | Provision Fabric workspace |

## Testing Approach

No test framework. Validate endpoints with:

1. **curl**: `curl -s http://localhost:8787/api/health | python -m json.tool`
2. **Python requests**: For auth-dependent endpoints
3. **SQL verification**: Query Fabric SQL directly via `mssql-powerdata` to confirm API responses match source data
4. **Response shape diffing**: Compare actual response JSON against documented contract

## File Reference

| File | Purpose | Size |
|------|---------|------|
| `dashboard/app/api/server.py` | The monolith | ~11K LOC |
| `dashboard/app/api/config.json` | Server config (SECRETS — never commit) | ~200 lines |
| `dashboard/app/api/admin_config.json` | Admin panel config | ~50 lines |
| `dashboard/app/api/.runner_state.json` | Pipeline runner persistence | Variable |
| `dashboard/app/api/control_plane_snapshot.json` | Cached control plane | Variable |
| `dashboard/app/api/source_labels.json` | Display labels for sources | ~20 lines |
| `dashboard/app/api/fmd_metrics.db` | SQLite metrics | Binary |
