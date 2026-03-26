# PACKET C: Immediate Load Trigger — Register & Load Flow

## Objective
Wire the "Register & Load" button to immediately trigger an engine pipeline run for the newly registered entities, then redirect the user to Load Mission Control to watch progress.

## Scope
- "Register & Load" button in confirmation dialog calls registration API then starts engine run
- Engine run filtered to ONLY the new entity IDs (not a full run)
- Redirect to `/load-mission-control` with the new run ID pre-selected
- Toast notification: "N tables registered. Pipeline run started."
- "Register Only" button registers without triggering a run

## Explicit Non-Scope
- No changes to the engine itself — uses existing `/api/engine/start` with entity filter
- No changes to LMC — it already handles filtered runs
- No incremental/watermark setup — first load is always full

## Findings Addressed
Fixes #22 from AUDIT-SqlExplorer.md

## Files to Change
- `dashboard/app/src/pages/SqlExplorer.tsx` — wire "Register & Load" to engine start + navigate to LMC
- `dashboard/app/api/routes/source_manager.py` or new endpoint — registration + run trigger combo endpoint (optional: can be two sequential client-side calls)

## Dependencies
- Depends on: Packet A (registration API returns entity IDs), Packet B (UI triggers)
- Blocks: nothing

## Acceptance Criteria
1. "Register & Load" button: registers tables, starts engine run with entity filter, redirects to LMC
2. LMC shows the new run with only the selected entities
3. "Register Only" button: registers tables only, stays on SQL Explorer, shows success toast
4. If engine is already running, "Register & Load" shows warning: "A run is already active. Tables registered but load deferred."
5. New entities automatically included in all future runs (IsActive=1)

## Stop Conditions
- If the engine start API doesn't support entity ID filtering, STOP — need to add that capability first

## Verification Steps
1. Select 2 unregistered tables → "Register & Load" → verify redirect to LMC
2. LMC shows run with exactly 2 entities (not full 1169)
3. Run completes → verify parquet files created for both tables
4. Start another full run → verify the 2 new tables are included
5. "Register Only" → verify no run started, tables show as registered
