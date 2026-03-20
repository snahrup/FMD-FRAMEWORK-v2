# FMD Dashboard — Whole-App Census

**Date:** 2026-03-19
**Session:** bright-falcon
**Total pages:** 77 (46 root + 6 business portal + 5 gold studio + 20 setup/settings)
**Total API endpoints:** 172+ across 27 route files

---

## Priority Matrix

Ranked by: (1) user-facing impact, (2) data truthfulness risk, (3) regression probability, (4) complexity.

### 🔴 Tier 1 — Audit First (highest risk, most user-facing)

| # | Page | Route | Purpose | Health | Key Risk | Lines | Existing Audit |
|---|------|-------|---------|--------|----------|-------|----------------|
| 1 | **SourceManager** | `/sources` | Source discovery + onboarding wizard | 🟡 Fragile | Backend key mismatches (B1), import sends all entities, datasourceId→NaN | 1642 | AUDIT-SourceManager.md (bug-focused) |
| 2 | **EngineControl** | `/engine` | Engine start/stop, run monitoring, streaming logs | 🟡 Fragile | 2945 lines, 12+ API endpoints, SSE streaming, complex state machine | 2945 | AUDIT-EngineControl.md |
| 3 | **LoadCenter** | `/load-center` | One-click smart loading, physical lakehouse counts | 🟢 Stable | Newest page, hybrid SQL+filesystem — potential sync lag | 713 | None (new) |
| 4 | **BusinessOverview** | `/overview` | Landing page, KPIs, source status | 🟡 Fragile | First thing users see — any staleness is immediately visible | 583 | AUDIT-BusinessOverview.md |
| 5 | **ConfigManager** | `/config` | Config CRUD, deployment, validation | 🟡 Fragile | 1612 lines, writes to config — mistakes here break everything | 1612 | AUDIT-ConfigManager.md |

### 🟡 Tier 2 — Audit Soon (important, moderate risk)

| # | Page | Route | Purpose | Health | Key Risk | Lines | Existing Audit |
|---|------|-------|---------|--------|----------|-------|----------------|
| 6 | **PipelineMonitor** | `/pipes` | Pipeline execution monitoring + charting | 🟡 Fragile | 2129 lines, complex recharts, multiple polling intervals | 2129 | AUDIT-PipelineMonitor.md |
| 7 | **DataMicroscope** | `/microscope` | Deep entity analysis, quality visualization | 🟡 Fragile | Heavy Fabric SQL dependency, sync lag risk | 1139 | AUDIT-DataMicroscope.md |
| 8 | **FlowExplorer** | `/flow` | Dependency trees, data flow visualization | 🟡 Fragile | 1441 lines, complex viz, useEntityDigest dependency | 1441 | AUDIT-FlowExplorer.md |
| 9 | **RecordCounts** | `/counts` | Entity-level row counts per layer | 🟡 Fragile | Physical vs registered count confusion risk | 927 | AUDIT-RecordCounts.md |
| 10 | **ExecutionMatrix** | `/matrix` | Entity × run status grid | 🟢 Stable | Uses useEntityDigest + useEngineStatus — dual dependency | 710 | AUDIT-ExecutionMatrix.md |
| 11 | **DataJourney** | `/journey` | Entity lifecycle visualization | 🟡 Fragile | 1038 lines, complex animated viz | 1038 | AUDIT-DataJourney.md |
| 12 | **DataProfiler** | `/profile` | Column-level profiling | 🟡 Fragile | 1120 lines, heavy Fabric SQL queries | 1120 | AUDIT-DataProfiler.md |
| 13 | **ControlPlane** | `/control` | Aggregate control plane view | 🟢 Stable | Server-aggregated endpoint, but complex UI | 778 | AUDIT-ControlPlane.md |
| 14 | **SqlExplorer** | `/sql-explorer` | Dual-mode SQL browser (on-prem + Fabric) | 🟢 Stable | VPN dependency for on-prem, well-audited | 144 | AUDIT-SqlExplorer.md |

