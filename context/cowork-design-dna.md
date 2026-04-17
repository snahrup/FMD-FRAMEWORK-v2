# Cowork Design DNA — Visual Language for FMD

> **What**: Design language extracted from Anthropic's Cowork product, applied to FMD's visual surface — colors, typography, spacing, restraint patterns. NOT feature parity.
> **When to read**: Before any UI work on hero pages, shell/layout, or visual polish.

## The crux: DNA, not clone

Cowork is an AI agent product (chat composer, model selector, "How can I help you today?", task workspaces, AI artifacts). FMD is a data pipeline dashboard. The mistake to never repeat is treating Cowork as a feature blueprint instead of a visual reference. **Take the design language. Leave the product features.**

### Take from Cowork
- Warm cream canvas (`--bp-canvas: #F4F2ED`) instead of pure white
- Single accent color (`--bp-copper: #B45624`) used sparingly — usually just on the asterisk + a primary CTA
- Serif headline (`--font-greeting: 'Fraunces'`) used **only** on the hero greeting, never elsewhere
- Subtle dot-pattern background that fades from the upper-right corner (see `.cw-dotgrid` + `.cw-dotgrid-fade` in `index.css`)
- Soft, restrained card borders (`--bp-border` = `rgba(0,0,0,0.08)`) — no shadows
- 3-pane shape: slim left rail (~240px), generous center, optional task-scoped right rail
- Generous internal padding inside narrow rails
- Tile grid for canonical jobs (4–6 tiles, each linking to a real product surface)
- Asterisk glyph (`✻`) as a quiet accent mark near the greeting

### Leave from Cowork
- Chat composer ("How can I help you today?")
- Model selector ("Sonnet 4.5", "Opus 4.6", etc.)
- "Let's go" button / send arrow
- "+ New task" button if it implies starting an AI conversation
- "Recents" / "Projects" / "Scheduled" / "Customize" / "Dispatch" sidebar items (these are Cowork-specific concepts)
- "Suggested connectors" right-rail panel (FMD doesn't have third-party connectors)
- "Working folder / Artifacts" right-rail panels (FMD doesn't produce AI-generated artifacts)
- Animal-name session identity, AI inbox, etc.
- Any tile labeled "Crunch data", "Make a prototype", "Draft a message", "Create a file" — these are AI agent capabilities, not FMD jobs

## How to map Cowork's empty-state to FMD

| Cowork element | FMD equivalent |
|---|---|
| Greeting "Let's knock something off your list" | Time-of-day greeting + real FMD state ("Pipelines healthy" / "3 sources need attention") |
| Asterisk + serif | Same — `.cw-asterisk` + `.cw-greeting` |
| Dot-pattern bg | Same — `.cw-dotgrid cw-dotgrid-fade` on hero `<section>` |
| 6-tile capability grid | 6 canonical FMD jobs: Load a source, Watch a run, Manage sources, Profile a table, Promote to Gold, Check alerts |
| "How can I help you today?" composer | **Skip entirely.** No composer. |
| Right-rail Progress / Artifacts / Context / Suggested connectors | Right rail only renders when a real FMD task is in progress (load run, profile job, blender session) — and only contains panels backed by real FMD data |

## CSS utilities (added in `dashboard/app/src/index.css`)

- `.cw-greeting` — Fraunces serif, large, bold, used for hero headline only
- `.cw-asterisk` — terracotta accent glyph
- `.cw-composer` — large rounded input container (currently unused in FMD; available if a real text input is ever needed at hero scale)
- `.cw-tile` — soft rounded card with hover lift, used for canonical-job tiles
- `.cw-dotgrid` + `.cw-dotgrid-fade` — dot-pattern background via `::before` pseudo (mask only affects the pattern, not the foreground content)
- `.cw-rail-left`, `.cw-rail-right` — fixed-position rails with warm canvas + subtle border (currently unused; AppLayout still uses its own sidebar)
- `.cw-new-task`, `.cw-rail-link`, `.cw-section-h` — rail-related typography and interactive elements

All of these are visually neutral building blocks. Use them or don't. Just never use them to build a chat composer.

## Implementation checkpoints

- 2026-04-17: `CoworkHero.tsx` shipped on `/overview`, replacing the busy "PRIMARY KPIS" hero block. Existing 4-card metrics, Workbench cards, Data Estate viz, Recent Alerts, and Source Health all preserved untouched.

## Learnings

- [2026-04-17] Use `::before` pseudo-elements for textured backgrounds when you need a CSS mask — applying `mask-image` to an element with foreground content clips the content too. The fix is to put the texture on a positioned `::before` (`position: absolute; inset: 0; z-index: 0`) and lift direct children to `z-index: 1`.
- [2026-04-17] Fraunces (Google Fonts) at weight 500 is the closest free match to Cowork's serif headline. Loaded via the existing Google Fonts `<link>` in `index.html` alongside Manrope.
- [2026-04-17] When the user shares a reference UI (Cowork, Linear, Notion), they want the **design language** not the **features**. Stripping product-specific features out is harder than copying them — be deliberate about it.
