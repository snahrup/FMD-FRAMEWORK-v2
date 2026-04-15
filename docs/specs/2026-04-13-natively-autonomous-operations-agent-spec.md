
**Date:** 2026-04-13  
**Audience:** Codex agent working inside the `Natively` repository  
**Status:** Draft for implementation handoff  
**Primary reference use case:** `FMD_FRAMEWORK` pipeline monitoring, diagnosis, repair, restart, and completion notification

## 1. Executive Summary

`Natively` should evolve from "an AI-enabled desktop shell" into a resident, permissioned operations agent that can observe user context, infer when takeover is appropriate, execute bounded work loops, and notify the user only when meaningful milestones or blockers occur.

The first production-grade reference workflow should be the FMD pipeline control loop:
- user indicates that a clean load run is required
- Natively starts or resumes the pipeline
- Natively monitors run state and logs in real time
- Natively detects failures and triages them from actual artifacts
- Natively applies bounded fixes when policy allows
- Natively verifies that the fix did not create adjacent regressions
- Natively retries or resumes the pipeline
- Natively repeats until the run is clean or a hard policy boundary is reached
- Natively notifies the user with outcome, evidence, and next action

This spec is not asking Natively to become an unconstrained autonomous actor. It is asking for a deterministic, inspectable, policy-bound agent runtime that can take over operational loops the user should not have to supervise manually.

## 2. Problem Statement

The current user workflow is wasteful:
- user sees failure on screen
- user copies screenshots, logs, and ad hoc context into a chat session
- the model has to reconstruct state manually
- diagnosis starts late because evidence is fragmented
- fixes are disconnected from the actual runtime loop
- user remains the orchestration layer between observation, reasoning, action, and validation

That is the wrong abstraction.

If Natively is the always-open desktop application, then the user expectation is reasonable:
- Natively should already know what app is active
- Natively should already know what long-running task is in progress
- Natively should already know where the relevant logs, APIs, health checks, and artifacts live
- Natively should be able to decide whether this is a case for passive observation, assisted triage, or autonomous takeover

The user should not be acting as a human middleware layer between:
- the screen
- the logs
- the codebase
- the task state
- the model

## 3. Product Thesis

Natively should be a **resident execution agent**, not just a conversational interface.

That means it must combine:
- observation
- intent inference
- task memory
- deterministic tools
- policy enforcement
- artifact-backed validation
- notification discipline

The product win is not "it can answer questions about what is on screen."
The product win is:

> "It noticed what I was trying to accomplish, took over the repetitive operational loop, and only interrupted me when it had a result, a policy boundary, or a real blocker."

## 4. Goals

### 4.1 Primary Goals

1. Allow Natively to observe active application context continuously.
2. Allow Natively to infer likely user goals from context, recency, and explicit instructions.
3. Allow Natively to enter a bounded autonomous task loop for known workflows.
4. Allow Natively to execute tools, scripts, commands, and code changes safely.
5. Allow Natively to validate its own work before claiming success.
6. Allow Natively to notify the user only when something materially changed.
7. Make every decision auditable via artifacts, event logs, and run history.

### 4.2 Secondary Goals

1. Reuse the same runtime model across many app adapters.
2. Let product teams add app-specific adapters without changing Natively core.
3. Make policy and autonomy levels configurable per workflow.
4. Support Codex, Claude Code, or other frontier coding agents as the reasoning worker behind the same runtime.

## 5. Non-Goals

1. This is not a general spyware-style always-record-everything system.
2. This is not unrestricted OS automation with silent destructive privileges.
3. This is not "the model may patch anything at any time."
4. This is not a replacement for explicit human approval on high-risk actions.
5. This is not an excuse to hide evidence behind clever summaries.

## 6. User Stories

### 6.1 FMD Operations Story

As an engineering operator running the FMD pipeline:
- I want Natively to know a load run is active.
- I want Natively to watch the real logs and health endpoints without me copying anything.
- I want Natively to diagnose failure causes from real evidence.
- I want Natively to apply low-risk fixes automatically when policy allows.
- I want Natively to verify pipeline truth after each correction.
- I want Natively to rerun the job until it passes or hits an explicit boundary.
- I want one concise notification when the clean run is done.

### 6.2 Debugging Story

As a developer:
- I want to point Natively at a repo and tell it "own this loop."
- I want to declare the deterministic checks that define success.
- I want artifacts persisted so another agent can pick up where the last one left off.