### 🟢 Tier 3 — Audit When Touched (stable or lower priority)

| # | Page | Route | Purpose | Health | Key Risk | Lines | Existing Audit |
|---|------|-------|---------|--------|----------|-------|----------------|
| 15 | **ErrorIntelligence** | `/errors` | Error aggregation + analysis | 🟢 Stable | Read-only, SQLite-backed | 598 | AUDIT-ErrorIntelligence.md |
| 16 | **ExecutionLog** | `/logs` | Run history log viewer | 🟢 Stable | Read-only, simple | 538 | AUDIT-ExecutionLog.md |
| 17 | **DataManager** | `/data-manager` | Entity CRUD + management | 🟡 Fragile | Write operations need careful audit | 936 | AUDIT-DataManager.md |
| 18 | **DataLineage** | `/lineage` | Entity lineage graph | 🟢 Stable | Uses useEntityDigest | 403 | AUDIT-DataLineage.md |
| 19 | **LiveMonitor** | `/live` | Real-time pipeline activity | 🟡 Fragile | Polling + SSE, state management complexity | 704 | AUDIT-LiveMonitor.md |
| 20 | **LoadProgress** | `/load-progress` | Entity load progress tracking | 🟡 Fragile | Polling, progress bar accuracy | 828 | AUDIT-LoadProgress.md |
| 21 | **PipelineRunner** | `/runner` | Manual pipeline trigger UI | 🟡 Fragile | Write operations, parameter validation | 941 | AUDIT-PipelineRunner.md |
| 22 | **PipelineMatrix** | `/pipes` | Pipeline × entity drill-down | 🟡 Fragile | 980 lines, entity drill-down complexity | 980 | AUDIT-PipelineMatrix.md |
| 23 | **NotebookConfig** | `/notebook-config` | Notebook parameter editing | 🟡 Fragile | Config writes | 895 | AUDIT-NotebookConfig.md |
| 24 | **NotebookDebug** | `/notebook-debug` | Notebook output viewer | 🟡 Fragile | Fabric API dependency | 762 | AUDIT-NotebookDebug.md |
| 25 | **ValidationChecklist** | `/validation` | Validation rule display | 🟡 Fragile | Rule execution status accuracy | 847 | AUDIT-ValidationChecklist.md |
| 26 | **SankeyFlow** | `/sankey` | Sankey chart data flow | 🟡 Fragile | Complex viz, data accuracy | 810 | AUDIT-SankeyFlow.md |
| 27 | **TransformationReplay** | `/replay` | Transformation timeline replay | 🟡 Fragile | GSAP animation, entity digest | 847 | AUDIT-TransformationReplay.md |
| 28 | **TestAudit** | `/test-audit` | Automated test results | 🟢 Stable | Read-only | 1082 | AUDIT-TestAudit.md |
| 29 | **TestSwarm** | `/test-swarm` | Parallel test runner UI | 🟡 Fragile | May be partially stubbed | 328 | AUDIT-TestSwarm.md |
| 30 | **ImpactPulse** | `/pulse` | ReactFlow impact visualization | 🟡 Fragile | Complex ReactFlow, performance | 850 | AUDIT-ImpactPulse.md |
| 31 | **ColumnEvolution** | `/columns` | Column change tracking | 🟡 Fragile | 1018 lines, animated viz | 1018 | AUDIT-ColumnEvolution.md |
| 32 | **MRI** | `/mri` | Machine Regression Intelligence | 🟢 Stable | Self-contained testing tool | 377 | None |
| 33 | **DatabaseExplorer** | `/db-explorer` | Schema browser | 🟢 Stable | Fabric SQL dependency | 566 | AUDIT-DatabaseExplorer.md |
| 34 | **DataBlender** | `/blender` | Table profiling + SQL workbench | 🟢 Stable | Fabric SQL dependency | 207 | AUDIT-DataBlender.md |
| 35 | **AdminGateway** | `/admin` | Admin hub (tabs to other pages) | 🟢 Stable | Delegator only | 417 | AUDIT-AdminGateway.md |
| 36 | **AdminGovernance** | `/admin` tab | Governance controls | 🟢 Stable | Uses useEntityDigest | 806 | AUDIT-AdminGovernance.md |
| 37 | **Settings** | `/settings` | Feature flags + deployment | 🟢 Stable | Config writes | 1121 | AUDIT-Settings.md |

