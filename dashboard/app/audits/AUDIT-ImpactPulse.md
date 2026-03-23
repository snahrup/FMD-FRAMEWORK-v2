# AUDIT-IP: ImpactPulse.tsx

**Audited:** 2026-03-23
**Page:** `dashboard/app/src/pages/ImpactPulse.tsx` (~851 lines)
**Components:** `dashboard/app/src/components/impact-pulse/LayerNode.tsx`, `AnimatedEdge.tsx` (read-only)
**Backend:** `dashboard/app/api/routes/monitoring.py` (read-only), entity-digest via `useEntityDigest` hook
**Prior audit:** 2026-03-13 (data flow trace, metric accuracy). This audit covers checklist items not previously addressed.

---

## Summary

ImpactPulse is a React Flow canvas showing medallion-layer architecture with animated edges and a slide-out drawer. Data integrity is solid (confirmed by prior audit) -- this pass focused on hardcoded colors, accessibility, and code hygiene.

**8 findings total: 6 FIXED, 2 DEFERRED.**

No truth bugs, no fabricated data, no dead code, no Math.ceil/random tricks. The page does NOT hit `/api/executive` (confirmed via grep), so it does not trigger the health_trend_snapshot insertion noted in AUDIT-LM.

---

## Findings

### IP-01: Hardcoded hex colors in page-level styles | FIXED
**Severity:** LOW
**Description:** Multiple hardcoded hex values used where `var(--bp-*)` design tokens exist:
- `#F4F2ED` (page background) -> `var(--bp-canvas)`
- `#B45624` (Radar icon) -> `var(--bp-copper)`
- `#FEFDFB` (MiniMap background, React Flow controls) -> `var(--bp-surface-1)`
- `#1C1917` (controls fill) -> `var(--bp-ink-primary)`
- `#F9F7F3` (controls hover) -> `var(--bp-surface-inset)`
- `rgba(0,0,0,0.08)` (borders) -> `var(--bp-border)`
- `rgba(254, 253, 251, 0.95)` (sticky header) -> `color-mix(in srgb, var(--bp-surface-1) 95%, transparent)`

**Fix:** Replaced all with corresponding design tokens.

### IP-02: Hardcoded hex colors in node/edge data objects | DEFERRED
**Severity:** LOW
**Description:** Node `data.color` values (lines 524, 540, 556, 572) and edge `data.color` values (lines 615, 629, 640) use hardcoded hex like `#B45624`, `#C27A1A`, `#78716C`, `#3D7C4F`. These are passed to `LayerNode.tsx` and `AnimatedEdge.tsx` which perform string concatenation on them (e.g., `${d.color}66` for alpha channels, `${d.color}40` for box-shadow). CSS `var()` tokens cannot be concatenated this way.
**Deferred reason:** Fixing requires editing LayerNode.tsx and AnimatedEdge.tsx (out of scope). The components would need to resolve CSS custom properties via `getComputedStyle()` or accept separate opacity props.

### IP-03: Hardcoded hex in drawer layerMap | DEFERRED
**Severity:** LOW
**Description:** The `drawerProps` resolution (lines 674-679) duplicates the same hex values (`#B45624`, `#C27A1A`, `#78716C`, `#3D7C4F`) used for node colors. The `nodeColor` prop is used as `backgroundColor` in the drawer's progress bar, which could accept `var()` tokens. However, these values must visually match the node colors (IP-02), so changing them independently would create a mismatch.
**Deferred reason:** Should be fixed together with IP-02 when LayerNode.tsx/AnimatedEdge.tsx are in scope.

### IP-04: Missing aria-label on close button | FIXED
**Severity:** LOW
**Description:** Drawer close button (line 298) had no `aria-label`. Screen readers would announce it as an unlabeled button.
**Fix:** Added `aria-label="Close drawer"`.

### IP-05: Missing role/aria attributes on drawer panel | FIXED
**Severity:** LOW
**Description:** The slide-out drawer panel had no `role="dialog"`, `aria-modal`, or `aria-label`. Screen readers could not identify it as a dialog overlay.
**Fix:** Added `role="dialog"`, `aria-modal="true"`, and dynamic `aria-label` based on the selected node label.

### IP-06: Missing aria-label on refresh button | FIXED
**Severity:** LOW
**Description:** The header refresh button (line 768) had no `aria-label`.
**Fix:** Added `aria-label="Refresh entity data"`.

### IP-07: Missing aria-label on retry button | FIXED
**Severity:** LOW
**Description:** The error-state retry button (line 706) had no `aria-label`.
**Fix:** Added `aria-label="Retry loading data"`.

### IP-08: MiniMap nodeColor fallback uses raw hex | NOT FIXING
**Severity:** TRIVIAL
**Description:** `nodeColor` callback (line 800) uses `"#A8A29E"` as a fallback when node data has no color. There is no exact `--bp-*` token for this stone-gray value, and this is a programmatic fallback in a JSX callback, not a style declaration.
**Status:** Acknowledged, not worth a fix.

---

## Checklist Results

| Check | Result |
|-------|--------|
| Truth bugs / fabricated data | PASS -- all data from entity-digest + live-monitor |
| Dead code | PASS -- no unused imports, no unreachable branches |
| Error handling | PASS -- error state with retry, live-monitor failures silently caught |
| Hardcoded hex colors | 6 FIXED (IP-01), 2 sets DEFERRED (IP-02, IP-03) |
| Accessibility | 4 FIXED (IP-04 through IP-07) |
| Loading states | PASS -- loading spinner shown on initial load |
| Empty states | PASS -- explicit empty state when no data |
| API response shape | PASS -- matches backend (confirmed by prior audit) |
| Impact accuracy | PASS -- all metrics derived from entity_status, not fabricated |
| Executive endpoint side-effect | PASS -- ImpactPulse does NOT call `/api/executive` |

---

## Deferred Items Summary

| ID | What | Why Deferred | Needs |
|----|------|-------------|-------|
| IP-02 | Node/edge data.color hex values | Components do string concat on color values | LayerNode.tsx + AnimatedEdge.tsx refactor |
| IP-03 | Drawer layerMap hex values | Must match node colors (IP-02) | Same as IP-02 |

---

## Files Modified

- `dashboard/app/src/pages/ImpactPulse.tsx` -- 6 fixes applied
