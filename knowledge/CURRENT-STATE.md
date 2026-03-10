# CURRENT-STATE.md -- FMD Framework Master Index

> **Purpose**: Single entry point for any AI agent joining this project. Read this first, then follow the critical reading order.
> **Last Updated**: 2026-03-09

---

## 1. System Overview

The **FMD Framework** (Fabric Metadata-Driven Framework) is an enterprise data pipeline system built on Microsoft Fabric for IP Corp, a multi-subsidiary resin and composites manufacturer. It copies data from 4 on-premises SQL Server databases (MES, ETQ, M3 ERP, M3 Cloud) into Fabric Lakehouses using a medallion architecture (Landing Zone, Bronze, Silver, Gold). All pipeline behavior is driven by metadata stored in a Fabric SQL Database -- entity definitions, connection configs, load types, and execution tracking. The system is deployed via a 17-phase Python script, monitored through a 38-page React dashboard, and orchestrated by a Python engine with Fabric notebook triggers.

---

## 2. Architecture Summary

### Medallion Layers

| Layer | Storage | Purpose | Entity Count |
|-------|---------|---------|--------------|
| **Landing Zone** | Lakehouse (parquet) | Raw copy from source SQL | 1,666 registered |
| **Bronze** | Lakehouse (Delta) | SCD Type 1/2 merge, audit columns added | 1,666 entities |
| **Silver** | Lakehouse (Delta) | Cleansing rules applied from metadata DB | 1,666 entities |
| **Gold** | Lakehouse (Delta) | Business domain views, dim/fact tables | Not yet built (future phases) |

**Source breakdown**: ETQ (29) + M3 ERP (596) + M3 Cloud (187) + MES (445) + Optiva (409) = **1,666 entities x 3 layers = 4,998 registrations**. All 5 sources registered, all entities active.

### Key Components

| Component | Tech | Size | Location |
|-----------|------|------|----------|
| **Engine** | Python | 14 files, 5,827 LOC | `engine/` |
| **API Server** | Flask (Python) | ~10,900 LOC, 50+ endpoints | `dashboard/app/api/server.py` |
| **Dashboard** | React + TypeScript + Tailwind | 38 pages, 133 component files | `dashboard/app/src/` |
| **Fabric Notebooks** | PySpark | 11 core notebooks | `src/*.Notebook/` |
| **Fabric Pipelines** | JSON definitions | 19 pipelines | `src/*.DataPipeline/` |
| **Deploy Script** | Python | 17 phases, idempotent | `deploy_from_scratch.py` |
| **Utility Scripts** | Python | 90+ scripts | `scripts/` |
| **Config** | YAML + JSON | 11 config files | `config/` |

### Data Flow

```
On-Prem SQL (4 sources) --[Copy]--> Landing Zone (parquet)
    --[SCD Merge]--> Bronze (Delta)
        --[Cleansing]--> Silver (Delta)
            --[Business Logic]--> Gold (Delta)  [future]
```

Pipeline orchestration: `NB_FMD_ORCHESTRATOR` (Fabric scheduler) or `scripts/run_load_all.py` (ad-hoc REST API triggers). InvokePipeline is dead -- see BURNED-BRIDGES.md.

---

## 3. Knowledge Base Index

### Core Documents

| File | Description | Updated | Answers |
|------|-------------|---------|---------|
| `knowledge/BURNED-BRIDGES.md` | Dead ends, failed approaches, hard-won lessons. 10 major topics. | 2026-03-09 | "Has this been tried before?" "Why can't we use X?" "What are the development rules?" |
| `knowledge/engine/audit-backend.md` | Engine modules (14 files), API server (50+ endpoints), data models | 2026-03-09 | "What does engine/X.py do?" "What endpoints exist?" "How does auth work?" |
| `knowledge/frontend/audit-pages.md` | All 38 dashboard pages with routes, API deps, status | 2026-03-09 | "What page is at /X?" "What API does page Y call?" "Which pages are incomplete?" |
| `knowledge/frontend/audit-components.md` | 133 frontend component files across 10 directories | 2026-03-09 | "What components exist for X?" "What props does Y take?" "Where is the layout shell?" |
| `knowledge/fabric/audit-artifacts.md` | 11 notebooks, 19 pipelines, variable libraries, business domain items | 2026-03-09 | "What does notebook X do?" "What parameters does pipeline Y need?" "How do pipelines chain?" |
| `knowledge/devops/audit-deployment.md` | 17-phase deploy script, 11 config files, 90+ utility scripts | 2026-03-09 | "How do I deploy?" "What does Phase X do?" "Where is script Y?" |

### IP Corp Domain Knowledge

