# Architecture Decisions — FMD Framework

> **This file is the durable source of truth for architecture decisions.**
> No decision documented here may be silently overridden.
> If a change conflicts with a decision below, surface the conflict before proceeding.

---

## Decision Log

### D-001: Universal Path Pattern
- **Date**: 2026-02-15 (foundational)
- **Decision**: All data paths follow `{Namespace}/{Table}` at every medallion layer.
- **Rationale**: One pattern everywhere eliminates path-related bugs, simplifies debugging, and makes the system predictable. Namespace = DataSource.Namespace (e.g., MES, ETQ, M3, OPTIVA).
- **Implications**: LZ files at `Files/{Namespace}/{Table}.parquet`, Bronze/Silver Delta tables at `Tables/{Namespace}/{Table}`, Gold at `{Namespace}.{Table}` schema.table.
- **DO NOT CHANGE**: This is load-bearing. Every notebook, pipeline, and stored proc depends on it.

### D-002: Metadata-Driven Architecture
- **Date**: 2026-02-15 (foundational)
- **Decision**: All pipeline behavior is driven by SQL metadata. Zero per-entity code.
- **Rationale**: Adding a new source entity should be a metadata INSERT, not a code change. This enables scaling to 1,000+ entities without code proliferation.
- **Implications**: Notebooks query SQL views for their worklist. Pipelines use ForEach + parameterized activities. Entity registration cascades from LZ → Bronze → Silver automatically.
- **DO NOT CHANGE**: The entire framework assumes this pattern. Per-entity code would undermine the architecture.

### D-003: deploy_from_scratch.py as Sole Deployment Path
- **Date**: 2026-02-20
- **Decision**: All deployment goes through the 17-phase Python deploy script. NB_SETUP_FMD notebook is NOT used for deployment.
- **Rationale**: NB_SETUP_FMD was never executed. The Python script provides repeatability, dry-run support, phase selection, and error handling that a notebook cannot.
- **Implications**: Schema changes go into the deploy script. Notebook upload is Phase 8. Entity registration is Phase 13. Adding a new phase requires updating the phase dispatcher.
- **DO NOT CHANGE**: Do not introduce alternative deployment paths.

### D-004: REST Orchestrator Instead of InvokePipeline
- **Date**: 2026-03-01
- **Decision**: Use `scripts/run_load_all.py` (REST API orchestrator) instead of PL_FMD_LOAD_ALL's InvokePipeline chain for triggering loads.
- **Rationale**: Fabric's InvokePipeline activity ignores Service Principal connections by design. It uses "Pipeline Default Identity" (user token), which fails when triggered via SP API.
- **Implications**: PL_FMD_LOAD_ALL still exists but is not the primary execution path. The REST orchestrator triggers each sub-pipeline directly via SP token.
- **DO NOT CHANGE**: InvokePipeline + SP auth is a Fabric platform limitation with no fix expected.

### D-005: Service Principal Authentication
- **Date**: 2026-02-18
- **Decision**: All Fabric API and SQL DB interactions use Service Principal token auth with scope `https://analysis.windows.net/powerbi/api/.default`.
- **Rationale**: User tokens expire, require interactive login, and can't be automated. SP provides headless, automatable auth.
- **Implications**: Token struct packing uses `struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)`. This exact format is required for pyodbc attrs_before.
- **DO NOT CHANGE**: Token scope and struct packing are verified against Fabric. Changing either breaks all SQL DB access.

### D-006: Entity Digest Engine (Two-Phase)
- **Date**: 2026-03-01
- **Decision**: Entity status aggregation uses a two-phase approach: write-time aggregation via `execution.EntityStatusSummary` table, with fallback to query-time aggregation via `sp_BuildEntityDigest`.
- **Rationale**: Query-time aggregation across 6 tables (1,735 entities) was fast enough (0.46s) but write-time aggregation via sp_UpsertEntityStatus provides better dashboard responsiveness.
- **Implications**: Notebooks (LZ/Bronze/Silver) call sp_UpsertEntityStatus after each load. Dashboard reads from EntityStatusSummary with 6-table fallback.
- **Open**: Frontend migration to digest endpoint is partial. Several pages still use direct SQL queries.

### D-007: Dashboard on Remote Server (vsc-fabric)
- **Date**: 2026-03-03
- **Decision**: Dashboard is deployed to vsc-fabric Windows server, served via IIS reverse proxy (port 80 → localhost 8787), with Windows Auth.
- **Rationale**: Dashboard needs proximity to Fabric and source SQL servers (both require VPN). Running on vsc-fabric provides this without requiring the developer laptop to be always-on.
- **Implications**: Config bundle must be synced to server. NSSM manages Node.js and Python processes. IIS handles auth.
- **DO NOT CHANGE**: The remote deployment pattern is established. Changes to config must be re-deployed via provisioning script.

### D-008: ForEach Batch Configuration
- **Date**: 2026-03-01
- **Decision**: All ForEach activities in pipelines use `batchCount: 15` (parallel threads) with extended timeouts (Copy 4hr, ExecutePipeline 6hr, ForEach 12hr).
- **Rationale**: Default batchCount (variable) + default 1hr timeouts caused cascading failures. 15 parallel threads balanced throughput against Fabric SQL 429 throttling.
- **Implications**: Pipeline JSON files contain these values. Changing batchCount affects load duration and throttling pressure.
- **DO NOT CHANGE**: Without simultaneous investigation of Fabric throttling behavior.

### D-009: Config Source of Truth Hierarchy
- **Date**: 2026-02-20
- **Decision**: Config hierarchy: `config/item_config.yaml` (GUIDs) → `config/item_deployment.json` (Fabric item IDs) → `dashboard/app/api/config.json` (runtime). Root ARCHITECTURE.md documents the canonical values.
- **Rationale**: Single source of truth per concern prevents GUID divergence across environments.
- **Implications**: Changing a GUID means updating item_config.yaml first, then propagating through the deploy script.
- **DO NOT CHANGE**: Do not hardcode GUIDs in source files.

---

## Open Decisions (Unresolved)

### OD-001: M3 ERP Registration
- **Status**: BLOCKED on gateway connection (MT-31)
- **Question**: When M3 ERP (3,973 tables from sqllogshipprd/m3fdbprd) is connected, how do we handle the volume? Batch registration? Load optimization pass first?
- **Current stance**: Defer until connection is live.

### OD-002: PROD Deployment Strategy
- **Status**: Not yet needed
- **Question**: How do we promote from DEV to PROD? Full re-run of deploy_from_scratch.py targeting PROD workspaces? Or selective phase execution?
- **Current stance**: Deploy script supports workspace targeting. Will define strategy when PROD is imminent.

### OD-003: Gold Layer / MLV Strategy
- **Status**: Early design
- **Question**: Materialized Lakehouse Views (MLVs) vs. traditional ETL for Gold layer? Business domain notebooks exist but are placeholder-level.
- **Current stance**: MLVs are the planned approach per PRD. Implementation deferred until Silver is stable.

---

*Last updated: 2026-03-06*
