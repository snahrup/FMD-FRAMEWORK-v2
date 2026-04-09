# Gold Studio Redesign Implementation Plan

Date: 2026-04-09

Related documents:

- `docs/superpowers/audits/2026-04-09-gold-studio-flow-audit.md`
- `docs/superpowers/specs/2026-04-09-gold-studio-redesign-brief.md`
- `docs/superpowers/specs/2026-04-09-gold-studio-coverage-map.md`
- `docs/superpowers/specs/2026-03-24-gold-studio-modernization.md`

Primary code targets:

- `dashboard/app/src/components/gold/GoldStudioLayout.tsx`
- `dashboard/app/src/components/layout/AppLayout.tsx`
- `dashboard/app/src/App.tsx`
- `dashboard/app/src/pages/gold/GoldLedger.tsx`
- `dashboard/app/src/pages/gold/GoldClusters.tsx`
- `dashboard/app/src/pages/gold/GoldCanonical.tsx`
- `dashboard/app/src/pages/gold/GoldSpecs.tsx`
- `dashboard/app/src/pages/gold/GoldValidation.tsx`
- `dashboard/app/src/pages/GoldMlvManager.tsx`
- `dashboard/app/api/routes/gold_studio.py`

## Goal

Transform Gold Studio from a set of insider-oriented sibling pages into a guided, novice-safe workflow for building and governing gold-layer products.

The user should be able to land on any page and immediately understand:

1. where they are
2. why this stage exists
3. what the system is doing
4. what they should do next

## Delivery Strategy

This should be implemented in two tracks at the same time:

- structural redesign
- trust and state clarity fixes

Do not treat visual modernization as sufficient. The shell, naming, and async feedback model have to change with it.

## Target Workflow Model

Gold Studio should present one lifecycle:

1. Intake
2. Cluster
3. Canonical
4. Spec
5. Release
6. Serve

## Route And Navigation Strategy

### Phase 1: Rename labels, keep existing routes

This minimizes breakage while fixing the information architecture first.

Route and label mapping:

- `/gold/ledger` -> `Intake`
- `/gold/clusters` -> `Cluster`
- `/gold/canonical` -> `Canonical`
- `/gold/specs` -> `Spec`
- `/gold/validation` -> `Release`
- `/labs/gold-mlv` -> `Serve`

Navigation changes:

- move `Gold MLV Manager` into the `Gold Studio` nav group
- remove it from `Quality`
- update tab labels and page titles to lifecycle language

### Phase 2: Add cleaner route aliases

Once the shell is stable, add alias routes:

- `/gold/intake`
- `/gold/cluster`
- `/gold/spec`
- `/gold/release`
- `/gold/serve`

Keep legacy routes as redirects until downstream links are updated.

## Shared Shell Redesign

The current `GoldStudioLayout` is a title bar, domain selector, and tab row.

It needs to become a workflow shell.

## Shared Shell Target Structure

### 1. Page Identity Header

Replace the generic `Gold Studio` heading with page-owned titles.

Required content:

- page title
- one-sentence purpose
- one-sentence `what happens next`
- domain or product selector
- stage health badge

Example:

- `Release Gate`
- `Confirm quality, resolve blockers, and publish approved gold products.`
- `After release, the product moves into live stewardship and inventory.`

### 2. Stage Rail

Create a persistent stage rail component that shows:

- Intake
- Cluster
- Canonical
- Spec
- Release
- Serve

Per-stage status tokens:

- Not started
- In progress
- Needs attention
- Ready
- Completed

The active stage must be visually dominant.

Each stage cell should expose:

- stage name
- short purpose tooltip or inline helper
- item count or blocker count when available

### 3. Context Bar

Add a persistent context bar directly under the stage rail.

Required fields:

- active domain
- selected product candidate
- owner or steward
- unresolved issues count
- last updated timestamp

This is the continuity layer that keeps the user oriented when moving between pages.

### 4. Next Best Action Panel

Every Gold Studio page needs a persistent action panel near the top of the content area.

It must answer:

- what to do now
- what will happen if the user does it
- why this matters

This should not be hidden in a footer or secondary drawer.

### 5. Recent Activity Feed

Add a compact cross-stage activity feed component.

It should summarize recent meaningful events:

- specimen imported
- clustering completed
- canonical promoted
- spec generated
- validation failed or passed
- release published

This creates narrative continuity across the flow.

## Shared Async Feedback Model

This is mandatory. Background work is one of the biggest trust failures today.

