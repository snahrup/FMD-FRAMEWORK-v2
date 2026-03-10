# Test Coverage Map

> **Owner**: QA Lead (Sentinel)
> **Created**: 2026-03-09
> **Last Updated**: 2026-03-09

---

## Summary

| Metric | Value |
|--------|-------|
| Total API endpoints | 106 |
| API endpoints with tests | 0 |
| Engine modules | 14 (6,291 LOC) |
| Engine modules with tests | 3 (models, api helpers, config) |
| Engine test functions | 31 |
| Engine code coverage estimate | ~6.5% |
| Dashboard pages | 40+ |
| Dashboard pages with smoke test | 40+ (smoke.spec.ts) |
| Playwright test files | 4 (audit, MRI, smoke, teardown) |
| Playwright test functions | ~189 |
| Stored procedures tested | 0 of 6 |
| Integration tests | 0 |

---

## Layer 1: Engine Unit Tests (`engine/tests/`)

| Module | File | LOC | Tests Exist | Test Count | Coverage Level | Priority |
|--------|------|-----|-------------|------------|----------------|----------|
| models | `models.py` | 236 | YES | 12 | MODERATE | Medium |
| api helpers | `api.py` | 2,213 | YES | 11 | LOW (helpers only) | HIGH |
| config | `config.py` | 131 | YES | 8 | MODERATE | Medium |
| orchestrator | `orchestrator.py` | 865 | NO | 0 | 0% | **CRITICAL** |
| logging_db | `logging_db.py` | 630 | NO | 0 | 0% | **CRITICAL** |
| notebook_trigger | `notebook_trigger.py` | 372 | NO | 0 | 0% | HIGH |
| extractor | `extractor.py` | 302 | NO | 0 | 0% | HIGH |
| pipeline_runner | `pipeline_runner.py` | 269 | NO | 0 | 0% | HIGH |
| preflight | `preflight.py` | 262 | NO | 0 | 0% | HIGH |
| loader | `loader.py` | 217 | NO | 0 | 0% | HIGH |
| auth | `auth.py` | 186 | NO | 0 | 0% | HIGH |
| connections | `connections.py` | 180 | NO | 0 | 0% | Medium |
| smoke_test | `smoke_test.py` | 147 | NO | 0 | 0% | Low |
| deploy_schema | `sql/deploy_schema.py` | 281 | NO | 0 | 0% | Medium |

**Untested engine code**: ~5,880 LOC (93.5%)

---

## Layer 2: API Endpoint Tests (`dashboard/app/api/server.py`)

**Status**: ZERO dedicated API tests. 106 endpoints, 11,080 LOC.

### Critical Endpoints (must test first)

| Endpoint | Method | Category | Risk | Notes |
|----------|--------|----------|------|-------|
| `/api/health` | GET | Core | HIGH | Foundation for all other tests |
| `/api/config` | GET | Core | HIGH | Config drives all behavior |
| `/api/entities` | GET | Data | CRITICAL | 1,666 entities, core data |
| `/api/control-plane` | GET | Dashboard | CRITICAL | Primary dashboard data source |
| `/api/entity-digest/resync` | POST | Data | CRITICAL | Writes to SQLite |
| `/api/runner/trigger` | POST | Engine | CRITICAL | Triggers pipeline execution |
| `/api/deploy/start` | POST | Deploy | CRITICAL | Starts 17-phase deployment |
| `/api/onboarding` | POST | Setup | CRITICAL | Source onboarding wizard |
| `/api/register-bronze-silver` | POST | Data | HIGH | Entity layer registration |
| `/api/sources/purge` | POST | Destructive | CRITICAL | Deletes source data |

### By Category (106 total)

| Category | Count | Tests | Priority |
|----------|-------|-------|----------|
| Admin & Config | 8 | 0 | HIGH |
| Execution & Monitoring | 18 | 0 | CRITICAL |
| Entities & Schema | 13 | 0 | CRITICAL |
| Data Access & Connectivity | 14 | 0 | HIGH |
| Data Blender | 6 | 0 | MEDIUM |
| Dashboard Views | 16 | 0 | HIGH |
| Testing & MRI | 10 | 0 | LOW |
| Maintenance | 7 | 0 | MEDIUM |
| Setup & Provisioning | 10 | 0 | HIGH |

---

## Layer 3: Playwright E2E Tests (`dashboard/app/tests/`)

| Test File | Tests | Purpose | Status |
|-----------|-------|---------|--------|
| `smoke.spec.ts` | 3 | Page load verification (40+ routes) | EXISTS |
| `fmd-dashboard-audit.spec.ts` | 68 | Cross-page data consistency | EXISTS |
| `mri-test-plan.spec.ts` | 118 | Priority-ordered functional tests | EXISTS |
| `global-teardown.ts` | -- | Artifact archival | EXISTS |

### 8 Critical Pages (per DEFINITION-OF-DONE)

| Page | Smoke | Audit | MRI | Component | Status |
|------|-------|-------|-----|-----------|--------|
| Execution Matrix | YES | YES | YES | NO | Partial |
| Engine Control | YES | YES | YES | NO | Partial |
| Control Plane | YES | YES | YES | NO | Partial |
| Live Monitor | YES | YES | YES | NO | Partial |
| Record Counts | YES | YES | YES | NO | Partial |
| Source Manager | YES | YES | YES | NO | Partial |
| Environment Setup | YES | YES | YES | NO | Partial |
| Execution Log | YES | YES | YES | NO | Partial |

**Gap**: No component-level unit tests. No error state testing. No interaction testing beyond page load.

---

## Layer 4: SQL / Stored Procedures

| Procedure | Schema | Purpose | Tests | Priority |
|-----------|--------|---------|-------|----------|
| `sp_UpsertPipelineLandingzoneEntity` | execution | LZ queue management | 0 | HIGH |
| `sp_UpsertPipelineBronzeLayerEntity` | execution | Bronze queue management | 0 | HIGH |
| `sp_UpsertEngineRun` | execution | Run tracking | 0 | HIGH |
| `sp_InsertEngineTaskLog` | execution | Task logging | 0 | MEDIUM |
| `sp_UpsertEntityStatus` | execution | Status aggregation | 0 | MEDIUM |
| `sp_BuildEntityDigest` | execution | Entity digest | 0 | HIGH |

**Note**: These require a Fabric SQL Database connection. Cannot test locally without mock/stub layer.

---

## Layer 5: Local SQLite (`control_plane_db.py`)

| Area | Tests | Priority |
|------|-------|----------|
| 17 table schemas | 0 | HIGH |
| 16 write functions | 0 | CRITICAL |
| 13 read functions | 0 | CRITICAL |
| WAL mode / concurrency | 0 | HIGH |
| Dual-write sync | 0 | HIGH |

**Note**: This IS testable locally. Pure Python + SQLite. Highest ROI for new tests.

---

## Test Infrastructure Status

| Component | Status | Notes |
|-----------|--------|-------|
| pytest | AVAILABLE | `engine/tests/` uses pytest |
| Playwright | CONFIGURED | `dashboard/app/playwright.config.ts` exists |
| conftest.py | MISSING | No shared fixtures for engine tests |
| CI pipeline | MISSING | No GitHub Actions / CI for tests |
| Test data fixtures | MISSING | No synthetic test data |
| API test framework | MISSING | No httpx/requests test client for server.py |
| Coverage reporting | MISSING | No pytest-cov or equivalent |
