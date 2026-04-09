# Gold Studio Coverage Map And Semantic Model Review

Date: 2026-04-09

Related documents:

- `docs/superpowers/specs/2026-04-09-gold-studio-redesign-brief.md`
- `docs/superpowers/plans/2026-04-09-gold-studio-redesign-implementation-plan.md`
- `docs/superpowers/audits/2026-04-09-gold-studio-flow-audit.md`

## Core Question

How do we prove that a domain’s final gold semantic model contains everything required to migrate all imported reports, Power BI models, Excel workbooks, queries, and supporting artifacts onto one shared gold layer?

That is the right question.

This should be treated as a coverage and migration-governance problem, not just a modeling problem.

## Short Answer

Yes. Gold Studio should have a dedicated coverage-map capability.

The final workflow should not stop at:

- imported artifacts
- clustered entities
- canonical definitions
- generated specs

It should end with a domain-level proof surface that answers:

1. What was imported?
2. What fields, measures, dimensions, and relationships does each artifact depend on?
3. Where is each dependency represented in the proposed gold semantic model?
4. What is still missing?
5. Which reports are migration-ready, partially covered, or blocked?

## What Other Platforms Do

No single vendor doc describes the exact end-state you want, but the pattern is clearly visible across current governance and semantic-model tooling.

### 1. Power BI provides the target visual language for the final semantic-model page

Microsoft’s Model view is the clearest precedent for the final “proposed semantic model” page. Microsoft describes Model view as the place where you see all tables, columns, and relationships, and Model explorer as the place where you work with complex semantic models including tables, relationships, measures, roles, calculation groups, translations, and perspectives.

This supports a Gold Studio final page that looks and behaves like a Power BI semantic model review surface:

- table cards
- relationship lines
- filter direction and cardinality
- expandable object explorer for measures and perspectives

### 2. Power BI impact analysis provides the precedent for migration-risk visibility

Microsoft’s semantic model impact analysis is the precedent for showing downstream consequences before changing or releasing a model.

That maps directly to Gold Studio:

- if a measure changes, which reports are affected?
- if a dimension is missing, which imported artifacts remain blocked?
- if a release goes out, which downstream products become migration-ready?

### 3. Purview and metadata scanning provide the precedent for inventorying imported BI assets and lineage

Microsoft Purview and Fabric metadata scanning show the right pattern for inventorying Power BI artifacts and connecting reports back to datasets and upstream assets.

That supports the ingestion side of Gold Studio:

- inventory reports, dashboards, semantic models, queries, and source artifacts
- capture upstream/downstream lineage
- expose searchable ownership and endorsement metadata

### 4. OpenMetadata provides the precedent for column-level lineage and dashboard-to-table mapping

OpenMetadata shows the important extra step: not just table-level lineage, but column-level lineage and dashboard connections.

That is the missing layer that makes a real coverage map possible.

If you only know that Report A uses Dataset B, that is not enough.

To migrate safely, you need to know:

- which report field maps to which source field
- which source field maps to which canonical field
- which canonical field maps to which final semantic-model column or measure

### 5. Shared semantic-model reuse is the precedent for the actual rollout strategy

Microsoft’s shared semantic-model guidance is the clearest official precedent for your end-state: publish one vetted semantic model and let many reports connect to it rather than each report carrying its own competing model.

That is essentially the Gold Studio promise:

- many imported artifacts
- one final vetted domain model
- many migrated reports built on that model

## Inference For Gold Studio

This section is an inference from the sources above plus your current product shape.

Gold Studio should add a final two-part review capability:

1. `Coverage Map`
2. `Proposed Semantic Model`

And it should end with a generated `Coverage Appendix`.

## 1. Coverage Map

This page should exist to answer one thing:

`Does the proposed gold semantic model fully cover the needs of all imported downstream assets in this domain?`

### Recommended page structure

Top section:

- domain summary
- total imported artifacts
- total covered artifacts
- partially covered
- blocked
- migration-ready percentage

Middle section:

- artifact coverage matrix

Bottom section:

- uncovered requirements
- duplicate requirements
- conflicts
- recommended next actions

### Recommended artifact types

The matrix should include every imported item type:

- Power BI report
- Power BI semantic model
- paginated report
- Excel workbook
- SQL query
- uploaded file
- supporting evidence artifact
- contextual note

### Recommended coverage statuses

- Fully covered
- Covered with transformation
- Partially covered
- Not covered
- Blocked by source ambiguity
- Blocked by modeling decision

### Recommended matrix columns

- artifact name
- artifact type
- domain
- business purpose
- source entities used
- dimensions required
- measures required
- filters/slicers required
- relationships required
- coverage status
- migration readiness
- blocker summary

### Drill-in detail for each artifact

When you open one artifact, the page should show:

- imported artifact metadata
- extracted fields and entities
- mapped canonical entities
- mapped final semantic-model tables
- mapped measures and dimensions
- uncovered requirements
- report-specific migration notes

## 2. Proposed Semantic Model

This should be the final model-review page for the domain.

It should visually resemble Power BI Desktop Model view, but with Gold Studio governance context layered on top.

### Required visual elements

- table cards
- relationship lines
- cardinality
- filter direction
- fact/dimension/reference coloring
- visible measure counts
- visible key columns
- visible role-playing or bridge-table markers

### Required explorer panel

Model explorer should include:

