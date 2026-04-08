# V2 Whole-App Remediation -- Packet Index

**Generated**: 2026-04-08
**Source**: Phase 0 (Shared Infrastructure) + Phase 1 (6 session audits)
**Strategy**: Severity-first, dependency-aware, minimal blast radius

---

## Master Summary

| Packet | Priority | Title | Findings | Effort | Risk | Depends On |
|--------|----------|-------|----------|--------|------|------------|
| P0 | CRITICAL | SQL Injection Hardening | 3 | ~2h | HIGH | -- |
| P1 | CRITICAL | Path Traversal + Security Hardening | 3 | ~2h | HIGH | -- |
| P2 | CRITICAL | Crash Prevention (ErrorBoundary + 404) | 2 | ~1h | LOW | -- |
| P3 | CRITICAL | Ghost Endpoints + Broken API Calls | 7 | ~4h | MED | -- |
| P4 | HIGH | Auth, CORS + CSRF Hardening | 5 | ~4h | MED | P0 |
| P5 | HIGH | Data Contract Fixes (Type Mismatches) | 6 | ~3h | MED | -- |
| P6 | HIGH | Engine Watermark + Pipeline Integrity | 4 | ~4h | HIGH | -- |
| P7 | HIGH | Concurrency + Token Race Fixes | 5 | ~3h | MED | -- |
| P8 | HIGH | Duplicate Deployment UI Consolidation | 3 | ~2h | MED | -- |
| P9 | HIGH | Manifest Corrections + Feature Flag Gating | 5 | ~2h | LOW | -- |
| P10 | HIGH | N+1 Query + Performance Fixes | 4 | ~3h | MED | -- |
| P11 | MODERATE | Truth Bugs (Fabricated/Misleading Data) | 8 | ~4h | MED | -- |
| P12 | MODERATE | Silent Error Swallowing Remediation | 12 | ~4h | LOW | P2 |
| P13 | MODERATE | Polling Hardening (Backoff + Visibility) | 10 | ~3h | LOW | -- |
| P14 | MODERATE | Missing Feature Wiring (Orphaned Endpoints) | 8 | ~6h | MED | P3 |
| P15 | MODERATE | Stub/Dead Feature Cleanup | 8 | ~3h | LOW | -- |
| P16 | MODERATE | Optimistic Concurrency + Config Persistence | 4 | ~3h | MED | -- |
| P17 | MODERATE | Frontend Lazy Loading + Bundle Size | 1 | ~2h | LOW | -- |
| P18 | LOW | Accessibility Remediation (ARIA + Keyboard) | 14 | ~6h | LOW | -- |
| P19 | LOW | Design Token + CSS Cleanup | 6 | ~2h | LOW | -- |
| P20 | LOW | Dead Code + Unused Import Cleanup | 8 | ~2h | LOW | -- |
| P21 | INFO | Deferred / Documentation-Only Items | 16 | ~2h | LOW | -- |
| **TOTAL** | | | **142** | **~61h** | | |

---

## Packet P0: SQL Injection Hardening

**Priority**: P0 -- CRITICAL, MUST ship before any other remediation
**Findings**: SHARED-BE-001, SHARED-BE-002, SHARED-BE-003
**Files**: `dashboard/app/api/parsers/schema_discovery.py`, `dashboard/app/api/routes/control_plane_db.py`
**Effort**: ~2 hours
**Risk**: HIGH (production security -- RCE via xp_cmdshell, full SQLite injection)
**Approach**:
- SHARED-BE-001: Parameterize `preview_query()` -- replace `cur.execute(sql)` with parameterized query + read-only guard (prepend `SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; SET NOCOUNT ON;`, validate no DDL/DML keywords)
- SHARED-BE-002: Validate `limit` param as `int` before interpolation into `SET ROWCOUNT`
- SHARED-BE-003: Parameterize `bulk_seed()` -- use allowlist for table/column names against known schema, never interpolate dict keys directly
**Depends on**: Nothing
**Blocks**: P4 (security baseline must be established first)
**Test plan**:
- Attempt `'; DROP TABLE--` in preview_query SQL input
- Attempt non-integer limit values (`"1; DROP TABLE"`)
- Attempt dict keys with SQL metacharacters in bulk_seed
- Verify all existing legitimate queries still work
- Verify read-only guard rejects INSERT/UPDATE/DELETE/DROP

---

## Packet P1: Path Traversal + Security Hardening

**Priority**: P0 -- CRITICAL
**Findings**: ECT-MRI-001, ECT-SQLX-001, ECT-DBX-001
**Files**: `dashboard/app/api/routes/mri.py`, `dashboard/app/api/routes/sql_explorer.py`, `dashboard/app/api/routes/db_explorer.py`
**Effort**: ~2 hours
**Risk**: HIGH (filesystem traversal in MRI, server validation bypass in SqlExplorer)
**Approach**:
- ECT-MRI-001: Add `_safe_component()` validation (same pattern as `test_swarm.py`) to sanitize `runId` in `_load_run_file()`. Apply to all 6 affected endpoints (convergence, visual-diffs, backend-results, ai-analyses, flake-results, iteration)
- ECT-SQLX-001: Add `.strip()` check on server names in `_validate_server()` -- reject empty-after-strip values
- ECT-DBX-001: Reject queries containing `;` in `execute_query()` to prevent stacked-statement attempts
**Depends on**: Nothing
**Blocks**: Nothing
**Test plan**:
- Attempt `../../etc/passwd` as MRI runId
- Attempt whitespace-only server name in SqlExplorer
- Attempt `SELECT 1; DROP TABLE` in DatabaseExplorer query endpoint
- Verify legitimate runIds, server names, and single-statement queries still work

---

## Packet P2: Crash Prevention (ErrorBoundary + 404)

**Priority**: P1 -- CRITICAL stability
**Findings**: SHARED-FE-001, SHARED-FE-002
**Files**: `dashboard/app/src/App.tsx`, new `dashboard/app/src/components/ErrorBoundary.tsx`
**Effort**: ~1 hour
**Risk**: LOW (additive, no behavior change for working paths)
**Approach**:
- SHARED-FE-001: Create React ErrorBoundary component with `componentDidCatch`, wrap entire route tree. Show friendly "Something went wrong" with reload button
- SHARED-FE-002: Add `<Route path="*" element={<NotFound />} />` catch-all with friendly 404 page
**Depends on**: Nothing
**Blocks**: P12 (error handling improvements build on crash prevention)
**Test plan**:
- Force a runtime error in any page component -- verify ErrorBoundary catches it
- Navigate to `/nonexistent-route` -- verify 404 page renders
- Verify all existing routes still render correctly

---

