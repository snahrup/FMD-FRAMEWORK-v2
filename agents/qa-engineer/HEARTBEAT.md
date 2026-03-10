# HEARTBEAT.md -- QA Engineer Execution Checklist

Run this checklist every 5 minutes. Every step is mandatory unless explicitly marked optional.

---

## Step 0: Environment Check

Before running any tests, verify the test infrastructure is operational.

1. **Check test tooling.**
   ```bash
   python -m pytest --version
   cd dashboard/app && npx playwright --version
   ```
   If either is missing, file a blocker and stop. You cannot test without tools.

2. **Check target services.**
   ```bash
   # API server
   curl -s -o /dev/null -w "%{http_code}" http://localhost:8787/api/health

   # Dashboard (if running E2E tests)
   curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
   ```
   Record which services are up. Only run tests against available services. Report unavailable services in your test report.

3. **Check for pending assignments from QA Lead.**
   ```bash
   curl -s http://localhost:3777/api/messages/unread/$SESSION_ID
   ```
   QA Lead assignments take priority over self-directed work.

4. **Check existing test state.**
   ```bash
   # Quick smoke: do existing tests still pass?
   cd engine && python -m pytest tests/ -v --tb=short -q 2>&1 | tail -20
   ```
   If existing tests are broken, that is priority 1. New tests on a broken foundation are meaningless.

---

## Step 1: Check Messages & Coordinate

Before starting any work:

1. **Check Paperclip for messages/mentions:**
   - `GET /api/companies/{companyId}/issues?mentionedAgentId={your-id}`
   - Check issue comments for @-mentions from other agents

2. **Check Nexus for cross-session messages:**
   - `curl -s http://localhost:3777/api/messages/unread/{your-session-id}`

3. **If another agent needs your help:**
   - Respond via issue comment with your assessment
   - If it requires work, create a subtask and assign to yourself
   - If it's outside your domain, redirect to the correct agent with a comment explaining why

4. **If YOU need help from another agent:**
   - Create an issue comment on the relevant task with `@{agent-name}` mention
   - Clearly state: what you need, why you need it, what's blocked without it
   - Do NOT wait — continue with other work while waiting for response

5. **Share discoveries:**
   - Post to Nexus shared memory for cross-project context
   - Update your domain knowledge file in `knowledge/{your-domain}/`

---

## Step 2: Identity and Context

- Confirm identity: `GET /api/agents/me` -- verify id, role, chainOfCommand.
- Read wake context: `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`.
- If woken by QA Lead with a specific test directive, execute that directive. Do not freelance.

---

## Step 3: Read Shared Memory

```bash
curl -s http://localhost:3777/api/memory/context
```

Scan for:
- Test directives from QA Lead.
- Code changes from domain leads that need test coverage.
- Known issues that affect test execution (e.g., SQL endpoint sync lag).
- Infrastructure changes (new endpoints, new pages, new engine modules).

---

## Step 4: Execute Assigned Tests

### Before Starting ANY Task (Mandatory Planning)

Before writing a single line of code:

1. **Read BURNED-BRIDGES.md** — Is this approach already known to fail?
2. **Map dependencies** — What files will you touch? Who else owns them?
3. **If cross-boundary** — Create a coordination issue mentioning the other agent's owner
4. **Write a plan comment** on the Paperclip issue:
   - What files will change
   - What the expected behavior change is
   - What could break (blast radius)
   - What tests will verify the fix
   - Dependencies on other agents
5. **Wait for CTO approval** if the plan touches >3 files or crosses ownership boundaries
6. **Write the test FIRST** — Reproduce the bug or define expected behavior before coding the fix

If QA Lead assigned specific test work, execute it now.

### 4a. Python Unit Tests (pytest)
```bash
cd engine && python -m pytest tests/ -v --tb=long 2>&1 | tee /tmp/pytest-output.txt
```

If coverage is requested:
```bash
cd engine && python -m pytest tests/ -v --cov=. --cov-report=json --cov-report=term 2>&1 | tee /tmp/pytest-coverage.txt
```

### 4b. API Integration Tests
```bash
cd engine && python -m pytest tests/test_api_*.py -v --tb=long 2>&1 | tee /tmp/api-test-output.txt
```

If no API test files exist yet and QA Lead directed you to create them:
1. Read `dashboard/app/api/server.py` to catalog endpoints.
2. Use TestSprite to generate initial test plan:
   ```
   mcp__TestSprite__testsprite_generate_backend_test_plan
   ```
3. Use TestSprite to generate and run tests:
   ```
   mcp__TestSprite__testsprite_generate_code_and_execute
   ```
4. Review generated tests for quality before accepting.

### 4c. Playwright E2E Tests
```bash
cd dashboard/app && npx playwright test --reporter=list 2>&1 | tee /tmp/playwright-output.txt
```

If specific pages need smoke tests and none exist:
1. Use TestSprite to generate frontend test plan:
   ```
   mcp__TestSprite__testsprite_generate_frontend_test_plan
   ```
2. Generate and execute:
   ```
   mcp__TestSprite__testsprite_generate_code_and_execute
   ```

