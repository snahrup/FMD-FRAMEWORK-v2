# PACKET 03 — FastAPI Route Scaffolding

    ## Objective

    Create the Gold Studio FastAPI route module and resource group structure with typed request/response contracts and stubbed service boundaries, without implementing heavy business logic yet.

    ## Scope


Implement the route scaffolding for:
- specimens
- entities
- clusters
- canonical
- semantic definitions
- specs
- validation
- catalog
- jobs
- audit
- stats
- field usage

Create:
- router registration
- path structure
- request/response schemas
- placeholder service/repository boundaries
- role guard hooks where required
- pagination/filter parameter handling


    ## Explicit non-scope


Do not implement:
- heavy extraction logic
- validation execution
- cluster detection logic
- actual catalog sync
- full business workflows

This packet is route and contract scaffolding, not end-to-end feature completion.


    ## Files likely to change


- API route registration files
- new `gold_studio.py` route module or equivalent split modules
- schema/DTO files
- auth dependency files only if needed to register new permissions


    ## Source references


- `00_GOLD_STUDIO_FINAL_SPEC.md` API route tables in section 10
- `03_CLAUDE_CODE_OPERATOR_INSTRUCTIONS.md`


    ## Required deliverables


- route module(s) under the dashboard API
- Pydantic models / DTOs / schemas
- filter parameter models
- auth/role guard wiring for the new endpoints
- service interfaces or stubs for later implementation


    ## Acceptance criteria


- all documented endpoint groups exist with correct FastAPI path syntax
- route registration works without crashing app startup
- role restrictions are wired at least at the endpoint guard level
- list endpoints support `limit` and `offset`
- no endpoint path format uses Express-style `/:id`
- endpoint names and resource groupings match the spec closely


    ## Packet-specific notes


Keep the service layer thin and obvious. Do not bury packet-specific logic in route functions.


    ## Required completion output

    Use the completion format from `03_CLAUDE_CODE_OPERATOR_INSTRUCTIONS.md`.
