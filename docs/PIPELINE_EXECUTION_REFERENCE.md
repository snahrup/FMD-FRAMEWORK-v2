# FMD Framework — Pipeline Execution Reference

> **Purpose**: Single source of truth for how data loading works in FMD.
> **Last updated**: 2026-03-17
> **Status**: Audit complete — inconsistencies documented below.

---

## TL;DR: How Loading Actually Works Today

```
scripts/run_load_all.py (or Dashboard Engine)
  ↓  SP token → Fabric REST API
  ↓  POST /workspaces/{WS}/items/{NB}/jobs/instances?jobType=RunNotebook
  ↓
NB_FMD_PROCESSING_LANDINGZONE_MAIN  →  On-prem SQL → LZ parquet files
  ↓
NB_FMD_LOAD_LANDING_BRONZE          →  LZ parquet → Bronze delta tables
  ↓
NB_FMD_LOAD_BRONZE_SILVER           →  Bronze delta → Silver SCD2 tables
```

**Authentication**: Service Principal via `FABRIC_CLIENT_SECRET` in `dashboard/app/api/.env`
**Workspace**: INTEGRATION CODE (D) = `c0366b24-e6f8-4994-b4df-b765ecb5bbf8`
**InvokePipeline is DEAD** — Fabric ignores SP auth on InvokePipeline activities. All triggering goes through direct REST API calls to notebooks.

---

## Complete Inventory of Pipeline Execution Touchpoints

### ✅ CURRENT & WORKING

