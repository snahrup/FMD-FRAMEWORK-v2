# 2026-04-09 Codex Dashboard Handoff

## Purpose
This document is the copy-paste bootstrap for new Codex threads working on dashboard UX, information architecture, consolidation, and modernization.

## Primary Objective
Turn the dashboard into a single coherent app that feels custom-built for IP Corporation, while preserving the current visual language that already works.

This is not a rebrand.

## Read Order
1. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\CODEX.md`
2. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\docs\superpowers\plans\2026-04-09-dashboard-single-app-modernization-program.md`
3. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\.interface-design\system.md`
4. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\docs\superpowers\specs\2026-04-09-gold-studio-redesign-brief.md`
5. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\docs\superpowers\plans\2026-04-09-gold-studio-redesign-implementation-plan.md`
6. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\docs\superpowers\specs\2026-04-09-gold-studio-coverage-map.md`

## Context Order
Use context in this order:

1. `C:\Users\snahrup\CascadeProjects\fabric_toolbox\knowledge`
2. `C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\knowledge`
3. Current code in this repo
4. Official external docs

## Required Skill Inputs
Treat these as mandatory design instructions:

- `C:\Users\snahrup\.claude\skills\interface-design\SKILL.md`
- `C:\Users\snahrup\.claude\skills\modernize\SKILL.md`

## Design Constraints
- Preserve current typography, color palette, and motion language.
- Assume zero user context.
- No silent background work.
- Every page must explain what it is, why it matters, and what happens next.
- Consolidate pages where the split is artificial.
- Never remove functionality without explicitly re-homing it.
- Full rewrites are allowed if the current structure is the real problem.
- Gold Studio is the reference implementation pattern.

## Domain Constraints
The app should feel authored for IP Corp's real environment:

- multi-company manufacturing
- M3 system of record
- MES, ANV, OATES traceability
- Batch ID as universal key
- Fabric medallion migration
- Purview governance and lineage
- company-isolation constraints
- Salesforce as a source family

## Execution Expectation
If the task is implementation:

1. audit the target destination against the modernization program
2. decide whether to preserve, merge, or rewrite
3. implement with shared primitives and preserved capability
4. verify
5. commit only the relevant files

## Branch
Default branch for this modernization stream:

- `feat/mobile-phase0-foundation`

