# V2 Whole-App Forensic Audit -- Consolidated Summary

**Date**: 2026-04-08
**Phases completed**: Phase -1 (inventory), Phase 0 (shared infra), Phase 1 (6 domain sessions)
**Total surfaces audited**: 55 routed pages + shared infrastructure (50 files)

---

## 1. Executive Roll-Up

| Metric | Count |
|--------|-------|
| Total findings | 239 |
| CRITICAL | 7 |
| HIGH | 40 |
| MODERATE | 78 |
| LOW | 85 |
| INFO | 29 |
| Verified OK (Phase 0) | 49 |
| Verified FIXED (Phase 1 canonical re-checks) | 42 |
| Verified STILL PRESENT (Phase 1 prior findings) | 22 |
| Unique pages audited | 55 |
| Shared infra files audited | 50 |

### Breakdown by Session

| Session | CRIT | HIGH | MOD | LOW | INFO | Total |
|---------|------|------|-----|-----|------|-------|
| Phase 0: Shared Infrastructure | 5 | 18 | 27 | 17 | 10 | 80 (includes 3 sub-units) |
| EC-TIER1-OPS | 0 | 3 | 13 | 17 | 0 | 33 |
| EC-TIER2-MONITORING | 0 | 2 | 9 | 13 | 0 | 24 |
| BP-GOLD | 2 | 5 | 11 | 17 | 6 | 41 |
| EC-TOOLS-DATA | 0 | 4 | 11 | 18 | 5 | 38 |
| GOV-MOCK-TRUTH | 0 | 0 | 0 | 2 | 2 | 4 |
| SETTINGS-SETUP-LABS | 0 | 8 | 7 | 1 | 3 | 19 |
| **TOTAL** | **7** | **40** | **78** | **85** | **29** | **239** |

---

## 2. CRITICAL Findings (must fix before any release)

| ID | Source Session | Finding | Impact | File:Line |
|----|--------------|---------|--------|-----------|
| SHARED-FE-001 | Phase 0 | **No ErrorBoundary anywhere in app** -- zero `componentDidCatch`. Any uncaught JS error crashes entire React tree to blank white screen. | All 55 pages unprotected | `App.tsx` (missing) |
| SHARED-FE-002 | Phase 0 | **No catch-all 404 route** -- `<Route path="*">` absent. Undefined URLs render empty layout shell. | Broken bookmarks, user confusion | `App.tsx:86-150` |
| SHARED-BE-001 | Phase 0 | **SQL injection in `preview_query()`** -- raw user SQL via `cur.execute(sql)` on production source DBs. No sanitization, no read-only guard. | Full RCE via `xp_cmdshell` | `schema_discovery.py:145` |
| SHARED-BE-002 | Phase 0 | **SQL injection via f-string in `SET ROWCOUNT`** -- `limit` param interpolated without int validation. | Statement injection | `schema_discovery.py:142` |
| SHARED-BE-003 | Phase 0 | **SQL injection in `bulk_seed()`** -- table/column names from dict keys interpolated into SQL. | Full SQLite injection | `control_plane_db.py:1918` |
| BPG-DET-001 | BP-GOLD | **Ghost endpoint `/api/gold/models/{id}`** does not exist anywhere in backend. DatasetDetail calls it; Gold Model panel shows empty/loading indefinitely. | Broken feature, silent 404 | `DatasetDetail.tsx:230` |
| BPG-CLUST-001 | BP-GOLD | **GoldClusters column reconciliation calls `/columns` instead of `/column-decisions`**. Endpoint does not exist. Entire reconciliation feature is broken. | Dead feature | `GoldClusters.tsx:285` |

---

## 3. HIGH Findings (fix during Phase 2)

### 3.1 Security (10)

