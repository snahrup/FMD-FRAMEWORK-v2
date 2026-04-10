# 2026-04-09 Dashboard Single-App Modernization Program

## Objective
Gold Studio proved the right pattern for this product:

- assume the user has zero context
- explain what the page is, why it matters, and what happens next
- make background work feel alive instead of broken
- present the workflow as a lifecycle, not a pile of tabs
- use one visual system, not page-by-page improvisation

This document applies that same approach across the rest of the dashboard so FMD reads as a single operating system instead of isolated experiences.

## Inputs
- primary domain context: `C:\Users\snahrup\CascadeProjects\fabric_toolbox\knowledge`
- secondary application context: [knowledge](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/knowledge)
- [2026-04-09-gold-studio-flow-audit.md](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/docs/superpowers/audits/2026-04-09-gold-studio-flow-audit.md)
- [2026-04-09-gold-studio-redesign-brief.md](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/docs/superpowers/specs/2026-04-09-gold-studio-redesign-brief.md)
- [2026-04-09-gold-studio-redesign-implementation-plan.md](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/docs/superpowers/plans/2026-04-09-gold-studio-redesign-implementation-plan.md)
- [system.md](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/.interface-design/system.md)
- local `modernize` skill guidance at `C:\Users\snahrup\.claude\skills\modernize\SKILL.md`
- local `interface-design` skill guidance at `C:\Users\snahrup\.claude\skills\interface-design\SKILL.md`
- current route and page inventory from [App.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/App.tsx) and [AppLayout.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/components/layout/AppLayout.tsx)

## Context Priority
Use context in this order when making product and UX decisions:

1. `C:\Users\snahrup\CascadeProjects\fabric_toolbox\knowledge`
   This is the broader IP Corp and Fabric engagement knowledge base. It contains the master business/domain context, systems landscape, company structure, data flows, glossary, learnings, and Power BI inventory.
2. Repo-local [knowledge](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/knowledge)
   This is mostly FMD-platform context: audits, implementation notes, migration notes, UX captures, and application-specific findings.
3. Current codebase behavior and route inventory
4. External official documentation and category research

Do not confuse the repo-local `knowledge/` directory with the broader IP Corp source of truth. Use the `fabric_toolbox` knowledge base for business, systems, and organizational context.

## Research Standard
Every major destination redesign should be backed by current feature and interaction research before implementation starts.

The rule is:

- do not redesign from taste alone
- do not modernize a page without understanding the best current feature patterns for that job
- do not copy other products blindly; extract the pattern, then adapt it to FMD
- prefer official platform and product documentation first, then category references

This research standard does not authorize a visual reset by default. The current FMD aesthetic is a strength and should be preserved unless there is a specific reason to change a visual behavior.

### Source priority
1. Official Microsoft Fabric and Power BI documentation for platform-native behavior
2. Official Microsoft Purview documentation for lineage, impact, and asset traceability
3. Official OpenMetadata documentation for lineage, graph, and stewardship interaction patterns
4. Official dbt documentation and product docs for catalog, semantic, and analytics workflow patterns
5. Internal FMD product truth, existing capabilities, and the Gold Studio reference design

### Integration-first research rule
If a future capability depends on an external system, that integration must be researched before the page structure is finalized.

This matters especially for:

- Microsoft Purview
- Salesforce
- future semantic-model and governance connectors

### What “cutting edge” means here
It does not mean trendy for its own sake.

It means:

- current platform-aware interaction models
- strong semantic-model and lineage awareness
- explicit impact analysis and discoverability patterns
- guided async and recovery UX
- fewer, more capable destinations instead of thin page sprawl
- coherent cross-page primitives that feel technologically current and operationally trustworthy

It also means domain fidelity:

- terminology should respect IP Corp language and sensitivities
- page logic should reflect actual source-system realities
- workflows should mirror the real migration path from fragmented reporting to governed Fabric semantic models
- the product should look like it belongs to a manufacturing conglomerate modernizing into Fabric, not a generic SaaS admin kit

## Current External Reference Set
These are the baseline references already informing this program.

- Microsoft Fabric medallion architecture:
  https://learn.microsoft.com/en-us/fabric/onelake/onelake-medallion-lakehouse-architecture
- Power BI Model view:
  https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-relationship-view
- Power BI Model explorer:
  https://learn.microsoft.com/en-us/power-bi/transform-model/model-explorer
- Power BI semantic model impact analysis:
  https://learn.microsoft.com/en-us/power-bi/collaborate-share/service-dataset-impact-analysis
- Power BI semantic model discoverability:
  https://learn.microsoft.com/en-us/power-bi/collaborate-share/service-discovery
- Power BI XMLA connectivity and semantic model management:
  https://learn.microsoft.com/en-us/power-bi/enterprise/service-premium-connect-tools
- Microsoft Purview lineage for Power BI:
  https://learn.microsoft.com/en-us/purview/data-map-lineage-power-bi
- Microsoft Purview Power BI and Fabric scanning:
  https://learn.microsoft.com/en-us/purview/register-scan-power-bi-tenant
- Microsoft Purview Salesforce scanning:
  https://learn.microsoft.com/en-us/purview/register-scan-salesforce
