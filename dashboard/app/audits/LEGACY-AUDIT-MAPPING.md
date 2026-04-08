# Legacy Audit Mapping — V2 Normalization

**Generated**: 2026-04-08
**Purpose**: Map every existing audit artifact to its current canonical surface, determine validity, and assign disposition per V2 Section 9.
**Manifest reference**: `docs/AUDIT-SESSION-MANIFEST.md`

---

## 1. Canonical Audit Files (`dashboard/app/audits/`)

These 49 files are in the canonical location. Each is mapped to its current route surface.

### 1.1 Valid — Maps to Current Route (41 files)

| Audit File | Surface ID | Current Route | Disposition | Notes |
|-----------|-----------|---------------|------------|-------|
| AUDIT-AdminGateway.md | EC-ADMIN | `/admin` | VERIFY_AND_EXTEND | Verify covers grouped admin tabs |
| AUDIT-BusinessCatalog.md | BP-CAT | `/catalog-portal` | VERIFY_AND_EXTEND | |
| AUDIT-BusinessRequests.md | BP-REQ | `/requests` | VERIFY_AND_EXTEND | |
| AUDIT-BusinessSources.md | BP-SRC | `/sources-portal` | VERIFY_AND_EXTEND | |
| AUDIT-ColumnEvolution.md | GOV-COL | `/columns` | VERIFY_AND_EXTEND | |
| AUDIT-ConfigManager.md | EC-CFG | `/config` | VERIFY_AND_EXTEND | Has strategic duplicate in `docs/superpowers/audits/` |
| AUDIT-ControlPlane.md | SS-CP | `/control` | VERIFY_AND_EXTEND | |
| AUDIT-DatabaseExplorer.md | EC-DBX | `/db-explorer` | VERIFY_AND_EXTEND | |
| AUDIT-DataBlender.md | EC-BLEND | `/blender` | VERIFY_AND_EXTEND | |
| AUDIT-DataCatalog.md | GOV-CAT | `/catalog` | SUPERSEDE_AND_REPLACE | Page is MOCK — needs complete re-audit |
| AUDIT-DataClassification.md | GOV-CLASS | `/classification` | SUPERSEDE_AND_REPLACE | Page is MOCK — needs complete re-audit |
| AUDIT-DataJourney.md | EC-JOURNEY | `/journey` | VERIFY_AND_EXTEND | |
| AUDIT-DataLineage.md | GOV-LINE | `/lineage` | VERIFY_AND_EXTEND | |
| AUDIT-DataManager.md | EC-DMGR | `/data-manager` | VERIFY_AND_EXTEND | |
| AUDIT-DataMicroscope.md | EC-MICRO | `/microscope` | VERIFY_AND_EXTEND | |
| AUDIT-DataProfiler.md | EC-PROF | `/profile` | VERIFY_AND_EXTEND | |
| AUDIT-EngineControl.md | EC-ENG | `/engine` | VERIFY_AND_EXTEND | Has strategic duplicate — reconcile |
| AUDIT-EnvironmentSetup.md | SS-SETUP | `/setup` | VERIFY_AND_EXTEND | Verify covers setup wizard group |
| AUDIT-ErrorIntelligence.md | EC-ERR | `/errors` | VERIFY_AND_EXTEND | |
| AUDIT-ExecutionLog.md | EC-LOG | `/logs` | VERIFY_AND_EXTEND | |
| AUDIT-ExecutionMatrix.md | EC-MATRIX | `/matrix` | VERIFY_AND_EXTEND | |
| AUDIT-FlowExplorer.md | EC-FLOW | `/flow` | VERIFY_AND_EXTEND | |
| AUDIT-GoldCanonical.md | GS-CANON | `/gold/canonical` | VERIFY_AND_EXTEND | |
| AUDIT-GoldLedger.md | GS-LEDGER | `/gold/ledger` | VERIFY_AND_EXTEND | |
| AUDIT-GoldSpecs.md | GS-SPECS | `/gold/specs` | VERIFY_AND_EXTEND | |
| AUDIT-ImpactAnalysis.md | GOV-IMPACT | `/impact` | SUPERSEDE_AND_REPLACE | Page is MOCK — needs complete re-audit |
| AUDIT-ImpactPulse.md | GOV-PULSE | `/pulse` | VERIFY_AND_EXTEND | |
| AUDIT-LiveMonitor.md | EC-LIVE | `/live` | VERIFY_AND_EXTEND | |
| AUDIT-LoadMissionControl.md | EC-LMC | `/load-mission-control` | VERIFY_AND_EXTEND | Has strategic duplicate in `docs/superpowers/audits/` |
| AUDIT-LoadProgress.md | EC-LPROG | `/load-progress` | VERIFY_AND_EXTEND | |
| AUDIT-MRI.md | SS-MRI | `/mri` | VERIFY_AND_EXTEND | |
| AUDIT-NotebookConfig.md | EC-NBC | `/notebook-config` | VERIFY_AND_EXTEND | |
| AUDIT-NotebookDebug.md | EC-NBD | `/notebook-debug` | VERIFY_AND_EXTEND | |
| AUDIT-PipelineRunner.md | EC-RUN | `/runner` | VERIFY_AND_EXTEND | |
| AUDIT-RecordCounts.md | EC-COUNTS | `/counts` | VERIFY_AND_EXTEND | |
| AUDIT-SankeyFlow.md | GOV-SANKEY | `/sankey` | VERIFY_AND_EXTEND | Known render-then-blank bug |
| AUDIT-Settings.md | SS-SET | `/settings` | VERIFY_AND_EXTEND | Verify covers settings subsystem group |
| AUDIT-SourceManager.md | EC-SRC | `/sources` | VERIFY_AND_EXTEND | Has strategic duplicate — reconcile |
| AUDIT-SqlExplorer.md | EC-SQLX | `/sql-explorer` | VERIFY_AND_EXTEND | |
| AUDIT-TestAudit.md | SS-TA | `/test-audit` | VERIFY_AND_EXTEND | |
| AUDIT-TestSwarm.md | SS-TS | `/test-swarm` | VERIFY_AND_EXTEND | |
| AUDIT-TransformationReplay.md | GOV-REPLAY | `/replay` | VERIFY_AND_EXTEND | |
| AUDIT-ValidationChecklist.md | EC-VALID | `/validation` | VERIFY_AND_EXTEND | |

