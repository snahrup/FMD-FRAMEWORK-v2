# FMD Framework — Audit Session Manifest (V2)

**Generated**: 2026-04-08
**Source of truth**: `dashboard/app/src/App.tsx` (router-first rule)
**Branch**: `audit/v2-inventory-freeze`
**Status**: FROZEN — do not modify without re-freeze approval

---

## 1. Summary Counts

| Metric | Count |
|--------|-------|
| Routed pages (unique, excl. redirects) | 56 |
| Redirect routes | 2 |
| Unrouted page files (physical only) | 4 |
| Grouped subsystems | 4 |
| Backend route files | 34 |
| Backend API endpoints | 286 |
| Engine modules | 22 |
| Existing canonical audits (`audits/`) | 49 |
| Existing strategic audits (`docs/superpowers/audits/`) | 5 |
| Existing packet docs | 10 |
| Coverage gaps (routed pages with NO audit) | 13 |
| Orphaned audits (audit exists, no current route) | 4 |

---

## 2. Frozen Route Surface Inventory

### 2.1 Business Portal (7 routes, 6 unique pages)

| # | SurfaceID | Surface Name | Route | Frontend File | Backend Route File(s) | Audit Status | Existing Audit | Reality | Complexity | Demo Crit | Session | Disposition |
|---|-----------|-------------|-------|---------------|----------------------|-------------|----------------|---------|-----------|-----------|---------|------------|
| 1 | BP-OVER | BusinessOverview | `/overview` | `pages/BusinessOverview.tsx` | `routes/overview.py` | STRATEGIC_ONLY | `docs/superpowers/audits/AUDIT-BusinessOverview.md` | REAL | HIGH | HIGH | BP-GOLD | VERIFY_AND_EXTEND |
| 2 | BP-ALERT | BusinessAlerts | `/alerts` | `pages/business/BusinessAlerts.tsx` | `routes/alerts.py` | NO_AUDIT | — | PARTIAL | LOW | MEDIUM | BP-GOLD | AUDIT_NORMALLY |
| 3 | BP-SRC | BusinessSources | `/sources-portal` | `pages/business/BusinessSources.tsx` | `routes/source_manager.py` | CANONICAL | `audits/AUDIT-BusinessSources.md` | PARTIAL | MEDIUM | MEDIUM | BP-GOLD | VERIFY_AND_EXTEND |
| 4 | BP-CAT | BusinessCatalog | `/catalog-portal` | `pages/business/BusinessCatalog.tsx` | `routes/glossary.py` | CANONICAL | `audits/AUDIT-BusinessCatalog.md` | PARTIAL | MEDIUM | MEDIUM | BP-GOLD | VERIFY_AND_EXTEND |
| 5 | BP-DETAIL | DatasetDetail | `/catalog-portal/:id` | `pages/business/DatasetDetail.tsx` | `routes/entities.py` | NO_AUDIT | — | PARTIAL | MEDIUM | MEDIUM | BP-GOLD | AUDIT_NORMALLY |
| 6 | BP-REQ | BusinessRequests | `/requests` | `pages/business/BusinessRequests.tsx` | `routes/requests.py` | CANONICAL | `audits/AUDIT-BusinessRequests.md` | PARTIAL | LOW | LOW | BP-GOLD | VERIFY_AND_EXTEND |
| 7 | BP-HELP | BusinessHelp | `/help` | `pages/business/BusinessHelp.tsx` | — | NO_AUDIT | — | STUBBED | LOW | LOW | BP-GOLD | AUDIT_NORMALLY |

### 2.2 Gold Studio (6 routes, 5 unique pages + 1 redirect)

