# PACKET B: Table Browser UI — Multi-Select + Registration Flow

## Objective
Add a Table Browser panel to SQL Explorer that shows registration status badges on tables and lets users select multiple unregistered tables via checkboxes for pipeline registration.

## Scope
- Add registration status badges (checkmark or "In Pipeline" tag) to tables in ObjectTree
- Add checkbox column to table rows in ObjectTree for multi-select
- Add floating action bar at bottom: "Register N Tables" button appears when tables are selected
- Add confirmation dialog: shows selected tables, estimated row counts, "Register & Load" vs "Register Only" options
- Cache invalidation: refresh table list after registration

## Explicit Non-Scope
- No changes to TableDetail (right panel) — keeps existing column/preview functionality
- No engine run triggering (Packet C)
- No new page — this integrates into the existing SqlExplorer page

## Findings Addressed
Fixes #16, #17, #23 from AUDIT-SqlExplorer.md

## Files to Change
- `dashboard/app/src/components/sql-explorer/ObjectTree.tsx` — add checkboxes, registration badges, selection state, floating action bar
- `dashboard/app/src/types/sqlExplorer.ts` — extend SourceTable interface (already done in Packet A)
- `dashboard/app/src/pages/SqlExplorer.tsx` — lift selection state, add confirmation dialog, wire registration API call

## Dependencies
- Depends on: Packet A (enriched API data + registration endpoint)
- Blocks: Packet C (UI triggers the run)

## Acceptance Criteria
1. Tables in ObjectTree show a small badge/icon if already registered (green check or "In Pipeline" tag)
2. Unregistered tables show a checkbox on hover or always-visible
3. User can select multiple tables across schemas within a database
4. Floating bar appears: "Register 5 tables to pipeline"
5. Confirmation dialog shows: table names, schemas, estimated rows, "Register & Load" and "Register Only" buttons
6. After registration, badges update without page refresh (cache invalidation)
7. Already-registered tables cannot be selected (checkbox disabled or hidden)

## Stop Conditions
- If ObjectTree becomes >1200 lines, extract the table browser into a separate component

## Verification Steps
1. Open SQL Explorer, expand a database/schema — see registration badges
2. Check 3 unregistered tables — floating bar appears with count
3. Click "Register Only" — tables registered, badges update immediately
4. Try selecting an already-registered table — checkbox should be disabled
5. Deep-link with ?server=X&database=Y — verify badges load correctly