## Standard Components To Introduce

### `GoldAsyncStatusCard`

Used when a background process is active.

Fields:

- operation name
- current status
- elapsed time
- last update time
- latest completed milestone
- next expected milestone
- optional safe actions

### `GoldCompletionReceipt`

Used after successful or partially successful actions.

Fields:

- action completed
- what changed
- what is ready now
- recommended next action

### `GoldFailureReceipt`

Used after failures.

Fields:

- what failed
- how far it got
- what remains preserved
- what can be retried
- retry scope

### `GoldEmptyState`

Every empty state should explain:

- why the page is empty
- what the user can do next
- whether emptiness is expected or a problem

## Page-Level Redesign Targets

## 1. Intake

Current implementation: `GoldLedger`

### New title

`Intake`

### Page purpose

`Import, inspect, and qualify source material before it enters gold design.`

### Layout

- top: stage summary and next best action
- left: queue segmented by state
- center: selected intake item inspector
- right: readiness panel and forward action

### Queue states

- Queued
- Extracting
- Needs review
- Ready for clustering
- Blocked

### Primary CTA

`Send to Clustering`

### Required helper language

- `What you are looking at`
- `Why this item is blocked or ready`
- `What will happen if you move it forward`

### Required async treatment

During extraction:

- show last processed step
- show latest discovered schema/entity milestone
- show whether the user can safely continue browsing

## 2. Cluster

Current implementation: `GoldClusters`

### New title

`Cluster Review`

### Page purpose

`Group related items, discard noise, and promote stable concepts into business objects.`

### Layout

- top: stewardship summary and next best action
- main: decision board or grouped review queue
- side: cluster inspector with provenance and confidence explanation

### Review lanes

- Needs review
- Ready to promote
- Dismissed

### Primary CTA

`Promote to Canonical`

### Required helper language

- why the system grouped these items
- what confidence means
- what promotion changes downstream

### Required trust fixes

- fix the current stats contract mismatch before treating metrics as authoritative
- do not show undefined or inferred KPI values

## 3. Canonical

Current implementation: `GoldCanonical`

### New title

`Canonical Definitions`

### Page purpose

`Define the shared business objects that all gold products should build from.`

### Layout

- top: readiness summary and next best action
- main: entity workspace with list and inspector
- side: relationship and downstream impact panel

### Required readiness pillars

- Definition
- Relationships
- Measures
- Ownership
- Spec coverage

### Primary CTA

`Generate Spec Draft`

### Required helper language

- what makes a canonical object complete
- what is still missing
- what spec generation will do

## 4. Spec

Current implementation: `GoldSpecs`

### New title

`Product Specs`

### Page purpose

`Design and approve the product definition before release review.`

### Layout

- top: draft pipeline summary and next best action
- left: spec list grouped by stage
- center: spec detail workspace
- right: quality and release readiness panel

### Spec stages

- Draft
- Needs revision
- Ready for validation
- Approved for release

### Primary CTA

`Submit for Release Review`

### Required helper language

- what a spec controls
- what changed in the latest revision
- what must be fixed before release

## 5. Release

Current implementation: `GoldValidation`

### New title

`Release Gate`

### Page purpose

`Resolve quality blockers, confirm release readiness, and publish approved products.`

### Layout

- top: release summary and go or no-go panel
- main: findings grouped by severity
- lower section: downstream impact and publish controls

### Required hierarchy

This page currently mixes too many concerns. Rebuild it around this order:

1. quality result
2. release decision
3. downstream impact

### Primary CTA

`Publish Release`

### Required helper language

- why the product can or cannot be released
- what publish does
- what changes for downstream users after release

## 6. Serve

Current implementation: `GoldMlvManager`

### New title

`Serve and Governance`

### Page purpose

`Monitor live gold products, ownership, and governance after release.`

### Layout

- top: live product summary and next best action
- left: product inventory
- center: product detail view
- right: ownership, freshness, and governance metadata

### Primary CTA

`Open Live Product`

### Required helper language

- what is live
- who owns it
- whether it is healthy
- where the user should go if a live issue is found

## Cross-Cutting Content Rules

These rules should be enforced across all pages.

### Plain-English framing

Every stage should include:

- a plain-English title
- a one-sentence purpose
- a short `why it matters`
- a short `what happens next`

### Outcome-based buttons

Use button labels that describe results, not generic actions.

Prefer:

- `Send to Clustering`
- `Promote to Canonical`
- `Generate Spec Draft`
- `Submit for Release Review`
- `Publish Release`

