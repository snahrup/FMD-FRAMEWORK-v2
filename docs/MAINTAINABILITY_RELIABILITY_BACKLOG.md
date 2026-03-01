# FMD-FRAMEWORK-v2 Maintainability + Reliability Backlog (Claude Code–Ready)

## A) Repo map (1–2 pages)

### 1) Key directories and what they do
- `src/`: Primary Fabric assets (Data Pipelines, Notebooks, SQL DB artifact, variable libraries, environment definitions). Most runtime behavior is encoded in `src/*/*.json` and `src/*/notebook-content.py` files.
- `setup/`: Deployment notebooks (`NB_SETUP_FMD.ipynb`, `NB_SETUP_BUSINESS_DOMAINS.ipynb`) used as bootstrap source-of-truth for environment creation and item provisioning.
- `config/`: Deployment metadata and GUID maps (`item_config.yaml`, `item_deployment*.json`, `lakehouse_deployment.json`, `id_registry.json`) that drive or document environment-specific wiring.
- `scripts/`: Automation and diagnostics scripts for deployment patching, SQL stored-proc deployment, OneLake checks, pipeline diagnostics, and monitoring.
- Repo-root Python scripts (for example `deploy_from_scratch.py`, `finalize_deployment.py`, `diag_*.py`): ad-hoc operational/deployment tooling, often with duplicated auth and environment assumptions.
- `docs/`: Glossary and selected setup docs (for example gateway connections).
- `dashboard/`: Dashboard/mockup/API code for operational UI concepts and local API helpers.

### 2) Main runtime components
- **Orchestration pipelines**:
  - `PL_FMD_LOAD_ALL`: top-level orchestration that invokes landing → bronze → silver and writes start/fail/end audit records.
  - `PL_FMD_LOAD_LANDINGZONE`: gets source connection types from control metadata, then routes to command pipelines via a `Switch` inside `ForEach`.
  - `PL_FMD_LDZ_COMMAND_*`: per-connection-type command pipelines (ASQL, ADLS, ADF, SFTP, FTP, ONELAKE, NOTEBOOK, ORACLE), each dispatching to one or more copy pipelines.
  - `PL_FMD_LDZ_COPY_*`: copy execution pipelines with SQL lookup, audit proc calls, copy activities, post-processing updates.
- **Transformation notebooks**:
  - `NB_FMD_LOAD_LANDING_BRONZE` and `NB_FMD_LOAD_BRONZE_SILVER` do medallion transformation/loading and call audit helpers.
  - `NB_FMD_UTILITY_FUNCTIONS` centralizes utility helpers used by notebooks via `%run`.
- **Control/metadata plane assumptions**:
  - Pipelines query `[execution].[vw_LoadSourceToLandingzone]`, `[execution].[sp_GetBronzelayerEntity]`, `[execution].[sp_GetSilverlayerEntity]` and write to `[logging].[sp_AuditPipeline]` / `[logging].[sp_AuditCopyActivity]`.
  - Additional scripts (`deploy_signal_procs.py`) alter execution procs to “signal mode” to avoid payload-size limits.
- **Deployment/ops tooling**:
  - Deployment docs rely heavily on notebook-run setup and manual connection/workspace prep.
  - Multiple scripts perform post-deployment ID substitution and diagnostics (rather than one unified deployment path).

### 3) Execution flow (SQL Server table → OneLake/Lakehouse)
1. **Top-level trigger** starts `PL_FMD_LOAD_ALL` which audits start and invokes landing ingestion.
2. `PL_FMD_LOAD_LANDINGZONE` reads control metadata (`vw_LoadSourceToLandingzone`), then loops source connection types and invokes corresponding `PL_FMD_LDZ_COMMAND_*` pipelines.
3. `PL_FMD_LDZ_COMMAND_ASQL` (for SQL sources) loops entity rows and invokes `PL_FMD_LDZ_COPY_FROM_ASQL_01`.
4. `PL_FMD_LDZ_COPY_FROM_ASQL_01` reads per-entity retrieval SQL (`item().SourceDataRetrieval`) and copies to landing OneLake files (Parquet), with copy-level audit start/end/fail calls.
5. `PL_FMD_LOAD_BRONZE` requests bronze entity notebook payload (currently via signal proc pattern in some environments) and executes `NB_FMD_LOAD_LANDING_BRONZE`.
6. `PL_FMD_LOAD_SILVER` requests silver entity notebook payload and executes `NB_FMD_LOAD_BRONZE_SILVER`.
7. Each major pipeline writes logging entries via `[logging].[sp_AuditPipeline]`; notebooks log via `[logging].[sp_AuditNotebook]`.