## Packet P3: Ghost Endpoints + Broken API Calls

**Priority**: P1 -- CRITICAL (features silently non-functional)
**Findings**: BPG-DET-001, BPG-CLUST-001, BPG-CLUST-003, EC2-CP-001, EC2-CP-002, SSL-SETUP-002, EC1-ENG-002
**Files**: `DatasetDetail.tsx`, `GoldClusters.tsx`, `ControlPlane.tsx`, `ProvisionAll.tsx`, `EngineControl.tsx`, various backend route files
**Effort**: ~4 hours
**Risk**: MEDIUM (features currently broken, fixes restore intended behavior)
**Approach**:
- BPG-DET-001: Either create `GET /api/gold/models/{id}` endpoint or remove the Gold Model panel from DatasetDetail
- BPG-CLUST-001: Fix fetch path from `/clusters/{id}/columns` to `/clusters/{id}/column-decisions` -- single string change
- BPG-CLUST-003: Either add `PUT /api/gold-studio/entities/{id}` backend route or use the correct existing endpoint for canonicalization
- EC2-CP-001: Create `POST /api/entity-digest/resync` endpoint in entities.py or remove the maintenance agent feature
- EC2-CP-002: Create `POST /api/maintenance-agent/trigger` endpoint or remove the maintenance agent button
- SSL-SETUP-002: Locate or create `POST /api/setup/provision-all` endpoint -- verify it exists in a route file other than admin.py, or create it
- EC1-ENG-002: Remove dead `/api/engine/jobs` polling call from EngineControl since SSE fallback works
**Depends on**: Nothing
**Blocks**: P14 (orphaned endpoint wiring depends on ghost endpoint resolution)
**Test plan**:
- Verify GoldClusters column reconciliation slide-over loads column data
- Verify DatasetDetail Gold Model panel either shows data or is cleanly removed
- Verify ControlPlane maintenance agent either works or is removed
- Verify ProvisionAll provision flow completes successfully
- Verify EngineControl no longer polls non-existent endpoint

---

## Packet P4: Auth, CORS + CSRF Hardening

**Priority**: P2 -- HIGH security
**Findings**: SHARED-BE-004, SHARED-BE-005, SHARED-FE-006, BPG-XCUT-002, BPG-XCUT-003
**Files**: `dashboard/app/api/server.py`, `dashboard/app/api/router.py`, `dashboard/app/src/lib/pageVisibility.ts`
**Effort**: ~4 hours
**Risk**: MEDIUM (security improvements, must not break IIS reverse proxy flow)
**Approach**:
- SHARED-BE-004: Replace `CORS *` with allowlist of known origins (localhost, vsc-fabric, IIS proxy address)
- SHARED-BE-005: Add middleware to validate `X-Forwarded-For` or Windows auth header from IIS, reject requests without proxy headers
- SHARED-FE-006: Remove plaintext password transmission from pageVisibility.ts, use the admin auth pattern instead
- BPG-XCUT-002: Add CSRF token generation/validation for all mutation (POST/PUT/DELETE) endpoints
- BPG-XCUT-003: Document the security model (IIS + VPN dependency) and add defense-in-depth auth check
**Depends on**: P0 (SQL injection must be fixed before auth, as auth bypass + injection = catastrophic)
**Blocks**: Nothing
**Test plan**:
- Verify cross-origin requests from unauthorized origins are rejected
- Verify IIS reverse proxy requests still work
- Verify CSRF tokens are generated and validated on mutations
- Verify admin password is no longer sent in plaintext via pageVisibility

---

## Packet P5: Data Contract Fixes (Type Mismatches)

**Priority**: P2 -- HIGH data integrity
**Findings**: EC1-ENG-001, EC1-SRC-001, EC1-SRC-002, EC1-CFG-001, EC2-LP-001, EC2-SV-002
**Files**: `EngineControl.tsx`, `control_plane.py`, `source_manager.py`, `config_manager.py`, `LoadProgress.tsx`, `schema_validation.py`
**Effort**: ~3 hours
**Risk**: MEDIUM (type fixes may change frontend display behavior)
**Approach**:
- EC1-ENG-001: Fix `MetricsData.layers` type to match backend array response, or normalize in a typed adapter
- EC1-SRC-001: Add `ConnectionGuid` to `get_connections()` SELECT in control_plane.py
- EC1-SRC-002: Add `entity_status` JOIN to load config query for `lastLoadTime`/`lastWatermarkValue`
- EC1-CFG-001: Fix pipeline GUID update to write `PipelineGuid` (TEXT) not `PipelineId` (INTEGER PK)
- EC2-LP-001: Fix `adaptApiResponse()` to use current-run success status, not historical any-ever-succeeded
- EC2-SV-002: Fix coverage `SELECT DISTINCT` to include `schema_name` in GROUP BY for deterministic results
**Depends on**: Nothing
**Blocks**: Nothing
**Test plan**:
- Verify EngineControl metrics display renders correctly with real backend data
- Verify SourceManager isRegistered matching works with ConnectionGuid present
- Verify Load Config matrix shows lastLoadTime and watermark values
- Verify ConfigManager pipeline GUID updates write to correct column
- Verify LoadProgress loaded count reflects current state, not historical
- Verify SchemaValidation coverage shows deterministic schema names

---

## Packet P6: Engine Watermark + Pipeline Integrity

**Priority**: P2 -- HIGH data integrity
**Findings**: SHARED-ENG-003, SHARED-ENG-004, SHARED-ENG-005, ECT-RUN-001
**Files**: `engine/pipeline_runner.py`, `engine/orchestrator.py`, `dashboard/app/api/routes/pipeline.py`
**Effort**: ~4 hours
**Risk**: HIGH (changes affect data pipeline correctness)
**Approach**:
- SHARED-ENG-003: Fix pipeline mode to advance watermarks after successful extraction (critical for incremental loads)
- SHARED-ENG-004: Remove double audit logging -- deduplicate `engine_task_log` writes for successful entities
- SHARED-ENG-005: Make `_validate_config` raise on empty GUIDs instead of logging and continuing
- ECT-RUN-001: Either implement real entity deactivation in `post_runner_prepare()` or remove the deactivated/affected counts from the response to stop lying about scoping
**Depends on**: Nothing
**Blocks**: Nothing
**Test plan**:
- Run incremental load twice -- verify second run only extracts new records (watermark advanced)
- Check engine_task_log after a run -- verify no duplicate success entries per entity
- Start engine with empty GUIDs -- verify it fails fast with clear error
- Verify PipelineRunner prepare response accurately reflects what actually happened

---

## Packet P7: Concurrency + Token Race Fixes

