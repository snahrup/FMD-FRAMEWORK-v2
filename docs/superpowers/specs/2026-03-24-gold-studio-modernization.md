# Gold Studio UI/UX Modernization Spec

**Date:** 2026-03-24
**Scope:** All 6 Gold Studio pages — GoldLedger, GoldClusters, GoldCanonical, GoldSpecs, GoldValidation, GoldMlvManager
**Reference Standard:** LoadMissionControl commit `074b116` (tiered KPIs, motion, premium UX)

## Problem

Gold Studio pages are functionally complete but visually flat. They lack the premium motion, tiered information hierarchy, and polished micro-interactions that LoadMissionControl established as the dashboard standard. The gap is most visible in: uniform KPI strips, absent entrance animations, bare table rows without status rails, static tab switchers, and basic modal overlays.

## Design Direction

Elevate all Gold Studio pages to match LoadMissionControl's premium UX standard while respecting the existing BP token system and interface-design `system.md`. No new design language — apply the established patterns consistently.

## Modernization Layers

### Layer 1: Shared Animation Infrastructure

Add reusable CSS keyframes and utility classes to the Gold Studio shared component layer (either `GoldStudioLayout` or a new `gold-animations.css`).

**Easing:** `ease-claude = var(--ease-claude) = cubic-bezier(0.25, 0.1, 0.25, 1)` (already defined in index.css)

**Keyframes:**
- `gsSlideInUp` — translateY(8px) → 0, opacity 0→1, 300ms ease-claude
- `gsSlideInDown` — translateY(-6px) → 0, opacity 0→1, 250ms ease-claude
- `gsFadeIn` — opacity 0→1, 200ms ease-claude
- `gsScaleIn` — scale(0.97) → 1, opacity 0→1, 250ms ease-claude (for modals)
- `gsFloat` — translateY(0→-4px→0), 3s ease infinite (for empty state icons)

**Utility classes:**
- `.gs-stagger-row` — gsFadeIn with `animation-delay: calc(var(--i) * 20ms)`
- `.gs-stagger-card` — gsSlideInUp with `animation-delay: calc(var(--i) * 40ms)`
- `.gs-page-enter` — gsSlideInUp 400ms on the page wrapper
- `.gs-tab-indicator` — CSS transition on width/left for animated tab underline

### Layer 2: Tiered KPI Strip

Replace flat `StatsStrip` usage with a two-tier layout on pages that have enough metrics:

**Tier 1 (Hero row):** 2-3 dominant metrics at 36px Instrument Serif (matches system.md hero range of 36-48px), with status-colored accent. Stagger entrance via gsSlideInDown with 80ms delays.

**Tier 2 (Supporting row):** Remaining metrics in a compact horizontal strip at 14px body font. Stagger via gsFadeIn with 40ms delays.

**Per-page hero metrics:**
- GoldLedger: Specimens, Tables Extracted, Columns Cataloged (hero) + rest supporting
- GoldClusters: Unresolved (hero, fault-red if >0), Total Clusters, Avg Confidence (hero) + rest supporting
- GoldCanonical: Canonical Approved (hero), Total Entities, Domains (hero) + rest supporting
- GoldSpecs: Ready to Deploy (hero, operational-green), Total Specs, Pending (hero) + rest supporting
- GoldValidation: Validated (hero), Pending (hero, caution if >0), Certified (hero) + rest supporting
- GoldMlvManager: Already has hero number — enhance with tiered supporting row

### Layer 3: Table Row Enhancements

Apply to ALL Gold Studio tables:

1. **Status rail** — 3px left-edge color bar on every table row. Color maps to row status/type using existing semantic tokens.
2. **Stagger animation** — Each row gets `--i` CSS variable set via `style` prop, gsFadeIn with 20ms per-row delay. Cap at 15 rows — remaining rows render at full opacity immediately to avoid multi-second animation on large datasets.
3. **Alternating backgrounds** — Odd rows get `background: var(--bp-surface-inset)`.
4. **Hover elevation** — On hover: `translateY(-1px)`, border-color shift to `var(--bp-border-strong)`, transition 150ms.

**Tables affected:**
- GoldValidation: validation specs table, catalog table, report coverage table
- GoldClusters: unclustered entities table
- GoldCanonical: DomainGrid entity tables
- GoldSpecs: spec row list (already has rail — add stagger + alternating)
- GoldMlvManager: MLV table (already has STATUS_RAIL_COLORS defined — wire them in)