---

## B) “Why this is hard to hand off” — diagnosed from code

### 1) Dynamic variables and expression sprawl
- Pipelines use dense expression chains (`@pipeline()`, `@activity()`, `@item()`) extensively across orchestration/copy steps, making failure reasoning difficult without deep Fabric expression fluency.
- Quick scan count: 22 pipeline definitions and 1,343 expression references across pipeline JSON files.
- Complex nested orchestration (`ForEach` + `Switch` + `InvokePipeline`) in landing-zone router pipeline creates many possible execution paths and edge cases.

### 2) Brittle ID/GUID and environment coupling
- Source JSON and config files contain hardcoded GUIDs for workspaces, item IDs, and connection IDs.
- Deployment scripts maintain large static template→real mapping tables per workspace, introducing drift risk after re-deployments.
- Production/dev values are mixed in scripts and config, increasing accidental cross-environment impact risk.

### 3) Secrets and tenant credentials are embedded in-repo
- Sensitive values appear in variable library definitions and operational scripts (client secret, tenant/client IDs, SQL endpoint), creating security and handoff governance risk.
- Different scripts source secrets inconsistently (some from `.env`, others hardcoded), increasing operational fragility.

### 4) Logging exists but is inconsistent and sometimes low-signal
- Audit procs are broadly called, but many entries use static messages (`"BRZ failed"`, `"SLV failed"`, `"Failed"`) and omit rich context (source entity, query, activity output digest).
- Some payload strings appear malformed/trailing-comma JSON in expression strings, which can reduce downstream parseability.

### 5) Retry/timeout/error strategy is non-uniform
- Many critical activities are set to `retry: 0` with short timeouts, while some lookups/procs retry 2x, creating unpredictable resilience behavior.
- Top-level pipeline uses `Completed` dependencies in places where stricter success gates may be expected, making run outcome interpretation harder.

### 6) Operational knowledge is distributed across ad-hoc scripts
- There are many `diag_*` and one-off scripts with overlapping purpose, no canonical “first tool to run,” and varied assumptions.
- This increases the need for “tribal knowledge” and slows incident triage.

### 7) Startup/preflight validation is missing as a first-class step
- There is no single mandatory preflight that validates required connections, variable libraries, SQL reachability, workspace roles, and pipeline dependencies before execution.
- Current deployment docs include important prerequisites, but enforcement is manual.

### 8) SQL Server→OneLake bulk copy path is powerful but fragile under scale
- Copy source SQL is fully metadata-driven (`item().SourceDataRetrieval`), but no standard chunking/partitioning profile is enforced for high-volume tables.
- `partitionOption` often set to `None`, which risks long-running monolithic copies.

### 9) Notebook/proc “signal mode” reliability pattern is under-documented
- `deploy_signal_procs.py` introduces core behavior changes (signal payload + notebook SQL fetch) to bypass payload limits, but this is not represented as a mandatory architectural mode in deployment/runbooks.

### 10) Handoff docs exist but are broad; step-by-step operations are incomplete
- Deployment docs explain prerequisites/configs but do not provide detailed operator runbooks for common incidents (retry semantics, backfill, targeted reprocess, connection drift, failed entity replay).

---

## C) Backlog: exhaustive, Claude Code–ready tasks (main output)

### 1) Observability & Debuggability

#### [P0] Standardize run-correlation envelope in all pipeline audit calls
- **Outcome:** Every pipeline/copy/notebook audit row can be joined by `PipelineRunGuid`, parent run, entity, activity, and source identifiers.
- **Why (evidence):** Audit calls are widespread but unevenly populated and often pass `PipelineParameters: null`, reducing traceability.
- **Scope:** Update audit payload composition only (no DB schema change in this task).
- **Where to change:** `src/PL_*.DataPipeline/pipeline-content.json`, `src/NB_FMD_LOAD_LANDING_BRONZE.Notebook/notebook-content.py`, `src/NB_FMD_LOAD_BRONZE_SILVER.Notebook/notebook-content.py`.
- **Implementation steps:**
  - Define a shared JSON envelope spec (`Action`, `Layer`, `EntityId`, `SourceName`, `ConnectionType`, `ActivityName`, `ErrorSummary`, `RunGuid`).
  - Update Start/End/Fail audit activity `LogData` expressions to include envelope fields.
  - Ensure fail branches include activity error output where available.
  - Add one SQL query doc snippet showing join across pipeline/copy/notebook logs.