### 6.3 Workday Story

As a user working across many tools:
- I want Natively to notice when I am waiting on a long-running task.
- I want Natively to monitor it in the background.
- I want to stop narrating context repeatedly.
- I want to trust that the right logs, screens, and files will already be captured.

## 7. Reference Workflow: FMD as the First Adapter

FMD is the right first adapter because it already has:
- explicit HTTP control endpoints
- structured run state
- structured task logs
- a real-time SSE log stream
- a pipeline-integrity verifier
- restart, retry, and cleanup controls
- a codebase where fixes can be applied and tested

### 7.1 Existing FMD Capabilities

FMD already exposes:
- `GET /api/engine/status`
- `POST /api/engine/start`
- `POST /api/engine/resume`
- `POST /api/engine/retry`
- `POST /api/engine/abort-run`
- `POST /api/engine/cleanup-runs`
- `GET /api/engine/logs`
- `GET /api/engine/logs/stream`
- `GET /api/pipeline-integrity`

FMD also has:
- per-run worker log files
- task-level evidence in SQLite
- code-level repair surface in the same repo

That means FMD is already adapter-ready. Natively should consume those capabilities through an app adapter, not by scraping the screen first and hoping for the best.

## 8. Core Requirements

### 8.1 Resident Runtime

Natively must run a resident process that remains alive throughout the workday and manages:
- app focus changes
- registered workflow watchers
- conversation context
- permission state
- notification routing
- background task registry

### 8.2 Observation Layer

Natively must support these observation sources:
- foreground window metadata
- DOM/app accessibility tree where available
- periodic screenshots of approved windows
- optional microphone capture with speech-to-text
- clipboard observation only if explicitly enabled
- file system change signals for watched repos/artifact folders
- app-specific adapters that provide structured state directly

Observation priority order:
1. structured app adapter data
2. local artifacts and logs
3. accessibility tree / DOM state
4. screenshots
5. speech / clipboard

The system should prefer structured truth over screen interpretation whenever possible.

### 8.3 Goal and Intent Inference

Natively must maintain a current goal model per active workflow. It should infer probable goals from:
- explicit user requests
- recent commands
- active app and route
- observed repeated patterns
- open task list / pinned goals
- active long-running processes

Example:
- active window: FMD dashboard
- route: Load Mission Control
- current engine status: running or interrupted
- recent instruction: "nothing else matters until we get a clean run"

Inference:
- active goal = `achieve_clean_pipeline_run`
- mode = `autonomous_takeover_allowed_with_boundaries`

### 8.4 Workflow Registry

Natively core must support pluggable workflow definitions.

Each workflow definition must declare:
- workflow ID
- human label
- supported apps/adapters
- trigger signals
- success criteria
- blocking conditions
- allowed tool classes
- required evidence sources
- escalation rules
- notification policy

Example workflow IDs:
- `fmd.clean_load_run`
- `fmd.retry_failed_entities`
- `fmd.pipeline_truth_audit`
- `repo.long_running_test_watch`
- `fabric.deployment_monitor`

## 9. App Adapter Model

Natively needs a first-class adapter interface so product-specific logic lives outside the core.

### 9.1 Adapter Responsibilities

Each adapter should provide:
- app detection
- structured state extraction
- known workflows
- known commands
- known health checks
- known artifact locations
- known policy boundaries

### 9.2 Adapter Contract

Proposed TypeScript interface:

```ts
export interface AppAdapter {
  id: string;
  matchesContext(ctx: DesktopContext): Promise<boolean>;
  getStructuredState(ctx: DesktopContext): Promise<AppState>;
  listWorkflows(ctx: DesktopContext): Promise<WorkflowDescriptor[]>;
  canAutostartWorkflow(workflowId: string, state: AppState): Promise<boolean>;
  buildWorkflowContext(workflowId: string, state: AppState): Promise<WorkflowContext>;
  getEvidence(workflowId: string, state: AppState): Promise<EvidenceBundle>;
  getActions(workflowId: string, state: AppState): Promise<AdapterActionSet>;
}
```

### 9.3 FMD Adapter Responsibilities

The FMD adapter should know:
- how to detect the repo and running dashboard
- how to query engine status
- how to query integrity truth
- how to locate worker log files
- how to start, resume, retry, or abort runs
- how to classify low-risk vs high-risk fixes
- how to invoke repo-local watchdog and verification scripts