| # | SurfaceID | Surface Name | Route | Frontend File | Backend Route File(s) | Audit Status | Existing Audit | Reality | Complexity | Demo Crit | Session | Disposition |
|---|-----------|-------------|-------|---------------|----------------------|-------------|----------------|---------|-----------|-----------|---------|------------|
| 8 | GS-REDIR | Gold Redirect | `/gold` | — | — | N/A | — | N/A | — | — | — | N/A |
| 9 | GS-LEDGER | GoldLedger | `/gold/ledger` | `pages/gold/GoldLedger.tsx` | `routes/gold_studio.py` | CANONICAL | `audits/AUDIT-GoldLedger.md` | PARTIAL | HIGH | HIGH | BP-GOLD | VERIFY_AND_EXTEND |
| 10 | GS-CLUST | GoldClusters | `/gold/clusters` | `pages/gold/GoldClusters.tsx` | `routes/gold_studio.py` | NO_AUDIT | — | NAIVE | HIGH | MEDIUM | BP-GOLD | AUDIT_NORMALLY |
| 11 | GS-CANON | GoldCanonical | `/gold/canonical` | `pages/gold/GoldCanonical.tsx` | `routes/gold_studio.py` | CANONICAL | `audits/AUDIT-GoldCanonical.md` | PARTIAL | HIGH | MEDIUM | BP-GOLD | VERIFY_AND_EXTEND |
| 12 | GS-SPECS | GoldSpecs | `/gold/specs` | `pages/gold/GoldSpecs.tsx` | `routes/gold_studio.py` | CANONICAL | `audits/AUDIT-GoldSpecs.md` | PARTIAL | HIGH | MEDIUM | BP-GOLD | VERIFY_AND_EXTEND |
| 13 | GS-VALID | GoldValidation | `/gold/validation` | `pages/gold/GoldValidation.tsx` | `routes/gold_studio.py` | NO_AUDIT | — | NAIVE | HIGH | MEDIUM | BP-GOLD | AUDIT_NORMALLY |

### 2.3 Engineering Console — Tier 1 Operations (6 pages)

| # | SurfaceID | Surface Name | Route | Frontend File | Backend Route File(s) | Audit Status | Existing Audit | Reality | Complexity | Demo Crit | Session | Disposition |
|---|-----------|-------------|-------|---------------|----------------------|-------------|----------------|---------|-----------|-----------|---------|------------|
| 14 | EC-SRC | SourceManager | `/sources` | `pages/SourceManager.tsx` | `routes/source_manager.py` | BOTH | `audits/AUDIT-SourceManager.md`, `docs/superpowers/audits/AUDIT-SourceManager.md` | REAL | HIGH | HIGH | EC-TIER1-OPS | VERIFY_AND_EXTEND |
| 15 | EC-ENG | EngineControl | `/engine` | `pages/EngineControl.tsx` | `routes/engine.py` | BOTH | `audits/AUDIT-EngineControl.md`, `docs/superpowers/audits/AUDIT-EngineControl.md` | REAL | HIGH | HIGH | EC-TIER1-OPS | VERIFY_AND_EXTEND |
| 16 | EC-LC | LoadCenter | `/load-center` | `pages/LoadCenter.tsx` | `routes/load_center.py` | STRATEGIC_ONLY | `docs/superpowers/audits/AUDIT-LoadCenter.md` | REAL | HIGH | HIGH | EC-TIER1-OPS | VERIFY_AND_EXTEND |
| 17 | EC-LMC | LoadMissionControl | `/load-mission-control` | `pages/LoadMissionControl.tsx` | `routes/load_mission_control.py` | CANONICAL | `audits/AUDIT-LoadMissionControl.md` | REAL | HIGH | HIGH | EC-TIER1-OPS | VERIFY_AND_EXTEND |
| 18 | EC-CFG | ConfigManager | `/config` | `pages/ConfigManager.tsx` | `routes/config_manager.py` | BOTH | `audits/AUDIT-ConfigManager.md`, `docs/superpowers/audits/AUDIT-ConfigManager.md` | REAL | MEDIUM | MEDIUM | EC-TIER1-OPS | VERIFY_AND_EXTEND |
| 19 | EC-ADMIN | AdminGateway | `/admin` | `pages/AdminGateway.tsx` | `routes/admin.py` | CANONICAL | `audits/AUDIT-AdminGateway.md` | REAL | MEDIUM | LOW | EC-TIER1-OPS | AUDIT_AS_GROUP |

### 2.4 Engineering Console — Tier 2 Monitoring (8 pages)

