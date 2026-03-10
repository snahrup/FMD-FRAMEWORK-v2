---
description: "Walk through the current work step-by-step out loud, validating every assumption and ID at each step before moving on. Forces methodical verification instead of assuming things are wired correctly."
allowed-tools: Read, Glob, Grep, Bash, Agent, WebFetch, WebSearch, AskUserQuestion, TodoWrite
---

# Verbal QA — Step-by-Step Walkthrough with Live Validation

You are entering **Verbal QA mode**. This is a methodical, out-loud walkthrough of whatever you're currently working on. The goal is to catch broken assumptions, stale IDs, wrong references, and missing connections BEFORE they become problems.

## Rules — MANDATORY, NO EXCEPTIONS

1. **Start from the very beginning.** Don't skip steps. Don't assume anything is correct because "the code looks right." Trace the FULL path from input to output.

2. **Talk through every step out loud.** Before you validate, STATE what you expect to find. Then validate. Then report whether it matched or not. Example:
   - "Step 3: The pipeline runner reads `pipeline_copy_sql_id` from config. I expect this to be a real Fabric pipeline GUID that exists in the CODE workspace."
   - *[runs validation query/check]*
   - "CONFIRMED: `9a06a21d-...` exists in workspace `c0366b24-...` as `PL_FMD_LDZ_COPY_SQL`."
   - OR: "MISMATCH: Config says `9a06a21d-...` but workspace only has `abc123-...`. This needs fixing."

3. **Validate with REAL data, not just code inspection.** Reading code and saying "this looks right" is NOT validation. Query the database. Hit the API. Read the config file. Check the actual deployed state. If an ID is supposed to exist in Fabric, VERIFY it exists in Fabric.

4. **Follow the data flow end-to-end.** For any feature that moves data or triggers actions, trace:
   - Where does the input come from? (config file? database? API parameter?)
   - What transforms or maps it? (code logic, SQL query, parameter mapping?)
   - Where does the output go? (API endpoint? database table? file system?)
   - Does the destination actually exist and accept this format?

5. **Check every ID, GUID, and reference against its source of truth.** Don't trust cached values. Don't trust deploy state files without cross-referencing. The source of truth hierarchy is:
   - Fabric API (what actually exists) > Metadata DB (what's registered) > Config files (what's configured) > Code defaults (what's hardcoded)

6. **One step at a time.** Complete each validation before moving to the next. If a step fails, STOP and report the issue. Don't continue past broken steps hoping they'll resolve themselves.

7. **Use a numbered checklist.** Track each step with a clear PASS/FAIL/WARN status. At the end, produce a summary of all findings.

8. **When you find a problem, fix it immediately** (if safe to do so) or flag it clearly for the user with the exact issue and what needs to happen.

## Walkthrough Structure

### Phase 1: Inventory
- What are we validating? (feature name, data flow, integration point)
- What are all the components involved? (files, configs, databases, APIs)
- What are all the IDs/GUIDs/references that need to be correct?

### Phase 2: Step-by-Step Trace
For each step in the data/control flow:
1. STATE what this step does and what you expect
2. VALIDATE against real data (query, API call, file read)
3. REPORT: PASS / FAIL / WARN with evidence

### Phase 3: Summary
- Total steps checked
- Passes / Failures / Warnings
- Any issues found and their fixes (applied or pending)

$ARGUMENTS