| File | Description | Updated | Answers |
|------|-------------|---------|---------|
| `knowledge/ipcorp/README.md` | IP Corp knowledge base index (start here for company context) | 2026-03 | "What files cover IP Corp?" "Where do I start for company context?" |
| `knowledge/ipcorp/company-structure.md` | 4 subsidiaries (Interplastic, HK Research, NAC, Molding Products), ERP mapping, security boundaries | 2026-01 | "What companies are there?" "Which ERP does X use?" "What is company 100 vs 200?" |
| `knowledge/ipcorp/source-databases.md` | 4 SQL Server sources: MES (586 tables), ETQ (29), M3 ERP (3,973), M3 Cloud (188) | 2026-03 | "How do I connect to MES?" "What tables does M3 have?" "What auth is needed?" |
| `knowledge/ipcorp/fabric-environment.md` | Workspace IDs, lakehouse IDs, SQL DB endpoint, SP credentials, connection IDs, pipeline IDs | 2026-03 | "What is the workspace ID for X?" "What is the SQL endpoint?" "What is the SP object ID?" |
| `knowledge/ipcorp/known-issues.md` | SQL endpoint sync lag, auth quirks, pipeline root causes, deployment pitfalls, M3/MES data quirks | 2026-03 | "Why is my query returning stale data?" "Why does auth fail?" "What are the known gotchas?" |
| `knowledge/ipcorp/fabric-migration-strategy.md` | Target architecture, medallion definitions, domain roadmap, workspace strategy, governance | 2026-01 | "What is the long-term architecture?" "What domain comes after Product?" "How is access controlled?" |

### Additional IP Corp Files

| File | Description | Updated |
|------|-------------|---------|
| `knowledge/ipcorp/contacts/stakeholders.md` | Key people, roles, communication preferences | 2026-01 |
| `knowledge/ipcorp/data-flows/architecture.md` | Data flows, cross-system identifiers, ETL patterns | 2026-01 |
| `knowledge/ipcorp/glossary/business-terms.md` | Terms, definitions, acronyms, system relationships | 2026-01 |
| `knowledge/ipcorp/gotchas/known-issues.md` | Critical pitfalls, workarounds, important warnings | 2026-01 |
| `knowledge/ipcorp/systems/landscape.md` | Complete inventory of 28+ systems with integration details | 2026-01 |
| `knowledge/ipcorp/source-databases/m3/internal-discoveries.md` | IP Corp-specific M3 ERP findings and patterns | 2025-12 |
| `knowledge/ipcorp/source-databases/mes/internal-discoveries.md` | IP Corp-specific MES findings and patterns | 2025-12 |

### Architecture Documents

| File | Description | Updated |
|------|-------------|---------|
| `knowledge/architecture/ownership-map.md` | Agent-to-file ownership boundaries, reporting hierarchy, boundary rules | 2026-03-09 |
| `knowledge/architecture/decisions.md` | Architecture Decision Records (ADR-001 through ADR-004) | 2026-03-09 |
| `knowledge/architecture/tech-debt.md` | 10 prioritized tech debt items with severity, owner, status | 2026-03-09 |

---

## 4. Current Status

### What Works

| Component | Status | Notes |
|-----------|--------|-------|
| `deploy_from_scratch.py` | STABLE | 17-phase full deployment, idempotent, dry-run tested |
| Direct pipeline triggers (REST API) | STABLE | SP auth works for direct triggers |
| `NB_FMD_ORCHESTRATOR` | STABLE | Fabric-native scheduler, triggers LZ/Bronze/Silver sequentially |
| `run_load_all.py` | STABLE | Ad-hoc REST orchestrator from laptop/server |
| Entity registration cascade | STABLE | `register_entity()` auto-creates Bronze + Silver |
| Load optimization (Phase 14) | STABLE | Auto-discovers PKs, watermarks, row counts |
| Entity Digest Engine | STABLE | `sp_BuildEntityDigest`, 1,735 entities seeded |
| Dashboard on vsc-fabric | STABLE | IIS reverse proxy, Windows Auth, port 8787 |
| Engine preflight checks | STABLE | Queue validation + entity activation pre-run |
| SSE live dashboard updates | STABLE | Real-time run status to frontend |
| Optiva copy pipeline | STABLE | 100/100 runs succeeded |

### What Is Broken or Incomplete

| Issue | Severity | Owner | Details |
|-------|----------|-------|---------|
| Zero test coverage on API | HIGH | QA Engineer | server.py (10,900 LOC) has no automated tests |
| server.py is 11K LOC monolith | HIGH | API Lead | Hard to reason about, merge conflicts likely |
| Many dashboard pages incomplete | MEDIUM | Frontend Lead | Stale mock data, stub pages visible to users |
| No CI/CD pipeline | MEDIUM | DevOps Lead | Manual deployment only |
| engine/tests/ only has test_models.py | HIGH | QA Engineer | Engine changes are untested |
| SQL Analytics Endpoint sync lag | HIGH | Fabric Engineer | Root cause of weeks of phantom bugs -- being replaced by local SQLite for dashboard reads |
| InvokePipeline dead (by design) | N/A | -- | Fabric limitation; REST API workaround in place |

### What Is In Progress