| # | SurfaceID | Surface Name | Route | Frontend File | Backend Route File(s) | Audit Status | Existing Audit | Reality | Complexity | Demo Crit | Session | Disposition |
|---|-----------|-------------|-------|---------------|----------------------|-------------|----------------|---------|-----------|-----------|---------|------------|
| 20 | EC-MATRIX | ExecutionMatrix | `/matrix` | `pages/ExecutionMatrix.tsx` | `routes/pipeline.py`, `routes/monitoring.py` | CANONICAL | `audits/AUDIT-ExecutionMatrix.md` | REAL | MEDIUM | HIGH | EC-TIER2-MON | VERIFY_AND_EXTEND |
| 21 | EC-FLOW | FlowExplorer | `/flow` | `pages/FlowExplorer.tsx` | `routes/pipeline.py` | CANONICAL | `audits/AUDIT-FlowExplorer.md` | REAL | MEDIUM | MEDIUM | EC-TIER2-MON | VERIFY_AND_EXTEND |
| 22 | EC-COUNTS | RecordCounts | `/counts` | `pages/RecordCounts.tsx` | `routes/data_access.py` | CANONICAL | `audits/AUDIT-RecordCounts.md` | REAL | MEDIUM | MEDIUM | EC-TIER2-MON | VERIFY_AND_EXTEND |
| 23 | EC-JOURNEY | DataJourney | `/journey` | `pages/DataJourney.tsx` | `routes/pipeline.py` | CANONICAL | `audits/AUDIT-DataJourney.md` | PARTIAL | MEDIUM | MEDIUM | EC-TIER2-MON | VERIFY_AND_EXTEND |
| 24 | EC-LIVE | LiveMonitor | `/live` | `pages/LiveMonitor.tsx` | `routes/monitoring.py` | CANONICAL | `audits/AUDIT-LiveMonitor.md` | REAL | MEDIUM | MEDIUM | EC-TIER2-MON | VERIFY_AND_EXTEND |
| 25 | EC-LPROG | LoadProgress | `/load-progress` | `pages/LoadProgress.tsx` | `routes/pipeline.py` | CANONICAL | `audits/AUDIT-LoadProgress.md` | REAL | MEDIUM | LOW | EC-TIER2-MON | VERIFY_AND_EXTEND |
| 26 | EC-ERR | ErrorIntelligence | `/errors` | `pages/ErrorIntelligence.tsx` | `routes/monitoring.py` | CANONICAL | `audits/AUDIT-ErrorIntelligence.md` | REAL | MEDIUM | MEDIUM | EC-TIER2-MON | VERIFY_AND_EXTEND |
| 27 | EC-LOG | ExecutionLog | `/logs` | `pages/ExecutionLog.tsx` | `routes/pipeline.py`, `routes/monitoring.py` | CANONICAL | `audits/AUDIT-ExecutionLog.md` | REAL | MEDIUM | MEDIUM | EC-TIER2-MON | VERIFY_AND_EXTEND |

### 2.5 Engineering Console — Tools & Data (10 pages)

| # | SurfaceID | Surface Name | Route | Frontend File | Backend Route File(s) | Audit Status | Existing Audit | Reality | Complexity | Demo Crit | Session | Disposition |
|---|-----------|-------------|-------|---------------|----------------------|-------------|----------------|---------|-----------|-----------|---------|------------|
| 28 | EC-PROF | DataProfiler | `/profile` | `pages/DataProfiler.tsx` | `routes/data_access.py` | CANONICAL | `audits/AUDIT-DataProfiler.md` | REAL | MEDIUM | MEDIUM | EC-TOOLS-DATA | VERIFY_AND_EXTEND |
| 29 | EC-MICRO | DataMicroscope | `/microscope` | `pages/DataMicroscope.tsx` | `routes/microscope.py` | CANONICAL | `audits/AUDIT-DataMicroscope.md` | REAL | MEDIUM | MEDIUM | EC-TOOLS-DATA | VERIFY_AND_EXTEND |
| 30 | EC-DBX | DatabaseExplorer | `/db-explorer` | `pages/DatabaseExplorer.tsx` | `routes/db_explorer.py` | CANONICAL | `audits/AUDIT-DatabaseExplorer.md` | REAL | MEDIUM | LOW | EC-TOOLS-DATA | VERIFY_AND_EXTEND |
| 31 | EC-SQLX | SqlExplorer | `/sql-explorer` | `pages/SqlExplorer.tsx` | `routes/sql_explorer.py` | CANONICAL | `audits/AUDIT-SqlExplorer.md` | REAL | HIGH | LOW | EC-TOOLS-DATA | VERIFY_AND_EXTEND |
| 32 | EC-BLEND | DataBlender | `/blender` | `pages/DataBlender.tsx` | `routes/data_access.py` | CANONICAL | `audits/AUDIT-DataBlender.md` | PARTIAL | MEDIUM | LOW | EC-TOOLS-DATA | VERIFY_AND_EXTEND |
| 33 | EC-DMGR | DataManager | `/data-manager` | `pages/DataManager.tsx` | `routes/data_manager.py` | CANONICAL | `audits/AUDIT-DataManager.md` | PARTIAL | MEDIUM | LOW | EC-TOOLS-DATA | VERIFY_AND_EXTEND |
| 34 | EC-VALID | ValidationChecklist | `/validation` | `pages/ValidationChecklist.tsx` | `routes/schema_validation.py` | CANONICAL | `audits/AUDIT-ValidationChecklist.md` | PARTIAL | MEDIUM | LOW | EC-TOOLS-DATA | VERIFY_AND_EXTEND |
| 35 | EC-NBC | NotebookConfig | `/notebook-config` | `pages/NotebookConfig.tsx` | `routes/config_manager.py`, `routes/notebook.py` | CANONICAL | `audits/AUDIT-NotebookConfig.md` | PARTIAL | MEDIUM | LOW | EC-TOOLS-DATA | VERIFY_AND_EXTEND |
| 36 | EC-NBD | NotebookDebug | `/notebook-debug` | `pages/NotebookDebug.tsx` | `routes/notebook.py` | CANONICAL | `audits/AUDIT-NotebookDebug.md` | PARTIAL | MEDIUM | LOW | EC-TOOLS-DATA | VERIFY_AND_EXTEND |
| 37 | EC-RUN | PipelineRunner | `/runner` | `pages/PipelineRunner.tsx` | `routes/pipeline.py` | CANONICAL | `audits/AUDIT-PipelineRunner.md` | PARTIAL | MEDIUM | LOW | EC-TOOLS-DATA | VERIFY_AND_EXTEND |