- OpenMetadata lineage graph and lineage API:
  https://docs.open-metadata.org/how-to-guides/data-lineage/explore
  https://docs.open-metadata.org/v1.12.x/api-reference/lineage/index
- dbt Catalog and Semantic Layer:
  https://www.getdbt.com/product/dbt-catalog
  https://docs.getdbt.com/
- Power Query Salesforce connectors:
  https://learn.microsoft.com/en-us/power-query/connectors/salesforce-objects
  https://learn.microsoft.com/en-us/power-query/connectors/salesforce-reports
- Microsoft Fabric Salesforce connectors:
  https://learn.microsoft.com/en-us/fabric/data-factory/connector-salesforce-objects-overview
  https://learn.microsoft.com/en-us/fabric/data-factory/connector-salesforce-copy-activity

## Research Tracks By Destination

### Overview
Research:
- operational overview patterns
- discoverability and trusted asset patterns
- what summary metrics actually drive a next action

### Pipeline Operations
Research:
- current run-control and async status patterns
- impact of stop, retry, resume, and preserved-work messaging
- live timeline and milestone UX

### Monitor and Recovery
Research:
- incident triage patterns
- recovery guidance and anomaly surfacing
- matrix, logs, and counts coexistence without page fragmentation

### Data Stewardship
Research:
- catalog browsing
- lineage and dependency exploration
- ownership and governance presentation
- asset discoverability and trust signaling

### Investigation Workbench
Research:
- expert workbench layouts
- evidence review patterns
- query/result/lineage/replay interaction models

### Quality Studio
Research:
- readiness gates
- rule editor interaction
- validation evidence presentation
- scorecard and audit storytelling

### Gold Studio
Research:
- semantic model composition
- model view and explorer patterns
- downstream impact analysis
- coverage and lineage mapping

### Business Portal
Research:
- discoverable trusted data-product patterns
- low-context help and request flows
- explainability patterns for non-technical consumers

### Platform Admin
Research:
- setup wizard patterns
- admin preflight and post-action receipts
- runtime diagnostics presentation without overwhelming the operator

## Integration Mandates

### Microsoft Purview
Purview should be treated as a first-class metadata and governance spine, not a side panel.

Implications:

- `Data Stewardship` should have a clear Purview-aware catalog, ownership, and lineage mode
- `Gold Studio` should be able to reference Purview lineage and impact context during release review
- `Business Portal` should eventually benefit from the same trusted metadata and asset discoverability
- FMD should expose what lineage is automatic versus what lineage is inferred or manually supplemented

Important current constraints from official Microsoft documentation:

- Purview can scan Fabric and Power BI metadata and lineage, including workspaces, dashboards, reports, datasets, dataflows, and datamarts
- Purview can register and scan Salesforce metadata, including objects and fields
- Power BI external lineage support in Purview is not universal; documented support is limited for certain external source types, and column-level transformation visibility is narrower still

Design implication:
- do not design the UI as if Purview gives perfect end-to-end lineage for every source
- design for visible trust levels: `native lineage`, `partial lineage`, `manual linkage`, `not yet mapped`

### Salesforce
Salesforce should be treated as a first-class upstream source pattern, not a one-off connector.

Implications:

- `Pipeline Operations` must support clearly scoped Salesforce ingestion choices where relevant
- `Data Stewardship` must model Salesforce objects, fields, and relationships in a way that feels native
- `Gold Studio` should treat imported Salesforce reporting and object evidence as valid input to semantic-model coverage design
- source-specific limitations such as API versioning, concurrency, and object/report connector differences must be made visible to operators

Important current constraints from official Microsoft documentation:

- Microsoft Fabric Data Factory currently supports Salesforce objects and copy-activity patterns
- Power Query and Power BI support Salesforce object connectivity with API-version requirements and connector-specific limitations
- Salesforce reports connectivity exists, but support differs by host experience and is not equivalent to object ingestion everywhere

Design implication:
- model Salesforce ingestion as a source family with explicit sub-modes like `Objects`, `Reports`, and `Imported Artifacts`
- do not collapse all Salesforce interactions into one generic connector screen

## Product Thesis
FMD is not a collection of dashboards. It is a data operating workbench.

It is not a blank-slate rebrand. The current visual language already has strong raw materials:

- the fonts work
- the warm neutral and copper color world works
- the motion language works

The modernization goal is to preserve that aesthetic while making the product feel far more deliberate, coherent, and specific to IP Corporation.

The product should teach a user to think in this sequence:

1. `Orient` to the estate and what needs attention.
2. `Launch` or control movement through the pipeline.
3. `Observe` what is running and whether it is healthy.
4. `Diagnose` issues, dependencies, and data behavior.
5. `Shape` quality, rules, and domain semantics.
6. `Publish` a governed gold model.
7. `Serve` that model to reports and downstream consumers.
8. `Administer` the platform and its setup.

Every page should map clearly to one of those verbs.

## Non-Negotiable User Assumption
Assume the end user does not know what is happening.

That means:

- the UI cannot rely on pipeline jargon, implicit state, or insider mental models
- the user should never have to infer whether something is running, stalled, saved, resumable, or broken
- if work continues in the background, the UI must narrate that work in plain language
- if a page exists, it must be obvious how it fits into the larger objective
- if a distinction between pages is too subtle to explain quickly, those pages should probably be merged

