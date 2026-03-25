---
description: "Full audit-to-packet pipeline: truth audit a page/subsystem, then generate sequenced implementation packets. One command, complete workflow."
allowed-tools: Read, Glob, Grep, Bash, Agent, WebFetch, WebSearch, AskUserQuestion, TodoWrite
---

# Audit & Packet — Full Truth-to-Implementation Pipeline

You are running the **complete audit-first workflow** in a single pass. This combines the truth audit (DIAGNOSE) and packet plan (PLAN) into one seamless pipeline.

$ARGUMENTS

## Inputs

The user will specify a **page name**, **subsystem**, or **feature area** to audit and packetize. If not specified, ASK.

---

## PHASE 1: TRUTH AUDIT (Diagnose Mode)

**No code changes. Read, analyze, document only.**

### Step 1: Inventory

1. **Identify all files involved.** Trace from frontend through API routes to backend logic and database:
   - Frontend: `dashboard/app/src/pages/*.tsx` or `dashboard/app/src/components/*.tsx`
   - API routes: `dashboard/app/api/routes/*.py`
   - Backend logic: `engine/*.py`, `dashboard/app/api/control_plane_db.py`
   - Database: SQLite tables, Fabric SQL metadata DB tables
   - Config: `config/*.yaml`, `config/*.json`

2. **Map the architecture chain:**
   ```
   Frontend (Component.tsx)
     -> fetch("/api/route/...")
     -> dashboard/app/api/routes/route.py
     -> backend logic
     -> database
   ```

3. **List every UI element that displays data** with: what the user sees, what API feeds it, what DB query produces it, what TypeScript interface defines the shape.

### Step 2: Reality Check

Classify every endpoint and data flow:

| Status | Meaning |
|--------|---------|
| **REAL** | Queries real data, transforms correctly, renders accurately |
| **STUBBED** | Returns hardcoded/fake data |
| **NAIVE** | Works but oversimplified logic |
| **PARTIAL** | Some data real, some hardcoded/missing |
| **MISLEADING** | UI suggests capability that doesn't exist — CRITICAL |
| **MISMATCHED** | Frontend TS interface doesn't match backend JSON shape |

### Step 3: API Contract Audit

For EACH endpoint the page calls:
1. Read the backend handler — document actual SQL and response shape
2. Read the frontend interface/type — document expected fields
3. Compare field-by-field:

| Frontend expects | Backend sends | DB column | Match? |
|---|---|---|---|
| `entity.source_name` | `entity.sourceName` | `SourceName` | MISMATCH |

4. Check for silent failures (optional chaining hiding missing data, empty catch blocks)

### Step 4: Cross-Reference

Check `docs/data-source-audit.html` for the page:
- Is it listed? Are all endpoints documented? Do sources match?
- If discrepancy: code is truth, flag the HTML as needing update.

### Step 5: Produce the Audit Document

Save to `dashboard/app/audits/AUDIT-{PageName}.md` with:

1. **Header**: Files audited, database, date
2. **Architecture summary**: Delegation chain diagram
3. **Findings table**:

| # | Severity | Category | Finding | Status |
|---|----------|----------|---------|--------|
| 1 | CRITICAL | Mismatch | Frontend expects X, backend sends Y | Open |

   Severity: CRITICAL > HIGH > MODERATE > LOW > Info
   Categories: Mismatch, Stub, Misleading, Missing, Naive, Partial, Accessibility, Performance, Security

4. **Items verified correct**: What IS working (so future work doesn't break it)
5. **Repair sequence**: Ordered list of minimal fixes with dependencies

If an existing audit exists, READ IT FIRST — update rather than replace if mostly still valid.

### Audit Hard Rules
- **No implementation.** DIAGNOSE mode only.
- **Line numbers mandatory.** Every finding references specific lines in specific files.
- **Be concrete.** "Line 247 reads `data.status` but API returns `data.state`" — never "needs work."
- **Check real data** when possible (query SQLite, hit endpoints).
- **Flag N-source violations** (hardcoded source counts/names).
- **Flag physical vs registered count confusion** as CRITICAL.

---

## PHASE 2: PACKET PLAN (Plan Mode)

**No code changes. Produce packet documents only.**

### Step 6: Dependency Analysis

For each finding from Phase 1:
- What files does it touch?
- What must be fixed first? What depends on it?
- Risk level (can it break existing functionality)?

### Step 7: Group into Packets

Rules:
1. **Foundation first** — API contract fixes, field alignment, schema changes → Packet A
2. **One concern per packet** — don't mix backend pipeline work with UI polish
3. **Each packet testable in isolation** — page must be better after each packet, never worse
4. **Packet size: 1-4 hours** — split if larger
5. **No forward dependencies** — depend on earlier packets only
6. **Explicit non-scope** — every packet states what it does NOT touch

### Step 8: Write Each Packet

Save to `docs/packets/PACKET_{PAGE}_{LETTER}_{NAME}.md`:

```markdown
# PACKET {LETTER}: {Name}

## Objective
One sentence: what this delivers and why.

## Scope
Exactly what changes — file names, function names, endpoint paths.

## Explicit Non-Scope
What this does NOT touch. Prevents scope creep.

## Findings Addressed
Audit finding numbers (e.g., "Fixes #1, #2, #5 from AUDIT-PageName.md")

## Files to Change
- `path/to/file.ext` — what changes and why

## Dependencies
- Depends on: [Packet X] or [nothing]
- Blocks: [Packet Y] or [nothing]

## Acceptance Criteria
Numbered, specific, testable criteria.

## Stop Conditions
When to STOP and reassess instead of continuing.

## Verification Steps
Ordered checks with expected results.
```

### Step 9: Produce Packet Index

Save to `docs/packets/PACKET_INDEX_{PAGE}.md`:

| Packet | Name | Findings | Depends On | Est. Scope | Status |
|--------|------|----------|------------|------------|--------|
| A | Foundation & Contracts | #1, #2 | — | Small | Pending |
| B | Real Data Pipeline | #3, #7 | A | Medium | Pending |

Create `docs/packets/` if it doesn't exist.

---

## PHASE 3: REPORT TO USER

After both phases complete, give the user:

1. **Audit summary**: Total findings by severity, how many CRITICAL/HIGH
2. **Packet summary**: How many packets, critical path, total estimated scope
3. **Recommended starting point**: Which packet to execute first and why
4. **Open questions**: Anything that needs answers before starting
5. **Data source audit status**: Whether `docs/data-source-audit.html` needs updating

---

## Hard Rules (Both Phases)

- **No implementation in this command.** This produces audit + plan documents. Code changes happen when executing packets.
- **Findings from audit drive packets.** Don't invent work not backed by findings.
- **Respect operating modes.** This command = DIAGNOSE + PLAN. Execution = separate step.
- **No scope creep baked in.** "Nice to have" goes in a backlog note, not a packet.
- **Update data source audit.** If packets will change data sources, note it in verification steps.
