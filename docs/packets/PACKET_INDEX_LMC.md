# Load Mission Control — Packet Index

**Audit**: `dashboard/app/audits/AUDIT-LoadMissionControl.md` (2026-03-25, true-falcon)
**Total findings**: 14 (0 CRITICAL, 1 HIGH, 4 MODERATE, 5 LOW, 4 Info)

## Packet Sequence

| Packet | Name | Findings | Depends On | Est. Scope | Status |
|--------|------|----------|------------|------------|--------|
| A | Action Feedback | #4, #5, #6, #7 | — | Small (1-2h) | Pending |
| B | Entity History Drill-Down | #2, #3, #8 | — | Medium (2-3h) | Pending |
| C | Server-Side Error Filter | #10 | — | Small (<1h) | Pending |
| D | Inventory Refresh | #13 | — | Small (<1h) | Pending |
| E | Dead Code Cleanup | #1 | B (conditional) | Tiny (<30m) | Pending |

## Critical Path

All packets are independent — no blocking dependencies. Can be executed in any order.

**Recommended order**: A → C → D → B → E
- A first because silent failures actively hurt usability during pipeline runs
- C and D are quick wins
- B is the largest packet but adds the most value (entity deep-dive)
- E last because it depends on whether B reuses `RunDetailResponse`

## Not In Scope (Backlog)

These were identified during audit but are not backed by findings severe enough to warrant packets:

- **File splitting**: 3,280-line single file could be split into modules (Finding #11, Info severity)
- **Poll rate tuning**: Active-run polling generates ~1 req/s (Finding #12, Info severity)
- **Lakehouse key validation**: Frontend trusts backend lakehouse key names (Finding #14, Low severity)
- **Pre-launch dry-run**: `/api/engine/plan` endpoint exists but isn't wired to frontend
- **Preflight health check**: `/api/engine/health` exists but isn't wired to frontend
- **Watermark reset**: `/api/engine/entity/{id}/reset` exists but isn't wired to frontend