## 10. Deterministic Work Loop Model

The core runtime needs a reusable autonomous loop abstraction.

### 10.1 Loop Stages

Every autonomous loop should be explicit:

1. Observe
2. Interpret
3. Decide
4. Act
5. Validate
6. Continue, escalate, or stop

### 10.2 Generic Loop Contract

```ts
export interface AutonomousLoop {
  loopId: string;
  goalId: string;
  autonomyLevel: "observe" | "assist" | "bounded-auto" | "approval-required";
  observe(): Promise<Observation>;
  decide(observation: Observation): Promise<Decision>;
  act(decision: Decision): Promise<ActionResult>;
  validate(result: ActionResult): Promise<ValidationResult>;
  shouldContinue(validation: ValidationResult): Promise<boolean>;
  shouldEscalate(validation: ValidationResult): Promise<boolean>;
}
```

### 10.3 FMD Clean Run Loop

The FMD reference loop should behave like this:

1. Get engine status.
2. If no run is active and goal requires a clean run, start one.
3. While run is active:
   - stream logs
   - read structured task failures
   - refresh integrity snapshot
   - update artifact bundle
4. If run fails:
   - classify failure
   - determine whether automated fix is allowed
   - if allowed, patch and test
   - if validation passes, resume or retry
   - if not allowed, escalate with evidence
5. If run finishes:
   - run final integrity verification
   - if integrity fails, reopen loop
   - if integrity passes, mark goal complete and notify

### 10.4 Hard Requirement: Validation After Every Mutation

Natively must never:
- patch code
- alter config
- restart a run
- mark success

without running the declared validation suite for that workflow.

For FMD that means:
- app/API health
- engine status sanity
- pipeline-integrity verification
- targeted tests for changed code

## 11. Autonomy Levels

Autonomy must be explicit and visible.

### 11.1 Levels

1. `observe`
   - watch only
   - no actions
2. `assist`
   - prepare diagnosis and recommended steps
   - no actions without user trigger
3. `bounded-auto`
   - may execute predefined safe actions
   - must remain inside policy envelope
4. `approval-required`
   - may prepare a patch or action plan
   - must ask before execution

### 11.2 FMD Default Policy

Recommended default for FMD:
- monitoring: `bounded-auto`
- cleanup stale runs: `bounded-auto`
- resume interrupted run: `bounded-auto`
- retry failed entities: `bounded-auto`
- patch code: `approval-required` by default
- destructive database mutation: `approval-required`
- force-abort active run: `approval-required`

## 12. Safety and Policy Engine

Natively needs a policy engine that decides whether an action is allowed before the model takes it.

### 12.1 Policy Inputs

- workflow ID
- repo/app adapter
- action type
- target files
- target commands
- environment
- current autonomy level
- current user presence
- historical outcomes

### 12.2 Policy Outputs

- allow
- allow-with-confirmation
- deny
- escalate

### 12.3 Example Policy Rules

Allow automatically:
- reading logs
- polling APIs
- refreshing status artifacts
- running non-destructive verifiers
- resuming a run already marked interrupted

Require confirmation:
- editing application code
- changing engine configuration
- deleting rows
- aborting a healthy active run
- applying schema changes

## 13. Evidence Model

Natively must reason from an explicit evidence bundle, not ad hoc narrative.

### 13.1 Evidence Sources

Each loop iteration should persist:
- structured state snapshot
- recent logs
- recent failures
- user-visible screen context
- commands executed
- diffs applied
- test results
- validation results

### 13.2 Evidence Bundle Schema

```ts
export interface EvidenceBundle {
  capturedAt: string;
  sources: EvidenceSource[];
  structuredState?: Record<string, unknown>;
  artifacts: ArtifactRef[];
  screenshots?: ScreenshotRef[];
  logs?: LogSlice[];
  validation?: ValidationRef[];
}
```

### 13.3 First-Class Artifact Discipline

Every workflow should write a stable artifact directory so later invocations can continue without context reconstruction.

For FMD:
- `artifacts/load-watchdog/status.json`
- `artifacts/load-watchdog/status.md`
- `artifacts/load-watchdog/worker-tail.log`
- `artifacts/pipeline-integrity.json`

