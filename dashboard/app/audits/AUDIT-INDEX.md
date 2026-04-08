# Audit Index — V2

**Generated**: 2026-04-08
**Canonical location**: `dashboard/app/audits/`
**Manifest**: `docs/AUDIT-SESSION-MANIFEST.md`
**Legacy mapping**: `dashboard/app/audits/LEGACY-AUDIT-MAPPING.md`

---

## Current Audit Files

| # | Audit File | Surface | Route | Status | Disposition |
|---|-----------|---------|-------|--------|------------|
| 1 | AUDIT-AdminGateway.md | AdminGateway | `/admin` | EXISTING | AUDIT_AS_GROUP |
| 2 | AUDIT-AdminGovernance.md | AdminGovernance | *(no route)* | ORPHANED | ARCHIVE_AS_OBSOLETE |
| 3 | AUDIT-BusinessCatalog.md | BusinessCatalog | `/catalog-portal` | EXISTING | VERIFY_AND_EXTEND |
| 4 | AUDIT-BusinessRequests.md | BusinessRequests | `/requests` | EXISTING | VERIFY_AND_EXTEND |
| 5 | AUDIT-BusinessSources.md | BusinessSources | `/sources-portal` | EXISTING | VERIFY_AND_EXTEND |
| 6 | AUDIT-ColumnEvolution.md | ColumnEvolution | `/columns` | EXISTING | VERIFY_AND_EXTEND |
| 7 | AUDIT-ConfigManager.md | ConfigManager | `/config` | EXISTING | VERIFY_AND_EXTEND |
| 8 | AUDIT-ControlPlane.md | ControlPlane | `/control` | EXISTING | VERIFY_AND_EXTEND |
| 9 | AUDIT-DatabaseExplorer.md | DatabaseExplorer | `/db-explorer` | EXISTING | VERIFY_AND_EXTEND |
| 10 | AUDIT-DataBlender.md | DataBlender | `/blender` | EXISTING | VERIFY_AND_EXTEND |
| 11 | AUDIT-DataCatalog.md | DataCatalog | `/catalog` | EXISTING | VERIFY_AND_EXTEND |
| 12 | AUDIT-DataClassification.md | DataClassification | `/classification` | EXISTING | VERIFY_AND_EXTEND |
| 13 | AUDIT-DataJourney.md | DataJourney | `/journey` | EXISTING | VERIFY_AND_EXTEND |
| 14 | AUDIT-DataLineage.md | DataLineage | `/lineage` | EXISTING | VERIFY_AND_EXTEND |
| 15 | AUDIT-DataManager.md | DataManager | `/data-manager` | EXISTING | VERIFY_AND_EXTEND |
| 16 | AUDIT-DataMicroscope.md | DataMicroscope | `/microscope` | EXISTING | VERIFY_AND_EXTEND |
| 17 | AUDIT-DataProfiler.md | DataProfiler | `/profile` | EXISTING | VERIFY_AND_EXTEND |
| 18 | AUDIT-EngineControl.md | EngineControl | `/engine` | EXISTING | VERIFY_AND_EXTEND |
| 19 | AUDIT-EnvironmentSetup.md | EnvironmentSetup | `/setup` | EXISTING | VERIFY_AND_EXTEND |
| 20 | AUDIT-ErrorIntelligence.md | ErrorIntelligence | `/errors` | EXISTING | VERIFY_AND_EXTEND |
| 21 | AUDIT-ExecutionLog.md | ExecutionLog | `/logs` | EXISTING | VERIFY_AND_EXTEND |
| 22 | AUDIT-ExecutionMatrix.md | ExecutionMatrix | `/matrix` | EXISTING | VERIFY_AND_EXTEND |
| 23 | AUDIT-ExecutiveDashboard.md | ExecutiveDashboard | *(no route)* | ORPHANED | ARCHIVE_AS_OBSOLETE |
| 24 | AUDIT-FlowExplorer.md | FlowExplorer | `/flow` | EXISTING | VERIFY_AND_EXTEND |
| 25 | AUDIT-GoldCanonical.md | GoldCanonical | `/gold/canonical` | EXISTING | VERIFY_AND_EXTEND |
| 26 | AUDIT-GoldLedger.md | GoldLedger | `/gold/ledger` | EXISTING | VERIFY_AND_EXTEND |
| 27 | AUDIT-GoldSpecs.md | GoldSpecs | `/gold/specs` | EXISTING | VERIFY_AND_EXTEND |
| 28 | AUDIT-ImpactAnalysis.md | ImpactAnalysis | `/impact` | EXISTING | VERIFY_AND_EXTEND |
| 29 | AUDIT-ImpactPulse.md | ImpactPulse | `/pulse` | EXISTING | VERIFY_AND_EXTEND |
| 30 | AUDIT-LiveMonitor.md | LiveMonitor | `/live` | EXISTING | VERIFY_AND_EXTEND |
| 31 | AUDIT-LoadMissionControl.md | LoadMissionControl | `/load-mission-control` | EXISTING | VERIFY_AND_EXTEND |
| 32 | AUDIT-LoadProgress.md | LoadProgress | `/load-progress` | EXISTING | VERIFY_AND_EXTEND |
| 33 | AUDIT-MRI.md | MRI | `/mri` | EXISTING | VERIFY_AND_EXTEND |
| 34 | AUDIT-NotebookConfig.md | NotebookConfig | `/notebook-config` | EXISTING | VERIFY_AND_EXTEND |
| 35 | AUDIT-NotebookDebug.md | NotebookDebug | `/notebook-debug` | EXISTING | VERIFY_AND_EXTEND |
| 36 | AUDIT-PipelineMatrix.md | PipelineMatrix | *(no route)* | ORPHANED | ARCHIVE_AS_OBSOLETE |
| 37 | AUDIT-PipelineMonitor.md | PipelineMonitor | *(no route)* | ORPHANED | ARCHIVE_AS_OBSOLETE |
| 38 | AUDIT-PipelineRunner.md | PipelineRunner | `/runner` | EXISTING | VERIFY_AND_EXTEND |
| 39 | AUDIT-RecordCounts.md | RecordCounts | `/counts` | EXISTING | VERIFY_AND_EXTEND |
| 40 | AUDIT-SankeyFlow.md | SankeyFlow | `/sankey` | EXISTING | VERIFY_AND_EXTEND |
| 41 | AUDIT-Settings.md | Settings | `/settings` | EXISTING | AUDIT_AS_GROUP |
| 42 | AUDIT-SourceManager.md | SourceManager | `/sources` | EXISTING | VERIFY_AND_EXTEND |
| 43 | AUDIT-SqlExplorer.md | SqlExplorer | `/sql-explorer` | EXISTING | VERIFY_AND_EXTEND |
| 44 | AUDIT-Stubs.md | *(grouped)* | *(multiple)* | EXISTING | VERIFY_AND_EXTEND |
| 45 | AUDIT-TestAudit.md | TestAudit | `/test-audit` | EXISTING | VERIFY_AND_EXTEND |
| 46 | AUDIT-TestSwarm.md | TestSwarm | `/test-swarm` | EXISTING | VERIFY_AND_EXTEND |
| 47 | AUDIT-TransformationReplay.md | TransformationReplay | `/replay` | EXISTING | VERIFY_AND_EXTEND |
| 48 | AUDIT-ValidationChecklist.md | ValidationChecklist | `/validation` | EXISTING | VERIFY_AND_EXTEND |

