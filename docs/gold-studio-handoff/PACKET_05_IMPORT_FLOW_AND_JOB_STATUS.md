# PACKET 05 — Import Flow and Job Status

    ## Objective

    Implement the Ledger import modal system and job-state UX, including Upload File, Paste SQL, and Bulk Import flows at the UI + endpoint integration layer.

    ## Scope


Build the import experience and its job-status feedback loop:

- Import button/dropdown on Ledger
- tabbed import modal with:
  - Upload File
  - Paste SQL
  - Bulk Import
- all required metadata fields per the spec
- file selection / drag-drop UI
- SQL editor area for paste flow
- bulk preview table with per-file override columns
- submit actions that call the scaffolded specimen endpoints / async job creation
- immediate specimen/job feedback after submission
- job-state display integration on Ledger rows
- edge-state UI messages:
  - unsupported file
  - partial bulk success
  - parse warning
  - parse failed
  - needs connection
  - schema pending

UI and endpoint wiring should be real where possible, while parser internals may still be stubbed.


    ## Explicit non-scope


Do not implement:
- full parser engines
- full schema discovery engine
- background workers beyond the minimum app-compatible job submission wiring
- duplicate detection
- later workflow stages

Keep the work bounded to import UX and job-state surfaces.


    ## Files likely to change


- Ledger import components
- modal/form components
- API client/hooks for specimen/job endpoints
- lightweight polling/state utilities if introduced


    ## Source references


- `00_GOLD_STUDIO_FINAL_SPEC.md` sections 4, 5, and 12
- `02_GUARDRAILS_AND_INVARIANTS.md` safety and async sections


    ## Required deliverables


- import dropdown/button wiring
- modal with three tabs
- form validation
- upload submission hooks
- job polling or refresh behavior, if lightweight and consistent with current app patterns
- edge-state messaging/toasts/banners


    ## Acceptance criteria


- import flows render correctly and are distinguishable
- metadata fields align with the spec
- submit actions create specimen/job records or hit the correct scaffolded endpoints
- Ledger can show queued/extracting/schema discovery/extracted/error states cleanly
- edge states do not leave the user in ambiguous UI limbo


    ## Packet-specific notes


If the repo already has a shared modal/form/input/dropzone pattern, reuse it instead of inventing a new one.


    ## Required completion output

    Use the completion format from `03_CLAUDE_CODE_OPERATOR_INSTRUCTIONS.md`.
