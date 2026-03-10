# Ownership Map

## Agent → File Ownership (Non-Overlapping)

| Agent | Role | Owns | Model |
|-------|------|------|-------|
| **CTO** | Architecture Queen | Any file (review/fix only, delegates features) | claude-opus-4-6 |
| **Engine Lead** | Backend Architect | `engine/*.py`, `engine/tests/test_*.py` (unit tests for own modules) | claude-opus-4-6 |
| **API Lead** | Server Architect | `dashboard/app/api/server.py`, `dashboard/app/api/*.json`, `dashboard/app/api/*.py` | claude-opus-4-6 |
| **Frontend Lead** | UI Architect | `dashboard/app/src/**` (pages, components, hooks, types, styles) | claude-opus-4-6 |
| **Fabric Engineer** | Platform Specialist | `src/*.Notebook/`, `src/*.DataPipeline/`, `src/*.VariableLibrary/`, `src/antigravity/`, `src/business_domain/` | claude-opus-4-6 |
| **DevOps Lead** | Deployment Architect | `deploy_from_scratch.py`, `scripts/`, `config/`, `.github/workflows/` | claude-opus-4-6 |
| **QA Lead** | Quality Gatekeeper | `knowledge/qa/`, test strategy (read-only on production code) | claude-opus-4-6 |
| **QA Engineer** | Test Automator | `dashboard/app/tests/`, `engine/tests/` (integration tests), test fixtures | claude-opus-4-6 |
| **UX Auditor** | Vision Strategist | `knowledge/UX-AUDIT-REPORT.md`, `knowledge/ux-audit-screenshots/`, `tests/ux-capture.cjs` | claude-opus-4-6 |

## Reporting Chain

```
Board (Steve)
└── CTO (30s heartbeat)
    ├── Engine Lead (2min)
    ├── API Lead (2min)
    ├── Frontend Lead (2min)
    ├── Fabric Engineer (2min)
    ├── DevOps Lead (2min)
    └── QA Lead (60s)
        └── QA Engineer (5min)
```

## Boundary Rules

1. **No agent modifies files outside their ownership zone** without CTO approval
2. **QA agents are read-only on production code** — they file bugs, not fixes
3. **CTO only writes code for critical blockers** — delegates all feature work
4. **Cross-boundary changes require CTO coordination** (e.g., API endpoint change that affects frontend)
5. **UX Auditor is read-only everywhere** — captures screenshots, writes reports, never modifies code
6. **engine/tests/ shared zone**: Engine Lead writes unit tests for their modules, QA Engineer writes integration/E2E tests. Coordinate via naming: `test_<module>.py` = Engine Lead, `test_integration_*.py` = QA Engineer
7. **`deploy_from_scratch.py` is LOCKED to DevOps Lead** — No other agent may edit this file. If another agent needs a deployment change, they submit a change request (comment in their PR or Paperclip issue) and DevOps Lead implements it. This prevents the 4-agent collision problem.

## Conflict Zones (Coordinate Before Touching)

| File/Area | Primary Owner | Secondary | Coordination Rule |
|-----------|--------------|-----------|-------------------|
| `dashboard/app/api/config.json` | API Lead | DevOps Lead | API Lead owns runtime config; DevOps owns deployment seeding |
| `engine/tests/` | Engine Lead (unit) | QA Engineer (integration) | Namespace by prefix |
| API response contracts | API Lead | Frontend Lead | API Lead changes shape → Frontend Lead must be notified |
| `config/*.yaml` + `config/*.json` | DevOps Lead | API Lead | DevOps writes during deploy; API Lead reads at runtime |

## Workflow Orchestrators

### Feature Development
```
CTO (decompose) → Domain Lead (implement in worktree) → QA Lead (adversarial review) → QA Engineer (test) → CTO (merge)
```

### Bug Fix
```
QA Engineer (reproduce + file) → CTO (triage + assign) → Domain Lead (fix) → QA Engineer (verify) → CTO (merge)
```

### QA Gauntlet (Debate Protocol)
```
QA Engineer (full test run) → QA Lead (analyze, play "bear") → Domain Lead (defend or fix) → Round 2 → CTO (ship/no-ship)
```
