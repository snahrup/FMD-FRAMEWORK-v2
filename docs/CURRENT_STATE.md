# Current State — FMD Framework

> **Updated: 2026-03-06**
> This file captures the current state of the repo. Read it before starting work.

---

## Overall Status: ACTIVE DEVELOPMENT — Bronze/Silver Loading Phase

The framework is deployed and operational on DEV. Landing Zone loads are >90% complete across all sources. Bronze and Silver loading are in progress.

---

## What Works

### Infrastructure (Stable)
- **17-phase deployment script** (`deploy_from_scratch.py`) — fully operational, dry-run tested
- **Fabric workspace layout** — 5 workspaces created and configured (DATA D/P, CODE D/P, CONFIG)
- **3 DEV lakehouses** — LH_DATA_LANDINGZONE, LH_BRONZE_LAYER, LH_SILVER_LAYER
- **SQL metadata database** — Schema deployed, stored procs operational, SP auth working
- **Service Principal auth** — Token generation, scope, struct packing all verified

### Data Loading (Operational)
- **Landing Zone**: 1,564 of 1,735 entities (90.1%) loaded at least once
- **Bronze**: Jobs running since 3/6 01:25 UTC. 1,637 of 1,666 Bronze entities had IsActive=0 bug — FIXED
- **Silver**: Jobs running since 3/6 01:25 UTC
- **Optiva**: 100% success rate (100/100 runs, ~18s each)
- **Pipeline timeouts**: Fixed (Copy 4hr, ExecutePipeline 6hr, ForEach 12hr, batchCount 15)

### Dashboard (Operational)
- **26+ pages** built in React + TypeScript + Vite
- **REST API** (`dashboard/app/api/server.py`) — Entity digest, control plane, execution logs
- **Remote deployment** — Running on `vsc-fabric` via IIS reverse proxy with Windows Auth
- **Engine v3 integration** — Start/stop/status from dashboard UI

### Engine v3 (Operational)
- **REST API** (`engine/api.py`) — Pipeline mode creates SQL run records, polls Fabric jobs
- **Orchestrator** (`engine/orchestrator.py`) — Adaptive throttle, batch processing
- **Preflight checks** (`engine/preflight.py`) — Validates entities before loading

---

## What's Fragile

### Known Active Issues
1. **Bronze IsActive bug** — 1,637/1,666 Bronze entities were IsActive=0 due to sp_Upsert stored proc defaulting to inactive. Fix applied via `scripts/fix_bronze_silver_queue.py` (one-time) and permanently in `deploy_from_scratch.py`.
2. **Empty pipeline queue tables** — `execution.PipelineLandingzoneEntity` and `execution.PipelineBronzeLayerEntity` had 0 rows at load time. Fixed.
3. **InvokePipeline + SP auth** — Fabric by-design limitation. PL_FMD_LOAD_ALL's InvokePipeline activities don't work with SP auth. Workaround: `scripts/run_load_all.py` REST orchestrator.
4. **Pipeline mode tracking gap** — api.py was firing notebooks but not writing SQL run records. Fixed.

### Structural Fragilities
- **Config bundle on vsc-fabric** — Had stale workspace IDs (`a3a180ff` old). Fixed 3/3 but this is a manual sync point.
- **Notebook upload step** — Local changes don't take effect until `scripts/upload_notebooks_to_fabric.py` is run. Easy to forget.
- **714 entities with empty SourceName** — Was 55% of all LZ failures. Fixed in deploy_from_scratch.py Phase 13.
- **No automated CI/CD** — All deployment is manual Python scripts. No GitHub Actions for build/test.
- **No Python test runner** — `engine/tests/test_models.py` exists but no CI integration or test harness.

---

## Known Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Config bundle drift (local vs server) | HIGH | Deploy script Phase 12 copies config bundle. Must re-run after config changes. |
| Notebook/pipeline divergence (local vs Fabric) | HIGH | Upload scripts exist but require manual execution. |
| Fabric SQL 429 throttling | MEDIUM | batchCount=15 on ForEach activities. Adaptive throttle in engine. |
| No automated tests in CI | MEDIUM | CodeQL + Semgrep workflows added. Unit test runner needed. |
| PROD lakehouses not provisioned | LOW (not yet needed) | GUIDs show TBD in ARCHITECTURE.md |
| M3 ERP source not registered | MEDIUM | 3,973 tables. Gateway connection MT-31 dependency. |

---

## Active Assumptions

1. All loads target DEV environment only. PROD deployment has not started.
2. Service Principal auth works for all Fabric REST API calls (confirmed).
3. InvokePipeline with SP auth will NEVER work (Fabric by-design). REST orchestrator is permanent workaround.
4. 659 entities registered across MES (445), ETQ (29), M3C (185). M3 ERP pending.
5. Optiva source (409 entities) added and fully functional.
6. Dashboard is deployed on vsc-fabric and accessible via VPN at `http://vsc-fabric/`.

---

## In-Progress Zones (as of 2026-03-06)

| Zone | Status | Details |
|------|--------|---------|
| Bronze loading | RUNNING | Job `d33ddeb6`, started 01:25 UTC 3/6 |
| Silver loading | RUNNING | Job `a6ce0318`, started 01:25 UTC 3/6 |
| Entity Digest Phase 2 | IN PROGRESS | sp_UpsertEntityStatus deployed, frontend migration partial |
| Dashboard pages | 26+ built | Some pages have placeholder data or incomplete wiring |
| Engine v3 | OPERATIONAL | Pipeline mode + local mode both working |

---

*Next update: After Bronze/Silver jobs complete.*
