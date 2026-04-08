# FMD Framework Dashboard — Audit Session Manifest V2

**Generated**: 2026-04-08
**Source of Truth**: `dashboard/app/src/App.tsx`
**Census Baseline**: `docs/superpowers/WHOLE-APP-CENSUS.md`
**Phase**: -1 (Inventory Freeze)
**Status**: FROZEN — Do not modify without session consensus

---

## Inventory Statistics

| Metric | Count |
|--------|-------|
| Total routed pages (App.tsx) | 55 |
| Business Portal pages | 7 (incl. DatasetDetail `:id` route) |
| Engineering Console pages | 30 |
| Gold Studio pages | 5 (+1 redirect) |
| Governance pages | 10 |
| Labs pages | 4 |
| Grouped subsystems (audit as unit) | 3 (Settings/Setup, Admin tabs, Stubs) |
| Shared infrastructure targets | 2 (Engine modules, Backend routes) |
| Backend route files | 35 |
| Engine modules | 23 |
| Existing canonical audits (`audits/`) | 48 |
| Legacy audits (`dashboard/app/AUDIT-*.md`) | 43 |
| Existing work packets (`docs/packets/`) | 10 |
| Obsolete audit artifacts (no matching route) | 3 |

---

## Frozen Surface Inventory

### Legend

| Column | Description |
|--------|-------------|
| **Surface ID** | Unique identifier: `{DOMAIN}-{NNN}` |
| **Surface Name** | Component name as imported in App.tsx |
| **Surface Type** | `page`, `tab`, `grouped`, `stub`, `redirect`, `infra` |
| **Route Path** | Exact path from App.tsx router |
| **Frontend Primary File** | Main `.tsx` component file |
| **Backend Primary Route File(s)** | Python route file(s) in `api/routes/` |
| **Audit Status** | `CANONICAL`, `LEGACY_ONLY`, `BOTH`, `NONE`, `OBSOLETE` |
| **Existing Audit Path** | Path to canonical audit in `audits/` |
| **Legacy Audit Path** | Path to legacy audit at `dashboard/app/` level |
| **Reality Classification** | `REAL`, `REAL_WITH_GAPS`, `PARTIAL`, `MOCK`, `STUBBED`, `NAIVE`, `GROUPED` |
| **Complexity Tier** | Census tier: T1 (highest risk) through T6 (recently built) |
| **Demo Criticality** | `HIGH`, `MEDIUM`, `LOW` — visibility in demos |
| **Session Owner** | Assigned audit session from V2 spec section 6 |
| **Disposition** | Action to take during V2 audit |

---

### 1. Business Portal (BP)

| Surface ID | Surface Name | Surface Type | Route Path | Frontend Primary File | Backend Primary Route File(s) | Audit Status | Existing Audit Path | Legacy Audit Path | Reality Classification | Complexity Tier | Demo Criticality | Session Owner | Disposition |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BP-001 | BusinessOverview | page | `/overview` | `pages/BusinessOverview.tsx` | `overview.py` | NONE | — | — | PARTIAL | T1 | HIGH | BP-GOLD | AUDIT_NORMALLY |
| BP-002 | BusinessAlerts | page | `/alerts` | `pages/business/BusinessAlerts.tsx` | `alerts.py` | LEGACY_ONLY | — | `AUDIT-BusinessAlerts.md` | REAL | T6 | MEDIUM | BP-GOLD | SUPERSEDE_AND_REPLACE |
| BP-003 | BusinessSources | page | `/sources-portal` | `pages/business/BusinessSources.tsx` | `source_manager.py` | NONE | — | — | REAL | T6 | MEDIUM | BP-GOLD | AUDIT_NORMALLY |
| BP-004 | BusinessCatalog | page | `/catalog-portal` | `pages/business/BusinessCatalog.tsx` | `glossary.py`, `quality.py` | CANONICAL | `AUDIT-BusinessCatalog.md` | — | REAL | T6 | HIGH | BP-GOLD | VERIFY_AND_EXTEND |
| BP-005 | DatasetDetail | page | `/catalog-portal/:id` | `pages/business/DatasetDetail.tsx` | `glossary.py`, `quality.py` | NONE | — | — | REAL | T6 | MEDIUM | BP-GOLD | AUDIT_NORMALLY |
| BP-006 | BusinessRequests | page | `/requests` | `pages/business/BusinessRequests.tsx` | `requests.py` | CANONICAL | `AUDIT-BusinessRequests.md` | — | REAL | T6 | LOW | BP-GOLD | VERIFY_AND_EXTEND |
| BP-007 | BusinessHelp | page | `/help` | `pages/business/BusinessHelp.tsx` | — | NONE | — | — | REAL | T6 | LOW | BP-GOLD | AUDIT_NORMALLY |

---

### 2. Engineering Console (EC)