- **Acceptance criteria:**
  - A single failed entity run can be traced end-to-end with one SQL query.
  - `PipelineParameters` and `LogData` are non-null for all Start/Fail rows in a sample run.
- **Risks/roll-back:** Higher payload size in log rows; rollback by reverting expression changes.
- **Effort:** M, **can be done in ~1 hour?** No → split into per-layer child tasks.

#### [P1] Add “failure summary” activity after each ForEach fan-out
- **Outcome:** Operators see one summarized failure record instead of hunting through many child runs.
- **Why (evidence):** Current fail logs often contain generic text (`BRZ failed`, `SLV failed`) without per-entity context.
- **Scope:** Add summary lookup/scripted-proc call only; keep existing fail activities.
- **Where to change:** `src/PL_FMD_LOAD_ALL.DataPipeline/pipeline-content.json`, `src/PL_FMD_LOAD_LANDINGZONE.DataPipeline/pipeline-content.json`, `src/PL_FMD_LDZ_COMMAND_*.DataPipeline/pipeline-content.json`.
- **Implementation steps:**
  - Add post-loop activity that aggregates failed child invocations and writes structured log JSON.
  - Include counts: total entities, succeeded, failed, skipped; include top N failed entity IDs/names.
- **Acceptance criteria:**
  - On injected failure, one summary log row exists with counts and failed entities.
- **Risks/roll-back:** Added activity could fail; configure `continueOnError` pattern or fallback to existing behavior.
- **Effort:** S, **can be done in ~1 hour?** Yes.

#### [P1] Create canonical diagnostics CLI wrapper (`fmd_diag.py`)
- **Outcome:** Customer has one entry point for run diagnosis instead of many ad-hoc scripts.
- **Why (evidence):** Many overlapping scripts exist (`diag_pipeline_run.py`, `diag_fmd.py`, `diag_ldz_failure.py`, `scripts/live_monitor.py`, etc.).
- **Scope:** Wrapper only; initially call existing scripts/functions.
- **Where to change:** New `scripts/fmd_diag.py`, update `Readme.md`/ops docs.
- **Implementation steps:**
  - Add subcommands: `preflight`, `run-summary`, `entity-failures`, `connections`, `onelake-check`.
  - Route to existing logic modules with consistent output formatting.
  - Add `--workspace`, `--run-id`, `--since` options.
- **Acceptance criteria:**
  - One command produces a concise run diagnosis from recent run.
- **Risks/roll-back:** Interface churn; keep legacy scripts intact during transition.
- **Effort:** M, **can be done in ~1 hour?** No → split wrapper + 1–2 subcommands first.

#### [P2] Build SQL view for “single pane” execution status
- **Outcome:** One query/view powers dashboard and support triage.
- **Why (evidence):** Current monitoring logic joins runtime data ad hoc in scripts.
- **Scope:** SQL view and documentation; dashboard integration optional.
- **Where to change:** SQL deployment scripts (`finalize_deployment.py` or dedicated `.sql` file), docs.
- **Implementation steps:**
  - Create view combining pipeline/copy/notebook audit tables with derived status.
  - Add helper query examples by run-id and by entity.
- **Acceptance criteria:**
  - Operators can answer “what failed and why” from one view in <5 minutes.
- **Risks/roll-back:** SQL performance if view is heavy; add indexes or restrict time window.
- **Effort:** M, **can be done in ~1 hour?** No.

### 2) Pipeline Simplification