**Priority**: P2 -- HIGH reliability
**Findings**: SHARED-ENG-001, SHARED-ENG-002, SHARED-ENG-006, SHARED-BE-006, ECT-RUN-003
**Files**: `engine/auth.py`, `engine/orchestrator.py`, `dashboard/app/api/db.py`, `dashboard/app/api/routes/pipeline.py`
**Effort**: ~3 hours
**Risk**: MEDIUM (threading changes require careful testing)
**Approach**:
- SHARED-ENG-001: Hold lock through entire token check+fetch cycle to prevent redundant AAD calls
- SHARED-ENG-002: Add lock around `_OneLakeCredential` cache reads to prevent data races with Azure SDK
- SHARED-ENG-006: Enforce `run_timeout_seconds` -- add periodic check in orchestrator main loop
- SHARED-BE-006: Add SQLite connection pooling (e.g., `sqlite3` with `check_same_thread=False` and a connection pool wrapper)
- ECT-RUN-003: Move `_runner_state.get("active")` check inside the lock in `post_runner_trigger`
**Depends on**: Nothing
**Blocks**: Nothing
**Test plan**:
- Run concurrent engine tasks -- verify no duplicate token fetches in logs
- Verify OneLake credential reads are thread-safe under concurrent access
- Set short timeout, run long job -- verify it terminates at timeout
- Load test API with concurrent requests -- verify no SQLite locking errors
- Trigger prepare + trigger concurrently -- verify no race condition

---

## Packet P8: Duplicate Deployment UI Consolidation

**Priority**: P2 -- HIGH (architectural debt)
**Findings**: SSL-SET-002, SSL-CROSS-003, SSL-SET-004
**Files**: `dashboard/app/src/pages/Settings.tsx`, `dashboard/app/src/components/settings/DeploymentManager.tsx`
**Effort**: ~2 hours
**Risk**: MEDIUM (removing code, must verify no unique functionality lost)
**Approach**:
- SSL-SET-002 + SSL-CROSS-003: Remove the inline `DeployWizard` from Settings.tsx (~500 lines). Replace with a link/button that navigates to Admin > Deployment tab where `DeploymentManager.tsx` (the mature implementation with SSE, resume, dry-run, cancel) lives
- SSL-SET-004: Removed as consequence of above -- the time-simulated progress is eliminated
**Depends on**: Nothing
**Blocks**: Nothing
**Test plan**:
- Verify Settings page no longer has inline deploy wizard
- Verify Admin > Deployment tab still works with full SSE deployment flow
- Verify the redirect/link from Settings to Admin > Deployment works

---

## Packet P9: Manifest Corrections + Feature Flag Gating

**Priority**: P2 -- HIGH (manifest accuracy + security)
**Findings**: SSL-LAB-001, SSL-LAB-002, SSL-LAB-003, SSL-LAB-004, SSL-CROSS-001
**Files**: `docs/AUDIT-SESSION-MANIFEST.md`, `dashboard/app/src/App.tsx`, `dashboard/app/src/lib/featureFlags.ts`
**Effort**: ~2 hours
**Risk**: LOW (manifest is documentation, route gating is additive)
**Approach**:
- SSL-LAB-001 through SSL-LAB-004 + SSL-CROSS-004: Correct manifest entries for CleansingRuleEditor (~900 lines), ScdAudit (~700 lines), GoldMlvManager (~800 lines), DqScorecard (~700 lines) -- all are full implementations, not stubs
- SSL-CROSS-001: Wrap lab routes in App.tsx with feature flag checks. If flag is disabled, render a "Feature not enabled" component instead of the page. Prevents direct URL access to ungated labs
**Depends on**: Nothing
**Blocks**: Nothing
**Test plan**:
- Verify manifest accurately describes all 4 labs pages
- With flags disabled, navigate to `/labs/cleansing` directly -- verify blocked
- With flags enabled, verify all 4 labs pages still load

---

## Packet P10: N+1 Query + Performance Fixes

**Priority**: P2 -- HIGH performance
**Findings**: BPG-DET-002, BPG-DET-003, BPG-CLUST-002, ECT-DBX-002
**Files**: `DatasetDetail.tsx`, `GoldClusters.tsx`, `dashboard/app/api/routes/db_explorer.py`
**Effort**: ~3 hours
**Risk**: MEDIUM (query changes, must verify no data loss)
**Approach**:
- BPG-DET-002: Replace full `/api/mdm/quality/scores` fetch with `GET /api/quality/score/{entityId}` single-entity endpoint
- BPG-DET-003: Replace full `/api/overview/entities` scan with a dedicated single-entity lookup endpoint or add `?entity_id=N` filter
- BPG-CLUST-002: Replace N+1 per-cluster hydration (200+ sequential requests) with a bulk endpoint or embed members in list response
- ECT-DBX-002: Add caching for `SELECT COUNT(*)` per table in DatabaseExplorer -- counts are expensive on large tables, cache for 60 seconds
**Depends on**: Nothing
**Blocks**: Nothing
**Test plan**:
- Verify DatasetDetail loads single entity quality score correctly
- Verify DatasetDetail entity lookup works by ID without scanning all 1,666
- Verify GoldClusters loads in <2 seconds instead of making 200+ requests
- Verify DatabaseExplorer table list loads in <1 second with count caching

---

## Packet P11: Truth Bugs (Fabricated/Misleading Data)

**Priority**: P3 -- MODERATE data integrity
**Findings**: EC2-DJ-001, EC2-SANK-002, ECT-MICRO-001, ECT-MRI-002, ECT-MRI-003, ECT-NBC-001, ECT-RUN-002, ECT-SV-001
**Files**: `monitoring.py`, `SankeyFlow.tsx`, `DataMicroscope.tsx`, `mri.py`, `NotebookConfig.tsx`, `pipeline.py`, `SchemaValidation.tsx`
**Effort**: ~4 hours
**Risk**: MEDIUM (changing displayed data, must verify accuracy)
**Approach**:
- EC2-DJ-001: Remove `"dbo"` default for null schemas in journey endpoint -- show em-dash or "unknown" instead
- EC2-SANK-002: Add label distinction "Registered" vs "Physically Present" on Sankey node counts
- ECT-MICRO-001: Relabel transformation steps as "Expected Transformations" not "Applied Transformations"
- ECT-MRI-002: Relabel "AI Analysis" tab as "Analysis Summary" and add "(auto-generated from visual diffs)" disclaimer
- ECT-MRI-003: Relabel "Flake Detection" tab as "Estimated Stability" and add "(synthetic, based on name patterns)" disclaimer
- ECT-NBC-001: Hide "Template Mapping" section when empty, or show "Not yet implemented" banner
- ECT-RUN-002: Make `post_runner_restore()` return honest response -- either implement real restore or return `{"restored": "no-op", "reason": "entity scoping not implemented"}`
- ECT-SV-001: Wire drill-down to existing `/api/schema-validation/entity/{entity_id}` endpoint, or remove expand chevrons
**Depends on**: Nothing
**Blocks**: Nothing
**Test plan**:
- Verify DataJourney shows "unknown" for null schemas, not "dbo"
- Verify SankeyFlow labels indicate registered vs physical counts
- Verify Microscope shows "Expected" prefix on transformation descriptions
- Verify MRI tabs have honesty disclaimers
- Verify SchemaValidation drill-down either works or chevrons are removed

