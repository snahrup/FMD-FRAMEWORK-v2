# Dashboard Census — Packet Map & Audit Coverage

> One inventory of what's been through the audit/packet workflow and what hasn't.
> Date: 2026-03-22 | Author: Steve Nahrup

---

## How to Read This

Every page/subsystem in the dashboard is listed below with one of three statuses:

| Status | Meaning |
|--------|---------|
| **PACKETIZED** | Has been through audit → triage → repair packet → implementation → PR → merge |
| **PARTIALLY** | Has audit doc OR partial repairs, but not fully through the workflow |
| **NOT YET** | No audit, no packet, no truth doc coverage |

"Packetized" means: there is a documented audit finding AND a repair packet that addressed it. The fix might not cover 100% of the page, but the systematic workflow was applied.

---

## Navigation Inventory (19 visible items + 6 portal items)

### Engineering Sidebar (19 items in 7 groups)

#### Overview Group
| # | Nav Label | Route | Page File | Audit Status | Packets | Notes |
|---|-----------|-------|-----------|-------------|---------|-------|
| 1 | Overview | `/overview` | BusinessOverview.tsx | **PACKETIZED** | RP-02 (KPIs), RP-03 (entity_status) | AUDIT-003 freshness fixed. AUDIT-005 loaded-vs-registered partially fixed. AUDIT-BusinessOverview.md exists — found additional bugs (activity panel status enum mismatch) still OPEN. |

#### Load Group
| # | Nav Label | Route | Page File | Audit Status | Packets | Notes |
|---|-----------|-------|-----------|-------------|---------|-------|
| 2 | Load Center | `/load-center` | LoadCenter.tsx | **PACKETIZED** | RP-01 (data source), RP-04 (incremental Δ), RP-05 (run state) | AUDIT-001, -002, -007, -008 all REPAIRED. AUDIT-006 (auto-refresh) P3 open. AUDIT-LoadCenter.md exists — found "Load Everything" button crash still OPEN. |
| 3 | Source Manager | `/sources` | SourceManager.tsx | **PARTIALLY** | RP-03 (entity_status dep removed) | AUDIT-SourceManager.md exists — found missing `/api/gateway-connections`, import phases 2-5 stubbed, analyze-source shape mismatch. No repair packet yet. |

#### Monitor Group
| # | Nav Label | Route | Page File | Audit Status | Packets | Notes |
|---|-----------|-------|-----------|-------------|---------|-------|
| 4 | Execution Matrix | `/matrix` | ExecutionMatrix.tsx | **PARTIALLY** | RP-03 (entity_status dep removed) | Status derivation fixed. No dedicated audit doc. No dedicated repair packet. |
| 5 | Error Intelligence | `/errors` | ErrorIntelligence.tsx | **NOT YET** | — | No audit, no packet. Reads engine_task_log directly (likely correct). |
| 6 | Execution Log | `/logs` | ExecutionLog.tsx | **NOT YET** | — | No audit, no packet. Reads pipeline execution tables. |

#### Explore Group
| # | Nav Label | Route | Page File | Audit Status | Packets | Notes |
|---|-----------|-------|-----------|-------------|---------|-------|
| 7 | SQL Explorer | `/sql-explorer` | SqlExplorer.tsx | **NOT YET** | — | Standalone tool. Reads on-prem + lakehouse SQL. |
| 8 | Data Blender | `/blender` | DataBlender.tsx | **NOT YET** | — | Standalone tool. Reads source tables for join analysis. |
| 9 | Data Lineage | `/lineage` | DataLineage.tsx | **NOT YET** | — | Column-level lineage visualization. |
| 10 | Data Catalog | `/catalog` | DataCatalog.tsx | **NOT YET** | — | Entity catalog browser. |
| 11 | Data Profiler | `/profile` | DataProfiler.tsx | **NOT YET** | — | Column profiling. |