| Surface ID | Surface Name | Surface Type | Route Path | Frontend Primary File | Backend Primary Route File(s) | Audit Status | Existing Audit Path | Legacy Audit Path | Reality Classification | Complexity Tier | Demo Criticality | Session Owner | Disposition |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EC-001 | ExecutionMatrix | page | `/matrix` | `pages/ExecutionMatrix.tsx` | `monitoring.py`, `entities.py` | BOTH | `AUDIT-ExecutionMatrix.md` | `AUDIT-ExecutionMatrix.md` | REAL | T2 | HIGH | EC-TIER2-MONITORING | VERIFY_AND_EXTEND |
| EC-002 | EngineControl | page | `/engine` | `pages/EngineControl.tsx` | `engine.py` | BOTH | `AUDIT-EngineControl.md` | `AUDIT-EngineControl.md` | PARTIAL | T1 | HIGH | EC-TIER1-OPS | VERIFY_AND_EXTEND |
| EC-003 | ControlPlane | page | `/control` | `pages/ControlPlane.tsx` | `control_plane.py` | BOTH | `AUDIT-ControlPlane.md` | `AUDIT-ControlPlane.md` | REAL | T2 | HIGH | EC-TIER2-MONITORING | VERIFY_AND_EXTEND |
| EC-004 | ExecutionLog | page | `/logs` | `pages/ExecutionLog.tsx` | `monitoring.py` | BOTH | `AUDIT-ExecutionLog.md` | `AUDIT-ExecutionLog.md` | REAL | T3 | MEDIUM | EC-TIER2-MONITORING | VERIFY_AND_EXTEND |
| EC-005 | ErrorIntelligence | page | `/errors` | `pages/ErrorIntelligence.tsx` | `monitoring.py` | BOTH | `AUDIT-ErrorIntelligence.md` | `AUDIT-ErrorIntelligence.md` | REAL | T3 | MEDIUM | EC-TIER2-MONITORING | VERIFY_AND_EXTEND |
| EC-006 | AdminGateway | page | `/admin` | `pages/AdminGateway.tsx` | `admin.py` | BOTH | `AUDIT-AdminGateway.md` | `AUDIT-AdminGateway.md` | GROUPED | T3 | LOW | SETTINGS-SETUP-LABS | AUDIT_AS_GROUP |
| EC-007 | FlowExplorer | page | `/flow` | `pages/FlowExplorer.tsx` | `entities.py`, `lineage.py` | BOTH | `AUDIT-FlowExplorer.md` | `AUDIT-FlowExplorer.md` | PARTIAL | T2 | HIGH | EC-TIER2-MONITORING | VERIFY_AND_EXTEND |
| EC-008 | SourceManager | page | `/sources` | `pages/SourceManager.tsx` | `source_manager.py` | BOTH | `AUDIT-SourceManager.md` | `AUDIT-SourceManager.md` | PARTIAL | T1 | HIGH | EC-TIER1-OPS | VERIFY_AND_EXTEND |
| EC-009 | DataBlender | page | `/blender` | `pages/DataBlender.tsx` | `data_access.py` | BOTH | `AUDIT-DataBlender.md` | — | REAL | T3 | LOW | EC-TOOLS-DATA | VERIFY_AND_EXTEND |
| EC-010 | RecordCounts | page | `/counts` | `pages/RecordCounts.tsx` | `entities.py`, `data_access.py` | BOTH | `AUDIT-RecordCounts.md` | `AUDIT-RecordCounts.md` | PARTIAL | T2 | MEDIUM | EC-TIER2-MONITORING | VERIFY_AND_EXTEND |
| EC-011 | DataJourney | page | `/journey` | `pages/DataJourney.tsx` | `entities.py` | BOTH | `AUDIT-DataJourney.md` | `AUDIT-DataJourney.md` | PARTIAL | T2 | MEDIUM | EC-TIER2-MONITORING | VERIFY_AND_EXTEND |
| EC-012 | ConfigManager | page | `/config` | `pages/ConfigManager.tsx` | `config_manager.py` | BOTH | `AUDIT-ConfigManager.md` | `AUDIT-ConfigManager.md` | PARTIAL | T1 | MEDIUM | EC-TIER1-OPS | VERIFY_AND_EXTEND |
| EC-013 | NotebookConfig | page | `/notebook-config` | `pages/NotebookConfig.tsx` | `notebook.py` | BOTH | `AUDIT-NotebookConfig.md` | `AUDIT-NotebookConfig.md` | PARTIAL | T3 | LOW | EC-TOOLS-DATA | VERIFY_AND_EXTEND |
| EC-014 | PipelineRunner | page | `/runner` | `pages/PipelineRunner.tsx` | `pipeline.py` | BOTH | `AUDIT-PipelineRunner.md` | `AUDIT-PipelineRunner.md` | PARTIAL | T3 | LOW | EC-TOOLS-DATA | VERIFY_AND_EXTEND |
| EC-015 | ValidationChecklist | page | `/validation` | `pages/ValidationChecklist.tsx` | `schema_validation.py` | BOTH | `AUDIT-ValidationChecklist.md` | `AUDIT-ValidationChecklist.md` | PARTIAL | T3 | LOW | EC-TOOLS-DATA | VERIFY_AND_EXTEND |
| EC-016 | NotebookDebug | page | `/notebook-debug` | `pages/NotebookDebug.tsx` | `notebook.py` | BOTH | `AUDIT-NotebookDebug.md` | `AUDIT-NotebookDebug.md` | PARTIAL | T3 | LOW | EC-TOOLS-DATA | VERIFY_AND_EXTEND |
| EC-017 | LiveMonitor | page | `/live` | `pages/LiveMonitor.tsx` | `monitoring.py`, `engine.py` | BOTH | `AUDIT-LiveMonitor.md` | `AUDIT-LiveMonitor.md` | PARTIAL | T3 | MEDIUM | EC-TIER2-MONITORING | VERIFY_AND_EXTEND |
| EC-018 | Settings | page | `/settings` | `pages/Settings.tsx` | `admin.py`, `config_manager.py` | BOTH | `AUDIT-Settings.md` | `AUDIT-Settings.md` | GROUPED | T3 | LOW | SETTINGS-SETUP-LABS | AUDIT_AS_GROUP |
| EC-019 | EnvironmentSetup | page | `/setup` | `pages/EnvironmentSetup.tsx` | `admin.py` | BOTH | `AUDIT-EnvironmentSetup.md` | `AUDIT-EnvironmentSetup.md` | GROUPED | T3 | LOW | SETTINGS-SETUP-LABS | AUDIT_AS_GROUP |
| EC-020 | SqlExplorer | page | `/sql-explorer` | `pages/SqlExplorer.tsx` | `sql_explorer.py` | BOTH | `AUDIT-SqlExplorer.md` | `AUDIT-SqlExplorer.md` | REAL | T2 | MEDIUM | EC-TOOLS-DATA | VERIFY_AND_EXTEND |
| EC-021 | LoadProgress | page | `/load-progress` | `pages/LoadProgress.tsx` | `monitoring.py` | BOTH | `AUDIT-LoadProgress.md` | `AUDIT-LoadProgress.md` | PARTIAL | T3 | MEDIUM | EC-TIER2-MONITORING | VERIFY_AND_EXTEND |
| EC-022 | DataProfiler | page | `/profile` | `pages/DataProfiler.tsx` | `data_access.py`, `microscope.py` | BOTH | `AUDIT-DataProfiler.md` | `AUDIT-DataProfiler.md` | PARTIAL | T2 | MEDIUM | EC-TOOLS-DATA | VERIFY_AND_EXTEND |
| EC-023 | ColumnEvolution | page | `/columns` | `pages/ColumnEvolution.tsx` | `data_access.py` | BOTH | `AUDIT-ColumnEvolution.md` | `AUDIT-ColumnEvolution.md` | PARTIAL | T3 | LOW | EC-TIER2-MONITORING | VERIFY_AND_EXTEND |
| EC-024 | DataMicroscope | page | `/microscope` | `pages/DataMicroscope.tsx` | `microscope.py` | BOTH | `AUDIT-DataMicroscope.md` | `AUDIT-DataMicroscope.md` | PARTIAL | T2 | MEDIUM | EC-TOOLS-DATA | VERIFY_AND_EXTEND |
| EC-025 | SankeyFlow | page | `/sankey` | `pages/SankeyFlow.tsx` | `entities.py` | BOTH | `AUDIT-SankeyFlow.md` | `AUDIT-SankeyFlow.md` | PARTIAL | T3 | LOW | EC-TIER2-MONITORING | VERIFY_AND_EXTEND |
| EC-026 | TransformationReplay | page | `/replay` | `pages/TransformationReplay.tsx` | `entities.py` | BOTH | `AUDIT-TransformationReplay.md` | `AUDIT-TransformationReplay.md` | PARTIAL | T3 | LOW | EC-TIER2-MONITORING | VERIFY_AND_EXTEND |
| EC-027 | ImpactPulse | page | `/pulse` | `pages/ImpactPulse.tsx` | `entities.py` | BOTH | `AUDIT-ImpactPulse.md` | `AUDIT-ImpactPulse.md` | PARTIAL | T3 | LOW | EC-TIER2-MONITORING | VERIFY_AND_EXTEND |
| EC-028 | TestAudit | page | `/test-audit` | `pages/TestAudit.tsx` | `test_audit.py` | BOTH | `AUDIT-TestAudit.md` | `AUDIT-TestAudit.md` | REAL | T3 | LOW | EC-TOOLS-DATA | VERIFY_AND_EXTEND |
| EC-029 | TestSwarm | page | `/test-swarm` | `pages/TestSwarm.tsx` | `test_swarm.py` | BOTH | `AUDIT-TestSwarm.md` | `AUDIT-TestSwarm.md` | PARTIAL | T3 | LOW | EC-TOOLS-DATA | VERIFY_AND_EXTEND |
| EC-030 | MRI | page | `/mri` | `pages/MRI.tsx` | `mri.py` | CANONICAL | `AUDIT-MRI.md` | `AUDIT-MRI.md` | REAL | T3 | LOW | EC-TOOLS-DATA | VERIFY_AND_EXTEND |

