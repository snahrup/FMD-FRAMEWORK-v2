# FMD_FRAMEWORK Test Strategy

> **Owner**: QA Lead (Sentinel)
> **Created**: 2026-03-09
> **Status**: ACTIVE
> **Approved by**: Pending CTO review

---

## Executive Summary

The FMD_FRAMEWORK has near-zero test coverage on its most critical paths. 106 API endpoints have zero tests. 93.5% of engine code is untested. 6 stored procedures have no validation. The local SQLite control plane (29 functions, 17 tables) that serves as the primary data source for the entire dashboard has zero tests.

Playwright E2E exists (~189 tests) but covers only page load and data scraping -- no interaction, error state, or component-level testing.

This strategy prioritizes by **blast radius**: what breaks the most things if it fails?

---

## Prioritization Framework

### Tier 0 -- BLOCKING (must pass before any ship decision)

These are the DEFINITION-OF-DONE hard gates.

1. **`control_plane_db.py` unit tests** -- 17 tables, 16 write functions, 13 read functions. Pure Python + SQLite. Testable immediately with zero infrastructure. Highest ROI.
2. **Engine core tests** -- `orchestrator.py`, `preflight.py`, `models.py` expansion. These control pipeline execution for 1,666 entities.
3. **Playwright smoke suite passing** -- `smoke.spec.ts` must pass for all 8 critical pages.
4. **Static analysis clean** -- TypeScript build, CodeQL, Semgrep zero high/critical.

### Tier 1 -- HIGH (blocks confidence in production readiness)

5. **API endpoint smoke tests** -- Top 20 most-used endpoints. GET endpoints return 200 with expected shape. POST endpoints validate input.
6. **Engine `notebook_trigger.py` tests** -- Mock Fabric API, test polling logic, timeout handling, error states.
7. **Engine `logging_db.py` tests** -- Dual-write to SQLite + Fabric SQL. Test failure isolation (Fabric failure must not block SQLite).
8. **Playwright audit suite passing** -- `fmd-dashboard-audit.spec.ts` cross-page consistency.

### Tier 2 -- MEDIUM (improves reliability)

9. **Engine `loader.py` + `extractor.py` tests** -- Data loading edge cases, connection failures.
10. **Engine `auth.py` tests** -- Token acquisition, struct packing, scope validation.
11. **API destructive endpoint tests** -- `/api/sources/purge`, `/api/entities/bulk-delete`. Verify safety guards.
12. **Playwright MRI suite** -- 118 tests, priority-ordered functional coverage.

### Tier 3 -- STRETCH (nice-to-have)

13. **React component unit tests** (Vitest + Testing Library)
14. **Stored procedure integration tests** (requires Fabric SQL connection)
15. **Performance tests** (Control Plane load time, Execution Matrix render time)
16. **Visual regression baselines** (MRI screenshots)

---

## Test Pyramid Target

```
                    /\
                   /  \
                  / E2E \        <- Playwright (exists: ~189 tests)
                 /________\
                /          \
               / Integration \   <- API tests + SQLite tests (GAP: 0)
              /______________\
             /                \
            /    Unit Tests     \  <- Engine + control_plane_db (exists: 31, need: 200+)
           /____________________\
```

**Current state**: Inverted pyramid. Many E2E tests, almost no unit tests, zero integration tests.
**Target state**: 200+ unit tests, 50+ integration tests, E2E tests as-is.

---

## Phase 1: Foundation (Immediate -- This Sprint)

### 1a. `control_plane_db.py` Test Suite

**Why first**: This is the PRIMARY data source for all dashboard reads. If it's wrong, everything is wrong. It's pure Python + SQLite -- zero external dependencies.

**Test file**: `engine/tests/test_control_plane_db.py`
**Approach**:
- Create in-memory SQLite for each test (`:memory:`)
- Test all 16 write functions: insert, upsert, idempotency
- Test all 13 read functions: empty DB, single row, multiple rows
- Test WAL mode initialization
- Test concurrent access (threading)
- Test schema migration / table creation

**Expected count**: 60-80 tests
**Assignee**: QA Engineer

### 1b. Engine Core Expansion

**Test file**: `engine/tests/test_orchestrator.py`
**Approach**:
- Mock all external dependencies (SQL, Fabric API, OneLake)
- Test state machine transitions
- Test retry logic
- Test error handling paths
- Test entity filtering and batching