At the same time, the UI should reflect IP Corporation's real operating context from the repo knowledge base, including:

- multi-company manufacturing operations
- M3 as the system of record
- MES, ANV, and OATES manufacturing traceability
- Batch ID as the universal cross-system key
- Fabric medallion migration and Purview governance goals
- company-isolation constraints, especially around financial visibility

## Single-App UX Contract

### 1. Every page explains itself in plain English
Every page must answer all three before any dense content:

- `What this page is`
- `Why it matters`
- `What happens next`

This is the Gold Studio rule that now applies everywhere.

### 2. Background work must never look broken
Any page that can launch, poll, stream, import, validate, publish, replay, or scan must show:

- current state
- last update time
- latest milestone reached
- next expected change
- whether user action is required
- what is preserved if the process is stopped or fails

The user should not need to know what thread, worker, notebook, engine, stream, or poller is involved. The product should translate technical state into human state.

### 3. Shared structural spine across the app
Every major page should converge on the same layout grammar:

- `Intent header`: title, plain-language purpose, scope, and why it matters
- `Action rail`: primary CTA, secondary actions, scoped actions
- `Tiered KPI strip`: 2-3 hero metrics plus supporting metrics
- `Recent activity strip`: latest notable changes with timestamps
- `Main workspace`: tables, canvases, flows, or editors
- `Right rail or lower evidence zone`: receipts, warnings, blockers, lineage, impact

### 4. Shared state language
The same state words should mean the same thing everywhere:

- `Idle`
- `Running`
- `Waiting`
- `Needs Attention`
- `Interrupted`
- `Failed`
- `Completed`
- `Published`
- `Deprecated`

Status copy, badge colors, and receipt patterns must be reused, not reinvented.

### 5. One visual and motion language
Use the existing design system and the modernization rules consistently:

- warm industrial paper surfaces
- borders-only depth
- status rails on important rows, cards, and panels
- tiered KPIs instead of flat stat rows
- upgraded tab bars
- staggered entrance on cards and rows
- consistent modal treatment
- clear empty states with a next step

### 6. Navigation teaches the workflow
Navigation must feel like movement through one product, not multiple products bolted together. The labels and page titles should reinforce the verbs above instead of generic nouns whenever possible.

### 7. Business and engineering views share the same truth
Business pages can be simpler and more narrative, but they cannot drift away from engineering truth. Metrics, status, coverage, and lineage must reconcile to the same underlying state.

## Shared Primitives To Build Once
These should become reusable components and patterns for the entire app.

### Structural primitives
- `PageIntentHeader`
- `NextBestActionPanel`
- `RecentActivityStrip`
- `SectionPurposeBar`
- `EvidenceRail`
- `ReceiptStack`

### Async and operational primitives
- `BackgroundTaskBanner`
- `MilestoneTimeline`
- `ActionReceipt`
- `FailureReceipt`
- `PartialSuccessReceipt`
- `StalenessBadge`

### Visualization primitives
- `TieredKpiStrip`
- `StatusRailTable`
- `StatusRailCardList`
- `StandardTabBar`
- `GuidedEmptyState`
- `ImpactDrawer`

### Copy and trust primitives
- `WhatThisMeans`
- `WhyThisMatters`
- `WhatHappensNext`
- `WhatWasPreserved`

## Consolidation Principle
Do not preserve page count just because pages already exist.

If multiple pages are answering adjacent questions for the same job, merge them into one destination with tabs, modes, drawers, or detail panels.

Preferred pattern:

- fewer top-level destinations
- clearer job ownership per destination
- subviews inside the destination for specialized depth
- drill-ins for detail, not new first-class pages unless the job is genuinely different

## Functional Preservation Rule
No page is removed unless its functionality is explicitly re-homed.

For every merge or demotion:

- define the target destination
- define the target tab, mode, panel, or drill-in
- list the capabilities being preserved
- keep deep-link access through redirects where practical
- preserve the same underlying data truth and action scope
- document what becomes easier for the user after the merge

If a page exists today for a real job, that job must still exist afterward. The goal is fewer surfaces, not less capability.

## Rewrite Rule
If a page is structurally wrong, a full rewrite is allowed and preferred.

That means we do not need to preserve:

- the current layout
- the current component structure
- the current navigation label
- the current page boundary

We do need to preserve:

- the user job
- the capability set
- the underlying truth and action scope
- the discoverability of the function afterward

In practice:
- if modernization can rescue the page, modernize it
- if the page boundary itself is the problem, merge it
- if the page concept is correct but the implementation is broken, rewrite it from scratch

## Proposed Top-Level Destination Model
This is the target information architecture after consolidation.

### 1. Overview
Owns:
- estate health
- business summary
- immediate priorities
- latest important changes

Absorbs or aligns:
- `BusinessOverview`
- `DataEstate`
- `ExecutiveDashboard`

### 2. Pipeline Operations
Owns:
- launching runs
- scoping sources and layers
- live mission control
- stop, retry, and resume semantics