---

### 3. Gold Studio (GS)

| Surface ID | Surface Name | Surface Type | Route Path | Frontend Primary File | Backend Primary Route File(s) | Audit Status | Existing Audit Path | Legacy Audit Path | Reality Classification | Complexity Tier | Demo Criticality | Session Owner | Disposition |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GS-001 | GoldLedger | page | `/gold/ledger` | `pages/gold/GoldLedger.tsx` | `gold_studio.py`, `gold.py` | CANONICAL | `AUDIT-GoldLedger.md` | — | REAL | T6 | HIGH | BP-GOLD | VERIFY_AND_EXTEND |
| GS-002 | GoldClusters | page | `/gold/clusters` | `pages/gold/GoldClusters.tsx` | `gold_studio.py` | NONE | — | — | REAL | T6 | HIGH | BP-GOLD | AUDIT_NORMALLY |
| GS-003 | GoldCanonical | page | `/gold/canonical` | `pages/gold/GoldCanonical.tsx` | `gold_studio.py` | CANONICAL | `AUDIT-GoldCanonical.md` | — | REAL | T6 | HIGH | BP-GOLD | VERIFY_AND_EXTEND |
| GS-004 | GoldSpecs | page | `/gold/specs` | `pages/gold/GoldSpecs.tsx` | `gold_studio.py` | CANONICAL | `AUDIT-GoldSpecs.md` | — | REAL | T6 | HIGH | BP-GOLD | VERIFY_AND_EXTEND |
| GS-005 | GoldValidation | page | `/gold/validation` | `pages/gold/GoldValidation.tsx` | `gold_studio.py` | NONE | — | — | REAL | T6 | HIGH | BP-GOLD | AUDIT_NORMALLY |
| GS-R01 | Gold Redirect | redirect | `/gold` | — | — | — | — | — | — | — | — | — | N/A |

---

### 4. Governance (GOV)

| Surface ID | Surface Name | Surface Type | Route Path | Frontend Primary File | Backend Primary Route File(s) | Audit Status | Existing Audit Path | Legacy Audit Path | Reality Classification | Complexity Tier | Demo Criticality | Session Owner | Disposition |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GOV-001 | DataLineage | page | `/lineage` | `pages/DataLineage.tsx` | `lineage.py` | BOTH | `AUDIT-DataLineage.md` | `AUDIT-DataLineage.md` | REAL | T3 | MEDIUM | GOV-MOCK-TRUTH | VERIFY_AND_EXTEND |
| GOV-002 | DataClassification | page | `/classification` | `pages/DataClassification.tsx` | `classification.py` | BOTH | `AUDIT-DataClassification.md` | `AUDIT-DataClassification.md` | REAL_WITH_GAPS | T4 | LOW | GOV-MOCK-TRUTH | VERIFY_AND_EXTEND |
| GOV-003 | DataCatalog | page | `/catalog` | `pages/DataCatalog.tsx` | `glossary.py`, `quality.py` | BOTH | `AUDIT-DataCatalog.md` | `AUDIT-DataCatalog.md` | REAL_WITH_GAPS | T4 | MEDIUM | GOV-MOCK-TRUTH | VERIFY_AND_EXTEND |
| GOV-004 | ImpactAnalysis | page | `/impact` | `pages/ImpactAnalysis.tsx` | — | BOTH | `AUDIT-ImpactAnalysis.md` | `AUDIT-ImpactAnalysis.md` | REAL_WITH_GAPS | T4 | LOW | GOV-MOCK-TRUTH | VERIFY_AND_EXTEND |
| GOV-005 | DatabaseExplorer | page | `/db-explorer` | `pages/DatabaseExplorer.tsx` | `db_explorer.py` | CANONICAL | `AUDIT-DatabaseExplorer.md` | — | REAL | T3 | MEDIUM | EC-TOOLS-DATA | VERIFY_AND_EXTEND |
| GOV-006 | DataManager | page | `/data-manager` | `pages/DataManager.tsx` | `data_manager.py` | BOTH | `AUDIT-DataManager.md` | `AUDIT-DataManager.md` | PARTIAL | T3 | LOW | EC-TOOLS-DATA | VERIFY_AND_EXTEND |
| GOV-007 | LoadCenter | page | `/load-center` | `pages/LoadCenter.tsx` | `load_center.py` | NONE | — | — | REAL | T1 | HIGH | EC-TIER1-OPS | AUDIT_NORMALLY |
| GOV-008 | LoadMissionControl | page | `/load-mission-control` | `pages/LoadMissionControl.tsx` | `load_mission_control.py`, `engine.py` | BOTH | `AUDIT-LoadMissionControl.md` | `AUDIT-LoadMissionControl.md` | REAL | T1 | HIGH | EC-TIER1-OPS | VERIFY_AND_EXTEND |
| GOV-009 | SchemaValidation | page | `/schema-validation` | `pages/SchemaValidation.tsx` | `schema_validation.py` | NONE | — | — | REAL | T3 | LOW | EC-TOOLS-DATA | AUDIT_NORMALLY |
| GOV-010 | DataEstate | page | `/estate` | `pages/DataEstate.tsx` | `data_estate.py` | NONE | — | — | REAL | T3 | LOW | GOV-MOCK-TRUTH | AUDIT_NORMALLY |

---

### 5. Labs (LAB)

| Surface ID | Surface Name | Surface Type | Route Path | Frontend Primary File | Backend Primary Route File(s) | Audit Status | Existing Audit Path | Legacy Audit Path | Reality Classification | Complexity Tier | Demo Criticality | Session Owner | Disposition |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| LAB-001 | CleansingRuleEditor | page | `/labs/cleansing` | `pages/labs/CleansingRuleEditor.tsx` | `cleansing.py` | LEGACY_ONLY | — | `AUDIT-CleansingRuleEditor.md` | REAL | T5 | LOW | SETTINGS-SETUP-LABS | SUPERSEDE_AND_REPLACE |
| LAB-002 | ScdAudit | page | `/labs/scd-audit` | `pages/labs/ScdAudit.tsx` | `scd_audit.py` | LEGACY_ONLY | — | `AUDIT-ScdAudit.md` | REAL | T5 | LOW | SETTINGS-SETUP-LABS | SUPERSEDE_AND_REPLACE |
| LAB-003 | GoldMlvManager | page | `/labs/gold-mlv` | `pages/labs/GoldMlvManager.tsx` | `gold.py` | LEGACY_ONLY | — | `AUDIT-GoldMlvManager.md` | REAL | T5 | LOW | SETTINGS-SETUP-LABS | SUPERSEDE_AND_REPLACE |
| LAB-004 | DqScorecard | page | `/labs/dq-scorecard` | `pages/labs/DqScorecard.tsx` | `quality.py` | LEGACY_ONLY | — | `AUDIT-DqScorecard.md` | REAL | T5 | LOW | SETTINGS-SETUP-LABS | SUPERSEDE_AND_REPLACE |