**Test file**: `engine/tests/test_preflight.py`
**Approach**:
- Mock SQL queries
- Test queue validation logic
- Test entity activation checks
- Test error reporting format

**Expected count**: 40-60 tests
**Assignee**: QA Engineer

### 1c. Existing Tests -- Verify Green

Before writing new tests, confirm the existing 31 pass:
```bash
cd engine && python -m pytest tests/ -v
```

If any fail, fix them first. Broken tests are worse than no tests.

---

## Phase 2: API Layer (Week 2)

### 2a. API Smoke Tests

**Test file**: `engine/tests/test_api_endpoints.py`
**Framework**: pytest + httpx (or urllib for consistency with codebase patterns)
**Approach**:
- Start server in test fixture
- GET endpoints: verify 200, verify JSON shape (keys exist)
- POST endpoints: verify input validation (400 on bad input)
- Test authentication gates on admin endpoints

**Priority endpoints** (in order):
1. `/api/health` -- always 200
2. `/api/config` -- returns valid JSON config
3. `/api/entities` -- returns array, each with expected keys
4. `/api/control-plane` -- returns dashboard data shape
5. `/api/stats` -- returns summary statistics
6. `/api/pipeline-view` -- returns pipeline status data
7. `/api/gateway-connections` -- returns connection list
8. `/api/datasources` -- returns datasource list
9. `/api/executive` -- returns executive dashboard data
10. `/api/error-intelligence` -- returns error data

**Expected count**: 30-40 tests
**Assignee**: QA Engineer

---

## Phase 3: Playwright Hardening (Week 3)

### 3a. Critical Page Functional Tests

For each of the 8 critical pages, add beyond smoke:
- Data renders (not just page loads)
- Key interactions work (click, filter, drill-down)
- No console errors
- Responsive at 1280x720

### 3b. Error State Testing

- API server down -- pages show graceful error, not crash
- Partial data -- pages handle missing fields
- Empty state -- pages show "no data" message, not blank

---

## Test Infrastructure Requirements

### Immediate Needs

| Need | Tool | Status |
|------|------|--------|
| Python test runner | pytest | AVAILABLE |
| Test fixtures / shared setup | conftest.py | MISSING -- create |
| Coverage reporting | pytest-cov | MISSING -- install |
| API test client | httpx or urllib | AVAILABLE (urllib in stdlib) |
| Mock framework | unittest.mock | AVAILABLE (stdlib) |
| Playwright | @playwright/test | CONFIGURED |
| CI pipeline | GitHub Actions | MISSING -- create |

### conftest.py Template

Create `engine/tests/conftest.py` with:
- In-memory SQLite fixture
- Mock Fabric API fixture
- Mock SQL Server connection fixture
- Temp directory fixture for file operations
- Common test data (sample entity, sample config)

---

## Quality Gates

### Before Any Code Ships

1. All existing tests pass (31 engine + Playwright smoke)
2. New tests for changed files pass
3. TypeScript build clean (`npm run build`)
4. No new console errors on 8 critical pages

### Before "Done" Declaration

Per DEFINITION-OF-DONE Section 6:
- [ ] `pytest` passes with zero failures
- [ ] Engine tests cover core orchestration paths
- [ ] Playwright E2E for all 8 critical pages
- [ ] All E2E pass in CI-equivalent run
- [ ] CodeQL scan clean
- [ ] Semgrep scan clean
- [ ] TypeScript build zero errors

---

## Reporting

### Test Run Reports

Every test run produces:
```
knowledge/qa/test-reports/{date}-{suite}-{run-id}.md
```

Format:
```
## Test Run: {suite}
Date: {date}
Runner: {agent}
Duration: {seconds}s

### Results
- Pass: N
- Fail: N
- Skip: N
- Flake: N

### Failures (if any)
1. test_name -- error message -- file:line
```

### Convergence Tracking

Per deliverable:
```
knowledge/qa/convergence/{issue-id}.md

| Iteration | Date | Pass | Fail | Flake | New Bugs | Fixed Bugs | Net Direction |
```

---

## Coordination

- **QA Lead** (me): Defines strategy, reviews results, certifies/blocks, tracks convergence
- **QA Engineer** (cb5bb7ef): Writes and runs tests per QA Lead direction
- **CTO/Architect** (ab4f046c): Approves strategy, arbitrates disputes, merges code
- **IPC-5** (agent 0b0988e3): Currently setting up Playwright infrastructure -- coordinate to avoid duplication
