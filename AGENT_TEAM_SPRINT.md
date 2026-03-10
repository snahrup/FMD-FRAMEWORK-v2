# FMD Framework — Agent Team Sprint Spec

> **Purpose**: Hand this to a Claude Code agent team session. It defines all tasks, dependencies, ownership, and acceptance criteria for the Definition-of-Done sprint.
> **Generated**: 2026-03-09 by swift-forge
> **Source of truth**: `knowledge/DEFINITION-OF-DONE.md`

---

## Current State (Pre-Sprint Baseline)

These are ALREADY DONE — do not redo:

| Item | Status | Evidence |
|------|--------|----------|
| pytest (143 tests) | PASSING | `python -m pytest engine/tests/ -v` — 143 passed, 0 failed |
| TypeScript build | CLEAN | `npm run build` from `dashboard/app/` — zero errors |
| Playwright test file | EXISTS | `dashboard/app/tests/critical-pages.spec.ts` — 51 tests, 879 lines |
| Config notebook IDs | FIXED | `config.json` engine section synced to `item_deployment.json` |
| `control_plane_db.py` | EXISTS | `dashboard/app/api/control_plane_db.py` — 17 tables, WAL mode, not yet wired into server.py |
| Entity registration | DONE | 1,666 entities x 3 layers = 4,998 registrations |
| Knowledge base | DONE | 12 documents under `knowledge/` |
| Git baseline | COMMITTED | `1535ada` — 377 files, clean working tree |

---

## Team Composition

Spawn these teammates. Each has a defined file ownership zone — teammates must NOT modify files outside their zone without team lead approval.

| Teammate Name | Role | File Ownership | Model |
|---------------|------|---------------|-------|
| `api-lead` | Server/Backend | `dashboard/app/api/server.py`, `dashboard/app/api/*.py`, `dashboard/app/api/*.json` | claude-opus-4-6 |
| `frontend-lead` | Dashboard UI | `dashboard/app/src/**` (pages, components, hooks, types, styles, App.tsx) | claude-opus-4-6 |
| `engine-lead` | Pipeline Engine | `engine/*.py`, `engine/tests/test_*.py` | claude-opus-4-6 |
| `qa-engineer` | Test Automation | `dashboard/app/tests/`, `engine/tests/test_integration_*.py` | claude-opus-4-6 |

### Agents NOT needed for this sprint:
- **DevOps Lead** — `deploy_from_scratch.py` is locked, no deployment work needed
- **Fabric Engineer** — Notebook/pipeline work requires Fabric access + VPN, not parallelizable
- **QA Lead** — Supervisory role, team lead handles this
- **UX Auditor** — Audit already done, report at `knowledge/UX-AUDIT-REPORT.md`
- **CTO** — Team lead acts as CTO for this sprint

---

## Tasks

### Task 1: Wire SQLite control plane into server.py
- **Owner**: `api-lead`
- **Priority**: P0 (blocks Tasks 3, 6)
- **Blocked by**: Nothing
- **Files**: `dashboard/app/api/server.py`, `dashboard/app/api/control_plane_db.py`

**Description**:
`control_plane_db.py` already exists with 17 tables, 16 write functions, and 13 read functions using SQLite WAL mode. `server.py` currently reads from Fabric SQL Analytics Endpoint which has 2-30 minute sync lag. Switch ALL read endpoints to use local SQLite.

**Acceptance criteria**:
- [ ] Import `control_plane_db` at top of `server.py`
- [ ] Initialize SQLite DB on server startup (call create/init tables)
- [ ] These endpoints read from SQLite (NOT Fabric SQL):
  - `/api/control-plane` — entity status summary
  - `/api/execution-matrix` — entity load status across LZ/Bronze/Silver layers
  - `/api/engine/runs` — run history
  - `/api/engine/status` — engine status
  - `/api/record-counts` — entity row counts by source
  - `/api/sources` — source system list with entity counts
  - `/api/entity-digest` — entity health digest
- [ ] Fabric SQL writes kept as best-effort secondary (fire-and-forget, wrapped in try/except)
- [ ] Background sync thread: every 30 min, pull latest from Fabric SQL → local SQLite
- [ ] Fallback: if SQLite DB doesn't exist yet, fall back to Fabric SQL gracefully
- [ ] Response shapes unchanged (same JSON structure as before)
- [ ] Server starts without errors: `cd dashboard/app/api && python server.py`

**Key context**:
- Patrick approved SQLite as PRIMARY data source (2026-03-09)
- Fabric SQL endpoint: `7xuydsw5a3hutnnj5z2ed72tam-...database.fabric.microsoft.com`
- SP auth uses `struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)`
- Read `control_plane_db.py` FIRST to understand all available functions

---

### Task 2: Fix Execution Log "status unknown" bug
- **Owner**: `frontend-lead`
- **Priority**: P0
- **Blocked by**: Nothing