| ID | Source | Finding | File |
|----|--------|---------|------|
| SHARED-BE-004 | Phase 0 | CORS `*` on all responses -- any website can make cross-origin requests | `server.py:191`, `router.py:67` |
| SHARED-BE-005 | Phase 0 | Zero authentication on all endpoints -- relies solely on IIS reverse proxy | `server.py`, `router.py:73` |
| SHARED-FE-006 | Phase 0 | Admin password sent plaintext over HTTP via `pageVisibility.ts` | `lib/pageVisibility.ts:25-50` |
| SHARED-BE-007 | Phase 0 | `auto_detect_source()` brute-forces all 5 DBs with user SQL | `schema_discovery.py:239-284` |
| SHARED-BE-008 | Phase 0 | No request body size limit -- OOM via `Content-Length: 999999999` | `server.py:253-254` |
| BPG-XCUT-002 | BP-GOLD | No CSRF protection on any mutation endpoint | All POST/PUT/DELETE |
| BPG-XCUT-003 | BP-GOLD | No auth/session management on any Gold Studio page | All Gold pages |
| ECT-SQLX-001 | EC-TOOLS-DATA | `_validate_server()` whitespace-only server name edge case bypasses allowlist | `sql_explorer.py` |
| ECT-MRI-001 | EC-TOOLS-DATA | **Path traversal** in `_load_run_file()` -- `runId` not sanitized, 6 endpoints affected | `mri.py` |
| SSL-SETUP-002 | SETTINGS-SETUP-LABS | `POST /api/setup/provision-all` endpoint not found in `admin.py` -- ProvisionAll feature broken | `ProvisionAll.tsx` |

### 3.2 Data Contract / Architecture (11)

| ID | Source | Finding | File |
|----|--------|---------|------|
| SHARED-FE-003 | Phase 0 | `mockData.ts` has fake sources (Salesforce, SAP, Oracle) -- fallback risk | `lib/mockData.ts` |
| SHARED-FE-004 | Phase 0 | ~40 pages eagerly imported, only 9 lazy-loaded -- massive initial bundle | `App.tsx:5-74` |
| SHARED-FE-005 | Phase 0 | No AbortController on any fetch hook -- unmount doesn't cancel HTTP requests | All 4 data hooks |
| EC1-SRC-001 | EC-TIER1-OPS | `get_connections()` omits `ConnectionGuid` -- `isRegistered()` always fails | `control_plane.py:414` |
| EC1-LMC-001 | EC-TIER1-OPS | No entity history drill-down -- backend ready, frontend never calls it | `LMC.tsx:2469` |
| EC1-ENG-001 | EC-TIER1-OPS | Metrics layers type mismatch -- `Record<string,{}>` vs backend array | `EngineControl.tsx:150` |
| EC2-CP-001 | EC-TIER2-MONITORING | Missing `POST /api/entity-digest/resync` endpoint -- maintenance agent broken | `ControlPlane.tsx:255` |
| EC2-CP-002 | EC-TIER2-MONITORING | Missing `POST /api/maintenance-agent/trigger` endpoint -- maintenance button dead | `ControlPlane.tsx:264` |
| BPG-DET-002 | BP-GOLD | Quality scores fetched without entity filter -- scans all 50, may miss target entity | `DatasetDetail.tsx:202` |
| BPG-DET-003 | BP-GOLD | Entity lookup scans full 1,666-entity list for a single ID | `DatasetDetail.tsx:161` |
| BPG-CLUST-002 | BP-GOLD | N+1 query: fetches each cluster individually after list load (200+ sequential HTTP calls) | `GoldClusters.tsx:117-132` |

### 3.3 Truth / Feature Integrity (8)

