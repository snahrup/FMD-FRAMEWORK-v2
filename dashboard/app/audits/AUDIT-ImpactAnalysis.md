# AUDIT-IA: Impact Analysis Page

**Audited:** 2026-03-23
**File:** `dashboard/app/src/pages/ImpactAnalysis.tsx`
**Lines (before/after):** 434 / ~480

---

## Summary

The Impact Analysis page was already data-correct (confirmed by prior audit on 2026-03-13). All KPIs, impact chains, source breakdowns, and risk lists derive honestly from the entity digest. This audit focused on operational quality: missing states, accessibility, dead patterns, and UX gaps.

---

## Findings & Fixes

### F1: Missing loading state (FIXED)
**Severity:** HIGH
When `loading` is true the page rendered nothing at all -- blank white screen. Added a centered `Loader2` spinner with "Loading entity digest..." text.

### F2: Error state ignored (FIXED)
**Severity:** HIGH
The hook returns `error` but it was destructured as just `{ allEntities, loading }` -- the error string was discarded. If the digest API fails the user sees an empty page with zero feedback. Now destructures `error` and renders a fault-colored error message.

### F3: No empty state (FIXED)
**Severity:** MEDIUM
When `allEntities.length === 0` after a successful load (e.g., fresh deployment with no registered entities), the page showed KPIs all at 0 and an empty overview. Added an explicit empty state with guidance to register entities.

### F4: Accessibility -- search dropdown not keyboard-navigable (FIXED)
**Severity:** MEDIUM
The suggestion dropdown was mouse-only. Added:
- `role="combobox"` on the input with `aria-autocomplete`, `aria-expanded`, `aria-controls`, `aria-activedescendant`
- `role="listbox"` and `role="option"` on the dropdown and its items
- Arrow Up/Down keyboard navigation with visual highlight tracking
- Enter to select, Escape to dismiss
- `aria-selected` on the highlighted option

### F5: Accessibility -- missing aria-labels (FIXED)
**Severity:** LOW
- Search input: added `aria-label="Search entities"`
- Clear selection button: added `aria-label="Clear selection"`
- Export button: added `aria-label="Export impact report as markdown"`
- At-risk entity buttons: added `aria-label="Analyze {schema}.{table}"`
- Impact chain: added `role="list"` / `role="listitem"` with `aria-label`
- Impact summary box: added `role="alert"`
- Decorative icons: added `aria-hidden="true"` on Search, ArrowRight, Download, AlertTriangle icons
- Table: added `aria-label="Source impact overview"` and `scope="col"` on `<th>` elements
- Blast radius bars: added `role="progressbar"` with `aria-valuenow/min/max`

### F6: Broken Tailwind opacity on Sparkles icon (FIXED)
**Severity:** LOW
`text-[var(--bp-ink-muted)]/40` is not valid Tailwind -- the `/40` opacity modifier doesn't work with arbitrary value color classes. Changed to inline `style={{ color: 'var(--bp-ink-muted)', opacity: 0.4 }}` (both instances at line ~290 and ~421).

### F7: Suggestion hover used imperative DOM mutation (FIXED)
**Severity:** LOW
`onMouseEnter`/`onMouseLeave` directly mutated `style.background` on the DOM element. Replaced with React state (`highlightedIndex`) that controls the background via the style prop, keeping the component fully declarative and aligned with the keyboard navigation state.

### F8: Redundant `!loading` guard on overview section (FIXED)
**Severity:** LOW
Line 302 had `{!impactResult && !loading && sourceBreakdown.length > 0 && (` -- the `!loading` check was redundant because we now return early on loading. Removed for clarity.

---

## Not Fixed (Out of Scope)

### N1: LAYER_MAP colors are hardcoded hex in `layers.ts`
The impact chain uses `layerDef?.color` which comes from `LAYER_MAP` in `lib/layers.ts`. Those are hex strings (`#64748b`, `#3b82f6`, etc.), not design tokens. However, `layers.ts` is a shared module used across many pages -- changing it is outside this audit's scope.

### N2: `getSourceColor()` returns hardcoded hex from `layers.ts`
Same as N1 -- the `SOURCE_COLORS` map is in the shared module. Page-contained fix not possible.

### N3: No cross-page link to ImpactPulse
ImpactPulse exists as a sibling page but there is no navigation between the two. Adding a link would be reasonable but was not flagged as a requirement. Noted for future UX improvement.

---

## Data Integrity (Carried Forward from Prior Audit)

All metrics confirmed correct:
- **KPIs**: Derived from `entity_status` via digest, not `IsActive` flags
- **Impact chain**: Deterministic 1:1:1 LZ-Bronze-Silver trace, Gold correctly shown as inactive
- **Source breakdown**: Honest counts from digest, blast radius is proportional (not fabricated)
- **At-risk list**: Filters on real errors and partial chains
- **No Math.ceil/random tricks, no hardcoded counts, no fabricated data**

---

## Verdict

**PASS** -- 8 findings, 8 fixed in-page. Data was already correct; this audit improved loading/error/empty states, accessibility, and keyboard navigation.
