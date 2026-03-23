# Audit: BusinessSources (Portal Sources)

**Date**: 2026-03-23
**Packet**: AUDIT-PS
**Files audited**:
- `dashboard/app/src/pages/business/BusinessSources.tsx`
- `dashboard/app/api/routes/overview.py` (endpoints: `/api/overview/kpis`, `/api/overview/sources`, `/api/overview/entities`)

---

## Verdict: PASS WITH NOTES

The page is well-built with proper BP design system tokens, scalable source rendering (no hardcoded source counts), good error handling, skeleton loading states, and correct API mapping. Two data-truth bugs were fixed in-band; three items deferred.

## Findings

### [F1] LastLoadDate picks first matching layer instead of most recent (severity: HIGH)
**File**: `dashboard/app/api/routes/overview.py:415-418`
**Was**: Single CASE...WHEN chain inside MAX() aggregate evaluated top-to-bottom — if LZ succeeded, its timestamp was returned even if Bronze or Silver had a more recent load. Since GROUP BY produces one row per entity, the aggregate MAX was a no-op.
**Fixed**: Changed to a NULL-safe subquery: `SELECT MAX(v) FROM (VALUES (...), (...), (...)) WHERE v IS NOT NULL`. Each layer's succeeded timestamp is a row; NULLs are filtered before the aggregate MAX. This correctly returns the latest timestamp even when one or two layers have no succeeded load (NULL), unlike SQLite scalar `MAX(a,b,c)` which returns NULL if any argument is NULL.
**Impact**: "Last Refreshed" column in the table list could show a stale LZ timestamp when Bronze/Silver had newer data. Affects any entity where layers load at different times (i.e., all of them).

### [F2] Unused imports: StatusRail, toRailStatus (severity: LOW)
**File**: `dashboard/app/src/pages/business/BusinessSources.tsx:16-17`
**Was**: `StatusRail` and `toRailStatus` imported from `@/components/business` but never referenced anywhere in the component.
**Fixed**: Removed both imports.
**Impact**: Dead code only — no runtime effect, but would cause lint warnings.

### [F3] Unused destructured variables: sourceConfigs, configLoading (severity: LOW)
**File**: `dashboard/app/src/pages/business/BusinessSources.tsx:218`
**Was**: `const { sources: sourceConfigs, loading: configLoading } = useSourceConfig()` — both `sourceConfigs` and `configLoading` were never used. The hook is still needed to hydrate the module-level cache that `resolveSourceLabel()` and `getSourceColor()` read from.
**Fixed**: Changed to `useSourceConfig()` with a comment explaining the cache hydration purpose. Removed unused variable bindings.
**Impact**: Dead code only.

### [F4] Link with preventDefault — semantic mismatch (severity: INFO)
**File**: `dashboard/app/src/pages/business/BusinessSources.tsx:193-208`
**Was**: `<Link to="/sources-portal?source=...">` with `onClick` that calls `e.preventDefault()`, scrolls to the table list, and dispatches a custom event. The `<Link>` never actually navigates — the `to` prop is dead.
**Deferred**: Changing `<Link>` to `<button>` is a semantic improvement but not a data-truth bug. The behavior works correctly as-is. No user-visible issue.
**Impact**: Accessibility/semantics only. Screen readers may announce it as a link to a URL that is never visited.

### [F5] Error banner has conflicting border styles (severity: INFO)
**File**: `dashboard/app/src/pages/business/BusinessSources.tsx:332-334`
**Was**: Style object sets both `border: "1px solid var(--bp-fault)"` and `borderColor: "rgba(185, 58, 42, 0.2)"`. The second overrides the first's color, making the `var(--bp-fault)` in `border` shorthand dead.
**Deferred**: Visual only, not a data-truth issue. The rgba value is a hardcoded color — noted in Token Inventory below.
**Impact**: Minor — border renders correctly with the rgba override, just redundant declaration.

### [F6] Source status logic marks "any failed entity" as degraded (severity: MEDIUM)
**File**: `dashboard/app/api/routes/overview.py:286-292`
**Was**: The `/api/overview/sources` endpoint marks a source as `"degraded"` if `error_count > 0`. Since `error_count` counts entities whose *latest* task log entry is `'failed'`, a single failed entity out of 596 marks the entire source as degraded — even if 595 are fine.
**Deferred**: This affects the BusinessOverview page (which also consumes `/api/overview/sources`) and potentially other consumers. The fix would require a threshold or percentage calculation, which is a cross-page design decision. Documented here for future consideration.
**Impact**: Source cards may show "Degraded" status too aggressively after any single entity failure.

### [F7] Frontend KPIData type missing backend fields (severity: INFO)
**File**: `dashboard/app/src/pages/business/BusinessSources.tsx:26-34`
**Was**: The `KPIData` interface has 7 fields. The backend returns 11 fields including `freshness_ever_loaded`, `freshness_last_success`, `open_alerts`, `loaded_entities`. The frontend simply ignores the extra fields — no runtime error.
**Deferred**: The extra fields could be useful for richer KPI display (e.g., showing "ever loaded" vs "24h fresh" distinction). Not a bug — TypeScript allows extra properties on fetch responses. Future enhancement opportunity.
**Impact**: None currently. Type is subset-safe.

---

## Token Inventory (for UP-06 scoping)

### Hardcoded hex/rgba values found:
- `rgba(185, 58, 42, 0.2)` — error banner border color (line 334)
- `rgba(34, 139, 34, 0.1)` — LayerDot operational background fallback (line 579, used as CSS fallback value after `var(--bp-operational-light, ...)`)

### Table headers present:
**YES** — The table list has a sticky header row at line 490-502 with columns: Table, Source, Layers, Last Refreshed. Currently styled with:
- `color: "var(--bp-ink-tertiary)"` (token-compliant)
- `background: "var(--bp-surface-1)"` (token-compliant)
- `borderBottom: "1px solid var(--bp-border-subtle)"` (token-compliant)
- Font: `text-[11px] font-medium uppercase tracking-wider` (Tailwind utilities)

The table header is already mostly token-compliant. UP-06 should verify the font-size/weight/tracking match the design system's table header spec, but no hardcoded colors here.

## overview.py Cross-Page Impact Notes

### Shared endpoints consumed by other pages:
- `/api/overview/kpis` — also consumed by `BusinessOverview.tsx`
- `/api/overview/sources` — also consumed by `BusinessOverview.tsx`
- `/api/overview/entities` — also consumed by `BusinessCatalog.tsx`
- `/api/overview/activity` — consumed by `BusinessOverview.tsx` (not used by BusinessSources)

### Issues found that affect other pages (DEFERRED):
1. **F6 (degraded status threshold)** — The aggressive "any failure = degraded" logic in `/api/overview/sources` affects source status badges on BusinessOverview too. Needs a cross-page design decision.
2. **`/api/overview/entities` LastLoadDate fix (F1)** — This fix IS applied because it is narrowly required for BusinessSources truth AND the fix is also correct for BusinessCatalog (which consumes the same endpoint). The scalar MAX returns the correct most-recent timestamp regardless of consumer.
