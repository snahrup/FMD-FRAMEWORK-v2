# PACKET E: Dead Code Cleanup

## Objective
Remove unused TypeScript interface and update stale audit document reference.

## Scope
- `dashboard/app/src/pages/LoadMissionControl.tsx` — Remove `RunDetailResponse` interface
- `docs/AUDIT-LoadMissionControl.md` — Archive or remove stale audit (references old LoadProgress.tsx)

## Explicit Non-Scope
- Does NOT remove the `/api/lmc/run/{id}` backend endpoint (it may be useful for Packet B or future work)
- Does NOT refactor the file structure

## Findings Addressed
Fixes #1 from AUDIT-LoadMissionControl.md

## Files to Change
- `dashboard/app/src/pages/LoadMissionControl.tsx` — Delete lines 162-169 (`RunDetailResponse`)
- `docs/AUDIT-LoadMissionControl.md` — Add header note: "SUPERSEDED by dashboard/app/audits/AUDIT-LoadMissionControl.md (2026-03-25)"

## Dependencies
- Depends on: Packet B (if Packet B decides to USE RunDetailResponse, don't delete it)
- Blocks: nothing

## Acceptance Criteria
1. `RunDetailResponse` no longer exists in the file
2. TypeScript compiles without errors
3. Old audit doc has superseded notice

## Verification Steps
1. `grep -r RunDetailResponse dashboard/app/src/` returns no results
2. `npx tsc --noEmit` passes