### 2.6 Governance & Data Truth (10 pages)

| # | SurfaceID | Surface Name | Route | Frontend File | Backend Route File(s) | Audit Status | Existing Audit | Reality | Complexity | Demo Crit | Session | Disposition |
|---|-----------|-------------|-------|---------------|----------------------|-------------|----------------|---------|-----------|-----------|---------|------------|
| 38 | GOV-CAT | DataCatalog | `/catalog` | `pages/DataCatalog.tsx` | `routes/glossary.py` | CANONICAL | `audits/AUDIT-DataCatalog.md` | MOCK | MEDIUM | HIGH | GOV-MOCK-TRUTH | SUPERSEDE_AND_REPLACE |
| 39 | GOV-CLASS | DataClassification | `/classification` | `pages/DataClassification.tsx` | `routes/classification.py`, `routes/purview.py` | CANONICAL | `audits/AUDIT-DataClassification.md` | MOCK | MEDIUM | MEDIUM | GOV-MOCK-TRUTH | SUPERSEDE_AND_REPLACE |
| 40 | GOV-IMPACT | ImpactAnalysis | `/impact` | `pages/ImpactAnalysis.tsx` | `routes/entities.py` | CANONICAL | `audits/AUDIT-ImpactAnalysis.md` | MOCK | MEDIUM | MEDIUM | GOV-MOCK-TRUTH | SUPERSEDE_AND_REPLACE |
| 41 | GOV-LINE | DataLineage | `/lineage` | `pages/DataLineage.tsx` | `routes/lineage.py` | CANONICAL | `audits/AUDIT-DataLineage.md` | PARTIAL | MEDIUM | MEDIUM | GOV-MOCK-TRUTH | VERIFY_AND_EXTEND |
| 42 | GOV-ESTATE | DataEstate | `/estate` | `pages/DataEstate.tsx` | `routes/data_estate.py` | NO_AUDIT | — | PARTIAL | MEDIUM | MEDIUM | GOV-MOCK-TRUTH | AUDIT_NORMALLY |
| 43 | GOV-SCHEMA | SchemaValidation | `/schema-validation` | `pages/SchemaValidation.tsx` | `routes/schema_validation.py` | NO_AUDIT | — | PARTIAL | MEDIUM | LOW | GOV-MOCK-TRUTH | AUDIT_NORMALLY |
| 44 | GOV-COL | ColumnEvolution | `/columns` | `pages/ColumnEvolution.tsx` | `routes/entities.py` | CANONICAL | `audits/AUDIT-ColumnEvolution.md` | PARTIAL | MEDIUM | LOW | GOV-MOCK-TRUTH | VERIFY_AND_EXTEND |
| 45 | GOV-SANKEY | SankeyFlow | `/sankey` | `pages/SankeyFlow.tsx` | `routes/pipeline.py` | CANONICAL | `audits/AUDIT-SankeyFlow.md` | PARTIAL | MEDIUM | MEDIUM | GOV-MOCK-TRUTH | VERIFY_AND_EXTEND |
| 46 | GOV-REPLAY | TransformationReplay | `/replay` | `pages/TransformationReplay.tsx` | `routes/pipeline.py` | CANONICAL | `audits/AUDIT-TransformationReplay.md` | PARTIAL | MEDIUM | LOW | GOV-MOCK-TRUTH | VERIFY_AND_EXTEND |
| 47 | GOV-PULSE | ImpactPulse | `/pulse` | `pages/ImpactPulse.tsx` | `routes/entities.py` | CANONICAL | `audits/AUDIT-ImpactPulse.md` | PARTIAL | MEDIUM | LOW | GOV-MOCK-TRUTH | VERIFY_AND_EXTEND |

