# AUDIT-DJ: DataJourney.tsx

**Page**: `dashboard/app/src/pages/DataJourney.tsx`
**Date**: 2026-03-23
**Auditor**: Claude (Opus) — Wave 3b
**Prior audit**: 2026-03-13 (backend shape mismatch, watermarks empty, entity_status not used)
**Scope**: Frontend-only audit + navigation handoff verification

---

## NAVIGATION HANDOFF VERIFICATION

### Inbound Navigation

| Source | URL Pattern | Status |
|--------|-------------|--------|
| **FlowExplorer** | `/journey?entity={lzEntityId}` | WORKS — FlowExplorer line 1394 sends numeric entity ID |
| **Direct URL** | `/journey?entity=123` | WORKS — line 369 reads `entity` param, line 408 validates numeric, line 409 calls `loadJourney()` |
| **Table+Schema** | `/journey?table=FOO&schema=dbo` | WORKS — lines 410-421 fuzzy-match against entity digest, then replace URL with `?entity=` |
| **No params** | `/journey` | WORKS — shows empty state "Select an entity above to trace its data journey" (line 632) |

**Param reading on mount**: `useSearchParams()` at line 368-371 reads `entity`, `table`, `schema`. A `useEffect` at line 407 fires on mount:
- If `entity` param is numeric, calls `loadJourney(parseInt(entityIdParam, 10))`
- If `table` param present (and entities loaded), fuzzy-matches by `tableName` + optional `schema`, replaces URL with resolved `?entity=` param
- If nothing matches, no-op — empty state shown

**Invalid entity ID handling**: If the ID doesn't exist, the API returns an error which is caught (line 396), sets `error` state, and shows an error banner (lines 622-627). No crash.

### Outbound Navigation

| Destination | Link Pattern | Context Passed |
|-------------|-------------|---------------|
| **Record Counts** | `/record-counts?search={tableName}` | Table name for filtering (line 682) |
| **Data Blender** | `/blender?table={tableName}&schema={onelakeSchema}` | Table + schema (line 689, also line 339) |
| **Data Profiler** | `/profile?lakehouse={lh}&schema={schema}&table={table}&layer={layer}` | Full context for Bronze/Silver (line 337) |

All outbound links use `<Link>` with `encodeURIComponent` on params. Context is correctly propagated.

### Verdict: HANDOFF CONTRACT IS SOUND

---

## FIXES APPLIED (this audit)

### FIX 1: Removed unused import `CheckCircle` (DEAD CODE)
- **Severity**: LOW
- `CheckCircle` was imported from lucide-react but never referenced anywhere in the component.

### FIX 2: Replaced all hardcoded hex colors with design tokens (HARDCODED HEX)
- **Severity**: MEDIUM
- **Before**: 11 instances of hardcoded hex: `#9A4A1F`, `#475569`, `#E2E8F0`, `#EDCFBD`, `#A8A29E`, `#3D7C4F`
- **After**: All replaced with `var(--bp-copper-hover)`, `var(--bp-silver)`, `var(--bp-silver-light)`, `var(--bp-bronze-light)`, `var(--bp-ink-muted)`, `var(--bp-operational)` respectively
- Also removed dead `hex`, `bg`, `border` fields from LAYERS constant (never referenced)

### FIX 3: Fixed fabricated LZ count in StrataBar (TRUTH BUG)
- **Severity**: HIGH
- **Before**: `lz={journey.bronze?.rowCount ?? (journey.landing ? 1 : null)}` — passed `1` as LZ count when entity was at landing-only stage, fabricating a count that doesn't exist
- **After**: `lz={journey.bronze?.rowCount ?? null}` — passes null when no actual count is available, letting StrataBar show its proper null/empty state

### FIX 4: Added aria-labels to interactive elements (ACCESSIBILITY)
- **Severity**: MEDIUM
- Added `aria-label="Refresh entity journey data"` to refresh button
- Added `role="combobox"` and `aria-expanded`/`aria-label` to entity selector container
- Added `aria-label="Clear entity selection"` to clear (X) button

---

## PRIOR AUDIT FINDINGS (2026-03-13, still open)

These are backend issues that remain valid but are OUT OF SCOPE for this frontend-only audit:

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| B1 | CRITICAL | Backend response shape (`lz`, `bronze`, `silver` raw rows) does not match frontend `JourneyData` interface (`source`, `landing`, `bronze` with columns/rowCount) | DEFERRED — requires backend rewrite of `monitoring.py:get_entity_journey()` |
| B2 | HIGH | `watermarks` table has 0 rows — no load history data | DEFERRED — data population issue |
| B3 | MEDIUM | `entity_status` not used — `getMaxLayer()` uses registration existence not actual load status, so all entities appear fully progressed | DEFERRED — requires backend change |
| B4 | LOW | `pipeline_bronze_entity` empty — NULL processing fields in bronze view | DEFERRED — latent data gap |

---

## REMAINING OBSERVATIONS (no fix needed)

1. **Gold layer always null**: `TransitionCard from="silver" to="gold"` is always rendered with `reached={false}`. Correct — Gold layer is not yet implemented.

2. **Loading state on re-fetch**: The `hasLoadedOnce` ref suppresses the loading spinner on refresh calls (line 385). This means clicking Refresh shows no visual feedback except the spinning RefreshCw icon. Acceptable UX since the button icon itself animates.

3. **Dropdown entity list performance**: All entities loaded at once via `useEntityDigest()`. At 1,666 entities this is fine. No virtualization needed at this scale.

4. **Error recovery**: After an API error, user can select a different entity or retry. Error state is properly cleared on new load (line 387).

---

## DEFERRED ITEMS

| Item | Reason |
|------|--------|
| Backend response shape rewrite | Out of scope — shared backend route, not page-contained |
| entity_status integration for `getMaxLayer()` | Requires backend data — cannot fix frontend-only |
| StrataBar mode when entity is LZ-only with no counts | StrataBar component is shared — defer to component audit |