| ID | Source | Finding | File |
|----|--------|---------|------|
| BPG-VALID-001 | BP-GOLD | GoldValidation consumes 14 endpoints -- brittle, should split | `GoldValidation.tsx` |
| ECT-RUN-001 | EC-TOOLS-DATA | PipelineRunner prepare/restore is a no-op -- `deactivated` counts always 0 | `pipeline.py` |
| ECT-SV-001 | EC-TOOLS-DATA | SchemaValidation drill-down is dead code -- expand shows nothing | `SchemaValidation.tsx` |
| SSL-SET-002 | SETTINGS-SETUP-LABS | Two divergent deployment UIs (Settings inline wizard vs DeploymentManager SSE) | `Settings.tsx`, `DeploymentManager.tsx` |
| SSL-CROSS-003 | SETTINGS-SETUP-LABS | Same as SSL-SET-002 -- two separate deployment workflows, incompatible | Settings + Admin |
| SSL-CROSS-004 | SETTINGS-SETUP-LABS | All 4 Labs pages wrongly classified as stubs -- all are 700-900 line implementations | Manifest |
| SSL-LAB-001 | SETTINGS-SETUP-LABS | CleansingRuleEditor is 900+ lines, not a stub | `CleansingRuleEditor.tsx` |
| SSL-LAB-002 | SETTINGS-SETUP-LABS | ScdAudit is 700+ lines, not a stub | `ScdAudit.tsx` |
| SSL-LAB-003 | SETTINGS-SETUP-LABS | GoldMlvManager is 800+ lines, not a stub | `GoldMlvManager.tsx` |
| SSL-LAB-004 | SETTINGS-SETUP-LABS | DqScorecard is 700+ lines, not a stub | `DqScorecard.tsx` |

### 3.4 Engine (6)

| ID | Source | Finding | File |
|----|--------|---------|------|
| SHARED-ENG-001 | Phase 0 | Token refresh race -- lock released between check and fetch | `auth.py:64-99` |
| SHARED-ENG-002 | Phase 0 | `_OneLakeCredential` reads cache without lock -- data race | `auth.py:168-169` |
| SHARED-ENG-003 | Phase 0 | Pipeline mode never advances watermark -- re-extracts same data forever | `pipeline_runner.py:106-107` |
| SHARED-ENG-004 | Phase 0 | Double audit logging -- successful entities logged twice | `orchestrator.py:1331+1389` |
| SHARED-ENG-005 | Phase 0 | `_validate_config` logs error but never raises -- engine proceeds with empty GUIDs | `orchestrator.py:195-220` |
| SHARED-ENG-006 | Phase 0 | `run_timeout_seconds` computed but never enforced | `orchestrator.py:308-333` |

> **Note**: SHARED-FE-007 (dark theme toggle non-functional) and SHARED-BE-006 (no connection pooling) are also HIGH but listed for completeness in Phase 0 source file.

---

## 4. MODERATE Findings (summary by theme)

**78 total MODERATE findings across all sessions, grouped by theme:**

### 4.1 Silent Error Swallowing (14 findings)

Pages that catch errors with empty blocks or console-only logging, leaving users unaware of failures:
- Phase 0: SHARED-FE-019, SHARED-ENG-008, ENG-009, ENG-010, ENG-015
- EC-TIER1-OPS: EC1-SRC-007, EC1-LC-001, EC1-LC-002, EC1-LC-005, EC1-OVR-001, EC1-LMC-003, EC1-LMC-006, EC1-LMC-008, EC1-ENG-005
- EC-TIER2-MONITORING: EC2-LOG-001, EC2-CP-003

### 4.2 Data Contract Mismatches / Truth Bugs (12 findings)

Backend returns different shape/content than frontend expects, or data is fabricated:
- Phase 0: SHARED-FE-013, SHARED-FE-016, SHARED-BE-012, SHARED-BE-013, SHARED-BE-016
- EC-TIER1-OPS: EC1-SRC-002, EC1-SRC-005, EC1-CFG-001
- EC-TIER2-MONITORING: EC2-DJ-001 (dbo schema fabrication), EC2-LP-001 (inflated loaded count), EC2-REPLAY-001
- EC-TOOLS-DATA: ECT-MICRO-001 (transformation steps claim vs reality), ECT-MRI-002 (fabricated AI analysis), ECT-MRI-003 (fabricated flake detection), ECT-NBC-001 (templateMapping ghost section)

### 4.3 Security Gaps (8 findings)