> **Note**: The canonical `AUDIT-Stubs.md` in `audits/` originally covered all four lab pages as a group when they were stubs. All four have since been fully implemented (700-900+ lines each with real backends). Individual legacy audits exist for each. See `AUDIT-SETTINGS-SETUP-LABS.md` findings SSL-LAB-001 through SSL-LAB-004 for details.

---

### 6. Grouped Subsystems (GRP)

| Surface ID | Surface Name | Surface Type | Route Path | Frontend Primary File | Backend Primary Route File(s) | Audit Status | Existing Audit Path | Legacy Audit Path | Reality Classification | Complexity Tier | Demo Criticality | Session Owner | Disposition |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GRP-001 | AdminGateway + AdminGovernance | grouped | `/admin` | `pages/AdminGateway.tsx`, `pages/AdminGovernance.tsx` | `admin.py` | BOTH | `AUDIT-AdminGateway.md`, `AUDIT-AdminGovernance.md` | `AUDIT-AdminGateway.md`, `AUDIT-AdminGovernance.md` | GROUPED | T3 | LOW | SETTINGS-SETUP-LABS | AUDIT_AS_GROUP |
| GRP-002 | Settings + DeploymentManager | grouped | `/settings` | `pages/Settings.tsx`, `components/settings/DeploymentManager.tsx` + 5 sub-panels | `admin.py`, `config_manager.py` | BOTH | `AUDIT-Settings.md` | `AUDIT-Settings.md` | GROUPED | T3 | LOW | SETTINGS-SETUP-LABS | AUDIT_AS_GROUP |
| GRP-003 | EnvironmentSetup + SetupWizard | grouped | `/setup` | `pages/EnvironmentSetup.tsx`, `components/setup/SetupWizard.tsx` + 6 step components | `admin.py` | BOTH | `AUDIT-EnvironmentSetup.md` | `AUDIT-EnvironmentSetup.md` | GROUPED | T3 | LOW | SETTINGS-SETUP-LABS | AUDIT_AS_GROUP |

---

### 7. Obsolete Audit Artifacts (OBS)

These audit files exist in both canonical and legacy locations but have **NO matching route** in `App.tsx`. They must be archived.

| Surface ID | Audit Name | Canonical Path | Legacy Path | Reason for Obsolescence | Disposition |
|---|---|---|---|---|---|
| OBS-001 | ExecutiveDashboard | `audits/AUDIT-ExecutiveDashboard.md` | `AUDIT-ExecutiveDashboard.md` | No `/executive` or `ExecutiveDashboard` route exists in App.tsx. Page was removed. | ARCHIVE_AS_OBSOLETE |
| OBS-002 | PipelineMatrix | `audits/AUDIT-PipelineMatrix.md` | `AUDIT-PipelineMatrix.md` | No `/pipes` or `PipelineMatrix` route exists in App.tsx. Census listed it at `/pipes` but route is gone. | ARCHIVE_AS_OBSOLETE |
| OBS-003 | PipelineMonitor | `audits/AUDIT-PipelineMonitor.md` | `AUDIT-PipelineMonitor.md` | No `/pipes` or `PipelineMonitor` route exists in App.tsx. Census listed it at `/pipes` but route is gone. | ARCHIVE_AS_OBSOLETE |

