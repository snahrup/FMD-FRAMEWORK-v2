# TOOLS.md -- Fabric Engineer Available Tools

## MCP Tools

### fabric-mcp
Your primary tool for Fabric REST API operations. Use this for all workspace, lakehouse, notebook, and pipeline management.

**Common operations:**
- List workspace items: `GET /v1/workspaces/{workspaceId}/items`
- Get notebook content: `GET /v1/workspaces/{workspaceId}/notebooks/{notebookId}`
- Upload notebook: `POST /v1/workspaces/{workspaceId}/notebooks` (with updateMetadata)
- Trigger notebook: `POST /v1/workspaces/{workspaceId}/items/{notebookId}/jobs/instances?jobType=RunNotebook`
- Get pipeline definition: `GET /v1/workspaces/{workspaceId}/dataPipelines/{pipelineId}`
- Trigger pipeline: `POST /v1/workspaces/{workspaceId}/items/{pipelineId}/jobs/instances?jobType=Pipeline`
- Poll job status: `GET /v1/workspaces/{workspaceId}/items/{itemId}/jobs/instances/{jobId}`
- Force SQL endpoint refresh: `POST /v1/workspaces/{workspaceId}/sqlEndpoints/{endpointId}/refresh`
- Get lakehouse tables: `GET /v1/workspaces/{workspaceId}/lakehouses/{lakehouseId}/tables`

**Key workspace IDs:**
- DATA Dev: `0596d0e7-e036-451d-a967-41a284302e8d`
- CODE Dev: `c0366b24-e6f8-4994-b4df-b765ecb5bbf8`
- CONFIG: `e1f70591-6780-4d93-84bc-ba4572513e5c`

**Auth:** Service Principal token. Scope: `https://api.fabric.microsoft.com/.default`

### mssql-powerdata
Query the Fabric SQL Metadata Database. This is where all entity configuration and execution history lives.

**Key schemas:**
- `integration` -- Entity definitions, pipeline configs, connections, data sources
- `execution` -- Run history, audit logs, entity status summaries

**Key tables:**
- `integration.LandingzoneEntity` -- LZ entity configs (659 rows)
- `integration.BronzeLayerEntity` -- Bronze entity configs
- `integration.SilverLayerEntity` -- Silver entity configs
- `integration.DataPipelineConnection` -- Source connection definitions
- `execution.AuditPipeline` -- Pipeline run history
- `execution.AuditCopyActivity` -- Copy activity details per entity
- `execution.EntityStatusSummary` -- Latest status per entity (1,735 rows)
- `execution.EngineRun` -- Engine execution records

**Key stored procedures:**
- `execution.sp_UpsertEntityStatus` -- Called by notebooks after each load
- `execution.sp_BuildEntityDigest` -- Aggregated entity status report
- `integration.sp_UpsertPipelineLandingzoneEntity` -- Queue LZ entities for pipeline
- `integration.sp_UpsertPipelineBronzeLayerEntity` -- Queue Bronze entities for pipeline

**Auth:** SP token via `analysis.windows.net/powerbi/api/.default` scope with pyodbc `attrs_before`.

### mssql-m3-fdb
Query M3 ERP source database (`sqllogshipprd/m3fdbprd`). 3,973 tables. Use for schema discovery, PK analysis, and watermark candidate identification.

**Requires VPN.**

### mssql-mes
Query MES source database (`m3-db1/mes`). 586 tables. Largest entity source (445 registered entities).

**Requires VPN.**

### mssql-m3-etl
Query M3 Cloud source database (`sql2016live/DI_PRD_Staging`). 188 tables.

**Requires VPN.**

## Git

Standard git operations for version control.

**Your branch naming convention:** `fabric-engineer/{issue-key}`

**Files you commit:**
- `src/*.Notebook/notebook-content.py`
- `src/*.Notebook/*.ipynb`
- `src/*.DataPipeline/pipeline-content.json`
- `src/*.VariableLibrary/variables.json`
- `src/antigravity/*.py`
- `src/business_domain/**/*`

**Files you never commit:**
- Anything with credentials, tokens, or connection strings
- Files outside `src/`
- `config/` files (DevOps Lead owns these)

## CLI Tools

### Python (for notebook content validation)
```bash
python -c "import json; json.load(open('path/to/notebook.ipynb'))"  # Validate notebook JSON
python -c "import ast; ast.parse(open('path/to/notebook-content.py').read())"  # Validate Python syntax
```

### jq (for pipeline JSON inspection)
```bash
cat src/PL_FMD_LOAD_ALL.DataPipeline/pipeline-content.json | python -m json.tool  # Pretty-print
```

## Tools You Do NOT Have

- Frontend dev server (`npm run dev`) -- not your domain
- Engine module execution (`python engine/orchestrator.py`) -- not your domain
- Deploy script execution (`python deploy_from_scratch.py`) -- DevOps Lead only
- Dashboard API server (`python dashboard/app/api/server.py`) -- API Lead only
- `fix_pipeline_guids.py` -- DevOps Lead owns this. Request a re-run when needed.
