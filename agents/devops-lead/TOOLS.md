# TOOLS.md -- DevOps Lead Available Tools

## MCP Tools

### fabric-mcp
Your primary tool for Fabric REST API operations. Used for workspace verification, item listing, deployment validation, and capacity management.

**Common operations:**
- List workspaces: `GET /v1/workspaces`
- Get workspace details: `GET /v1/workspaces/{workspaceId}`
- List workspace items: `GET /v1/workspaces/{workspaceId}/items`
- Get item details: `GET /v1/workspaces/{workspaceId}/items/{itemId}`
- Check capacity: `GET /v1/capacities`
- Resume capacity: `POST /v1/capacities/{capacityId}/resume`
- Get SQL DB connection string: `GET /v1/workspaces/{workspaceId}/sqlDatabases/{dbId}`

**Key workspace IDs:**
- DATA Dev: `0596d0e7-e036-451d-a967-41a284302e8d`
- CODE Dev: `c0366b24-e6f8-4994-b4df-b765ecb5bbf8`
- CODE Prod: `f825b6f5-1c3d-4b5d-be8a-12e3c2523d38`
- CONFIG: `e1f70591-6780-4d93-84bc-ba4572513e5c`
- DATA Prod: `5a54d6ec-bafb-4193-a1c3-00a3097c3660`
- SQL DB Item: `ed567507-5ec0-48fd-8b46-0782241219d5`

**Auth:** Service Principal token. Scope: `https://api.fabric.microsoft.com/.default`

### github
GitHub operations for repository management, PR workflows, and CI/CD.

**Common operations:**
- Create PR: `gh pr create --title "..." --body "..."`
- List PRs: `gh pr list`
- Check CI status: `gh run list`
- View workflow: `gh workflow view {name}`
- Create release: `gh release create {tag}`

**Branch naming convention:** `devops-lead/{issue-key}`

### azure-mcp-server
Azure resource management for capacity operations, resource group inspection, and service health.

**Common operations:**
- List resource groups
- Check Fabric capacity status
- Inspect Azure AD app registrations (SP verification)
- Query Azure Monitor for capacity metrics

## Git

Standard git operations for version control.

**Your branch naming convention:** `devops-lead/{issue-key}`

**Files you commit:**
- `deploy_from_scratch.py`
- `config/item_config.yaml`
- `config/entity_registration.json`
- `config/source_systems.yaml`
- `config/id_registry.json`
- `config/item_deployment.json`
- `scripts/*.py` (all deployment, diagnostic, fix, migration scripts)
- `scripts/config-bundle/*`
- `scripts/provision-launcher.ps1`
- `.github/workflows/*`
- `.deploy_state.json`

**Files you never commit:**
- Anything with credentials, tokens, SP secrets, or passwords
- `dashboard/app/api/config.json` (contains SP credentials -- API Lead territory)
- Files in `src/` (Fabric Engineer territory)
- Files in `engine/` (Engine Lead territory)
- Files in `dashboard/app/src/` (Frontend Lead territory)

## CLI Tools

### Python (deployment and scripting)
```bash
python deploy_from_scratch.py                    # Full 17-phase deploy (CTO approval required)
python deploy_from_scratch.py --phase 13         # Run single phase
python scripts/fix_pipeline_guids.py             # GUID remapping (run after every pipeline re-deploy)
python scripts/run_load_all.py                   # REST API orchestrator
python scripts/deploy_digest_engine.py           # Entity digest engine deployment
python scripts/deploy_schema_direct.py           # Direct schema deployment
python scripts/overnight_deploy_and_load.py      # Unattended overnight deploy
```

### Remote Server (via SSH or RDP)
```powershell
nssm status Nexus                                # Check Nexus service
nssm status FMD-Dashboard                        # Check dashboard service
nssm restart FMD-Dashboard                       # Restart dashboard service
node --version                                   # Must be v22 LTS
```

### Validation Commands
```bash
python -c "import yaml; yaml.safe_load(open('config/item_config.yaml'))"          # Validate YAML
python -c "import json; json.load(open('config/entity_registration.json'))"        # Validate JSON
python -c "import json; json.load(open('config/id_registry.json'))"                # Validate registry
```

### Config Diff (local vs server)
```bash
diff scripts/config-bundle/dashboard-config.json <(ssh vsc-fabric 'cat C:\\Projects\\FMD_FRAMEWORK\\dashboard\\app\\api\\config.json')
```

## Tools You Do NOT Have

- Source database MCP tools (`mssql-m3-fdb`, `mssql-mes`, `mssql-m3-etl`) -- Fabric Engineer runs source DB analysis
- Frontend dev server (`npm run dev`) -- Frontend Lead territory
- Engine module execution (`python engine/orchestrator.py`) -- Engine Lead territory
- Dashboard API server (`python dashboard/app/api/server.py`) -- API Lead territory
- Browser testing tools -- Frontend Lead / QA Lead territory
