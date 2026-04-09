# Gold Studio Redesign Brief

Date: 2026-04-09

Related audit: `docs/superpowers/audits/2026-04-09-gold-studio-flow-audit.md`
Implementation plan: `docs/superpowers/plans/2026-04-09-gold-studio-redesign-implementation-plan.md`
Coverage-map spec: `docs/superpowers/specs/2026-04-09-gold-studio-coverage-map.md`

## Core Premise

Gold Studio must assume the user has no prior context.

That means every page must make four things obvious without training:

1. What this stage is.
2. Why it matters.
3. What the system is doing right now.
4. What the user should do next.

If the product only makes sense to people who already understand the pipeline, the UI is failing its primary job.

## Product Objective

Gold Studio is not a set of sibling admin screens.

It is a guided operating system for turning raw source material into governed, publishable, consumable gold-layer products.

The ideal lifecycle is:

1. Intake
2. Cluster
3. Canonical
4. Spec
5. Release
6. Serve

Every page should exist as one clearly owned stage in that lifecycle.

## Non-Negotiable UX Rules

### 1. Never require prior knowledge

The UI must explain difficult concepts in place.

Required pattern on every page:

- a one-sentence page purpose
- a short "what happens here" explainer
- a short "what comes next" explainer

### 2. Always show where the user is in the workflow

The shared shell must answer:

- current stage
- previous completed stage
- next stage
- current blockers
- current domain or product context

### 3. Background work must always feel alive

Users should never wonder whether the system is broken.

If work is running, the page must show:

- what is running
- when it last updated
- the latest completed milestone
- the next expected change
- whether the user needs to wait or act

No full-screen spinner-only states. No silent loading. No invisible background actions.

### 4. Every page needs a primary job

A page cannot try to be two or three different products at once.

Each page gets:

- one primary purpose
- one primary CTA
- one primary success state

### 5. The system must narrate important changes

Important operations need visible receipts:

- started
- in progress
- completed
- failed
- partially completed

These receipts should be human-readable, not just raw status labels.

### 6. Trust is a feature

If the data is wrong, inconsistent, or stale, the UI becomes untrustworthy.

Metrics should only be shown when they are correct, timestamped, and clearly scoped.

If a number is uncertain, say so.

### 7. Jargon must be translated

Words like `canonical`, `spec`, `validation`, and `MLV` are internal language.

They can still exist, but the UI must pair them with plain-English framing.

Example pattern:

- `Canonical Definitions`
- `Define the business objects this product will use everywhere else`

## Ideal Shared Shell

The shared shell should stop acting like a generic tab container and start acting like a workflow frame.

### Header

Top-level header should include:

- page-specific title, not generic `Gold Studio`
- one-sentence purpose
- domain or product selector
- current product health badge

### Stage Rail

A persistent stage rail should show:

- Intake
- Cluster
- Canonical
- Spec
- Release
- Serve

Each stage should communicate one of:

- Not started
- In progress
- Needs attention
- Ready
- Completed

Clicking a stage should feel like moving through a guided lifecycle, not browsing unrelated tabs.

### Context Bar

A persistent context bar should show:

- active domain
- selected product or candidate
- owner
- last updated time
- unresolved issues count

### Next Action Panel

Every page should include a visible `Next Best Action` area.

This should answer:

- what the user should do now
- what will happen after they do it
- what they can safely ignore for the moment

### Activity Feed

A lightweight recent activity rail should surface:

- imports started
- clustering completed
- canonical promoted
- specs generated
- validation passed or failed
- release published

This gives the product narrative continuity across pages.

## Background Work Patterns

Gold Studio needs a single, consistent status language for async work.

### Required running-state treatment

When background work is active, show a persistent inline status card:

- title: `Generating draft specs`
- status: `Running`
- elapsed time
- last update time
- latest milestone
- next expected milestone

Example:

- `Generating draft specs`
- `Running for 01:42`
- `Last update 8 seconds ago`
- `Completed: relationship graph built`
- `Next: draft measure definitions`

### Required completion treatment

When work completes, show:

- completion receipt
- what changed
- what is ready now
- what the user should review next

### Required failure treatment

If work fails, show:

- what failed
- how far it got
- what remains safe and preserved
- what the user can retry
- whether retry affects the whole pipeline or only the failed step

This is especially important because partial success is common in pipeline-style systems.

## Page Model

## 1. Intake

Current page source: `GoldLedger`

### Purpose

Collect, inspect, and qualify raw source material before it enters gold design.

### User question

`What did we ingest, is it usable, and what is ready to move forward?`

### Primary layout

- left: intake queue grouped by state
- center: selected specimen or entity details
- right: readiness panel and next-stage action

### Required states

- Queued
- Extracting
- Needs schema review
- Ready for clustering
- Blocked

### Primary CTA

`Send to Clustering`

### Success signal

The user can clearly see which assets are usable and which are blocked before moving on.

## 2. Cluster

Current page source: `GoldClusters`

### Purpose

Review candidate groupings and decide which concepts should become stable business objects.

### User question

`Which things belong together, which are noise, and which are ready to promote?`

### Primary layout

- main lane board: Needs review, Ready to promote, Dismissed
- side inspector: membership, overlap, provenance, confidence explanation, downstream impact

### Primary CTA

`Promote to Canonical`

### Success signal

