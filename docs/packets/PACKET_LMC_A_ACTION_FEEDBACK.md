# PACKET A: Action Feedback

## Objective
Give users visible feedback when pipeline actions (start, stop, retry, resume) succeed or fail, replacing silent error swallowing.

## Scope
- `dashboard/app/src/pages/LoadMissionControl.tsx` — `handleStart`, `handleStop`, `handleRetry`, `handleResume`, `handleRetryEntity`, `handleRetryErrorType`
- Add a lightweight toast/banner state to the scope reducer (or a separate useState in LoadMissionControlInner)

## Explicit Non-Scope
- Does NOT change backend endpoints
- Does NOT add a toast library (use inline banner pattern already used in scoped-run banner)
- Does NOT touch any tab content components

## Findings Addressed
Fixes #4, #5, #6, #7 from AUDIT-LoadMissionControl.md

## Files to Change
- `dashboard/app/src/pages/LoadMissionControl.tsx` — Add notification state, update all action handlers to set success/error messages, render notification banner

## Dependencies
- Depends on: nothing
- Blocks: nothing

## Acceptance Criteria
1. Starting a run shows "Pipeline started" banner (auto-dismiss 5s)
2. Start failure shows error banner with message from server
3. Stop shows "Stop requested" banner
4. Retry shows "Retrying N entities" banner
5. Resume shows "Resuming run" banner
6. Entity-level retry shows "Retrying entity {name}" inline
7. Error-type batch retry shows "Retrying N {errorType} entities" banner
8. All error banners persist until dismissed (no auto-dismiss)

## Stop Conditions
- If adding notification state complicates the scope reducer significantly, use standalone useState instead
- If banner rendering conflicts with existing layout, use absolute-positioned toast instead

## Verification Steps
1. Start a run with valid sources → green banner appears and auto-dismisses
2. Start a run with impossible sources → red banner appears with error text
3. Stop a running pipeline → banner confirms stop requested
4. Click retry on a failed run → banner confirms retry count
5. Click retry on individual entity → inline confirmation