**Description**:
The Execution Log page (`dashboard/app/src/pages/ExecutionLog.tsx`) shows "status unknown" for ALL entries. This is the primary monitoring page — flagged as Critical in the UX audit.

**Acceptance criteria**:
- [ ] Investigate what API endpoint ExecutionLog.tsx calls
- [ ] Check the status field mapping between API response and UI rendering
- [ ] Fix so actual statuses display (Succeeded, Failed, InProgress, Cancelled, etc.)
- [ ] Verify with `npm run build` — no TypeScript errors
- [ ] Page renders without console errors

---

### Task 3: Validate and fix 8 critical dashboard pages
- **Owner**: `frontend-lead`
- **Priority**: P0
- **Blocked by**: Task 1 (SQLite wiring affects data displayed)

**Description**:
Per DEFINITION-OF-DONE Section 5, these 8 pages MUST be fully functional:

| # | Page | Route | File | Key Requirements |
|---|------|-------|------|-----------------|
| 1 | Execution Matrix | `/execution-matrix` | `ExecutionMatrix.tsx` | 1,666 entities visible, status colors, drill-down |
| 2 | Engine Control | `/engine-control` | `EngineControl.tsx` | Live run monitoring, execution plan, duration KPI, start/stop |
| 3 | Control Plane | `/control-plane` | `ControlPlane.tsx` | Source systems, pipeline health, summary counts |
| 4 | Live Monitor | `/live-monitor` | `LiveMonitor.tsx` | Real-time status, auto-refresh |
| 5 | Record Counts | `/record-counts` | `RecordCounts.tsx` | Entity digest, source breakdown, row counts |
| 6 | Source Manager | `/source-manager` | `SourceManager.tsx` | 5 sources, entity counts, gateway status |
| 7 | Environment Setup | `/environment-setup` | `EnvironmentSetup.tsx` | Workspace/lakehouse/connection inventory |
| 8 | Execution Log | `/execution-log` | `ExecutionLog.tsx` | Historical runs, filterable, timestamps |

**Per-page acceptance**:
- [ ] Page loads without console errors
- [ ] Data displayed matches actual state (or shows clean empty state if no data)
- [ ] No loading spinners stuck indefinitely
- [ ] Responsive at 1280x720 viewport minimum
- [ ] No TypeScript errors in build

---

### Task 4: Clean up "Coming Soon" stub pages
- **Owner**: `frontend-lead`
- **Priority**: P1
- **Blocked by**: Nothing

**Description**:
UX audit found 8 of 30 pages are non-functional "Coming Soon" placeholders. These erode user trust. For each stub page:
- If backend data exists → wire it up
- If not → remove from sidebar nav (keep the route/component for future)

**Acceptance criteria**:
- [ ] Identify all "Coming Soon" pages in `dashboard/app/src/pages/`
- [ ] Remove them from nav in `AppLayout.tsx` (or wire them up if data exists)
- [ ] Keep route definitions in `App.tsx` (so direct URLs still work, show "under construction")
- [ ] Sidebar nav only shows pages that actually work
- [ ] `npm run build` passes

---

### Task 5: Run and verify Playwright E2E tests
- **Owner**: `qa-engineer`
- **Priority**: P0
- **Blocked by**: Tasks 2, 3 (pages must work before testing them)

**Description**:
Test file exists at `dashboard/app/tests/critical-pages.spec.ts` (51 tests, 879 lines). Need to verify it runs.

**Acceptance criteria**:
- [ ] Install Playwright browsers: `cd dashboard/app && npx playwright install chromium`
- [ ] Start dev servers: Vite (`npm run dev`) + API (`cd api && python server.py`)
- [ ] Run tests: `npx playwright test tests/critical-pages.spec.ts`
- [ ] Fix any failing tests (update selectors, timeouts, assertions as needed)
- [ ] All 51 tests pass (or document known failures with rationale)
- [ ] Generate HTML report: `npx playwright show-report`

---

### Task 6: Run static analysis — CodeQL + Semgrep
- **Owner**: `qa-engineer`
- **Priority**: P1
- **Blocked by**: Nothing

**Description**:
DEFINITION-OF-DONE Section 6c requires clean static analysis scans.

**Acceptance criteria**:
- [ ] Run Semgrep: `semgrep --config .semgrep.yml .` (config exists at root)
- [ ] Zero high/critical Semgrep findings (medium/low OK to document)
- [ ] Verify `.github/workflows/codeql.yml` is correct for CI
- [ ] Verify `.github/workflows/semgrep.yml` is correct for CI
- [ ] Fix any high/critical findings in code
- [ ] TypeScript build clean: `cd dashboard/app && npm run build` (already passing)

---

### Task 7: Wire engine dual-write to local SQLite
- **Owner**: `engine-lead`
- **Priority**: P1
- **Blocked by**: Task 1 (needs SQLite schema initialized)

