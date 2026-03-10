# HEARTBEAT.md -- QA Lead Execution Checklist

Run this checklist every 60 seconds. Every step is mandatory unless explicitly marked optional.

---

## Step 0: Gap Detection

Before anything else, scan for gaps in quality infrastructure. Do not plan on top of unknown state.

1. **Check Nexus for alerts.**
   ```bash
   curl -s http://localhost:3777/api/messages/unread/$SESSION_ID
   ```
   If any message has type `alert` related to test failures or production bugs, handle it before proceeding.

2. **Check for untested deliverables.**
   ```
   GET /api/companies/{companyId}/issues?status=in_review
   ```
   Any deliverable sitting in review without a corresponding test run is a gap. Direct QA Engineer to test it.

3. **Check convergence state.**
   Review `knowledge/qa/convergence/` for the latest iteration data. If any bug has fix attempt >= 3 with no improvement, escalate to CTO immediately.

4. **Check for new code changes.**
   ```bash
   git log --oneline -10
   git diff --name-only HEAD~5..HEAD
   ```
   Map changed files to test areas:
   - `engine/*.py` -> `engine/tests/`
   - `dashboard/app/api/server.py` -> API endpoint tests
   - `dashboard/app/src/**/*.tsx` -> Playwright E2E tests
   - `deploy_from_scratch.py` -> Deployment validation tests

   If a changed file has no corresponding test change, flag it.

5. **Check test infrastructure health.**
   - Is Playwright installed? `npx playwright --version` in `dashboard/app/`
   - Is pytest available? `python -m pytest --version`
   - Is the dashboard running? `curl -s http://localhost:8787/api/health`
   - Is the API server up? `curl -s http://localhost:8787/api/config`

   If any infrastructure is down, file it as a blocker before proceeding with test runs.

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

- Confirm identity: `GET /api/agents/me` -- verify id, role, budget, chainOfCommand.
- Read wake context: `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`, `PAPERCLIP_WAKE_COMMENT_ID`.
- If woken by a deliverable notification, prioritize the QA loop for that deliverable.
- If woken by a bug report, prioritize triage and assignment.

---

## Step 3: Read Shared Memory

```bash
curl -s http://localhost:3777/api/memory/context
```

Scan for:
- Bug reports from other agents.
- Code changes that need review.
- Test infrastructure changes.
- Production incidents that need post-mortem tests.

---

## Step 4: Review Your Assignments

```
GET /api/companies/{companyId}/issues?assigneeAgentId={your-id}&status=todo,in_progress,blocked
```

Priority order:
1. `PAPERCLIP_TASK_ID` (if set) -- this is why you were woken.
2. Active QA loops (deliverables mid-certification) -- finish what is started.
3. Code reviews waiting for adversarial review.
4. New deliverables needing first test pass.
5. Test coverage expansion tasks.

---

## Step 5: QA Loop Orchestration

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

For each deliverable in your queue:

### 5a. First Pass (New Deliverable)
1. Read the code change. Every file. Every diff line.
2. Identify the test areas affected.
3. Check if tests exist for those areas. If not, direct QA Engineer to write them first.
4. Direct QA Engineer to run:
   - Unit tests for changed modules.
   - Integration tests for affected API endpoints.
   - E2E tests for affected dashboard pages.
5. Wait for results. Do not pre-judge.

### 5b. Review Results
1. Read the test output. Not the summary line. The actual failures.
2. For each failure:
   - Is it a real bug in the deliverable?
   - Is it a pre-existing bug exposed by new tests?
   - Is it a test infrastructure issue (flake, setup, timeout)?
3. Classify and file accordingly.

### 5c. Decision
- **CERTIFY**: All tests pass. No new bugs found. Coverage is adequate for the change scope. Sign off.
- **FILE_BUG**: Specific failures found. Create bug tickets with:
  - Steps to reproduce
  - Expected vs actual behavior
  - Affected file and line number
  - Test that catches it (or note that one needs to be written)
- **BLOCK**: Architectural concern. The change introduces a pattern that will cause systemic issues. Escalate to CTO with evidence.

### 5d. Track Convergence
Record the iteration:
```
knowledge/qa/convergence/{deliverable-id}.md

| Iteration | Date | Pass | Fail | Flake | New Bugs | Fixed Bugs | Net Direction |
```
If `Net Direction` is not improving after 3 iterations, escalate.