#### [P0] Parameter contract sheet + validation for command/copy pipelines
- **Outcome:** Pipeline contracts become explicit and safer to modify.
- **Why (evidence):** Deeply nested `item()` field usage (for example in ASQL copy pipeline) implies hidden metadata contract.
- **Scope:** Documentation + runtime validation fail-fast at pipeline start.
- **Where to change:** `src/PL_FMD_LDZ_COMMAND_*.DataPipeline/pipeline-content.json`, `src/PL_FMD_LDZ_COPY_*.DataPipeline/pipeline-content.json`, docs.
- **Implementation steps:**
  - Define required fields per entity record (`EntityId`, `SourceDataRetrieval`, `ConnectionGuid`, etc.).
  - Add early guard activity to validate non-null required fields.
  - Add clear `Fail` message pointing missing field name.
- **Acceptance criteria:**
  - Missing metadata field fails in first minute with explicit message.
- **Risks/roll-back:** Could reject currently tolerated partial metadata; allow temporary bypass flag.
- **Effort:** M, **can be done in ~1 hour?** No → implement ASQL first.

#### [P1] Replace repeated audit activity blocks with reusable pipeline template pattern
- **Outcome:** Less copy-paste JSON, fewer drift bugs.
- **Why (evidence):** Near-identical Start/End/Fail audit blocks repeated across many pipelines.
- **Scope:** Introduce helper child pipeline(s) for audit operations; call via `InvokePipeline`.
- **Where to change:** All `src/PL_*.DataPipeline/pipeline-content.json`.
- **Implementation steps:**
  - Create `PL_FMD_AUDIT_EVENT` pipeline with standardized parameters.
  - Replace direct proc calls where safe.
  - Keep migration incremental per layer.
- **Acceptance criteria:**
  - At least 3 pipelines migrated with identical behavior in run logs.
- **Risks/roll-back:** Extra invocation overhead; rollback per pipeline.
- **Effort:** L, **can be done in ~1 hour?** No → split per pipeline family.

#### [P1] Normalize dependency semantics (`Succeeded` vs `Completed`) in orchestration
- **Outcome:** Run status becomes deterministic and easier to reason about.
- **Why (evidence):** `PL_FMD_LOAD_ALL` chains major phases using `Completed`, allowing downstream phase execution after upstream failure.
- **Scope:** Review and adjust dependency conditions with explicit fail-branch handling.
- **Where to change:** `src/PL_FMD_LOAD_ALL.DataPipeline/pipeline-content.json`.
- **Implementation steps:**
  - Change phase links to `Succeeded` unless explicit compensation path exists.
  - Keep fail-audit branches attached to `Failed`.
  - Add test run matrix for expected branching.
- **Acceptance criteria:**
  - Bronze failure prevents Silver execution unless override flag is set.
- **Risks/roll-back:** Existing workflows may rely on current behavior; add optional parameter `continue_on_failure`.
- **Effort:** S, **can be done in ~1 hour?** Yes.

#### [P2] Collapse connection-type router switch into metadata-driven dispatch table
- **Outcome:** New source types require data change, not major JSON edits.
- **Why (evidence):** `PL_FMD_LOAD_LANDINGZONE` has many hardcoded switch cases with repeated invoke blocks.
- **Scope:** Maintain current pipeline IDs but map connection type → pipeline in metadata/config.
- **Where to change:** `src/PL_FMD_LOAD_LANDINGZONE.DataPipeline/pipeline-content.json`, control metadata SQL objects.
- **Implementation steps:**
  - Add dispatch metadata table/view.
  - Replace switch with lookup + generic invoke pattern.
  - Include default route for unknown types with clear error.
- **Acceptance criteria:**
  - Add one new connection type without editing pipeline JSON.
- **Risks/roll-back:** Dispatch metadata errors can break routing; keep old switch path behind flag initially.
- **Effort:** L, **can be done in ~1 hour?** No.

### 3) Reliability & Performance

#### [P0] Define and apply retry policy matrix by activity type
- **Outcome:** Transient failures recover automatically; deterministic retries across pipelines.
- **Why (evidence):** Many critical activities use `retry: 0` while others retry 2, indicating inconsistent resilience.
- **Scope:** Policy standardization only (not changing business logic).
- **Where to change:** All `src/PL_*.DataPipeline/pipeline-content.json`.
- **Implementation steps:**
  - Create matrix (Lookup, SP call, Copy, InvokePipeline, Notebook).
  - Apply retries/backoff (for example retries 3 with progressive intervals for transient operations).
  - Exclude non-idempotent steps unless guarded.
- **Acceptance criteria:**
  - JSON lint/check script confirms policy conformance for all activities.