### 🟠 Tier 4 — Mock/Hardcoded Data (needs truth alignment before anything else)

| # | Page | Route | Purpose | Health | Key Risk | Lines | Existing Audit |
|---|------|-------|---------|--------|----------|-------|----------------|
| 38 | **DataCatalog** | `/catalog` | Entity catalog browser | 🟠 Mock | **Hardcoded data — no backend** | 370 | AUDIT-DataCatalog.md |
| 39 | **DataClassification** | `/classification` | PII/sensitivity detection | 🟠 Mock | **Hardcoded data — classification engine stubbed** | 375 | AUDIT-DataClassification.md |
| 40 | **ImpactAnalysis** | `/impact` | Change impact matrix | 🟠 Mock | **Hardcoded data — no backend** | 434 | AUDIT-ImpactAnalysis.md |

### ⚪ Tier 5 — Stubs (placeholder pages, not yet built)

| # | Page | Route | Purpose | Health | Lines |
|---|------|-------|---------|--------|-------|
| 41 | **CleansingRuleEditor** | `/labs/cleansing` | Future: DQ rule builder | ⚪ Stub | 51 |
| 42 | **DqScorecard** | `/labs/dq-scorecard` | Future: Quality scoring dashboard | ⚪ Stub | 51 |
| 43 | **GoldMlvManager** | `/labs/gold-mlv` | Future: Gold MLV CRUD (replaced by Gold Studio) | ⚪ Stub | 51 |
| 44 | **ScdAudit** | `/labs/scd-audit` | Future: SCD2 change tracking | ⚪ Stub | 51 |

### 🔵 Tier 6 — Recently Built (Gold Studio + Business Portal)

| # | Page | Route | Purpose | Health | Lines | Notes |
|---|------|-------|---------|--------|-------|-------|
| 45 | **GoldLedger** | `/gold/ledger` | Specimen registry + file upload | 🟢 Stable | 1237 | Built with full spec, 5 QA rounds |
| 46 | **GoldClusters** | `/gold/clusters` | Duplicate detection + resolution | 🟢 Stable | 730 | Built with full spec |
| 47 | **GoldCanonical** | `/gold/canonical` | Canonical entity definitions | 🟢 Stable | 716 | Built with full spec |
| 48 | **GoldSpecs** | `/gold/specs` | Gold layer specifications | 🟢 Stable | 479 | Built with full spec |
| 49 | **GoldValidation** | `/gold/validation` | Spec validation + waivers | 🟢 Stable | 846 | Built with full spec |
| 50 | **BusinessAlerts** | `/alerts` | Business user alert config | 🟢 New | ~600 | Business portal — new |
| 51 | **BusinessCatalog** | `/catalog-portal` | Business user data catalog | 🟢 New | ~700 | Business portal — new |
| 52 | **BusinessHelp** | `/help` | Help center | 🟢 New | ~400 | Business portal — new |
| 53 | **BusinessRequests** | `/requests` | Data access requests | 🟢 New | ~600 | Business portal — new |
| 54 | **BusinessSources** | `/sources-portal` | Business-facing source view | 🟢 New | ~600 | Business portal — new |
| 55 | **DatasetDetail** | `/catalog-portal/:id` | Dataset detail page | 🟢 New | ~800 | Business portal — new |

### Setup & Settings Sub-Components (20 files — audit as a group)