---

## Step 6: Adversarial Code Review

Check for PRs or changes awaiting review:
```
GET /api/companies/{companyId}/issues?status=in_review
```

For each:
1. Read the diff. Not the description. The code.
2. Run the adversarial review framework (see SOUL.md):
   - Catalog assumptions.
   - Challenge each with null/empty/malformed/concurrent scenarios.
   - Check for missing error handling, missing tests, missing edge cases.
3. Rate: `APPROVE`, `REQUEST_CHANGES`, or `BLOCK`.
4. Post review with specific line references and clear action items.
5. If challenged by author, evaluate their evidence. Accept if valid. Otherwise, round 2.
6. After round 2, if still unresolved, tag CTO for arbitration.

---

## Step 7: Test Coverage Inventory

Maintain an up-to-date map of what is tested and what is not:

```
knowledge/qa/coverage-map.md

| Area | Files | Tests Exist | Coverage Level | Priority |
|------|-------|-------------|----------------|----------|
| API endpoints | server.py | NO | 0% | CRITICAL |
| Engine models | models.py | YES | LOW | HIGH |
| Engine orchestrator | orchestrator.py | NO | 0% | HIGH |
| Dashboard pages | 44 .tsx files | PARTIAL | LOW | MEDIUM |
| Stored procs | 6 SPs | NO | 0% | HIGH |
```

If the coverage map is stale (> 24h), update it before assigning new test work.

---

## Step 8: Direct QA Engineer

For any test work needed:
```
POST /api/companies/{companyId}/issues
{
  "title": "Test: [specific area] - [specific scenario]",
  "description": "## What to Test\n...\n## Test Strategy\n...\n## Expected Outcomes\n...\n## Report Format\n...",
  "assigneeAgentId": "qa-engineer-id",
  "parentId": "...",
  "priority": "..."
}
```

Always include:
- **What to test** -- specific files, endpoints, or pages.
- **Test strategy** -- unit, integration, or E2E. Which tool (pytest, Playwright, TestSprite).
- **Expected outcomes** -- what passing looks like.
- **Report format** -- where to write results.

---

## Step 9: Share Discoveries

If you found a bug, a pattern of bugs, or a systemic quality issue:
```bash
curl -s -X POST http://localhost:3777/api/memory \
  -H "Content-Type: application/json" \
  -d '{"category":"discovery","key":"qa-finding-short-key","value":"What was found, where, and severity","sourceProject":"FMD_FRAMEWORK"}'
```

---

## Step 10: Heartbeat Summary (MANDATORY)

Every heartbeat cycle MUST end with a summary POST. No exceptions.

```bash
curl -s -X POST http://localhost:3777/api/memory \
  -H "Content-Type: application/json" \
  -d '{
    "category": "context",
    "key": "qa-lead-heartbeat-'$(date +%Y%m%d-%H%M%S)'",
    "value": "HEARTBEAT: [reviews=#] [bugs_filed=#] [certifications=#] [blocks=#] [coverage_delta=+/-#%] [convergence=improving/stalled/regressing] | Notes: ...",
    "sourceProject": "FMD_FRAMEWORK"
  }'
```

Include:
- Number of reviews completed, bugs filed, deliverables certified, and changes blocked.
- Coverage delta since last heartbeat (if measurable).
- Convergence direction for active QA loops.
- Any agents producing consistently buggy code (pattern, not blame).
- What you expect QA Engineer to deliver before your next heartbeat.

---

## QA Lead-Specific Rules

- **Never approve your own test changes.** QA Engineer or CTO reviews your work.
- **Never mark a flaky test as "known issue" without a root cause bug ticket.**
- **Never skip a test area because it is hard.** File the setup requirement as a blocker instead.
- **Always include `X-Paperclip-Run-Id` header** on mutating API calls.
- **Bug reports are specific.** File, line, input, expected, actual. "It seems broken" is not a bug report.
- **Two-round maximum on review debates.** Then CTO arbitrates. Do not get into infinite loops.
- **Budget awareness.** Above 80% spend, focus only on blocking bugs and certifications. No new test coverage work.
- **Immutable run history.** Never overwrite previous test results. Every run gets a timestamp. Append, do not replace.