### 2.7 Settings, Setup, Labs & Admin Subsystems (11 pages)

| # | SurfaceID | Surface Name | Route | Frontend File | Backend Route File(s) | Audit Status | Existing Audit | Reality | Complexity | Demo Crit | Session | Disposition |
|---|-----------|-------------|-------|---------------|----------------------|-------------|----------------|---------|-----------|-----------|---------|------------|
| 48 | SS-SET | Settings | `/settings` | `pages/Settings.tsx` | `routes/admin.py` | CANONICAL | `audits/AUDIT-Settings.md` | REAL | MEDIUM | LOW | SETTINGS-SETUP-LABS | AUDIT_AS_GROUP |
| 49 | SS-SETUP | EnvironmentSetup | `/setup` | `pages/EnvironmentSetup.tsx` | `routes/source_manager.py`, `routes/admin.py` | CANONICAL | `audits/AUDIT-EnvironmentSetup.md` | REAL | HIGH | MEDIUM | SETTINGS-SETUP-LABS | AUDIT_AS_GROUP |
| 50 | SS-CP | ControlPlane | `/control` | `pages/ControlPlane.tsx` | `routes/control_plane.py` | CANONICAL | `audits/AUDIT-ControlPlane.md` | REAL | MEDIUM | LOW | SETTINGS-SETUP-LABS | VERIFY_AND_EXTEND |
| 51 | LAB-CLEAN | CleansingRuleEditor | `/labs/cleansing` | `pages/CleansingRuleEditor.tsx` | `routes/cleansing.py` | NO_AUDIT | — | NAIVE | MEDIUM | LOW | SETTINGS-SETUP-LABS | AUDIT_NORMALLY |
| 52 | LAB-SCD | ScdAudit | `/labs/scd-audit` | `pages/ScdAudit.tsx` | `routes/scd_audit.py` | NO_AUDIT | — | NAIVE | MEDIUM | LOW | SETTINGS-SETUP-LABS | AUDIT_NORMALLY |
| 53 | LAB-MLV | GoldMlvManager | `/labs/gold-mlv` | `pages/GoldMlvManager.tsx` | `routes/gold.py` | NO_AUDIT | — | NAIVE | MEDIUM | LOW | SETTINGS-SETUP-LABS | AUDIT_NORMALLY |
| 54 | LAB-DQ | DqScorecard | `/labs/dq-scorecard` | `pages/DqScorecard.tsx` | `routes/quality.py` | NO_AUDIT | — | NAIVE | MEDIUM | LOW | SETTINGS-SETUP-LABS | AUDIT_NORMALLY |
| 55 | SS-TA | TestAudit | `/test-audit` | `pages/TestAudit.tsx` | `routes/test_audit.py` | CANONICAL | `audits/AUDIT-TestAudit.md` | PARTIAL | MEDIUM | LOW | SETTINGS-SETUP-LABS | VERIFY_AND_EXTEND |
| 56 | SS-TS | TestSwarm | `/test-swarm` | `pages/TestSwarm.tsx` | `routes/test_swarm.py` | CANONICAL | `audits/AUDIT-TestSwarm.md` | PARTIAL | MEDIUM | LOW | SETTINGS-SETUP-LABS | VERIFY_AND_EXTEND |
| 57 | SS-MRI | MRI | `/mri` | `pages/MRI.tsx` | `routes/mri.py` | CANONICAL | `audits/AUDIT-MRI.md` | PARTIAL | MEDIUM | LOW | SETTINGS-SETUP-LABS | VERIFY_AND_EXTEND |

### 2.8 Shared Infrastructure (audit as a unit)

| # | SurfaceID | Surface Name | Type | Primary Files | Audit Status | Session | Disposition |
|---|-----------|-------------|------|---------------|-------------|---------|------------|
| 58 | SHARED-FE | Frontend Shared Infrastructure | Shared Infra | `App.tsx`, `AppLayout.tsx`, `BusinessShell.tsx`, `hooks/*`, `lib/*`, `components/ui/*` | NO_AUDIT | PHASE-0 | AUDIT_NORMALLY |
| 59 | SHARED-BE | Backend Shared Infrastructure | Shared Infra | `server.py`, `db.py`, `router.py`, `control_plane_db.py` | NO_AUDIT | PHASE-0 | AUDIT_NORMALLY |
| 60 | SHARED-ENGINE | Engine Infrastructure | Shared Infra | `engine/*.py` (22 modules) | NO_AUDIT | PHASE-0 | AUDIT_NORMALLY |

