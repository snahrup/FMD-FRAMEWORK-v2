# Packet Index: SQL Explorer — Table Browser Feature

**Page**: `/sql-explorer` (SqlExplorer.tsx)
**Audit**: `dashboard/app/audits/AUDIT-SqlExplorer.md`
**Date**: 2026-03-26

## Packet Sequence

| Packet | Name | Findings | Depends On | Est. Scope | Status |
|--------|------|----------|------------|------------|--------|
| A | Table Registration API + Status Enrichment | #8, #16, #18, #19, #24 | — | Small (1-2h) | Pending |
| B | Table Browser UI — Multi-Select + Registration | #16, #17, #23 | A | Medium (2-3h) | Pending |
| C | Immediate Load Trigger — Register & Load | #22 | A, B | Small (1h) | Pending |

## Critical Path

```
A (API + data enrichment)
  └─→ B (UI checkboxes + badges)
       └─→ C (load trigger + LMC redirect)
```

**Total estimated scope**: 4-6 hours across 3 packets.

## Architecture Summary

```
SQL Explorer (existing)
  ├─ ObjectTree (enhanced with checkboxes + badges)  ← Packet B
  ├─ TableDetail (unchanged)
  │
  ├─ GET /api/sql-explorer/tables (enriched)         ← Packet A
  ├─ POST /api/entities/register-tables (NEW)        ← Packet A
  └─ POST /api/engine/start (existing, with filter)  ← Packet C
       └─→ Redirect to /load-mission-control
```

## Open Questions
1. Should "Register & Load" do all 3 layers (LZ+Bronze+Silver) or just LZ? (Recommendation: all 3 — matches the pipeline chain)
2. Should we show estimated load time based on avg_duration from task_log? (Nice-to-have, not required for MVP)
