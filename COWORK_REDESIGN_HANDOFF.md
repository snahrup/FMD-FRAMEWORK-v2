# Cowork Redesign — Morning Handoff

> Branch: `cowork-redesign`
> Worktree: `C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK_redesign`
> Dev server: `http://localhost:5298` (on port 5298, separate from the main FMD dashboard on 5173)

## TL;DR

Applied Cowork's **design DNA** (warm cream canvas, single terracotta accent, serif greeting, dot-pattern background, restrained tile grid) to FMD's overview page — **without** cloning Cowork's product features (no chat composer, no model selector, no fake AI artifacts). All existing FMD functionality on `/overview` is preserved unchanged below the new hero.

## What changed

| File | Change |
|------|--------|
| `dashboard/app/index.html` | Added Fraunces font via Google Fonts (alongside existing Manrope) |
| `dashboard/app/src/index.css` | Added `--font-greeting` token + `.cw-*` utility classes (greeting, asterisk, tile, dotgrid) |
| `dashboard/app/src/components/overview/CoworkHero.tsx` | **NEW** — hero strip for `/overview` with greeting + 6 canonical-job tiles |
| `dashboard/app/src/pages/BusinessOverview.tsx` | Replaced top "PRIMARY KPIS / System Overview" hero block with `<CoworkHero />`. The 4-card layer-fill strip is now under its own card with an "Estate Fill" eyebrow. Workbench cards, Data Estate viz, Recent Alerts, Source Health all preserved untouched. |
| `CLAUDE.md` | Added rules 16–18: Design DNA-not-clone, warm cream not pure white, serif font for hero greeting only |
| `context/cowork-design-dna.md` | **NEW** — canonical mapping of what to take from Cowork's design vs what to leave |

## What you can review

1. **Open the dev server**: http://localhost:5298 — should drop you on the Overview page with the new hero
2. **Compare with the previous state**: see screenshots in `dashboard/app/screenshots/`
   - `redesign-01-overview-after.png` — initial render (had a clipping bug)
   - `redesign-02-overview-hero.png` — after the dot-mask `::before` fix (greeting now visible)
   - `redesign-03-overview-fullpage.png` — full overview page top-to-bottom
   - `redesign-04` through `redesign-09` — Load Center, Mission Control, Sources, Profile, Gold Intake, Errors (all unchanged from before — confirmed they still render under the new tokens)

## Design DNA — what was applied

Pulled from Cowork:
- Warm cream canvas (`--bp-canvas: #F4F2ED` was already defined; the previous Gemini-era directive forcing pure white was the bug)
- Single terracotta accent (`--bp-copper: #B45624` — already defined; used on the asterisk `✻` in the hero, and on the existing copper rail elements)
- Serif headline (Fraunces 500) — used **only** on the hero greeting
- Subtle dot-pattern background, faded from upper-right via radial mask on a `::before` pseudo-element
- 6-tile canonical-job grid (Load a source / Watch a run / Manage sources / Profile a table / Promote to Gold / Check alerts)
- Asterisk glyph as a quiet brand accent
- Restrained borders (no shadows, no gradients except the canvas-to-surface gradient on the hero card)

NOT pulled from Cowork (would have been wrong for FMD):
- No "How can I help you today?" chat composer
- No model selector ("Sonnet 4.5", "Opus 4.6")
- No "Let's go" send arrow / send button
- No "+ New task" sidebar button (FMD has no AI tasks)
- No "Suggested connectors" right-rail panel
- No "Working folder / Artifacts" right-rail panels
- No fake AI artifacts in working memory

## Open follow-ups (deliberately deferred)

- **Right rail** (task-scoped Progress / Working entities / Related sources): The architecture is ready — `.cw-rail-right` utility class exists, CSS supports it. But it should only render when a real FMD task is in progress (a load run, profile job, blender session, gold spec edit). Wiring it requires deciding which task signals to surface and where to read them from. Out of scope for this overnight pass — left for review with you.
- **Sidebar slim-down**: The existing sidebar already uses warm canvas + copper accent + restrained design and is close enough to Cowork's restraint. Tightening icon size, padding, and weight would be a polish pass — left for an explicit go-ahead since the sidebar is touched by every page.
- **Apply visual language to other hero pages**: The CoworkHero pattern could be ported to the empty-state of Mission Control (when no run is active), Explore Hub, Gold Intake. Each needs its own copy and tile choices though — left for explicit direction.

## How to verify