#### Gold Studio Group
| # | Nav Label | Route | Page File | Audit Status | Packets | Notes |
|---|-----------|-------|-----------|-------------|---------|-------|
| 12 | Ledger | `/gold/ledger` | GoldLedger.tsx | **PARTIALLY** | RP-07 (honest labels — but ledger was already honest) | AUDIT-011 covers Gold Studio as a whole. Extraction is REAL (Packet G). No per-page audit doc. |
| 13 | Clusters | `/gold/clusters` | GoldClusters.tsx | **PACKETIZED** | RP-07 (honest labels) | AUDIT-011. Clustering is NAIVE (name-only, 80% hardcoded). Labels now honest. |
| 14 | Canonical | `/gold/canonical` | GoldCanonical.tsx | **PARTIALLY** | — | AUDIT-011 covers it. REAL functionality. No per-page audit. |
| 15 | Specifications | `/gold/specs` | GoldSpecs.tsx | **PARTIALLY** | — | AUDIT-011 covers it. REAL functionality. No per-page audit. |
| 16 | Validation | `/gold/validation` | GoldValidation.tsx | **PACKETIZED** | RP-07 (honest labels) | AUDIT-011. Validation is STRUCTURE-ONLY (3 checks). Labels now honest. |

#### Quality Group
| # | Nav Label | Route | Page File | Audit Status | Packets | Notes |
|---|-----------|-------|-----------|-------------|---------|-------|
| 17 | DQ Scorecard | `/labs/dq-scorecard` | DqScorecard.tsx | **NOT YET** | — | Labs page. |
| 18 | Cleansing Rules | `/labs/cleansing` | CleansingRuleEditor.tsx | **NOT YET** | — | Labs page. |
| 19 | SCD Audit | `/labs/scd-audit` | ScdAudit.tsx | **NOT YET** | — | Labs page. |

#### Admin Group
| # | Nav Label | Route | Page File | Audit Status | Packets | Notes |
|---|-----------|-------|-----------|-------------|---------|-------|
| 20 | Config Manager | `/config` | ConfigManager.tsx | **PARTIALLY** | — | AUDIT-ConfigManager.md exists — found missing GUID columns, cascade modal broken, deploy stub 501. No repair packet yet. |
| 21 | Environment Setup | `/setup` | EnvironmentSetup.tsx | **NOT YET** | — | Setup wizard. |
| 22 | Database Explorer | `/db-explorer` | DatabaseExplorer.tsx | **NOT YET** | — | Raw table browser on control plane DB. |
| 23 | Settings | `/settings` | Settings.tsx | **NOT YET** | — | App settings. |