- **Risks/roll-back:** Longer run duration; tune per activity class.
- **Effort:** M, **can be done in ~1 hour?** No.

#### [P0] Idempotent re-run guard for copy pipelines
- **Outcome:** Safe restart after partial failures without duplicating or corrupting downstream state.
- **Why (evidence):** Copy pipelines update process status and last-load values via multiple steps; failures between steps can leave inconsistent state.
- **Scope:** Guard at entity-level: detect already successful copy for run/entity and short-circuit.
- **Where to change:** `src/PL_FMD_LDZ_COPY_*.DataPipeline/pipeline-content.json`, relevant SQL logging/execution procs.
- **Implementation steps:**
  - Add pre-copy check SP/Lookup: if entity already marked complete for run/version, skip copy.
  - Ensure post-copy updates are transactional or compensating.
  - Emit explicit `SkippedAlreadyProcessed` audit log.
- **Acceptance criteria:**
  - Rerunning failed pipeline does not re-copy successful entities.
- **Risks/roll-back:** False skip if status stale; include override parameter.
- **Effort:** L, **can be done in ~1 hour?** No.

#### [P1] Add high-volume copy partition strategy for ASQL path
- **Outcome:** Better throughput and reduced long-running copy failures for large SQL tables.
- **Why (evidence):** ASQL copy uses `partitionOption: None` and dynamic retrieval SQL, risking monolithic extraction.
- **Scope:** Add metadata-driven partitioning options for eligible entities.
- **Where to change:** `src/PL_FMD_LDZ_COPY_FROM_ASQL_01.DataPipeline/pipeline-content.json`, source metadata contract.
- **Implementation steps:**
  - Add metadata fields for partition column/bounds/chunk size.
  - Configure copy source partition settings when fields are present.
  - Keep non-partitioned fallback.
- **Acceptance criteria:**
  - Large-table benchmark shows improved throughput and stable completion.
- **Risks/roll-back:** Wrong partition config can duplicate/miss rows; add validation and reconciliation count checks.
- **Effort:** M, **can be done in ~1 hour?** No.

#### [P1] Watermark governance: enforce format + update integrity
- **Outcome:** Incremental loads become predictable and auditable.
- **Why (evidence):** Last-load lookup/update occurs, but naming and update sequencing are inconsistent (e.g., typo-like `SP_UPDATE_LASTLOADVALIE` label).
- **Scope:** Standardize naming, types, and update sequencing for watermark logic.
- **Where to change:** `src/PL_FMD_LDZ_COPY_*.DataPipeline/pipeline-content.json`, execution stored procs.
- **Implementation steps:**
  - Define canonical watermark schema per source type.
  - Enforce parse/validate before copy starts.
  - Update watermark only after copy + downstream status success.
- **Acceptance criteria:**
  - No watermark advance on failed copy.
  - Watermark values pass format checks.
- **Risks/roll-back:** Existing entities may have legacy values; add migration script.
- **Effort:** M, **can be done in ~1 hour?** No.

#### [P2] Schema drift handling policy per medallion layer
- **Outcome:** Controlled response to source schema changes (fail-fast vs auto-add).
- **Why (evidence):** Dynamic metadata-driven ingestion implies schema change risk; no clear repo-level policy document.
- **Scope:** Policy + minimal implementation hooks in copy/notebook stages.
- **Where to change:** Notebook load code, source onboarding docs, pipeline checks.
- **Implementation steps:**
  - Decide per layer behavior (Landing permissive, Bronze controlled, Silver strict).
  - Add pre-load schema comparison and actionable fail message.
  - Document operator remediation workflow.
- **Acceptance criteria:**
  - Simulated new column triggers documented behavior.
- **Risks/roll-back:** Too strict policy can block ingestion; start in warn mode.
- **Effort:** L, **can be done in ~1 hour?** No.

### 4) Config & Environment Hardening

#### [P0] Remove secrets from repo and switch to runtime secret providers
- **Outcome:** Handoff-ready security posture and lower credential leakage risk.
- **Why (evidence):** Client secrets exist in variable library and scripts; several scripts hardcode tenant/client/secret values.
- **Scope:** Replace secrets with env vars/key vault refs; rotate exposed credentials.
- **Where to change:** `src/VAR_FMD.VariableLibrary/variables.json`, root and `scripts/*.py` auth blocks, deployment docs.
- **Implementation steps:**
  - Replace hardcoded secrets with environment lookup and explicit error if missing.
  - Purge secrets from committed files and history remediation guidance.
  - Add `.env.example` and secure loading policy.