---

## Audits to Create (Phase 1)

| # | Audit File (to create) | Surface | Route | Session |
|---|----------------------|---------|-------|---------|
| 1 | AUDIT-BusinessOverview.md | BusinessOverview | `/overview` | BP-GOLD |
| 2 | AUDIT-BusinessAlerts.md | BusinessAlerts | `/alerts` | BP-GOLD |
| 3 | AUDIT-DatasetDetail.md | DatasetDetail | `/catalog-portal/:id` | BP-GOLD |
| 4 | AUDIT-BusinessHelp.md | BusinessHelp | `/help` | BP-GOLD |
| 5 | AUDIT-GoldClusters.md | GoldClusters | `/gold/clusters` | BP-GOLD |
| 6 | AUDIT-GoldValidation.md | GoldValidation | `/gold/validation` | BP-GOLD |
| 7 | AUDIT-LoadCenter.md | LoadCenter | `/load-center` | EC-TIER1-OPS |
| 8 | AUDIT-DataEstate.md | DataEstate | `/estate` | GOV-MOCK-TRUTH |
| 9 | AUDIT-SchemaValidation.md | SchemaValidation | `/schema-validation` | GOV-MOCK-TRUTH |
| 10 | AUDIT-CleansingRuleEditor.md | CleansingRuleEditor | `/labs/cleansing` | SETTINGS-SETUP-LABS |
| 11 | AUDIT-ScdAudit.md | ScdAudit | `/labs/scd-audit` | SETTINGS-SETUP-LABS |
| 12 | AUDIT-GoldMlvManager.md | GoldMlvManager | `/labs/gold-mlv` | SETTINGS-SETUP-LABS |
| 13 | AUDIT-DqScorecard.md | DqScorecard | `/labs/dq-scorecard` | SETTINGS-SETUP-LABS |

