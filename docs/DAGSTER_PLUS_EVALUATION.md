# Dagster+ Evaluation

Use this file as the running journal for the trial.

The purpose is not just to say whether Dagster+ is good or bad. The purpose is to identify exactly which parts are worth keeping, which parts are merely convenient, and which parts we would need to replace in an OSS or custom-control-plane future.

## Feature Rubric

Classification labels:
- must_clone
- nice_to_have
- not_needed
- actively_disliked

Portability labels:
- portable_now
- portable_with_adapter
- dagster_plus_only

## Trial Log

### 2026-04-21 — Prod local agent heartbeat established on VSC-Fabric

Activity:
- Dagster+ prod local agent heartbeat established successfully on VSC-Fabric.

What looked good:
- Hosted control plane connected cleanly once the local agent was running.
- The deployment model was understandable enough to use as a fast bootstrap.

What looked risky:
- Local agent on a raw host clearly needs service supervision and monitoring.
- Hosted control plane convenience does not remove the need for disciplined runtime ownership.

Classification:
- Agent/deployment connectivity: nice_to_have, portable_with_adapter

### 2026-04-21 — First code location registration via dagster-cloud deployment sync-locations

Activity:
- Registered the fmd_orchestrator code location against Dagster+ prod using a user API token and dagster_cloud.yaml.
- The local agent picked up the change and launched the code location in a subprocess using the project venv via executable_path.
- Materialized both trivial assets using the CLI.

What looked good:
- YAML-driven registration is reproducible and git-trackable.
- Agent picked up the change quickly enough to iterate on.
- executable_path cleanly decouples the agent venv from the project venv.
- CLI launch path is usable for smoke tests and CI.
- Error messages were concrete enough to diagnose quickly.

What looked risky:
- Two token types are easy to confuse: agent token vs user API token.
- The user token is broadly scoped and should not be the long-term CI path.
- package_name was a gotcha; module_name is the safer explicit default.
- __ASSET_JOB works but should not be treated as a stable contract.
- CLI warning noise will need filtering in automation.
- executable_path and working_directory are host-specific absolute paths.

Classification:
- Code location registration workflow: nice_to_have, portable_with_adapter

### 2026-04-21 — NSSM service wrap for the prod local agent

Activity:
- Wrapped the Dagster+ prod local agent in an NSSM Windows service.
- Verified the service starts automatically, survives shell/RDP exit, and can execute probe_assets_job successfully.

What looked good:
- local-agent + NSSM is viable for this environment
- heartbeat survives session exit
- restart behavior, delay, and log rotation can be managed at the host level
- explicit probe_assets_job succeeded through the NSSM-managed agent
- this gives a realistic bootstrap production posture on VSC-Fabric

What looked risky:
- the supervision burden remains ours; Dagster+ does not remove host/process ownership
- running as LocalSystem is acceptable for bootstrap but not ideal long-term
- secrets stored through service environment/registry need documented rotation procedures
- service config and executable paths remain host-specific

Classification:
- NSSM-wrapped local agent service model: nice_to_have, portable_with_adapter
