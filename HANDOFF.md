# FMD Framework — Session Handoff

> **From**: FMD_FRAMEWORK (session 83fa36f8)
> **Date**: 2026-03-10
> **Target repo**: `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK`
> **Branch**: `main` (4 commits ahead of origin, clean working tree)

---

## MISSION

Execute the 4 pending specs in `specs/pending/` using Claude Code's native agent team capability. Spawn teammates with the agent personas in `agents/` and crank through all specs.

---

## WHAT HAPPENED LAST NIGHT (March 9-10)

### Commits (all on main)
1. `1535ada` — Full project audit: 377 files, knowledge base (12 docs), 9 agent roles, engine fixes, 14 new dashboard pages, CI/CD, 90+ scripts
2. `54608b3` — SQLite control plane wiring into server.py (reads local SQLite first, Fabric SQL fallback), `AGENT_TEAM_SPRINT.md` created, Playwright tests
3. `506fb03` — Agent team sprint completed (4 teammates): SQLite wiring, Execution Log P0 fix, 156 new engine tests, Semgrep fixes, sidebar cleanup
4. `2596fc8` — Test fixes for orchestrator throttle patterns and pipeline runner mock (47/47 passing)

### What's Done
- SQLite control plane is PRIMARY data source for dashboard (Fabric SQL is fallback)
- 156 engine tests written, 47/47 passing
- Execution Log "status unknown" P0 bug fixed
- 8 critical dashboard pages validated
- Semgrep config fixed, 7 security findings resolved
- 51 Playwright E2E tests exist
- Full knowledge base under `knowledge/` (12 docs)
- 9 agent personas under `agents/` with AGENTS.md, SOUL.md, HEARTBEAT.md, TOOLS.md

---

## WHAT NEEDS TO HAPPEN NOW

### 4 Pending Specs (in `specs/pending/`)

| # | Spec | Priority | Owner Role | Dependencies | VPN? |
|---|------|----------|------------|--------------|------|
| 001 | Verify Bronze→Silver 100-Entity Activation | CRITICAL | Engine Lead | None | YES |
| 002 | Execute Full Bronze→Silver Load & Verify | CRITICAL | Engine Lead | Blocked by 001 | YES |
| 005 | Write control_plane_db.py Unit Test Suite | HIGH | QA Engineer | None | NO |
| 010 | Complete ExecutionMatrix Page (Tier 1, 40 assertions) | CRITICAL | Frontend Lead | Blocked by 001 (data) | NO |

### Execution Plan
1. **Specs 005 + 010** can start immediately in parallel (no VPN, no dependencies)
2. **Spec 001** can start immediately but requires VPN + Fabric SQL access
3. **Spec 002** is blocked until 001 passes

### Agent Team Composition
Spawn these teammates from `agents/`:

| Teammate | Spec | Model |
|----------|------|-------|
| `engine-lead` | 001 (then 002) | claude-opus-4-6 |
| `qa-engineer` | 005 | claude-opus-4-6 |
| `frontend-lead` | 010 | claude-opus-4-6 |

Each agent has full persona docs at `agents/<role>/AGENTS.md` — read them before starting.

---

## CRITICAL CONTEXT

### Nexus
- Server at `http://localhost:3800` (NOT 3777 — port changed)
- Started fresh this session, no persisted data from before
- Start with: `cd /c/Users/snahrup/CascadeProjects/nexus/server && nohup npx tsx src/index.ts > /dev/null 2>&1 &`

### Key Architecture Facts
- **1,666 entities** across 5 sources (ETQ:29, MES:445, M3 ERP:596, M3 Cloud:187, Optiva:409)
- **Medallion pattern**: Landing Zone → Bronze → Silver → Gold
- **SQL Analytics Endpoint has 2-3 min sync lag** — always force-refresh before trusting queries
- **InvokePipeline + SP auth is DEAD** — use REST API orchestration (`scripts/run_load_all.py`)
- **SP token struct.pack**: `f'<I{len(token_bytes)}s'` with scope `analysis.windows.net/powerbi/api/.default`
- **Dashboard**: React + Vite + Tailwind, dark glassmorphism theme, 44 pages
- **API server**: `dashboard/app/api/server.py` (Python/Flask), SQLite primary + Fabric SQL fallback
- **Engine**: `engine/` (Python), orchestrator → pipeline_runner → notebook_trigger → logging_db

### File Ownership Zones (STRICT)
- `engine/` → Engine Lead only
- `dashboard/app/api/server.py` + `dashboard/app/api/*.py` → API Lead only
- `dashboard/app/src/` → Frontend Lead only
- `engine/tests/` + `dashboard/app/tests/` → QA Engineer only
- `config/` + `deploy_from_scratch.py` → DevOps Lead only

### Test Commands
```bash
# Engine tests (143+ tests)
cd /c/Users/snahrup/CascadeProjects/FMD_FRAMEWORK && python -m pytest engine/tests/ -v

# TypeScript build
cd dashboard/app && npm run build

# Playwright E2E (needs dev server running)
cd dashboard/app && npx playwright test
```

### Fabric SQL Connection
- **Server**: `7xuydsw5a3hutnnj5z2ed72tam-nt3ef5gg5llunagjzcyclsdpxy.database.fabric.microsoft.com,1433`
- **Database**: `SQL_INTEGRATION_FRAMEWORK-501d6b17-fcee-47f3-bbb3-54e05f2a3fc0`
- **Auth**: SP token (AAD-only, no SQL auth)

### Source DBs (VPN required)
- MES: `m3-db1` / `mes`
- ETQ: `M3-DB3` / `ETQStagingPRD`
- M3 ERP: `sqllogshipprd` / `m3fdbprd`
- M3 Cloud: `sql2016live` / `DI_PRD_Staging`

### Workspace IDs (source of truth: `config/item_config.yaml`)
- DATA (Dev): `0596d0e7-e036-451d-a967-41a284302e8d`
- CODE (Dev): `c0366b24-e6f8-4994-b4df-b765ecb5bbf8`
- CONFIG: `e1f70591-6780-4d93-84bc-ba4572513e5c`

---

## KEY FILES TO READ FIRST

| File | Why |
|------|-----|
| `specs/pending/*.md` | The 4 specs — your marching orders |
| `specs/README.md` | Spec format, execution workflow |
| `knowledge/CURRENT-STATE.md` | Where the project is right now |
| `knowledge/DEFINITION-OF-DONE.md` | Binary checklist for ship readiness |
| `knowledge/BURNED-BRIDGES.md` | Things that DON'T work — don't retry them |
| `knowledge/TEST-PLAN.md` | 489 assertions across all pages |
| `AGENT_TEAM_SPRINT.md` | Previous sprint spec (completed) — good reference for format |
| `agents/*/AGENTS.md` | Agent personas with file ownership and tools |

---

## UNTRACKED FILES (safe to ignore)
- `.coverage` — pytest coverage data
- `scripts/load_optimization_results_optiva.json` — load optimization output
- `scripts/load_optimization_results_refresh.json` — load optimization output

---

## DO NOT
- Modify `deploy_from_scratch.py` without explicit approval
- Use `a3a180ff` workspace ID (OLD, dead)
- Trust SQL Analytics Endpoint without force-refresh
- Use InvokePipeline for SP-triggered loads
- Skip reading `knowledge/BURNED-BRIDGES.md`
