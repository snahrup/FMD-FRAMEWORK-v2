# Gold Studio — GitHub Inspiration Addendum

This addendum maps open-source projects and libraries to specific Gold Studio features so Claude Code has implementation inspiration without rethinking the product.

## Purpose
Use these references as implementation inspiration only. They are not the source of truth for product behavior. The Gold Studio spec remains authoritative.

## Repo-to-Feature Map

### 1) OpenMetadata
**Use for:** entity detail pages, metadata richness, lineage surfaces, governance posture, column-level metadata presentation.
**Gold Studio influence:** Ledger detail slide-overs, Canonical entity detail, Catalog publication metadata surfaces.
**Reference:** https://github.com/open-metadata/OpenMetadata

### 2) DataHub
**Use for:** ownership, glossary, metadata graph, certification/endorsement thinking, lifecycle posture.
**Gold Studio influence:** Catalog Registry, endorsement model, ownership/steward metadata, trust signaling.
**Reference:** https://github.com/datahub-project/datahub

### 3) Marquez
**Use for:** lineage graph clarity, operational metadata visualization, less-cluttered graph experiences.
**Gold Studio influence:** compact lineage diagrams, provenance-linked graph surfaces, Validation impact views.
**Reference:** https://github.com/MarquezProject/marquez

### 4) Amundsen
**Use for:** search-first registry UX, discoverability patterns, approachable catalog entry points.
**Gold Studio influence:** Ledger search/filter posture, Business Portal catalog entry views, browse-first discovery.
**Reference:** https://github.com/amundsen-io/amundsen

### 5) SQLMesh
**Use for:** impact analysis, SQL-first transformation workflows, lineage-aware change reasoning.
**Gold Studio influence:** Specifications page, Impact tab, revalidation and upstream-change communication.
**Reference:** https://github.com/TobikoData/sqlmesh

### 6) Dagster
**Use for:** asset-centric operational state thinking, checks, observability, readiness/status framing.
**Gold Studio influence:** Validation page posture, readiness states, job/asset health framing.
**Reference:** https://github.com/dagster-io/dagster

### 7) pbi-tools
**Use for:** PBIX/PBIP decomposition, source-control-friendly Power BI project handling.
**Gold Studio influence:** extraction pipeline strategy, Power BI artifact handling, PBIX/PBIP parser expectations.
**Reference:** https://github.com/pbi-tools/pbi-tools

### 8) Tabular Editor 2
**Use for:** semantic model object ergonomics, metadata browsing, model operations mental model.
**Gold Studio influence:** Canonical/semantic definition editing posture, metadata panels, model-centric object interactions.
**Reference:** https://github.com/TabularEditor/TabularEditor

### 9) DAX Studio
**Use for:** metadata browsing, object inspection, expert Power BI model ergonomics.
**Gold Studio influence:** entity detail surfaces, schema/query panes, technical inspection micro-interactions.
**Reference:** https://github.com/DaxStudio/DaxStudio

### 10) Bravo
**Use for:** cleaner, less intimidating Power BI analysis UI patterns.
**Gold Studio influence:** simplified expert workflows, approachable technical inspection surfaces.
**Reference:** https://github.com/sql-bi/Bravo

### 11) xyflow / React Flow
**Use for:** relationship maps, lineage mini-maps, interactive node/edge graph rendering.
**Gold Studio influence:** Canonical Relationship Map, lineage diagrams, future graph workspaces.
**Reference:** https://github.com/xyflow/xyflow

### 12) Storybook
**Use for:** code-first screen truth, isolated component states, UI review and acceptance references.
**Gold Studio influence:** component build packets, state variants, regression-safe UI development.
**Reference:** https://github.com/storybookjs/storybook

### 13) Penpot
**Use for:** high-fidelity reference screens, annotated design handoff, component library thinking.
**Gold Studio influence:** screen-by-screen reference mockups and design system documentation.
**Reference:** https://github.com/penpot/penpot

### 14) tldraw + Make Real
**Use for:** fast layout ideation, rough mockups, HTML-oriented screen exploration.
**Gold Studio influence:** early-screen exploration before hardening into code/story form.
**References:**
- https://github.com/tldraw/tldraw
- https://github.com/tldraw/make-real

### 15) Excalidraw
**Use for:** lightweight wireframes, IA sketches, flow diagrams.
**Gold Studio influence:** early workflow sketching and edge-state mapping.
**Reference:** https://github.com/excalidraw/excalidraw

## Claude Code Instructions
1. Do not copy any product wholesale.
2. Use these repos for interaction and presentation inspiration only.
3. Gold Studio spec and work packets remain authoritative over any repo pattern.
4. Prefer OpenMetadata/DataHub/Marquez for metadata and lineage posture.
5. Prefer pbi-tools/Tabular Editor/DAX Studio/Bravo for Power BI-specific object ergonomics.
6. Prefer Storybook and xyflow for actual implementation mechanics.
7. Prefer Penpot/tldraw/Excalidraw only for reference generation and UI exploration, not runtime dependencies.

## Priority Mapping by Gold Studio Area
- **Ledger:** OpenMetadata, Amundsen, DAX Studio, Bravo
- **Clusters:** custom implementation, lightly informed by Storybook for states and Penpot for visual references
- **Canonical:** OpenMetadata, DataHub, Tabular Editor, xyflow
- **Specifications:** SQLMesh, Dagster, DAX Studio
- **Validation:** Dagster, Marquez, SQLMesh
- **Catalog Registry:** DataHub, OpenMetadata, Amundsen
- **Graph Views:** xyflow, Marquez
- **Power BI extraction mental model:** pbi-tools, Tabular Editor, DAX Studio, Bravo

## Warning to Claude Code
These references are examples of good patterns, not permission to redesign Gold Studio into another product. Preserve Gold Studio vocabulary, provenance rules, object model, approval gates, and design system.
