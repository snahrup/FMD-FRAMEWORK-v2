# Gold Studio — Packet Index and Recommended Sequence

## Immediate packets in this bundle

1. `PACKET_01_FOUNDATION_SHELL_AND_DESIGN_SYSTEM.md`
2. `PACKET_02_DATABASE_SCHEMA_AND_MIGRATIONS.md`
3. `PACKET_03_FASTAPI_ROUTE_SCAFFOLDING.md`
4. `PACKET_04_LEDGER_PAGE_UI.md`
5. `PACKET_05_IMPORT_FLOW_AND_JOB_STATUS.md`

## Recommended next packets after these

6. Clusters page shell + card layout
7. Column reconciliation slide-over
8. Canonical page + domain grid
9. Relationship map view
10. Gold specs page + slide-over
11. Validation page + waiver workflow
12. Catalog publish flow + endorsement handling
13. Audit log + versioning hooks
14. Business portal mapping surfaces
15. Hardening + edge-state polish

## Recommended execution order

Start with Packet 01 only.

Why:
- it creates the shell everything else hangs on
- it reduces visual inconsistency early
- it gives the project a stable frame before data-heavy screens land

Then move to:
- Packet 02
- Packet 03
- Packet 04
- Packet 05

## Stop conditions

Do not continue to the next packet if:
- the current packet broke existing navigation
- the route shell is unstable
- migrations are inconsistent with the spec
- UI primitives are not reusable enough to support the later screens
