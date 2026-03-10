# TOOLS.md -- QA Lead Available Tools

## TestSprite MCP

TestSprite is your primary test generation and execution platform. Use it through MCP tool calls.

### Bootstrap (first-time setup)
```
mcp__TestSprite__testsprite_bootstrap
```
Initialize TestSprite for the project. Run once per environment.

### Check Account
```
mcp__TestSprite__testsprite_check_account_info
```
Verify TestSprite is configured and credits are available.

### Generate Test Plans
```
mcp__TestSprite__testsprite_generate_backend_test_plan
```
Generate a test plan for Python backend (engine/, API server). Use this to identify coverage gaps and prioritize test creation.

```
mcp__TestSprite__testsprite_generate_frontend_test_plan
```
Generate a test plan for React/TypeScript frontend (dashboard/app/src/). Maps pages to test scenarios.

### Generate and Execute Tests
```
mcp__TestSprite__testsprite_generate_code_and_execute
```
Generate test code and run it. Returns pass/fail results. Use for rapid test cycle iteration.

### Rerun Tests
```
mcp__TestSprite__testsprite_rerun_tests
```
Rerun previously generated tests. Use for flake detection (run 3x minimum on critical paths).

### View Results
```
mcp__TestSprite__testsprite_open_test_result_dashboard
```
Open the TestSprite results dashboard for visual review.

### Code Summary
```
mcp__TestSprite__testsprite_generate_code_summary
```
Generate a summary of the codebase structure. Useful for mapping test coverage.

---

## Chrome DevTools MCP

For debugging dashboard pages during E2E test failures.

```
mcp__chrome-devtools__*
```
- Inspect DOM state when Playwright tests fail
- Check console errors on dashboard pages
- Verify network requests to API endpoints
- Capture screenshots of failure states

---

## GitHub MCP

For managing PRs, reviews, and issue tracking.

```
mcp__github__*
```
- Create issues for bugs found during review
- Post review comments on PRs with line-specific feedback
- Check CI/CD pipeline status
- Track PR approval state

---

## Git (Direct CLI)

For inspecting code changes that need review.

```bash
git log --oneline -20                    # Recent commits
git diff HEAD~N..HEAD                    # Changes in last N commits
git diff --name-only HEAD~N..HEAD        # Changed files only
git show <commit>                        # Specific commit diff
git blame <file>                         # Who changed what when
```

---

## Playwright (via QA Engineer)

You do not run Playwright directly. Direct QA Engineer to run it.

- Config: `dashboard/app/playwright.config.ts`
- Test dir: `dashboard/app/tests/`
- Run command: `cd dashboard/app && npx playwright test`
- Report: `dashboard/app/playwright-report/`

---

## Pytest (via QA Engineer)

You do not run pytest directly. Direct QA Engineer to run it.

- Test dir: `engine/tests/`
- Run command: `cd engine && python -m pytest tests/ -v`
- Coverage: `cd engine && python -m pytest tests/ --cov=. --cov-report=html`

---

## API Testing (via QA Engineer or direct curl)

For quick verification of API endpoints:

```bash
# Health check
curl -s http://localhost:8787/api/health

# Config endpoint
curl -s http://localhost:8787/api/config

# Entity endpoints
curl -s http://localhost:8787/api/entities
curl -s http://localhost:8787/api/entity/{id}

# Engine endpoints
curl -s http://localhost:8787/api/engine/status
curl -s http://localhost:8787/api/engine/runs
```

Catalog all endpoints from `server.py` and verify each has at least one test.

---

## Nexus (Session Communication)

```bash
# Check messages
curl -s http://localhost:3777/api/messages/unread/$SESSION_ID

# Share discoveries
curl -s -X POST http://localhost:3777/api/memory \
  -H "Content-Type: application/json" \
  -d '{"category":"discovery","key":"...","value":"...","sourceProject":"FMD_FRAMEWORK"}'

# Read shared memory
curl -s http://localhost:3777/api/memory/context

# Check active sessions
curl -s http://localhost:3777/api/sessions?status=active
```

---

## Tool Usage Rules

1. **TestSprite first.** For any new test area, start with TestSprite to generate the plan and initial code.
2. **Verify before trusting.** After TestSprite generates tests, review them. Generated tests can have the same blind spots as generated code.
3. **Chrome DevTools for diagnosis, not testing.** Use it to understand WHY a test fails, not as a substitute for automated tests.
4. **Git blame for context.** When you find a bug, check git blame to understand the change history. Was this always broken, or did a recent change break it?
5. **Never run destructive git commands.** Read-only git access. If you need a branch or a reset, ask CTO.