Absorbs or aligns:
- `LoadCenter`
- `LoadMissionControl`
- `PipelineRunner`
- `EngineControl`
- `LoadProgress`
- `ControlPlane`

Target shape:
- `Launch`
- `Live Run`
- `History`
- `Recovery`

### 3. Monitor and Recovery
Owns:
- health monitoring
- failures
- logs
- run anomalies
- operational triage

Absorbs or aligns:
- `ExecutionMatrix`
- `PipelineMatrix`
- `PipelineMonitor`
- `ErrorIntelligence`
- `ExecutionLog`
- `LiveMonitor`
- `RecordCounts`
- `ImpactPulse`

Target shape:
- `Health`
- `Failures`
- `Logs`
- `Counts`
- `Impact`

### 4. Data Stewardship
Owns:
- sources
- catalog
- lineage
- classifications
- managed metadata and configuration

Absorbs or aligns:
- `SourceManager`
- `DataCatalog`
- `DataClassification`
- `DataLineage`
- `DataManager`
- `DatabaseExplorer`
- `ConfigManager`

Target shape:
- `Sources`
- `Catalog`
- `Lineage`
- `Governance`
- `Configuration`

### 5. Investigation Workbench
Owns:
- SQL investigation
- profiling
- replay
- transformation tracing
- flow and impact analysis

Absorbs or aligns:
- `SqlExplorer`
- `DataBlender`
- `DataProfiler`
- `DataMicroscope`
- `ColumnEvolution`
- `SankeyFlow`
- `TransformationReplay`
- `FlowExplorer`
- `DataJourney`
- `ImpactAnalysis`

Target shape:
- `Query`
- `Profile`
- `Trace`
- `Replay`
- `Impact`

### 6. Quality Studio
Owns:
- validation
- scorecards
- cleansing rules
- SCD audits
- readiness to publish

Absorbs or aligns:
- `SchemaValidation`
- `ValidationChecklist`
- `DqScorecard`
- `CleansingRuleEditor`
- `ScdAudit`

Target shape:
- `Readiness`
- `Validation`
- `Rules`
- `Audit`

### 7. Gold Studio
Owns:
- intake to release lifecycle
- proposed semantic model
- coverage map
- serve/publish handoff

Absorbs or aligns:
- existing Gold Studio pages as already designed

### 8. Business Portal
Owns:
- trusted outputs
- request flows
- business-facing alerts
- consumer help

Absorbs or aligns:
- `BusinessAlerts`
- `BusinessSources`
- `BusinessCatalog`
- `DatasetDetail`
- `BusinessRequests`
- `BusinessHelp`

Target shape:
- `Home`
- `Catalog`
- `Requests`
- `Help`

Notes:
- alerts should become a section or rail, not necessarily a top-level page
- source views should likely be catalog drill-ins, not separate first-class destinations

### 9. Platform Admin
Owns:
- setup
- deployment
- notebook tooling
- system settings
- operational administration

Absorbs or aligns:
- `AdminGateway`
- `AdminGovernance`
- `Settings`
- `EnvironmentSetup`
- `NotebookConfig`
- `NotebookDebug`
- setup and settings subpages

Target shape:
- `Setup`
- `Deploy`
- `Runtime`
- `Settings`

### 10. Internal
Owns:
- engineering-only experimental and test utilities

Absorbs or aligns:
- `MRI`
- `TestAudit`
- `TestSwarm`

Notes:
- keep out of normal product navigation unless explicitly enabled

## Zero-Context Questions Every Destination Must Answer

### Overview
- What is the state of the platform right now?
- What changed since the last time I looked?
- What do I need to do first?

### Pipeline Operations
- What exactly am I about to run?
- What is running right now?
- Is it healthy, blocked, or failed?
- If I stop or resume, what happens to work already completed?

### Monitor and Recovery
- What is the problem?
- How bad is it?
- Where did it start?
- What is the next best recovery action?

### Data Stewardship
- What is this source or object?
- Who owns it?
- What depends on it?
- If I change it, what else is affected?

### Investigation Workbench
- What question am I trying to answer?
- What evidence do I have?
- Is that evidence live, cached, or partial?
- What conclusion should I draw?

### Quality Studio
- Is this data ready to publish?
- What is failing validation?
- What rules are applied?
- What risk remains if I move forward?

### Gold Studio
- What does the domain model need to contain?
- What imported evidence supports that?
- What is missing, conflicting, or deprecated?
- Is this ready to publish and serve?

### Business Portal
- What data product can I trust?
- What does it mean?
- If something is wrong or missing, how do I request change?

### Platform Admin
- What system setting am I changing?
- What does it affect?
- Is the platform healthy enough to proceed?
- What happened after I made the change?

## Capability Preservation Checklist

### Overview must preserve
- business summary
- estate health
- latest major changes
- immediate priorities
- jump-off actions into pipeline operations, monitoring, and investigation

### Pipeline Operations must preserve
- source and layer scoping
- run launch
- live progress
- stop, abort, retry, and resume
- entity and run history drill-ins
- advanced engine/runtime controls

### Monitor and Recovery must preserve
- health matrix views
- error triage
- raw and live logs
- throughput and counts
- anomaly and impact views
- recommended recovery actions