- **Acceptance criteria:**
  - No clear-text secret patterns in repo scan.
  - All scripts run with env-provided secrets.
- **Risks/roll-back:** Initial setup friction; provide migration checklist.
- **Effort:** M, **can be done in ~1 hour?** No.

#### [P0] Introduce centralized runtime config schema + validator
- **Outcome:** One validated source for environment IDs/endpoints/connection IDs.
- **Why (evidence):** IDs are duplicated across `item_config.yaml`, pipeline JSON defaults, and scripts.
- **Scope:** Add config schema and validator tool; initial adoption in critical scripts.
- **Where to change:** `config/`, deployment scripts, diagnostics scripts.
- **Implementation steps:**
  - Define JSON schema for required config fields.
  - Add `python scripts/validate_config.py`.
  - Update top scripts to fail-fast on invalid/missing config.
- **Acceptance criteria:**
  - Validator catches missing/placeholder GUIDs and inconsistent workspace references.
- **Risks/roll-back:** Initial false positives; iterate schema exceptions.
- **Effort:** M, **can be done in ~1 hour?** No.

#### [P1] Preflight pipeline/script before any load run
- **Outcome:** Prevents avoidable failures from missing connections/permissions.
- **Why (evidence):** Deployment docs list prerequisites manually; no mandatory pre-run gate.
- **Scope:** Add one script and optional pipeline stage.
- **Where to change:** new `scripts/preflight_fmd.py`, update `PL_FMD_LOAD_ALL` optional first step.
- **Implementation steps:**
  - Validate connection IDs exist and are authorized.
  - Validate variable library values not placeholders.
  - Validate SQL DB reachability and critical procs/views availability.
- **Acceptance criteria:**
  - Preflight returns non-zero with actionable errors when any prerequisite is missing.
- **Risks/roll-back:** Extra runtime step; make toggleable.
- **Effort:** S, **can be done in ~1 hour?** Yes.

#### [P1] Eliminate default workspace GUID parameter values in production pipelines
- **Outcome:** Reduces accidental cross-workspace execution.
- **Why (evidence):** `PL_FMD_LOAD_LANDINGZONE` has a concrete default `Data_WorkspaceGuid` value.
- **Scope:** Remove defaults where environment-specific; pass explicitly from parent.
- **Where to change:** `src/PL_FMD_LOAD_LANDINGZONE.DataPipeline/pipeline-content.json`, parent invoke activities.
- **Implementation steps:**
  - Remove default values for env-sensitive parameters.
  - Add validation fail if parameter missing.
- **Acceptance criteria:**
  - Pipeline cannot run without explicit workspace parameter.
- **Risks/roll-back:** Some ad-hoc manual runs may fail until updated.
- **Effort:** S, **can be done in ~1 hour?** Yes.

### 5) Operational Runbooks & Guardrails

#### [P0] Author operator runbook: “Onboard new SQL source”
- **Outcome:** Customer can onboard without expert intervention.
- **Why (evidence):** Tooling exists (e.g., metadata posting pipeline, SQL scripts) but operator sequence is scattered.
- **Scope:** Step-by-step runbook with commands, expected outputs, rollback.
- **Where to change:** new `docs/runbooks/onboard-sql-source.md`.
- **Implementation steps:**
  - Capture prerequisites, metadata registration, validation queries, and first dry-run.
  - Include exact pipeline/script invocations.
- **Acceptance criteria:**
  - A new operator can onboard a test source using only the runbook.
- **Risks/roll-back:** Documentation drift; include version/date and ownership.
- **Effort:** S, **can be done in ~1 hour?** Yes.

#### [P0] Author troubleshooting runbook for Fabric Pipeline failures
- **Outcome:** Faster incident triage with deterministic checklist.
- **Why (evidence):** Existing failures are generic and diagnostics are fragmented across scripts.
- **Scope:** Decision tree for common failures (connection auth, SQL timeout, missing metadata, notebook failure).
- **Where to change:** new `docs/runbooks/troubleshoot-pipeline-failures.md`.
- **Implementation steps:**
  - Create “symptom → query/script → fix” table.
  - Include known Fabric API/job-instance checks and SQL log queries.