The user leaves with approved concepts, not just reviewed rows.

## 3. Canonical

Current page source: `GoldCanonical`

### Purpose

Define the shared business objects that will anchor downstream gold products.

### User question

`Are these concepts well-defined enough to build products from?`

### Primary layout

- entity list with readiness columns
- entity workspace with relationships, measures, ownership, and quality
- impact sidebar showing dependent specs and release implications

### Required readiness pillars

- Definition
- Relationships
- Measures
- Ownership
- Spec coverage

### Primary CTA

`Generate Spec Draft`

### Success signal

The user can tell which canonical entities are mature enough to generate product specs from.

## 4. Spec

Current page source: `GoldSpecs`

### Purpose

Design, review, and approve the gold-layer product specification.

### User question

`Is this product definition clear, complete, and ready for release review?`

### Primary layout

- left: spec list grouped by stage
- center: spec detail workspace
- right: quality and release readiness panel

### Required stages

- Draft
- Needs revision
- Ready for validation
- Approved for release

### Primary CTA

`Submit for Release Review`

### Success signal

The user understands both the shape of the spec and whether it is ready to move forward.

## 5. Release

Current page source: `GoldValidation`

### Purpose

Run quality checks, confirm release readiness, and publish approved products.

### User question

`Is this safe to release, what is blocking it, and what happens if I publish it?`

### Primary layout

- top: release gate summary
- middle: validation findings grouped by severity
- bottom: publish readiness and downstream impact

### This page must be narrowed

The current validation page mixes:

- validation execution
- publish/catalog actions
- downstream recreation coverage

That should be reorganized into one release command center with a clear hierarchy:

1. quality result
2. release decision
3. downstream impact

### Primary CTA

`Publish Release`

### Success signal

The user knows why a product is or is not releasable.

## 6. Serve

Current page source: `GoldMlvManager`

### Purpose

Expose, govern, and inventory released gold products.

### User question

`What is live, who owns it, and how is it performing as a governed product?`

### Primary layout

- product inventory
- product detail pane
- operational metadata and usage

### Primary CTA

`Open Live Product`

### Success signal

The user can move from release to live stewardship without leaving the Gold Studio experience.

## Navigation Changes

### Rename the flow

Recommended navigation:

- Intake
- Cluster
- Canonical
- Spec
- Release
- Serve

### Remove the orphaned route problem

`GoldMlvManager` should move into the Gold Studio shell.

It should not live as a separate Labs page if it is part of the gold lifecycle.

### Give every page its own title

Bad:

- `Gold Studio`

Better:

- `Intake`
- `Cluster Review`
- `Canonical Definitions`
- `Product Specs`
- `Release Gate`
- `Serve and Governance`

## Copy Rules

### Every page must explain itself in plain English

Required page intro pattern:

- title
- one-sentence purpose
- short explanation of why this stage matters
- short explanation of what happens next

### Buttons must describe outcomes

Avoid vague CTA labels like:

- `Run`
- `Process`
- `Submit`

Prefer:

- `Send to Clustering`
- `Promote to Canonical`
- `Generate Spec Draft`
- `Publish Release`

### Status labels must be understandable

Avoid raw backend language unless paired with a user-facing explanation.

Example:

- `Blocked`
- `Schema extraction failed. You can retry extraction without losing the imported source.`

## Visual Direction

The visual design should feel deliberate, calm, and operationally trustworthy.

Recommended tone:

- editorial clarity over dashboard clutter
- strong hierarchy
- obvious progression
- conspicuous feedback
- minimal ambiguity

This should not feel like a dense admin back office.

It should feel like a guided product factory with high-confidence oversight.

## Immediate Implementation Priorities

### Priority 1: Fix the information architecture

- move `GoldMlvManager` into Gold Studio
- rename stages based on user goals, not internal object names
- replace sibling-tab framing with lifecycle framing

### Priority 2: Build the shared workflow shell

- page-specific titles
- stage rail
- context bar
- next action panel
- recent activity feed

### Priority 3: Standardize async feedback

- one consistent running-state card
- one consistent completion receipt
- one consistent failure receipt

### Priority 4: Narrow page responsibilities

- make `Release` a real release gate
- keep `Serve` focused on live product stewardship
- keep `Intake` focused on qualification and readiness

### Priority 5: Fix data-trust defects before polishing

- remove incorrect metrics
- resolve schema mismatches
- timestamp surfaced numbers

## Success Criteria

The redesign is successful when a first-time observer can answer these questions within seconds on any page:

1. What stage am I in?
2. What is the purpose of this stage?
3. What is the system doing right now?
4. What am I supposed to do next?
5. What happens after I do that?
6. Is anything blocked or failing?
7. Can I trust what I am seeing?

If those answers are not obvious, the interface is still too insider-dependent.

## Research Anchors

These external references support the lifecycle framing, product-governance orientation, and data-product operating model:

- Microsoft Fabric medallion architecture: https://learn.microsoft.com/en-us/fabric/onelake/onelake-medallion-lakehouse-architecture
- OpenMetadata data products: https://docs.open-metadata.org/v1.12.x/api-reference/governance/data-products
- Atlan business lineage: https://docs.atlan.com/product/capabilities/data-products/concepts/what-is-business-lineage
- dbt Catalog: https://www.getdbt.com/product/dbt-catalog
