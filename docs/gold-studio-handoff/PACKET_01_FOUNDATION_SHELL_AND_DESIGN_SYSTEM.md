# PACKET 01 — Foundation Shell and Design System

    ## Objective

    Create the Gold Studio application shell inside the existing dashboard so every later page inherits the correct layout, navigation, tokens, and slide-over framing.

    ## Scope


Implement only the foundational UI frame for Gold Studio:

- register the Gold Studio sidebar entry in the engineering console
- create or wire the `/gold/ledger`, `/gold/clusters`, `/gold/canonical`, `/gold/specs`, and `/gold/validation` routes
- create the shared Gold Studio page shell:
  - top title area
  - internal horizontal sub-nav
  - sticky stats-strip slot
  - sticky filter-bar slot
  - main content region
- create shared design tokens and reusable UI primitives needed by later packets:
  - warm paper canvas
  - surface-1
  - surface-inset
  - borders-only elevation
  - type badge
  - status badge
  - status rail helper
  - provenance thread component shell
  - shared slide-over shell
- create placeholder page components for the five Gold Studio pages using the shared shell


    ## Explicit non-scope


Do not implement:
- real data fetching
- database migrations
- parser logic
- import modal logic
- Ledger accordion contents
- cluster card behavior
- canonical relationship graph
- validation workflows

This packet is about the frame, not the product internals.


    ## Files likely to change


- app sidebar/nav registration files
- route registration files
- Gold Studio page folder/module
- shared design system/theme/token files
- shared UI component folder for badges/thread/slide-over


    ## Source references


- `00_GOLD_STUDIO_FINAL_SPEC.md` sections 1, 2, 3, and 11
- `02_GUARDRAILS_AND_INVARIANTS.md` UI and provenance sections


    ## Required deliverables


- shared Gold Studio layout component
- shared horizontal sub-nav
- token/theme additions or local module styles
- `ProvenanceThread` presentational component with configurable phase states
- generic `GoldStudioSlideOver` shell with header / tab strip / content / footer slots
- five page stubs wired to routes and visually aligned to the spec


    ## Acceptance criteria


- Gold Studio appears in the sidebar in the correct location
- all five routes render without crashing
- each page uses the shared shell and horizontal Gold Studio nav
- the design language matches the spec:
  - warm paper canvas
  - copper accent
  - zero shadows
  - borders-only depth
- the slide-over shell exists and can be demoed with stub content
- no page-specific business logic is hardcoded into the shared shell


    ## Packet-specific notes


Treat this as infrastructure for every later packet. Reusability matters more than pixel-perfect page internals here.


    ## Required completion output

    Use the completion format from `03_CLAUDE_CODE_OPERATOR_INSTRUCTIONS.md`.
