---
description: "Run interface-design with IP Corp context, the FMD design system, and the app-wide modernization program."
allowed-tools: Read, Glob, Grep, Bash, WebFetch, WebSearch, Edit, MultiEdit, Write
argument-hint: [target page, flow, or destination]
---

Use the `interface-design` skill at:
`C:\Users\snahrup\.claude\skills\interface-design\SKILL.md`

Target:
`$ARGUMENTS`

Before proposing or implementing anything:

1. Read `C:\Users\snahrup\CascadeProjects\fabric_toolbox\knowledge\README.md`
2. Read `C:\Users\snahrup\CascadeProjects\fabric_toolbox\knowledge\ipcorp-knowledge.md`
3. Read `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\.interface-design\system.md`
4. Read `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\docs\superpowers\plans\2026-04-09-dashboard-single-app-modernization-program.md`
5. Use `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\knowledge` only as secondary FMD application context

Execution rules:

- Preserve the current FMD aesthetic: existing fonts, warm neutral and copper palette, and current motion language.
- Do not treat this as a rebrand.
- Assume the end user has zero context.
- Make the UI explain what it is, why it matters, and what happens next.
- If anything runs in the background, make the UI narrate it in plain language.
- Make the product feel custom-built for IP Corporation's real environment:
  - multi-company manufacturing
  - M3 as system of record
  - MES, ANV, and OATES traceability
  - Batch ID as the cross-system key
  - Fabric medallion migration
  - Purview governance and lineage
  - company-isolation constraints
- Use official Microsoft Fabric, Power BI, Purview, and other primary docs when external verification is needed.
- Prefer fewer, clearer destinations over unnecessary page sprawl.
- Never remove functionality without explicitly re-homing it.
- If the page boundary is structurally wrong, a full rewrite is allowed. Preserve the capability, not the current layout.
- Gold Studio is the reference implementation pattern for clarity, narrative structure, and trustworthy async UX.

Expected output:

- explain the right product direction for the target
- identify whether the target should be preserved, merged, or rewritten
- then implement the change if the user is asking for actual work rather than planning only

