---
description: "Run a truth audit on a page or subsystem — maps every UI element to its real data source, identifies stubs/mismatches/misleading UI, and produces a structured AUDIT doc. Must be run BEFORE any packet implementation."
allowed-tools: Read, Glob, Grep, Bash, Agent, WebFetch, WebSearch, AskUserQuestion, TodoWrite
---

# Truth Audit — Page/Subsystem Data Source Correctness Audit

You are entering **Truth Audit mode**. This is the MANDATORY first step before any page repair, feature build, or subsystem overhaul. No implementation without a truth audit. No exceptions.

## What You're Doing

You will produce a comprehensive truth audit for the specified page or subsystem. The audit maps every UI element to its real backend data source, identifies what's real vs stubbed vs misleading, and produces a structured markdown document that becomes the source of truth for all subsequent work.

## Inputs

The user will specify one of:
- A **page name** (e.g., "LoadMissionControl", "GoldLedger", "BusinessOverview")
- A **subsystem** (e.g., "extraction pipeline", "entity registration", "classification")
- A **feature area** (e.g., "SCD audit", "DQ scoring", "load optimization")

If the user doesn't specify, ASK. Don't guess.

$ARGUMENTS

## Audit Process — Follow Exactly

### Phase 1: Inventory

1. **Identify all files involved.** Trace from the frontend component through API routes to backend logic and database queries:
   - Frontend: `dashboard/app/src/pages/*.tsx` or `dashboard/app/src/components/*.tsx`
   - API routes: `dashboard/app/api/routes/*.py`
   - Backend logic: `engine/*.py`, `dashboard/app/api/control_plane_db.py`
   - Database: SQLite tables in `fmd_control_plane.db`, Fabric SQL metadata DB tables
   - Config: `config/*.yaml`, `config/*.json`

2. **Map the architecture chain.** Draw the delegation chain:
   ```
   Frontend (Component.tsx)
     -> fetch("/api/route/...")
     -> dashboard/app/api/routes/route.py
     -> backend logic (engine or control_plane_db)
     -> database (SQLite or Fabric SQL)
   ```

3. **List every UI element that displays data.** For each:
   - What does the user see? (label, value, badge, chart, table column)
   - What API endpoint feeds it?
   - What database query produces the data?
   - What TypeScript interface defines the expected shape?

### Phase 2: Reality Check — Real vs Stubbed vs Misleading

For every endpoint and data flow, classify each as:

| Status | Meaning | Action |
|--------|---------|--------|
| **REAL** | Backend queries real data, transforms correctly, frontend renders accurately | Document and move on |
| **STUBBED** | Endpoint returns hardcoded/fake data, or frontend uses mock data | Flag as needing implementation |
| **NAIVE** | Works but uses oversimplified logic (e.g., COUNT(*) instead of proper aggregation) | Flag with what "correct" looks like |
| **PARTIAL** | Some data is real, some is hardcoded or missing | Flag exactly which parts are real vs fake |
| **MISLEADING** | UI suggests a capability that doesn't exist (e.g., button that does nothing, metric from wrong source) | Flag as CRITICAL — these erode trust |
| **MISMATCHED** | Frontend TypeScript interface doesn't match backend JSON response shape | Flag with exact field-by-field comparison |

### Phase 3: API Contract Audit

For EACH endpoint the page calls:

1. **Read the backend handler.** Document the actual SQL query and response shape.
2. **Read the frontend interface/type.** Document what fields the component expects.
3. **Compare field-by-field.** Create a table:

| Frontend expects | Backend sends | DB column | Match? |
|---|---|---|---|
| `entity.source_name` | `entity.sourceName` | `SourceName` | MISMATCH (case) |
| `entity.row_count` | *(missing)* | `RowsWritten` | MISSING |

4. **Check for silent failures.** Does the frontend have `?.` optional chaining that silently hides missing data? Does it catch errors and show nothing?

### Phase 4: Cross-Reference with Data Source Audit

Check `docs/data-source-audit.html` for the page being audited:
- Is the page listed?
- Are all endpoints documented?
- Do the documented data sources match what you found?
- If there's a discrepancy, the CODE is truth — flag the audit HTML as needing update.

### Phase 5: Findings Summary

Produce a structured summary table:

| # | Severity | Category | Finding | Status |
|---|----------|----------|---------|--------|
| 1 | CRITICAL | Mismatch | Frontend expects `started_at`, backend sends `started` | Open |
| 2 | HIGH | Stub | `/api/foo/bar` returns hardcoded array | Open |
| 3 | MODERATE | Misleading | "Export" button has no handler | Open |

Severity scale: **CRITICAL** > **HIGH** > **MODERATE** > **LOW** > Info

Categories: Mismatch, Stub, Misleading, Missing, Naive, Partial, Accessibility, Performance, Security

### Phase 6: Items Verified Correct

List what IS working. Don't just report problems — document what's solid so future work doesn't break it.

### Phase 7: Repair Sequence Proposal

Based on findings, propose a **minimal, ordered repair sequence**:

1. **Foundation repairs first** (API contract fixes, field name alignment)
2. **Data pipeline repairs** (replace stubs with real queries)
3. **UI truth repairs** (remove misleading elements, fix rendering)
4. **Polish** (loading states, error handling, edge cases)

Each repair should note:
- What it fixes (finding #s)
- What files it touches
- What it depends on (earlier repairs)
- Estimated scope (small/medium/large)

### Phase 8: Recommended Packet Sequence

Propose how to group repairs into **packets** (implementation units). Each packet should be:
- Independently deployable
- Testable in isolation
- Sequenced so no packet depends on a later packet

Format:
```
PACKET A: [Name] — Fixes #1, #2, #5
  Files: route.py, Component.tsx
  Depends on: nothing
  Delivers: API contract alignment

PACKET B: [Name] — Fixes #3, #7
  Files: backend_logic.py, route.py
  Depends on: Packet A
  Delivers: Real data replacing stubs
```

## Output

Save the audit to: `dashboard/app/audits/AUDIT-{PageName}.md`

If an audit already exists for this page, READ IT FIRST. Then either:
- **Update it** if the existing audit is mostly still valid (add new findings, mark fixed ones)
- **Replace it** if the page has changed substantially since the last audit

After saving, tell the user:
1. Total findings by severity
2. How many are CRITICAL or HIGH
3. The recommended packet sequence
4. Whether `docs/data-source-audit.html` needs updating

## Hard Rules

- **NO implementation during audit.** This is DIAGNOSE mode only. Read, analyze, document. Don't fix anything.
- **Line numbers are mandatory.** Every finding must reference specific lines in specific files.
- **Be concrete, never vague.** "Needs work" is not a finding. "Line 247 reads `data.status` but API returns `data.state`" is a finding.
- **Check the REAL database, not just code.** If you can query SQLite, do it. If you can hit an API endpoint, do it.
- **Frontend TypeScript interfaces are contracts.** If the backend doesn't match the interface, that's a bug — even if the UI "works" via optional chaining.
- **Scalability rule applies.** Flag any hardcoded source counts, hardcoded source names, or anything that violates the N-source scalability rule.
- **Flag physical vs registered count confusion.** If any metric shows registered entity counts as if they're physical table/row counts, that's CRITICAL.