| # | Component | Path | What It Does | How It Triggers |
|---|-----------|------|-------------|-----------------|
| 1 | **run_load_all.py** | `scripts/run_load_all.py` | Full LZ→Bronze→Silver chain | REST API → Fabric notebooks |
| 2 | **Engine Orchestrator** | `engine/orchestrator.py` | Core v3 engine — extract→upload→notebook chain | Called from Dashboard API |
| 3 | **Notebook Trigger** | `engine/notebook_trigger.py` | Wraps Fabric REST API for notebook execution | Used by orchestrator |
| 4 | **Engine API** | `engine/api.py` + `dashboard/app/api/routes/engine.py` | REST endpoints for engine control | Dashboard → engine |
| 5 | **Pipeline Runner page** | `dashboard/app/src/pages/PipelineRunner.tsx` | Scoped load UI (select sources→layer→run) | POST /api/runner/* |
| 6 | **Pipeline Monitor page** | `dashboard/app/src/pages/PipelineMonitor.tsx` | Monitor + ad-hoc trigger | POST /api/pipeline/trigger |
| 7 | **Engine Control page** | `dashboard/app/src/pages/EngineControl.tsx` | Local Python engine control | POST /api/engine/start |
| 8 | **Load Progress page** | `dashboard/app/src/pages/LoadProgress.tsx` | Real-time LZ copy progress | GET /api/load-progress |
| 9 | **Pipeline API routes** | `dashboard/app/api/routes/pipeline.py` | Runner + trigger + SSE stream endpoints | Fabric REST API |

### ⚠️ LEGACY / STALE / NEEDS UPDATE

| # | Component | Path | Issue |
|---|-----------|------|-------|
| 10 | **run_silver_pipeline.py** | `scripts/run_silver_pipeline.py` | Uses OLD workspace IDs (`146fe38c`). Triggers pipeline (not notebook). |
| 11 | **pipeline_runner.py** | `engine/pipeline_runner.py` | Uses InvokePipeline pattern — **KNOWN BROKEN** with SP auth |
| 12 | **NB_FMD_ORCHESTRATOR** | `src/NB_FMD_ORCHESTRATOR.Notebook/` | In-Fabric notebook orchestrator — never deployed, not used |
| 13 | **LOAD_ALL pipeline** | `PL_FMD_LOAD_ALL` (Fabric) | Uses InvokePipeline internally — **BROKEN** with SP auth |

### 📊 MONITORING / READ-ONLY

| # | Component | Path | What It Shows |
|---|-----------|------|---------------|
| 14 | **Execution Matrix** | `dashboard/app/src/pages/ExecutionMatrix.tsx` | Entity-level status across all layers |
| 15 | **Execution Log** | `dashboard/app/src/pages/ExecutionLog.tsx` | Historical run records |
| 16 | **Control Plane** | `dashboard/app/src/pages/ControlPlane.tsx` | System health overview |
| 17 | **Live Monitor** | `dashboard/app/src/pages/LiveMonitor.tsx` | Real-time activity feed |

### 🔧 SETUP / ONBOARDING (Creates infrastructure, doesn't load data)

| # | Component | Path | What It Does |
|---|-----------|------|-------------|
| 18 | **deploy_from_scratch.py** | `deploy_from_scratch.py` | 17-phase greenfield deployment |
| 19 | **ProvisionAll** | `dashboard/app/src/pages/setup/ProvisionAll.tsx` | UI for automated deployment |
| 20 | **SetupWizard** | `dashboard/app/src/pages/setup/SetupWizard.tsx` | Manual step-by-step setup |
| 21 | **SourceManager** | `dashboard/app/src/pages/SourceManager.tsx` | Register sources + entities |
| 22 | **SourceOnboardingWizard** | `dashboard/app/src/components/sources/SourceOnboardingWizard.tsx` | Multi-step source import |
| 23 | **run_load_optimization.py** | `scripts/run_load_optimization.py` | PK/watermark discovery (pre-load) |

---

## Identified Inconsistencies & Confusion Points

### 🔴 CRITICAL: Multiple Contradictory Execution Paths

**Problem**: Users see 4+ different ways to "run a load" with no clear guidance on which to use.

| Execution Path | Where User Finds It | Status |
|----------------|---------------------|--------|
| PipelineRunner page → Scoped run | Dashboard sidebar | ✅ Works (uses /api/runner/* → direct Fabric API) |
| EngineControl page → Engine start | Dashboard sidebar | ✅ Works (uses /api/engine/start → Python orchestrator) |
| PipelineMonitor → Ad-hoc trigger | Dashboard sidebar | ✅ Works (uses /api/pipeline/trigger → direct Fabric API) |
| `scripts/run_load_all.py` | Terminal only | ✅ Works (direct REST API to notebooks) |
| LOAD_ALL pipeline (Fabric UI) | Fabric portal | ❌ BROKEN with SP auth |
| `scripts/run_silver_pipeline.py` | Terminal only | ⚠️ STALE (old workspace IDs) |

**Recommendation**: Pick ONE canonical path for the dashboard and deprecate/hide the others, or clearly label each with when to use it.

---

### 🔴 CRITICAL: PipelineRunner vs EngineControl — Which Is It?

**PipelineRunner** (`PipelineRunner.tsx`):
- Scoped execution (select sources, deactivate others, trigger Fabric pipeline)
- Uses `/api/runner/prepare` → `/api/runner/trigger` → `/api/runner/restore`
- Triggers **Fabric pipelines by name** (PL_FMD_LOAD_LANDINGZONE, etc.)
- State persisted in `.runner_state.json`

**EngineControl** (`EngineControl.tsx`):
- Local Python engine execution
- Uses `/api/engine/start` with `RunConfig { layers, mode, entity_ids }`
- Runs **orchestrator.py** which extracts locally then triggers notebooks
- Has plan/dry-run mode

**The confusion**: Both exist in the sidebar. Both claim to run loads. They use completely different mechanisms. A user doesn't know which one to click.

**Recommendation**: Merge into a single "Run Load" experience, or clearly differentiate (e.g., "Quick Load" vs "Full Pipeline").

---

### 🟡 HIGH: Hardcoded Pipeline Names in PipelineRunner

`PipelineRunner.tsx` hardcodes these pipeline names:
```
PL_FMD_LOAD_LANDINGZONE
PL_FMD_LOAD_LANDING_BRONZE
PL_FMD_LOAD_BRONZE_SILVER
PL_FMD_LOAD_ALL
```

But `PL_FMD_LOAD_ALL` uses InvokePipeline internally, which is **broken with SP auth**. If a user selects "Full: LZ→Bronze→Silver" in PipelineRunner, it triggers the broken LOAD_ALL pipeline.

**Recommendation**: Either remove "Full" option from PipelineRunner, or change it to trigger notebooks sequentially (like `run_load_all.py` does).

---

### 🟡 HIGH: SourceOnboardingWizard References Different Pipeline Patterns

`SourceOnboardingWizard.tsx` maps data source types to copy pipelines:
```
ASQL_01     → PL_FMD_LDZ_COPY_FROM_ASQL_01
ONELAKE     → PL_FMD_LDZ_COPY_FROM_ONELAKE_TABLES_01
ADLS_01     → PL_FMD_LDZ_COPY_FROM_ADLS_01
FTP_01      → PL_FMD_LDZ_COPY_FROM_FTP_01
...
```

These are **per-entity copy pipelines**, not the main load chain. This is a different pattern than PipelineRunner/EngineControl. The relationship between "copy pipeline" and "load pipeline" is never explained to the user.

**Recommendation**: Document the two-level architecture: (1) Copy pipelines move data into LZ, (2) Load pipelines process LZ→Bronze→Silver.

---

### 🟡 HIGH: run_silver_pipeline.py Uses Dead Workspace IDs

`scripts/run_silver_pipeline.py` still references:
- Workspace: `146fe38c-f6c3-4e9d-a18c-5c01cad5941e` (OLD CODE workspace)
- Pipeline: `90c0535c-c5dc-43a3-b51e-c44ef1808a60`

These are **stale**. Anyone running this script will get auth failures.

**Recommendation**: Delete or update to current workspace IDs.

---

### 🟡 HIGH: pipeline_runner.py Still Exists in Engine

`engine/pipeline_runner.py` implements `FabricPipelineRunner` which triggers pipelines via InvokePipeline — the pattern that's **known broken** with SP auth.

The orchestrator has a `load_method` config that can be set to `"pipeline"` which would use this broken path.

**Recommendation**: Either delete `pipeline_runner.py` or add a clear deprecation warning. Ensure `load_method` defaults to `"local"` and document that `"pipeline"` is broken.

---

### 🟡 MEDIUM: No Clear "How to Run a Load" Documentation

There is no single document that says: "To run a load, do X." Instead, users must piece together information from:
- `START_HERE.md` (audit findings)
- `BUG_FIXES_IMPLEMENTED.md` (bug fixes)
- `MEMORY.md` (session notes)
- Various `docs/` files

**Recommendation**: This document (you're reading it) should serve as that reference.

---

### 🟡 MEDIUM: Dashboard Sidebar Has Too Many Pipeline-Adjacent Pages

Users see all of these in the sidebar:
- Pipeline Runner
- Pipeline Monitor
- Pipeline Matrix
- Engine Control
- Execution Matrix
- Execution Log
- Load Progress
- Live Monitor
- Control Plane

That's **9 pages** related to "running and watching pipelines." For a user who just wants to load data, this is overwhelming.

**Recommendation**: Consolidate into 2-3 pages max (Run, Monitor, History).

---

### 🟢 LOW: NB_FMD_ORCHESTRATOR Never Deployed

`src/NB_FMD_ORCHESTRATOR.Notebook/` exists in the repo but was never deployed to Fabric. It was intended as an in-Fabric scheduling alternative but `run_load_all.py` superseded it.

**Recommendation**: Either deploy it or remove it from the repo to reduce confusion.

---

## Canonical Execution Methods (What To Use)

### For Development/Testing (from terminal):
```bash
# Full load: LZ → Bronze → Silver
python scripts/run_load_all.py

# Skip LZ (already loaded), just process Bronze + Silver
python scripts/run_load_all.py --skip-lz

# Single layer only
python scripts/run_load_all.py --only lz
python scripts/run_load_all.py --only bronze
python scripts/run_load_all.py --only silver
```

### For Dashboard Users:
1. **Scoped loads** (specific sources/entities): Use **Pipeline Runner**
2. **Engine-based loads** (with plan/dry-run): Use **Engine Control**
3. **Monitor active runs**: Use **Load Progress** (LZ) or **Pipeline Monitor** (all)
4. **Check entity status**: Use **Execution Matrix**

### DO NOT USE:
- ❌ `PL_FMD_LOAD_ALL` pipeline (InvokePipeline broken with SP)
- ❌ `scripts/run_silver_pipeline.py` (stale workspace IDs)
- ❌ `engine/pipeline_runner.py` load_method="pipeline" (InvokePipeline broken)
- ❌ Triggering pipelines from Fabric portal directly (SP auth issues)

---

## Key IDs Reference

### Workspace IDs (Current)
| Workspace | ID |
|-----------|-----|
| INTEGRATION DATA (D) | `0596d0e7-e036-451d-a967-41a284302e8d` |
| INTEGRATION CODE (D) | `c0366b24-e6f8-4994-b4df-b765ecb5bbf8` |
| INTEGRATION CODE (P) | `f825b6f5-1c3d-4b5d-be8a-12e3c2523d38` |
| INTEGRATION CONFIG | `e1f70591-6780-4d93-84bc-ba4572513e5c` |

### Notebook IDs (Dev)
| Notebook | ID |
|----------|-----|
| NB_FMD_PROCESSING_LANDINGZONE_MAIN | `d6fbceef-adeb-492f-9959-4fd7d07b1348` |
| NB_FMD_LOAD_LANDING_BRONZE | `a2712a97-ebde-4036-b704-4892b8c4f7af` |
| NB_FMD_LOAD_BRONZE_SILVER | `8ce7bc73-35ac-4844-8937-969b7d99ec3e` |

### Pipeline IDs (Dev)
| Pipeline | ID |
|----------|-----|
| PL_FMD_LOAD_LANDINGZONE | `3d0b3b2b-...` |
| PL_FMD_LOAD_LANDING_BRONZE | `8b7008ac-...` |
| PL_FMD_LOAD_BRONZE_SILVER | `90c0535c-...` |
| PL_FMD_LOAD_ALL | `e45418a4-148f-49d2-a30f-071a1c477ba9` (⚠️ BROKEN) |

### Auth
| Key | Value |
|-----|-------|
| Tenant | `ca81e9fd-06dd-49cf-b5a9-ee7441ff5303` |
| Client ID | `ac937c5d-4bdd-438f-be8b-84a850021d2d` |
| SP Object ID | `6baf0291-1868-4867-82d2-eb8d077438ba` |
| Secret location | `dashboard/app/api/.env` → `FABRIC_CLIENT_SECRET` |

---

## API Endpoints Reference

### Runner (Scoped Execution)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/runner/sources` | List sources with entity counts |
| GET | `/api/runner/entities?dataSourceId=X` | List entities for a source |
| GET | `/api/runner/state` | Check active scope |
| POST | `/api/runner/prepare` | Deactivate out-of-scope entities |
| POST | `/api/runner/trigger` | Fire pipeline |
| POST | `/api/runner/restore` | Reactivate all entities |

### Engine (Local Orchestrator)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/engine/status` | Engine state + last run |
| GET | `/api/engine/plan` | Dry-run plan |
| GET | `/api/engine/health` | Preflight checks |
| POST | `/api/engine/start` | Start engine run |
| POST | `/api/engine/stop` | Graceful stop |
| POST | `/api/engine/retry` | Retry failed entities |
| POST | `/api/engine/abort-run` | Abort a run |
| POST | `/api/engine/entity/{id}/reset` | Reset watermark |

### Pipeline (Direct Fabric)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/pipelines` | List all pipelines |
| POST | `/api/pipeline/trigger` | Trigger pipeline by name |
| GET | `/api/pipeline/stream` | SSE run progress |
| GET | `/api/pipeline/run-snapshot` | Latest run state |
| GET | `/api/pipeline/failure-trace` | RCA for failures |
| GET | `/api/fabric-jobs` | Fabric job instances |
| GET | `/api/pipeline-executions` | Execution history |

---

## Action Items

- [ ] Decide: PipelineRunner vs EngineControl — merge or clearly differentiate?
- [ ] Fix PipelineRunner "Full" option (LOAD_ALL is broken)
- [ ] Delete or update `scripts/run_silver_pipeline.py`
- [ ] Add deprecation warning to `engine/pipeline_runner.py`
- [ ] Consider consolidating 9 pipeline pages into 2-3
- [ ] Decide fate of `NB_FMD_ORCHESTRATOR` notebook
- [ ] Add this doc to dashboard as a help/reference page