---

## Packet P12: Silent Error Swallowing Remediation

**Priority**: P3 -- MODERATE reliability
**Findings**: EC1-LMC-003, EC1-LMC-004, EC1-SRC-007, EC1-LC-002, EC1-OVR-001, EC2-LOG-001, EC2-COL-001, BPG-CANON-002, BPG-SHARED-001, BPG-SPEC-004, BPG-LED-003, ECT-PULSE-001
**Files**: Multiple TSX files across the dashboard
**Effort**: ~4 hours
**Risk**: LOW (additive error feedback, no behavior change for success paths)
**Approach**:
- EC1-LMC-003: Add toast/banner feedback on `handleStart` failure
- EC1-LMC-004: Add error feedback on `handleStop`, `handleRetry`, `handleResume` failures
- EC1-SRC-007: Show warning in delete dialog when cascade impact fetch fails
- EC1-LC-002: Show actionable error detail on run execution failure (parse response body)
- EC1-OVR-001: Add partial failure indicator when 1-2 of 3 endpoints fail in BusinessOverview
- EC2-LOG-001: Add per-tab error indicator when individual ExecutionLog endpoints fail
- EC2-COL-001: Distinguish "no data cached" vs "OneLake unreachable" in ColumnEvolution error message
- BPG-CANON-002: Show error indicator when fetchJson returns null for semantic measures
- BPG-SHARED-001: Show subtle error indicator when GoldStudioLayout domain fetch fails
- BPG-SPEC-004: Show "stats unavailable" when stats fetch fails instead of showing zeros
- BPG-LED-003: Add toast notification when post-create extraction fails
- ECT-PULSE-001: Show subtle "live data unavailable" indicator when live-monitor fetch fails
**Depends on**: P2 (ErrorBoundary provides safety net for error handling changes)
**Blocks**: Nothing
**Test plan**:
- For each finding: simulate backend failure (return 500), verify user sees feedback
- Verify success paths are unaffected by new error handling code

---

## Packet P13: Polling Hardening (Backoff + Visibility)

**Priority**: P3 -- MODERATE performance
**Findings**: EC1-LC-001, EC1-LC-006, EC1-LMC-008, EC1-OVR-002, EC2-RC-001, EC2-LIVE-001, ECT-VALID-001, ECT-TS-002, BPG-ALERT-006, SHARED-ENG-012
**Files**: Multiple TSX files, `engine/pipeline_runner.py`
**Effort**: ~3 hours
**Risk**: LOW (defensive improvements, no behavior change for normal operation)
**Approach**:
- Create shared `useSmartPolling` hook that: (a) pauses when `document.visibilityState === "hidden"`, (b) uses exponential backoff on consecutive errors, (c) accepts max retry count
- Apply to: LoadCenter (5s), LoadMissionControl (3s+3s+SSE), BusinessOverview (30s), RecordCounts (3s scan poll), LiveMonitor (variable), ValidationChecklist (15s), TestSwarm (15s), BusinessAlerts (30s)
- EC1-LC-006: Add max retry/timeout to refresh polling loop
- EC1-LMC-008: Consolidate triple data channels (useProgress + useEngineStatus + SSE) into single SSE-first approach
- EC2-LIVE-001: Document HTTP polling as intentional or migrate to SSE
- SHARED-ENG-012: Add early termination on 401 errors in pipeline poll (currently burns 2 hours)
**Depends on**: Nothing
**Blocks**: Nothing
**Test plan**:
- Switch tab to background -- verify polling stops
- Simulate backend errors -- verify backoff increases interval
- Verify polling resumes at normal rate when backend recovers

---

## Packet P14: Missing Feature Wiring (Orphaned Endpoints)

**Priority**: P3 -- MODERATE completeness
**Findings**: EC1-LMC-001, EC1-LMC-002, EC1-LMC-006, BPG-REQ-002, BPG-SPEC-003, BPG-ALERT-001, BPG-ALERT-002, EC2-SV-003
**Files**: `LMC.tsx`, `BusinessRequests.tsx`, `GoldSpecs.tsx`, `BusinessAlerts.tsx`, `SchemaValidation.tsx`
**Effort**: ~6 hours
**Risk**: MEDIUM (new feature wiring, requires integration testing)
**Approach**:
- EC1-LMC-001: Wire entity history drill-down to existing `GET /api/lmc/entity/{id}/history` endpoint
- EC1-LMC-002: Wire run detail panel to existing `GET /api/lmc/run/{run_id}` rich detail endpoint
- EC1-LMC-006: Add "Refresh Inventory" button that calls `/api/load-center/refresh`
- BPG-REQ-002: Wire admin workflow UI to existing `PATCH /api/requests/{id}` endpoint
- BPG-SPEC-003: Wire Columns and Transforms tabs to backend data (or add JOIN to specs detail endpoint)
- BPG-ALERT-001: Expose `freshness_hours` query param in UI -- add configurable SLA threshold
- BPG-ALERT-002: Add failure-type alerts -- surface recently-failed entities to business users
- EC2-SV-003: Fix divergent coverage percentage calculation between summary and coverage endpoints
**Depends on**: P3 (ghost endpoints must be resolved first)
**Blocks**: Nothing
**Test plan**:
- Verify LMC entity history shows run-over-run data
- Verify LMC run detail panel shows layerSource, failures, timeline
- Verify business requests admin workflow allows status updates
- Verify GoldSpecs Columns/Transforms tabs show data when available

---

## Packet P15: Stub/Dead Feature Cleanup

