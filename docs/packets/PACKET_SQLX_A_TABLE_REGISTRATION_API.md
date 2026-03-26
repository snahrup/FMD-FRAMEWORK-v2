# PACKET A: Table Registration API + Registration Status Enrichment

## Objective
Add a backend endpoint that registers user-selected tables into the pipeline (LZ->Bronze->Silver cascade) and enrich the table listing API with registration status so the UI knows which tables are already loaded.

## Scope
- New endpoint: `POST /api/entities/register-tables` — accepts list of {server, database, schema, table} and cascade-registers across all 3 layers
- Enrich `GET /api/sql-explorer/tables` response with `is_registered` and `entity_id` fields by cross-referencing lz_entities
- Fix F8: enrich `GET /api/sql-explorer/databases` with `isRegistered` field (check if any entities exist for that datasource)

## Explicit Non-Scope
- No UI changes (that's Packet B)
- No engine run triggering (that's Packet C)
- No row count enrichment beyond what INFORMATION_SCHEMA already provides

## Findings Addressed
Fixes #8, #16, #18, #19, #24 from AUDIT-SqlExplorer.md

## Files to Change
- `dashboard/app/api/routes/sql_explorer.py` — enrich /tables and /databases responses with registration status
- `dashboard/app/api/routes/source_manager.py` — add `register_tables()` endpoint (or new file)
- `dashboard/app/src/types/sqlExplorer.ts` — extend SourceTable with is_registered, entity_id

## Dependencies
- Depends on: nothing
- Blocks: Packet B (UI needs enriched data), Packet C (run trigger needs entity IDs)

## Acceptance Criteria
1. `GET /api/sql-explorer/tables?server=X&database=Y&schema=Z` returns `is_registered: true/false` and `entity_id: N|null` per table
2. `GET /api/sql-explorer/databases?server=X` returns `isRegistered: true/false` per database
3. `POST /api/entities/register-tables` with `[{server, database, schema, table}]` creates lz + bronze + silver entities
4. Re-registering an already-registered table is a no-op (returns existing entity IDs)
5. New entities have IsActive=1 across all layers

## Stop Conditions
- If the connections or datasources table doesn't have a matching record for the server/database, STOP — need to register the connection first

## Verification Steps
1. Call enriched /tables endpoint — verify registered tables show `is_registered: true`
2. Register a new test table via POST — verify 3 rows created (lz + brz + slv)
3. Call /tables again — verify the new table now shows `is_registered: true`
4. Re-register same table — verify no duplicates, returns same IDs