Natively should generalize that pattern:
- one stable folder per live workflow
- one canonical state file
- one human-readable summary
- one evidence index

## 14. Notification Model

The notification system must be disciplined. Noise kills trust.

### 14.1 Notify Only On

- workflow started
- workflow blocked
- policy boundary hit
- material error encountered
- fix applied and validated
- workflow completed

### 14.2 Do Not Notify On

- every polling cycle
- every log line
- minor transient retries
- background heartbeats

### 14.3 Notification Payload

Each notification should include:
- workflow name
- current state
- concise result
- link/open action to detailed artifact bundle

Example:

> FMD clean-load loop completed. Run `abcd1234` finished cleanly. Integrity PASS. 1 code patch applied, 7 tests passed.

## 15. Screen and Audio Monitoring Requirements

The user explicitly expects always-on observation. That requires a real permissioned design.

### 15.1 Screen Capture

Natively should support:
- active-window capture
- periodic snapshots
- user-visible indicator that capture is enabled
- per-app allow/deny list
- screenshot retention policy

### 15.2 Audio Capture

Optional microphone mode should support:
- push-to-talk
- always-listening only when explicitly enabled
- local VAD/speech detection
- speech-to-text event stream into current goal model

### 15.3 Privacy Boundary

The user must be able to:
- pause observation
- scope observation to one app
- disable mic separately from screen
- view what is currently being captured
- clear retained artifacts

## 16. Task Takeover UX

Natively must make takeover explicit but low-friction.

### 16.1 Required States

- `watching`
- `understands goal`
- `ready to take over`
- `taking over`
- `working in background`
- `needs approval`
- `blocked`
- `completed`

### 16.2 User Controls

- Take over this task
- Always take over this workflow for this app
- Watch only
- Pause automation
- Escalate only on blocker
- Require approval for code edits

### 16.3 Trust Requirement

The user must always be able to answer:
- What is Natively doing right now?
- Why is it doing that?
- What evidence is it using?
- What will it do next?

## 17. Conversation and Memory Model

Natively needs durable workflow memory independent of the chat thread.

### 17.1 Memory Tiers

1. Session memory
   - current focus
   - latest user requests
   - current workflow
2. Workflow memory
   - goal
   - iterations
   - evidence
   - action history
3. Repo memory
   - known commands
   - known logs
   - known validation rules
4. User preference memory
   - autonomy preferences
   - notification style
   - approval boundaries

### 17.2 Resume Requirement

If the user says:
- "check the log"
- "what happened"
- "continue"

Natively should reopen the current workflow memory and not require restatement of context.

## 18. FMD Adapter Detailed Requirements

### 18.1 Detection

The FMD adapter should activate when any of these are true:
- active repo path matches `FMD_FRAMEWORK`
- foreground window matches the FMD dashboard
- dashboard API is live and project root is known
- user has pinned `fmd.clean_load_run` as an active goal

### 18.2 Structured State Queries

The adapter must pull:
- engine status
- last run summary
- current run ID
- run detail
- recent task failures
- pipeline-integrity summary
- worker log tail

### 18.3 Known Actions

The adapter should register these actions:
- `refresh_status`
- `cleanup_stale_runs`
- `start_run`
- `resume_run`
- `retry_failed_entities`
- `open_worker_log`
- `run_integrity_verifier`
- `run_repo_tests`
- `apply_repo_patch`

### 18.4 Success Criteria

For `fmd.clean_load_run`, success means:
- terminal run status is not failed/interrupted/aborted
- integrity summary latestFullChain == inScope
- integrity summary historicalOnly == 0
- no new code changes are left unvalidated

## 19. Core Architecture

### 19.1 Proposed Services

1. `DesktopContextService`
   - focused window
   - open app identity
   - repo detection
   - capture state
2. `ObservationService`
   - screenshots
   - audio STT
   - accessibility extraction
3. `WorkflowRegistry`
   - workflow descriptors
   - trigger matching
4. `PolicyEngine`
   - action authorization
5. `LoopRunner`
   - observation → action → validation loop
6. `ArtifactStore`
   - state bundles
   - logs
   - diffs
7. `NotificationService`
   - desktop notifications
   - in-app notifications
8. `AdapterHost`
   - app-specific adapters

### 19.2 Recommended Directory Shape

