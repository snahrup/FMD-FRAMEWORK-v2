# DEFINITION OF DONE — Team Acceptance Criteria

> **Authority**: Steve Nahrup (Project Owner)
> **Created**: 2026-03-09 by sage-tower, from Steve's answers to deep-ridge's finish-line questions
> **Status**: ACTIVE — Every agent MUST reference this before marking work complete

---

## How to Use This Document

Each section below is a **binary checklist**. A box is either checked or unchecked — no partial credit.
Agents: before you claim "done", walk through every checkbox in your ownership area.
If ANY box is unchecked, you are NOT done.

---

## 1. Landing Zone (LZ)

- [ ] All **1,666 entities** load with **ZERO failures**
- [ ] `execution.EntityStatus` shows `Succeeded` for all 1,666 LZ entities
- [ ] No entities stuck in `InProgress` or `Failed` state
- [ ] `execution.PipelineLandingzoneEntity` queue is fully populated (1,666 rows)
- [ ] Landing Zone lakehouses contain parquet files for all 1,666 entities
- [ ] Load times are reasonable (no individual entity taking >30 min unless justified by table size)

**Source breakdown** (must match exactly):
| Source | Entity Count |
|--------|-------------|
| ETQ | 29 |
| M3 ERP | 596 |
| M3 Cloud | 187 |
| MES | 445 |
| OPTIVA | 409 |
| **TOTAL** | **1,666** |

---

## 2. Bronze Layer

- [ ] All **1,666 Bronze entities** are `IsActive = 1` in metadata
- [ ] `execution.PipelineBronzeLayerEntity` queue is fully populated (1,666 rows)
- [ ] Bronze notebook (`NB_FMD_LOAD_LANDING_BRONZE`) completes without errors
- [ ] `execution.EntityStatus` shows `Succeeded` for all 1,666 Bronze entities
- [ ] The **activation bug is permanently fixed** — `sp_UpsertPipelineLandingzoneEntity` / `sp_UpsertPipelineBronzeLayerEntity` default `IsActive = 1`, not 0
- [ ] Bronze lakehouses contain delta tables for all 1,666 entities
- [ ] No orphan parquet files left from previous failed runs

---

## 3. Silver Layer

- [ ] All **1,666 Silver entities** load via **SCD Type 2** merge
- [ ] `execution.EntityStatus` shows `Succeeded` for all 1,666 Silver entities
- [ ] Silver notebook (`NB_FMD_LOAD_BRONZE_SILVER`) completes without errors
- [ ] Silver lakehouses contain delta tables with proper SCD2 columns (`_ValidFrom`, `_ValidTo`, `_IsCurrent`)
- [ ] Incremental loads work correctly (watermark-based entities only process new/changed rows)

---

## 4. Gold Layer

- [ ] Gold layer is **IN SCOPE** but **NOT blocking go-live**
- [ ] At minimum: `NB_CREATE_DIMDATE` deployed and produces a valid DimDate table
- [ ] At minimum: `NB_CREATE_SHORTCUTS` deployed and creates cross-workspace shortcuts
- [ ] MLV example notebooks (`NB_MLV_DEMO_GOLD`, `NB_MLV_EXAMPLE`) deployed but execution is stretch goal
- [ ] Gold layer failures do NOT block marking LZ/Bronze/Silver as complete

---

## 5. Dashboard — 8 Critical Pages

These 8 pages MUST be fully functional, visually correct, and backed by real data:

| # | Page | File | Key Requirements |
|---|------|------|-----------------|
| 1 | **Execution Matrix** | `ExecutionMatrix.tsx` | All 1,666 entities visible, correct status colors, drill-down works |
| 2 | **Engine Control** | `EngineControl.tsx` | Live run monitoring, execution plan visible, duration KPI, start/stop works |
| 3 | **Control Plane** | `ControlPlane.tsx` | Source systems, pipeline health, summary counts — reads from local SQLite |
| 4 | **Live Monitor** | `LiveMonitor.tsx` | Real-time pipeline status, auto-refresh, no stale data |
| 5 | **Record Counts** | `RecordCounts.tsx` | Entity digest data, source breakdown, row counts match reality |
| 6 | **Source Manager** | `SourceManager.tsx` | All 5 sources listed, entity counts match, gateway status accurate |
| 7 | **Environment Setup** | `EnvironmentSetup.tsx` | Workspace/lakehouse/connection inventory correct |
| 8 | **Execution Log** | `ExecutionLog.tsx` | Historical runs visible, filterable, timestamps correct |

**Per-page acceptance**:
- [ ] Page loads without console errors
- [ ] Data displayed matches actual Fabric/SQLite state
- [ ] No loading spinners stuck indefinitely
- [ ] Responsive at 1280x720 viewport minimum
- [ ] No TypeScript errors in build

---

## 6. Hard Gates (Non-Negotiable)

These MUST pass before the project can be called "done":

### 6a. Python Tests
- [ ] `pytest` passes with **zero failures** across all test files
- [ ] Engine tests cover core orchestration paths (loader, models, config, preflight)
- [ ] No skipped tests hiding real failures

### 6b. Playwright E2E
- [ ] Playwright E2E tests exist for all **8 critical pages** listed above
- [ ] All tests pass in CI-equivalent run (`npx playwright test` from `dashboard/app/`)
- [ ] Each test validates: page loads, key data renders, no console errors
- [ ] MRI (Machine Regression Intelligence) scan completes with no P0 regressions

### 6c. Static Analysis
- [ ] **CodeQL** scan clean (zero high/critical findings)
- [ ] **Semgrep** scan clean (zero high/critical findings)
- [ ] TypeScript build (`npm run build`) completes with zero errors

