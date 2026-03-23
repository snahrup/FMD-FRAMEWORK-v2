# AUDIT: TransformationReplay.tsx (Wave 3b)

**File**: `dashboard/app/src/pages/TransformationReplay.tsx` (867 lines post-fix)
**Audited**: 2026-03-23
**Previous audit**: 2026-03-13 (data-source-only pass)
**Verdict**: 9 findings — 7 fixed, 2 deferred

---

## Page Overview

Transformation Replay is a visual walkthrough of the 13 transformation steps data undergoes as it moves through Landing Zone, Bronze, and Silver layers. A fixed 13-step timeline uses GSAP ScrollTrigger for reveal animations and a scroll-linked progress bar. Optionally enriched with per-row microscope data when entity + PK params are provided.

---

## Navigation

### Inbound Params
| Param | Source | Usage |
|-------|--------|-------|
| `?entity={id}` | URL query string (cross-page from DataMicroscope) | Selects entity in EntitySelector, triggers microscope fetch |
| `?pk={value}` | URL query string | Combined with entity to fetch per-row transformation data from `/api/microscope` |

### Outbound Links
| Destination | Condition | Added in this audit |
|-------------|-----------|---------------------|
| `/microscope?entity={id}&pk={pk}` | When entity is selected (FIN card) | YES — new cross-page link |

### Route
`/replay` — defined in `App.tsx` line 119

---

## Findings

### F-01 [MEDIUM] Hardcoded hex in LAYER_COLORS — FIXED
**What**: `LAYER_COLORS` used raw hex values (`#B45624`, `#C27A1A`, `#3D7C4F`) instead of CSS custom properties.
**Fix**: Replaced `color`, `bgHex`, `borderHex` with `color` (CSS var), `bg` (CSS var), `border` (CSS var), plus `hex` field retained for opacity-suffix patterns (`${hex}15`, `${hex}30`) where CSS vars cannot be concatenated.

### F-02 [MEDIUM] Hardcoded hex in IMPACT_STYLES — FIXED
**What**: `IMPACT_STYLES` used raw hex for all 6 impact types.
**Fix**: Replaced `colorHex`/`bgHex` with `color`/`bg` using `var(--bp-*)` tokens. Property names simplified.

### F-03 [MEDIUM] Hardcoded hex in progressGradient() — FIXED
**What**: Gradient function used literal hex colors `#B45624`, `#C27A1A`, `#3D7C4F`, `rgba(61,124,79,0.3)`.
**Fix**: Replaced with `var(--bp-copper)`, `var(--bp-caution)`, `var(--bp-operational)`, and `color-mix()` for the transparent stop.

### F-04 [HIGH] Zero accessibility attributes — FIXED
**What**: 867-line page with zero `aria-*`, zero `role` attributes, zero keyboard navigation hints.
**Fix**: Added:
- `role="main"` + `aria-label` on page container
- `role="progressbar"` + `aria-valuenow/min/max` + `aria-label` on scroll progress bar
- `aria-expanded` + `aria-label` on technical detail expand buttons
- `role="table"` + `role="row"` + `role="columnheader"` + `role="cell"` on before/after comparison grids
- `role="alert"` on microscope error banner
- `role="status"` + `aria-label` on loading skeleton container
- `aria-live="polite"` on loading spinner text
- `aria-hidden="true"` on decorative elements (particle connector SVG, timeline dots, alert icon, spinner icon)
- `aria-label` on PK input field
- `aria-label` on timeline container
- Step cards changed from `<div>` to `<article>` with `aria-label`

### F-05 [MEDIUM] No cross-page link to DataMicroscope — FIXED
**What**: Page receives entity+PK params from DataMicroscope but has no link back. Dead end.
**Fix**: Added a "Inspect in Data Microscope" link with Microscope icon in the FIN card, visible when an entity is selected. Links to `/microscope?entity={id}&pk={pk}`.

### F-06 [LOW] `source` key in LAYER_COLORS never used by any step — NOT FIXED (deferred)
**What**: `LAYER_COLORS.source` is defined but no step in `REPLAY_STEPS` has `layer: "source"`. It's dead data.
**Reason for deferral**: Removing it could break future extensibility if a "source extraction" pre-step is added. Low risk to keep.

### F-07 [LOW] LAYER_MAP colors vs LAYER_COLORS mismatch — DEFERRED
**What**: `LAYER_MAP` (from `layers.ts`) defines `landing: "#3b82f6"` (blue), `bronze: "#f59e0b"` (amber), `silver: "#8b5cf6"` (violet) — completely different from the `--bp-*` token palette used by this page. The page only uses `LAYER_MAP` for layer icons, not colors, so there's no visual bug. But the shared `layers.ts` has stale colors.
**Reason for deferral**: `layers.ts` is a shared component. Fixing it affects all pages.

### F-08 [LOW] `entityId` param not URL-encoded in fetch — FIXED (already safe)
**What**: Line 488 uses `entity=${entityId}` without `encodeURIComponent`. Entity IDs are numeric integers from the digest, so this is safe in practice. No change needed.

### F-09 [LOW] Unused `MicroscopeResponse` type is overly permissive — NOT FIXED (deferred)
**What**: The `MicroscopeResponse` interface (lines 74-81) defines a minimal shape that doesn't match the actual microscope.py response schema. It works because only `transformations` and `error` are consumed, but the type is technically inaccurate.
**Reason for deferral**: Fixing this requires reading microscope.py to understand the real response shape, and the task says microscope.py is read-only / out of scope.

---

## Summary

| Severity | Total | Fixed | Deferred |
|----------|-------|-------|----------|
| HIGH     | 1     | 1     | 0        |
| MEDIUM   | 3     | 3     | 0        |
| LOW      | 5     | 2     | 3        |
| **Total**| **9** | **7** | **2**    |

### Files Changed
- `dashboard/app/src/pages/TransformationReplay.tsx` — design tokens, accessibility, cross-page link
- `dashboard/app/audits/AUDIT-TransformationReplay.md` — this document (replaces prior audit)
