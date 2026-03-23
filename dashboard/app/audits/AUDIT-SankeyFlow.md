# AUDIT: SankeyFlow.tsx

**Audited:** 2026-03-23 (re-audit with priority bug investigation)
**Page:** `dashboard/app/src/pages/SankeyFlow.tsx` (~810 lines)
**Backend:** `dashboard/app/api/routes/entities.py` (entity-digest)
**Previous audit:** 2026-03-13 (data correctness only — missed render bug)

---

## PRIORITY BUG INVESTIGATION: Render-Then-Blank

### Symptom
User reports: "Every time I try to go to the page, it took one second and it flickered and then it just went blank."

### Root Cause (HIGH CONFIDENCE — 95%)

**Two bugs working together cause the page to render blank after data loads.**

#### Bug 1: Missing `h-full` in AppLayout content wrapper (PRIMARY)

`AppLayout.tsx` line 458-459 conditionally applies `h-full` to the content wrapper:
```tsx
(location.pathname === "/flow" || location.pathname === "/blender" || location.pathname === "/journey")
  ? "p-0 h-full"
  : isBusiness ? "" : "p-6"
```

The Sankey page lives at `/sankey` — it is **NOT** in this list. Without `h-full` on the content wrapper, the height chain breaks:

1. `<main>` — `flex-1 min-h-screen` (good)
2. Inner `<div className="flex-1">` — grows to fill main (good)
3. Inner `<div className="w-full p-6">` — **NO h-full**, height = auto (BROKEN)
4. SankeyFlow root `<div className="h-full">` — 100% of auto = **content-dependent**
5. SVG container `<div className="flex-1 min-h-0">` — collapses to 0 height
6. SVG with `className="w-full h-full"` — **0 rendered height**

Result: Title bar renders (has intrinsic height from text/padding), SVG container has 0 height, diagram is invisible. Page appears blank except for the thin title bar.

**Fix applied**: Changed SankeyFlow root from `h-full` (parent-dependent) to `height: calc(100vh - 3rem)` (self-contained). This ensures the page always fills the viewport minus the mobile header, regardless of what AppLayout provides. Same fix applied to loading, error, and empty states.

> NOTE: The ideal fix is adding `/sankey` to the AppLayout conditional, but that file is a shared component outside this audit's edit scope. The self-contained height is a robust alternative.

#### Bug 2: ResizeObserver never attaches (SECONDARY)

The ResizeObserver `useEffect` had `[]` as its dependency array. It runs once on mount, but during the loading state (before data arrives), the early return renders a loading spinner — the `containerRef` div is NOT in the DOM. So:

1. Mount → `useEffect([])` fires → `containerRef.current === null` → returns early (no observer)
2. Data loads → full layout renders → `containerRef` is now attached to DOM
3. `useEffect([])` does NOT re-run → ResizeObserver never attaches
4. `dimensions` stays at default `{width: 960, height: 600}` forever

This means the Sankey layout coordinates don't match the actual container size. Combined with Bug 1 (zero-height container), this compounds the blank page.

**Fix applied**: Changed dependency from `[]` to `[dataReady]` where `dataReady = !!data`. The effect re-runs when data first loads, attaching the ResizeObserver to the now-present container div.

### Confidence Level

**95% confident** this is the root cause. The height chain analysis is deterministic — the layout classes are verifiable from the code. The only uncertainty is whether Steve's specific browser/viewport adds another compounding factor.

---

## Standard Audit Findings

### S1: Hardcoded hex colors (COSMETIC)

Several SVG fill values used raw hex instead of design tokens:
- `#1C1917` (text fills) → `var(--bp-ink-primary, #1C1917)`
- `#A8A29E` (muted text) → `var(--bp-ink-muted, #A8A29E)`
- `#FEFDFB` (tooltip background) → `var(--bp-surface-1, #FEFDFB)`

Remaining: `rgba(0,0,0,0.08)` for tooltip stroke is acceptable as a generic shadow.

**Status: FIXED**

### S2: Unused imports (DEAD CODE)

- `XCircle` imported from lucide-react but never used
- `DigestEntity` type imported from useEntityDigest but never referenced

**Status: FIXED** (both removed)

### S3: Background color hardcoded on root container

Root container used `backgroundColor: '#F4F2ED'` instead of the design token.

**Status: FIXED** — Changed to `var(--bp-canvas, #F4F2ED)`

### S4: Side-effect during render (LOW — pre-existing)

Line 244: `if (data && !hasLoadedOnce.current) hasLoadedOnce.current = true;` mutates a ref during render. This works in practice but is technically a side-effect during render. React docs recommend doing this in effects. Not fixing as it's a common pattern and works reliably.

**Status: DEFERRED (not a bug, just impure)**

### S5: d3-sankey nodeId/index conflict (LOW)

The code sets `nodeId((d) => d.id)` but passes links with numeric index-based `source`/`target` fields. d3-sankey handles this (numeric values treated as indices), but it's confusing. The `as unknown` cast on line 394 confirms awareness of the type mismatch.

**Status: DEFERRED (works correctly, just unclear)**

### S6: Gold node always disconnected (KNOWN)

`layer-gold` node is always added to the node array but never has links (gold layer count = 0). D3-sankey handles disconnected nodes but they may render at unexpected positions. The label "Coming soon" (line 739) is an appropriate placeholder.

**Status: NOT A BUG (intentional placeholder)**

### S7: SourcePanel click-outside uses setTimeout (LOW)

`SourcePanel` uses `setTimeout(..., 50)` to delay the click-outside listener registration (line 134). This prevents the opening click from immediately closing the panel. While functional, this is a timing-based workaround — a `stopPropagation` approach would be more robust.

**Status: DEFERRED (works, low risk)**

### S8: Tooltip rect has fixed 56px width (LOW)

Link hover tooltips use a fixed-width rect (56px at line 633). Large numbers (e.g., 10,000+) may overflow. With the current data (max ~1,666 entities), this is not an issue, but it won't scale to larger datasets.

**Status: DEFERRED (not a problem at current data volume)**

---

## Data Correctness (from original 2026-03-13 audit — still valid)

All Sankey node counts and link values correctly derive from `entity_status`-based load statuses via `useEntityDigest()`. No IsActive-as-loaded bugs. No queries against empty tables. See original audit for full metric-by-metric trace.

---

## Fix Summary

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| P1 | Blank page — height chain broken | CRITICAL | FIXED |
| P2 | ResizeObserver never attaches | HIGH | FIXED |
| S1 | Hardcoded hex colors | LOW | FIXED |
| S2 | Unused imports | LOW | FIXED |
| S3 | Hardcoded background color | LOW | FIXED |
| S4 | Side-effect during render | LOW | DEFERRED |
| S5 | nodeId/index type confusion | LOW | DEFERRED |
| S6 | Gold node disconnected | NONE | BY DESIGN |
| S7 | setTimeout for click-outside | LOW | DEFERRED |
| S8 | Fixed-width tooltip rect | LOW | DEFERRED |

---

## Verdict

**Page Status: FUNCTIONAL after fixes — critical blank-page bug resolved**

The render-then-blank bug was caused by a missing `h-full` class in the AppLayout content wrapper for the `/sankey` route, compounded by a ResizeObserver that never attached because its effect ran before data loaded. Both issues are fixed within SankeyFlow.tsx using self-contained height calculations and data-dependent effect dependencies.