### Data Stewardship must preserve
- source onboarding and editing
- catalog browsing
- lineage views
- classifications and governance state
- technical database exploration
- managed metadata/configuration changes

### Investigation Workbench must preserve
- SQL execution and result review
- profiling
- deep record or column inspection
- transformation replay
- flow visualization
- impact analysis
- narrative journey or trace views

### Quality Studio must preserve
- validation status
- readiness checklist
- DQ scoring
- cleansing rule editing
- SCD audit evidence
- bridge to Gold Studio release readiness

### Gold Studio must preserve
- full intake-to-serve lifecycle
- coverage mapping
- proposed semantic model
- release review and waivers
- publish and serve handoff

### Business Portal must preserve
- trusted dataset browsing
- dataset details
- alerts
- request creation and status
- end-user help and definitions

### Platform Admin must preserve
- setup and provisioning
- deployment management
- runtime logs and progress
- notebook configuration and debugging
- preflight and post-action summaries
- resumable or recoverable admin flows where applicable

## Modernization Groups

### Group 1: Orientation and Operating Picture
Mission: answer `where are we`, `what changed`, and `what needs action now`.

Pages:
- `/overview` → [BusinessOverview.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/BusinessOverview.tsx)
- `/estate` → [DataEstate.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/DataEstate.tsx)
- unrouted / future overview surface → [ExecutiveDashboard.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/ExecutiveDashboard.tsx)

Shared treatment:
- hero KPI strip with clear operational narrative
- cross-app activity stream
- direct CTA into launch, monitor, or investigate
- explicit explanation of how estate health maps to the rest of the product

Why these belong together:
- they are the arrival and re-orientation surfaces
- they define trust before users enter deeper workflow pages

### Group 2: Launch and Mission Control
Mission: start, scope, stop, resume, and understand pipeline execution.

Pages:
- `/load-center` → [LoadCenter.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/LoadCenter.tsx)
- `/load-mission-control` → [LoadMissionControl.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/LoadMissionControl.tsx)
- `/runner` → [PipelineRunner.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/PipelineRunner.tsx)
- `/engine` → [EngineControl.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/EngineControl.tsx)
- `/load-progress` → [LoadProgress.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/LoadProgress.tsx)
- `/control` → [ControlPlane.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/ControlPlane.tsx)

Shared treatment:
- plain-language run setup and scope summary
- one consistent run-state banner and action model
- milestone timeline that always shows where the job is now
- explicit preserved-work messaging for stop, retry, and resume
- tiered KPIs focused on throughput, failures, and blocking state

Why these belong together:
- they are all launch/control surfaces for the same underlying engine
- splitting them stylistically makes pipeline operations feel unreliable
- they are prime consolidation candidates and should likely end as one destination

### Group 3: Monitoring and Recovery
Mission: tell operators what is healthy, what is failing, and what to do next.

Pages:
- `/matrix` → [ExecutionMatrix.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/ExecutionMatrix.tsx)
- unrouted monitor surface → [PipelineMatrix.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/PipelineMatrix.tsx)
- unrouted monitor surface → [PipelineMonitor.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/PipelineMonitor.tsx)
- `/errors` → [ErrorIntelligence.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/ErrorIntelligence.tsx)
- `/logs` → [ExecutionLog.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/ExecutionLog.tsx)
- `/live` → [LiveMonitor.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/LiveMonitor.tsx)
- `/counts` → [RecordCounts.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/RecordCounts.tsx)
- `/pulse` → [ImpactPulse.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/ImpactPulse.tsx)

Shared treatment:
- status-first KPI strip
- consistent incident, warning, and recovery receipts
- one common filter language for run, source, entity, layer, and severity
- tables and logs that feel connected rather than standalone tools
- right rail for latest blocker, likely cause, and recommended next action

Why these belong together:
- they are all operational recovery pages
- users should be able to move from symptom to evidence to action without relearning the UI
- they should converge into one monitoring destination instead of many loosely related pages

### Group 4: Source and Metadata Stewardship
Mission: manage source systems, metadata, catalog truth, and core governance objects.

Pages:
- `/sources` → [SourceManager.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/SourceManager.tsx)
- `/catalog` → [DataCatalog.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/DataCatalog.tsx)
- `/classification` → [DataClassification.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/DataClassification.tsx)
- `/lineage` → [DataLineage.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/DataLineage.tsx)
- `/data-manager` → [DataManager.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/DataManager.tsx)
- `/db-explorer` → [DatabaseExplorer.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/DatabaseExplorer.tsx)
- `/config` → [ConfigManager.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/ConfigManager.tsx)

Shared treatment:
- stewardship header that explains object ownership and downstream impact
- consistent side panel for lineage, usage, health, and last refreshed state
- reusable metadata cards and entity tables
- stronger explanation of how these pages feed load, quality, and gold workflows

Why these belong together:
- they define the system of record for sources and metadata
- they should feel like one stewardship workspace
- many of these can become subviews inside a smaller number of destinations

### Group 5: Investigation and Analysis Workbench
Mission: inspect data, reproduce behavior, trace transformations, and explain anomalies.