```text
src/
  core/
    context/
    observation/
    policy/
    loops/
    notifications/
    artifacts/
    memory/
  adapters/
    fmd/
      adapter.ts
      workflows/
        clean-load-run.ts
      evidence/
      actions/
      validators/
  ui/
    task-center/
    approvals/
    notifications/
```

## 20. Event Model

Natively should emit structured events for every iteration.

### 20.1 Example Event Types

- `workflow.detected`
- `workflow.started`
- `workflow.state_changed`
- `evidence.refreshed`
- `decision.made`
- `action.executed`
- `validation.completed`
- `policy.blocked`
- `workflow.completed`
- `workflow.failed`

### 20.2 Event Requirements

Every event should include:
- timestamp
- workflow ID
- app adapter ID
- correlation ID
- actor type (`system`, `user`, `agent`)
- artifact references

## 21. Validation and Testing

This system must be tested like an orchestration platform, not just a UI app.

### 21.1 Unit Tests

- adapter matching
- policy evaluation
- workflow trigger inference
- artifact serialization
- notification suppression logic

### 21.2 Integration Tests

- FMD adapter against mocked engine endpoints
- loop restart after transient failure
- resume after app restart
- notification dedupe
- approval flow handoff

### 21.3 End-to-End Tests

- active window switches to FMD
- Natively detects active load workflow
- Natively begins monitoring
- failure is simulated
- bounded fix is applied
- validation passes
- run resumes
- completion notification fires

### 21.4 Regression Tests

Required regression suites:
- no silent autonomous edits outside policy
- no unbounded notification spam
- no workflow orphaning after restart
- no success claim without validation artifact

## 22. Implementation Phases

### Phase 1: Adapter-First Background Monitoring

Deliver:
- resident workflow runner
- artifact store
- FMD adapter
- passive monitoring only
- manual takeover button

### Phase 2: Bounded Autonomous Loops

Deliver:
- workflow registry
- policy engine
- FMD clean-load loop
- notifications
- restart/resume/retry automation

### Phase 3: Screen and Audio Observation

Deliver:
- active-window capture
- screenshot summaries
- optional mic/STT
- context fusion with adapter data

### Phase 4: Multi-App Generalization

Deliver:
- adapter SDK
- app onboarding model
- reusable workflow primitives across repos/apps

## 23. Acceptance Criteria

### 23.1 Core Acceptance Criteria

1. Natively can remain active all day without losing workflow state.
2. Natively can detect an active FMD pipeline run without user re-explaining context.
3. Natively can keep a live artifact bundle current while the run is active.
4. Natively can notify on completion or blocker only.
5. Natively can resume its workflow after app restart.

### 23.2 FMD Acceptance Criteria

1. User says once: "Get me a clean run."
2. Natively starts or resumes the correct workflow.
3. Natively monitors actual engine state and logs.
4. If failure occurs, Natively produces a diagnosis from structured evidence and worker logs.
5. If the failure falls inside policy, Natively patches and validates automatically.
6. Natively reruns until success or policy boundary.
7. Natively ends with a concise artifact-backed notification.

## 24. Open Questions

1. Should screen capture be core or adapter-provided?
2. Should audio observation be local-only or service-backed?
3. How should multi-model routing work between Codex, Claude, and smaller local models?
4. Where should approval prompts live when the user is away from keyboard?
5. What is the retention policy for screenshots and audio transcripts?
6. Should workflows be repo-scoped, app-scoped, or user-scoped by default?

## 25. Codex Implementation Instructions

If you are a Codex agent implementing this inside `Natively`, do the work in this order:

1. Build the adapter interface and workflow registry first.
2. Build a durable artifact store and event log second.
3. Build the resident workflow runner third.
4. Implement the FMD adapter as the first real adapter.
5. Implement passive monitoring before autonomous mutation.
6. Add policy enforcement before any code-edit or restart capability.
7. Add notifications only after artifact-backed state transitions exist.
8. Add screen/audio observation after structured adapters are already working.

Do not start with:
- generic LLM chat improvements
- UI polish
- screenshot analysis as the primary source of truth
- unconstrained autonomy

Start with:
- deterministic adapter contracts
- workflow state machine
- policy and validation
- FMD end-to-end operational loop

## 26. Final Product Statement

The target behavior is simple to describe:

> Natively notices the work that matters, owns the repetitive operational loop, proves what it did with artifacts, and only interrupts the user when it has a real result or a real boundary.

That is the bar.