| Component | Purpose | Health |
|-----------|---------|--------|
| SetupWizard + 6 step components | Fabric workspace provisioning | 🟡 Fragile (multi-step wizard) |
| DeploymentManager + 5 sub-panels | Deployment orchestration | 🟡 Fragile (complex state machine) |
| AgentCollaboration | Multi-agent coordination | 🟢 Stable |

---

## Summary Statistics

| Category | Count | % |
|----------|-------|---|
| 🟢 Stable / New | 26 | 47% |
| 🟡 Fragile | 22 | 40% |
| 🟠 Mock data | 3 | 5% |
| ⚪ Stub | 4 | 7% |

---

## Recommended Audit Order

Based on user impact × data truthfulness risk × regression probability:

### Wave 1 (do now — highest ROI)
1. **SourceManager** — Critical onboarding flow, known backend key mismatches
2. **EngineControl** — Primary operational page, 2945 lines, 12+ endpoints
3. **LoadCenter** — New page, no existing audit, central to daily operations
4. **BusinessOverview** — Landing page, first impression, KPI accuracy critical
5. **ConfigManager** — Config writes affect entire system

### Wave 2 (do next — important monitoring pages)
6. PipelineMonitor
7. DataMicroscope
8. FlowExplorer
9. RecordCounts
10. ExecutionMatrix

### Wave 3 (mock data pages — need truth alignment)
11. DataCatalog — needs real backend or explicit "not available" messaging
12. DataClassification — needs classification engine or removal
13. ImpactAnalysis — needs real dependency data or removal

### Wave 4 (remaining fragile pages — audit when touched)
14-37. Remaining pages in Tier 3, prioritized by complexity

### Wave 5 (stubs — decide keep or kill)
38-41. Review whether each stub should become a real feature, be removed, or stay in Labs

---

## API Route Health Summary

| Route File | Endpoints | Data Source | Health | Notes |
|------------|-----------|-------------|--------|-------|
| gold_studio.py | 67 | SQLite | 🟢 | Newest, well-tested |
| engine.py | 18 | engine/api.py + SQLite | 🟡 | SSE streaming complexity |
| pipeline.py | 18 | SQLite + Fabric API | 🟡 | SSE + trigger complexity |
| source_manager.py | 18 | SQLite + ODBC + engine | 🔴 | Known key mismatches |
| sql_explorer.py | 15 | SQLite + ODBC + Fabric SQL | 🟢 | Well-audited |
| data_access.py | 11 | SQLite + Fabric SQL + OneLake | 🟡 | Multi-source joins |
| mri.py | 11 | SQLite + filesystem | 🟢 | Self-contained |
| control_plane.py | 8 | SQLite | 🟢 | Stable aggregation |
| admin.py | 8 | SQLite + config.json | 🟢 | Simple CRUD |
| entities.py | 7 | SQLite | 🟢 | Core entity ops |
| monitoring.py | 7 | SQLite | 🟢 | Read-only |
| config_manager.py | 5 | SQLite + filesystem | 🟡 | Write operations |
| load_center.py | 5 | SQLite + Fabric SQL | 🟢 | New, clean |
| glossary.py | 5 | SQLite | 🟡 | Possibly stubbed |
| overview.py | 4 | SQLite | 🟢 | Simple |
| db_explorer.py | 4 | Fabric SQL | 🟢 | Simple |
| quality.py | 4 | SQLite | 🟠 | Likely stubbed |
| test_audit.py | 4 | SQLite + filesystem | 🟢 | Simple |
| data_manager.py | 3 | SQLite | 🟢 | Simple CRUD |
| requests.py | 3 | SQLite | 🟢 | New |
| microscope.py | 2 | Fabric SQL / SQLite | 🟡 | Fabric dependency |
| lineage.py | 1 | SQLite | 🟢 | Simple |
| alerts.py | 1 | Stub | 🟠 | Likely stubbed |
| join_discovery.py | 0 | — | ⚪ | Empty placeholder |
