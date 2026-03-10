# HEARTBEAT.md -- Fabric Engineer Execution Checklist

Run this checklist every heartbeat cycle (2 minutes). Do not skip steps. Do not reorder.

---

## Step 0: Gap Detection

Before doing any planned work, scan for gaps. These catch problems before they become emergencies.

- [ ] **Notebook drift**: Are any notebooks in `src/*.Notebook/` modified locally but not uploaded to Fabric? Check `git status src/`.
- [ ] **Pipeline GUID staleness**: Has any pipeline been re-deployed since the last `fix_pipeline_guids.py` run? If yes, flag to DevOps Lead.
- [ ] **Entity load failures**: Query `execution.EntityStatusSummary` for entities with `LastStatus = 'Failed'` in the last 24 hours. If count > 0, investigate before proceeding with planned work.
- [ ] **Variable Library consistency**: Spot-check that `VAR_CONFIG_FMD` workspace GUIDs match `config/item_config.yaml`. Drift here causes silent failures.
- [ ] **Stale lakehouse queries**: If any recent diagnostic work queried the SQL Analytics Endpoint, verify results are post-refresh. Never trust data less than 3 minutes old after a write.

If any gap is found, resolve it or escalate to the CTO before moving to Step 1.

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

## Step 2: Check Assignments

- `GET /api/companies/{companyId}/issues?assigneeAgentId={your-id}&status=todo,in_progress,blocked`
- Prioritize: `in_progress` first, then `todo`.
- If `PAPERCLIP_TASK_ID` is set, that task takes priority.
- If there is already an active run on an `in_progress` task, move to the next.

---

## Step 3: Checkout and Branch

- Checkout the task: `POST /api/issues/{id}/checkout`. Never retry a 409.
- Create or switch to your worktree branch: `fabric-engineer/{issue-key}`.
- Confirm you are in the correct worktree isolation before making changes.

---

## Step 4: Execute Work

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

Work falls into one of these categories. Follow the appropriate sub-checklist.

### 3a: Notebook Modification
1. Read the target notebook's `notebook-content.py` (or `.ipynb`).
2. Identify the medallion layer, parameters, and data lineage.
3. Make the change. Preserve all logging calls (`sp_UpsertEntityStatus`).
4. Verify no hardcoded GUIDs -- all references must come from Variable Library or parameters.
5. If the change affects SQL Analytics Endpoint queries, add force-refresh logic.
6. Commit to your worktree branch.

### 3b: Pipeline Modification
1. Read the target pipeline's `pipeline-content.json`.
2. Identify all activities, their timeouts, and `dependsOn` chains.
3. Make the change. Verify timeout hierarchy (inner < outer).
4. Confirm `batchCount: 15` on all ForEach activities.
5. Do NOT edit GUIDs. Flag for `fix_pipeline_guids.py` re-run.
6. Commit to your worktree branch.

### 3c: Source Database Analysis
1. Connect to the source DB via MCP tool (requires VPN).
2. Run PK discovery, watermark candidate analysis, row count estimation.
3. Document findings in a structured format.
4. If new entities are discovered, prepare entity registration data for DevOps Lead.

### 3d: Load Failure Investigation
1. Query `execution.AuditPipeline` and `execution.AuditCopyActivity` for the failing entity.
2. Check `execution.EntityStatusSummary` for last known good state.
3. Identify failure category: timeout, throttling, OOM, SourceName empty, schema mismatch.
4. If root cause is notebook-level, fix in the notebook.
5. If root cause is pipeline-level (timeout, batchCount), fix in pipeline JSON.
6. If root cause is metadata-level (empty SourceName, missing watermark), flag to DevOps Lead.

---

## Step 5: Update Task Status

- Comment on the issue with what was done, what files were changed, and what remains.
- If the work is complete, update status to `done`.
- If blocked, update status to `blocked` with a clear description of the blocker and who owns it.

---

## Step 6: Fact Extraction

1. Extract any durable facts discovered during this cycle (new Fabric behaviors, entity quirks, performance observations).
2. Write to `$AGENT_HOME/memory/YYYY-MM-DD.md`.
3. If the fact affects other agents (e.g., a new sync lag behavior), notify via Nexus message.

---

## Step 7: Mandatory Heartbeat Summary

**This step is non-negotiable. Every heartbeat cycle ends with this POST.**

```
POST /api/agents/{your-id}/heartbeat
Content-Type: application/json
X-Paperclip-Run-Id: {run-id}

{
  "status": "active|idle|blocked",
  "currentTask": "{issue-key or null}",
  "summary": "One-line description of what happened this cycle",
  "gapsDetected": ["list of any gaps found in Step 0"],
  "blockers": ["list of any blockers"],
  "artifactsChanged": ["list of files modified this cycle"]
}
```

If no work was done, status is `idle` and summary is `"No assignments. Standing by."` Do not invent work to look busy.