---

## 7. Stretch Goals (Valuable but Not Blocking)

These improve quality but are NOT required for "done":

- [ ] Engine module test coverage reaches **60%**
- [ ] API smoke tests cover the top 20 most-used endpoints
- [ ] `control_plane_db.py` has dedicated unit tests (17 tables, 16 write functions, 13 read functions)
- [ ] Visual regression baselines established for all 8 critical pages
- [ ] Performance: Control Plane page loads in <2 seconds from local SQLite
- [ ] Performance: Execution Matrix renders 1,666 rows without visible jank

---

## 8. Local SQLite Control Plane (PRIMARY — Patrick-approved 2026-03-09)

> **Decision**: Local SQLite is the PRIMARY data source for all dashboard reads.
> Fabric SQL Analytics Endpoint is unreliable (2-30 min sync lag) and will NOT be
> used as source-of-truth. Write-through to Fabric SQL is optional/best-effort.
> Approved by Patrick and Steve on 2026-03-09.

- [ ] `dashboard/app/api/control_plane_db.py` exists and is functional (17 tables, WAL mode)
- [ ] `server.py` ALL `/api/*` endpoints read from local SQLite — NOT Fabric SQL
- [ ] Fabric SQL writes are best-effort (fire-and-forget) — failures do NOT block operations
- [ ] Engine writes to local SQLite on every pipeline execution (landing, bronze, silver)
- [ ] `deploy_from_scratch.py` Phase 13b seeds local SQLite during entity registration
- [ ] Dashboard pages that read control plane data work exclusively with SQLite backend
- [ ] No dashboard page depends on Fabric SQL Analytics Endpoint for reads
- [ ] Entity status, run history, pipeline queue state — all served from SQLite

---

## 9. Source Onboarding — Zero-Friction UX (CRITICAL)

> **Steve's words**: "When they add a source to the system, they expect that every single table
> they added is ready to import and run the pipeline to load across the entire architecture."

The current onboarding is 7 manual steps requiring deep framework knowledge. That is NOT acceptable.
The target is **ONE action**: user adds a source → everything else is automatic.

### What "Add Source" Must Do (single operation, no user intervention):

- [ ] **1. Connect**: Validate SQL Server connection (server, database, auth)
- [ ] **2. Discover**: Query `INFORMATION_SCHEMA.TABLES` to enumerate all tables in the source
- [ ] **3. Analyze**: For EACH table, auto-detect load method:
  - Discover primary keys (`sp_pkeys` or `sys.indexes`)
  - Discover watermark candidates (datetime columns, rowversion, identity)
  - Classify as **incremental** (has valid watermark) or **full load** (no watermark)
  - Exclude rowversion/timestamp binary types (known bad watermark — see BURNED-BRIDGES.md)
- [ ] **4. Register ALL layers**: For each table, register:
  - Landing Zone entity (`sp_UpsertPipelineLandingzoneEntity`, IsActive=1)
  - Bronze entity (`sp_UpsertPipelineBronzeLayerEntity`, IsActive=1)
  - Silver entity (SCD Type 2 configuration)
  - Set watermark column, load type, primary key on each
- [ ] **5. Seed local SQLite**: Write all new entities to `control_plane_db.py` (dual-write)
- [ ] **6. Queue for loading**: Entities immediately appear in pipeline queues, ready to run
- [ ] **7. Return summary**: Show user: "Added X tables from [source]. Y incremental, Z full load. Ready to run."

### UX Requirements:

- [ ] Single "Add Source" button on SourceManager page opens wizard
- [ ] Wizard: Connection details → Test Connection → Preview Tables → Confirm → Done
- [ ] Progress indicator during analysis (can take 30-60s for large sources)
- [ ] User can deselect specific tables before confirming (but default is ALL)
- [ ] After adding, user can immediately hit "Run" to load all layers
- [ ] No separate "register bronze", "register silver", "run optimization" steps
- [ ] Error handling: if analysis fails for some tables, register what worked, report failures

### "Run Everything" Button:

- [ ] Single "Load All" button on EngineControl (or SourceManager post-add)
- [ ] Runs LZ → Bronze → Silver for ALL entities across ALL sources
- [ ] No layer checkboxes required — default is everything
- [ ] Shows live progress during execution
- [ ] Works from both dashboard AND Fabric (NB_FMD_ORCHESTRATOR)

### Config Fixes Required:

- [x] `config.json` → `engine.load_method` = `"notebook"` (Fabric notebooks trigger all loads) — FIXED 2026-03-09
- [x] `config.json` → notebook IDs match `item_deployment.json` — FIXED 2026-03-09
- [x] `notebook_lz_id`, `notebook_processing_id` populated — FIXED 2026-03-09
- [ ] `notebook_maintenance_id` populated once NB_FMD_MAINTENANCE_AGENT is deployed to Fabric

---

## 10. Agent Instructions

1. **Identify your scope** — Check your `agents/<role>/AGENTS.md` for file ownership
2. **Work systematically** — One checkbox at a time, verify before moving to next
3. **Check boxes as you go** — Update this document (or your local tracking) as criteria are met
4. **Escalate blockers** — If a checkbox requires another agent's work, message them via Nexus
5. **Visual documentation** — Use `/visual-explainer` commands before AND after every code change
6. **Don't over-build** — If it's not in this document, don't build it
7. **Test everything** — No "it should work" — run it and prove it

---

## Sign-Off

When ALL non-stretch checkboxes above are checked:

```
PROJECT STATUS: DONE
Signed off by: ____________
Date: ____________
Remaining stretch items: ____________
```
