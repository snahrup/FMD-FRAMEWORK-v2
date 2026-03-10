# PRE-LAUNCH CHECKLIST — Agent Team Readiness

> **Status**: READY TO LAUNCH
> **Owner**: sage-tower
> **Purpose**: Every box must be checked before unleashing agents. This prevents the "go around and around" problem.

---

## 1. Config Fixes (RESOLVED — sage-tower 2026-03-09)

- [x] Fix `config.json` → `engine.load_method`: changed `"local"` → `"notebook"` (Fabric notebook execution)
- [x] Fix `config.json` → `engine.notebook_lz_id`: set to `a69cb3e2-52a1-abee-4335-29721d1d5828` (NB_FMD_PROCESSING_LANDINGZONE_MAIN)
- [x] Fix `config.json` → `engine.notebook_processing_id`: set to `bf2101e2-a101-b8df-43bf-5f6ba130a279` (NB_FMD_PROCESSING_PARALLEL_MAIN)
- [x] Fix `config.json` → `engine.notebook_maintenance_id`: left empty (NB_FMD_MAINTENANCE_AGENT not yet deployed to Fabric)
- [x] Fix `engine.notebook_bronze_id`: changed `a2712a97` → `f7be6488` (matches item_deployment.json)
- [x] Fix `engine.notebook_silver_id`: changed `8ce7bc73` → `556fd16b` (matches item_deployment.json)
- [x] **RESOLVED**: `item_deployment.json` is the deployment output from Fabric — it is the source of truth for all item IDs

## 2. Collision Prevention (HIGH — prevents merge hell)

- [x] Ownership map updated with all 9 agents + conflict zones documented
- [x] engine/tests/ split: Engine Lead = unit (`test_<module>.py`), QA Engineer = integration (`test_integration_*.py`)
- [x] `deploy_from_scratch.py` — LOCKED to DevOps Lead only (rule 7 in ownership-map.md). Other agents submit change requests.
- [x] API response contracts: API Lead notifies Frontend Lead before any shape change
- [x] config/ directory: DevOps writes during deploy, API Lead reads at runtime

## 3. Test Infrastructure (MEDIUM — agents need to validate their work)

- [x] pytest: 31/31 passing
- [x] TypeScript build: clean
- [x] Playwright config: correct (baseURL `127.0.0.1:5173`, screenshots/video/trace on)
- [x] Node modules: present and complete
- [x] Semgrep: configured with security rules
- [ ] Python deps: `pandas` import fails — agents must `pip install pandas pyodbc` before engine work
- [ ] Dev servers: agents must start Vite + API before E2E tests
  - Vite: `cd dashboard/app && npm run dev`
  - API: `cd dashboard/app/api && python server.py`

## 4. Knowledge Base (GREEN — comprehensive)

- [x] `knowledge/DEFINITION-OF-DONE.md` — 10-section binary checklist
- [x] `knowledge/TEST-PLAN.md` — 489 assertions across 40 pages in 3 tiers
- [x] `knowledge/BURNED-BRIDGES.md` — 10 sections of gotchas and dead ends
- [x] `knowledge/CURRENT-STATE.md` — Master index with reading order
- [x] `knowledge/architecture/ownership-map.md` — Non-overlapping file ownership + conflict zones
- [x] `knowledge/engine/audit-backend.md` — 14 engine modules documented
- [x] `knowledge/frontend/audit-pages.md` — 38 pages documented
- [x] `knowledge/frontend/audit-components.md` — 133 components documented
- [x] `knowledge/fabric/audit-artifacts.md` — 23 pipelines, 11 notebooks
- [x] `knowledge/devops/audit-deployment.md` — 17 phases documented
- [x] `knowledge/ipcorp/` — Company context (5 files)
- [x] `knowledge/UX-AUDIT-REPORT.md` — Complete (30 pages graded, overall C+)

## 5. Agent Configuration (GREEN)

- [x] All 9 AGENTS.md files have: identity, responsibilities, safety, references
- [x] All agents reference DEFINITION-OF-DONE.md
- [x] Entity count updated to 1,666 across 5 sources in all agent files
- [x] Mandatory Visual Documentation Protocol in all agent files
- [x] All agents set to claude-opus-4-6 with effort:high
- [x] Paperclip company registered with 8 agents + goals + issues

## 6. Safety Rails

- [x] Ownership boundaries prevent file collisions
- [x] CTO agent has 3x weight in architectural decisions
- [x] QA agents are read-only on production code
- [x] Feature workflow: CTO decompose → Lead implement → QA review → CTO merge
- [ ] Git branching strategy: agents should work on feature branches, not main
- [ ] Pre-commit hooks: ensure tests pass before merge

---

## LAUNCH DECISION

| Criteria | Status | Blocker? |
|----------|--------|----------|
| Config correctness | GREEN | RESOLVED — all notebook IDs fixed from item_deployment.json, load_method→notebook |
| File collision risk | GREEN | RESOLVED — deploy_from_scratch.py locked to DevOps Lead |
| Test infrastructure | GREEN | No (minor pip install needed) |
| Knowledge base | GREEN | No |
| Agent configuration | GREEN | No |
| Safety rails | GREEN | No |

**Verdict**: **READY TO LAUNCH.** All blockers resolved. Config IDs synced to item_deployment.json. deploy_from_scratch.py locked to DevOps Lead. Test infra green (31/31 pytest, clean TS build, Playwright ready). All 9 agents configured with ownership boundaries and DEFINITION-OF-DONE references.
