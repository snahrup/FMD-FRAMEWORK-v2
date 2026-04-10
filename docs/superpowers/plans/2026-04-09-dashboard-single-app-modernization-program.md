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
- [2026-04-09-gold-studio-flow-audit.md](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/docs/superpowers/audits/2026-04-09-gold-studio-flow-audit.md)
- [2026-04-09-gold-studio-redesign-brief.md](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/docs/superpowers/specs/2026-04-09-gold-studio-redesign-brief.md)
- [2026-04-09-gold-studio-redesign-implementation-plan.md](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/docs/superpowers/plans/2026-04-09-gold-studio-redesign-implementation-plan.md)
- [system.md](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/.interface-design/system.md)
- local `modernize` skill guidance at `C:\Users\snahrup\.claude\skills\modernize\SKILL.md`
- local `interface-design` skill guidance at `C:\Users\snahrup\.claude\skills\interface-design\SKILL.md`
- current route and page inventory from [App.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/App.tsx) and [AppLayout.tsx](C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/components/layout/AppLayout.tsx)

## Product Thesis
FMD is not a collection of dashboards. It is a data operating workbench.

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
