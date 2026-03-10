# FMD Framework - Specification Directory

> **Created**: 2026-03-09 by sage-tower
> **Purpose**: Next-level detailed specifications for agent execution and validation
> **Template**: Based on Auto-Claude spec format

---

## Overview

This directory contains comprehensive, implementation-ready specifications for all FMD Framework tasks. Each spec includes:

✅ **Complete technical architecture** - Exact file paths, database schemas, API endpoints
✅ **Code examples** - Python, TypeScript, SQL snippets ready to copy/paste
✅ **Detailed acceptance criteria** - Binary pass/fail gates
✅ **Test execution commands** - Exact bash/pytest commands to run
✅ **Implementation steps** - Numbered, actionable steps
✅ **Success metrics** - Quantifiable targets (coverage %, row counts, performance)
✅ **Edge cases & gotchas** - What to watch out for
✅ **Dependencies** - Upstream blockers and downstream impacts

---

## Spec Status

| Status | Count | Directory | Description |
|--------|-------|-----------|-------------|
| Pending | 4 | `specs/pending/` | Ready to implement, waiting for agent assignment |
| In Progress | 0 | `specs/in-progress/` | Currently being worked on |
| Completed | 0 | `specs/completed/` | Fully implemented and validated |

---

## Completed Specs

### 001: Verify Bronze→Silver 100-Entity Activation
**Priority**: CRITICAL | **Category**: testing | **Owner**: sage-tower

Validates that exactly 100 entities are activated for Silver processing as a Phase 1 validation batch before full 1,666-entity rollout.

**Key Deliverables**:
- Python activation script with plan/execute modes
- SQL stored procedure `sp_ActivateEntitiesForSilver`
- Pytest test suite (6 tests) validating exact count, Bronze data, source coverage
- Stratified sampling across all 5 source systems

**Acceptance Gate**: `SELECT COUNT(*) FROM execution.entity_loading_status WHERE is_silver_active = 1` → 100

**File**: `specs/pending/001-verify-bronze-silver-100-entity-activation.md`

---

### 002: Execute Full Bronze→Silver Load and Verify Success
**Priority**: CRITICAL | **Category**: feature | **Owner**: ralph-engine

Executes the complete Bronze→Silver load for all 1,666 entities using the Silver processing notebook, validates 100% success rate, and verifies SCD Type 2 columns.

**Key Deliverables**:
- Activation script for remaining 1,566 entities
- Monitoring script for real-time progress tracking
- Pytest validation suite (6 tests) for row counts, status, errors
- Dashboard integration showing 100% Silver completion

**Acceptance Gate**: All 1,666 entities have `silver_status = 'succeeded'`, zero failures

**File**: `specs/pending/002-execute-full-bronze-silver-load-and-verify-success.md`

---

### 005: Write control_plane_db.py Unit Test Suite
**Priority**: HIGH | **Category**: testing | **Owner**: sage-tower

Creates comprehensive pytest unit tests for the local SQLite control plane database with 60-80% code coverage.

**Key Deliverables**:
- 26 pytest tests covering schema, CRUD, run tracking, metrics, concurrency
- Code coverage report (target: 60-80%)
- Performance tests (bulk insert < 2s, query < 0.5s)
- Concurrency tests for thread-safe writes

**Acceptance Gate**: `pytest --cov=control_plane_db --cov-report=term` → 60-80% coverage, all tests pass

**File**: `specs/pending/005-write-control-plane-db-py-unit-test-suite.md`

---

### 010: Complete ExecutionMatrix Page (Tier 1 - All 40 Assertions)
**Priority**: CRITICAL | **Category**: ui_ux | **Owner**: ux-hype

Implements the fully functional Execution Matrix dashboard page with all 40 test assertions from TEST-PLAN.md passing.

**Key Deliverables**:
- React components: ExecutionMatrix, KPICard, EntityTable, PieChart
- Data hooks: useEntityDigest, useEngineStatus
- Filtering, search, sorting, drill-down functionality
- Playwright e2e test suite (40 tests)