Avoid:

- `Run`
- `Process`
- `Submit`
- `Continue`

### Timestamped truth

Every meaningful KPI area should show freshness:

- `Updated 8 seconds ago`
- `Based on 24 release candidates`
- `Last successful refresh 2:14 PM`

### Explain partial progress

Any long-running action must show partial completion, not just loading.

## Component Implementation Map

## Shared Shell And Navigation

### `dashboard/app/src/components/gold/GoldStudioLayout.tsx`

Refactor into:

- page identity header
- stage rail
- context bar
- optional activity feed slot
- optional next action slot

New props to introduce:

- `stage`
- `title`
- `purpose`
- `whatNext`
- `stageStatus`
- `nextAction`
- `activity`
- `context`

### `dashboard/app/src/components/layout/AppLayout.tsx`

Change Gold Studio nav labels to lifecycle naming.

Move `Gold MLV Manager` from `Quality` into `Gold Studio`.

### `dashboard/app/src/App.tsx`

Short term:

- keep existing routes
- change visible labels

Medium term:

- add new alias routes
- redirect old routes to the new lifecycle paths

## Shared Supporting Components

Create new shared components under `dashboard/app/src/components/gold/`:

- `GoldStageRail.tsx`
- `GoldContextBar.tsx`
- `GoldNextActionPanel.tsx`
- `GoldActivityFeed.tsx`
- `GoldAsyncStatusCard.tsx`
- `GoldCompletionReceipt.tsx`
- `GoldFailureReceipt.tsx`
- `GoldEmptyState.tsx`

## Backend Data Contract Work

### `dashboard/app/api/routes/gold_studio.py`

Add or normalize lightweight endpoints needed for the new shell:

- stage summary by domain or product
- workflow blocker counts
- recent activity feed
- freshness metadata for KPIs

Also fix existing contract mismatches before redesigning around those numbers.

## Rollout Phases

## Phase 0: Truth And Stability

Objective:

- remove broken metrics
- fix contract mismatches
- ensure every KPI can be trusted

Required work:

- fix Gold Clusters stats mismatch
- timestamp KPI payloads
- remove or downgrade any ambiguous number

Definition of done:

- no undefined KPIs
- no stale-looking counts without timestamps

## Phase 1: Shared Workflow Shell

Objective:

- make every page explain where the user is and what to do next

Required work:

- refactor `GoldStudioLayout`
- add stage rail
- add context bar
- add page-owned titles and copy
- update sidebar labels

Definition of done:

- all Gold Studio pages share the same workflow shell
- no page uses the generic `Gold Studio` heading as its main identity

## Phase 2: Async Feedback System

Objective:

- make background work obviously alive and understandable

Required work:

- create async status card
- create completion and failure receipts
- wire them into page actions

Definition of done:

- users can always see what is running, last update, latest milestone, and next step

## Phase 3: Page Rebuilds

Rebuild pages in this order:

1. Intake
2. Cluster
3. Release
4. Canonical
5. Spec
6. Serve

Reasoning:

- Intake and Cluster establish the front of the lifecycle
- Release currently has the highest structural confusion
- Canonical and Spec become easier once the lifecycle shell exists
- Serve should move last because it depends on the nav and routing cleanup

## Phase 4: Route Cleanup

Objective:

- align URLs with the lifecycle model

Required work:

- add alias routes
- redirect legacy routes
- update internal links

## Phase 5: Presentation Readiness

Objective:

- make the flow explainable to a team in a walkthrough

Required work:

- polish copy across all pages
- verify empty/loading/error states
- ensure each page tells a coherent story in sequence

Definition of done:

- a first-time observer can be walked through the full lifecycle without insider explanation

## Acceptance Checklist

- every page has a unique title
- every page has a one-sentence purpose
- every page explains what happens next
- every page has one primary CTA
- every page has a visible next best action
- background actions never feel silent or broken
- failures explain what is preserved and what can be retried
- `Gold MLV Manager` is part of Gold Studio, not an orphan page
- lifecycle stages are visible globally
- the entire flow can be presented coherently to non-experts

## Recommended First Build Slice

The first implementation slice should be:

1. `GoldStudioLayout` shell redesign
2. nav label and location cleanup
3. `GoldClusters` stats contract fix
4. `Release` page narrowing and messaging cleanup

That slice gives the biggest immediate gain in coherence, trust, and presentability without having to rebuild all six pages at once.
