# PACKET B: Entity History Drill-Down

## Objective
Wire the existing `/api/lmc/entity/{id}/history` backend endpoint into the ContextPanel so users can see cross-run history, watermark progression, and retry counts for any entity.

## Scope
- `dashboard/app/src/pages/LoadMissionControl.tsx` — ContextPanel component, new `useEntityHistory` hook
- Backend endpoint already exists and is tested — no backend changes needed

## Explicit Non-Scope
- Does NOT modify `/api/lmc/entity/{id}/history` backend
- Does NOT add entity-level watermark reset (that's a separate feature)
- Does NOT change the entities table or triage tab

## Findings Addressed
Fixes #2, #3, #8 from AUDIT-LoadMissionControl.md

## Files to Change
- `dashboard/app/src/pages/LoadMissionControl.tsx`:
  - Add `useEntityHistory(entityId)` hook that calls `/api/lmc/entity/{id}/history`
  - Enhance ContextPanel to show: watermark timeline, run history table, retry badge
  - Add "History" sub-tab to ContextPanel alongside existing details/failures/verification modes

## Dependencies
- Depends on: nothing (backend endpoint already exists)
- Blocks: nothing

## Acceptance Criteria
1. Clicking an entity in the entities tab opens ContextPanel with current-run details (existing behavior preserved)
2. ContextPanel has a "History" mode showing all runs for that entity
3. Each history row shows: run_id, layer, status, rows_read, duration, watermark_before/after, created_at
4. Watermark progression is visible (sequential watermark values across runs)
5. If entity has >1 entry per run+layer, show retry badge with count
6. Loading state while history fetches
7. Empty state if entity has never been loaded

## Stop Conditions
- If entity history response is too large (>500 entries), add pagination
- If ContextPanel becomes too complex, break into sub-components within the same file

## Verification Steps
1. Select an entity that has been loaded multiple times → history shows all runs
2. Select an incremental entity → watermark progression visible
3. Select an entity that was retried → retry count badge appears
4. Select an entity that has never been loaded → empty state message
5. Close and reopen ContextPanel → history refreshes for new entity
