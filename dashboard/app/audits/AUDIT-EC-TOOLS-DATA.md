# AUDIT-EC-TOOLS-DATA — V2 Whole-App Forensic Audit

**Session**: EC-TOOLS-DATA (Phase 1)
**Date**: 2026-04-08
**Auditor**: Claude (Opus 4.6)
**Mode**: READ-ONLY truth audit
**Pages**: 15 (largest session)
**Protocol**: VERIFY_AND_EXTEND for all except GOV-009 (AUDIT_NORMALLY)

---

## Table of Contents

1. [EC-009 DataBlender](#ec-009-datablender)
2. [EC-013 NotebookConfig](#ec-013-notebookconfig)
3. [EC-014 PipelineRunner](#ec-014-pipelinerunner)
4. [EC-015 ValidationChecklist](#ec-015-validationchecklist)
5. [EC-016 NotebookDebug](#ec-016-notebookdebug)
6. [EC-020 SqlExplorer](#ec-020-sqlexplorer)
7. [EC-022 DataProfiler](#ec-022-dataprofiler)
8. [EC-024 DataMicroscope](#ec-024-datamicroscope)
9. [EC-027 ImpactPulse](#ec-027-impactpulse)
10. [EC-028 TestAudit](#ec-028-testaudit)
11. [EC-029 TestSwarm](#ec-029-testswarm)
12. [EC-030 MRI](#ec-030-mri)
13. [GOV-005 DatabaseExplorer](#gov-005-databaseexplorer)
14. [GOV-006 DataManager](#gov-006-datamanager)
15. [GOV-009 SchemaValidation](#gov-009-schemavalidation)

---

## EC-009 DataBlender

**Route**: `/blender`
**Frontend**: `dashboard/app/src/pages/DataBlender.tsx`
**Backend**: `dashboard/app/api/routes/data_access.py`
**Subcomponents**: `TableBrowser`, `TableProfiler`, `BlendSuggestions`, `BlendPreview`, `SqlWorkbench`
**Canonical audit**: `AUDIT-DataBlender.md` (2026-03-23)

### Verification of Existing Findings

| ID | Finding | Status | Still Valid? |
|----|---------|--------|-------------|
| DBL-H01 | Path traversal in `/api/blender/query` lakehouse param | FIXED | YES — `_sanitize()` confirmed applied |
| DBL-H02 | `top_n` regex uses original SQL | FIXED | YES |
| DBL-H03 | Purview status leaks exception details | FIXED | YES |
| DBL-01 | Hardcoded hex in title | FIXED | YES |
| DBL-02 | Unused `useCallback` import | FIXED | YES |
| DBL-03 | SqlWorkbench `.json()` on non-ok response | FIXED | YES |
| DBL-04 | Misleading error in TableBrowser | FIXED | YES |
| DBL-05 | Hardcoded hex in layerConfig | FIXED | YES |
| DBL-06 | `str(e)` in blender query error | DEFERRED | YES — still deferred, acceptable for power-user tool |
| DBL-07 | BlendSuggestions/BlendPreview stubs | DEFERRED | YES — still stubs |

### New Findings

| ID | Severity | Category | Description |
|----|----------|----------|-------------|
| ECT-BLEND-001 | LOW | Dead feature | `BlendSuggestions` and `BlendPreview` remain completely non-functional stubs. The tab UI renders them but they show empty states. No backend endpoints exist for blend suggestions or blend preview. These sub-tabs create a false impression of capability. Ref: SHARED-STUB-001. |
| ECT-BLEND-002 | LOW | Data contract | `TableBrowser` imports `layerConfig` from `@/data/blenderMockData` — the naming suggests mock data but the config is used for real layer color/label mappings. The file name is misleading. |
| ECT-BLEND-003 | INFO | Polling | No auto-refresh or polling on DataBlender. Table list is fetched once on mount. This is acceptable for an exploration tool. |

**Verdict**: VERIFIED — prior audit thorough. Stubs remain the only notable gap.

---

## EC-013 NotebookConfig

**Route**: `/notebook-config`
**Frontend**: `dashboard/app/src/pages/NotebookConfig.tsx`
**Backend**: `dashboard/app/api/routes/notebook.py`
**Canonical audit**: `AUDIT-NotebookConfig.md` (2026-03-23)

### API Trace

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/notebook-config` | GET | Load all config data (item_config, variable libraries, deployment readiness) |
| `/api/notebook-config/update` | POST | Write config changes |
| `/api/notebook/trigger` | POST | Trigger NB_UTILITY_SETUP_FMD notebook |
| `/api/notebook/job-status` | GET | Poll notebook job status |

### Verification of Existing Findings

All 16 items in the canonical audit remain accurate. Items 1-6 (FIXED) confirmed fixed in current code. Items 7-8 (DEFERRED) confirmed still present:
- `templateMapping` always returns `{}` — stub section still rendered.
- `missingConnections` always returns `[]` — warning banner never fires.

### New Findings

| ID | Severity | Category | Description |
|----|----------|----------|-------------|
| ECT-NBC-001 | MEDIUM | Truth bug | `templateMapping` section renders a heading and empty table, implying the feature exists but has no data. In reality, the backend never populates this field. Users see an empty "Template Mapping" section with no explanation. Should either be hidden or show an honest "not yet implemented" message. |
| ECT-NBC-002 | MEDIUM | Security | The setup notebook trigger (`POST /api/notebook/trigger`) has no confirmation or rate limiting beyond a frontend dialog. A programmatic caller could trigger repeated notebook runs. The backend does check for `_is_valid_uuid()` on notebook ID and workspace ID, which is good. |
| ECT-NBC-003 | LOW | Error handling | The job status poller in the frontend has a 5-second initial delay before first poll, then 5-second intervals. If the notebook completes in under 5 seconds (unlikely but possible for failures), the user sees "triggering" state with no feedback for 5 seconds. |

**Verdict**: VERIFIED — prior audit thorough. New findings are MEDIUM at worst.

---

## EC-014 PipelineRunner

**Route**: `/runner`
**Frontend**: `dashboard/app/src/pages/PipelineRunner.tsx`
**Backend**: `dashboard/app/api/routes/pipeline.py`
**Canonical audit**: `AUDIT-PipelineRunner.md` (2026-03-23)

### API Trace

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/runner/sources` | GET | Data sources with entity counts |
| `/api/runner/entities?dataSourceId=N` | GET | Entities for a data source |
| `/api/runner/state` | GET | Current runner state (active/idle) |
| `/api/runner/prepare` | POST | Scope a run to selected sources/entities |
| `/api/runner/trigger` | POST | Trigger pipeline within active scope |

### Verification of Existing Findings

| ID | Status | Still Valid? |
|----|--------|-------------|
| PR-01 | FIXED | YES — column aliases confirmed in backend |
| PR-02 | FIXED | YES — `_sanitize()` applied to all URL-interpolated params |
| PR-03 | FIXED | YES — input validation confirmed on prepare endpoint |
| PR-04 | FIXED | YES — design tokens in use |
| PR-05 | FIXED | YES — ARIA attributes confirmed |
| PR-06 | FIXED | YES |
| PR-09 | DEFERRED (CRITICAL) | **YES — STILL OPEN** |
| PR-10 | DEFERRED (CRITICAL) | **YES — STILL OPEN** |

### New Findings

| ID | Severity | Category | Description |
|----|----------|----------|-------------|
| ECT-RUN-001 | HIGH | Truth bug | `post_runner_prepare()` records `deactivated` and `affected` counts as zeros (`{"lz": 0, "bronze": 0, "silver": 0}`) in its response, but never actually deactivates any entities in the database. The `deactivated` and `affected` fields in `_runner_state` are initialized to empty lists and zeros, then returned without modification. The frontend receives a "success" response with `scope.deactivated` counts of zero, which it displays as "0 entities deactivated" — technically true but misleading since deactivation was the stated purpose of scoped runs. The entire prepare/trigger/restore flow is a no-op for entity scoping; it only stores state in a JSON file. This is the PR-09/PR-10 deferred finding manifesting in the actual data contract. |
| ECT-RUN-002 | MEDIUM | Data contract | `post_runner_restore()` always returns `{"restored": {"lz": 0, "bronze": 0, "silver": 0}}` regardless of state, because it never actually restores any entity `IsActive` flags in the database. It only resets the JSON state file. |
| ECT-RUN-003 | LOW | Race condition | `_runner_state` is guarded by `_runner_lock` in `prepare` but `post_runner_trigger` reads `_runner_state.get("active")` outside the lock before entering the critical section. A concurrent restore could race with a trigger. |

**Verdict**: VERIFIED — PR-09/PR-10 deferred items remain the critical gap. New ECT-RUN-001 documents how this manifests in the data contract.

---

## EC-015 ValidationChecklist

**Route**: `/validation`
**Frontend**: `dashboard/app/src/pages/ValidationChecklist.tsx`
**Backend**: `dashboard/app/api/routes/schema_validation.py` (shared with SchemaValidation)
**Canonical audit**: `AUDIT-ValidationChecklist.md` (2026-03-23)

### API Trace

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/engine/validation` | GET | Full validation data (overview, layer statuses, digest, entities) |

### Verification of Existing Findings

| ID | Status | Still Valid? |
|----|--------|-------------|
| VC-01 | FIXED | YES — "failed" label confirmed |
| VC-02 | FIXED | YES |
| VC-03 through VC-09 | DEFERRED | YES — all still present |

### New Findings

| ID | Severity | Category | Description |
|----|----------|----------|-------------|
| ECT-VALID-001 | LOW | Polling | Auto-polls every 15 seconds via `setInterval`. No backoff on error — if the backend is down, the page hammers it every 15s indefinitely. Ref: SHARED-POLL-001. |
| ECT-VALID-002 | INFO | Data flow | The ValidationChecklist fetches from `/api/engine/validation` which is a different endpoint than the SchemaValidation page's `/api/schema-validation/summary`. These are two independent validation systems (engine layer validation vs. Pandera schema validation). The naming similarity could confuse developers. |

**Verdict**: VERIFIED — no new critical findings.

---

## EC-016 NotebookDebug

**Route**: `/notebook-debug`
**Frontend**: `dashboard/app/src/pages/NotebookDebug.tsx`
**Backend**: `dashboard/app/api/routes/notebook.py`
**Canonical audit**: `AUDIT-NotebookDebug.md` (2026-03-23)

### API Trace

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/notebook-debug/notebooks` | GET | List available Fabric notebooks |
| `/api/notebook-debug/entities?layer=X` | GET | List entities for a layer |
| `/api/notebook-debug/run` | POST | Trigger a notebook run |
| `/api/notebook-debug/job-status` | GET | Poll job run status |

### Verification of Existing Findings

All findings from canonical audit remain valid. ND-07 (DEFERRED) confirmed still present — `#fff` for white/inverse text without a `--bp-ink-on-accent` token.

### New Findings

| ID | Severity | Category | Description |
|----|----------|----------|-------------|
| ECT-NBD-001 | MEDIUM | Security | `POST /api/notebook-debug/run` accepts a `notebookId` parameter that is used directly in the Fabric API URL. While `_is_valid_uuid()` validation is applied, the `layer` parameter is validated only against `["bronze", "silver", "landing"]` — but the `maxEntities` parameter is passed as an integer without upper bound validation. A caller could set `maxEntities=999999` to force processing all entities. |
| ECT-NBD-002 | LOW | UX | After selecting a notebook and triggering a run, the "Run" button remains enabled during polling. A user could click it again, triggering a second concurrent notebook run. The backend does not reject duplicate concurrent runs for the same notebook. |
| ECT-NBD-003 | LOW | Error handling | `loadEntities` catch block sets `setError(e.message)` but `e` is typed as `unknown`. The `.message` access will throw if `e` is not an Error instance. Should use `e instanceof Error ? e.message : String(e)`. |

**Verdict**: VERIFIED — prior audit accurate. NBD-001 is the most notable new finding.

---

## EC-020 SqlExplorer

**Route**: `/sql-explorer`
**Frontend**: `dashboard/app/src/pages/SqlExplorer.tsx`
**Subcomponents**: `ObjectTree.tsx`, `TableDetail.tsx`
**Backend**: `dashboard/app/api/routes/sql_explorer.py`
**Canonical audit**: `AUDIT-SqlExplorer.md` (2026-03-26)

### API Trace

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/sql-explorer/servers` | GET | Registered source servers |
| `/api/sql-explorer/databases?server=X` | GET | Databases on a server |
| `/api/sql-explorer/schemas?server=X&database=Y` | GET | Schemas in a database |
| `/api/sql-explorer/tables?server=X&database=Y&schema=Z` | GET | Tables in a schema |
| `/api/sql-explorer/columns?server=X&database=Y&schema=Z&table=T` | GET | Column metadata |
| `/api/sql-explorer/preview?...` | GET | Sample rows |
| `/api/sql-explorer/register-tables` | POST | Cascade-register tables into pipeline |
| `/api/sql-explorer/lakehouses` | GET | Fabric lakehouses |
| `/api/sql-explorer/lakehouse-schemas` | GET | Schemas in a lakehouse |
| `/api/sql-explorer/lakehouse-tables` | GET | Tables in a lakehouse schema |
| `/api/sql-explorer/lakehouse-columns` | GET | Lakehouse column metadata |
| `/api/sql-explorer/lakehouse-preview` | GET | Lakehouse sample rows |
| `/api/engine/start` | POST | Start engine run for registered tables |

### Verification of Existing Findings

All 15 items in canonical audit confirmed. Items 7, 8 (DEFERRED) still present:
- `lakehouse-file-detail` endpoint is still a stub (never called).
- `isRegistered` field still not set by `/databases` response.

Items 16-20 (Table Browser addendum) confirmed — multi-select and registration status indicators were implemented.

### New Findings

| ID | Severity | Category | Description |
|----|----------|----------|-------------|
| ECT-SQLX-001 | HIGH | Security | `_validate_server()` validates against registered connections, but the validation uses `ServerName` from the `connections` table. If a connection is registered with `ServerName = ""` or `NULL`, the `strip().lower()` comparison could match against empty-string user input, bypassing the allowlist. The query filters `WHERE ServerName IS NOT NULL AND ServerName != ''`, which mitigates this, but a server named only whitespace (e.g., `" "`) would pass the query filter but `strip()` to empty, creating an edge case. |
| ECT-SQLX-002 | MEDIUM | Data flow | When the "Load" button triggers `POST /api/sql-explorer/register-tables` followed by `POST /api/engine/start`, there is no transactional guarantee. If registration succeeds but engine start fails, entities are registered but never loaded. The frontend shows an error, but the user has no way to retry just the engine start — they must re-register (which will hit "already registered" logic). |
| ECT-SQLX-003 | LOW | Error handling | `ObjectTree` fetches servers, databases, schemas, and tables in cascading calls. If any intermediate call fails, the tree shows a red error icon on that node but doesn't prevent expansion of child nodes, which will then also fail with confusing errors. |

**Verdict**: VERIFIED — prior audit comprehensive. ECT-SQLX-001 is a theoretical edge case but worth documenting.

---

## EC-022 DataProfiler

**Route**: `/profile`
**Frontend**: `dashboard/app/src/pages/DataProfiler.tsx`
**Backend**: `dashboard/app/api/routes/data_access.py` (profile endpoint), `microscope.py` (entity digest)
**Canonical audit**: `AUDIT-DataProfiler.md` (2026-03-23)

### API Trace

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/blender/profile?lakehouse=X&schema=Y&table=Z` | GET | Column profile + row count |
| `/api/entity-digest` | GET | Entity list for picker (via `useEntityDigest` hook) |

### Verification of Existing Findings

| ID | Status | Still Valid? |
|----|--------|-------------|
| DP-01 | FIXED | YES — separate `pl.len()` confirmed for true row count |
| DP-02 | FIXED | YES — `_sanitize()` applied to lakehouse param |
| DP-03 | FIXED | YES — design tokens in use |
| DP-04 through DP-08 | FIXED | YES |
| DP-09, DP-10 | DEFERRED | YES |

### New Findings

| ID | Severity | Category | Description |
|----|----------|----------|-------------|
| ECT-PROF-001 | LOW | Data contract | `DataProfiler` uses `/api/blender/profile` endpoint which is part of the DataBlender route group. This cross-page endpoint sharing is architecturally fine but creates a hidden dependency — changes to the blender profile endpoint would break DataProfiler. No dedicated profiler endpoint exists. |
| ECT-PROF-002 | INFO | UX | The "View in Microscope" link at the bottom of each entity card navigates to `/microscope?entity=N` which is a useful cross-page connection. Confirmed working. |

**Verdict**: VERIFIED — no new critical findings. Prior audit was thorough.

---

## EC-024 DataMicroscope

**Route**: `/microscope`
**Frontend**: `dashboard/app/src/pages/DataMicroscope.tsx`
**Hooks**: `useMicroscope.ts`, `useEntityDigest.ts`
**Backend**: `dashboard/app/api/routes/microscope.py`
**Canonical audit**: `AUDIT-DataMicroscope.md` (2026-03-23)

### API Trace

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/microscope?entity=N&pk=V` | GET | Cross-layer row data |
| `/api/microscope/pks?entity=N&q=X&limit=N` | GET | PK value autocomplete |
| `/api/entity-digest` | GET | Entity list for picker (via `useEntityDigest`) |

### Verification of Existing Findings

All findings from canonical audit remain valid and accurately described.

### New Findings

| ID | Severity | Category | Description |
|----|----------|----------|-------------|
| ECT-MICRO-001 | MEDIUM | Truth bug | The microscope backend generates `transformationSteps` describing what *should* happen at each layer (e.g., "SCD Type 2 tracking", "RecordStartDate/RecordEndDate columns added"). These descriptions are generated from metadata, not from actual inspection of the data. If the engine has a bug and SCD tracking is broken, the microscope will still claim it is working. The steps should be labeled as "expected transformations" not "applied transformations." |
| ECT-MICRO-002 | LOW | Error handling | `useMicroscope` hook has a 60-second client-side cache TTL. If a user loads a row, triggers a pipeline run, and returns within 60 seconds, they see stale data. The cache is not invalidated by external mutations. `invalidateMicroscopeCache()` exists but is never called from any page. |
| ECT-MICRO-003 | LOW | Data contract | The `source` layer data in the microscope response depends on an on-prem ODBC connection to the source server. When VPN is unavailable, the source layer silently returns `null` rows with a `"source_unavailable": true` flag. The frontend handles this gracefully with a "Source unavailable" message, which is correct behavior. |

**Verdict**: VERIFIED — ECT-MICRO-001 is the most notable new finding (metadata-based truth claim).

---

## EC-027 ImpactPulse

**Route**: `/pulse`
**Frontend**: `dashboard/app/src/pages/ImpactPulse.tsx`
**Backend**: `dashboard/app/api/routes/entities.py` (via `useEntityDigest`), live-monitor endpoint
**Canonical audit**: `AUDIT-ImpactPulse.md` (2026-03-23)

### API Trace

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/entity-digest` | GET | Entity status data (via `useEntityDigest` hook) |
| `/api/live-monitor?minutes=30` | GET | Live pipeline events for animated edges |

### Verification of Existing Findings

| ID | Status | Still Valid? |
|----|--------|-------------|
| IP-01 | FIXED | YES |
| IP-02 | DEFERRED | YES — hex in node/edge data objects, requires component changes |
| IP-03 | DEFERRED | YES — paired with IP-02 |
| IP-04 through IP-07 | FIXED | YES |
| IP-08 | NOT FIXING | YES — trivial |

### New Findings

| ID | Severity | Category | Description |
|----|----------|----------|-------------|
| ECT-PULSE-001 | LOW | Error handling | The `/api/live-monitor` fetch failure is silently caught with an empty `catch {}` block. If the live monitor endpoint is down, the animated edges just stop pulsing with no user indication. This is documented behavior ("live data is supplementary") but could confuse users who expect to see activity. |
| ECT-PULSE-002 | INFO | Performance | React Flow canvas with animated edges creates significant re-render load. The 30-second live data poll triggers edge animation updates that cause full-canvas re-renders. For large entity counts, this could be noticeable. |

**Verdict**: VERIFIED — no new critical findings.

---

## EC-028 TestAudit

**Route**: `/test-audit`
**Frontend**: `dashboard/app/src/pages/TestAudit.tsx`
**Backend**: `dashboard/app/api/routes/test_audit.py`
**Canonical audit**: `AUDIT-TestAudit.md` (2026-03-23)

### API Trace

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/audit/history` | GET | Run history index |
| `/api/audit/status` | GET | Running/idle state |
| `/api/audit/run` | POST | Trigger new Playwright run |
| `/api/audit/artifacts/{runId}/{testDir}/{fn}` | GET | Serve artifact files |

### Verification of Existing Findings

| ID | Status | Still Valid? |
|----|--------|-------------|
| TA-1 | FIXED | YES — 7-segment URL validation confirmed |
| TA-2 through TA-9 | FIXED | YES |
| TA-10, TA-11, TA-12 | DEFERRED | YES |

### New Findings

| ID | Severity | Category | Description |
|----|----------|----------|-------------|
| ECT-TA-001 | MEDIUM | Security | `POST /api/audit/run` uses `subprocess.Popen` to launch Playwright. The process tracking uses module-level `_audit_proc` and `_last_exit_code` globals guarded by `_lock`. However, if the server process is restarted while an audit is running, `_audit_proc` is reset to `None` and the orphaned Playwright process continues running with no tracking. The `_lock` also does not prevent two concurrent audit triggers if the first check and the second check interleave. |
| ECT-TA-002 | LOW | Truth bug | `VITE_API_URL` is used with the `import.meta.env` pattern, meaning the API URL prefix is baked in at build time. If the dashboard is deployed behind a reverse proxy that changes the path prefix, artifact URLs (screenshots, videos, traces) constructed with `aUrl()` will break because they concatenate `API` + `/api/audit/artifacts/...`. |

**Verdict**: VERIFIED — prior audit thorough. ECT-TA-001 is the most notable new finding.

---

## EC-029 TestSwarm

**Route**: `/test-swarm`
**Frontend**: `dashboard/app/src/pages/TestSwarm.tsx`
**Backend**: `dashboard/app/api/routes/test_swarm.py`
**Canonical audit**: `AUDIT-TestSwarm.md` (2026-03-23)

### API Trace

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/test-swarm/runs` | GET | List all runs |
| `/api/test-swarm/runs/{runId}/convergence` | GET | Convergence series |
| `/api/test-swarm/runs/{runId}/iteration/{n}` | GET | Single iteration detail |

### Verification of Existing Findings

All findings from canonical audit confirmed still valid. The backend has proper `_safe_component()` validation for `runId` and iteration numbers, preventing path traversal.

### New Findings

| ID | Severity | Category | Description |
|----|----------|----------|-------------|
| ECT-TS-001 | LOW | Data contract | The `runs` endpoint reads all subdirectories of `.test-swarm-runs/` as run IDs. If a non-run directory is manually created in this location, it will appear as a run with `summary: null`. The frontend handles this gracefully (null summary renders as "Unknown"). |
| ECT-TS-002 | LOW | Polling | Frontend polls runs list every 15 seconds via `setInterval`. The `selectedRunIdRef` pattern correctly avoids re-creating the interval when the user switches runs, which is good. No error backoff on poll failure. Ref: SHARED-POLL-001. |

**Verdict**: VERIFIED — no new critical findings. Well-built page.

---

## EC-030 MRI

**Route**: `/mri`
**Frontend**: `dashboard/app/src/pages/MRI.tsx`
**Hook**: `dashboard/app/src/hooks/useMRI.ts`
**Subcomponents**: 9 files in `components/mri/`
**Backend**: `dashboard/app/api/routes/mri.py`
**Canonical audit**: `AUDIT-MRI.md` (2026-03-23)

### API Trace

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/mri/runs` | GET | List all MRI test runs |
| `/api/mri/status` | GET | Current scan status |
| `/api/mri/run` | POST | Start new MRI scan |
| `/api/mri/runs/{runId}/convergence` | GET | Convergence data |
| `/api/mri/runs/{runId}/visual-diffs` | GET | Visual diff results |
| `/api/mri/runs/{runId}/backend-results` | GET | Backend API test results |
| `/api/mri/runs/{runId}/ai-analyses` | GET | AI analysis results |
| `/api/mri/runs/{runId}/flake-results` | GET | Flake detection results |
| `/api/mri/runs/{runId}/iteration/{n}` | GET | Iteration detail |
| `/api/mri/baselines` | GET | List baselines |
| `/api/mri/baselines/accept-all` | POST | Accept all current as baseline |
| `/api/mri/baselines/{name}` | POST | Accept single baseline |
| `/api/mri/api-tests/run` | POST | Run API-only tests |

### Verification of Existing Findings

| ID | Status | Still Valid? |
|----|--------|-------------|
| F-01 | FIXED | YES — `hasE2E: false` confirmed |
| F-02 through F-04 | FIXED | YES |
| F-05 | FIXED | YES — `scanStartedAt` removed |
| F-06 | FIXED | YES — `scanPollRef` in use |
| F-07 | FIXED | YES — try/catch on baseline actions |
| F-08, F-09 | FIXED | YES |
| F-10 through F-14 | FIXED/DEFERRED | YES |

### New Findings

| ID | Severity | Category | Description |
|----|----------|----------|-------------|
| ECT-MRI-001 | HIGH | Security | `_load_run_file(run_id, filename)` constructs a path as `_RUNS_DIR / run_id / filename` without sanitizing `run_id`. Unlike `test_swarm.py` which has `_safe_component()`, `mri.py` passes the `runId` URL parameter directly into the filesystem path. A crafted `runId` like `../../etc` could traverse outside the runs directory. All 6 run-detail endpoints (`convergence`, `visual-diffs`, `backend-results`, `ai-analyses`, `flake-results`, `iteration`) are affected. |
| ECT-MRI-002 | MEDIUM | Truth bug | `_generate_ai_analyses()` fabricates AI analysis descriptions by constructing templated strings from visual diff data (e.g., "Screenshot shows potential visual regression"). These are not actual AI analysis results — they are string templates. The function name and the UI presentation ("AI Analysis") imply real AI inference is happening. |
| ECT-MRI-003 | MEDIUM | Truth bug | `_generate_flake_results()` generates flake detection data by pattern-matching test names and assigning synthetic pass rates. Real flake detection requires running tests multiple times. The "Flake Detection" tab presents fabricated data as real analysis. |
| ECT-MRI-004 | LOW | Subprocess | `_run_mri_scan()` uses `subprocess.Popen` to launch Playwright. Same orphan-process risk as TestAudit (ECT-TA-001). Server restart loses tracking of running scan. |

**Verdict**: VERIFIED — **ECT-MRI-001 is a HIGH security finding** (path traversal). ECT-MRI-002 and ECT-MRI-003 are truth bugs (fabricated AI/flake data).

---

## GOV-005 DatabaseExplorer

**Route**: `/db-explorer`
**Frontend**: `dashboard/app/src/pages/DatabaseExplorer.tsx`
**Backend**: `dashboard/app/api/routes/db_explorer.py`
**Canonical audit**: `AUDIT-DatabaseExplorer.md` (2026-03-13)

### API Trace

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/db-explorer/tables` | GET | List all SQLite tables |
| `/api/db-explorer/table/{name}?page=N&per_page=N` | GET | Paginated table data |
| `/api/db-explorer/table/{name}/schema` | GET | Column metadata (PRAGMA) |
| `/api/db-explorer/query` | POST | Execute read-only SQL |

### Verification of Existing Findings

The canonical audit from 2026-03-13 is the oldest in this set. All security measures confirmed:
- `_validate_table_name()` checks against `sqlite_master` before any f-string table interpolation.
- `_sanitize_identifier()` strips non-alphanumeric characters and escapes `]` characters.
- `execute_query()` restricts to `SELECT` and `PRAGMA` statements.
- SQLite's `cursor.execute()` only runs one statement (no stacked queries).

### New Findings

| ID | Severity | Category | Description |
|----|----------|----------|-------------|
| ECT-DBX-001 | MEDIUM | Security | `execute_query()` validates that SQL starts with `SELECT` or `PRAGMA` using `normalized.startswith()`. However, this check is applied after `.upper().lstrip()` which means a query like `SELECT * FROM sqlite_master; DROP TABLE x` would pass the check. While SQLite's `cursor.execute()` only runs the first statement (preventing the DROP), the intent validation is incomplete. A more robust check would reject queries containing `;`. |
| ECT-DBX-002 | MEDIUM | Performance | `GET /api/db-explorer/tables` runs `SELECT COUNT(*) FROM [table]` for every table in the database. With 20+ tables and some containing hundreds of thousands of rows, this is an O(N*M) operation on every page load. No caching. |
| ECT-DBX-003 | LOW | Accessibility | No ARIA attributes on the table list sidebar, data grid, or query console. Tab buttons lack `role="tab"`. The page is functional but not screen-reader accessible. Ref: SHARED-A11Y-001. |
| ECT-DBX-004 | LOW | Error handling | `per_page` is clamped to `min(int(...), 500)` but has no lower bound. A `per_page=0` would cause a division-by-zero in pagination calculations on the frontend. |

**Verdict**: VERIFIED with new findings. ECT-DBX-001 and ECT-DBX-002 are the most notable.

---

## GOV-006 DataManager

**Route**: `/data-manager`
**Frontend**: `dashboard/app/src/pages/DataManager.tsx`
**Backend**: `dashboard/app/api/routes/data_manager.py`
**Canonical audit**: `AUDIT-DataManager.md` (2026-03-23)

### API Trace

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/data-manager/tables` | GET | List curated table metadata |
| `/api/data-manager/table/{name}?page=N&perPage=N&search=X&sort=X&dir=X` | GET | Paginated table data with FK resolution |
| `/api/data-manager/table/{name}/{pk}` | PUT | Update a row |

### Verification of Existing Findings

All 7 findings (1 HIGH, 4 MEDIUM, 2 LOW) confirmed FIXED. DM-07 (DEFERRED) still present — no `--bp-ink-on-accent` token exists.

### New Findings

| ID | Severity | Category | Description |
|----|----------|----------|-------------|
| ECT-DM-001 | MEDIUM | Security | `update_row()` in `data_manager.py` uses `_safe_ident()` to sanitize column names in the UPDATE statement, which strips non-alphanumeric characters. However, the `TABLE_REGISTRY` acts as an allowlist — only registered tables with `editable: True` can be updated. This is good defense-in-depth. The risk is that if `TABLE_REGISTRY` is extended to include a table with columns whose names contain SQL-significant characters after sanitization, the `_safe_ident` approach could fail. Current tables are safe. |
| ECT-DM-002 | LOW | Data contract | `_queue_export()` is called after every row update to trigger Parquet sync. If `pyarrow` is not installed (optional dependency), the export silently fails. This means Parquet exports may lag behind SQLite writes with no user notification. |
| ECT-DM-003 | LOW | Truth bug | The `ENTITY_TABLES` set in the frontend (for cross-linking to DataJourney) hardcodes table names: `lz_entities`, `bronze_entities`, `silver_entities`. If the backend TABLE_REGISTRY adds or renames entity tables, the cross-links will silently break. |

**Verdict**: VERIFIED — well-built page. New findings are LOW-MEDIUM.

---

## GOV-009 SchemaValidation

**Route**: `/schema-validation`
**Frontend**: `dashboard/app/src/pages/SchemaValidation.tsx`
**Backend**: `dashboard/app/api/routes/schema_validation.py`
**Canonical audit**: **NONE** (no prior audit exists — AUDIT_NORMALLY)

### API Trace

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/schema-validation/summary` | GET | Aggregate pass/fail/warn counts |
| `/api/schema-validation/coverage` | GET | Which entities have schemas |

Note: The page defines `recentResults` state and `ValidationResult`/`RunResults` types but **never fetches** recent results or run-specific data. The `/api/schema-validation/run/{run_id}` and `/api/schema-validation/entity/{entity_id}` endpoints exist in the backend but are not called by this page.

### Frontend Analysis

- **Lines**: ~280 (compact page)
- **Loading state**: Full-page spinner on first load, inline refresh button
- **Error state**: Error message with retry
- **Empty state**: Two distinct empty states — one for no schemas registered, one for no validation results
- **Design tokens**: Uses `var(--bp-*)` tokens throughout. No hardcoded hex detected.

### Backend Analysis

- **Route file**: `schema_validation.py` — 5 endpoints total
- **Data source**: SQLite `schema_validations` table via `control_plane_db`
- **SQL**: All queries use parameterized statements (no f-string interpolation)
- **`POST /api/schema-validation/result`**: Engine posts validation results — validates required fields

### Findings

| ID | Severity | Category | Description |
|----|----------|----------|-------------|
| ECT-SV-001 | HIGH | Truth bug | `recentResults` state variable is declared but **never populated**. The `ValidationResult` and `RunResults` TypeScript interfaces are defined but unused. The `expandedEntity` state exists and the UI has expand/collapse behavior on coverage items, but expanding an entity shows nothing — there is no fetch for per-entity validation history. The page implies drill-down capability through clickable rows with chevron icons, but clicking only toggles the chevron — no detail content appears. |
| ECT-SV-002 | MEDIUM | Data contract | The `coverage` endpoint returns entities that have been validated at least once, but uses `SELECT DISTINCT` on `entity_id` which deduplicates — if an entity has been validated across multiple schemas, only one entry appears. The `schema_name` in the response is non-deterministic (whichever row SQLite returns first). |
| ECT-SV-003 | MEDIUM | Division by zero | `get_summary()` computes `coverage_pct` as `validated_entities / total_entities * 100`. If `total_entities` is 0 (no active entities), the `if total_entities > 0 else 0` guard handles this. However, `get_coverage()` has the **same guard** — `len(validated) / total_active * 100` with `if total_active > 0 else 0`. Both are safe. **However**, the `total_entities` count in `get_summary()` queries `lz_entities WHERE IsActive = 1` while `get_coverage()` queries the same table — they will match. But `coverage_pct` in summary counts entities with *any* validation while coverage counts entities with *schema_name IS NOT NULL* — these could diverge, showing different percentages for the same concept. |
| ECT-SV-004 | LOW | Accessibility | No `aria-label` on refresh button. Coverage table rows use `cursor-pointer` and `onClick` but lack `role="button"`, `tabIndex`, and keyboard event handlers. Ref: SHARED-A11Y-001. |
| ECT-SV-005 | LOW | Dead code | `RunResults` interface is defined but never used. `recentResults` state is declared but never set. `ValidationResult` interface is defined and typed but only used for the unused `recentResults`. These suggest an incomplete implementation. |
| ECT-SV-006 | INFO | Feature gap | Backend has `GET /api/schema-validation/run/{run_id}` and `GET /api/schema-validation/entity/{entity_id}` endpoints that are fully implemented and functional, but the frontend never calls them. Adding drill-down would be straightforward. |

**Verdict**: FIRST AUDIT — **ECT-SV-001 is HIGH** (broken drill-down UX). Page is functional for summary/coverage display but drill-down is a dead end.

---

## Cross-Cutting Findings Summary

### SHARED-POLL-001: No Error Backoff on Polling

**Affected pages**: ValidationChecklist (15s), TestSwarm (15s), ImpactPulse (30s)
**Severity**: LOW
**Description**: Multiple pages use `setInterval` for polling with no exponential backoff on consecutive errors. If the backend goes down, these pages will hammer the server at their fixed interval indefinitely. Standard practice is to double the interval on each consecutive error, resetting on success.

### SHARED-A11Y-001: Accessibility Gaps

**Affected pages**: DatabaseExplorer, SchemaValidation, and others noted in canonical audits.
**Severity**: LOW
**Description**: Many pages lack `role`, `aria-label`, `tabIndex`, and keyboard event handlers on interactive elements. This is a codebase-wide pattern documented in multiple prior audits with the design token gap (`--bp-surface-2` undefined, no `--bp-ink-on-accent` token).

### SHARED-STUB-001: Feature Stubs Presented as Real UI

**Affected pages**: DataBlender (BlendSuggestions, BlendPreview), NotebookConfig (templateMapping), MRI (AI Analysis, Flake Detection)
**Severity**: MEDIUM
**Description**: Several pages render tab or section UI for features that have no backend implementation. Users can navigate to these sections and see empty states that do not clearly indicate the feature is unimplemented vs. having no data.

---

## Severity Summary

| Severity | Count | IDs |
|----------|-------|-----|
| HIGH | 4 | ECT-RUN-001, ECT-SQLX-001, ECT-MRI-001, ECT-SV-001 |
| MEDIUM | 11 | ECT-NBC-001, ECT-NBC-002, ECT-RUN-002, ECT-NBD-001, ECT-SQLX-002, ECT-MICRO-001, ECT-MRI-002, ECT-MRI-003, ECT-DBX-001, ECT-DBX-002, ECT-DM-001, ECT-SV-002, ECT-SV-003 |
| LOW | 18 | ECT-BLEND-001, ECT-BLEND-002, ECT-VALID-001, ECT-NBC-003, ECT-NBD-002, ECT-NBD-003, ECT-SQLX-003, ECT-PROF-001, ECT-MICRO-002, ECT-MICRO-003, ECT-PULSE-001, ECT-TA-002, ECT-TS-001, ECT-TS-002, ECT-MRI-004, ECT-DBX-003, ECT-DBX-004, ECT-DM-002, ECT-DM-003, ECT-SV-004, ECT-SV-005 |
| INFO | 5 | ECT-BLEND-003, ECT-VALID-002, ECT-PROF-002, ECT-PULSE-002, ECT-SV-006 |

### HIGH Findings Detail

1. **ECT-RUN-001** — PipelineRunner prepare/restore is a no-op for entity deactivation (data contract lie)
2. **ECT-SQLX-001** — Whitespace-only server name edge case in `_validate_server()`
3. **ECT-MRI-001** — Path traversal in `_load_run_file()` — `runId` not sanitized (6 endpoints affected)
4. **ECT-SV-001** — SchemaValidation drill-down is dead code — expand shows nothing

---

## Prior Audit Deferred Items Still Open

| Original ID | Page | Description | Still Open? |
|-------------|------|-------------|-------------|
| PR-09 | PipelineRunner | Entity deactivation is high-risk | YES |
| PR-10 | PipelineRunner | Paired with PR-09 | YES |
| DBL-06 | DataBlender | `str(e)` in blender query error | YES |
| DBL-07 | DataBlender | BlendSuggestions/BlendPreview stubs | YES |
| DP-09 | DataProfiler | `hexColor` naming misleading | YES |
| VC-03-09 | ValidationChecklist | Various LOW items | YES |
| IP-02, IP-03 | ImpactPulse | Hardcoded hex in node/edge components | YES |
| ND-07 | NotebookDebug | No `--bp-ink-on-accent` token | YES |
| DM-07 | DataManager | No `--bp-ink-on-accent` token | YES |
| TA-10-12 | TestAudit | Various LOW items | YES |