---

## 3. Unrouted Page Files (Physical Only — No Current Route)

These pages exist as `.tsx` files but are NOT reachable from the current `App.tsx` router.

| SurfaceID | Surface Name | File | Has Audit? | Audit Path | Disposition |
|-----------|-------------|------|-----------|-----------|------------|
| ORPHAN-AG | AdminGovernance | `pages/AdminGovernance.tsx` | YES | `audits/AUDIT-AdminGovernance.md` | ARCHIVE_AS_OBSOLETE |
| ORPHAN-ED | ExecutiveDashboard | `pages/ExecutiveDashboard.tsx` | YES | `audits/AUDIT-ExecutiveDashboard.md` | ARCHIVE_AS_OBSOLETE |
| ORPHAN-PM | PipelineMatrix | `pages/PipelineMatrix.tsx` | YES | `audits/AUDIT-PipelineMatrix.md` | ARCHIVE_AS_OBSOLETE |
| ORPHAN-PMON | PipelineMonitor | `pages/PipelineMonitor.tsx` | YES | `audits/AUDIT-PipelineMonitor.md` | ARCHIVE_AS_OBSOLETE |

> **Note**: Per V2 Rule 12.1 (Router-first rule), unrouted pages are NOT in scope for active audits. Their existing audit files should be archived as obsolete.

---

## 4. Grouped Subsystem Definitions

These surfaces must be audited as cohesive groups, not as isolated leaf pages.

| Group | Root Route | Member Files | Audit File |
|-------|-----------|-------------|-----------|
| **Settings Subsystem** | `/settings` | `Settings.tsx`, `settings/DeploymentManager.tsx`, `settings/AgentCollaboration.tsx`, `settings/LiveLogPanel.tsx`, `settings/PhaseProgressTracker.tsx`, `settings/PostDeploymentSummary.tsx`, `settings/PreDeploymentPanel.tsx`, `settings/ResumeBanner.tsx` | `AUDIT-SettingsSubsystem.md` (to create) |
| **Setup Wizard** | `/setup` | `EnvironmentSetup.tsx`, `setup/SetupWizard.tsx`, `setup/SetupSettings.tsx`, `setup/ProvisionAll.tsx`, `setup/SetupCapacity.tsx`, `setup/SetupConnection.tsx`, `setup/SetupDatabase.tsx`, `setup/SetupLakehouse.tsx`, `setup/SetupReview.tsx`, `setup/SetupWorkspace.tsx` | `AUDIT-SetupWizard.md` (to create) |
| **Gold Studio** | `/gold/*` | `GoldLedger.tsx`, `GoldClusters.tsx`, `GoldCanonical.tsx`, `GoldSpecs.tsx`, `GoldValidation.tsx`, `components/gold/*` (9 components), `GoldStudioLayout.tsx` | Individual leaf audits + `AUDIT-GoldStudioSubsystem.md` (to create) |
| **Admin Gateway** | `/admin` | `AdminGateway.tsx` (likely tabs/sub-panels) | `AUDIT-AdminGateway.md` (exists, verify if covers grouped behavior) |

---

## 5. Session Assignments