### Business Portal Sidebar (6 items)
| # | Nav Label | Route | Page File | Audit Status | Packets | Notes |
|---|-----------|-------|-----------|-------------|---------|-------|
| 24 | Overview | `/overview` | BusinessOverview.tsx | **PACKETIZED** | (same as #1) | Shared page between engineering and portal. |
| 25 | Alerts | `/alerts` | BusinessAlerts.tsx | **NOT YET** | — | Reads engine_task_log. |
| 26 | Sources | `/sources-portal` | BusinessSources.tsx | **PARTIALLY** | RP-03 (entity_status dep removed) | No dedicated audit doc. |
| 27 | Catalog | `/catalog-portal` | BusinessCatalog.tsx | **PARTIALLY** | RP-03 (entity_status dep removed) | No dedicated audit doc. |
| 28 | Requests | `/requests` | BusinessRequests.tsx | **NOT YET** | — | Request management. |
| 29 | Help | `/help` | BusinessHelp.tsx | **NOT YET** | — | Help page. |

### Hidden Routes (not in nav, but routed in App.tsx)
| Route | Page File | Audit Status | Notes |
|-------|-----------|-------------|-------|
| `/engine` | EngineControl.tsx | **PARTIALLY** | AUDIT-EngineControl.md exists — ghost endpoint, type mismatches. No repair packet. |
| `/control` | ControlPlane.tsx | **NOT YET** | Removed from nav. |
| `/admin` | AdminGateway.tsx | **NOT YET** | Removed from nav. |
| `/flow` | FlowExplorer.tsx | **NOT YET** | Removed from nav. |
| `/counts` | RecordCounts.tsx | **NOT YET** | Removed from nav. |
| `/journey` | DataJourney.tsx | **NOT YET** | Removed from nav. |
| `/notebook-config` | NotebookConfig.tsx | **NOT YET** | Removed from nav. |
| `/runner` | PipelineRunner.tsx | **NOT YET** | Removed from nav. |
| `/validation` | ValidationChecklist.tsx | **NOT YET** | Removed from nav. |
| `/notebook-debug` | NotebookDebug.tsx | **NOT YET** | Removed from nav. |
| `/live` | LiveMonitor.tsx | **NOT YET** | Removed from nav. |
| `/load-progress` | LoadProgress.tsx | **NOT YET** | Removed from nav. |
| `/columns` | ColumnEvolution.tsx | **NOT YET** | Removed from nav. |
| `/microscope` | DataMicroscope.tsx | **NOT YET** | Removed from nav. |
| `/sankey` | SankeyFlow.tsx | **NOT YET** | Removed from nav. |
| `/replay` | TransformationReplay.tsx | **NOT YET** | Removed from nav. |
| `/pulse` | ImpactPulse.tsx | **NOT YET** | Removed from nav. |
| `/test-audit` | TestAudit.tsx | **NOT YET** | Dev tooling. |
| `/test-swarm` | TestSwarm.tsx | **NOT YET** | Dev tooling. |
| `/mri` | MRI.tsx | **NOT YET** | Dev tooling. |
| `/labs/gold-mlv` | GoldMlvManager.tsx | **NOT YET** | Already labeled "Coming Soon" / "Labs". |
| `/catalog-portal/:id` | DatasetDetail.tsx | **NOT YET** | Detail page for catalog entries. |
| `/impact` | ImpactAnalysis.tsx | **NOT YET** | Removed from nav. |
| `/classification` | DataClassification.tsx | **NOT YET** | Removed from nav. |

---

## Coverage Summary

| Category | Count | Packetized | Partially | Not Yet |
|----------|-------|-----------|-----------|---------|
| **Nav-visible pages** | 29 | 4 | 8 | 17 |
| **Hidden routes** | 24 | 0 | 1 | 23 |
| **Total** | 53 | **4 (8%)** | **9 (17%)** | **40 (75%)** |

### Packetized (4)
1. Overview (RP-02, RP-03)
2. Load Center (RP-01, RP-04, RP-05)
3. Gold Clusters (RP-07)
4. Gold Validation (RP-07)

### Partially Covered (9)
5. Source Manager — has audit doc, no repair packet
6. Execution Matrix — entity_status removed, no audit doc
7. Gold Ledger — AUDIT-011 covers it
8. Gold Canonical — AUDIT-011 covers it
9. Gold Specifications — AUDIT-011 covers it
10. Config Manager — has audit doc, no repair packet
11. Engine Control — has audit doc, no repair packet
12. Business Sources — entity_status removed, no audit doc
13. Business Catalog — entity_status removed, no audit doc

### Not Yet (40)
Everything else — error intelligence, execution log, SQL explorer, data blender, data lineage, data catalog, data profiler, all quality/labs pages, all admin pages except config manager, all business portal pages except overview, all 24 hidden routes.

---

## Existing Truth Docs & Packets

### Foundation Documents (4)
| Doc | What It Covers |
|-----|---------------|
| FMD_DATA_BIBLE.md | Data flow, storage layers, authoritative tables |
| FMD_DATA_REGISTRY.yaml | Machine-readable page → endpoint → table map |
| FMD_METRIC_DEFINITIONS.md | KPI formulas and sources |
| FMD_PIPELINE_TRUTH_AUDIT.md | 14 AUDIT entries (mismatch ledger) |

### Decision Records (12)
D-001 through D-012 in FMD_DECISIONS_LOG.md

### Repair Packets (9)
RP-01 through RP-07 (with RP-06B and RP-06C as sub-packets)

### Page Audit Docs (5)
AUDIT-BusinessOverview.md, AUDIT-LoadCenter.md, AUDIT-EngineControl.md, AUDIT-ConfigManager.md, AUDIT-SourceManager.md

---

## Recommended Next-Priority Subsystems

Based on: user-facing visibility, data correctness risk, and existing audit findings.

### Tier 1 — Has audit doc with known open bugs (repair packet needed)
| Priority | Page | Why | Existing Audit |
|----------|------|-----|----------------|
| **1** | Source Manager | Missing backend endpoint, import phases stubbed, shape mismatch. Users hit this early in onboarding flow. | AUDIT-SourceManager.md |
| **2** | Engine Control | Ghost endpoint polled every 15s (404 noise), type mismatches in last_run. Users monitor runs here. | AUDIT-EngineControl.md |
| **3** | Config Manager | Pipeline GUIDs blank, cascade modal broken, deploy stub 501. Admin-facing but misleading. | AUDIT-ConfigManager.md |

### Tier 2 — Nav-visible, no audit yet, likely data-correctness risk
| Priority | Page | Why |
|----------|------|-----|
| **4** | Error Intelligence | Reads engine_task_log directly — probably correct, but unaudited. Users go here to diagnose failures. |
| **5** | Execution Log | Shows pipeline/copy/notebook execution history. Unaudited. |
| **6** | Business Alerts | Reads engine_task_log. Status enum mapping not verified (same bug class as Overview activity panel). |
| **7** | Business Sources | entity_status removed (RP-03) but no dedicated audit. |
| **8** | Business Catalog | entity_status removed (RP-03) but no dedicated audit. |

### Tier 3 — Nav-visible tools (lower data-correctness risk)
| Priority | Page | Why |
|----------|------|-----|
| **9** | SQL Explorer | Standalone tool, lower risk of data misrepresentation. |
| **10** | Data Blender | Standalone tool. |
| **11-13** | Quality/Labs pages | DQ Scorecard, Cleansing Rules, SCD Audit — likely early-stage. |

### Tier 4 — Hidden routes
Low priority unless re-added to nav. 24 pages removed from navigation — routes kept alive but users don't see them.

---

## Open Bugs From Existing Audits (Not Yet Packetized)

These were found during page audits but never got a repair packet:

| Source | Bug | Severity |
|--------|-----|----------|
| AUDIT-BusinessOverview | Activity panel status enum mismatch ("loaded" vs "success"/"error") | P2 |
| AUDIT-LoadCenter | "Load Everything" + "Preview Run" buttons crash (`_build_source_lookup` undefined) | P1 |
| AUDIT-EngineControl | Ghost endpoint `/api/engine/jobs` polled every 15s, always 404 | P2 |
| AUDIT-EngineControl | Type mismatches in `last_run` + `layers` response fields | P2 |
| AUDIT-ConfigManager | Pipeline GUID columns blank (missing in SELECT) | P2 |
| AUDIT-ConfigManager | Cascade modal never triggers (`refData.count` undefined) | P2 |
| AUDIT-ConfigManager | Deploy endpoint returns 501 | P3 |
| AUDIT-SourceManager | `/api/gateway-connections` has no backend route | P1 |
| AUDIT-SourceManager | `/api/analyze-source` returns wrong object structure | P2 |
| AUDIT-SourceManager | Import phases 2-5 stubbed | P2 |
| AUDIT-011 | Schema discovery is stubbed (backend-only, no UI exposure) | P3 |
| AUDIT-011 | Clustering is naive (name-only matching) | P3 |
| AUDIT-006 | lakehouse_row_counts never auto-populated | P3 |