- Phase 0: SHARED-BE-009, SHARED-BE-014
- EC-TOOLS-DATA: ECT-NBC-002, ECT-TA-001, ECT-DBX-001, ECT-DBX-002, ECT-DM-001
- SETTINGS-SETUP-LABS: SSL-ADMIN-001, SSL-CROSS-001

### 4.4 Concurrency / Race Conditions (5 findings)

- Phase 0: SHARED-BE-006, SHARED-BE-010, SHARED-ENG-011, SHARED-ENG-012
- EC-TOOLS-DATA: ECT-RUN-002, ECT-RUN-003

### 4.5 Architecture / Duplication (9 findings)

- Phase 0: SHARED-BE-011, SHARED-BE-017, SHARED-FE-010, SHARED-FE-012
- BP-GOLD: BPG-LED-002, BPG-XCUT-001, BPG-XCUT-004, BPG-CANON-004, BPG-SPEC-002
- EC-TIER2-MONITORING: EC2-FLOW-001, EC2-RC-001, EC2-COL-001, EC2-LIVE-001
- EC-TOOLS-DATA: ECT-SQLX-002, ECT-SV-002, ECT-SV-003
- SETTINGS-SETUP-LABS: SSL-SET-001, SSL-SET-004, SSL-ADMIN-004, SSL-SETUP-003, SSL-CROSS-002, SSL-CROSS-005

### 4.6 Business Portal / Gold Studio Gaps (8 findings)

- BPG-ALERT-001 (freshness SLA not configurable), BPG-ALERT-002 (no failure-type alerts)
- BPG-CAT-002 (domains lack id/description), BPG-CAT-003 (quality scores 500 ceiling)
- BPG-CLUST-003 (wrong HTTP method), BPG-REQ-002 (PATCH never called)
- BPG-SPEC-002 (hardcoded FALLBACK_DOMAINS), BPG-SPEC-003 (columns/transforms always empty)
- BPG-VALID-002 (JSON string parsing risk), BPG-VALID-003 (no publish confirmation)

---

## 5. LOW + INFO (deferred)

| Severity | Count | Themes |
|----------|-------|--------|
| LOW | 85 | Accessibility gaps (25+), polling without backoff (8), dead code/unused imports (12), stub features presented as real UI (6), minor data contract gaps (10), error handling edge cases (14), hardcoded values (5), file size/maintainability (5) |
| INFO | 29 | Import ordering (3), CSS duplication (2), acceptable design choices (5), documentation gaps (4), performance observations (3), feature gap documentation (7), manifest notes (5) |

---

## 6. Cross-Cutting Themes