| Session ID | Phase | Scope | Surface Count | Priority Surfaces |
|-----------|-------|-------|---------------|-------------------|
| **PHASE-NEG1** | -1 | Inventory Freeze & Normalization | ALL | This document, Legacy Mapping, Audit Index |
| **PHASE-0** | 0 | Shared Infrastructure | 3 units | SHARED-FE, SHARED-BE, SHARED-ENGINE |
| **EC-TIER1-OPS** | 1 | High-risk operational pages | 6 | SourceManager, EngineControl, LoadCenter, LoadMissionControl, ConfigManager, AdminGateway |
| **EC-TIER2-MON** | 1 | Monitoring & analysis pages | 8 | ExecutionMatrix, FlowExplorer, RecordCounts, DataJourney, LiveMonitor, LoadProgress, ErrorIntelligence, ExecutionLog |
| **EC-TOOLS-DATA** | 1 | Data tooling & exploration | 10 | DataProfiler, DataMicroscope, DatabaseExplorer, SqlExplorer, DataBlender, DataManager, ValidationChecklist, NotebookConfig, NotebookDebug, PipelineRunner |
| **GOV-MOCK-TRUTH** | 1 | Governance & mock truth alignment | 10 | DataCatalog, DataClassification, ImpactAnalysis, DataLineage, DataEstate, SchemaValidation, ColumnEvolution, SankeyFlow, TransformationReplay, ImpactPulse |
| **BP-GOLD** | 1 | Business Portal & Gold Studio | 13 | BusinessOverview, BusinessAlerts, BusinessSources, BusinessCatalog, DatasetDetail, BusinessRequests, BusinessHelp, GoldLedger, GoldClusters, GoldCanonical, GoldSpecs, GoldValidation |
| **SETTINGS-SETUP-LABS** | 1 | Settings, Setup, Labs, Dev Tools | 10 | Settings, EnvironmentSetup, ControlPlane, CleansingRuleEditor, ScdAudit, GoldMlvManager, DqScorecard, TestAudit, TestSwarm, MRI |
| **CONSOLIDATION** | 1.5 | Merge, dedup, packet planning | ALL | AUDIT-SUMMARY.md, PACKET_INDEX_WHOLE_APP.md |

---

## 6. Coverage Gap Analysis

### 6.1 Routed pages with NO audit (13)

| SurfaceID | Surface | Route | Priority |
|-----------|---------|-------|----------|
| BP-OVER | BusinessOverview | `/overview` | HIGH (strategic audit exists, needs canonical migration) |
| BP-ALERT | BusinessAlerts | `/alerts` | MEDIUM |
| BP-DETAIL | DatasetDetail | `/catalog-portal/:id` | MEDIUM |
| BP-HELP | BusinessHelp | `/help` | LOW |
| GS-CLUST | GoldClusters | `/gold/clusters` | MEDIUM |
| GS-VALID | GoldValidation | `/gold/validation` | MEDIUM |
| EC-LC | LoadCenter | `/load-center` | HIGH (strategic audit exists, needs canonical migration) |
| GOV-ESTATE | DataEstate | `/estate` | MEDIUM |
| GOV-SCHEMA | SchemaValidation | `/schema-validation` | LOW |
| LAB-CLEAN | CleansingRuleEditor | `/labs/cleansing` | LOW |
| LAB-SCD | ScdAudit | `/labs/scd-audit` | LOW |
| LAB-MLV | GoldMlvManager | `/labs/gold-mlv` | LOW |
| LAB-DQ | DqScorecard | `/labs/dq-scorecard` | LOW |

### 6.2 Audits targeting non-existent routes (4 orphans)

| Audit File | Target Page | Status |
|-----------|------------|--------|
| `AUDIT-AdminGovernance.md` | AdminGovernance (no route) | ARCHIVE_AS_OBSOLETE |
| `AUDIT-ExecutiveDashboard.md` | ExecutiveDashboard (no route) | ARCHIVE_AS_OBSOLETE |
| `AUDIT-PipelineMatrix.md` | PipelineMatrix (no route) | ARCHIVE_AS_OBSOLETE |
| `AUDIT-PipelineMonitor.md` | PipelineMonitor (no route) | ARCHIVE_AS_OBSOLETE |

### 6.3 Strategic audits in non-canonical location (5)

| File | Canonical Surface | Action |
|------|------------------|--------|
| `docs/superpowers/audits/AUDIT-BusinessOverview.md` | BP-OVER | Migrate to `audits/AUDIT-BusinessOverview.md` or supersede |
| `docs/superpowers/audits/AUDIT-ConfigManager.md` | EC-CFG | Reconcile with canonical `audits/AUDIT-ConfigManager.md` |
| `docs/superpowers/audits/AUDIT-EngineControl.md` | EC-ENG | Reconcile with canonical `audits/AUDIT-EngineControl.md` |
| `docs/superpowers/audits/AUDIT-LoadCenter.md` | EC-LC | Migrate to `audits/AUDIT-LoadCenter.md` or supersede |
| `docs/superpowers/audits/AUDIT-SourceManager.md` | EC-SRC | Reconcile with canonical `audits/AUDIT-SourceManager.md` |

### 6.4 Shared infrastructure — no audit coverage

All three shared infrastructure units (frontend, backend, engine) currently have zero audit coverage. This is the Phase 0 deliverable.

---

## 7. Backend Route File Coverage Map

