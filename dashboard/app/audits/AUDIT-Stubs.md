# AUDIT: Stub Pages (4 Labs placeholders)

**Audited**: 2026-03-13
**Verdict**: PASS — all four are placeholder pages with zero data fetching

---

## Pages Audited

| Page | File | Lines | Status |
|------|------|-------|--------|
| **Cleansing Rule Editor** | `dashboard/app/src/pages/CleansingRuleEditor.tsx` | 48 | STUB — no data fetching |
| **DQ Scorecard** | `dashboard/app/src/pages/DqScorecard.tsx` | 48 | STUB — no data fetching |
| **Gold MLV Manager** | `dashboard/app/src/pages/GoldMlvManager.tsx` | 48 | STUB — no data fetching |
| **SCD Audit** | `dashboard/app/src/pages/ScdAudit.tsx` | 48 | STUB — no data fetching |

---

## Common Pattern

All four pages follow the exact same template:
1. An icon + title + "Labs" badge header
2. A short description paragraph
3. A centered "Coming Soon" placeholder with a wrench icon
4. A bullet list of planned features

**No imports from hooks, no `fetch()` calls, no `useEffect`, no API references, no state management beyond static JSX.**

Each page imports only:
- Lucide icons (3 icons each)
- No React hooks
- No API utilities
- No data hooks

---

## Details

### CleansingRuleEditor.tsx
- **Planned features**: Browse cleansing rules per Silver entity, visual rule builder, built-in functions (normalize_text, fill_nulls, parse_datetime), JSON preview
- **Data source when implemented**: Will need cleansing rules from the FMD metadata database (likely `sp_GetBronzeCleansingRule` / `sp_GetSilverCleansingRule` equivalents)

### DqScorecard.tsx
- **Planned features**: Per-table quality score with trend, column-level null rates/duplicate counts, cleansing rule pass/fail breakdown, quality thresholds
- **Data source when implemented**: Will need DQ metrics from the DQ cleansing notebook execution results

### GoldMlvManager.tsx
- **Planned features**: MLV inventory with Silver dependencies, fact vs dimension classification, custom Gold notebooks, business domain workspace association
- **Data source when implemented**: Will need Gold layer metadata (not yet captured in SQLite schema)

### ScdAudit.tsx
- **Planned features**: Per-table change breakdown (inserts/updates/deletes), run-over-run trend, IsCurrent/IsDeleted distribution, pipeline run drill-through
- **Data source when implemented**: Will need SCD2 metrics from Bronze-to-Silver notebook execution (partially available in `engine_task_log` but no dedicated SCD metrics columns)

---

## Summary

All four pages are honest "Coming Soon" placeholders. They display no data, make no API calls, and have no data correctness concerns. Each is approximately 48 lines of static JSX with a Labs badge clearly marking them as future features.
