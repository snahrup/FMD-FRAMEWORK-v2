# TOOLS.md -- QA Engineer Available Tools

## TestSprite MCP

Your primary tool for generating and executing tests at scale.

### Bootstrap
```
mcp__TestSprite__testsprite_bootstrap
```
One-time project initialization. Sets up TestSprite context for FMD_FRAMEWORK.

### Check Account
```
mcp__TestSprite__testsprite_check_account_info
```
Verify credits and configuration before a test generation run.

### Generate Backend Test Plan
```
mcp__TestSprite__testsprite_generate_backend_test_plan
```
Analyzes `engine/` and `dashboard/app/api/server.py` to produce a prioritized test plan. Use this before writing any new tests to understand coverage gaps.

### Generate Frontend Test Plan
```
mcp__TestSprite__testsprite_generate_frontend_test_plan
```
Analyzes `dashboard/app/src/` to produce a Playwright test plan. Maps 44 pages to test scenarios: smoke tests, interaction tests, error handling.

### Generate Code and Execute
```
mcp__TestSprite__testsprite_generate_code_and_execute
```
The main workhorse. Generates test code and runs it immediately. Returns structured pass/fail results. Always review generated tests for:
- Correct assertions (not just "does not throw")
- Realistic test data
- Proper mocking of external dependencies
- Readable test names following `test_{unit}_{behavior}_{condition}` pattern

### Rerun Tests
```
mcp__TestSprite__testsprite_rerun_tests
```
Re-execute previously generated tests. Essential for flake detection:
- Run 3x minimum for critical path tests
- Compare results across runs
- Any discrepancy = flake = bug report

### View Results Dashboard
```
mcp__TestSprite__testsprite_open_test_result_dashboard
```
Visual dashboard for test results. Use after multi-run sessions to compare.

### Generate Code Summary
```
mcp__TestSprite__testsprite_generate_code_summary
```
Produces a structural summary of the codebase. Use to map modules to test files and identify untested areas.

### Generate Standardized PRD
```
mcp__TestSprite__testsprite_generate_standardized_prd
```
Generates a product requirements document. Useful for deriving acceptance test criteria from requirements.

---

## Pytest (Direct CLI)

Your primary Python test runner.

### Basic Run
```bash
cd engine && python -m pytest tests/ -v
```

### With Coverage
```bash
cd engine && python -m pytest tests/ -v --cov=. --cov-report=term --cov-report=json --cov-report=html
```
Coverage report goes to `htmlcov/`. JSON goes to `coverage.json`.

### Single File
```bash
cd engine && python -m pytest tests/test_models.py -v
```

### Single Test
```bash
cd engine && python -m pytest tests/test_models.py::test_specific_function -v
```

### With Traceback
```bash
cd engine && python -m pytest tests/ -v --tb=long
```
Use `--tb=long` for full tracebacks on failures. Use `--tb=short` for summary view.

### Parallel Execution (if pytest-xdist installed)
```bash
cd engine && python -m pytest tests/ -v -n auto
```

### Mark-Based Selection
```bash
cd engine && python -m pytest tests/ -v -m "not slow"
cd engine && python -m pytest tests/ -v -m "api"
```

---

## Playwright (Direct CLI)

Your E2E test runner for the React dashboard.

### Run All Tests
```bash
cd dashboard/app && npx playwright test
```

### Run Specific Test File
```bash
cd dashboard/app && npx playwright test tests/smoke.spec.ts
```

### Run with UI Mode (debugging)
```bash
cd dashboard/app && npx playwright test --ui
```

### Run with Trace (for failure analysis)
```bash
cd dashboard/app && npx playwright test --trace on
```
Produces trace files viewable at `https://trace.playwright.dev`.

### Run with Specific Browser
```bash
cd dashboard/app && npx playwright test --project=chromium
```

### Generate Report
```bash
cd dashboard/app && npx playwright show-report
```

### Configuration Reference
- Config file: `dashboard/app/playwright.config.ts`
- Test directory: `dashboard/app/tests/`
- Base URL: `http://localhost:5173` (Vite dev) or `http://localhost:8787` (production build)
- Screenshots: configured for on-failure capture
- Timeout: check config for current values

---

## Chrome DevTools MCP

For debugging Playwright failures by inspecting live browser state.

```
mcp__chrome-devtools__*
```

Use cases:
- Inspect DOM when a selector is not found
- Check console for JavaScript errors not caught by Playwright
- Verify network requests completed (API calls during page load)
- Capture the visual state when a test assertion fails

---

## Git (Read-Only)

For understanding what changed and what needs tests.

```bash
git log --oneline -10                        # Recent commits
git diff --name-only HEAD~5..HEAD            # Files changed recently
git show <commit> -- <file>                  # Specific file at specific commit
git log --oneline -- engine/                 # Engine change history
git log --oneline -- dashboard/app/src/      # Dashboard change history
```

Never run write operations (commit, push, reset, checkout). Report to QA Lead if you need branch operations.

---

## curl (API Testing)

For quick API endpoint verification outside of pytest.

```bash
# GET endpoints
curl -s http://localhost:8787/api/health | python -m json.tool
curl -s http://localhost:8787/api/config | python -m json.tool
curl -s http://localhost:8787/api/entities | python -m json.tool
curl -s http://localhost:8787/api/entity/1 | python -m json.tool
curl -s http://localhost:8787/api/engine/status | python -m json.tool

# POST endpoints (example)
curl -s -X POST http://localhost:8787/api/engine/run \
  -H "Content-Type: application/json" \
  -d '{"mode":"dry_run"}' | python -m json.tool

# Check response codes
curl -s -o /dev/null -w "%{http_code}" http://localhost:8787/api/entity/99999

# Headers inspection
curl -sI http://localhost:8787/api/health
```

Use curl for quick verification. Use pytest for permanent, repeatable API tests.

---

## Nexus (Session Communication)

```bash
# Check for messages from QA Lead
curl -s http://localhost:3777/api/messages/unread/$SESSION_ID

# Report test results
curl -s -X POST http://localhost:3777/api/messages \
  -H "Content-Type: application/json" \
  -d '{"content":"Test run complete: X pass, Y fail","type":"info","fromSession":"'$SESSION_ID'"}'

# Alert on critical failure
curl -s -X POST http://localhost:3777/api/messages \
  -H "Content-Type: application/json" \
  -d '{"content":"CRITICAL: [details]","type":"alert","fromSession":"'$SESSION_ID'"}'

# Share test infrastructure discoveries
curl -s -X POST http://localhost:3777/api/memory \
  -H "Content-Type: application/json" \
  -d '{"category":"discovery","key":"...","value":"...","sourceProject":"FMD_FRAMEWORK"}'

# Read shared context
curl -s http://localhost:3777/api/memory/context
```

---

## Tool Usage Rules

1. **TestSprite for generation, pytest/Playwright for execution.** Use TestSprite to bootstrap test files, then run them with the native runners for accurate results.
2. **Always review generated tests.** TestSprite output needs human QA. Check assertions are meaningful, mocks are realistic, and names follow conventions.
3. **Never modify production code with any tool.** If a test cannot run without a production change, document the blocker and report to QA Lead.
4. **curl for exploration, pytest for permanence.** Use curl to understand an endpoint. Write a pytest test to verify it forever.
5. **Screenshots are mandatory on Playwright failure.** If the config does not capture them, fix the config.
6. **Coverage reports go to knowledge/qa/.** Not to temp directories. Not to stdout only. Persistent, timestamped, reviewable.