```bash
# Dev server (already running, port 5298)
cd C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK_redesign/dashboard/app
# If you need to restart:
# pkill -f "vite" then: FMD_DEV_PORT=5298 npm run dev

# TypeScript build
npx tsc -b   # exits clean (no output) when it passes

# Lint (not run during this session — optional)
npm run lint
```

## Adversarial review — bug-scanner findings

A `bug-scanner` agent reviewed the diff and surfaced 13 issues. Triage:

### Fixed in this branch (in-scope, introduced by these changes)

| # | Sev | Issue | Resolution |
|---|-----|-------|------------|
| 1 | HIGH | `overflow: hidden` on hero `<section>` clipped focus rings on `.cw-tile` links | Added `outline-offset: -3px` on `.cw-tile:focus-visible` so the ring sits inside the clipping context |
| 4 | HIGH | `role="list"` on a `<div>` + `role="listitem"` on `<a>` violates ARIA contract; VoiceOver/iOS ignores list semantics | Replaced with native `<ul>/<li>` wrappers around each `<Link>` |
| 8 | MED | `pipelinesHealthy` defaulted to `true` during the async load window — hero showed "Pipelines healthy" before any data arrived | Added `loading?: boolean` prop to `CoworkHero`; `BusinessOverview` passes `pageLoading && !contractReady`; hero now shows "Bringing you the latest pipeline state" while loading |
| 11 | LOW | `.cw-dotgrid > *` rule globally promoted all direct children — could break stacking contexts on any future page using the class | Scoped to `.cw-dotgrid.cw-hero > *` (added the `cw-hero` class to the hero `<section>`) |
| 12 | LOW | Refresh button had no `disabled` state — multiple rapid clicks fired concurrent fetches | Added `disabled={refreshing}`, `aria-busy`, `cursor: wait`, `opacity: 0.7` |
| 13 | LOW | `new Date().getHours()` ran at render time — greeting could change mid-session if a user crossed an hour boundary | Added a `useHourOfDay()` hook that polls every minute and only triggers a state update when the hour changes |

### Attempted then reverted

| # | Sev | Issue | Outcome |
|---|-----|-------|---------|
| 6 | MED | Fraunces FOUT — no `<link rel="preload">` for the woff2 | Tried adding a preload, but Google Fonts URL hashes are versioned (v37 → v38) and any hardcoded URL eventually 404s. Removed the preload, accepted the brief FOUT on cold loads. The system fallback (Iowan Old Style / Georgia) is also serif and the metric mismatch is mild. |

### Deferred — pre-existing in `BusinessOverview`/codebase, NOT introduced by this branch (CLAUDE.md rule 10: no scope creep)

| # | Sev | Issue | Why deferred |
|---|-----|-------|--------------|
| 2 | HIGH | `fetchAll` not `useCallback`-wrapped; missing dep in interval `useEffect` | Pre-existing pattern in `BusinessOverview`; touching it expands the diff surface and risks unrelated regressions. Worth its own focused PR. |
| 3 | HIGH | `setError(null)` only fires when BOTH parallel API calls fail — single-failure silently shows stale data | Pre-existing error-handling logic. Same reasoning as #2. |
| 5 | MED | `--bp-surface-2` referenced in `Skeleton` shimmer gradient but never defined → flat skeleton band | Pre-existing across 24 files; needs a design-token audit, not an inline patch in this PR. |
| 7 | MED | `<html class="dark">` hardcoded while `.dark` tokens are intentionally identical to `:root` (BP is light-only) — latent trap for any future shadcn `dark:` variants | Touching the `<html>` class affects every page; needs a deliberate decision about whether BP-light-only is permanent, then a coordinated change. |
| 9 | MED | `mask-image` on `.cw-dotgrid::before` lacks the `-webkit-radial-gradient` value-side prefix → unfaded dots on iOS Safari < 15.4 | Cosmetic-only on a shrinking device population; the dots still render, just without the corner fade. Not blocking. |
| 10 | MED | `color-mix(in srgb, ...)` in `OverviewMetricCard` background lacks fallback → no gradient on iOS Safari < 16.2 / Chrome < 111 | Pre-existing component (not new in this branch); same triage as #5. |

## How to merge

```bash
cd C:/Users/snahrup/CascadeProjects/FMD_FRAMEWORK
git checkout main
git merge cowork-redesign --no-ff -m "Merge cowork-redesign: design DNA refresh on overview"
# Or open a PR:
git push origin cowork-redesign
gh pr create --base main --head cowork-redesign --title "Cowork design DNA on overview" --body "See COWORK_REDESIGN_HANDOFF.md in the branch root"
```
