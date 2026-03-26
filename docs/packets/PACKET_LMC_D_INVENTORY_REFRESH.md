# PACKET D: Inventory Refresh Action

## Objective
Add a "Refresh Scan" button to the Inventory tab that triggers a lakehouse physical scan via `/api/load-center/refresh`.

## Scope
- `dashboard/app/src/pages/LoadMissionControl.tsx` — InventoryTab component

## Explicit Non-Scope
- Does NOT modify the refresh backend (already exists in load_center.py)
- Does NOT add scan scheduling or auto-refresh
- Does NOT change other tabs

## Findings Addressed
Fixes #13 from AUDIT-LoadMissionControl.md

## Files to Change
- `dashboard/app/src/pages/LoadMissionControl.tsx` — Add refresh button to InventoryTab header, call `/api/load-center/refresh`, show loading/success state

## Dependencies
- Depends on: nothing (endpoint already exists)
- Blocks: nothing

## Acceptance Criteria
1. Inventory tab has a "Refresh Scan" button
2. Clicking it calls `POST /api/load-center/refresh`
3. Button shows spinning icon while scan is running
4. After scan completes, inventory data auto-refreshes (via useProgress poll)
5. If scan fails, show error message (not silent swallow — per Packet A principle)

## Stop Conditions
- If load-center refresh takes >60s, show "Scan in progress" message and let poll catch the update

## Verification Steps
1. Click "Refresh Scan" → loading spinner appears
2. Wait for scan → counts update in inventory tab
3. Click while already scanning → shows "already running" or disables button