| Theme | Finding IDs (representative) | Pattern | Affected Sessions |
|-------|------------------------------|---------|-------------------|
| **SQL Injection** | SHARED-BE-001, BE-002, BE-003 | 3 distinct injection vectors in shared backend; production source DBs and SQLite both exposed | Phase 0 (all sessions inherit) |
| **Mock/Fake Data** | SHARED-FE-003, ECT-MRI-002, ECT-MRI-003, ECT-NBC-001 | mockData.ts with fictional sources; MRI fabricates "AI Analysis" and "Flake Detection"; NotebookConfig ghost section | Phase 0, EC-TOOLS-DATA |
| **Silent Failure** | SHARED-FE-019, ENG-008-010, EC1-LMC-003/004, EC2-LOG-001, BPG-CANON-002 | 15+ paths where errors are swallowed -- user sees empty/success instead of failure | ALL 7 sessions |
| **No Auth / CORS** | SHARED-BE-004, BE-005, BPG-XCUT-002, BPG-XCUT-003, SSL-ADMIN-001 | Zero auth on API, CORS `*`, plaintext passwords, no CSRF -- entire security model depends on IIS reverse proxy | Phase 0, BP-GOLD, SETTINGS |
| **Missing Error Boundaries** | SHARED-FE-001, SHARED-FE-002 | No ErrorBoundary, no 404 route -- any uncaught error = white screen for all 55 pages | Phase 0 (all sessions inherit) |
| **Accessibility** | SHARED-FE-008, FE-009, FE-011 + every session has findings | Universal: zero `aria-label`, `aria-expanded`, `role="status"` across nearly all interactive elements. Only a few pages (ExecutionMatrix, LiveMonitor, RecordCounts) have been fixed. | ALL sessions |
| **State Management / Polling** | EC1-LC-001, EC1-LMC-008, EC1-OVR-002, EC2-LIVE-001, ECT-VALID-001, ECT-TS-002 | Unconditional polling with no tab-visibility check, no exponential backoff on error, polling storms (3 concurrent channels for same data) | EC-TIER1-OPS, EC-TIER2-MONITORING, EC-TOOLS-DATA |
| **Dead Code / Orphan Endpoints** | EC1-LMC-005, BPG orphaned 25 Gold endpoints, ECT-SV-005, SSL-SET-002 | Unused TypeScript interfaces, 25 orphan Gold Studio backend endpoints, dead state variables, duplicate deployment UIs | BP-GOLD, EC-TOOLS-DATA, SETTINGS |
| **Path Traversal** | ECT-MRI-001 | `runId` passed unsanitized into filesystem path -- 6 MRI endpoints affected | EC-TOOLS-DATA |
| **Performance** | SHARED-FE-004, BPG-CLUST-002, BPG-DET-003, ECT-DBX-002 | ~40 pages eagerly imported; N+1 query on clusters; full entity list scan for single lookup; COUNT(*) on every table per page load | Phase 0, BP-GOLD, EC-TOOLS-DATA |
| **Watermark / Dedup** | SHARED-ENG-003, ENG-004, ENG-010 | Pipeline mode never advances watermarks; double audit logging; swallowed watermark writes | Phase 0 (Engine) |
| **Manifest Inaccuracy** | SSL-LAB-001 through LAB-004, SSL-CROSS-004, GOV reclassifications | 4 Labs pages wrongly classified as stubs; 3 GOV pages wrongly classified as MOCK | SETTINGS-SETUP-LABS, GOV-MOCK-TRUTH |

---

## 7. Manifest Corrections

Phase 1 audits discovered the following reclassifications needed in `docs/AUDIT-SESSION-MANIFEST.md`:

### 7.1 MOCK -> REAL_WITH_GAPS (GOV-MOCK-TRUTH session)

| Surface | Old Classification | New Classification | Rationale |
|---------|-------------------|-------------------|-----------|
| GOV-002 DataClassification | MOCK | REAL_WITH_GAPS | All data from real queries. The `*15` multiplier was fixed 2026-03-23. Zeros shown when no scan has run -- honest empty state, not fabrication. |
| GOV-003 DataCatalog | MOCK | REAL_WITH_GAPS | Entirely driven by Entity Digest. Columns/Lineage tabs are honest stubs ("not available"), not fake data. Quality fields exist but are unpopulated. |
| GOV-004 ImpactAnalysis | MOCK | REAL_WITH_GAPS | Client-side `computeImpact()` is deterministic from real entity statuses. Gold hardcoded to `not_started` is a structural limitation, not fabrication. |

### 7.2 STUB -> FULL_IMPLEMENTATION (SETTINGS-SETUP-LABS session)

| Surface | Old Classification | New Classification | Lines | Backend |
|---------|-------------------|-------------------|-------|---------|
| LAB-001 CleansingRuleEditor | Coming Soon stub (~48 lines) | Full implementation | 900+ | `cleansing.py` (4 CRUD endpoints) |
| LAB-002 ScdAudit | Coming Soon stub (~48 lines) | Full implementation | 700+ | `scd_audit.py` (3 endpoints) |
| LAB-003 GoldMlvManager | Coming Soon stub (~48 lines) | Full implementation | 800+ | `gold.py` (3 endpoints) |
| LAB-004 DqScorecard | Coming Soon stub (~48 lines) | Full implementation | 700+ | `quality.py` (4 endpoints) |

### 7.3 Orphan Endpoint Discovery (BP-GOLD session)

25 Gold Studio backend endpoints have no frontend caller. See `AUDIT-BP-GOLD.md` Section "Orphaned Endpoints" for the full list and disposition recommendations.