### Layer 4: Tab Bar Upgrade

All Gold Studio tab switchers get the LMC treatment:

- Font size: 14px (up from 13px)
- Active tab: `fontWeight: 700`, color `var(--bp-copper)`
- Underline indicator: 2.5px height, animated via CSS transition on `left` and `width` (using a ref to measure active tab position)
- Inactive tabs: `fontWeight: 500`, color `var(--bp-ink-muted)`, hover → `var(--bp-ink-secondary)`

**Pages with tabs:** GoldClusters (clusters/unclustered), GoldValidation (validation/catalog/recreation), GoldCanonical (grid/map view switcher), GoldSpecs (detail slide-over tabs)

### Layer 5: Modal & Dialog Premium Treatment

All modals/dialogs across Gold Studio:

- **Backdrop:** `backdrop-filter: blur(4px)` + `rgba(0,0,0,0.3)`
- **Panel entrance:** gsScaleIn animation (scale 0.97→1, opacity 0→1, 250ms)
- **Panel border:** `border: 1px solid var(--bp-border-strong)` (borders-only depth per system.md — no box-shadow)

**Affected components:**
- GoldClusters: dismiss notes modal
- GoldValidation: Modal component (waiver, publish), report add modal
- GoldLedger: ModalShell (upload, paste SQL, bulk import, supporting evidence, contextual note)

### Layer 6: Page-Specific Polish

**GoldLedger:**
- Add gs-stagger-card on SpecimenCards (40ms delay per card)
- Add gs-page-enter on the page wrapper
- Sticky filter bar with `border-bottom: 1px solid var(--bp-border)` when scrolled (borders-only per system.md)

**GoldClusters:**
- Add gs-stagger-card on ClusterCards
- Replace inline `<p>` maturity notice with a proper info banner: icon + styled container with `var(--bp-info-light)` background
- Confidence range: keep existing dual number inputs as-is (functional change out of scope)

**GoldCanonical:**
- Add row stagger to DomainGrid tables
- ReactFlow nodes: apply BP token backgrounds, copper border on Fact nodes, proper font tokens
- Add gs-page-enter animation
- View switch (grid/map): crossfade transition

**GoldSpecs:**
- Add row stagger to spec list
- ColumnsTab: add alternating row backgrounds
- SQL tab: add line highlight on hover (subtle `var(--bp-surface-inset)` background)

**GoldValidation:**
- Add row stagger to all three tab tables
- Coverage progress bar: add entrance animation (width transition from 0)

**GoldMlvManager:**
- Wire STATUS_RAIL_COLORS into actual table rows (defined but not rendered)
- Add entrance animation on expanded detail row (gsSlideInDown)
- DomainCards: add hover elevation shift
- Empty state: add gsFloat on the icon

## Implementation Strategy

**Approach:** Shared-first. Build animation infrastructure once, then apply per-page in a single pass per file. Each page gets a focused commit.

**File changes:**
1. Shared animation CSS/component (new or extend GoldStudioLayout) — ~50 lines
2. GoldLedger.tsx — entrance animations, stagger cards, modal backdrop blur
3. GoldClusters.tsx — stagger cards, tab upgrade, info banner, modal treatment
4. GoldCanonical.tsx — row stagger, ReactFlow styling, view transition, page entrance
5. GoldSpecs.tsx — row stagger, alternating rows, SQL line highlight, tab animation
6. GoldValidation.tsx — row stagger, tab upgrade, modal treatment
7. GoldMlvManager.tsx — wire status rails, detail entrance, hover elevation, empty state float

**Not in scope:**
- No functional changes — all modifications are visual/motion only
- No new API calls or data fetching changes
- No component API changes to shared Gold components (StatsStrip, SlideOver, etc.) — tiered KPIs are built inline per page
- No new dependencies

## Success Criteria

1. All 6 Gold Studio pages have staggered entrance animations on lists/tables/cards
2. KPI strips show tiered hierarchy (hero + supporting) where applicable
3. All table rows have 3px status rails + alternating backgrounds
4. Tab switchers have animated underline + bold active state
5. All modals use backdrop blur + scale entrance + border emphasis (no shadows per system.md)
6. Visual consistency with LoadMissionControl's premium standard
