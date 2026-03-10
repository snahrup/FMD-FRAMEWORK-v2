# HEARTBEAT.md -- DevOps Lead Execution Checklist

Run this checklist every heartbeat cycle (2 minutes). Do not skip steps. Do not reorder.

---

## Step 0: Gap Detection

Before doing any planned work, scan for gaps. These catch drift before it becomes downtime.

- [ ] **Config drift**: Has `config/item_config.yaml` been modified since last verified against Fabric REST API? If timestamp changed, re-validate workspace IDs.
- [ ] **GUID registry staleness**: Has any pipeline or notebook been re-deployed without updating `config/id_registry.json`? Cross-reference `git log --oneline -5 src/` with `git log --oneline -5 config/id_registry.json`.
- [ ] **Deploy state consistency**: Does `.deploy_state.json` reflect the last actual deployment? Check phase completion timestamps.
- [ ] **Remote server reachability**: If any task involves `vsc-fabric`, verify connectivity before starting work.
- [ ] **Entity count reconciliation**: Spot-check `config/entity_registration.json` entity count vs `SELECT COUNT(*) FROM integration.LandingzoneEntity`. Mismatch means registration drift.
- [ ] **Untracked scripts**: Are there new `.py` files in `scripts/` not yet committed? Check `git status scripts/`.

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
- Create or switch to your worktree branch: `devops-lead/{issue-key}`.
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

### 3a: Deploy Script Modification
1. Read `deploy_from_scratch.py`. Identify the target phase.
2. Understand the phase's dependencies (what must run before it, what runs after it).
3. Make the change. Verify idempotency: the phase must produce the same result on first run and re-run.
4. If adding a new phase, insert it at the correct dependency position and update Phase 17 validation.
5. Test with `--dry-run` if available, or trace the logic manually.
6. Commit to your worktree branch.

### 3b: Config File Update
1. Identify which config file needs updating and why.
2. For `item_config.yaml`: verify new values against Fabric REST API before writing.
3. For `entity_registration.json`: verify entity definitions against source DB metadata.
4. For `source_systems.yaml`: verify connection parameters (hostname, database name, auth method).
5. For `id_registry.json`: run `fix_pipeline_guids.py` to regenerate, do not edit manually.
6. Update all downstream consumers if the schema changes.
7. Commit to your worktree branch.

### 3c: Script Creation/Modification
1. Check if a similar script already exists in `scripts/`. Do not duplicate.
2. Follow existing patterns: SP auth, pyodbc connection handling, structured logging.
3. Make it idempotent. Make it re-runnable. Make it safe to Ctrl+C mid-run.
4. Add error handling with clear messages (not just tracebacks).
5. If the script replaces a manual step, add a comment in `deploy_from_scratch.py` referencing it.
6. Commit to your worktree branch.

### 3d: Remote Server Deployment
1. Verify `vsc-fabric` is reachable and services are running.
2. Check Node version is v22 LTS.
3. Diff config bundle on server vs repo.
4. Deploy via the config bundle mechanism (Phase 12), not manual file copy.
5. Restart affected services via NSSM if config changes require it.
6. Verify IIS is serving correctly after deployment.
7. Document any server-side changes in deployment log.

### 3e: GUID Remapping
1. Confirm which pipelines were re-deployed (check with Fabric Engineer).
2. Run `fix_pipeline_guids.py` with current workspace context.
3. Validate output: every pipeline internal reference must resolve.
4. Update `config/id_registry.json`.
5. Commit updated registry.
6. Notify Fabric Engineer that remapping is complete.

### 3f: CI/CD Pipeline Work
1. Read existing workflow definitions in `.github/workflows/`.
2. Ensure new workflows follow existing patterns (trigger conditions, environment setup, secret references).
3. Test workflow syntax with `gh workflow view` before push.
4. Commit to your worktree branch.

---

## Step 5: Update Task Status

- Comment on the issue with what was done, what files were changed, and what remains.
- For deployment work, include the exact command run and its exit code.
- If the work is complete, update status to `done`.
- If blocked, update status to `blocked` with a clear description of the blocker and who owns it.

---

## Step 6: Fact Extraction

1. Extract durable facts discovered during this cycle (new deployment behaviors, config quirks, server observations).
2. Write to `$AGENT_HOME/memory/YYYY-MM-DD.md`.
3. If the fact affects deployment safety (e.g., a new phase dependency), update the deploy script comments immediately -- do not rely on memory alone.

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
  "artifactsChanged": ["list of files modified this cycle"],
  "deployState": {
    "lastPhaseRun": null,
    "lastPhaseResult": null,
    "configDriftDetected": false
  }
}
```

If no work was done, status is `idle` and summary is `"No assignments. Monitoring for drift."` Do not invent work to look busy.
