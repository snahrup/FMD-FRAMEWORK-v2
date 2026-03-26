# PACKET C: Server-Side Error Filtering

## Objective
Add `error_type` query parameter to `/api/lmc/run/{id}/entities` so error-type batch retry doesn't need to fetch 5,000 entities client-side.

## Scope
- `dashboard/app/api/routes/load_mission_control.py` — `get_lmc_run_entities` handler
- `dashboard/app/src/pages/LoadMissionControl.tsx` — `handleRetryErrorType` callback

## Explicit Non-Scope
- Does NOT change the retry endpoint itself
- Does NOT change the entities tab filtering (that already works via source/layer/status params)

## Findings Addressed
Fixes #10 from AUDIT-LoadMissionControl.md

## Files to Change
- `dashboard/app/api/routes/load_mission_control.py` — Add `error_type` to the WHERE clause builder in `get_lmc_run_entities`
- `dashboard/app/src/pages/LoadMissionControl.tsx` — Update `handleRetryErrorType` to pass `error_type` param instead of fetching all failed and filtering client-side

## Dependencies
- Depends on: nothing
- Blocks: nothing

## Acceptance Criteria
1. `GET /api/lmc/run/{id}/entities?status=failed&error_type=timeout` returns only timeout failures
2. `handleRetryErrorType` uses the new param — no client-side filtering of 5,000 entities
3. Existing entity filtering (source, layer, status, search) still works unchanged
4. Error-type retry still works end-to-end

## Stop Conditions
- If ErrorType values contain special characters that need escaping, handle in backend

## Verification Steps
1. Call endpoint with `error_type=timeout` → only timeout entities returned
2. Call endpoint without `error_type` → all entities returned (backward compatible)
3. Click "Retry all timeout" in Triage tab → correct entities are retried