**Acceptance Gate**: All 40 Playwright tests pass, page loads < 5s, KPIs match API data

**File**: `specs/pending/010-complete-executionmatrix-page-tier-1.md`

---

## Spec Template Structure

Each spec follows this format:

```markdown
# Spec XXX: [Task Title]

> Metadata (priority, category, complexity, impact, owner, dependencies)

## User Story
As a [role], I want [feature], so that [benefit]

## Context & Background
- Current state
- Problem statement
- Success criteria (binary gates from DEFINITION-OF-DONE.md)

## Technical Architecture
- File paths, database schemas, API endpoints
- Code examples (Python, TypeScript, SQL)
- Data flow diagrams

## Implementation Steps
1. Step-by-step instructions
2. Exact commands to run
3. Expected outputs

## Acceptance Criteria
| ID | Criterion | Verification Method |
|----|-----------|-------------------|
| AC-1 | ... | SQL query / pytest / curl |

## Dependencies
- Upstream (must complete first)
- Downstream (blocked by this)

## Success Metrics
| Metric | Target | Measurement |
|--------|--------|-------------|
| Coverage | 80% | pytest-cov |

## Notes & Gotchas
- Edge cases
- Performance considerations
- What to watch out for

## References
- Links to knowledge base, related specs, documentation
```

---

## How to Use These Specs

### For Agents (Automated Execution)

1. **Read the spec** - Full context in one file
2. **Execute implementation steps** - Follow numbered steps
3. **Run verification commands** - Copy/paste exact commands
4. **Validate acceptance criteria** - Binary pass/fail gates
5. **Move spec to `completed/`** - After all ACs pass

### For Humans (Review & Planning)

1. **Prioritize specs** - Use Priority field (CRITICAL > HIGH > MEDIUM)
2. **Assign owners** - Match to agent specialization
3. **Track dependencies** - Don't start blocked tasks
4. **Review success metrics** - Ensure targets are achievable
5. **Approve completion** - Verify all ACs passed

---

## Spec Creation Guidelines

When creating new specs, ensure:

✅ **Specificity over generality** - Exact file paths, not "somewhere in src/"
✅ **Code over prose** - Show implementation, don't just describe it
✅ **Testability** - Every AC must have a verification command
✅ **Self-contained** - Reader shouldn't need external docs to implement
✅ **Realistic** - Success metrics must be achievable
✅ **Actionable** - Steps must be clear enough for junior dev to follow

---

## Next Steps

### Immediate Priorities (Next 3 Days)

1. **Execute Spec 001** - Validate 100-entity Silver activation
2. **Execute Spec 005** - Build control plane DB test suite
3. **Execute Spec 010** - Complete ExecutionMatrix page
4. **Execute Spec 002** - Full Silver load (after 001 passes)

### Medium-Term (Next 2 Weeks)

- Create specs for remaining 6 dashboard pages
- Create spec for engine core test coverage expansion (40-60%)
- Create spec for API endpoint smoke test suite (30-40 tests)
- Create spec for Playwright e2e suite (8 critical pages)

### Long-Term (Next Month)

- Create specs for Gold layer implementation
- Create specs for data quality validation rules
- Create specs for production deployment pipeline
- Create specs for operational runbooks

---

## Spec Metrics

| Metric | Current | Target (End of Month) |
|--------|---------|----------------------|
| Total specs | 4 | 25+ |
| Completed specs | 0 | 15+ |
| Test coverage | ~20% | 60%+ |
| Dashboard pages complete | 0/8 | 8/8 |
| Critical path blockers | 4 | 0 |

---

## Questions or Issues?

- **Missing details in a spec?** → Create GitHub issue with `spec-clarity` label
- **Implementation blocked?** → Check Dependencies section, resolve upstream blockers first
- **Acceptance criteria unclear?** → Ping spec owner (listed in metadata)
- **Need new spec created?** → Use this template, follow guidelines above

---

**Maintained By**: sage-tower (Spec Architect)
**Last Updated**: 2026-03-09
**Spec Count**: 4 pending, 0 in-progress, 0 completed
