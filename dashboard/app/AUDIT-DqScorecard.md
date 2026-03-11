# DqScorecard Page Audit

Audited: 2026-03-11
File: `dashboard/app/src/pages/DqScorecard.tsx` (~48 lines)
Backend: N/A — no API calls

---

## Current State

Pure "Coming Soon" placeholder. The page renders a static layout with:

1. **Header** — ShieldCheck icon + "DQ Scorecard" title + amber "Labs" badge
2. **Subtitle** — "Data quality metrics and cleansing rule pass/fail rates per table"
3. **Coming Soon block** — Wrench icon, description text, and a feature preview list:
   - Per-table quality score with trend over time
   - Column-level null rates, duplicate counts, format compliance
   - Cleansing rule pass/fail breakdown per entity
   - Configurable quality thresholds and alerting

No state, no hooks, no effects, no API calls, no interactivity. Entirely static JSX.

### Routing

- **Route**: `/labs/dq-scorecard` (defined in `App.tsx:87`)
- **Import**: `App.tsx:18` — `import DqScorecard from '@/pages/DqScorecard'`
- **Nav visibility**: Controlled by feature flags (comment in App.tsx:83)
- **Smoke test**: Included in `tests/smoke.spec.ts:77` and `tests/ux-capture.cjs:34`

### Exports

- Default export `DqScorecard` function component — correct, matches the import in App.tsx.

## Frontend Bugs Fixed

None — page is a static placeholder with no logic to contain bugs. All imports are valid (`lucide-react` icons: ShieldCheck, Wrench, ArrowRight). No state, no effects, no data fetching, no crash risks.

## Backend Issues

No backend endpoints exist for DQ scoring. When this page becomes functional, the following would be needed:

1. **DQ metrics storage** — The DQ cleansing notebook (`NB_FMD_DQ_CLEANSING`) already runs quality checks, but results are not persisted to the SQL metadata database in a queryable form.
2. **API endpoints** — `server.py` would need endpoints like:
   - `GET /api/dq/scores` — per-entity quality scores (pass/fail counts, null rates, etc.)
   - `GET /api/dq/scores/:entityId/history` — trend data over time for a specific entity
   - `GET /api/dq/rules` — list of active cleansing rules and their configurations
3. **Stored procedures** — SQL procs to aggregate DQ results (e.g., `sp_GetDqScores`, `sp_GetDqTrend`)

## Recommendations

1. **No immediate action needed** — the placeholder is clean, well-structured, and consistent with other Labs pages (CleansingRuleEditor, ScdAudit, GoldMlvManager).
2. **Prerequisites before building this page**:
   - DQ cleansing notebook must write results to a structured table (e.g., `execution.DqResult` with columns: EntityId, RuleName, PassCount, FailCount, RunTimestamp)
   - Entity digest engine could incorporate a `dqScore` field per entity (noted in DIGEST_MIGRATION_AUDIT.md:226)
3. **Implementation priority**: Low — this is a Labs feature. The core pipeline (LZ/Bronze/Silver) and operational pages should be fully stable first.
