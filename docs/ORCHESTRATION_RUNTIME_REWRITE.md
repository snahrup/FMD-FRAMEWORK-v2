# Orchestration Runtime Rewrite

## Purpose

This document defines the cut line for the orchestration-runtime rewrite on
branch `rewrite/orchestration-runtime`.

Read this before changing `engine/api.py`, worker lifecycle code, or any
execution-state table writes.

## Why This Exists

The current engine is failing in ways that a normal retry loop cannot fix:

- Worker processes die without a durable terminal handoff.
- `stop` and `abort` update SQLite/UI state without owning the real worker.
- Declared run timeouts are not enforced at the run-supervisor level.
- Bronze and Silver can run even when Landing failed or never completed for the
  current run.
- Native-heavy paths such as ConnectorX extraction and Delta writes can kill the
  process underneath the Python orchestration layer.

This is not a patch-only situation. The runtime contract itself has to change.

## Rewrite Scope

### Keep

- Control-plane database schema and existing run/task history
- Dashboard/API surface area where practical
- Entity metadata model in `engine/models.py`
- Landing extraction business logic
- Bronze and Silver transformation logic
- Self-heal and diagnostics as downstream consumers

### Replace

- Detached worker ownership model in `engine/worker.py`
- Run lifecycle management in `engine/orchestrator.py`
- API start/stop/abort execution semantics in `engine/api.py`
- Retry and rerun scoping logic
- Timeout, heartbeat, and watchdog ownership
- Downstream layer gating

### Explicit Non-Goals

- Rewriting the dashboard UI
- Replacing the control-plane DB with a new persistence layer
- Rewriting all extract/transform logic before the supervisor exists
- Committing to a hosted orchestrator vendor in phase 1

## Target Runtime Contract

The replacement runtime must guarantee all of the following:

1. Every run has exactly one durable owner.
2. Every run reaches exactly one terminal state:
   `succeeded`, `failed`, `aborted`, or `interrupted`.
3. Every layer consumes only entities that succeeded in the prior layer of the
   same run.
4. Native-risk work executes in isolated subprocesses with hard timeouts and
   captured stderr/stdout.
5. User aborts are real control signals, not just metadata updates.
6. Reruns are scoped to known failed or missing work, never optimistic global
   retries.
7. Retries and resumes are child runs with lineage back to the parent run; a
   terminal run row is never reopened in place.

## V2 Architecture

### 1. API Adapter

The existing dashboard entry points stay, but `engine/api.py` becomes an
adapter, not the owner of execution.

Responsibilities:

- Validate and normalize `RunRequest`
- Persist the initial queued run record
- Hand off to the supervisor
- Return run metadata only

### 2. Run Supervisor

One supervisor owns one run.

Responsibilities:

- Transition run state durably
- Maintain heartbeat and timeout deadlines
- Spawn layer tasks in subprocesses
- Capture terminal reasons when a subprocess dies
- Enforce aborts and stops

### 3. Layer Scope Resolver

This becomes a first-class runtime component.

Rules:

- Bronze scope = Bronze entities whose `lz_entity_id` succeeded in Landing for
  the current run
- Silver scope = Silver entities whose `bronze_entity_id` succeeded in Bronze
  for the current run
- Missing upstream data blocks downstream execution instead of silently
  widening scope

### 4. Task Executors

Task executors run risky work in isolated processes:

- Landing extract/upload executor
- Bronze merge/write executor
- Silver merge/write executor
- Optional notebook/pipeline executor

If a task process dies, the supervisor records a real task failure and
continues or terminates according to policy.

### 5. Repository Layer

All writes to `engine_runs`, `engine_task_log`, and related state tables must go
through a repository layer with explicit transition rules.

The runtime is not allowed to write ad hoc terminal state SQL from multiple
places anymore.

### 6. Run Lineage

Retries and resumes create new `engine_runs` rows with:

- `ParentRunId` = the source run
- `RunKind` = `retry` or `resume`

This keeps the original terminal run immutable while allowing recovery work to
be tracked as first-class execution history.

## Implementation Phases

### Phase 0

- Write the cut plan
- Add runtime-v2 contracts and tests
- Add layer gating utilities
- Add state-transition rules

### Phase 1

- Introduce repository + supervisor skeleton
- Keep existing API routes but route them into new contracts
- No UI changes required

### Phase 2

- Move landing execution behind subprocess ownership
- Make abort and timeout enforcement real
- Record terminal status from the supervisor only

### Phase 3

- Move Bronze and Silver behind the same subprocess contract
- Add rerun policies and scoped recovery

### Phase 4

- Retire legacy detached-worker path

## Immediate Design Decisions

- Prefect remains an option, but phase 0 does not depend on it.
- The runtime contract is designed so a future Prefect adapter is possible
  without moving business logic out of this repo.
- ConnectorX stays isolated behind an executor boundary because it has already
  shown native panic behavior in production logs.