| Work Item | Jira | Status | Notes |
|-----------|------|--------|-------|
| Bronze/Silver loading runs | MT-37 | In Progress | Jobs active since 3/6, verifying 100% completion |
| Silver layer formal validation | MT-18 | Pending | Waiting on Bronze/Silver run completion |
| Entity Digest frontend migration | MT-88 | In Progress | Backend done, remaining dashboard pages need migration |
| Historical data backfill | MT-57 | In Progress | Due pushed to 3/14, waiting on baseline |
| **Local SQLite control plane** | -- | **In Progress** | Replaces Fabric SQL Analytics Endpoint for dashboard reads. `control_plane_db.py` (16 tables), dual-write in `logging_db.py`, background sync every 5 min. See BURNED-BRIDGES.md Section 10. |
| 8-agent team deployment | -- | Accepted | ADR-001: Paperclip-coordinated agents with worktree isolation |

---

## 5. Agent Quick Reference

### Ownership Map

| Agent | Role | Model | Owns |
|-------|------|-------|------|
| **CTO** | Architecture decisions, conflict resolution | claude-opus-4-6 | Any file (review/fix only, delegates features) |
| **Engine Lead** | Backend Architect | claude-sonnet-4-6 | `engine/*.py`, `engine/tests/` |
| **API Lead** | Server Architect | claude-sonnet-4-6 | `dashboard/app/api/server.py`, `dashboard/app/api/*.json` |
| **Frontend Lead** | UI Architect | claude-sonnet-4-6 | `dashboard/app/src/**` (pages, components, hooks, types, styles) |
| **Fabric Engineer** | Platform Specialist | claude-sonnet-4-6 | `src/*.Notebook/`, `src/*.DataPipeline/`, `src/*.VariableLibrary/`, `src/antigravity/`, `src/business_domain/` |
| **DevOps Lead** | Deployment Architect | claude-sonnet-4-6 | `deploy_from_scratch.py`, `scripts/`, `config/`, `.github/workflows/` |
| **QA Lead** | Quality Gatekeeper | claude-sonnet-4-6 | `knowledge/qa/`, test reports, convergence tracking |
| **QA Engineer** | Test Executor | claude-sonnet-4-6 | `testsprite_tests/`, `dashboard/app/tests/`, test execution |

### Boundary Rules

1. No agent modifies files outside their ownership zone without CTO approval.
2. QA agents are read-only on production code -- they file bugs, not fixes.
3. CTO only writes code for critical blockers -- delegates all feature work.
4. Cross-boundary changes require a coordination issue via Paperclip.

### Coordination

- **Paperclip**: Agent task management and coordination system
- **Nexus**: Multi-session bridge at `http://localhost:3777` -- shared memory, SSE events, cross-session messaging
- **Knowledge Base**: `knowledge/` directory with per-domain subdirectories (this file is the index)

---

## 6. Critical Reading Order

For a new agent joining the project, read these documents in this order:

1. **This file** (`knowledge/CURRENT-STATE.md`) -- you are here
2. **`knowledge/DEFINITION-OF-DONE.md`** -- MASTER finish-line checklist. Binary pass/fail criteria for every layer, page, and gate. Read before claiming ANY work is done.
3. **`knowledge/BURNED-BRIDGES.md`** -- MANDATORY before doing ANY work. Dead ends, root causes, development rules. Violating these wastes time.
4. **`knowledge/architecture/ownership-map.md`** -- know your boundaries before touching any file
5. **`knowledge/architecture/decisions.md`** -- understand the 4 accepted ADRs
6. **`knowledge/architecture/tech-debt.md`** -- know the 10 open debt items and who owns them
7. **Your domain audit file**:
   - Engine Lead: `knowledge/engine/audit-backend.md`
   - API Lead: `knowledge/engine/audit-backend.md` (API server section)
   - Frontend Lead: `knowledge/frontend/audit-pages.md` + `knowledge/frontend/audit-components.md`
   - Fabric Engineer: `knowledge/fabric/audit-artifacts.md`
   - DevOps Lead: `knowledge/devops/audit-deployment.md`
   - QA Lead/Engineer: All audit files (you test everything)
7. **`knowledge/ipcorp/fabric-environment.md`** -- workspace IDs, lakehouse IDs, SQL endpoint, SP credentials
8. **`knowledge/ipcorp/source-databases.md`** -- the 4 source databases you are ingesting from
9. **`knowledge/ipcorp/known-issues.md`** -- environment-specific gotchas (especially SQL Analytics Endpoint sync lag)
10. **`knowledge/ipcorp/company-structure.md`** -- understand the 4-company structure and its data implications

---

## 7. Key File Paths (Quick Reference)

| What | Path |
|------|------|
| Deploy script | `deploy_from_scratch.py` |
| Engine modules | `engine/*.py` |
| API server | `dashboard/app/api/server.py` |
| API config | `dashboard/app/api/config.json` |
| Dashboard pages | `dashboard/app/src/pages/` |
| Dashboard components | `dashboard/app/src/components/` |
| Fabric notebooks | `src/*.Notebook/` |
| Fabric pipelines | `src/*.DataPipeline/` |
| Config (source of truth) | `config/item_config.yaml` |
| Source systems | `config/source_systems.yaml` |
| Entity registration | `config/entity_registration.json` |
| Resolved IDs | `config/id_registry.json` |
| Deploy state | `.deploy_state.json` |
| Agent definitions | `agents/*/AGENTS.md` |
| Knowledge base | `knowledge/` (this directory) |
