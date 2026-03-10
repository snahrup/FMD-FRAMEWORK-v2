# Task Backlog — FMD Framework

> **Prioritized using scoring rubric. See bottom of file for rubric definition.**
> Groups: FIX NOW → FIX BEFORE NEXT FEATURE → FIX WHILE TOUCHING ADJACENT CODE → DEFER

---

## Scoring Rubric

Each item scored 1-5 on these factors (higher = more urgent):

| Factor | 1 (Low) | 5 (High) |
|--------|---------|----------|
| **Production Risk** | No prod impact | Could cause data loss or outage |
| **Blast Radius** | Single file/entity | Cross-cutting, many components |
| **Business Impact** | Internal tooling | Blocks deliverables or stakeholder demos |
| **Architectural Leverage** | Isolated fix | Unlocks multiple downstream improvements |
| **Dependency Blocking** | Nothing depends on this | Multiple tasks blocked by this |
| **Test Gap** | Well-tested area | No tests, high uncertainty |
| **Maintainability** | Clean, documented | Fragile, undocumented, error-prone |
| **Security/Reliability** | Low exposure | Credentials, auth, data integrity |
| **Dev Velocity** | Minor friction | Major workflow blocker |

**Score = sum of all factors.** Max 45.

---

## FIX NOW (Score 30+)

### T-001: Complete Bronze/Silver Loading Validation
- **Score**: 38 (ProdRisk:5 Blast:4 Business:5 ArchLev:4 DepBlock:5 TestGap:3 Maint:4 Security:3 DevVel:5)
- **Description**: Bronze/Silver jobs running since 3/6 01:25 UTC. Need to validate completion, check error rates, identify remaining failures.
- **Files**: `engine/api.py`, `dashboard/app/api/server.py`, SQL execution tables
- **Status**: IN PROGRESS (jobs running)
- **Jira**: MT-37, MT-17

### T-002: Add Automated Tests to CI
- **Score**: 34 (ProdRisk:3 Blast:5 Business:3 ArchLev:4 DepBlock:3 TestGap:5 Maint:5 Security:3 DevVel:3)
- **Description**: No CI pipeline. No automated test runner. `engine/tests/test_models.py` exists but isn't wired to anything. Dashboard has no test suite.
- **Files**: `.github/workflows/`, `engine/tests/`, `dashboard/app/`
- **Status**: PARTIALLY DONE (CodeQL + Semgrep workflows added in this setup)
- **Next step**: Add Python test workflow, add dashboard build check workflow

### T-003: Config Bundle Sync Automation
- **Score**: 31 (ProdRisk:4 Blast:3 Business:3 ArchLev:3 DepBlock:3 TestGap:4 Maint:4 Security:4 DevVel:3)
- **Description**: Config bundle on vsc-fabric can drift from local. Currently manual sync via provisioning script Phase 12. Had stale workspace IDs (`a3a180ff` instead of `0596d0e7`) on 3/3.
- **Files**: `scripts/config-bundle/`, `scripts/provision-launcher.ps1`
- **Status**: OPEN
- **Risk**: Stale config on server = wrong GUIDs = silent failures

---

## FIX BEFORE NEXT FEATURE (Score 20-29)

### T-004: M3 ERP Source Registration
- **Score**: 28 (ProdRisk:2 Blast:3 Business:4 ArchLev:3 DepBlock:4 TestGap:3 Maint:3 Security:2 DevVel:4)
- **Description**: 3,973 tables from sqllogshipprd/m3fdbprd not yet registered. Blocked on gateway connection (MT-31).
- **Files**: `config/entity_registration.json`, `deploy_from_scratch.py` Phase 13-14
- **Status**: BLOCKED (gateway connection)
- **Jira**: MT-31

