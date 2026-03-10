# TOOLS.md -- CTO Available Tools

## Access Policy

Default: **read-only** on all MCP tools. Write operations require task-level justification logged in the heartbeat summary. Destructive operations (DELETE, DROP, workspace removal) require explicit Board approval.

---

## 1. Paperclip API (Task Management)

Base URL: Injected via `PAPERCLIP_API_URL` env var.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/agents/me` | GET | Confirm identity, role, budget, chain of command |
| `/api/companies/{companyId}/issues` | GET | List tasks (filter by assignee, status, priority) |
| `/api/companies/{companyId}/issues` | POST | Create subtasks (always set parentId, goalId) |
| `/api/issues/{id}` | GET | Read task details |
| `/api/issues/{id}` | PATCH | Update status, assignee, priority |
| `/api/issues/{id}/checkout` | POST | Claim a task (409 = already claimed, do not retry) |
| `/api/issues/{id}/comments` | POST | Add comment (concise markdown) |
| `/api/companies/{companyId}/goals` | GET | List active goals |
| `/api/agents` | GET | List all agents and their current assignments |

**Headers**: Always include `X-Paperclip-Run-Id` on POST/PATCH/DELETE.

---

## 2. Nexus API (Cross-Session Coordination)

Base URL: `http://localhost:3777`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/sessions?status=active` | GET | List active agent sessions |
| `/api/sessions/by-name/{name}` | GET | Look up session by animal name |
| `/api/messages/unread/{sessionId}` | GET | Check for unread messages/alerts |
| `/api/messages` | POST | Send message to other sessions |
| `/api/memory/context` | GET | Read shared memory blocks |
| `/api/memory` | POST | Write memory block (fact, decision, discovery, context) |
| `/api/activity` | GET | Recent activity feed across all sessions |

**Message types**: `info`, `alert`, `discovery`, `request`, `response`
**Memory categories**: `fact`, `decision`, `pattern`, `context`, `discovery`

---

## 3. MCP Tools -- SQL Databases (Read-Only Default)

### mssql-powerdata (Fabric SQL Metadata DB)
- **Use for**: Entity config queries, execution tracking, stored proc inspection
- **Key tables**: `integration.LandingzoneEntity`, `integration.BronzeLayerEntity`, `integration.SilverLayerEntity`, `execution.LandingzoneEntityLastLoadValue`, `execution.EntityStatusSummary`
- **Key procs**: `sp_UpsertLandingzoneEntity`, `sp_UpsertPipelineLandingzoneEntity`, `sp_AuditPipeline`, `sp_AuditCopyActivity`, `sp_UpsertEngineRun`, `sp_InsertEngineTaskLog`
- **Auth**: SP token via `struct.pack` pattern. Scope: `https://analysis.windows.net/powerbi/api/.default`

### mssql-m3-fdb, mssql-m3-etl, mssql-mes (On-Prem Sources)
- **Requires VPN**
- **Use for**: Source schema inspection, row count verification, watermark column discovery
- **Auth**: Windows auth (`Trusted_Connection=yes`)
- **DO NOT** use `.ipaper.com` suffix on hostnames

---

## 4. MCP Tools -- Fabric Platform

### fabric-mcp
- **Use for**: Workspace inspection, item listing, lakehouse metadata, pipeline status
- **Key operations**: List workspaces, list items, get item details, check pipeline runs
- **Write operations**: Require task justification

---

## 5. MCP Tools -- Collaboration

### mcp-atlassian (Jira)
- **Use for**: Task status checks, cross-referencing MT tickets
- **Project**: MT
- **Voice rules**: See global CLAUDE.md Jira guidelines (write as Steve, ADF format, no AI mentions)

### github (GitHub)
- **Use for**: PR status, branch protection, commit history
- **Write**: PR creation, review comments (require task justification)

---

## 6. Git (Local)

Available directly via bash.

| Command | When to Use |
|---------|-------------|
| `git status` | Every heartbeat (Step 0 gap detection) |
| `git log --oneline -10` | Check recent commits for context |
| `git diff` | Review uncommitted changes |
| `git diff main...HEAD` | Review full branch delta for PR prep |
| `git branch -a` | Check branch state |

**Never run**: `git reset --hard`, `git push --force`, `git clean -f` without Board approval.

---

## 7. Domain-Specific Tools

### Deploy Script Inspection
```bash
python deploy_from_scratch.py --dry-run  # Validate all 17 phases without executing
```

### Entity Health Check
```sql
-- Via mssql-powerdata
SELECT DataSourceId, COUNT(*) as entities,
       SUM(CASE WHEN IsActive=1 THEN 1 ELSE 0 END) as active
FROM integration.LandingzoneEntity
GROUP BY DataSourceId
```

### Engine Status
```bash
curl -s http://localhost:8787/api/engine/status
```

### Dashboard Health
```bash
curl -s http://localhost:8787/api/health
```

---

## Tool Selection Guidelines

- **Architecture question?** Start with git log + Fabric SQL metadata. Understand what exists before deciding what to change.
- **Agent blocked?** Check Nexus messages first, then Paperclip task status, then git status for uncommitted work.
- **Code review?** Git diff only. Read the code, not the PR description.
- **Deployment issue?** deploy_from_scratch.py dry-run + Fabric SQL entity counts + engine status endpoint.
- **Cross-cutting concern?** Nexus memory blocks. Write your decision. Other agents read it.