- **Acceptance criteria:**
  - On a seeded failure, operator resolves within documented steps.
- **Risks/roll-back:** Needs periodic update with new failure modes.
- **Effort:** S, **can be done in ~1 hour?** Yes.

#### [P1] Author reprocessing/backfill runbook with safety guards
- **Outcome:** Safe partial re-runs and historical reloads.
- **Why (evidence):** Idempotency/watermark behavior is non-trivial and currently implicit.
- **Scope:** Process docs + optional script helpers.
- **Where to change:** new `docs/runbooks/reprocess-and-backfill.md`.
- **Implementation steps:**
  - Define entity selection, watermark reset rules, and verification queries.
  - Add rollback checklist if backfill quality checks fail.
- **Acceptance criteria:**
  - Team can execute targeted reprocess of single entity and verify consistency.
- **Risks/roll-back:** Human error in watermark resets; add confirmation steps.
- **Effort:** S, **can be done in ~1 hour?** Yes.

#### [P2] “Set it and forget it” operations SLO/SLA definition
- **Outcome:** Clear operational expectations and alert thresholds.
- **Why (evidence):** Current docs do not define explicit run success thresholds, max lag, or alerting targets.
- **Scope:** Operational policy doc + minimal metric query set.
- **Where to change:** new `docs/operations/slo-sla.md`.
- **Implementation steps:**
  - Define daily success rate target, max entity lag, retry budget.
  - Provide SQL/API queries to measure SLOs.
- **Acceptance criteria:**
  - Weekly report can be produced from defined metrics.
- **Risks/roll-back:** Overly strict thresholds; calibrate during pilot.
- **Effort:** S, **can be done in ~1 hour?** Yes.

### 6) Test & CI Safety Net

#### [P0] Add pipeline JSON lint + policy checks in CI
- **Outcome:** Prevents regressions in retry policy, parameter defaults, and forbidden hardcoded IDs.
- **Why (evidence):** Pipeline JSON is primary runtime logic and currently manually validated.
- **Scope:** Lightweight static checks only.
- **Where to change:** new `scripts/lint_pipelines.py`, CI workflow file.
- **Implementation steps:**
  - Validate JSON parses.
  - Enforce retry/timeout policy matrix.
  - Flag default workspace GUIDs and placeholder unresolved IDs.
- **Acceptance criteria:**
  - CI fails on introduced policy violations.
- **Risks/roll-back:** Noise from strict checks; start warn mode then enforce.
- **Effort:** M, **can be done in ~1 hour?** No.

#### [P1] Add deployment smoke-test script for clean workspace
- **Outcome:** Confidence that deployment scripts work in fresh tenant/workspace context.
- **Why (evidence):** Current deployment path is partly notebook/manual and partly script-based.
- **Scope:** Minimal create/list/validate cycle for key artifacts.
- **Where to change:** `deploy_from_scratch.py` and/or new `scripts/smoke_deploy.py`.
- **Implementation steps:**
  - Add dry-run and smoke-run modes.
  - Validate existence of core items and key connections after run.
- **Acceptance criteria:**
  - Smoke script completes in clean test workspace and reports pass/fail matrix.
- **Risks/roll-back:** API quota/time cost; keep scope minimal.
- **Effort:** M, **can be done in ~1 hour?** No.

#### [P1] Add unit tests for config parsing and auth bootstrap helpers
- **Outcome:** Safer refactoring of scripts and fewer runtime auth errors.
- **Why (evidence):** Auth/bootstrap code is duplicated with inconsistent secret-loading paths.
- **Scope:** Test helper modules only.
- **Where to change:** new `scripts/lib/` helpers + `tests/`.
- **Implementation steps:**
  - Refactor shared token/config code.
  - Add tests for missing env, malformed config, and expected endpoint construction.
- **Acceptance criteria:**
  - Test suite passes locally and in CI.
- **Risks/roll-back:** Initial refactor touches many scripts; migrate incrementally.
- **Effort:** M, **can be done in ~1 hour?** No.