**Priority**: P3 -- MODERATE code hygiene
**Findings**: ECT-BLEND-001, EC2-LP-002, EC2-DJ-002, EC1-CFG-002, SSL-SET-001, SSL-ADMIN-004, SSL-CROSS-002, SSL-CROSS-005
**Files**: `DataBlender.tsx`, `LoadProgress.tsx`, `DataJourney.tsx`, `ConfigManager.tsx`, `Settings.tsx`, `AdminGateway.tsx`, `EnvironmentSetup.tsx`
**Effort**: ~3 hours
**Risk**: LOW (removing dead code, no functional impact)
**Approach**:
- ECT-BLEND-001: Hide BlendSuggestions and BlendPreview tabs or replace with honest "coming soon" message
- EC2-LP-002: Remove or hide the 3 permanently-empty tabs (Live Activity, All Entities, Concurrency Timeline)
- EC2-DJ-002: Add TODO comment on gold section placeholder for when Gold is built
- EC1-CFG-002: Remove dead DeployResult interface and deploy UI scaffolding from ConfigManager
- SSL-SET-001: Extract DeployWizard and Labs sections from Settings.tsx into separate components (after P8 removes the wizard)
- SSL-ADMIN-004: Auto-derive ALL_PAGES from router instead of manual maintenance (or add a build-time validation check)
- SSL-CROSS-002: Document component ownership (GeneralTab lives in Settings, SetupSettings lives in Setup) and add comments
- SSL-CROSS-005: Add auto-save on wizard completion or explicit "Save Configuration" button
**Depends on**: Nothing
**Blocks**: Nothing
**Test plan**:
- Verify DataBlender no longer shows empty stub tabs
- Verify LoadProgress only shows tabs that have data
- Verify ConfigManager has no dead deploy UI
- Verify Settings.tsx is leaner after extraction
- Verify Setup wizard saves config on completion

---

## Packet P16: Optimistic Concurrency + Config Persistence