### 1.2 Orphaned — No Current Route (4 files)

| Audit File | Target Page | Route Exists? | Disposition | Reason |
|-----------|------------|--------------|------------|--------|
| AUDIT-AdminGovernance.md | AdminGovernance | NO — not in App.tsx | ARCHIVE_AS_OBSOLETE | Page file exists but is not routed. May have been absorbed into AdminGateway or removed from navigation. |
| AUDIT-ExecutiveDashboard.md | ExecutiveDashboard | NO — not in App.tsx | ARCHIVE_AS_OBSOLETE | Page file exists but is not routed. May have been replaced by BusinessOverview. |
| AUDIT-PipelineMatrix.md | PipelineMatrix | NO — not in App.tsx | ARCHIVE_AS_OBSOLETE | Page file exists but is not routed. May have been consolidated into ExecutionMatrix. |
| AUDIT-PipelineMonitor.md | PipelineMonitor | NO — not in App.tsx | ARCHIVE_AS_OBSOLETE | Page file exists but is not routed. Functionality may live in LiveMonitor or ExecutionMatrix. |

### 1.3 Special Files (1 file)

| File | Type | Disposition |
|------|------|------------|
| AUDIT-Stubs.md | Grouped stub audit | VERIFY_AND_EXTEND — check if stub surfaces are still stubs and whether any have been made real |
| SCHEMA_REFERENCE.txt | Reference data | KEEP — not an audit file |

---

## 2. Strategic Audits (`docs/superpowers/audits/`)

These 5 files are in a non-canonical location and must be normalized.