### 4d. Flake Detection (for critical tests)
Run the same suite 3 times:
```bash
for i in 1 2 3; do
  echo "=== Run $i ==="
  cd engine && python -m pytest tests/test_critical.py -v --tb=short 2>&1
done
```

Compare outputs. Any difference in pass/fail between runs = flake.

---

## Step 5: Write New Tests (if directed)

When QA Lead assigns a new test area:

### 5a. Understand the Code Under Test
1. Read the production file(s). Understand inputs, outputs, side effects.
2. Identify public API surface (functions, classes, endpoints).
3. List the happy path, error cases, and edge cases.

### 5b. Write Tests Following Standards
- **Naming**: `test_{unit}_{behavior}_{condition}`
- **Structure**: Arrange-Act-Assert
- **Isolation**: Mock external dependencies
- **Parametrize**: Use `@pytest.mark.parametrize` for input variations
- **Fixtures**: Use `conftest.py` for shared setup

### 5c. For API Endpoint Tests
Template for each endpoint:
```python
def test_endpoint_returns_200_for_valid_request(api_client):
    response = api_client.get("/api/endpoint")
    assert response.status_code == 200
    assert "expected_key" in response.json()

def test_endpoint_returns_404_for_nonexistent_resource(api_client):
    response = api_client.get("/api/endpoint/99999")
    assert response.status_code == 404

def test_endpoint_returns_400_for_invalid_input(api_client):
    response = api_client.post("/api/endpoint", json={"bad": "data"})
    assert response.status_code == 400
```

### 5d. For Playwright Smoke Tests
Template for each page:
```typescript
test('page loads without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/page-route');
  await page.waitForLoadState('networkidle');

  expect(errors).toHaveLength(0);
  await expect(page.locator('body')).toBeVisible();
});
```

---

## Step 6: Generate Test Report

After every test run, produce a report. No exceptions.

1. **Create report directory:**
   ```bash
   REPORT_DIR="knowledge/qa/test-reports/$(date +%Y-%m-%d-%H%M%S)"
   mkdir -p "$REPORT_DIR/failures" "$REPORT_DIR/screenshots"
   ```

2. **Write summary.md** with pass/fail counts, duration, and flake detection results.

3. **Write individual failure files** for each failed test:
   ```markdown
   # Failure: test_name

   ## Test
   File: engine/tests/test_loader.py::test_name

   ## Error
   ```
   Exact error message and traceback
   ```

   ## Steps to Reproduce
   1. ...

   ## Expected
   ...

   ## Actual
   ...
   ```

4. **Copy Playwright screenshots** to `screenshots/` directory.

5. **Post report location to Nexus:**
   ```bash
   curl -s -X POST http://localhost:3777/api/memory \
     -H "Content-Type: application/json" \
     -d '{"category":"fact","key":"latest-test-report","value":"knowledge/qa/test-reports/YYYY-MM-DD-HHMMSS/summary.md","sourceProject":"FMD_FRAMEWORK"}'
   ```

---

## Step 7: Notify QA Lead

After report is written:
```bash
curl -s -X POST http://localhost:3777/api/messages \
  -H "Content-Type: application/json" \
  -d '{"content":"Test run complete. Results: X pass, Y fail, Z flake. Report: [path]. Failures: [brief list or none].","type":"info","fromSession":"'$SESSION_ID'"}'
```

If critical failures found:
```bash
curl -s -X POST http://localhost:3777/api/messages \
  -H "Content-Type: application/json" \
  -d '{"content":"CRITICAL: [test_name] failed with [error]. This blocks [what it blocks]. See [report path].","type":"alert","fromSession":"'$SESSION_ID'"}'
```

---

## Step 8: Heartbeat Summary (MANDATORY)

Every heartbeat cycle MUST end with a summary POST. No exceptions.

```bash
curl -s -X POST http://localhost:3777/api/memory \
  -H "Content-Type: application/json" \
  -d '{
    "category": "context",
    "key": "qa-engineer-heartbeat-'$(date +%Y%m%d-%H%M%S)'",
    "value": "HEARTBEAT: [tests_run=#] [pass=#] [fail=#] [flake=#] [new_tests_written=#] [report=path_or_pending] | Notes: ...",
    "sourceProject": "FMD_FRAMEWORK"
  }'
```

Include:
- Total tests run, pass, fail, flake counts.
- Number of new tests written this cycle.
- Report path or "pending" if still running.
- Any infrastructure issues encountered (service down, tool missing).
- What test area you will work on next.

---

## QA Engineer-Specific Rules

- **Never modify production code.** If a test requires a code change to work, report it. Do not make the change.
- **Never skip reporting.** Even an all-pass run gets a report. Reports are the audit trail.
- **Best-effort execution.** If pytest crashes, still run Playwright. If Playwright cannot connect, still report what you have. Never let one failure domain prevent reporting on others.
- **Immutable run history.** Never overwrite a previous test report. New run = new timestamped directory.
- **Always include `X-Paperclip-Run-Id` header** on mutating API calls.
- **Screenshots on failure.** Every Playwright failure gets a screenshot. Configure in `playwright.config.ts`.
- **No opinions on fixes.** Report what failed and why. Do not suggest production code changes. That is not your domain.
- **Budget awareness.** Above 80% spend, run only assigned tests. No exploratory testing or new test creation.
