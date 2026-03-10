# Claude Code Operating Rules — FMD Framework

> **READ THIS FIRST. EVERY SESSION. NO EXCEPTIONS.**

## Session Startup Checklist

1. Read `ARCHITECTURE.md` (root) — the single source of truth for paths, GUIDs, schema, and pipeline architecture.
2. Read `docs/CURRENT_STATE.md` — what's working, what's fragile, what's in progress.
3. Read `docs/DECISIONS.md` — architecture decisions you must not silently override.
4. Read `docs/CHANGE_RULES.md` — the process rules for how you operate in this repo.
5. Check `docs/TASK_BACKLOG.md` — know what's prioritized before starting new work.

## Operating Modes

You operate in exactly ONE mode at a time. State which mode you are in.

### DIAGNOSE MODE (Default when user reports a failure)
- **Allowed**: Read files, trace execution, query databases, read logs, form hypotheses.
- **Forbidden**: Editing ANY files. No refactors, no fixes, no "quick" patches.
- **Output**: Hypothesis with evidence. Then transition to PLAN MODE if a fix is needed.

### PLAN MODE (Required before any non-trivial change)
- **Output required**:
  - Likely root cause
  - Exact files to touch (with line numbers if possible)
  - Reason for each change
  - Blast radius assessment
  - Test plan
  - Whether this conflicts with any entry in DECISIONS.md
- **Forbidden**: Implementation before the plan is stated and acknowledged.

### IMPLEMENT MODE (Only after plan is clear)
- Only change the files listed in the plan.
- No opportunistic refactors. No "while I'm here" edits.
- No unrelated files. No architecture rewrites unless explicitly approved.
- If you discover a new issue during implementation, note it — don't fix it in the same change.
- Recommend a checkpoint commit before AND after meaningful changes.

### REVIEW MODE (After implementation)
- Verify the change works as intended.
- Identify regressions or follow-up work.
- Update `docs/CURRENT_STATE.md` and `docs/TASK_BACKLOG.md`.
- Recommend a checkpoint commit.

## Hard Rules

1. **ARCHITECTURE.md is law.** No architectural change without explicitly referencing the decision being changed.
2. **No silent overwrites.** If you change something that was previously decided in DECISIONS.md, surface the conflict FIRST.
3. **No scope creep.** A bug fix changes the bug. It does not clean up adjacent code, add logging, refactor imports, or improve comments.
4. **No opportunistic cleanup during failures.** When something breaks, fix the break. Don't "improve" anything else.
5. **Paths are `{Namespace}/{Table}`.** Everywhere. LZ, Bronze, Silver, Gold. No exceptions. See ARCHITECTURE.md §1.
6. **GUIDs come from config.** Never hardcode GUIDs in source files. Always reference `config/item_config.yaml`.
7. **SP auth scope is `analysis.windows.net/powerbi/api/.default`.** Not `database.windows.net`. See ARCHITECTURE.md §2.
8. **Short hostnames only.** No `.ipaper.com` suffix on source server names.
9. **deploy_from_scratch.py is the deployment path.** Not NB_SETUP_FMD. Not manual Fabric portal actions.
10. **Upload notebooks after local changes.** Local files are version control source of truth. Fabric has runtime copies.

## Checkpoint Commit Protocol

Before making a meaningful change:
- Recommend `git add` + `git commit` of the current state.

After making a meaningful change:
- Stage only the files you changed.
- Commit with a message that explains WHY, not just WHAT.
- Update `docs/CURRENT_STATE.md` if the state changed.

## When You Don't Know

- Say "I don't know" or "I need to investigate."
- Do NOT guess at GUIDs, paths, stored proc parameters, or API behavior.
- Do NOT invent solutions based on assumptions about Fabric APIs. Check the code.

## MCP Tools Available

- **RepoMapper** (`mcp__RepoMapper__repo_map`): Generate Tree-sitter + PageRank repo map. Use `project_root` parameter.
- **code-understanding** (`mcp__code-understanding__*`): Deep code analysis, critical file identification, documentation extraction.
- **Semgrep**: Run `semgrep scan --config .semgrep.yml` for local static analysis.
- See `~/.claude/.mcp.json` for global MCP tools (SQL servers, Fabric, Power BI, etc.)

## File Reference

| File | Purpose |
|------|---------|
| `ARCHITECTURE.md` | Single source of truth: paths, GUIDs, schema, pipeline chain |
| `docs/CURRENT_STATE.md` | What works, what's fragile, what's in progress |
| `docs/DECISIONS.md` | Architecture decisions — do not silently override |
| `docs/CHANGE_RULES.md` | Process rules for operating in this repo |
| `docs/TASK_BACKLOG.md` | Prioritized work items with scoring |
| `TRIAGE_RUNBOOK.md` | Step-by-step operational troubleshooting |
| `config/item_config.yaml` | Workspace/Lakehouse/Connection GUIDs |
| `config/item_deployment.json` | Fabric item GUIDs (notebooks, pipelines) |
| `dashboard/app/api/config.json` | Dashboard + engine runtime config |

---

*Last updated: 2026-03-06*
