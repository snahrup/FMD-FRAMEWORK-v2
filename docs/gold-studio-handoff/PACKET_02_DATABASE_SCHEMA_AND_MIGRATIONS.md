# PACKET 02 — Database Schema and Migrations

    ## Objective

    Implement the Gold Studio control-plane schema in SQLite with the documented tables, constraints, soft-delete behavior, root/version/current patterns, and indexes.

    ## Scope


Implement the database layer for Gold Studio based on the final spec:

- create migrations for all Gold Studio tables
- create partial unique indexes for single-current-version invariants
- add JSON validity checks where documented
- implement any migration helpers needed for SQLite compatibility
- ensure WAL-mode assumptions are compatible with the existing app bootstrap
- add any minimal DB access helpers/models required to support later route work

Focus on correctness, not app-level workflow logic.


    ## Explicit non-scope


Do not implement:
- route handlers
- background job execution logic
- parser code
- UI pages
- duplicate detection
- validation SQL execution

Do not silently alter the schema because something feels “cleaner.”
If a hard contradiction exists, surface it explicitly.


    ## Files likely to change


- migration directory / DB bootstrap files
- SQLite schema helpers
- repository/model definitions if present in current architecture


    ## Source references


- `00_GOLD_STUDIO_FINAL_SPEC.md` section 10
- `02_GUARDRAILS_AND_INVARIANTS.md` versioning, async, and catalog invariants


    ## Required deliverables


- migration files for all Gold Studio tables
- schema bootstrapping code or migration registry updates
- indexes and constraints required by the spec
- any lightweight typed models or repository helpers if the repo convention expects them


    ## Acceptance criteria


- all Gold Studio tables from the final spec are represented
- root/version/current rules are enforceable where required
- soft-delete strategy is consistent with the spec
- logical FK conventions are preserved where true DB FKs are not appropriate
- no table or endpoint counts are invented or drifted
- migrations can run on a clean DB
- migration names and placement match the repo’s existing convention


    ## Packet-specific notes


Be especially careful with:
- `root_id`
- `version`
- `is_current`
- `deleted_at`
- catalog vs endorsement separation
- semantic definitions as a separate table


    ## Required completion output

    Use the completion format from `03_CLAUDE_CODE_OPERATOR_INSTRUCTIONS.md`.
