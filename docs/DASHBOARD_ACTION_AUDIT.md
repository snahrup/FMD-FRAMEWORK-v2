# FMD Dashboard Action Audit

Last updated: 2026-04-24

This audit tracks the user-facing pages and primary actions that must either work, be clearly disabled, or be removed as the dashboard moves to Dagster-backed real loading.

## Current Decisions

| Area | Page | Primary Actions | Status | Decision |
|---|---|---|---|---|
| Estate | `/overview` | Navigate to load, source, catalog, alert surfaces | Working | Keep |
| Estate | `/orchestration-story`, `/story` | Demo walkthrough navigation | Working | Keep; aliases added |
| Estate | `/estate`, `/data-estate` | Data estate KPIs | Needs API validation | Keep; alias added |
| Load | `/load-center` | Load/run entry points | Needs real-mode guard review | Keep |
| Load | `/sources`, `/source-manager` | Source/entity management | Working with existing APIs | Keep; alias added |
| Monitor | `/load-mission-control`, `/mission-control` | New run, stop, open load center, retry, resume | Partially hardened | Keep; run-type selector added; real loads disabled unless framework mode |
| Monitor | `/matrix`, `/execution-matrix` | Source/layer matrix inspection | Needs route smoke | Keep; alias added |
| Monitor | `/errors` | Failure triage | Needs route smoke | Keep |
| Monitor | `/logs`, `/execution-log` | Execution log inspection | Needs route smoke | Keep; alias added |
| Monitor | `/engine` | Engine settings/actions | Needs button review against Dagster mode | Keep but disable legacy-only actions where needed |
| Monitor | `/control` | Control plane management | Needs route smoke | Keep |
| Monitor | `/control-plane` | Alias to Control Plane | Wired | Redirects to `/control` |
| Monitor | `/live` | Live monitor | Needs route smoke | Keep |
| Monitor | `/validation` | Layer validation | Needs route smoke | Keep |
| Monitor | `/notebook-debug`, `/pipeline-testing` | Pipeline testing | Needs Dagster-mode review | Keep; alias added |
| Dagster | `/dagster` | Embedded Dagster overview | Wired | Keep |
| Dagster | `/dagster/runs` | Embedded run history | Wired | Keep |
| Dagster | `/dagster/catalog`, `/dagster/assets` | Embedded asset/catalog page | Wired to `/assets` | Keep |
| Dagster | `/dagster/jobs` | Embedded jobs page | Wired | Keep |
| Dagster | `/dagster/automation`, `/dagster/schedules`, `/dagster/sensors` | Embedded automation page | Wired to `/automation` | Keep |
| Dagster | `/dagster/lineage`, `/dagster/asset-graph` | Embedded asset graph | Wired to `/asset-graph` | Keep |
| Dagster | `/dagster/deployment`, `/dagster/locations` | Embedded code locations | Wired to `/locations` | Keep |
| Explore | `/replay` | Transformation replay | Demo works; real data wiring needed | Keep; real data dropdown must only list actual loaded entities |

## Button-Level Changes Made

| Button / Control | Previous Behavior | New Behavior |
|---|---|---|
| Load Mission Control: `Bulk Snapshot Mode` | Looked like a default start option but did not explain how it interacts with Dagster dry-run/framework mode | Replaced with explicit run-type cards: Orchestration Check, Real Scoped Load, Real Smoke Load, Full Estate Load |
| Load Mission Control: `Start Pipeline` | Could start a broad dry-run that looked like a real load | Disabled unless selected run type is valid; real scoped load requires framework mode and selected source scope |
| Load Mission Control: real run launch | Could attempt framework mode without proving machine/source readiness | Real run launch is blocked until `Run Preflight` passes |
| Load Mission Control: failed launch | Failures were mostly console-only | Modal now shows the backend error or preflight failure reason in the UI |
| Load Mission Control runtime badge | Not present | Shows `Dagster dry run` or `Dagster framework` next to run status |
| Dagster embedded page selector | Relied on left navigation and iframe internals | FMD now exposes Overview, Runs, Catalog, Jobs, Automation, Lineage, and Deployment tabs above the iframe |

## Remaining Button Review Targets

These pages still need a click-through pass after framework smoke is validated:

- `/load-center`
- `/engine`
- `/control`
- `/live`
- `/validation`
- `/notebook-debug`
- `/replay`
- `/dagster/*`

## Static Placeholder Findings

Static scan still found existing non-Dagster placeholders outside the new real-loader flow:

- `ControlPlane`: maintenance action is disabled and now has visible reason text because backend endpoints are pending.
- `ColumnEvolution`, `DataJourney`, and `FlowExplorer`: Gold/future-layer copy still says `coming soon`.
- `ConfigManager`: Fabric deployment copy still says dashboard deployment is coming soon.
- `DataBlender` table profiler has a placeholder Purview link.

These are not launch blockers for the Dagster real-loader path, but they should be removed or replaced before calling the entire dashboard production-complete.

## Rule Going Forward

No button remains in the UI unless it satisfies one of these:

1. It performs a real action and displays the result.
2. It navigates to a real, routed page.
3. It is disabled with visible reason text explaining exactly what prerequisite is missing.
4. It is removed.