> **Critical Finding**: The census (2026-03-19) lists PipelineMonitor at `/pipes` as Tier 2 (#6) and PipelineMatrix at `/pipes` as Tier 3 (#22). However, as of 2026-04-08, **neither route exists in App.tsx**. Both pages were removed after the census was written. Their audit artifacts are orphaned.

---

### 8. Backend Route Files (BE)

| Surface ID | Route File | Primary Frontend Consumer(s) | Endpoint Count | Health (Census) |
|---|---|---|---|---|
| BE-001 | `gold_studio.py` | GoldLedger, GoldClusters, GoldCanonical, GoldSpecs, GoldValidation | 67 | Stable |
| BE-002 | `engine.py` | EngineControl, LiveMonitor, LoadMissionControl | 18 | Fragile |
| BE-003 | `pipeline.py` | PipelineRunner | 18 | Fragile |
| BE-004 | `source_manager.py` | SourceManager, BusinessSources | 18 | Critical (key mismatches) |
| BE-005 | `sql_explorer.py` | SqlExplorer | 15 | Stable |
| BE-006 | `data_access.py` | DataBlender, DataProfiler, ColumnEvolution, RecordCounts | 11 | Fragile |
| BE-007 | `mri.py` | MRI | 11 | Stable |
| BE-008 | `control_plane.py` | ControlPlane | 8 | Stable |
| BE-009 | `admin.py` | AdminGateway, Settings, EnvironmentSetup | 8 | Stable |
| BE-010 | `entities.py` | FlowExplorer, DataJourney, SankeyFlow, TransformationReplay, ImpactPulse, RecordCounts | 7 | Stable |
| BE-011 | `monitoring.py` | ExecutionMatrix, ExecutionLog, ErrorIntelligence, LiveMonitor, LoadProgress | 7 | Stable |
| BE-012 | `config_manager.py` | ConfigManager, Settings | 5 | Fragile |
| BE-013 | `load_center.py` | LoadCenter | 5 | Stable |
| BE-014 | `glossary.py` | BusinessCatalog, DataCatalog | 5 | Fragile |
| BE-015 | `overview.py` | BusinessOverview | 4 | Stable |
| BE-016 | `db_explorer.py` | DatabaseExplorer | 4 | Stable |
| BE-017 | `quality.py` | BusinessCatalog, DataCatalog, DqScorecard | 4 | Stable |
| BE-018 | `test_audit.py` | TestAudit | 4 | Stable |
| BE-019 | `data_manager.py` | DataManager | 3 | Stable |
| BE-020 | `requests.py` | BusinessRequests | 3 | Stable |
| BE-021 | `microscope.py` | DataMicroscope, DataProfiler | 2 | Fragile |
| BE-022 | `lineage.py` | DataLineage, FlowExplorer | 1 | Stable |
| BE-023 | `alerts.py` | BusinessAlerts | 1 | Stubbed |
| BE-024 | `load_mission_control.py` | LoadMissionControl | varies | Stable |
| BE-025 | `classification.py` | DataClassification | varies | Stable |
| BE-026 | `cleansing.py` | CleansingRuleEditor | varies | Stable |
| BE-027 | `scd_audit.py` | ScdAudit | varies | Stable |
| BE-028 | `schema_validation.py` | SchemaValidation, ValidationChecklist | varies | Stable |
| BE-029 | `data_estate.py` | DataEstate | varies | Stable |
| BE-030 | `notebook.py` | NotebookConfig, NotebookDebug | varies | Fragile |
| BE-031 | `gold.py` | GoldMlvManager (legacy) | varies | Stable |
| BE-032 | `purview.py` | (no direct consumer — governance metadata) | varies | Unknown |
| BE-033 | `join_discovery.py` | (no direct consumer — empty placeholder) | 0 | Empty |
| BE-034 | `test_swarm.py` | TestSwarm | varies | Stable |
| BE-035 | `__init__.py` | (package init) | 0 | N/A |

---

### 9. Engine Modules (ENG)

| Surface ID | Module | Purpose | Primary Consumers |
|---|---|---|---|
| ENG-001 | `orchestrator.py` | Pipeline orchestration, run coordination | EngineControl, PipelineRunner |
| ENG-002 | `pipeline_runner.py` | Individual pipeline execution | PipelineRunner, EngineControl |
| ENG-003 | `extractor.py` | Source data extraction (ODBC/Fabric) | SourceManager, LoadCenter |
| ENG-004 | `loader.py` | Data loading into lakehouse layers | LoadCenter, LoadMissionControl |
| ENG-005 | `bronze_processor.py` | Bronze layer transformations | EngineControl |
| ENG-006 | `silver_processor.py` | Silver layer transformations | EngineControl |
| ENG-007 | `schema_validator.py` | Schema validation logic | SchemaValidation, ValidationChecklist |
| ENG-008 | `config.py` | Configuration management | ConfigManager, Settings |
| ENG-009 | `connections.py` | Database connection management | SqlExplorer, DatabaseExplorer |
| ENG-010 | `api.py` | Engine API (Flask routes) | All engine-dependent pages |
| ENG-011 | `auth.py` | Authentication/authorization | Global |
| ENG-012 | `logging_db.py` | SQLite logging database | ExecutionLog, ErrorIntelligence |
| ENG-013 | `metadata_analyzer.py` | Metadata analysis engine | DataProfiler, DataMicroscope |
| ENG-014 | `models.py` | Data models/schemas | Global |
| ENG-015 | `notebook_trigger.py` | Fabric notebook execution | NotebookConfig, NotebookDebug |
| ENG-016 | `onelake_io.py` | OneLake file I/O | LoadCenter, DataEstate |
| ENG-017 | `optimizer.py` | Query/pipeline optimization | EngineControl |
| ENG-018 | `preflight.py` | Pre-run validation checks | EngineControl, EnvironmentSetup |
| ENG-019 | `smoke_test.py` | Smoke test execution | TestAudit, MRI |
| ENG-020 | `vpn.py` | VPN connectivity management | SqlExplorer, SourceManager |
| ENG-021 | `worker.py` | Background worker threads | EngineControl |
| ENG-022 | `bulk_snapshot.py` | Bulk data snapshot operations | LoadCenter |
| ENG-023 | `__init__.py` | Package init | N/A |

---

## Session Assignments

### EC-TIER1-OPS (6 surfaces)

Core operational pages that control the engine and data pipeline.

| Surface ID | Surface Name | Route | Disposition |
|---|---|---|---|
| EC-002 | EngineControl | `/engine` | VERIFY_AND_EXTEND |
| EC-008 | SourceManager | `/sources` | VERIFY_AND_EXTEND |
| EC-012 | ConfigManager | `/config` | VERIFY_AND_EXTEND |
| GOV-007 | LoadCenter | `/load-center` | AUDIT_NORMALLY |
| GOV-008 | LoadMissionControl | `/load-mission-control` | VERIFY_AND_EXTEND |
| BP-001 | BusinessOverview | `/overview` | AUDIT_NORMALLY |

### EC-TIER2-MONITORING (12 surfaces)

Monitoring, visualization, and analysis pages.

| Surface ID | Surface Name | Route | Disposition |
|---|---|---|---|
| EC-001 | ExecutionMatrix | `/matrix` | VERIFY_AND_EXTEND |
| EC-003 | ControlPlane | `/control` | VERIFY_AND_EXTEND |
| EC-004 | ExecutionLog | `/logs` | VERIFY_AND_EXTEND |
| EC-005 | ErrorIntelligence | `/errors` | VERIFY_AND_EXTEND |
| EC-007 | FlowExplorer | `/flow` | VERIFY_AND_EXTEND |
| EC-010 | RecordCounts | `/counts` | VERIFY_AND_EXTEND |
| EC-011 | DataJourney | `/journey` | VERIFY_AND_EXTEND |
| EC-017 | LiveMonitor | `/live` | VERIFY_AND_EXTEND |
| EC-021 | LoadProgress | `/load-progress` | VERIFY_AND_EXTEND |
| EC-023 | ColumnEvolution | `/columns` | VERIFY_AND_EXTEND |
| EC-025 | SankeyFlow | `/sankey` | VERIFY_AND_EXTEND |
| EC-026 | TransformationReplay | `/replay` | VERIFY_AND_EXTEND |

### EC-TOOLS-DATA (15 surfaces)

Data tools, explorers, and testing pages.

| Surface ID | Surface Name | Route | Disposition |
|---|---|---|---|
| EC-009 | DataBlender | `/blender` | VERIFY_AND_EXTEND |
| EC-013 | NotebookConfig | `/notebook-config` | VERIFY_AND_EXTEND |
| EC-014 | PipelineRunner | `/runner` | VERIFY_AND_EXTEND |
| EC-015 | ValidationChecklist | `/validation` | VERIFY_AND_EXTEND |
| EC-016 | NotebookDebug | `/notebook-debug` | VERIFY_AND_EXTEND |
| EC-020 | SqlExplorer | `/sql-explorer` | VERIFY_AND_EXTEND |
| EC-022 | DataProfiler | `/profile` | VERIFY_AND_EXTEND |
| EC-024 | DataMicroscope | `/microscope` | VERIFY_AND_EXTEND |
| EC-027 | ImpactPulse | `/pulse` | VERIFY_AND_EXTEND |
| EC-028 | TestAudit | `/test-audit` | VERIFY_AND_EXTEND |
| EC-029 | TestSwarm | `/test-swarm` | VERIFY_AND_EXTEND |
| EC-030 | MRI | `/mri` | VERIFY_AND_EXTEND |
| GOV-005 | DatabaseExplorer | `/db-explorer` | VERIFY_AND_EXTEND |
| GOV-006 | DataManager | `/data-manager` | VERIFY_AND_EXTEND |
| GOV-009 | SchemaValidation | `/schema-validation` | AUDIT_NORMALLY |

### GOV-MOCK-TRUTH (5 surfaces)

Governance pages, especially those with mock/hardcoded data that need truth alignment.

| Surface ID | Surface Name | Route | Disposition |
|---|---|---|---|
| GOV-001 | DataLineage | `/lineage` | VERIFY_AND_EXTEND |
| GOV-002 | DataClassification | `/classification` | VERIFY_AND_EXTEND |
| GOV-003 | DataCatalog | `/catalog` | VERIFY_AND_EXTEND |
| GOV-004 | ImpactAnalysis | `/impact` | VERIFY_AND_EXTEND |
| GOV-010 | DataEstate | `/estate` | AUDIT_NORMALLY |

### BP-GOLD (12 surfaces)

All Business Portal and Gold Studio pages.

| Surface ID | Surface Name | Route | Disposition |
|---|---|---|---|
| BP-002 | BusinessAlerts | `/alerts` | SUPERSEDE_AND_REPLACE |
| BP-003 | BusinessSources | `/sources-portal` | AUDIT_NORMALLY |
| BP-004 | BusinessCatalog | `/catalog-portal` | VERIFY_AND_EXTEND |
| BP-005 | DatasetDetail | `/catalog-portal/:id` | AUDIT_NORMALLY |
| BP-006 | BusinessRequests | `/requests` | VERIFY_AND_EXTEND |
| BP-007 | BusinessHelp | `/help` | AUDIT_NORMALLY |
| GS-001 | GoldLedger | `/gold/ledger` | VERIFY_AND_EXTEND |
| GS-002 | GoldClusters | `/gold/clusters` | AUDIT_NORMALLY |
| GS-003 | GoldCanonical | `/gold/canonical` | VERIFY_AND_EXTEND |
| GS-004 | GoldSpecs | `/gold/specs` | VERIFY_AND_EXTEND |
| GS-005 | GoldValidation | `/gold/validation` | AUDIT_NORMALLY |

### SETTINGS-SETUP-LABS (10 surfaces)

Settings, setup wizards, admin tabs, and labs stubs.

| Surface ID | Surface Name | Route | Disposition |
|---|---|---|---|
| EC-006 | AdminGateway | `/admin` | AUDIT_AS_GROUP |
| EC-018 | Settings | `/settings` | AUDIT_AS_GROUP |
| EC-019 | EnvironmentSetup | `/setup` | AUDIT_AS_GROUP |
| GRP-001 | Admin Group | `/admin` | AUDIT_AS_GROUP |
| GRP-002 | Settings Group | `/settings` | AUDIT_AS_GROUP |
| GRP-003 | Setup Group | `/setup` | AUDIT_AS_GROUP |
| LAB-001 | CleansingRuleEditor | `/labs/cleansing` | SUPERSEDE_AND_REPLACE |
| LAB-002 | ScdAudit | `/labs/scd-audit` | SUPERSEDE_AND_REPLACE |
| LAB-003 | GoldMlvManager | `/labs/gold-mlv` | SUPERSEDE_AND_REPLACE |
| LAB-004 | DqScorecard | `/labs/dq-scorecard` | SUPERSEDE_AND_REPLACE |

---

## Coverage Gaps

Routed pages with **NO audit coverage** (neither canonical nor legacy):

| Surface ID | Surface Name | Route | Priority | Notes |
|---|---|---|---|---|
| BP-001 | BusinessOverview | `/overview` | **T1 — CRITICAL** | Landing page. Census says Fragile. First thing users see. Must audit immediately. |
| BP-003 | BusinessSources | `/sources-portal` | T6 | New Business Portal page. |
| BP-005 | DatasetDetail | `/catalog-portal/:id` | T6 | New Business Portal page. |
| BP-007 | BusinessHelp | `/help` | T6 | New Business Portal page, likely static. |
| GS-002 | GoldClusters | `/gold/clusters` | T6 | Gold Studio page, built with spec, likely stable. |
| GS-005 | GoldValidation | `/gold/validation` | T6 | Gold Studio page, built with spec, likely stable. |
| GOV-007 | LoadCenter | `/load-center` | **T1 — CRITICAL** | Newest page. Central to daily ops. No audit exists anywhere. |
| GOV-009 | SchemaValidation | `/schema-validation` | T3 | Has backend route file, no audit. |
| GOV-010 | DataEstate | `/estate` | T3 | Has backend route file, no audit. |

> **Priority note**: BusinessOverview (T1) and LoadCenter (T1) are the most critical coverage gaps. Both are high-visibility pages with no audit documentation whatsoever.

---

## Audit Artifacts Requiring Disposition

### Canonical Audits in `dashboard/app/audits/` (48 files)

| Audit File | Matching Route? | Disposition |
|---|---|---|
| AUDIT-AdminGateway.md | Yes (`/admin`) | VERIFY_AND_EXTEND |
| AUDIT-AdminGovernance.md | Yes (tab within `/admin`) | VERIFY_AND_EXTEND |
| AUDIT-BusinessCatalog.md | Yes (`/catalog-portal`) | VERIFY_AND_EXTEND |
| AUDIT-BusinessRequests.md | Yes (`/requests`) | VERIFY_AND_EXTEND |
| AUDIT-BusinessSources.md | Yes (`/sources-portal`) | VERIFY_AND_EXTEND |
| AUDIT-ColumnEvolution.md | Yes (`/columns`) | VERIFY_AND_EXTEND |
| AUDIT-ConfigManager.md | Yes (`/config`) | VERIFY_AND_EXTEND |
| AUDIT-ControlPlane.md | Yes (`/control`) | VERIFY_AND_EXTEND |
| AUDIT-DataBlender.md | Yes (`/blender`) | VERIFY_AND_EXTEND |
| AUDIT-DataCatalog.md | Yes (`/catalog`) | VERIFY_AND_EXTEND |
| AUDIT-DataClassification.md | Yes (`/classification`) | VERIFY_AND_EXTEND |
| AUDIT-DataJourney.md | Yes (`/journey`) | VERIFY_AND_EXTEND |
| AUDIT-DataLineage.md | Yes (`/lineage`) | VERIFY_AND_EXTEND |
| AUDIT-DataManager.md | Yes (`/data-manager`) | VERIFY_AND_EXTEND |
| AUDIT-DataMicroscope.md | Yes (`/microscope`) | VERIFY_AND_EXTEND |
| AUDIT-DataProfiler.md | Yes (`/profile`) | VERIFY_AND_EXTEND |
| AUDIT-DatabaseExplorer.md | Yes (`/db-explorer`) | VERIFY_AND_EXTEND |
| AUDIT-EngineControl.md | Yes (`/engine`) | VERIFY_AND_EXTEND |
| AUDIT-EnvironmentSetup.md | Yes (`/setup`) | VERIFY_AND_EXTEND |
| AUDIT-ErrorIntelligence.md | Yes (`/errors`) | VERIFY_AND_EXTEND |
| AUDIT-ExecutionLog.md | Yes (`/logs`) | VERIFY_AND_EXTEND |
| AUDIT-ExecutionMatrix.md | Yes (`/matrix`) | VERIFY_AND_EXTEND |
| **AUDIT-ExecutiveDashboard.md** | **NO** | **ARCHIVE_AS_OBSOLETE** |
| AUDIT-FlowExplorer.md | Yes (`/flow`) | VERIFY_AND_EXTEND |
| AUDIT-GoldCanonical.md | Yes (`/gold/canonical`) | VERIFY_AND_EXTEND |
| AUDIT-GoldLedger.md | Yes (`/gold/ledger`) | VERIFY_AND_EXTEND |
| AUDIT-GoldSpecs.md | Yes (`/gold/specs`) | VERIFY_AND_EXTEND |
| AUDIT-ImpactAnalysis.md | Yes (`/impact`) | VERIFY_AND_EXTEND |
| AUDIT-ImpactPulse.md | Yes (`/pulse`) | VERIFY_AND_EXTEND |
| AUDIT-LiveMonitor.md | Yes (`/live`) | VERIFY_AND_EXTEND |
| AUDIT-LoadMissionControl.md | Yes (`/load-mission-control`) | VERIFY_AND_EXTEND |
| AUDIT-LoadProgress.md | Yes (`/load-progress`) | VERIFY_AND_EXTEND |
| AUDIT-MRI.md | Yes (`/mri`) | VERIFY_AND_EXTEND |
| AUDIT-NotebookConfig.md | Yes (`/notebook-config`) | VERIFY_AND_EXTEND |
| AUDIT-NotebookDebug.md | Yes (`/notebook-debug`) | VERIFY_AND_EXTEND |
| **AUDIT-PipelineMatrix.md** | **NO** | **ARCHIVE_AS_OBSOLETE** |
| **AUDIT-PipelineMonitor.md** | **NO** | **ARCHIVE_AS_OBSOLETE** |
| AUDIT-PipelineRunner.md | Yes (`/runner`) | VERIFY_AND_EXTEND |
| AUDIT-RecordCounts.md | Yes (`/counts`) | VERIFY_AND_EXTEND |
| AUDIT-SankeyFlow.md | Yes (`/sankey`) | VERIFY_AND_EXTEND |
| AUDIT-Settings.md | Yes (`/settings`) | AUDIT_AS_GROUP |
| AUDIT-SourceManager.md | Yes (`/sources`) | VERIFY_AND_EXTEND |
| AUDIT-SqlExplorer.md | Yes (`/sql-explorer`) | VERIFY_AND_EXTEND |
| AUDIT-Stubs.md | Yes (covers all Labs) | SUPERSEDE_AND_REPLACE |
| AUDIT-TestAudit.md | Yes (`/test-audit`) | VERIFY_AND_EXTEND |
| AUDIT-TestSwarm.md | Yes (`/test-swarm`) | VERIFY_AND_EXTEND |
| AUDIT-TransformationReplay.md | Yes (`/replay`) | VERIFY_AND_EXTEND |
| AUDIT-ValidationChecklist.md | Yes (`/validation`) | VERIFY_AND_EXTEND |
| SCHEMA_REFERENCE.txt | (reference doc) | RETAIN_AS_REFERENCE |

### Legacy Audits at `dashboard/app/AUDIT-*.md` (43 files)

All legacy audits should be superseded by their canonical counterparts. After V2 audit completes, legacy files should be archived or removed.

| Legacy Audit | Has Canonical? | Action |
|---|---|---|
| AUDIT-AdminGateway.md | Yes | Archive after V2 |
| AUDIT-AdminGovernance.md | Yes | Archive after V2 |
| AUDIT-BusinessAlerts.md | **No** | SUPERSEDE_AND_REPLACE (create canonical) |
| AUDIT-CleansingRuleEditor.md | No (covered by AUDIT-Stubs) | Archive after V2 |
| AUDIT-ColumnEvolution.md | Yes | Archive after V2 |
| AUDIT-ConfigManager.md | Yes | Archive after V2 |
| AUDIT-ControlPlane.md | Yes | Archive after V2 |
| AUDIT-DataBlender.md | Yes | Archive after V2 |
| AUDIT-DataCatalog.md | Yes | Archive after V2 |
| AUDIT-DataClassification.md | Yes | Archive after V2 |
| AUDIT-DataJourney.md | Yes | Archive after V2 |
| AUDIT-DataLineage.md | Yes | Archive after V2 |
| AUDIT-DataMicroscope.md | Yes | Archive after V2 |
| AUDIT-DataProfiler.md | Yes | Archive after V2 |
| AUDIT-DqScorecard.md | No (covered by AUDIT-Stubs) | Archive after V2 |
| AUDIT-EngineControl.md | Yes | Archive after V2 |
| AUDIT-EnvironmentSetup.md | Yes | Archive after V2 |
| AUDIT-ErrorIntelligence.md | Yes | Archive after V2 |
| AUDIT-ExecutionLog.md | Yes | Archive after V2 |
| AUDIT-ExecutionMatrix.md | Yes | Archive after V2 |
| AUDIT-ExecutiveDashboard.md | Yes (both obsolete) | ARCHIVE_AS_OBSOLETE |
| AUDIT-FlowExplorer.md | Yes | Archive after V2 |
| AUDIT-GoldMlvManager.md | No (covered by AUDIT-Stubs) | Archive after V2 |
| AUDIT-ImpactAnalysis.md | Yes | Archive after V2 |
| AUDIT-ImpactPulse.md | Yes | Archive after V2 |
| AUDIT-LiveMonitor.md | Yes | Archive after V2 |
| AUDIT-LoadProgress.md | Yes | Archive after V2 |
| AUDIT-MRI.md | Yes | Archive after V2 |
| AUDIT-NotebookConfig.md | Yes | Archive after V2 |
| AUDIT-NotebookDebug.md | Yes | Archive after V2 |
| AUDIT-PipelineMatrix.md | Yes (both obsolete) | ARCHIVE_AS_OBSOLETE |
| AUDIT-PipelineMonitor.md | Yes (both obsolete) | ARCHIVE_AS_OBSOLETE |
| AUDIT-PipelineRunner.md | Yes | Archive after V2 |
| AUDIT-RecordCounts.md | Yes | Archive after V2 |
| AUDIT-SankeyFlow.md | Yes | Archive after V2 |
| AUDIT-ScdAudit.md | No (covered by AUDIT-Stubs) | Archive after V2 |
| AUDIT-Settings.md | Yes | Archive after V2 |
| AUDIT-SourceManager.md | Yes | Archive after V2 |
| AUDIT-SqlExplorer.md | Yes | Archive after V2 |
| AUDIT-TestAudit.md | Yes | Archive after V2 |
| AUDIT-TestSwarm.md | Yes | Archive after V2 |
| AUDIT-TransformationReplay.md | Yes | Archive after V2 |
| AUDIT-ValidationChecklist.md | Yes | Archive after V2 |

### Existing Work Packets (`docs/packets/`)

| Packet | Status |
|---|---|
| PACKET_INDEX_LMC | Active — LoadMissionControl work index |
| PACKET_INDEX_SQLX | Active — SqlExplorer work index |
| PACKET_LMC_A_ACTION_FEEDBACK | Active |
| PACKET_LMC_B_ENTITY_HISTORY | Active |
| PACKET_LMC_C_SERVER_SIDE_ERROR_FILTER | Active |
| PACKET_LMC_D_INVENTORY_REFRESH | Active |
| PACKET_LMC_E_CLEANUP | Active |
| PACKET_SQLX_A_TABLE_REGISTRATION_API | Active |
| PACKET_SQLX_B_TABLE_BROWSER_UI | Active |
| PACKET_SQLX_C_LOAD_TRIGGER | Active |

---

## Grouped Subsystem Definitions

### GRP-001: Admin Group (`/admin`)

The AdminGateway page is a tab container that hosts multiple sub-views:

| Component | File | Purpose |
|---|---|---|
| AdminGateway | `pages/AdminGateway.tsx` | Tab host / delegator |
| AdminGovernance | `pages/AdminGovernance.tsx` | Governance controls tab |

**Backend**: `admin.py` (8 endpoints)
**Audit approach**: Single grouped audit covering the tab container and all tab content.

### GRP-002: Settings Group (`/settings`)

The Settings page contains feature flags, deployment management, and configuration sub-panels:

| Component | File | Purpose |
|---|---|---|
| Settings | `pages/Settings.tsx` | Main settings page (1121 lines) |
| DeploymentManager | `components/settings/DeploymentManager.tsx` | Deployment orchestration |
| + 5 sub-panels | `components/settings/*.tsx` | Individual deployment panels |
| AgentCollaboration | `components/settings/AgentCollaboration.tsx` | Multi-agent coordination |

**Backend**: `admin.py`, `config_manager.py`
**Audit approach**: Single grouped audit covering all settings sub-components. Existing `AUDIT-Settings.md` focuses on color token migration -- V2 must cover full functionality.

### GRP-003: Setup Group (`/setup`)

The EnvironmentSetup page contains a multi-step wizard for Fabric workspace provisioning:

| Component | File | Purpose |
|---|---|---|
| EnvironmentSetup | `pages/EnvironmentSetup.tsx` | Setup page shell |
| SetupWizard | `components/setup/SetupWizard.tsx` | Multi-step wizard controller |
| + 6 step components | `components/setup/steps/*.tsx` | Individual wizard steps |

**Backend**: `admin.py`
**Audit approach**: Single grouped audit covering the wizard flow end-to-end. Census marks this as Fragile due to multi-step wizard complexity.

---

## Cross-Reference Integrity Notes

1. **Census date drift**: The census was generated 2026-03-19. Since then, PipelineMonitor (`/pipes`) and PipelineMatrix (`/pipes`) routes were removed. Any census references to these pages are stale.

2. **AdminGovernance is not a standalone route**: It renders as a tab within AdminGateway at `/admin`. The census correctly identifies it as "tab" but it has its own audit file. V2 should merge into the Admin group audit.

3. **BusinessOverview has NO audit anywhere**: Despite being T1 (landing page, first user impression), neither canonical nor legacy audit exists. This is the single most critical coverage gap.

4. **LoadCenter has NO audit anywhere**: T1 page, newest in the app, central to daily operations. Second most critical coverage gap.

5. **AUDIT-Stubs.md in canonical audits**: This single file covers all 4 lab stubs (CleansingRuleEditor, ScdAudit, GoldMlvManager, DqScorecard). Legacy audits exist individually for each. V2 should maintain the grouped approach.

6. **Legacy audit `AUDIT-LoadMissionControl.md` at `docs/` level**: A third copy exists at `docs/AUDIT-LoadMissionControl.md` (from arctic-drift, 2026-03-23). The canonical audit in `audits/` (from true-falcon, 2026-03-25) supersedes it. The docs-level copy should be archived.

7. **Gold Studio backend density**: `gold_studio.py` has 67 endpoints -- more than any other route file. GoldLedger audit exists but GoldClusters and GoldValidation have no audits despite sharing this backend.

8. **`join_discovery.py` and `purview.py` are orphaned backends**: No frontend page directly consumes these route files. They may be used indirectly or are dead code.

---

## Corrections Applied (Packet P9)

**Date**: 2026-04-08
**Authority**: Phase 1 audit findings from GOV-MOCK-TRUTH and SETTINGS-SETUP-LABS sessions

### Governance Reclassifications (GOV-MOCK-TRUTH audit)

| Surface ID | Surface Name | Old Classification | New Classification | Rationale |
|---|---|---|---|---|
| GOV-002 | DataClassification | MOCK | REAL_WITH_GAPS | Uses real Entity Digest + `/api/classification/summary` with real SQL queries. Shows zeros when no scan has run (honest empty state, not fake data). The previously-fabricated `*15` column multiplier was fixed in the March 23 audit. Ref: AUDIT-GOV-MOCK-TRUTH.md, GOV-CLS-001 through GOV-CLS-006. |
| GOV-003 | DataCatalog | MOCK | REAL_WITH_GAPS | Entirely driven by real Entity Digest data. No hardcoded or fabricated data. Gaps are unpopulated fields (qualityScore, businessName, tags) and placeholder modal tabs (Columns, Lineage) that honestly say "not available." Ref: AUDIT-GOV-MOCK-TRUTH.md, GOV-CAT-001 through GOV-CAT-010. |
| GOV-004 | ImpactAnalysis | MOCK | REAL_WITH_GAPS | Uses real Entity Digest for entity statuses. `computeImpact()` is deterministic client-side computation over real data -- no fabricated counts or random values. Gap: Gold layer hardcoded to `not_started` (structural limitation, not mock). Ref: AUDIT-GOV-MOCK-TRUTH.md, GOV-IMP-001 through GOV-IMP-008. |

### Labs Reclassifications (SETTINGS-SETUP-LABS audit)

| Surface ID | Surface Name | Old Type | New Type | Old Classification | New Classification | Rationale |
|---|---|---|---|---|---|---|
| LAB-001 | CleansingRuleEditor | stub | page | STUBBED | REAL | ~900+ lines, full CRUD for cleansing rules with real backend (`cleansing.py`, 300 lines, 4 endpoints). Ref: SSL-LAB-001. |
| LAB-002 | ScdAudit | stub | page | STUBBED | REAL | ~700+ lines, SCD2 merge audit viewer with real backend (`scd_audit.py`, 280 lines, 3 endpoints querying `engine_task_log`). Ref: SSL-LAB-002. |
| LAB-003 | GoldMlvManager | stub | page | STUBBED | REAL | ~800+ lines, Gold layer object browser with real backend (`gold.py`, 200 lines, 3 endpoints querying `gs_gold_specs`). Ref: SSL-LAB-003. |
| LAB-004 | DqScorecard | stub | page | STUBBED | REAL | ~700+ lines, quality tier scorecard with real backend (`quality.py`, 170 lines, 4 endpoints querying `quality_scores`). Ref: SSL-LAB-004. |

### Backend Health Corrections

| Surface ID | Route File | Old Health | New Health | Rationale |
|---|---|---|---|---|
| BE-017 | `quality.py` | Stubbed | Stable | 4 real endpoints querying `quality_scores` table (confirmed by SSL-LAB-004 audit). |
| BE-025 | `classification.py` | Stubbed | Stable | 6 real endpoints with Presidio + pattern-based classification engine (confirmed by GOV-MOCK-TRUTH audit). |
| BE-026 | `cleansing.py` | Stubbed | Stable | 4 real CRUD endpoints for cleansing rules (confirmed by SSL-LAB-001 audit). |
| BE-027 | `scd_audit.py` | Stubbed | Stable | 3 real endpoints querying Silver layer task log (confirmed by SSL-LAB-002 audit). |

---

*End of Inventory Freeze. This manifest is the authoritative reference for all V2 audit sessions.*