---

## Grouped Subsystem Audits to Create (Phase 1)

| # | Audit File (to create) | Subsystem | Session |
|---|----------------------|-----------|---------|
| 1 | AUDIT-SettingsSubsystem.md | Settings + 7 sub-panels | SETTINGS-SETUP-LABS |
| 2 | AUDIT-SetupWizard.md | EnvironmentSetup + 8 wizard steps | SETTINGS-SETUP-LABS |
| 3 | AUDIT-GoldStudioSubsystem.md | Gold Studio shared components + layout | BP-GOLD |

---

## Phase 0 Audit (Shared Infrastructure)

| # | Audit File (to create) | Scope | Session |
|---|----------------------|-------|---------|
| 1 | AUDIT-SHARED-INFRASTRUCTURE.md | All shared frontend + backend + engine infrastructure | PHASE-0 |

---

## Consolidation Documents (Phase 1.5)

| # | Document | Purpose | Session |
|---|---------|---------|---------|
| 1 | AUDIT-SUMMARY.md | Consolidated findings across all audits | CONSOLIDATION |
| 2 | `docs/packets/PACKET_INDEX_WHOLE_APP.md` | Master packet index for all remediation | CONSOLIDATION |

---

## Statistics

| Metric | Count |
|--------|-------|
| Existing canonical audits | 48 (+ 1 reference file) |
| Orphaned audits | 4 |
| Audits to create (leaf pages) | 13 |
| Grouped subsystem audits to create | 3 |
| Shared infrastructure audit to create | 1 |
| Consolidation documents to create | 2 |
| **Total audit files at completion** | **67** |

---

## Corrections Applied (Packet P9, 2026-04-08)

1. **GOV-002 DataClassification, GOV-003 DataCatalog, GOV-004 ImpactAnalysis**: Disposition changed from `SUPERSEDE_AND_REPLACE` to `VERIFY_AND_EXTEND`. Phase 1 GOV-MOCK-TRUTH audit confirmed these pages use real data (Entity Digest, real SQL queries), not mock data. The existing audits are accurate and need extension, not replacement. Reality classification corrected from MOCK to REAL_WITH_GAPS in the manifest.
2. **LAB-001 through LAB-004**: All four labs pages confirmed as full implementations (700-900+ lines each) with real backends, not stubs. Reality classification corrected from STUBBED to REAL in the manifest. Surface type corrected from `stub` to `page`.