| Strategic Audit | Canonical Surface | Canonical Audit Exists? | Action |
|----------------|------------------|------------------------|--------|
| AUDIT-BusinessOverview.md | BP-OVER (`/overview`) | NO | **MIGRATE** — copy to `audits/AUDIT-BusinessOverview.md`, update to V2 format |
| AUDIT-ConfigManager.md | EC-CFG (`/config`) | YES (`audits/AUDIT-ConfigManager.md`) | **RECONCILE** — merge newer findings into canonical, mark strategic as superseded |
| AUDIT-EngineControl.md | EC-ENG (`/engine`) | YES (`audits/AUDIT-EngineControl.md`) | **RECONCILE** — merge newer findings into canonical, mark strategic as superseded |
| AUDIT-LoadCenter.md | EC-LC (`/load-center`) | NO | **MIGRATE** — copy to `audits/AUDIT-LoadCenter.md`, update to V2 format |
| AUDIT-SourceManager.md | EC-SRC (`/sources`) | YES (`audits/AUDIT-SourceManager.md`) | **RECONCILE** — merge newer findings into canonical, mark strategic as superseded |

### Migration Priority

1. **AUDIT-BusinessOverview.md** — HIGH (demo-critical page, no canonical audit)
2. **AUDIT-LoadCenter.md** — HIGH (demo-critical page, no canonical audit)
3. **AUDIT-EngineControl.md** — MEDIUM (canonical exists, reconcile)
4. **AUDIT-SourceManager.md** — MEDIUM (canonical exists, reconcile)
5. **AUDIT-ConfigManager.md** — MEDIUM (canonical exists, reconcile)

---

## 3. Support Documents

| Document | Location | Purpose | Status |
|---------|----------|---------|--------|
| WHOLE-APP-CENSUS.md | `docs/superpowers/` | Master census template | SUPERSEDED by manifest — keep as historical reference |
| PAGE-TRUTH-AUDIT-TEMPLATE.md | `docs/superpowers/` | Audit structure template | ACTIVE — V2 extends this format |
| DASHBOARD-CONSTITUTION.md | `docs/superpowers/` | Page governance framework | ACTIVE — referenced by V2 audit standards |
| data-source-audit.html | `docs/` | Canonical data source truth | ACTIVE — every audit must cross-check (V2 Rule 12.5) |
| audit-and-packet.md | `~/.claude/commands/` | Audit orchestration command | ACTIVE — V2 compatible |

---

## 4. Disposition Summary

| Disposition | Count | Files |
|------------|-------|-------|
| VERIFY_AND_EXTEND | 38 | Most canonical audits (see Section 1.1) |
| SUPERSEDE_AND_REPLACE | 3 | DataCatalog, DataClassification, ImpactAnalysis (all MOCK pages) |
| ARCHIVE_AS_OBSOLETE | 4 | AdminGovernance, ExecutiveDashboard, PipelineMatrix, PipelineMonitor |
| MIGRATE (from strategic) | 2 | BusinessOverview, LoadCenter |
| RECONCILE (strategic→canonical) | 3 | ConfigManager, EngineControl, SourceManager |
| NO_AUDIT (needs new) | 8 | BusinessAlerts, DatasetDetail, BusinessHelp, GoldClusters, GoldValidation, DataEstate, SchemaValidation, Labs (4) |

---

## 5. Action Items for Phase 1 Sessions

1. **Before auditing**: Check this mapping for the surface's disposition
2. **VERIFY_AND_EXTEND**: Read existing audit, verify findings still apply, add new findings with V2 format
3. **SUPERSEDE_AND_REPLACE**: Create new audit from scratch, explicitly name superseded file in header
4. **MIGRATE**: Copy strategic audit to canonical location, update to V2 format, add V2 sections
5. **RECONCILE**: Compare canonical vs strategic, merge unique findings, keep canonical as primary
6. **AUDIT_NORMALLY**: Create brand new audit in V2 format (no prior art exists)
7. **ARCHIVE_AS_OBSOLETE**: Add `[ARCHIVED]` prefix to audit header, add note pointing to manifest