| Route File | Endpoints | Linked Frontend Surface(s) | Covered by Audit? |
|-----------|-----------|---------------------------|-------------------|
| `admin.py` | 8 | AdminGateway, Settings | YES |
| `alerts.py` | 1 | BusinessAlerts | NO |
| `classification.py` | 6 | DataClassification | YES |
| `cleansing.py` | 6 | CleansingRuleEditor | NO |
| `config_manager.py` | 5 | ConfigManager, NotebookConfig | YES |
| `control_plane.py` | 8 | ControlPlane | YES |
| `data_access.py` | 12 | DataBlender, RecordCounts, DataProfiler | YES |
| `data_estate.py` | 1 | DataEstate | NO |
| `data_manager.py` | 3 | DataManager | YES |
| `db_explorer.py` | 4 | DatabaseExplorer | YES |
| `engine.py` | 18 | EngineControl | YES |
| `entities.py` | 7 | DatasetDetail, ColumnEvolution, ImpactPulse, ImpactAnalysis | PARTIAL |
| `glossary.py` | 5 | DataCatalog, BusinessCatalog | YES |
| `gold.py` | 3 | GoldMlvManager | NO |
| `gold_studio.py` | 69 | GoldLedger, GoldClusters, GoldCanonical, GoldSpecs, GoldValidation | PARTIAL |
| `lineage.py` | 1 | DataLineage | YES |
| `load_center.py` | 5 | LoadCenter | NO (strategic only) |
| `load_mission_control.py` | 8 | LoadMissionControl | YES |
| `microscope.py` | 2 | DataMicroscope | YES |
| `monitoring.py` | 8 | LiveMonitor, ErrorIntelligence, ExecutionLog, ExecutionMatrix | YES |
| `mri.py` | 13 | MRI | YES |
| `notebook.py` | 6 | NotebookConfig, NotebookDebug | YES |
| `overview.py` | 4 | BusinessOverview | NO (strategic only) |
| `pipeline.py` | 18 | ExecutionMatrix, FlowExplorer, ExecutionLog, LoadProgress, DataJourney, SankeyFlow, TransformationReplay, PipelineRunner | YES |
| `purview.py` | 6 | DataClassification | YES |
| `quality.py` | 4 | DqScorecard | NO |
| `requests.py` | 3 | BusinessRequests | YES |
| `scd_audit.py` | 3 | ScdAudit | NO |
| `schema_validation.py` | 5 | SchemaValidation, ValidationChecklist | PARTIAL |
| `source_manager.py` | 21 | SourceManager, BusinessSources, EnvironmentSetup | YES |
| `sql_explorer.py` | 16 | SqlExplorer | YES |
| `test_audit.py` | 4 | TestAudit | YES |
| `test_swarm.py` | 3 | TestSwarm | YES |

---

## 8. Existing Packet Documentation

| Packet Index | Surface | Packets | Status |
|-------------|---------|---------|--------|
| `PACKET_INDEX_LMC.md` | LoadMissionControl | A (Action Feedback), B (Entity History), C (Server-Side Error Filter), D (Inventory Refresh), E (Cleanup) | Existing — verify against V2 audits |
| `PACKET_INDEX_SQLX.md` | SqlExplorer | A (Table Registration API), B (Table Browser UI), C (Load Trigger) | Existing — verify against V2 audits |

---

## 9. Reconciliation Checklist

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| Routed pages match route count | 56 | 56 | PASS |
| Every routed page has surface ID | 56/56 | 56/56 | PASS |
| Every routed page has session owner | 56/56 | 56/56 | PASS |
| Canonical audits map to current routes | 49 audits | 45 map + 4 orphaned | FLAG |
| Strategic audits normalized | 5 | 0/5 migrated | PENDING |
| Coverage gaps identified | — | 13 | DOCUMENTED |
| Grouped subsystems defined | — | 4 | DOCUMENTED |
| Backend route files mapped | 34 | 34/34 | PASS |

---

## 10. Execution Order (From V2 Spec Section 16)

1. **DONE** — Create this manifest (`docs/AUDIT-SESSION-MANIFEST.md`)
2. **NEXT** — Create `dashboard/app/audits/LEGACY-AUDIT-MAPPING.md`
3. Phase 0: Shared infrastructure audit → `AUDIT-SHARED-INFRASTRUCTURE.md`
4. Phase 1: Parallel domain audits (6 sessions from Section 5)
5. Phase 1.5: Consolidate → `AUDIT-SUMMARY.md`
6. Phase 1.5: Generate packets → `PACKET_INDEX_WHOLE_APP.md`
7. Phase 2: Execute packets in dependency order
8. Phase 3: Final verification and demo readiness