---

## 8. Session Coverage Matrix

| Session | Surfaces Covered | Findings | CRIT | HIGH | Coverage Confidence |
|---------|-----------------|----------|------|------|---------------------|
| Phase 0: Shared Infrastructure | 50 files (33 FE, 8 BE, 9 Engine) | 80 | 5 | 18 | **High** -- line-by-line audit of every shared file |
| EC-TIER1-OPS | 6 pages (EngineControl, SourceManager, ConfigManager, LoadCenter, LoadMissionControl, BusinessOverview) | 33 | 0 | 3 | **High** -- 4 had prior audits verified + extended; 2 fresh |
| EC-TIER2-MONITORING | 12 pages (ExecutionMatrix, ControlPlane, ExecutionLog, ErrorIntelligence, FlowExplorer, RecordCounts, DataJourney, LiveMonitor, LoadProgress, ColumnEvolution, SankeyFlow, TransformationReplay) | 24 | 0 | 2 | **High** -- all 12 had prior audits; 42 findings verified fixed, 22 still present, 24 new |
| BP-GOLD | 11 pages + 2 shared components (6 Business Portal + 5 Gold Studio + GoldStudioLayout + SpecimenCard) | 41 | 2 | 5 | **High** -- full endpoint map of 71 Gold Studio routes; 25 orphans identified |
| EC-TOOLS-DATA | 15 pages (DataBlender, NotebookConfig, PipelineRunner, ValidationChecklist, NotebookDebug, SqlExplorer, DataProfiler, DataMicroscope, ImpactPulse, TestAudit, TestSwarm, MRI, DatabaseExplorer, DataManager, SchemaValidation) | 38 | 0 | 4 | **High** -- largest session; 1 fresh audit (SchemaValidation), 14 verify-and-extend |
| GOV-MOCK-TRUTH | 5 pages (DataLineage, DataClassification, DataCatalog, ImpactAnalysis, DataEstate) | 4 | 0 | 0 | **High** -- primary mission was truth audit (mock vs real); all 5 confirmed REAL or REAL_WITH_GAPS |
| SETTINGS-SETUP-LABS | 4 groups + 4 labs (AdminGateway, Settings, EnvironmentSetup, CleansingRuleEditor, ScdAudit, GoldMlvManager, DqScorecard) + 20+ sub-components | 19 | 0 | 8 | **High** -- 28 files audited; major manifest corrections discovered |

---

## 9. Phase 2 Readiness

Phase 2 (remediation) should prioritize in this order:

### Priority 1: Critical Security Fixes (immediate)

1. **SQL Injection** (SHARED-BE-001, BE-002, BE-003) -- 3 vectors in shared backend. Parameterize all queries in `schema_discovery.py` and `control_plane_db.py`. Estimated effort: 2-4 hours.
2. **Path Traversal** (ECT-MRI-001) -- Sanitize `runId` in `mri.py` using the `_safe_component()` pattern from `test_swarm.py`. Estimated effort: 30 minutes.
3. **ErrorBoundary + 404 Route** (SHARED-FE-001, FE-002) -- Add React ErrorBoundary wrapper in `App.tsx` and `<Route path="*" element={<NotFound />} />`. Estimated effort: 1 hour.

### Priority 2: Crash Prevention (week 1)

4. **Ghost endpoints** (BPG-DET-001, BPG-CLUST-001) -- Fix broken Gold Studio features: rename `/columns` to `/column-decisions` in GoldClusters; create or remove `/api/gold/models/{id}` for DatasetDetail.
5. **Missing endpoints** (EC2-CP-001, EC2-CP-002, SSL-SETUP-002) -- Implement or remove Maintenance Agent and provision-all features.
6. **Dead drill-down** (ECT-SV-001) -- Wire SchemaValidation expand to backend endpoints that already exist.

### Priority 3: Data Integrity (week 1-2)