#### [P2] Add contract tests for control metadata views/procs used by pipelines
- **Outcome:** Detects DB contract drift before runtime failure.
- **Why (evidence):** Pipelines depend on specific procs/views (`vw_LoadSourceToLandingzone`, `sp_Get*Entity`) and parameter shapes.
- **Scope:** SQL-level checks and expected-column assertions.
- **Where to change:** new SQL test scripts under `scripts/` and CI step.
- **Implementation steps:**
  - Validate existence/signatures for required procs/views.
  - Validate result schema fields consumed by pipeline expressions.
- **Acceptance criteria:**
  - CI fails if proc/view contract changes incompatibly.
- **Risks/roll-back:** Requires test DB access; allow local/manual mode initially.
- **Effort:** M, **can be done in ~1 hour?** No.

---

## D) Top 10 Quick Wins (do these first)

1. **[P0] Remove secrets from repo and switch to runtime secret providers.**
2. **[P0] Add pipeline JSON lint + policy checks in CI.**
3. **[P0] Parameter contract sheet + validation for command/copy pipelines (start with ASQL path).**
4. **[P1] Normalize dependency semantics in `PL_FMD_LOAD_ALL` (`Succeeded` vs `Completed`).**
5. **[P1] Add preflight script and make it required before production runs.**
6. **[P1] Add failure summary activity after each major fan-out.**
7. **[P1] Eliminate default workspace GUID parameter values in production pipelines.**
8. **[P0] Author troubleshooting runbook for pipeline failures.**
9. **[P0] Author onboarding runbook for new SQL source.**
10. **[P0] Define and apply retry policy matrix across all pipeline activities.**

---

## E) Optional: AGENTS.md recommendation

### Proposed location
- `/workspace/FMD-FRAMEWORK-v2/AGENTS.md`

### Draft AGENTS.md content
```md
# AGENTS.md — FMD-FRAMEWORK-v2

## Scope
Applies to entire repository.

## Goal
Keep FMD deployment/runtime assets reliable, reproducible, and handoff-friendly for customer operators.

## Repo conventions
- Pipelines are source-of-truth in `src/*/pipeline-content.json`.
- Avoid hardcoded environment IDs/secrets in committed files.
- Any pipeline change must keep logging/audit compatibility (`sp_AuditPipeline`, `sp_AuditCopyActivity`, `sp_AuditNotebook`).
- Any new source onboarding/change must include runbook update in `docs/runbooks/`.

## Required checks before commit
1. JSON validation of changed `pipeline-content.json` files.
2. Config validation script (`scripts/validate_config.py`) passes.
3. Secret scan: no plaintext client secrets/passwords introduced.
4. For orchestration changes, include dependency-condition review (`Succeeded`/`Failed`/`Completed`).

## Pipeline design guardrails
- Prefer explicit parameter contracts; fail fast on missing required fields.
- Keep retry/timeout policy consistent by activity class.
- Add structured failure context to all fail-audit branches.
- Keep idempotency in mind: reruns must not duplicate successful entity loads.

## Documentation guardrails
- Update relevant runbook for any operational behavior change.
- Add “How to validate” section to PR notes for pipeline/script changes.
```

### Why this AGENTS.md helps
- It encodes non-obvious operational constraints (audit compatibility, idempotency, secret hygiene) into every future coding-agent session.
- It prevents recurring drift between runtime assets and operator documentation.

---

## Evidence index (sample files reviewed)
- `Readme.md`
- `FMD_FRAMEWORK_DEPLOYMENT.md`
- `FMD_BUSINESS_DOMAIN_DEPLOYMENT.md`
- `HANDOFF_DEPLOYMENT_SCRIPT.md`
- `config/item_config.yaml`, `config/item_deployment.json`
- `src/PL_FMD_LOAD_ALL.DataPipeline/pipeline-content.json`
- `src/PL_FMD_LOAD_LANDINGZONE.DataPipeline/pipeline-content.json`
- `src/PL_FMD_LDZ_COMMAND_ASQL.DataPipeline/pipeline-content.json`
- `src/PL_FMD_LDZ_COPY_FROM_ASQL_01.DataPipeline/pipeline-content.json`
- `src/VAR_FMD.VariableLibrary/variables.json`
- `src/VAR_CONFIG_FMD.VariableLibrary/variables.json`
- `src/NB_FMD_LOAD_LANDING_BRONZE.Notebook/notebook-content.py`
- `scripts/deploy_pipelines.py`
- `scripts/deploy_signal_procs.py`
- `scripts/live_monitor.py`
