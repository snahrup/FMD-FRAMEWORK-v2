# Gold Studio Flow Audit

Date: 2026-04-09

Companion redesign brief:

- `docs/superpowers/specs/2026-04-09-gold-studio-redesign-brief.md`
- `docs/superpowers/plans/2026-04-09-gold-studio-redesign-implementation-plan.md`

## Scope

Pages audited:

- `/gold/ledger`
- `/gold/clusters`
- `/gold/canonical`
- `/gold/specs`
- `/gold/validation`
- `/labs/gold-mlv`

Primary code references:

- `dashboard/app/src/components/gold/GoldStudioLayout.tsx`
- `dashboard/app/src/pages/gold/GoldLedger.tsx`
- `dashboard/app/src/pages/gold/GoldClusters.tsx`
- `dashboard/app/src/pages/gold/GoldCanonical.tsx`
- `dashboard/app/src/pages/gold/GoldSpecs.tsx`
- `dashboard/app/src/pages/gold/GoldValidation.tsx`
- `dashboard/app/src/pages/GoldMlvManager.tsx`

## Executive View

Gold Studio is trying to support a real end-to-end gold-layer operating model:

1. Intake source material and extracted entities.
2. Group similar entities into clusters.
3. Promote stable concepts into canonical entities.
4. Generate and refine gold specifications.
5. Validate, publish, and certify gold assets.
6. Serve or inventory physical gold-layer objects.

That objective is sound.

The problem is that the current experience behaves like five adjacent tools plus one orphaned lab page, not one coherent product workflow. The pages are individually functional, but the user journey is weak, stage ownership is blurry, progression is implicit, and critical context is not carried forward cleanly.

## Current Product Objective

The clearest product intent visible in the code is:

- `GoldLedger` is the intake and discovery surface.
- `GoldClusters` is the reconciliation and grouping surface.
- `GoldCanonical` is the semantic modeling surface.
- `GoldSpecs` is the gold-output design surface.
- `GoldValidation` is the quality, publication, and certification surface.
- `GoldMlvManager` is the served-object inventory and governance surface.

This is essentially a data-product factory for the gold layer.

## High-Severity Structural Findings

### 1. The workflow is split across two different products

`GoldMlvManager` is routed as `/labs/gold-mlv` and appears under Labs/Quality instead of the Gold Studio flow.

Impact:

- The user cannot traverse the full gold lifecycle from one navigation model.
- A page that looks like the natural "serve/deploy/inventory" stage is detached from the publish/validation stages.
- The current IA teaches the wrong mental model: Gold Studio looks complete, but one of the most important downstream pages lives elsewhere.

### 2. Gold Studio lacks a visible stage model

The shared shell labels every page with the same H1, `Gold Studio`, and the same subtitle, `Design, validate, and publish Gold layer assets`.

Impact:

- Users do not get a crisp answer to "where am I in the flow?"
- Each page lacks a unique page identity.
- Cross-page motion exists, but cross-page meaning does not.

### 3. The app has no explicit progression contract

There is no persistent, global answer to:

- What is the current domain or product?
- What stage is complete?
- What is blocked?
- What is the next recommended action?

Impact:

- The pages feel browseable but not orchestrated.
- Gold Studio reads like an admin console, not a production workflow.

### 4. Validation is overloaded

`GoldValidation` currently mixes three concerns:

- validation status
- catalog registry / publishing
- report recreation coverage

Impact:

- It combines quality gates, publishing, and consumption coverage into one page without a strong task hierarchy.
- The page is trying to be both "quality gate" and "downstream product management."
- The publish action is buried inside a sub-tab, not modeled as a first-class stage outcome.

### 5. Truth bugs are leaking into the UI

Example: `GoldClusters` expects `avg_confidence`, `resolved`, and `not_clustered`, while the shared Gold Studio stats route is returning differently shaped aggregate fields.

Impact:

- The page shows invalid or misleading numbers like `AVG CONFIDENCE undefined%`.
- Users lose trust in the workflow even when the page structure is otherwise fine.

## Page-by-Page Audit

### 1. Ledger

Current role:

- intake
- specimen browsing
- entity browsing
- import entry point

What works:

- It is the right conceptual home base.
- Import actions are concrete.
- The specimen/entity toggle is directionally correct.

What fails:

- The page still behaves like a specimen inventory rather than a stage-based intake workbench.
- It does not clearly separate "raw intake", "schema extraction", and "ready for clustering."
- The dominant call to action is import, but the dominant workflow outcome should be "promote to next stage."

Ideal role:

- Gold intake and discovery queue.

Ideal design:

- Left rail or upper queue of intake states: `Queued`, `Extracting`, `Schema Review`, `Ready for Clustering`, `Blocked`.
- Strong split view: list on the left, rich specimen/entity inspector on the right.
- A visible "next stage" action on every ready item: `Send to Clustering`.
- Search should operate as global asset search, not just list filtering.

