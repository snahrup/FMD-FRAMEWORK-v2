# Codex Handoff

Use this file as the primary bootstrap for new Codex threads working on dashboard UX, information architecture, modernization, or cross-page coherence in this repo.

## Start Here
Read these in order:

1. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\CODEX.md`
2. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\docs\superpowers\plans\2026-04-09-dashboard-single-app-modernization-program.md`
3. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\.interface-design\system.md`
4. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\docs\superpowers\specs\2026-04-09-gold-studio-redesign-brief.md`
5. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\docs\superpowers\plans\2026-04-09-gold-studio-redesign-implementation-plan.md`
6. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\docs\superpowers\specs\2026-04-09-gold-studio-coverage-map.md`

## Context Priority
Use context in this order:

1. `C:\Users\snahrup\CascadeProjects\fabric_toolbox\knowledge`
   This is the primary IP Corp business and systems knowledge base.
2. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\knowledge`
   This is secondary FMD-platform context: audits, UX screenshots, implementation notes, and local findings.
3. The current codebase and route inventory in this repo.
4. Official external documentation when current platform behavior needs verification.

## Mandatory Design Inputs
Read these skill files directly and follow them as constraints:

- `C:\Users\snahrup\.claude\skills\interface-design\SKILL.md`
- `C:\Users\snahrup\.claude\skills\modernize\SKILL.md`

These are Claude-oriented assets, but Codex should treat them as design instructions, not commands.

## Product Rules
- Preserve the current FMD visual language.
- Do not treat modernization as a rebrand.
- Keep the current fonts, warm neutral and copper palette, and current motion language unless there is a specific reason to change them.
- Assume the end user has zero context.
- Every page must explain what it is, why it matters, and what happens next.
- No silent background behavior. Running work must show current state, last update, milestone, next expected change, and preserved work.
- Favor fewer, clearer destinations over page sprawl.
- Never remove functionality without explicitly re-homing it.
- If a page is structurally wrong, a full rewrite is allowed. Preserve the user job and capability, not the current layout.
- Gold Studio is the reference implementation pattern for clarity, flow, async trust, and lifecycle framing.

## IP Corp Domain Constraints
Design and IA decisions should reflect:

- IP Corporation as a multi-company manufacturing conglomerate
- M3 as the system of record
- MES, ANV, and OATES manufacturing traceability
- Batch ID as the cross-system key
- Fabric medallion migration goals
- Purview governance and lineage goals
- company-isolation constraints, especially around financial visibility
- Salesforce as a source family, not a one-off connector

## External Research Standard
When redesigning a destination, verify relevant patterns against current official docs first:

- Microsoft Fabric
- Power BI
- Microsoft Purview
- OpenMetadata
- dbt

Do not redesign from taste alone. Benchmark the target job against current platform capabilities and then adapt those patterns to IP Corp.

## Immediate Execution Model
When modernizing or regrouping the dashboard:

1. Use the app-wide modernization program as the governing spec.
2. Preserve the current aesthetic.
3. Consolidate pages where the page boundary is artificial.
4. Re-home all functionality explicitly.
5. Prefer shared primitives over page-local invention.
6. Push work to `feat/mobile-phase0-foundation` unless told otherwise.

## Current Branch Context
Recent relevant work already exists on:
- branch: `feat/mobile-phase0-foundation`

Key design and planning commits on that branch include:
- `6b71652` Gold Studio redesign and coverage/release work
- `48eef36` app-wide modernization groups
- `c34ab3b` consolidation parity rules
- `3dcfed8` modernization research standard
- `2b828dd` integration and rewrite rules
- `11a97c3` Purview and Salesforce references
- `c8bd43b` preserve current aesthetic and add IP Corp context
- `375fb5b` prioritize fabric toolbox knowledge base

## Handoff Doc
For a fuller thread bootstrap, also read:

- `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\docs\superpowers\plans\2026-04-09-codex-dashboard-handoff.md`