Pages:
- `/sql-explorer` → [SqlExplorer.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/SqlExplorer.tsx)
- `/blender` → [DataBlender.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/DataBlender.tsx)
- `/profile` → [DataProfiler.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/DataProfiler.tsx)
- `/microscope` → [DataMicroscope.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/DataMicroscope.tsx)
- `/columns` → [ColumnEvolution.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/ColumnEvolution.tsx)
- `/sankey` → [SankeyFlow.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/SankeyFlow.tsx)
- `/replay` → [TransformationReplay.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/TransformationReplay.tsx)
- `/flow` → [FlowExplorer.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/FlowExplorer.tsx)
- `/journey` → [DataJourney.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/DataJourney.tsx)
- `/impact` → [ImpactAnalysis.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/ImpactAnalysis.tsx)

Shared treatment:
- common investigation workspace layout
- evidence-forward UI with query/result/detail split panels
- explicit `question -> evidence -> conclusion` flow
- reusable impact drawer and lineage evidence patterns
- result states that explain whether evidence is live, cached, partial, or stale

Why these belong together:
- they are diagnostic and analytical surfaces
- they should feel like one expert workbench with shared evidence patterns
- this is one of the biggest opportunities to reduce page count

### Group 6: Quality and Rule Operations
Mission: validate, score, remediate, and audit data behavior before publication.

Pages:
- `/schema-validation` → [SchemaValidation.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/SchemaValidation.tsx)
- `/validation` → [ValidationChecklist.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/ValidationChecklist.tsx)
- `/labs/dq-scorecard` → [DqScorecard.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/DqScorecard.tsx)
- `/labs/cleansing` → [CleansingRuleEditor.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/CleansingRuleEditor.tsx)
- `/labs/scd-audit` → [ScdAudit.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/ScdAudit.tsx)

Shared treatment:
- readiness framing instead of isolated rule editors
- explicit rule impact and preserved-data messaging
- tiered score and validation KPIs
- consistent audit receipts and drift history views
- clear bridge to Gold Studio `Release`

Why these belong together:
- they govern whether data is trustworthy enough to publish
- they should feel like one quality gate, not separate labs

### Group 7: Gold Studio Lifecycle
Mission: turn imported evidence into a governed domain semantic model.

Pages:
- `/gold/intake` → [GoldLedger.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/gold/GoldLedger.tsx)
- `/gold/cluster` → [GoldClusters.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/gold/GoldClusters.tsx)
- `/gold/canonical` → [GoldCanonical.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/gold/GoldCanonical.tsx)
- `/gold/spec` → [GoldSpecs.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/gold/GoldSpecs.tsx)
- `/gold/release` → [GoldValidation.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/gold/GoldValidation.tsx)
- `/gold/serve` → [GoldMlvManager.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/GoldMlvManager.tsx)

Shared treatment:
- already the reference implementation for the rest of the app
- lifecycle stage rail
- novice-first page framing
- background work and review state that feel trustworthy

Why this matters:
- Gold Studio is the template the rest of the dashboard should inherit

### Group 8: Business Consumption and Requests
Mission: let non-technical users see trusted outputs, understand them, and ask for change.

Pages:
- `/alerts` → [BusinessAlerts.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/business/BusinessAlerts.tsx)
- `/sources-portal` → [BusinessSources.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/business/BusinessSources.tsx)
- `/catalog-portal` → [BusinessCatalog.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/business/BusinessCatalog.tsx)
- `/catalog-portal/:id` → [DatasetDetail.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/business/DatasetDetail.tsx)
- `/requests` → [BusinessRequests.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/business/BusinessRequests.tsx)
- `/help` → [BusinessHelp.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/business/BusinessHelp.tsx)

Shared treatment:
- narrative and guidance-heavy framing
- lower density, clearer definitions, stronger `what this means`
- same status truth as engineering views
- request flows that explicitly show what happens after submission

Why these belong together:
- they are the business-facing consumption layer
- they should feel like a simplified front door to the same platform
- this area should be simplified aggressively so business users are not navigating tool sprawl

### Group 9: Platform Setup and Runtime Administration
Mission: configure, provision, secure, and maintain the platform.

Pages:
- `/admin` → [AdminGateway.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/AdminGateway.tsx)
- unrouted admin surface → [AdminGovernance.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/AdminGovernance.tsx)
- `/settings` → [Settings.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/Settings.tsx)
- `/setup` → [EnvironmentSetup.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/EnvironmentSetup.tsx)
- `/notebook-config` → [NotebookConfig.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/NotebookConfig.tsx)
- `/notebook-debug` → [NotebookDebug.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/NotebookDebug.tsx)
- setup flow pages:
  - [ProvisionAll.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/setup/ProvisionAll.tsx)
  - [SetupSettings.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/setup/SetupSettings.tsx)
  - [SetupWizard.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/setup/SetupWizard.tsx)
- settings/runtime subpages:
  - [AgentCollaboration.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/settings/AgentCollaboration.tsx)
  - [DeploymentManager.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/settings/DeploymentManager.tsx)
  - [LiveLogPanel.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/settings/LiveLogPanel.tsx)
  - [PhaseProgressTracker.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/settings/PhaseProgressTracker.tsx)
  - [PostDeploymentSummary.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/settings/PostDeploymentSummary.tsx)
  - [PreDeploymentPanel.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/settings/PreDeploymentPanel.tsx)
  - [ResumeBanner.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/settings/ResumeBanner.tsx)