### 2. Clusters

Current role:

- clustering review
- reconciliation
- resolve / dismiss

What works:

- This is the right place for stewardship decisions.
- The cluster vs. unclustered split is useful.

What fails:

- Metrics are currently untrustworthy.
- The maturity notice admits the matching model is primitive, which is acceptable internally but weak as the page’s primary explanatory frame.
- The page lacks a strong escalation path from cluster to canonical.

Ideal role:

- Stewardship inbox.

Ideal design:

- Three-lane decision board: `Needs Review`, `Ready to Promote`, `Dismissed`.
- A side inspector that shows member overlap, dominant columns, provenance, and downstream impact before promotion.
- One primary action: `Promote to Canonical`.
- Explicit confidence explanation and matching rationale instead of a passive warning paragraph.

### 3. Canonical

Current role:

- canonical entity management
- domain grid
- relationship map

What works:

- Domain and relationship views are the right primitives.
- This is the right semantic midpoint of the workflow.

What fails:

- The page is still a management screen, not a modeling studio.
- Grid/map is useful, but the user’s next action is not explicit.
- There is no obvious readiness handoff into spec generation.

Ideal role:

- Semantic modeling workspace.

Ideal design:

- Treat canonical entities as product definitions, not just records.
- Show readiness pillars per entity: `Definition`, `Relationships`, `Measures`, `Ownership`, `Spec Coverage`.
- Make the primary CTA `Generate Spec` or `Open Spec Draft`.
- Keep the graph, but pair it with a stable inspector and impact panel.

### 4. Specs

Current role:

- view gold specs
- inspect SQL, columns, transforms, impact, history

What works:

- This page is closest to a proper detail workspace.
- The detail tabs are sensible.

What fails:

- The main list feels like a passive catalog.
- It is not obvious whether this page is for authoring, review, approval, or deployment prep.
- There is no clear visual difference between draft specs and production-ready specs beyond status.

Ideal role:

- Design review and approval workspace.

Ideal design:

- Two-pane editor/reviewer model.
- Strong stage header: `Draft`, `Needs Revision`, `Ready for Validation`, `Approved for Publish`.
- Inline quality panel that shows unresolved issues before validation.
- Clear compare/versioning affordance for spec revisions.

### 5. Validation

Current role:

- validation runs
- catalog publishing
- report recreation coverage

What works:

- These are all adjacent concerns.

What fails:

- Too many concerns compete on one page.
- The page title and shell do not tell the user whether they are in quality, release, or downstream adoption management.
- `Run Structure Check` is too narrow a CTA relative to the broader page promise.

Ideal role:

- Release gate.

Ideal design:

- Split this into a stage-oriented command center:
  - `Checks`
  - `Publish`
  - `Adoption`
- The top section should answer:
  - what is releasable
  - what is blocked
  - what is published but uncertified
  - what downstream reports remain uncovered
- Catalog publication should feel like release management, not a side tab.

### 6. Gold MLV Manager

Current role:

- inventory of physical gold-layer objects
- domain breakdown
- type/status filters

What works:

- This is a valuable operational page.
- It has a strong inventory mindset and good domain grouping.

What fails:

- It is not in Gold Studio.
- It reads as a separate lab instead of the final stage of the workflow.
- It is inventory-first rather than product-outcome-first.

Ideal role:

- Serve / Operate stage of Gold Studio.

Ideal design:

- Rename and move it into the Gold Studio shell.
- Model it as the final lifecycle stage: `Serve`.
- Show refresh health, downstream usage, validation status, owner, and physical object state in one surface.

## Cross-Page UX Findings

### Shared-shell issues

- The shared H1 should not be the only page identity.
- Domain context is too shallow; it informs filtering, but not workflow health.
- Tabs imply sibling pages, but the pages are actually sequential stages.

### Flow issues

- The product lacks a visible end-to-end journey rail.
- There is no global queue of "what needs attention now".
- There is no persistent product or asset inspector that carries context between stages.

### Interaction issues

- Important next actions are often hidden inside tables, cards, or detail panels.
- Some button labels collapse into unreadable strings under real rendering.
- The pages still over-rely on static tables when several stages want split-view or inbox-style interactions.

## Ideal Information Architecture

Recommended top-level Gold Studio stages:

1. Intake
2. Cluster
3. Canonical
4. Spec
5. Release
6. Serve

Suggested route model:

- `/gold/intake`
- `/gold/cluster`
- `/gold/canonical`
- `/gold/specs`
- `/gold/release`
- `/gold/serve`

Mapping from current pages:

- `Ledger` -> `Intake`
- `Clusters` -> `Cluster`
- `Canonical` -> `Canonical`
- `Specs` -> `Spec`
- `Validation` -> `Release`
- `GoldMlvManager` -> `Serve`

