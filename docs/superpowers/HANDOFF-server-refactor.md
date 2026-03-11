# Server Refactor Handoff — cool-vault -> next session

## What This Is

Complete handoff for executing the FMD Framework server refactor. Everything is designed, reviewed, and ready to implement.

## Documents (READ ALL THREE BEFORE STARTING)

1. **Design Spec** (APPROVED, 0 blockers): `docs/superpowers/specs/2026-03-11-server-refactor-design.md`
2. **Implementation Plan** (APPROVED, 25 tasks): `docs/superpowers/plans/2026-03-11-server-refactor.md`
3. **Architecture Diagram**: `docs/superpowers/specs/server-refactor-architecture.excalidraw` (PNG at `.png`)

## What We're Doing

Replacing the **9,267-line `dashboard/app/api/server.py` monolith** with:
- **Route registry** with `@route("GET", "/api/...")` decorator pattern replacing 125 elif clauses
- **SQLite as single source of truth** — eliminating Fabric SQL database entirely
- **Parquet write-behind** — SQLite changes export to Parquet for OneLake
- **Delta read-behind** — notebook-written Delta tables ingest back into SQLite
- **Database Explorer** — new dashboard page for browsing SQLite

## The Plan Structure

**25 tasks, 4 chunks**, each chunk produces a deployable system:

| Chunk | Tasks | What It Does |
|-------|-------|-------------|
| 1: Route Registry Foundation | 1-9 | Build router.py, db.py, extract all route modules from server.py monolith, rewrite server.py to ~200 lines, deploy to vsc-fabric |
| 2: Full SQLite Migration | 10-18 | Expand SQLite schema, migrate engine/logging_db.py + engine/api.py to SQLite-only, delete MetadataDB class, build parquet_sync.py + delta_ingest.py, seed SQLite from Fabric SQL, deploy |
| 3: Notebook + Pipeline Migration | 19-21 | Update 4 Fabric notebooks to write Delta instead of stored procs, update 21 pipeline JSONs, upload to Fabric, test end-to-end |
| 4: DB Explorer + Scorched Earth | 22-25 | Build Database Explorer backend + React page, purge ALL Fabric SQL references from entire codebase, final validation + deploy |

## Execution Method

Use **`superpowers:subagent-driven-development`** as specified in the plan header:
- Fresh subagent per task (no context pollution)
- Two-stage review after each: spec compliance first, then code quality
- The plan has all task text, code snippets, test code, and commit messages inline

## Critical Corrections Baked Into Plan

These were found during two rounds of plan review and are already fixed in the plan:

1. **`engine/connections.py`** — Only delete `MetadataDB` (lines 24-115). `SourceConnection` (117-167) MUST survive for on-prem ODBC
2. **SQLite table names** — Use actual names: `pipeline_audit` (not `pipeline_executions`), `copy_activity_audit` (not `copy_activity_executions`), `entity_status` (not `entity_status_summary`), `sync_metadata` (not `sync_status`)
3. **`engine/preflight.py` + `engine/smoke_test.py`** — Both import MetadataDB, must be updated in Task 13
4. **`deploy_from_scratch.py`** — Lives at project root, NOT in `scripts/`
5. **Phase 2/3 bridge** — Task 16 seeds SQLite from Fabric SQL to bridge the gap until notebooks write Delta (Phase 3)
6. **Security fixes** — 5 are coded into the extraction tasks (SQL injection x3, ODBC injection, admin auth bypass). #6 (hardcoded creds) was already fixed in frontend audit

## Key Files to Know

| File | Lines | Role |
|------|-------|------|
| `dashboard/app/api/server.py` | 9,267 | THE monolith being decomposed |
| `dashboard/app/api/control_plane_db.py` | 979 | SQLite CRUD layer (17 tables, stays as-is) |
| `engine/api.py` | 1,379 | Engine endpoints (33 query_sql calls to migrate) |
| `engine/logging_db.py` | 647 | Audit logging (dual-write, delete Fabric SQL path) |
| `engine/connections.py` | 181 | MetadataDB (delete) + SourceConnection (keep) |
| `dashboard/app/api/config.json` | ~50 | Has `sql` section to remove |

## What NOT To Do

- Do NOT delete `SourceConnection` or `build_source_map` from `engine/connections.py`
- Do NOT use PascalCase table names from the spec — use actual lowercase names from `control_plane_db.py`
- Do NOT reference `antigravity/fabric_notebook_runner.py` — it doesn't exist
- Do NOT run tasks in parallel — they have sequential dependencies within each chunk
- Do NOT skip the two-stage review (spec compliance then code quality)

## Timeline

Realistic: **8-10 working days**. The spec's 5-day estimate is aggressive.

## How To Start

```
1. Read the plan: docs/superpowers/plans/2026-03-11-server-refactor.md
2. Read the spec: docs/superpowers/specs/2026-03-11-server-refactor-design.md
3. Invoke superpowers:subagent-driven-development
4. Start with Task 1 (router.py)
```

## Session History

- **cool-vault** (this session): Wrote design spec, ran 2 spec review rounds (fixed 15+ issues), created Excalidraw architecture diagram, wrote 25-task implementation plan, ran 2 plan reviews (fixed 4 blockers + 9 majors), got final APPROVED verdict
- All artifacts are committed and ready
