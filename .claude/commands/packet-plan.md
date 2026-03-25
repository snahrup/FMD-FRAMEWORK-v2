---
description: "Generate a sequenced packet implementation plan from a truth audit. Each packet is a scoped, independently testable unit of work with acceptance criteria and stop conditions."
allowed-tools: Read, Glob, Grep, Bash, Agent, WebFetch, WebSearch, AskUserQuestion, TodoWrite
---

# Packet Plan — Sequenced Implementation from Truth Audit

You are entering **Packet Plan mode**. This takes a completed truth audit and produces a sequenced set of implementation packets — scoped units of work that can be executed one at a time, each building on the previous.

## Prerequisites

A truth audit MUST exist before generating packets. Check for:
- `dashboard/app/audits/AUDIT-{PageName}.md` — the page-level audit
- Or a system-level audit document specified by the user

If no audit exists, STOP and tell the user to run `/truth-audit` first.

$ARGUMENTS

## Inputs

The user will specify:
- A **page/subsystem name** that has a completed truth audit
- Optionally, which findings or repairs to prioritize
- Optionally, constraints (e.g., "backend only", "no schema changes", "ship by Thursday")

If no page is specified, ASK.

## Packet Generation Process

### Step 1: Load the Truth Audit

Read the audit document. Extract:
- All findings with their severity and status
- The repair sequence (if proposed in the audit)
- The preliminary packet grouping (if proposed)
- Any cross-page dependencies noted

### Step 2: Dependency Analysis

For each finding/repair, determine:
- **What it touches** (files, endpoints, DB tables)
- **What it depends on** (other repairs that must happen first)
- **What depends on it** (repairs that can't happen until this is done)
- **Risk level** (can it break existing functionality?)

Build a dependency graph. Identify the critical path.

### Step 3: Group into Packets

Rules for packet grouping:
1. **Foundation first.** API contract fixes, field alignment, schema changes — these ALWAYS go in Packet 1.
2. **One concern per packet.** Don't mix backend data pipeline work with UI polish in the same packet.
3. **Each packet is testable in isolation.** After completing a packet, the page should be in a better state than before — never worse.
4. **Packet size: 1-4 hours of work.** If a packet would take longer, split it.
5. **No forward dependencies.** A packet can depend on earlier packets, never on later ones.
6. **Explicit non-scope.** Every packet must state what it does NOT touch.

### Step 4: Write Each Packet

For EACH packet, produce this exact structure:

```markdown
# PACKET {LETTER}: {Name}

## Objective
One sentence: what this packet delivers and why it matters.

## Scope
Bullet list of exactly what changes. Be specific — file names, function names, endpoint paths.

## Explicit Non-Scope
What this packet does NOT touch. Be specific. This prevents scope creep.

## Findings Addressed
List the audit finding numbers this packet fixes (e.g., "Fixes #1, #2, #5 from AUDIT-PageName.md")

## Files to Change
- `path/to/file.ext` — what changes and why
- `path/to/other.ext` — what changes and why

## Dependencies
- Depends on: [Packet X] or [nothing]
- Blocks: [Packet Y] or [nothing]

## Acceptance Criteria
Numbered list of specific, testable criteria. Each one should be verifiable by:
- Reading the code
- Hitting an endpoint
- Checking the UI
- Querying the database

## Stop Conditions
When to STOP and reassess instead of continuing:
- If [specific condition], stop and re-audit
- If [specific condition], escalate to user

## Verification Steps
After implementation, run these checks in order:
1. [Specific check with expected result]
2. [Specific check with expected result]
3. [Specific check with expected result]
```

### Step 5: Packet Index

After all packets are written, produce a summary index:

```markdown
# Packet Index — {Page/Subsystem Name}

| Packet | Name | Findings | Depends On | Est. Scope | Status |
|--------|------|----------|------------|------------|--------|
| A | Foundation & Contracts | #1, #2, #5 | — | Small | Pending |
| B | Real Data Pipeline | #3, #7 | A | Medium | Pending |
| C | UI Truth & Polish | #4, #6, #8 | B | Small | Pending |
```

## Output

Save packets to: `docs/packets/PACKET_{PAGE}_{LETTER}_{NAME}.md`
Save the index to: `docs/packets/PACKET_INDEX_{PAGE}.md`

Create the `docs/packets/` directory if it doesn't exist.

## After Generating

Tell the user:
1. How many packets were generated
2. The critical path (which packets are on the longest dependency chain)
3. Total estimated scope
4. Which packet to start with and why
5. Any risks or open questions that need answers before starting

## Hard Rules

- **No implementation.** This is PLAN mode. Produce documents, don't write code.
- **Every packet must be independently verifiable.** "Trust me, it works" is not acceptable.
- **Findings from the audit drive everything.** Don't invent new work that isn't backed by an audit finding.
- **Respect the operating modes.** Truth Audit = DIAGNOSE. Packet Plan = PLAN. Packet execution = IMPLEMENT. Post-packet check = REVIEW.
- **No scope creep baked in.** If something "would be nice" but isn't fixing an audit finding, it doesn't go in a packet. It goes in a backlog note.
- **Update the data source audit.** If any packet will change data sources for UI elements, note that `docs/data-source-audit.html` must be updated as part of that packet's verification.
