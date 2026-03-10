# HEARTBEAT.md -- Engine Lead Execution Checklist

Run this checklist every 2 minutes. Every step is mandatory unless explicitly marked optional.

---

## Step 0: Gap Detection

Before doing any work, verify the engine and its data are in a known-good state.

1. **Check for unread messages.**
   ```bash
   curl -s http://localhost:3777/api/messages/unread/$SESSION_ID
   ```
   If any message has type `alert` and mentions engine/, handle it first.

2. **Check engine status.**
   ```bash
   curl -s http://localhost:8787/api/engine/status
   ```
   Expected: engine status endpoint responds. If it does not, the API server may be down -- flag to CTO immediately.

3. **Check for active runs.**
   ```sql
   -- Via mssql-powerdata
   SELECT RunId, RunType, Status, EntityCount, StartedAt
   FROM execution.EngineRun
   WHERE Status IN ('Running', 'InProgress')
   ORDER BY StartedAt DESC
   ```
   If a run has been InProgress for >4 hours, investigate. Fabric notebook jobs can hang silently.

4. **Check entity health.**
   ```sql
   SELECT
     COUNT(*) as total,
     SUM(CASE WHEN IsActive=1 THEN 1 ELSE 0 END) as active,
     SUM(CASE WHEN IsActive=0 THEN 1 ELSE 0 END) as inactive
   FROM integration.LandingzoneEntity
   ```
   Expected: 659 total, all active. If active count drops, something toggled IsActive -- investigate immediately.

5. **Check queue tables.**
   ```sql
   SELECT 'LZ' as layer, COUNT(*) as queued FROM integration.PipelineLandingzoneEntity
   UNION ALL
   SELECT 'Bronze', COUNT(*) FROM integration.PipelineBronzeLayerEntity
   ```
   If either is 0 and there is an active run, the pipeline has nothing to process. This was a root cause before -- do not let it recur.

6. **Check for uncommitted engine changes.**
   ```bash
   git diff --name-only engine/
   ```
   If there are changes not linked to an active task, flag them in your heartbeat summary.

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

- Confirm identity: `GET /api/agents/me`
- Read wake context: `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`
- If woken for a specific task, prioritize it over routine checks.

---

## Step 3: Read Shared Memory

```bash
curl -s http://localhost:3777/api/memory/context
```

Look for:
- CTO decisions affecting engine architecture.
- API Lead requests for new engine endpoints.
- Fabric Engineer changes to notebook parameters that affect `notebook_trigger.py`.
- QA Lead test failures in `engine/tests/`.

---

## Step 4: Get Assignments

```
GET /api/companies/{companyId}/issues?assigneeAgentId={your-id}&status=todo,in_progress,blocked
```

Priority:
1. `PAPERCLIP_TASK_ID` if set.
2. Any task tagged with `data-loss` or `watermark` -- these are always P0.
3. `in_progress` tasks.
4. `blocked` tasks you can unblock (usually missing test data or SQL access).
5. `todo` tasks by priority.

---

## Step 5: Checkout and Work

```
POST /api/issues/{id}/checkout
```

Never retry a 409. If someone else has it, move on.

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

### Work Pattern for Engine Changes

1. **Read the current state.** Before changing any engine file, read it fully. Understand what it does now.
2. **Write the test first.** Create or update the test in `engine/tests/` that will validate your change.
3. **Make the change.** Minimal diff. One concern per change.
4. **Run the tests.**
   ```bash
   cd /c/Users/snahrup/CascadeProjects/FMD_FRAMEWORK && python -m pytest engine/tests/ -v
   ```
5. **Verify execution tracking.** If your change affects any load path, confirm that stored proc calls are still in place. Grep for it:
   ```bash
   grep -r "sp_Upsert\|sp_Audit\|sp_Insert\|sp_Build" engine/
   ```
6. **Update the task.** Comment with: what changed, which tests pass, what to watch for.

### Work Pattern for Bug Investigation

1. **Query the execution schema first.** Not the dashboard. Not the logs. The SQL tables.
   ```sql
   SELECT TOP 20 * FROM execution.EngineRun ORDER BY StartedAt DESC
   SELECT TOP 20 * FROM execution.EngineTaskLog WHERE Status = 'Failed' ORDER BY CreatedAt DESC
   ```
2. **Check entity state.** Is the entity active? Is the watermark current? Is the queue populated?
3. **Check Fabric job status.** Use the engine status endpoint or Fabric API directly.
4. **Document findings** with exact counts, entity IDs, and timestamps. No vague descriptions.

---

## Step 6: Test Verification

Before marking any task as done:

```bash
cd /c/Users/snahrup/CascadeProjects/FMD_FRAMEWORK && python -m pytest engine/tests/ -v --tb=short
```

All tests must pass. If a test fails:
1. Is it your change that broke it? Fix it.
2. Is it a pre-existing failure? Note it in the task comment and file a separate bug.
3. Is it a flaky test? Fix the flakiness. Flaky tests are bugs.

Check coverage:
```bash
cd /c/Users/snahrup/CascadeProjects/FMD_FRAMEWORK && python -m pytest engine/tests/ --cov=engine --cov-report=term-missing
```

If coverage dropped below 80%, add tests before closing the task.

---

## Step 7: Share Discoveries

If you found a bug, a gotcha, or a pattern worth knowing:

```bash
curl -s -X POST http://localhost:3777/api/memory \
  -H "Content-Type: application/json" \
  -d '{"category":"discovery","key":"engine-...","value":"What was found and why it matters","sourceProject":"FMD_FRAMEWORK"}'
```

Engine-relevant categories:
- `discovery`: New gotcha (e.g., "rowversion columns break watermark comparison")
- `fact`: Verified truth (e.g., "659 entities across 4 sources, all on DEV lakehouses")
- `pattern`: Code convention (e.g., "all stored proc calls go through logging_db.py, never raw SQL")

---

## Step 8: Heartbeat Summary (MANDATORY)

Every heartbeat cycle MUST end with this POST. No exceptions.

```bash
curl -s -X POST http://localhost:3777/api/memory \
  -H "Content-Type: application/json" \
  -d '{
    "category": "context",
    "key": "engine-heartbeat-'$(date +%Y%m%d-%H%M%S)'",
    "value": "ENGINE HEARTBEAT: [entities_active=#] [runs_active=#] [tests_pass=#/#] [tasks_worked=#] | Notes: ...",
    "sourceProject": "FMD_FRAMEWORK"
  }'
```

Include:
- Active entity count (should be 659).
- Number of active/recent engine runs.
- Test pass/fail counts from last run.
- Tasks worked this cycle.
- Any anomalies detected in Step 0.
- Any watermark or execution tracking concerns.

---

## Engine Lead Rules

- **Never modify files outside `engine/`.** If the fix requires changes to `server.py` or dashboard code, file a task for the relevant domain lead.
- **Never run engine operations against production** without CTO approval.
- **Always use stored procs** for writes to integration/execution schemas. Raw SQL writes are forbidden.
- **Always include `X-Paperclip-Run-Id` header** on mutating Paperclip API calls.
- **Watermark changes require verification.** After any change to watermark logic, run a before/after comparison on at least 10 entities to prove no regression.
- **If you break a test, you fix the test.** Do not skip, disable, or mark as xfail without CTO approval.
