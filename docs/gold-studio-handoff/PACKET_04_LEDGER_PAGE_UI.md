# PACKET 04 — Ledger Page UI

    ## Objective

    Implement the Ledger page UI in both By Specimen and By Extracted Entity modes using the shared Gold Studio shell and design system.

    ## Scope


Build the Ledger page UI including:

- stats strip with clickable stat cards/tiles or interactions stubbed for later filtering
- search/filter bar layout
- mode toggle: By Specimen / By Entity
- specimen list rows with:
  - left status rail
  - name
  - type badge
  - source system
  - steward
  - provenance thread
  - secondary summary line
  - job state badge
- inline accordion expansion for specimen rows
- inner tabs inside the expanded area:
  - Tables
  - Queries
  - Measures
  - Relationships
- top-N plus show-all behavior for nested tables
- metadata section at bottom of expansion
- extracted-entity flat mode row layout
- connection to stub/mock data only if real endpoints are not ready yet

Use the shared slide-over shell for clicking an extracted entity row/cell, but stub the panel contents as needed.


    ## Explicit non-scope


Do not implement:
- working import modal submission
- real parser execution
- schema discovery execution
- cluster resolution logic
- canonical promotion

Keep this packet focused on Ledger surface behavior and page anatomy.


    ## Files likely to change


- Ledger page files
- list/table/card components used by Ledger
- any mock data adapters or hook files used only for page rendering
- shared slide-over invocation state if centralized


    ## Source references


- `00_GOLD_STUDIO_FINAL_SPEC.md` sections 4 and 11
- the interface design sections for Ledger and universal slide-over


    ## Required deliverables


- Ledger page component
- specimen row component
- job state badge component or mapping
- nested tabbed accordion section
- extracted entity mode table/list
- hook(s) for page state, filters, toggles, expanded rows
- slide-over invocation wiring for entity detail


    ## Acceptance criteria


- Ledger visually matches the spec at a high level
- specimen rows are compact, dense, and readable
- provenance thread and job state are clearly separate
- accordion expansion uses inner tabs and avoids uncontrolled vertical sprawl
- By Specimen and By Entity modes are both present
- no generic placeholder dashboard styling overrides the Gold Studio design system


    ## Packet-specific notes


If the data layer is not ready, use explicit mock fixtures inside a clearly marked local module. Do not fake business logic beyond what is required to render the page.


    ## Required completion output

    Use the completion format from `03_CLAUDE_CODE_OPERATOR_INSTRUCTIONS.md`.