**Description**:
Per DEFINITION-OF-DONE Section 8: "Engine writes to local SQLite on every pipeline execution (landing, bronze, silver)." Currently `engine/logging_db.py` writes to Fabric SQL only. Add dual-write so every entity status update and run record also writes to the local SQLite via `control_plane_db.py`.

**Acceptance criteria**:
- [ ] `engine/logging_db.py` imports and calls `control_plane_db` write functions
- [ ] Every `sp_UpsertEntityStatus` call also writes to local SQLite
- [ ] Every `sp_UpsertEngineRun` call also writes to local SQLite
- [ ] SQLite write is primary (must succeed), Fabric SQL write is secondary (best-effort)
- [ ] Existing pytest tests still pass (143/143)
- [ ] Add tests for the dual-write path

---

### Task 8: Increase engine test coverage toward 60%
- **Owner**: `engine-lead`
- **Priority**: P2 (stretch goal)
- **Blocked by**: Task 7

**Description**:
DEFINITION-OF-DONE Section 7 stretch goal: engine module test coverage reaches 60%. Currently 143 tests pass but coverage percentage is unknown.

**Acceptance criteria**:
- [ ] Run `pytest --cov=engine engine/tests/ --cov-report=term-missing`
- [ ] Identify uncovered paths in orchestrator.py, loader.py, notebook_trigger.py
- [ ] Add tests for critical uncovered paths
- [ ] Coverage reaches 60% or higher
- [ ] All tests still pass

---

## Task Dependency Graph

```
Task 1 (SQLite wiring) ──┬──→ Task 3 (8 critical pages)
                          └──→ Task 7 (engine dual-write)
                                    └──→ Task 8 (test coverage)

Task 2 (Execution Log fix) ──→ Task 5 (Playwright E2E)
Task 3 (8 critical pages)  ──→ Task 5 (Playwright E2E)

Task 4 (Coming Soon cleanup) — independent
Task 6 (Static analysis)     — independent
```

## Parallel Execution Plan

**Wave 1** (immediate, no dependencies):
- `api-lead`: Task 1 (SQLite wiring)
- `frontend-lead`: Task 2 (Execution Log fix) + Task 4 (Coming Soon cleanup)
- `qa-engineer`: Task 6 (Static analysis)
- `engine-lead`: (idle — or start reading code for Task 7)

**Wave 2** (after Task 1 completes):
- `api-lead`: Review/assist on Task 3
- `frontend-lead`: Task 3 (validate 8 critical pages)
- `engine-lead`: Task 7 (engine dual-write)

**Wave 3** (after Tasks 2+3 complete):
- `qa-engineer`: Task 5 (run Playwright E2E)
- `engine-lead`: Task 8 (test coverage stretch)

---

## Key Reference Documents

Read these BEFORE starting work:

| Document | Path | Why |
|----------|------|-----|
| Definition of Done | `knowledge/DEFINITION-OF-DONE.md` | Master acceptance criteria |
| Current State | `knowledge/CURRENT-STATE.md` | System overview + knowledge index |
| Burned Bridges | `knowledge/BURNED-BRIDGES.md` | Dead ends — don't repeat these mistakes |
| UX Audit | `knowledge/UX-AUDIT-REPORT.md` | Page-by-page audit with grades |
| Backend Audit | `knowledge/engine/audit-backend.md` | Engine + API documentation |
| Frontend Audit | `knowledge/frontend/audit-pages.md` | All 38 pages with routes and API deps |
| Ownership Map | `knowledge/architecture/ownership-map.md` | Who owns what files |

---

## Critical Gotchas (from BURNED-BRIDGES.md)

1. **SQL Analytics Endpoint sync lag**: 2-30 minutes. NEVER trust it for reads. Use local SQLite.
2. **InvokePipeline is dead**: Fabric ignores SP auth on InvokePipeline. Use REST API direct triggers.
3. **SP token format**: `struct.pack(f'<I{len(token_bytes)}s', len(token_bytes), token_bytes)` — NOT the `<IH` variant.
4. **Rowversion/timestamp columns**: Binary types, can't compare as varchar. Exclude from watermark candidates.
5. **Workspace ID `a3a180ff`**: This is OLD. Current DATA workspace is `0596d0e7`. If you see `a3a180ff` anywhere, it's stale.
6. **`deploy_from_scratch.py` is LOCKED**: Only DevOps Lead can modify. If you need a change, file a request.

---

## Success Criteria

The sprint is DONE when:
- [ ] All 8 Task acceptance criteria sections are fully checked
- [ ] `python -m pytest engine/tests/ -v` — zero failures
- [ ] `cd dashboard/app && npm run build` — zero errors
- [ ] `npx playwright test` — all critical page tests pass
- [ ] `semgrep --config .semgrep.yml .` — zero high/critical findings
- [ ] All 8 critical dashboard pages load and display data without errors
- [ ] server.py reads from local SQLite, not Fabric SQL

When complete, update `knowledge/DEFINITION-OF-DONE.md` — check off every box that's been verified.
