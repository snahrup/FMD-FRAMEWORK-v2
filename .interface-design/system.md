# FMD Dashboard — Interface Design System

## Direction & Feel
**Manufacturing control room meets editorial authority.** Warm paper surfaces, industrial copper accent, zero shadows (borders only). The dashboard monitors enterprise data pipelines across 1,666 entities — density over whitespace, precision over decoration.

## Signature Element
**Status Rail** — 3px left-edge color bar on every card, table row, and panel. Colors map to semantic status: green (operational/success), amber (caution/warning), red (fault/failure), copper (accent/active), gold/silver/bronze (tier/layer), gray (muted/inactive). Defined in CSS as `.bp-rail` with variants.

## Depth Strategy
**Borders only** — zero shadows throughout. Surface elevation via background color shifts:
- Canvas: `--bp-canvas` (#F4F2ED)
- Surface 1: `--bp-surface-1` (#FEFDFB)
- Inset: `--bp-surface-inset` (#F9F7F3)
- Code block: `--bp-code-block` (#2B2A27) for dark panels

## Spacing
4px base (`--bp-space-1` through `--bp-space-8`). Cards use 16-20px padding. Tables use 12px cell padding. KPI strips use 20-24px padding.

## Typography
- Display: Manrope 600-700 (headings, hero numbers, page titles)
- Body: Manrope 400-500 (all UI text, labels, descriptions)
- Data: Manrope tabular-nums (entity names, counts, timestamps)
- Hero numbers: 36-48px Manrope 700, accent-colored
- Section labels: 10-11px Manrope 600 uppercase, tracking-wider, muted

## Color Palette (BP Tokens)
- Accent: `--bp-copper` (#B45624) — primary interactive, CTAs
- Surfaces: warm paper tones (cream, parchment)
- Status: `--bp-operational` green, `--bp-caution` amber, `--bp-fault` red
- Layers: `--bp-gold`, `--bp-silver`, `--bp-bronze` with metallic gradients
- Ink: 4-level hierarchy (primary, secondary, tertiary, muted)

## Key Component Patterns

### KPI Strips
Page-specific, not generic. Each metric gets a status rail. Hero numbers use display font at 36-48px. Secondary metrics are smaller inline stats or ring gauges. Stagger animation on load (80ms delays).

### Status Badges
Use `bp-badge` CSS classes exclusively — never Tailwind color classes or hardcoded hex for status colors.
- Base: `.bp-badge` (11px, font-weight 600, 4px radius, inline-flex)
- Small: `.bp-badge-sm` (10px, tighter padding — for table cells)
- Variants: `.bp-badge-operational` (green), `.bp-badge-critical` (red), `.bp-badge-warning` (amber), `.bp-badge-active` (blue), `.bp-badge-info` (neutral)
- All colors flow from `--bp-operational`, `--bp-fault`, `--bp-caution`, `--bp-info` CSS vars
- Component: `<StatusBadge status="..." />` wraps this system with auto-resolution
- EntityTable uses `layerStatusCls()` helper → same `bp-badge-*` classes

### Data Tables
- Status rail on every row (3px, left edge, semantic color)
- Alternating row backgrounds (odd = surface-inset)
- Stagger animation on rows (20ms delays)
- Sortable column headers with directional arrows
- Expanded detail rows use recessed background
- **Zero hardcoded hex** — all colors via `--bp-*` CSS vars

### Card Lists (Rules, Domain Cards)
- Status rail on left edge
- Stagger animation (30-40ms delays)
- Inactive items get diagonal strikethrough overlay
- Priority shown as numbered circle badges (copper bg, white text)

### Code Blocks (SQL, JSON)
- Dark background: `--bp-code-block` (#2B2A27)
- Light text: #E0DDD6
- Line numbers in muted gutter column
- Monospace throughout

### Empty States
- Centered, icon + heading + description
- Dashed border variant for "add first item" prompts
- Subtle shimmer animation on icons

### Entry Animations
- Page wrapper: fadeIn 300-400ms with ease-claude
- Cards/rows: staggered fadeIn with per-item delay
- Panels/forms: slideInRight for lateral reveals
- All use `--ease-claude` (cubic-bezier(0.25, 0.1, 0.25, 1))

## Page-Specific Accents
- DQ Scorecard: Metallurgical assay feel, tier gradients, score rings
- Gold MLV Manager: Gold accent (#8B6914), catalog/library feel
- Cleansing Rules: Workbench feel, tool-like rule cards, dark JSON preview
- SCD Audit: Silver accent (#475569), audit ledger feel, timeline connectors

## Cross-App Product Rules
The dashboard is one operating workbench, not a set of disconnected tools. All pages should reinforce this lifecycle:

1. Orient
2. Launch
3. Observe
4. Diagnose
5. Shape
6. Publish
7. Serve
8. Administer

Assume zero user context by default. The interface must teach the workflow, narrate the current state, and explain the consequence of actions without relying on insider terminology.

Every major page should include:
- a plain-language intent header explaining what the page is, why it matters, and what happens next
- an action rail with one clear primary action and scoped secondary actions
- a recent-activity or latest-change strip
- a tiered KPI strip when metrics matter
- clear receipts for running, completed, failed, partial, and preserved-work states

If two pages serve the same user job with only minor differences, merge them into one destination with tabs or detail panels instead of keeping extra top-level pages.
Do not remove functionality during consolidation. Re-home the job, preserve the action scope, and keep legacy routes redirecting into the new destination when practical.

## Shared Async Contract
If a page launches or observes background work, it must show:
- current state
- last update time
- latest milestone
- next expected change
- whether user action is required
- what work is preserved if the process stops or fails

Silent waiting is not allowed.

## Modernization Base Layers
Apply the modernization treatment consistently across page families:
- `gs-page-enter` on page wrappers
- tiered KPI strips instead of flat metric rows
- `gs-stagger-row` and status rails on data tables
- `gs-stagger-card` on card grids and lists
- upgraded tab bars with stronger active-state emphasis
- `gs-modal-backdrop` and `gs-modal-enter` on modal flows
- guided empty states with a next step

The motion layer should support clarity, not decoration. Use stagger to reveal hierarchy and progress, not to show off.