Shared treatment:
- guided setup and admin workflows, not bare forms
- strong risk and side-effect messaging
- explicit preflight, in-flight, and post-action receipts
- one common administration shell

Why these belong together:
- they are all platform ownership and setup surfaces
- they should read like one controlled administrative experience

### Group 10: Internal Engineering and Test Surfaces
Mission: support internal diagnostics without polluting the primary product.

Pages:
- `/mri` → [MRI.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/MRI.tsx)
- `/test-audit` → [TestAudit.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/TestAudit.tsx)
- `/test-swarm` → [TestSwarm.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/pages/TestSwarm.tsx)

Shared treatment:
- clearly marked internal-only shell
- visual separation from production operator flows
- same component standards, but lower polish priority

Why these belong together:
- they are internal tooling and should not distort the public product IA

## Attack Order

### Wave 0: Shared foundation
Build once and reuse everywhere:

- intent header
- action rail
- activity strip
- tiered KPI strip
- receipt stack
- status rail table/card primitives
- common empty, loading, stale, and failure states
- common async banner and milestone timeline

Also decide the consolidated destination model before redesigning page chrome so we do not polish redundant pages.

### Wave 1: Orientation and Launch
Pages:
- Group 1
- Group 2

Why first:
- these pages shape first impression and trust
- they are where users decide whether the system is healthy or broken

### Wave 2: Monitoring and Recovery
Pages:
- Group 3

Why next:
- operators need one coherent recovery experience after launch/control

### Wave 3: Stewardship and Investigation
Pages:
- Group 4
- Group 5

Why next:
- these pages become far easier once the shared evidence and receipt patterns exist

### Wave 4: Quality Gate
Pages:
- Group 6

Why next:
- quality pages should bridge directly into the Gold Studio release logic

### Wave 5: Business Portal
Pages:
- Group 8

Why next:
- once engineering truth is stable, business views can simplify it without diverging

### Wave 6: Platform Administration
Pages:
- Group 9

Why next:
- admin surfaces benefit from the shared state and receipt components built earlier

### Wave 7: Internal Cleanup
Pages:
- Group 10

Why last:
- these pages matter, but they should not drive primary product decisions

## Page-By-Page Consolidation Matrix

### Keep as destination-level surfaces
| Current page | Destination | Action | Notes |
| --- | --- | --- | --- |
| `BusinessOverview` | `Overview` | Keep | Primary arrival surface for narrative summary. |
| `LoadMissionControl` | `Pipeline Operations` | Keep | Core live-run workspace. |
| `ExecutionMatrix` | `Monitor and Recovery` | Keep | Primary run-health matrix. |
| `SourceManager` | `Data Stewardship` | Keep | Core source onboarding and stewardship surface. |
| `SqlExplorer` | `Investigation Workbench` | Keep | Primary evidence/query surface. |
| `SchemaValidation` | `Quality Studio` | Keep | Core validation entry point. |
| `GoldLedger` | `Gold Studio` | Keep | Gold lifecycle stage. |
| `GoldClusters` | `Gold Studio` | Keep | Gold lifecycle stage. |
| `GoldCanonical` | `Gold Studio` | Keep | Gold lifecycle stage. |
| `GoldSpecs` | `Gold Studio` | Keep | Gold lifecycle stage. |
| `GoldValidation` | `Gold Studio` | Keep | Gold lifecycle stage. |
| `GoldMlvManager` | `Gold Studio` | Keep | Serve/publish stage. |
| `BusinessCatalog` | `Business Portal` | Keep | Primary business browsing surface. |
| `BusinessRequests` | `Business Portal` | Keep | Primary request and change-management surface. |
| `Settings` | `Platform Admin` | Keep | Main settings destination. |
| `EnvironmentSetup` | `Platform Admin` | Keep | Main setup and provisioning destination. |

