---
description: "Run modernize with IP Corp context, the FMD design system, and the app-wide modernization program."
allowed-tools: Read, Glob, Grep, Bash, WebFetch, WebSearch, Edit, MultiEdit, Write
argument-hint: [target page, flow, or destination]
---

Use both of these skills:

- `C:\Users\snahrup\.claude\skills\modernize\SKILL.md`
- `C:\Users\snahrup\.claude\skills\interface-design\SKILL.md`

Target:
`$ARGUMENTS`

Before editing:

1. Read `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\.interface-design\system.md`
2. Read `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\docs\superpowers\plans\2026-04-09-dashboard-single-app-modernization-program.md`
3. Read `C:\Users\snahrup\CascadeProjects\fabric_toolbox\knowledge\README.md`
4. Read `C:\Users\snahrup\CascadeProjects\fabric_toolbox\knowledge\ipcorp-knowledge.md`
5. Use `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\knowledge` only as secondary FMD application context

Modernization rules:

- Preserve the current FMD aesthetic: existing fonts, warm neutral and copper palette, and current motion language.
- Use the existing design system instead of inventing a new look.
- Apply the modernization treatment with intent:
  - page entrance
  - tiered KPI strips
  - status rails
  - staggered rows and cards
  - upgraded tab bars
  - guided empty states
  - stronger receipts and async state communication
- Assume the end user has zero context.
- No silent background behavior. Running work must show current state, last update, milestone, next expected change, and preserved work.
- Favor shared primitives over page-local invention.
- If the page is structurally wrong and the user is asking for broad redesign, do not just polish broken structure. Use the consolidation and rewrite rules from the modernization program.
- Preserve functionality. If anything is merged or removed visually, re-home the capability explicitly.
- Gold Studio is the reference implementation pattern.

After changes:

- run the appropriate verification for the target
- summarize what was weak before, what changed, and why it is now clearer and more coherent