## Ideal Shared Shell

The shared shell should shift from tabbed section navigation to workflow navigation.

Recommended shell structure:

- Global Gold Studio header with domain/product selector
- Stage rail showing completion and blockers
- Command/search bar for global asset lookup
- "Needs attention" queue summary
- Persistent contextual inspector or breadcrumb trail for current selection

The current tab strip is adequate for sibling pages. It is not adequate for a governed build-and-release lifecycle.

## Research-Grounded Direction

### Microsoft Fabric

Fabric’s medallion guidance frames gold as the curated layer for reports and dashboards, and explicitly ties domains plus medallion layers to "data as a product". It also highlights materialized lake views as a declarative way to manage transformations, dependencies, refresh behavior, lineage, and monitoring.

Implication for FMD:

- Gold Studio should feel like a domain-scoped product factory.
- MLVs should be in-flow, not off to the side.
- Validation, lineage, refresh, and serve-state should be connected in one release/operate story.

### OpenMetadata

OpenMetadata defines data products as curated, domain-scoped collections of assets with ownership and explicit input/output structure.

Implication for FMD:

- Canonical entities, specs, and served gold assets should roll up into a true product object.
- Domain should be more than a filter; it should be the organizing unit of the whole workflow.

### Atlan

Atlan’s business lineage model emphasizes product lineage, domain lineage, and navigation across products, with search, graph tooling, metadata popovers, and context overlays.

Implication for FMD:

- Gold Studio should expose not only asset lineage but product-stage lineage.
- A user should be able to move from domain -> product -> canonical -> spec -> downstream report impact without changing mental models.

### dbt Catalog / Explorer

dbt’s catalog/explorer direction emphasizes global search, rich lineage, metadata in context, quality signals, and recommendations in the same interface.

Implication for FMD:

- Gold Studio should unify discovery, trust signals, lineage, and actionability instead of splitting them across several flat tables.

## Recommended Target UX

### Primary mental model

Gold Studio should become:

`Domain-scoped product assembly line with release gates`

not:

`collection of administrative tables`

### Primary page pattern

Use one of three page types consistently:

- Queue / Inbox page
- Studio / Modeling page
- Release / Operate page

Recommended mapping:

- Intake: queue page
- Cluster: stewardship inbox
- Canonical: modeling studio
- Spec: review studio
- Release: gate dashboard
- Serve: operate/inventory page

### Shared interaction pattern

Every page should answer:

- What is the object?
- What stage is it in?
- Why is it blocked or healthy?
- What is the next action?
- What downstream effect will that action have?

## Concrete Redesign Moves

### Move 1

Bring `Gold MLV Manager` into the Gold Studio shell and rename it `Serve`.

### Move 2

Replace tab mental model with lifecycle mental model.

### Move 3

Give every page a unique page title and one-sentence purpose.

Examples:

- `Intake` — Capture and qualify source artifacts for gold modeling.
- `Cluster` — Resolve duplicate concepts into stewardable groups.
- `Canonical` — Define governed business entities and relationships.
- `Spec` — Review and refine production-ready gold definitions.
- `Release` — Validate, publish, and certify gold assets.
- `Serve` — Operate physical gold objects and monitor downstream usage.

### Move 4

Introduce a persistent stage-progress strip for the selected domain or product.

### Move 5

Promote next-step CTAs:

- Intake -> `Send to Clustering`
- Cluster -> `Promote to Canonical`
- Canonical -> `Generate Spec`
- Spec -> `Send to Release`
- Release -> `Publish`
- Serve -> `Monitor / Refresh / Inspect Lineage`

## Immediate Low-Level Fixes

- Fix the `GoldClusters` stats contract mismatch before design review, otherwise the page cannot be trusted.
- Fix collapsed button labels and spacing on Gold Ledger and Gold Specs under real rendering.
- Give each Gold page a unique visible page title.
- Move or at least cross-link `Gold MLV Manager` from the Gold Studio shell.

## Recommended Next Deliverables

1. A flow map showing the desired lifecycle from Intake to Serve.
2. A shared Gold Studio shell redesign.
3. One-page redesign briefs for each stage.
4. A phased implementation plan:
   - phase 1: IA and shell
   - phase 2: page-level redesigns
   - phase 3: truth bugs and backend contract cleanup
   - phase 4: polish, motion, and responsive refinement

## External References

- Microsoft Fabric medallion architecture:
  - https://learn.microsoft.com/en-us/fabric/onelake/onelake-medallion-lakehouse-architecture
- OpenMetadata data products:
  - https://docs.open-metadata.org/v1.12.x/api-reference/governance/data-products
- Atlan business lineage:
  - https://docs.atlan.com/product/capabilities/data-products/concepts/what-is-business-lineage
- dbt Catalog:
  - https://www.getdbt.com/product/dbt-catalog