### Merge into destination subviews
| Current page | Destination | Action | Notes |
| --- | --- | --- | --- |
| `DataEstate` | `Overview` | Merge | Estate health becomes an overview mode or section. |
| `ExecutiveDashboard` | `Overview` | Merge | Roll into overview instead of separate executive page. |
| `LoadCenter` | `Pipeline Operations` | Merge | Launch/scoping mode inside pipeline operations. |
| `PipelineRunner` | `Pipeline Operations` | Merge | Duplicate launch semantics; becomes scoped launch tab. |
| `EngineControl` | `Pipeline Operations` | Merge | Advanced runtime control tab, not separate destination. |
| `LoadProgress` | `Pipeline Operations` | Merge | Live progress panel within mission control. |
| `ControlPlane` | `Pipeline Operations` | Merge | Advanced control/diagnostics mode under same destination. |
| `PipelineMatrix` | `Monitor and Recovery` | Merge | Secondary matrix view under shared monitoring shell. |
| `PipelineMonitor` | `Monitor and Recovery` | Merge | Monitoring variant, not separate destination. |
| `ErrorIntelligence` | `Monitor and Recovery` | Merge | Failures tab. |
| `ExecutionLog` | `Monitor and Recovery` | Merge | Logs tab. |
| `LiveMonitor` | `Monitor and Recovery` | Merge | Live feed tab or rail. |
| `RecordCounts` | `Monitor and Recovery` | Merge | Counts/throughput tab. |
| `ImpactPulse` | `Monitor and Recovery` | Merge | Impact/anomaly view under same monitoring destination. |
| `DataCatalog` | `Data Stewardship` | Merge | Catalog tab. |
| `DataClassification` | `Data Stewardship` | Merge | Governance/classification tab. |
| `DataLineage` | `Data Stewardship` | Merge | Lineage tab. |
| `DataManager` | `Data Stewardship` | Merge | Admin/editor mode for managed objects. |
| `DatabaseExplorer` | `Data Stewardship` | Merge | Technical object explorer subview. |
| `ConfigManager` | `Data Stewardship` | Merge | Configuration tab with stronger stewardship framing. |
| `DataBlender` | `Investigation Workbench` | Merge | Transformation/evidence mode. |
| `DataProfiler` | `Investigation Workbench` | Merge | Profile tab. |
| `DataMicroscope` | `Investigation Workbench` | Merge | Deep-inspection mode. |
| `ColumnEvolution` | `Investigation Workbench` | Merge | Column-history subview. |
| `SankeyFlow` | `Investigation Workbench` | Merge | Flow-visualization mode. |
| `TransformationReplay` | `Investigation Workbench` | Merge | Replay tab. |
| `FlowExplorer` | `Investigation Workbench` | Merge | Flow navigation mode. |
| `DataJourney` | `Investigation Workbench` | Merge | Narrative lineage/trace mode. |
| `ImpactAnalysis` | `Investigation Workbench` | Merge | Impact tab. |
| `ValidationChecklist` | `Quality Studio` | Merge | Readiness checklist tab. |
| `DqScorecard` | `Quality Studio` | Merge | Scorecard tab. |
| `CleansingRuleEditor` | `Quality Studio` | Merge | Rules/workbench tab. |
| `ScdAudit` | `Quality Studio` | Merge | Audit tab. |
| `BusinessAlerts` | `Business Portal` | Merge | Alert rail or tab, not separate top-level page. |
| `BusinessSources` | `Business Portal` | Merge | Source context should likely be a catalog lens. |
| `DatasetDetail` | `Business Portal` | Merge | Drill-in from catalog, not independent navigation identity. |
| `BusinessHelp` | `Business Portal` | Merge | Help center tab or support rail. |
| `AdminGateway` | `Platform Admin` | Merge | Landing dashboard for platform admin. |
| `AdminGovernance` | `Platform Admin` | Merge | Governance/settings mode. |
| `NotebookConfig` | `Platform Admin` | Merge | Runtime tool configuration tab. |
| `NotebookDebug` | `Platform Admin` | Merge | Runtime debugging tab. |
| `ProvisionAll` | `Platform Admin` | Merge | Part of setup workflow. |
| `SetupSettings` | `Platform Admin` | Merge | Part of setup workflow. |
| `SetupWizard` | `Platform Admin` | Merge | Main multi-step setup path, not independent destination. |
| `AgentCollaboration` | `Platform Admin` | Merge | Settings/runtime subview. |
| `DeploymentManager` | `Platform Admin` | Merge | Deployment tab. |
| `LiveLogPanel` | `Platform Admin` | Merge | Embedded runtime evidence panel. |
| `PhaseProgressTracker` | `Platform Admin` | Merge | Embedded deployment/setup progress strip. |
| `PostDeploymentSummary` | `Platform Admin` | Merge | Receipt screen in deployment flow. |
| `PreDeploymentPanel` | `Platform Admin` | Merge | Preflight panel in deployment flow. |
| `ResumeBanner` | `Platform Admin` | Merge | Reusable async/banner primitive, not standalone page identity. |

### Route handling during consolidation
- keep legacy routes alive as redirects into the new destination and selected tab where practical
- preserve bookmarks for high-traffic operational pages first
- if a route cannot be preserved exactly, land the user on the new destination with a visible explanation of where the old function moved

### Keep internal-only or hide from primary navigation
| Current page | Destination | Action | Notes |
| --- | --- | --- | --- |
| `MRI` | `Internal` | Hide/Internal | Engineering-only tool. |
| `TestAudit` | `Internal` | Hide/Internal | Engineering-only tool. |
| `TestSwarm` | `Internal` | Hide/Internal | Engineering-only tool. |

## Done Definition For Any Group
A group is not done when the visuals look better. It is done when:

- a zero-context user can explain what each page does
- the user can tell whether work is running, stuck, finished, or failed
- the group uses shared primitives instead of page-local inventions
- copy, badges, tabs, and receipts mean the same thing across pages
- transitions between pages feel like movement inside one product
- the group passes both the design-system rules and the modernization rules

## Immediate Recommendation
Treat Gold Studio as the reference build and move next into:

1. Group 1: Orientation and Operating Picture
2. Group 2: Launch and Mission Control
3. Group 3: Monitoring and Recovery

That sequence fixes the app's most visible trust problems first and makes the rest of the modernization program compound instead of fragment.
