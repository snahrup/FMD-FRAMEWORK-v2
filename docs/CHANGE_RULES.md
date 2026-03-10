# Change Rules — FMD Framework

> **This file governs HOW Claude Code (and any automated agent) is allowed to operate in this repo.**
> Violations of these rules are bugs, not features.

---

## Operating Modes

All work in this repo follows a strict mode progression. You must be in exactly one mode at any time.

### 1. DIAGNOSE MODE

**When**: User reports a failure, something looks wrong, or investigation is needed.

**Allowed actions**:
- Read any file
- Run queries against SQL metadata DB or source databases
- Read logs (engine, dashboard, Fabric)
- Trace execution paths through code
- Form and state hypotheses
- Use MCP tools for code analysis (RepoMapper, code-understanding)
- Run `semgrep scan` for static analysis

**Forbidden actions**:
- Editing ANY source file
- Creating new files
- Running deployment scripts
- Triggering pipelines or notebooks
- Refactoring
- "Quick fixes"

**Required output**: A hypothesis statement with supporting evidence, then explicit transition to PLAN MODE.

### 2. PLAN MODE

**When**: A change is needed. Always comes after DIAGNOSE (for bugs) or after requirements clarification (for features).

**Required output**:
| Element | Description |
|---------|-------------|
| Root cause / Goal | What is being fixed or built, and why |
| Files to touch | Exact file paths, approximate line numbers |
| Change description | What will change in each file |
| Blast radius | What other components could be affected |
| Decision conflicts | Does this conflict with anything in `docs/DECISIONS.md`? |
| Test plan | How will we verify the change works? |
| Rollback plan | How do we undo this if it goes wrong? |
| Checkpoint | Recommend pre-change commit if there are uncommitted changes |

**Forbidden actions**: Implementation before the plan is stated.

### 3. IMPLEMENT MODE

**When**: Plan is stated and user has acknowledged or approved.

**Rules**:
- Touch ONLY the files listed in the plan.
- Make ONLY the changes described in the plan.
- No opportunistic refactors, cleanup, or "improvements."
- No unrelated file edits.
- No architecture changes unless explicitly approved AND documented in `docs/DECISIONS.md`.
- If you discover a new problem during implementation, LOG IT in `docs/TASK_BACKLOG.md` — do not fix it in the same change.
- Recommend checkpoint commit after implementation.

**Exceptions**: If a planned change reveals it cannot work as designed, STOP. Return to PLAN MODE with updated analysis.

### 4. REVIEW MODE

**When**: After implementation is complete.

**Required actions**:
- Verify the change works (run tests, check output, query DB, etc.)
- Check for regressions in adjacent functionality
- Update `docs/CURRENT_STATE.md` with new state
- Update `docs/TASK_BACKLOG.md` (mark completed, add follow-ups)
- Update `docs/DECISIONS.md` if an architecture decision was made or changed
- Recommend checkpoint commit with descriptive message

---

## Anti-Chaos Guardrails

### Decision Authority
- `docs/DECISIONS.md` is the source of truth for architecture decisions.
- `ARCHITECTURE.md` (root) is the source of truth for paths, GUIDs, schema, and constraints.
- No architectural change may be made without explicitly referencing the decision being changed.
- No silent overwrites of previously documented decisions.

### Scope Control
- A bug fix changes ONLY what is necessary to fix the bug.
- A feature adds ONLY what was requested.
- No "while I'm in this file" improvements.
- No adding logging, comments, type annotations, or docstrings to code you didn't change.
- No reformatting files you didn't change.

### Failure Response Protocol
- When user reports a failure: start in DIAGNOSE MODE. Always.
- Do NOT jump to "let me fix that" without diagnosis.
- Do NOT assume the fix is obvious. The obvious fix often introduces new problems.
- Do NOT apply the same failed fix a second time with minor variations.

### Checkpoint Protocol
- Before meaningful changes: recommend `git commit` of current state.
- After meaningful changes: recommend `git commit` with WHY-focused message.
- Never use `git add .` or `git add -A` — stage specific files.
- Never amend commits unless explicitly asked.
- Never force-push unless explicitly asked.

### Conflict Resolution
- If a proposed change conflicts with a prior decision in `docs/DECISIONS.md`, STOP.
- Surface the conflict: "This change would override decision D-NNN (date, rationale)."
- Let the user decide. If approved, update `docs/DECISIONS.md` with the new decision.

### Deployment Safety
- `deploy_from_scratch.py` is the canonical deployment path. Do not invent alternatives.
- Notebooks must be uploaded to Fabric after local changes (`scripts/upload_notebooks_to_fabric.py`).
- Pipeline GUIDs must be remapped after re-deployment (`scripts/fix_pipeline_guids.py`).
- Never trigger production pipelines without explicit user approval.

---

## File Update Requirements

After any meaningful change, these files MUST be reviewed for needed updates:

| File | Update when... |
|------|----------------|
| `docs/CURRENT_STATE.md` | State of the repo changed (something fixed, broken, added, or removed) |
| `docs/TASK_BACKLOG.md` | Work items completed, new work identified, priorities shifted |
| `docs/DECISIONS.md` | An architecture decision was made, changed, or revisited |
| `ARCHITECTURE.md` | Paths, GUIDs, schema, pipeline chain, or hard rules changed |
| `TRIAGE_RUNBOOK.md` | Operational procedures changed or new debugging steps discovered |

---

## SonarQube (Phase 2 — Not Yet Active)

SonarQube integration is planned but not required for the current operating setup.
When implemented, it would add:
- Continuous code quality tracking
- Technical debt measurement
- Coverage enforcement

For now, Semgrep + CodeQL provide the guardrail layer.

---

*Last updated: 2026-03-06*