7. **Watermark advancement** (SHARED-ENG-003) -- Pipeline mode must advance watermarks after successful extraction.
8. **Double audit logging** (SHARED-ENG-004) -- Remove duplicate `engine_task_log` write.
9. **Config validation** (SHARED-ENG-005) -- Make `_validate_config` raise on empty GUIDs, not just log.
10. **Run timeout enforcement** (SHARED-ENG-006) -- Actually check the computed timeout.

### Priority 4: Performance (week 2)

11. **Lazy loading** (SHARED-FE-004) -- Convert ~40 eager imports to `React.lazy()`. Major bundle size reduction.
12. **AbortController** (SHARED-FE-005) -- Add to all fetch hooks for proper cleanup on unmount.
13. **N+1 query** (BPG-CLUST-002) -- Add bulk cluster hydration endpoint or embed members in list response.
14. **Full-list scans** (BPG-DET-002, BPG-DET-003) -- Use single-entity endpoints in DatasetDetail.

### Priority 5: Auth / CORS Hardening (week 2-3)

15. **CORS restriction** (SHARED-BE-004) -- Replace `*` with specific allowed origins.
16. **Request body size limit** (SHARED-BE-008) -- Add `Content-Length` cap.
17. **Admin auth hardening** (SSL-ADMIN-001) -- Add rate limiting and session tokens.
18. **Labs route gating** (SSL-CROSS-001) -- Gate routes by feature flags, not just sidebar visibility.

### Priority 6: Accessibility (week 3-4)

19. Systematic pass through all 55 pages adding `aria-label`, `role`, `aria-expanded`, keyboard handlers. Best addressed via shared component library updates (button, input, select, table wrappers) rather than per-page.

### Priority 7: Mock Data Cleanup / Manifest Fixes (week 3-4)

20. **Remove or isolate `mockData.ts`** (SHARED-FE-003).
21. **Label MRI AI/flake tabs honestly** (ECT-MRI-002, ECT-MRI-003) -- "Generated Analysis" not "AI Analysis".
22. **Remove duplicate deployment wizard** (SSL-SET-002) -- Keep `DeploymentManager` with SSE; remove inline `DeployWizard` from Settings.
23. **Update manifest** with all corrections from Section 7.

### Priority 8: Deferred Cleanup (backlog)

24. Orphan Gold Studio endpoints (25) -- wire into frontend or remove.
25. Dead code removal (unused interfaces, never-called state variables).
26. Polling improvements (tab-visibility checks, exponential backoff).
27. Connection pooling for SQLite (SHARED-BE-006).

---

## Appendix: Source File Index

| Session | Audit File |
|---------|-----------|
| Phase 0 | `dashboard/app/audits/AUDIT-SHARED-INFRASTRUCTURE.md` |
| EC-TIER1-OPS | `dashboard/app/audits/AUDIT-EC-TIER1-OPS.md` |
| EC-TIER2-MONITORING | `dashboard/app/audits/AUDIT-EC-TIER2-MONITORING.md` |
| BP-GOLD | `dashboard/app/audits/AUDIT-BP-GOLD.md` |
| EC-TOOLS-DATA | `dashboard/app/audits/AUDIT-EC-TOOLS-DATA.md` |
| GOV-MOCK-TRUTH | `dashboard/app/audits/AUDIT-GOV-MOCK-TRUTH.md` |
| SETTINGS-SETUP-LABS | `dashboard/app/audits/AUDIT-SETTINGS-SETUP-LABS.md` |

### Detailed Report Locations (Phase 0 sub-units)

| Unit | Path |
|------|------|
| Frontend Shared | `docs/AUDIT-PHASE0-SHARED-FE-INFRASTRUCTURE.md` |
| Backend Shared | `docs/audits/AUDIT-PHASE0-SHARED-BACKEND.md` |
| Engine Shared | `docs/audits/PHASE0-SHARED-ENGINE-AUDIT.md` |

---

*V2 Whole-App Forensic Audit consolidation complete. 239 findings across 7 sessions, 55 pages, and 50 shared infrastructure files. Phase 2 remediation plan ready.*