### T-005: Entity Digest Frontend Migration
- **Score**: 26 (ProdRisk:2 Blast:3 Business:3 ArchLev:3 DepBlock:2 TestGap:3 Maint:4 Security:2 DevVel:4)
- **Description**: Entity Digest Phase 2 backend is deployed (sp_UpsertEntityStatus, EntityStatusSummary table). Frontend pages partially migrated. Several pages still use direct SQL queries instead of digest endpoint.
- **Files**: `dashboard/app/src/pages/*.tsx`, `dashboard/app/src/hooks/useEntityDigest.ts`
- **Status**: IN PROGRESS
- **Jira**: MT-88

### T-006: Notebook Upload Automation
- **Score**: 24 (ProdRisk:3 Blast:2 Business:2 ArchLev:2 DepBlock:2 TestGap:4 Maint:4 Security:2 DevVel:3)
- **Description**: Local notebook changes require manual `scripts/upload_notebooks_to_fabric.py` run. Easy to forget, causing divergence between repo and Fabric runtime.
- **Files**: `scripts/upload_notebooks_to_fabric.py`, potentially a git hook
- **Status**: OPEN
- **Idea**: Pre-push git hook or CI step that checks for notebook changes and auto-uploads

### T-007: Dashboard Build/Lint CI Step
- **Score**: 22 (ProdRisk:2 Blast:2 Business:2 ArchLev:2 DepBlock:2 TestGap:4 Maint:4 Security:2 DevVel:2)
- **Description**: Dashboard has ESLint config but no CI step to run it. TypeScript compilation not checked in CI.
- **Files**: `.github/workflows/`, `dashboard/app/package.json`
- **Status**: OPEN

---

## FIX WHILE TOUCHING ADJACENT CODE (Score 10-19)

### T-008: Engine Tests Expansion
- **Score**: 18 (ProdRisk:2 Blast:2 Business:1 ArchLev:2 DepBlock:1 TestGap:4 Maint:3 Security:1 DevVel:2)
- **Description**: `engine/tests/test_models.py` is the only test file. Orchestrator, loader, config, and API have no unit tests.
- **Files**: `engine/tests/`
- **Status**: OPEN

### T-009: Script Cleanup (70+ ad-hoc scripts)
- **Score**: 15 (ProdRisk:1 Blast:1 Business:1 ArchLev:2 DepBlock:1 TestGap:2 Maint:3 Security:2 DevVel:2)
- **Description**: `scripts/` has 70+ Python files, many one-time diagnostic/fix scripts. Some contain hardcoded values, some are obsolete.
- **Files**: `scripts/*.py`
- **Status**: OPEN (low priority, clean up opportunistically)

### T-010: Dashboard Placeholder Pages
- **Score**: 14 (ProdRisk:1 Blast:1 Business:2 ArchLev:1 DepBlock:1 TestGap:2 Maint:3 Security:1 DevVel:2)
- **Description**: Some dashboard pages (DataCatalog, DataClassification, DataLineage, DataProfiler, ImpactAnalysis, etc.) are new/partially wired.
- **Files**: `dashboard/app/src/pages/*.tsx`
- **Status**: OPEN

---

## DEFER FOR NOW (Score <10)

### T-011: PROD Deployment Planning
- **Score**: 8 (ProdRisk:1 Blast:1 Business:1 ArchLev:1 DepBlock:1 TestGap:1 Security:1 DevVel:1)
- **Description**: Define strategy for DEV → PROD promotion. Not needed until Silver is stable.
- **Status**: DEFERRED (see OD-002 in DECISIONS.md)

### T-012: Gold Layer / MLV Implementation
- **Score**: 7 (ProdRisk:1 Blast:1 Business:1 ArchLev:1 DepBlock:1 TestGap:1 Security:1)
- **Description**: Business domain Gold layer using MLVs. Early design only.
- **Status**: DEFERRED (see OD-003 in DECISIONS.md)

### T-013: SonarQube Integration
- **Score**: 6 (ProdRisk:1 Blast:1 Business:1 ArchLev:1 DepBlock:1 TestGap:1)
- **Description**: Phase 2 quality gate. Semgrep + CodeQL cover immediate needs.
- **Status**: DEFERRED

---

*Last updated: 2026-03-06*