**Priority**: P3 -- MODERATE data integrity
**Findings**: BPG-CANON-004, BPG-VALID-003, BPG-XCUT-004, SSL-SETUP-003
**Files**: `GoldCanonical.tsx`, `GoldValidation.tsx`, multiple Gold pages, `EnvironmentSetup.tsx`
**Effort**: ~3 hours
**Risk**: MEDIUM (adding version checking may surface conflicts users haven't seen before)
**Approach**:
- BPG-CANON-004: Pass `expected_version` parameter on approve and generate-spec calls in GoldCanonical
- BPG-VALID-003: Add confirmation dialog before `POST /catalog/specs/{id}/publish`
- BPG-XCUT-004: Audit all Gold Studio PUT/POST mutations -- add `expected_version` where backend supports it
- SSL-SETUP-003: Add explicit save mechanism or auto-save on wizard step completion
**Depends on**: Nothing
**Blocks**: Nothing
**Test plan**:
- Open same canonical entity in two tabs, approve in one, attempt approve in other -- verify conflict detected
- Verify publish confirmation dialog appears and requires explicit confirmation
- Verify Setup wizard config persists after completion and page navigation

---

## Packet P17: Frontend Lazy Loading + Bundle Size

**Priority**: P3 -- MODERATE performance
**Findings**: SHARED-FE-004
**Files**: `dashboard/app/src/App.tsx`
**Effort**: ~2 hours
**Risk**: LOW (additive, only changes import strategy)
**Approach**:
- SHARED-FE-004: Convert ~40 eagerly imported pages to `React.lazy()` with `Suspense` wrappers. Currently only 9 pages are lazy-loaded. This reduces initial bundle size significantly for a 55-page app.
**Depends on**: Nothing
**Blocks**: Nothing
**Test plan**:
- Verify all pages still load correctly with lazy imports
- Measure bundle size before/after -- expect significant reduction
- Verify loading spinners appear during lazy chunk fetching

---

## Packet P18: Accessibility Remediation (ARIA + Keyboard)

**Priority**: P4 -- LOW
**Findings**: SHARED-FE-008, SHARED-FE-009, SHARED-FE-011, EC1-ENG-003, EC1-SRC-006, EC1-CFG-004, EC1-LC-004, EC1-OVR-003, EC1-LMC-009, BPG-ALERT-005, BPG-SHARED-004, BPG-SHARED-005, ECT-DBX-003, ECT-SV-004
**Files**: `AppLayout.tsx`, plus page-specific files across the app
**Effort**: ~6 hours
**Risk**: LOW (additive attributes, no behavioral change)
**Approach**:
- SHARED-FE-008: Add `aria-current="page"` and `role="navigation"` to sidebar nav
- SHARED-FE-009: Add focus trap to mobile overlay, add keyboard parity
- SHARED-FE-011: Replace persona toggle `<span>` with `<button>`
- Page-specific: Add `aria-label` to all interactive buttons, `aria-expanded` to collapsible sections, `role="status"` to loading indicators, `scope="col"` to table headers, focus management for dialogs
- BPG-SHARED-004: Add `role="status"` and `aria-live="polite"` to GoldLoading, GoldEmpty, GoldNoResults, GoldError
- BPG-SHARED-005: Add `role="dialog"`, `aria-modal`, verify Escape dismissal on SlideOver
- EC2-COL-002: Add keyboard-accessible pause control for auto-play animation
**Depends on**: Nothing
**Blocks**: Nothing
**Test plan**:
- Screen reader testing with NVDA/JAWS on key flows
- Keyboard-only navigation through all interactive elements
- Verify focus trap works on mobile overlay and modals

---

## Packet P19: Design Token + CSS Cleanup

**Priority**: P4 -- LOW
**Findings**: SHARED-FE-007, SHARED-FE-014, SHARED-FE-016, SHARED-FE-017, GOV-EST-013, BPG-SRC-003
**Files**: `dashboard/app/src/index.css`, `dashboard/app/src/data/layers.ts`, `GovernancePanel.tsx`, `BusinessSources.tsx`
**Effort**: ~2 hours
**Risk**: LOW (visual-only changes)
**Approach**:
- SHARED-FE-007: Differentiate `.dark` theme CSS from `:root` (currently identical)
- SHARED-FE-014: Define `--bp-copper` CSS variable before it is referenced by focus ring
- SHARED-FE-016: Consolidate dual color systems (hardcoded layers.ts vs API useSourceConfig)
- SHARED-FE-017: Define `--bp-surface-2` CSS variable
- GOV-EST-013: Replace hardcoded hex colors in GovernancePanel sensitivity bar with design tokens
- BPG-SRC-003: Replace `rgba(185, 58, 42, 0.2)` with `var(--bp-fault)` in error banner border
**Depends on**: Nothing
**Blocks**: Nothing
**Test plan**:
- Visual regression check -- all pages should look identical after token substitution
- Toggle dark mode -- verify it produces a visually distinct theme
- Verify no undefined CSS variables in browser DevTools

---

## Packet P20: Dead Code + Unused Import Cleanup

**Priority**: P4 -- LOW
**Findings**: EC1-LMC-005, EC1-LMC-007, EC1-OVR-004, EC1-OVR-005, ECT-SV-005, EC2-LIVE-002, ECT-BLEND-002, ECT-DM-003
**Files**: Various TSX and Python files
**Effort**: ~2 hours
**Risk**: LOW (removing unused code, no functional impact)
**Approach**:
- EC1-LMC-005: Remove unused `RunDetailResponse` interface from LMC.tsx
- EC1-LMC-007: Document architectural note -- 3,463-line file should be split in future refactor (not this packet)
- EC1-OVR-004: Remove unused `freshness_ever_loaded`/`freshness_last_success` computation from overview.py, or wire into UI
- EC1-OVR-005: Remove orphaned `GET /api/overview/entities` endpoint from overview.py, or document its purpose
- ECT-SV-005: Remove unused `RunResults` interface and `recentResults` state from SchemaValidation.tsx
- EC2-LIVE-002: Remove unused `refreshCount` state from LiveMonitor
- ECT-BLEND-002: Rename `blenderMockData` to `blenderConfig` (file contains real config, not mock data)
- ECT-DM-003: Replace hardcoded `ENTITY_TABLES` set with dynamic lookup
**Depends on**: Nothing
**Blocks**: Nothing
**Test plan**:
- Verify no TypeScript compilation errors after removing dead code
- Verify no runtime errors on affected pages

---

## Packet P21: Deferred / Documentation-Only Items

**Priority**: P5 -- INFO (backlog, no immediate action required)
**Findings**: SHARED-FE-003, SHARED-FE-010, SHARED-FE-012, SHARED-FE-013, SHARED-FE-015, SHARED-FE-018, SHARED-FE-019, SHARED-BE-008 through SHARED-BE-017, SHARED-ENG-007 through SHARED-ENG-015, BPG-ALERT-003, BPG-ALERT-004, BPG-ALERT-006, BPG-ALERT-007, BPG-CAT-004, BPG-CAT-005, BPG-HELP-002, BPG-HELP-003, BPG-SHARED-002, BPG-SHARED-003, BPG-LED-002, BPG-LED-004, BPG-CLUST-004, BPG-CLUST-005, BPG-CANON-003, BPG-REQ-003, BPG-REQ-004, BPG-VALID-004, BPG-VALID-005, BPG-DET-004, BPG-DET-005, BPG-CAT-003, EC1-ENG-004, EC1-ENG-005, EC1-SRC-003, EC1-SRC-004, EC1-SRC-005, EC1-LC-003, EC1-LC-005, EC2-MAT-001, EC2-MAT-002, EC2-LOG-002, EC2-ERR-001, EC2-ERR-002, EC2-FLOW-001, EC2-FLOW-002, EC2-RC-002, EC2-LP-002, EC2-SANK-001, EC2-REPLAY-001, EC2-REPLAY-002, ECT-BLEND-003, ECT-VALID-002, ECT-PROF-001, ECT-PROF-002, ECT-MICRO-002, ECT-MICRO-003, ECT-PULSE-002, ECT-TA-002, ECT-TS-001, ECT-MRI-004, ECT-DBX-004, ECT-DM-001, ECT-DM-002, ECT-NBD-002, ECT-NBD-003, ECT-NBC-003, ECT-SQLX-003, SSL-ADMIN-002, SSL-ADMIN-003, SSL-ADMIN-005, SSL-SET-003, SSL-SET-005, GOV-LIN-004, GOV-LIN-006, GOV-LIN-007, GOV-IMP-005, GOV-CAT-004 through GOV-CAT-010, GOV-EST-012, GOV-EST-014, GOV-EST-015, EC1-CFG-003, EC1-CFG-005, ECT-SV-006, BPG-VALID-001, ECT-NBD-001, ECT-TA-001, ECT-SQLX-002, BPG-SPEC-002, BPG-XCUT-001, EC2-CP-003, EC2-CP-004
**Effort**: ~2 hours (documentation pass)
**Risk**: LOW
**Approach**:
- Create a backlog tracking document for items deferred beyond V2
- Group by theme: mock data cleanup (SHARED-FE-003), request body limits (SHARED-BE-008), silent failure patterns (SHARED-ENG-008-015), cosmetic improvements, feature gaps, minor security hardening
- Items from GOV-MOCK-TRUTH session that require reclassification from MOCK to REAL_WITH_GAPS
- Lab page findings (ECT-NBD-001 maxEntities validation, ECT-TA-001 orphan process tracking) as backlog items
- Gold Studio orphaned endpoints (25 total from BPG-GOLD audit) to be wired or removed in future Gold Studio packet

---

## Dependency Graph

```
P0 (SQL Injection) ──────> P4 (Auth/CORS/CSRF)
P2 (ErrorBoundary) ──────> P12 (Error Swallowing)
P3 (Ghost Endpoints) ────> P14 (Orphaned Endpoint Wiring)

All others are independent and can execute in parallel.
```

## Execution Phases

| Phase | Packets | Focus | Total Effort |
|-------|---------|-------|-------------|
| **Phase A: Security** | P0, P1, P2 | SQL injection, path traversal, crash prevention | ~5h |
| **Phase B: Integrity** | P3, P5, P6 | Broken endpoints, data contracts, watermarks | ~11h |
| **Phase C: Hardening** | P4, P7, P8, P9, P10 | Auth, concurrency, dedup, perf | ~14h |
| **Phase D: Quality** | P11, P12, P13, P14, P15, P16, P17 | Truth, errors, polling, features, stubs | ~25h |
| **Phase E: Polish** | P18, P19, P20, P21 | Accessibility, CSS, dead code, docs | ~12h |

---

## Finding Cross-Reference (All 142 Findings)

Every finding from all 7 audit files is assigned to exactly one packet below.

### Phase 0: Shared Infrastructure (80 findings)

| Finding ID | Severity | Packet |
|-----------|----------|--------|
| SHARED-BE-001 | CRITICAL | P0 |
| SHARED-BE-002 | CRITICAL | P0 |
| SHARED-BE-003 | CRITICAL | P0 |
| SHARED-FE-001 | CRITICAL | P2 |
| SHARED-FE-002 | CRITICAL | P2 |
| SHARED-FE-003 | HIGH | P21 |
| SHARED-FE-004 | HIGH | P17 |
| SHARED-FE-005 | HIGH | P13 |
| SHARED-FE-006 | HIGH | P4 |
| SHARED-FE-007 | HIGH | P19 |
| SHARED-FE-008 | HIGH | P18 |
| SHARED-FE-009 | HIGH | P18 |
| SHARED-BE-004 | HIGH | P4 |
| SHARED-BE-005 | HIGH | P4 |
| SHARED-BE-006 | HIGH | P7 |
| SHARED-BE-007 | HIGH | P21 |
| SHARED-BE-008 | HIGH | P21 |
| SHARED-ENG-001 | HIGH | P7 |
| SHARED-ENG-002 | HIGH | P7 |
| SHARED-ENG-003 | HIGH | P6 |
| SHARED-ENG-004 | HIGH | P6 |
| SHARED-ENG-005 | HIGH | P6 |
| SHARED-ENG-006 | HIGH | P7 |
| SHARED-FE-010 | MODERATE | P21 |
| SHARED-FE-011 | MODERATE | P18 |
| SHARED-FE-012 | MODERATE | P21 |
| SHARED-FE-013 | MODERATE | P21 |
| SHARED-FE-014 | MODERATE | P19 |
| SHARED-FE-015 | MODERATE | P21 |
| SHARED-FE-016 | MODERATE | P19 |
| SHARED-FE-017 | MODERATE | P19 |
| SHARED-FE-018 | MODERATE | P21 |
| SHARED-FE-019 | MODERATE | P21 |
| SHARED-BE-009 | MODERATE | P21 |
| SHARED-BE-010 | MODERATE | P21 |
| SHARED-BE-011 | MODERATE | P21 |
| SHARED-BE-012 | MODERATE | P21 |
| SHARED-BE-013 | MODERATE | P21 |
| SHARED-BE-014 | MODERATE | P21 |
| SHARED-BE-015 | MODERATE | P21 |
| SHARED-BE-016 | MODERATE | P21 |
| SHARED-BE-017 | MODERATE | P21 |
| SHARED-ENG-007 | MODERATE | P21 |
| SHARED-ENG-008 | MODERATE | P21 |
| SHARED-ENG-009 | MODERATE | P21 |
| SHARED-ENG-010 | MODERATE | P21 |
| SHARED-ENG-011 | MODERATE | P21 |
| SHARED-ENG-012 | MODERATE | P13 |
| SHARED-ENG-013 | MODERATE | P21 |
| SHARED-ENG-014 | MODERATE | P21 |
| SHARED-ENG-015 | MODERATE | P21 |
| SHARED-FE-LOW/INFO (17+10) | LOW/INFO | P21 |

### EC-TIER1-OPS (33 findings)

| Finding ID | Severity | Packet |
|-----------|----------|--------|
| EC1-ENG-001 | HIGH | P5 |
| EC1-ENG-002 | LOW | P3 |
| EC1-ENG-003 | LOW | P18 |
| EC1-ENG-004 | LOW | P21 |
| EC1-ENG-005 | MODERATE | P21 |
| EC1-SRC-001 | HIGH | P5 |
| EC1-SRC-002 | MEDIUM | P5 |
| EC1-SRC-003 | LOW | P21 |
| EC1-SRC-004 | LOW | P21 |
| EC1-SRC-005 | MODERATE | P21 |
| EC1-SRC-006 | LOW | P18 |
| EC1-SRC-007 | MODERATE | P12 |
| EC1-CFG-001 | MEDIUM | P5 |
| EC1-CFG-002 | LOW | P15 |
| EC1-CFG-003 | LOW | P21 |
| EC1-CFG-004 | LOW | P18 |
| EC1-CFG-005 | LOW | P21 |
| EC1-LC-001 | MODERATE | P13 |
| EC1-LC-002 | MODERATE | P12 |
| EC1-LC-003 | LOW | P21 |
| EC1-LC-004 | LOW | P18 |
| EC1-LC-005 | MODERATE | P21 |
| EC1-LC-006 | LOW | P13 |
| EC1-LMC-001 | HIGH | P14 |
| EC1-LMC-002 | MODERATE | P14 |
| EC1-LMC-003 | MODERATE | P12 |
| EC1-LMC-004 | LOW | P12 |
| EC1-LMC-005 | LOW | P20 |
| EC1-LMC-006 | MODERATE | P14 |
| EC1-LMC-007 | LOW | P20 |
| EC1-LMC-008 | MODERATE | P13 |
| EC1-LMC-009 | LOW | P18 |
| EC1-OVR-001 | MODERATE | P12 |
| EC1-OVR-002 | LOW | P13 |
| EC1-OVR-003 | LOW | P18 |
| EC1-OVR-004 | LOW | P20 |
| EC1-OVR-005 | LOW | P20 |

### EC-TIER2-MONITORING (24 findings)

| Finding ID | Severity | Packet |
|-----------|----------|--------|
| EC2-CP-001 | HIGH | P3 |
| EC2-CP-002 | HIGH | P3 |
| EC2-CP-003 | MEDIUM | P21 |
| EC2-CP-004 | LOW | P21 |
| EC2-LOG-001 | MEDIUM | P12 |
| EC2-LOG-002 | LOW | P21 |
| EC2-ERR-001 | LOW | P21 |
| EC2-ERR-002 | LOW | P21 |
| EC2-FLOW-001 | MEDIUM | P21 |
| EC2-FLOW-002 | LOW | P21 |
| EC2-RC-001 | MEDIUM | P13 |
| EC2-RC-002 | LOW | P21 |
| EC2-DJ-001 | MEDIUM | P11 |
| EC2-DJ-002 | LOW | P15 |
| EC2-LIVE-001 | MEDIUM | P13 |
| EC2-LIVE-002 | LOW | P20 |
| EC2-LP-001 | MEDIUM | P5 |
| EC2-LP-002 | LOW | P15 |
| EC2-COL-001 | MEDIUM | P12 |
| EC2-COL-002 | LOW | P18 |
| EC2-SANK-001 | LOW | P21 |
| EC2-SANK-002 | LOW | P11 |
| EC2-REPLAY-001 | MEDIUM | P21 |
| EC2-REPLAY-002 | LOW | P21 |
| EC2-MAT-001 | LOW | P21 |
| EC2-MAT-002 | LOW | P21 |

### BP-GOLD (41 findings)

| Finding ID | Severity | Packet |
|-----------|----------|--------|
| BPG-DET-001 | CRITICAL | P3 |
| BPG-CLUST-001 | CRITICAL | P3 |
| BPG-DET-002 | HIGH | P10 |
| BPG-DET-003 | HIGH | P10 |
| BPG-CLUST-002 | HIGH | P10 |
| BPG-CLUST-003 | MEDIUM | P3 |
| BPG-XCUT-002 | HIGH | P4 |
| BPG-XCUT-003 | HIGH | P4 |
| BPG-VALID-001 | HIGH | P21 |
| BPG-ALERT-001 | MEDIUM | P14 |
| BPG-ALERT-002 | MEDIUM | P14 |
| BPG-CAT-002 | MEDIUM | P21 |
| BPG-CAT-003 | MEDIUM | P21 |
| BPG-CANON-004 | MEDIUM | P16 |
| BPG-SPEC-002 | MEDIUM | P21 |
| BPG-SPEC-003 | MEDIUM | P14 |
| BPG-VALID-002 | MEDIUM | P21 |
| BPG-VALID-003 | MEDIUM | P16 |
| BPG-XCUT-001 | MEDIUM | P21 |
| BPG-XCUT-004 | MEDIUM | P16 |
| BPG-LED-002 | MEDIUM | P21 |
| BPG-ALERT-003 | LOW | P21 |
| BPG-ALERT-004 | LOW | P21 |
| BPG-ALERT-005 | LOW | P18 |
| BPG-SRC-002 | LOW | P21 |
| BPG-CAT-004 | LOW | P21 |
| BPG-DET-004 | LOW | P21 |
| BPG-DET-005 | LOW | P21 |
| BPG-REQ-002 | MEDIUM | P14 |
| BPG-REQ-003 | LOW | P21 |
| BPG-REQ-004 | LOW | P21 |
| BPG-LED-003 | LOW | P12 |
| BPG-LED-004 | LOW | P21 |
| BPG-CLUST-004 | LOW | P21 |
| BPG-CLUST-005 | LOW | P21 |
| BPG-CANON-002 | LOW | P12 |
| BPG-CANON-003 | LOW | P21 |
| BPG-SPEC-004 | LOW | P12 |
| BPG-VALID-004 | LOW | P21 |
| BPG-VALID-005 | LOW | P21 |
| BPG-SHARED-001 | LOW | P12 |
| BPG-SHARED-002 | INFO | P21 |
| BPG-SHARED-003 | INFO | P21 |
| BPG-SHARED-004 | LOW | P18 |
| BPG-SHARED-005 | INFO | P18 |
| BPG-SRC-003 | INFO | P19 |
| BPG-ALERT-006 | INFO | P21 |
| BPG-ALERT-007 | INFO | P21 |
| BPG-CAT-005 | INFO | P21 |
| BPG-HELP-002 | INFO | P21 |
| BPG-HELP-003 | INFO | P21 |

### EC-TOOLS-DATA (38 findings)

| Finding ID | Severity | Packet |
|-----------|----------|--------|
| ECT-MRI-001 | HIGH | P1 |
| ECT-SQLX-001 | HIGH | P1 |
| ECT-RUN-001 | HIGH | P6 |
| ECT-SV-001 | HIGH | P11 |
| ECT-DBX-001 | MEDIUM | P1 |
| ECT-NBC-001 | MEDIUM | P11 |
| ECT-NBC-002 | MEDIUM | P21 |
| ECT-RUN-002 | MEDIUM | P11 |
| ECT-NBD-001 | MEDIUM | P21 |
| ECT-SQLX-002 | MEDIUM | P21 |
| ECT-MICRO-001 | MEDIUM | P11 |
| ECT-MRI-002 | MEDIUM | P11 |
| ECT-MRI-003 | MEDIUM | P11 |
| ECT-DBX-002 | MEDIUM | P10 |
| ECT-DM-001 | MEDIUM | P21 |
| ECT-SV-002 | MEDIUM | P5 |
| ECT-SV-003 | MEDIUM | P14 |
| ECT-BLEND-001 | LOW | P15 |
| ECT-BLEND-002 | LOW | P20 |
| ECT-VALID-001 | LOW | P13 |
| ECT-NBC-003 | LOW | P21 |
| ECT-NBD-002 | LOW | P21 |
| ECT-NBD-003 | LOW | P21 |
| ECT-SQLX-003 | LOW | P21 |
| ECT-PROF-001 | LOW | P21 |
| ECT-MICRO-002 | LOW | P21 |
| ECT-MICRO-003 | LOW | P21 |
| ECT-PULSE-001 | LOW | P12 |
| ECT-TA-001 | MEDIUM | P21 |
| ECT-TA-002 | LOW | P21 |
| ECT-TS-001 | LOW | P21 |
| ECT-TS-002 | LOW | P13 |
| ECT-MRI-004 | LOW | P21 |
| ECT-DBX-003 | LOW | P18 |
| ECT-DBX-004 | LOW | P21 |
| ECT-DM-002 | LOW | P21 |
| ECT-DM-003 | LOW | P20 |
| ECT-SV-004 | LOW | P18 |
| ECT-SV-005 | LOW | P20 |
| ECT-SV-006 | INFO | P21 |
| ECT-BLEND-003 | INFO | P21 |
| ECT-VALID-002 | INFO | P21 |
| ECT-PROF-002 | INFO | P21 |
| ECT-PULSE-002 | INFO | P21 |

### GOV-MOCK-TRUTH (15 findings)

| Finding ID | Severity | Packet |
|-----------|----------|--------|
| GOV-LIN-004 | LOW | P21 |
| GOV-LIN-006 | LOW | P21 |
| GOV-LIN-007 | LOW | P21 |
| GOV-IMP-005 | LOW | P21 |
| GOV-CAT-004 through GOV-CAT-010 | LOW-INFO | P21 |
| GOV-EST-012 | LOW | P21 |
| GOV-EST-013 | LOW | P19 |
| GOV-EST-014 | INFO | P21 |
| GOV-EST-015 | INFO | P21 |

### SETTINGS-SETUP-LABS (19 findings)

| Finding ID | Severity | Packet |
|-----------|----------|--------|
| SSL-SET-002 | HIGH | P8 |
| SSL-CROSS-003 | HIGH | P8 |
| SSL-SETUP-002 | HIGH | P3 |
| SSL-LAB-001 | HIGH | P9 |
| SSL-LAB-002 | HIGH | P9 |
| SSL-LAB-003 | HIGH | P9 |
| SSL-LAB-004 | HIGH | P9 |
| SSL-CROSS-004 | HIGH | P9 |
| SSL-ADMIN-001 | MEDIUM | P21 |
| SSL-ADMIN-004 | MEDIUM | P15 |
| SSL-SET-001 | MEDIUM | P15 |
| SSL-SET-004 | MEDIUM | P8 |
| SSL-SETUP-003 | MEDIUM | P16 |
| SSL-CROSS-001 | MEDIUM | P9 |
| SSL-CROSS-002 | MEDIUM | P15 |
| SSL-CROSS-005 | MEDIUM | P15 |
| SSL-ADMIN-002 | LOW | P21 |
| SSL-ADMIN-003 | INFO | P21 |
| SSL-ADMIN-005 | INFO | P21 |
| SSL-SET-003 | INFO | P21 |
| SSL-SET-005 | OK | -- |

---

*End of Packet Index. All findings from Phase 0 + Phase 1 (7 audit files) are assigned to exactly one packet.*
