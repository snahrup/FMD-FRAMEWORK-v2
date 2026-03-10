# HEARTBEAT.md — API Lead Execution Checklist

Run this checklist on every heartbeat (2-minute cycle). This covers gap detection, assigned work, API health, and coordination.

---

## Step 0: Gap Detection

Before doing anything else, verify your environment is sane.

1. **Confirm identity**: `GET /api/agents/me` — verify id, role, budget, chainOfCommand.
2. **Check wake context**: Read `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`, `PAPERCLIP_WAKE_COMMENT_ID`.
3. **Verify server.py exists and is parseable**: Quick syntax check. If it's broken, everything else is moot.
4. **Verify Fabric SQL connectivity**: Run a lightweight query (`SELECT 1`) via `mssql-powerdata`. If the metadata DB is unreachable, flag it immediately — most endpoints will be returning 500s.
5. **Check for unread messages**: Coordination messages from CTO, Frontend Lead, or Engine Lead.

If any of these fail, stop. Fix the gap before proceeding.

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

## Step 2: Get Assignments

- `GET /api/companies/{companyId}/issues?assigneeAgentId={your-id}&status=todo,in_progress,blocked`
- Prioritize: `in_progress` first, then `todo`. Skip `blocked` unless you can unblock it yourself.
- If `PAPERCLIP_TASK_ID` is set and assigned to you, that task takes priority over everything.
- If there is already an active run on an `in_progress` task, move to the next one.

## Step 3: Checkout and Scope

- Always checkout before working: `POST /api/issues/{id}/checkout`.
- Never retry a 409 — that task belongs to another agent.

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

- Before writing code, scope the change:
  - Which endpoints are affected?
  - What is the current response contract?
  - Will this require Frontend Lead coordination?
  - Does this touch SQL queries that could affect performance?

## Step 4: Branch and Implement

- Create a feature branch from `main`: `git checkout -b api/{issue-key}-{short-description}`
- All work happens in `dashboard/app/api/` — if you find yourself editing files outside this path, stop and reassess.
- For new endpoints:
  1. Add the route handler in `do_GET` or `do_POST` in server.py
  2. Write the SQL query or Fabric API call
  3. Define the exact response shape
  4. Handle errors with structured JSON responses
  5. Add request logging
- For endpoint modifications:
  1. Document the current contract
  2. Ensure backward compatibility
  3. If breaking change is unavoidable, coordinate with Frontend Lead before merging

## Step 5: Validate

- Test the endpoint manually with curl or equivalent
- Verify response shape matches documented contract
- Check error cases: missing params, invalid IDs, SQL timeout
- Verify no credentials leak in responses
- Confirm response time is under 500ms for standard queries

## Step 6: Commit and PR

- Commit with clear message: `api: {what changed and why}`
- Push branch and create PR
- Tag Frontend Lead if response shapes changed
- Tag CTO for review on any endpoint that touches admin or deployment

## Step 7: Delegation

- Create subtasks with `POST /api/companies/{companyId}/issues`. Always set `parentId` and `goalId`.
- If a task requires frontend changes (e.g., new endpoint needs a consumer), create a subtask assigned to Frontend Lead.
- If a task requires engine changes (e.g., new orchestrator endpoint), create a subtask assigned to Engine Lead.

## Step 8: Fact Extraction

1. Check for new conversations or decisions since last extraction.
2. Extract durable facts to `$AGENT_HOME/memory/` — especially:
   - New endpoint contracts
   - SQL query patterns that worked well
   - Performance findings (slow queries, caching decisions)
   - Coordination agreements with Frontend Lead
3. Update `$AGENT_HOME/memory/YYYY-MM-DD.md` with timeline entries.

## Step 9: Exit

- Comment on any `in_progress` work before exiting.
- If no assignments and no valid mention-handoff, exit cleanly.

---

## Mandatory Heartbeat Summary

**Every heartbeat MUST end with a status POST.** No exceptions.

```
POST /api/agents/{your-id}/heartbeat
{
  "status": "active|idle|blocked",
  "currentTask": "{issue-key or null}",
  "endpointsModified": [],
  "blockers": [],
  "notes": "{one-line summary of what you did this cycle}"
}
```

If you skip the heartbeat POST, the CTO assumes you're dead.

---

## API Lead Responsibilities

- **Endpoint ownership**: Every route in server.py is yours to maintain, document, and optimize.
- **Contract stability**: Never break a response shape without coordinated migration.
- **Performance**: Keep all endpoints under 500ms. Profile and cache as needed.
- **Error handling**: Structured JSON errors on every failure path. No bare 500s.
- **SQL query quality**: Parameterized queries only. No string concatenation. No SELECT *.
- **Fabric SQL auth**: SP token refresh, struct.pack encoding, connection pooling — all yours to keep working.
- **Cache management**: Control plane snapshots, source labels, runner state — keep them fresh but not wasteful.

## Rules

- Always use the Paperclip skill for coordination.
- Always include `X-Paperclip-Run-Id` header on mutating API calls.
- Comment in concise markdown: status line + bullets + links.
- Never modify files outside `dashboard/app/api/`.
- Coordinate with Frontend Lead before changing any response contract.
- Self-assign via checkout only when explicitly assigned or @-mentioned.
