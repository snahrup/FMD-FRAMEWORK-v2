# Architecture — FMD Framework (Operating Reference)

> **The detailed technical reference (GUIDs, paths, schema) lives in `/ARCHITECTURE.md` at the repo root.**
> This file is the higher-level operating architecture for Claude Code sessions.

---

## System Overview

FMD (Fabric Metadata-Driven) Framework is an enterprise data pipeline framework for Microsoft Fabric. It implements a medallion architecture (Landing Zone → Bronze → Silver → Gold) driven entirely by SQL metadata configuration — no per-entity code.

### Key Principle
**ONE generic pipeline handles ALL entities.** The pipeline reads metadata from SQL to know what to copy, where to write, and how to transform. Adding a new entity is a metadata registration, not a code change.

---

## Major Components

### 1. SQL Metadata Database (Fabric SQL)
- **Role**: Configuration store AND execution tracker
- **Schema**: `integration.*` (config tables) + `execution.*` (runtime state)
- **Auth**: Service Principal token, NOT username/password
- **Boundary**: This is the system of record. All other components read from or write to this DB.
- **DO NOT**: Modify schema without updating deploy_from_scratch.py Phase 7.

### 2. Fabric Notebooks (src/*.Notebook/)
- **Role**: Per-entity data processing workers
- **Key notebooks**:
  - `NB_FMD_LOAD_LANDINGZONE_MAIN` — LZ orchestrator (queries SQL for worklist, triggers copy pipeline)
  - `NB_FMD_LOAD_LANDING_BRONZE` — Reads parquet from LZ, writes Delta to Bronze
  - `NB_FMD_LOAD_BRONZE_SILVER` — Reads Delta from Bronze, applies transforms, writes Delta to Silver
  - `NB_FMD_DQ_CLEANSING` — Data quality rules
  - `NB_FMD_ORCHESTRATOR` — Full pipeline orchestration from Fabric
- **Boundary**: Notebooks are runtime copies in Fabric. Local repo is source of truth. Changes require upload.

### 3. Fabric Data Pipelines (src/*.DataPipeline/)
- **Role**: Infrastructure-level orchestration (copy activities, parallel execution)
- **Key pipelines**: LOAD_ALL → LOAD_LANDINGZONE / LOAD_BRONZE / LOAD_SILVER
- **Constraint**: InvokePipeline does NOT work with SP auth. Use REST orchestrator instead.
- **Boundary**: Pipeline JSON defines activities and parameters. GUIDs are workspace-specific and require remapping.

### 4. Engine v3 (engine/)
- **Role**: Local/remote REST API for triggering and monitoring loads
- **Components**: api.py (REST), orchestrator.py (batch engine), loader.py (file I/O), preflight.py (validation)
- **Boundary**: Engine is an ORCHESTRATOR. It does not process data itself — it triggers Fabric notebooks/pipelines.

### 5. Dashboard (dashboard/app/)
- **Role**: Monitoring, control plane, and operational UI
- **Stack**: React 19 + TypeScript + Vite + Tailwind + Radix UI
- **API**: Python Flask-style server at `dashboard/app/api/server.py`
- **Boundary**: Dashboard is read-mostly. It queries SQL metadata DB and engine API. It should not write to lakehouses directly.

### 6. Deployment System (deploy_from_scratch.py + scripts/)
- **Role**: Automated 17-phase deployment of the entire framework
- **Boundary**: This is the ONLY supported deployment path. Do not deploy manually via Fabric portal.

---

## Data Flow

```
Source SQL Servers (MES, ETQ, M3, M3C, OPTIVA)
    │ (VPN + Windows Auth)
    ▼
PL_FMD_LDZ_COPY_SQL  ──→  LH_DATA_LANDINGZONE (Files/{Namespace}/{Table}.parquet)
    │
    ▼
NB_FMD_LOAD_LANDING_BRONZE  ──→  LH_BRONZE_LAYER (Tables/{Namespace}/{Table})
    │
    ▼
NB_FMD_LOAD_BRONZE_SILVER  ──→  LH_SILVER_LAYER (Tables/{Namespace}/{Table})
    │
    ▼
Gold Layer (SQL Warehouse)  ──→  {Namespace}.{Table}
```

**Path rule**: `{Namespace}/{Table}` at every layer. No schema prefix. No date partitioning. See root ARCHITECTURE.md §1.

---

## Integration Points

| Integration | How | Constraint |
|-------------|-----|------------|
| Source SQL → Fabric | Copy pipeline via Fabric gateway connections | Requires VPN. Windows auth. Short hostnames only. |
| Python → Fabric REST API | Service Principal bearer token | Scope: `analysis.windows.net/powerbi/api/.default` |
| Python → SQL Metadata DB | pyodbc + SP token via attrs_before | Token struct packing: `<I{len}s` format |
| Dashboard → SQL Metadata DB | Python API server queries DB | Same SP auth path |
| Dashboard → Engine | REST API calls to engine endpoints | Engine runs as co-process with dashboard |
| Local → Fabric notebooks | Upload script → Fabric REST API | Manual step, easy to forget |

---

## Areas That Should NOT Be Casually Reshaped

1. **The Universal Path Rule** — `{Namespace}/{Table}` is load-bearing. Changing it would break every notebook, every pipeline, and all existing data. See root ARCHITECTURE.md §1.
2. **SQL metadata schema** — The `integration.*` and `execution.*` schemas are referenced by 6+ stored procs, all notebooks, all pipelines, the dashboard, and the engine. Schema changes require coordinated updates.
3. **deploy_from_scratch.py phase structure** — The 17 phases have dependency ordering. Don't reorder or skip phases.
4. **Config/item_config.yaml** — Source of truth for all GUIDs. Everything reads from this.
5. **SP auth flow** — Token acquisition, scope, struct packing. These are exact and verified. Don't "simplify."
6. **Pipeline JSON structure** — Fabric-specific. Activity names, parameters, and type properties must match Fabric's expected format exactly.

---

## Constraints

- **No Fabric SDK for Python** — All Fabric interaction is REST API via requests library.
- **InvokePipeline broken for SP auth** — By design. Permanent workaround via REST orchestrator.
- **Notebook runtime is Fabric Spark** — PySpark, not standard Python. Different execution model.
- **SQL DB is Fabric SQL, not Azure SQL** — Different auth, different connection string format, different throttling behavior.
- **Pipeline GUIDs are workspace-specific** — Re-deploying pipelines changes GUIDs. Must re-run `fix_pipeline_guids.py`.

---

*For exact GUIDs, paths, schema details, and stored proc signatures, see `/ARCHITECTURE.md` (root).*

*Last updated: 2026-03-06*