- tables
- columns
- measures
- hierarchies
- perspectives
- role definitions
- calculations

### Required governance overlays

Unlike pure Power BI Model view, Gold Studio should also show:

- coverage status per table
- source provenance per table
- imported artifact count using each object
- confidence or approval status
- missing required objects

### Required gap overlays

The final model page should visually mark:

- proposed but not yet approved tables
- missing relationships required by imported assets
- missing measures required by reports
- dimensions that are only partially represented

## 3. Coverage Appendix

This should be a generated appendix, not just another UI table.

It is the proof artifact for the team.

### Required appendix sections

#### A. Imported Asset Inventory

Every imported item:

- artifact name
- type
- source
- uploaded/imported date
- owner or steward
- domain
- current coverage status

#### B. Requirement-To-Model Mapping

For every imported report/query/model requirement:

- source artifact
- requirement type: measure, dimension, relationship, filter, hierarchy, KPI
- source expression or field name
- mapped canonical entity
- mapped final semantic-model object
- status: covered / transformed / partial / missing

#### C. Final Semantic Model Inventory

For every final semantic-model object:

- object type
- object name
- domain
- source provenance
- dependent imported artifacts
- unresolved gaps

#### D. Migration Readiness Summary

Per imported report/model:

- migration-ready
- partial
- blocked
- blocker reason

## This Is Already Partly Supported By Your Current Backend

Gold Studio already has pieces of this in the backend.

You are not starting from zero.

Current useful primitives:

- `gs_report_recreation_coverage`
- `gs_report_field_usage`
- canonical lineage on canonical detail
- spec impact
- catalog publishing history
- audit log

That means the coverage-map feature can be built by extending existing concepts, not inventing a separate subsystem.

## Recommended Product Additions

## A. Add a dedicated `Coverage Map` page under Gold Studio

Recommended nav order:

- Intake
- Cluster
- Canonical
- Spec
- Release
- Coverage
- Serve

If you want to keep the six-stage rail intact, Coverage can instead be the primary body mode inside `Release`.

My recommendation:

- keep `Release` as the stage
- make `Coverage Map` the dominant view inside Release
- make `Proposed Semantic Model` the final approval sub-view

That keeps the lifecycle cleaner.

## B. Add a `Proposed Semantic Model` mode inside Release

This should be the final approval surface before publish.

Tabs inside Release could be:

- Quality Findings
- Coverage Map
- Proposed Semantic Model
- Downstream Coverage

That is a better hierarchy than the current release page.

## C. Generate a downloadable appendix artifact

This should be generated as:

- UI view
- downloadable CSV/Excel
- printable review export

The team should be able to review it outside the app.

## Recommended Coverage Data Model

At minimum, Gold Studio should normalize imported requirements into a common structure:

- `artifact_id`
- `artifact_type`
- `artifact_name`
- `requirement_type`
- `requirement_name`
- `source_expression`
- `mapped_canonical_id`
- `mapped_spec_id`
- `mapped_model_object`
- `coverage_status`
- `coverage_confidence`
- `notes`

This gives you one shared table for:

- report field coverage
- Excel dependency coverage
- query field coverage
- semantic model migration coverage

## Recommended Matching Logic

Coverage should not be binary only.

Use a layered match model:

### Exact match

The final semantic object directly satisfies the imported requirement.

### Transformed match

The final semantic object satisfies the requirement after rename, aggregation, or semantic normalization.

### Composite match

The imported requirement is satisfied by combining multiple final objects.

### Partial match

The requirement is partly represented but missing logic, granularity, or relationship context.

### Missing

No usable representation exists in the proposed model.

## Recommended User Experience

A user should be able to answer these questions on the Coverage Map page:

1. Which imported reports are already covered?
2. Which reports are blocked?
3. Which missing measures prevent migration?
4. Which dimensions are required across many artifacts?
5. Which final model objects have the highest downstream reuse?
6. If I publish this domain model today, which artifacts can move over immediately?

## Final Recommendation

Yes, you should build this.

And it should not be treated as an optional nice-to-have.

It is the page that proves the rest of Gold Studio worked.

Without it, the workflow can create canonical objects and specs, but it still cannot prove:

- that the final domain model is complete
- that migrated reports will be safe
- that imported assets were truly accounted for

With it, Gold Studio becomes a real migration and semantic-governance system.

## Sources

These sources informed the design direction above:

- Power BI Model view: https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-relationship-view
- Power BI Model explorer: https://learn.microsoft.com/en-us/power-bi/transform-model/model-explorer
- Power BI semantic model impact analysis: https://learn.microsoft.com/en-us/power-bi/collaborate-share/service-dataset-impact-analysis
- Power BI shared semantic-model reuse: https://learn.microsoft.com/is-is/power-bi/connect-data/desktop-report-lifecycle-datasets
- Microsoft Purview lineage for Power BI: https://learn.microsoft.com/en-us/purview/data-map-lineage-power-bi
- Fabric metadata scanning: https://learn.microsoft.com/en-us/fabric/governance/metadata-scanning-run
- OpenMetadata lineage view: https://docs.open-metadata.org/v1.12.x/how-to-guides/data-lineage/explore
- OpenMetadata column lineage: https://docs.open-metadata.org/v1.12.x/how-to-guides/data-lineage/column
- OpenMetadata lineage API: https://docs.open-metadata.org/v1.12.x/api-reference/lineage/index
