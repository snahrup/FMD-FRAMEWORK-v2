# AUDIT-SETTINGS-SETUP-LABS — V2 Whole-App Forensic Audit

**Session**: SETTINGS-SETUP-LABS
**Date**: 2026-04-08
**Scope**: Admin Gateway (grouped), Settings (grouped), Environment Setup (grouped), Labs stubs (4 pages)
**Type**: READ-ONLY truth audit — no code changes

---

## Table of Contents

1. [GRP-001: Admin Gateway](#grp-001-admin-gateway)
2. [GRP-002: Settings](#grp-002-settings)
3. [GRP-003: Environment Setup](#grp-003-environment-setup)
4. [LAB-001: CleansingRuleEditor](#lab-001-cleansingruleeditor)
5. [LAB-002: ScdAudit](#lab-002-scdaudit)
6. [LAB-003: GoldMlvManager](#lab-003-goldmlvmanager)
7. [LAB-004: DqScorecard](#lab-004-dqscorecard)
8. [Cross-Cutting Findings](#cross-cutting-findings)
9. [Summary Scoreboard](#summary-scoreboard)

---

## GRP-001: Admin Gateway

**Route**: `/admin`
**Primary file**: `pages/AdminGateway.tsx` (~430 lines)
**Embedded components**: `AdminGovernance.tsx` (~690 lines), `Settings > GeneralTab` (named export), `settings/DeploymentManager.tsx` (~370 lines), `setup/SetupSettings.tsx` (~210 lines)
**Backend**: `api/routes/admin.py` (~150 lines)

### Architecture

AdminGateway is a **password-gated tabbed container** that aggregates 5 sub-panels under a single route. The user must authenticate via `POST /api/admin/auth` before any tab content is shown.

**Tabs**:
| Tab ID | Label | Component Rendered | Source |
|--------|-------|--------------------|--------|
| `environment` | Environment | `<EnvironmentTab />` (inline) | AdminGateway.tsx |
| `pages` | Page Visibility | `<PageVisibilityTab />` (inline) | AdminGateway.tsx |
| `general` | General | `<GeneralTab />` | Settings.tsx (named export) |
| `deployment` | Deployment | `<DeploymentManager />` | settings/DeploymentManager.tsx |
| `governance` | Governance | `<AdminGovernance />` | AdminGovernance.tsx |

### Findings

#### SSL-ADMIN-001 — Password stored in env var with no rate limiting (MEDIUM)

The admin auth flow calls `POST /api/admin/auth` which checks `os.environ.get("ADMIN_PASSWORD")`. There is no rate limiting, no lockout after N failures, and no session token — every protected operation re-checks the password. The password is passed in plaintext in the request body. The security fix note in `admin.py` says empty-string bypass was patched, which is good, but the auth model remains weak.

- **Backend**: `admin.py` line 43-47 — `_check_admin_password()` compares raw string
- **Frontend**: Password is held in component state (`useState<string>`) and passed to child tabs as props
- **Impact**: Low for internal tool, but a brute-force attack has no defense

#### SSL-ADMIN-002 — Environment tab duplicates SetupSettings without config persistence (LOW)

The "Environment" tab inside AdminGateway renders an `<EnvironmentTab />` component defined inline. This loads config via `GET /api/setup/current-config` and renders `<SetupSettings>` — the same component used by the Setup page (`/setup`). However, changes made here are held in local React state only; there is no save button or `POST` endpoint wired. The Setup page's SetupSettings also holds state in its parent — neither persists across page navigation unless the parent explicitly saves.

- **Risk**: User edits config in Admin > Environment tab, navigates away, loses changes silently
- **Dedup concern**: Same `SetupSettings` component rendered in two routes (`/admin` Environment tab, `/setup` Settings tab)

#### SSL-ADMIN-003 — Page Visibility tab uses admin password for every save (INFO)

`PageVisibilityTab` receives the admin password as a prop and sends it with every `POST /api/admin/config` call. This is consistent with the auth model (no session tokens) but means the password is transmitted repeatedly. The toggle list correctly renders all pages from `ALL_PAGES` array grouped by category.

- **Data flow**: `getHiddenPages()` reads from `GET /api/admin/config`, parses `hiddenPages` JSON array; `updateHiddenPages()` posts back
- **Backend**: `admin_config` table with `key/value` schema, CREATE IF NOT EXISTS on import

#### SSL-ADMIN-004 — ALL_PAGES array is manually maintained, risks drift (MEDIUM)

The `ALL_PAGES` constant in AdminGateway lists 25 page entries with `href`, `label`, and `group`. This is manually maintained and does NOT derive from the router or AppLayout's `CORE_GROUPS`. If a page is added to the router but not to `ALL_PAGES`, it becomes invisible to the Page Visibility feature.

- **Current count**: 25 entries across 5 groups (Operations, Data, Quality, Explore, Admin)
- **Router count**: 55 routes in App.tsx — significant gap (labs, gold studio, business portal pages all missing)

#### SSL-ADMIN-005 — Governance tab renders full AdminGovernance page (INFO)

The Governance tab simply renders `<AdminGovernance />` as a child. AdminGovernance itself is also a standalone page import but has no route of its own in App.tsx — it is only accessible via this tab. The component is ~690 lines and appears to contain real governance functionality (audit trail, approval workflows) wired to backend endpoints. See GRP-002 overlap note below.

---

## GRP-002: Settings

**Route**: `/settings`
**Primary file**: `pages/Settings.tsx` (~1127 lines)
**Sub-components**: `settings/DeploymentManager.tsx` (~370 lines), + 7 supporting files in `settings/` directory
**Backend**: `api/routes/admin.py`, `api/routes/config_manager.py`

### Architecture

Settings.tsx exports two things:
1. `GeneralTab` (named export, line 964) — used by AdminGateway
2. `Settings` (default export, line 1127) — the standalone `/settings` page

The Settings page has a **two-section layout**:
1. **General Settings** section (top) — `GeneralTab` component with font picker
2. **Labs Feature Flags** section — toggle switches for 4 experimental features
3. **Deploy Wizard** section (inline, ~500 lines) — complete deployment workflow embedded directly in Settings

### Findings

#### SSL-SET-001 — Massive component with 3 unrelated concerns (MEDIUM)

Settings.tsx is 1127 lines containing:
- General settings (font picker) — ~160 lines
- Labs feature flag toggles — ~100 lines
- A complete Deploy Wizard with config, preflight, confirm, running, done, and failed states — ~500+ lines
- Deploy field definitions, phase progress simulation, job polling — ~250 lines

The DeployWizard is a full multi-step workflow embedded inline in Settings.tsx, completely separate from the `settings/DeploymentManager.tsx` component. This means there are **two independent deployment UIs**:
1. `Settings.tsx` inline `DeployWizard` component (accessed via `/settings`)
2. `settings/DeploymentManager.tsx` (accessed via `/admin` > Deployment tab)

Both appear to target the same backend but have different UIs and different state management.

#### SSL-SET-002 — Duplicate deployment UIs with divergent implementations (HIGH)

| Feature | Settings.tsx DeployWizard | DeploymentManager.tsx |
|---------|--------------------------|----------------------|
| Config fields | `DEPLOY_FIELDS` array (7 fields) | `PreDeploymentPanel` component |
| Progress | Simulated phases via `DEPLOY_PHASES` timer | Real SSE stream via `EventSource` |
| Resume | No resume support | `ResumeBanner` with reconnect |
| Dry run | No dry run | `TestTube` dry run option |
| Cancel | No cancel | `StopCircle` cancel support |
| State machine | `DeployStep` type (7 states) | `UIState` type (6 states) |
| Progress display | Inline log messages | `PhaseProgressTracker` + `LiveLogPanel` |
| Post-deploy | Inline success/fail | `PostDeploymentSummary` component |

DeploymentManager.tsx is clearly the more mature implementation with SSE streaming, resume, dry-run, and cancel. The Settings.tsx DeployWizard appears to be an older version that was never removed.

**Risk**: User uses the Settings page wizard, gets inferior experience; or makes deployment changes via one UI that the other doesn't reflect.

#### SSL-SET-003 — Labs feature flags use localStorage only, no server sync (INFO)

Feature flags are stored in `localStorage` under key `fmd-labs-flags` via `lib/featureFlags.ts`. Four flags exist:
- `cleansingRuleEditor` (default: false)
- `scdAuditView` (default: false)
- `goldMlvManager` (default: false)
- `dqScorecard` (default: false)

A custom event `fmd-labs-changed` is dispatched on change so `AppLayout` can react. The flags control sidebar visibility (AppLayout lines 123-125, 166) but do **NOT** gate the routes themselves — all 4 lab routes in App.tsx are unconditionally rendered. Anyone with the URL can access them regardless of flag state.

#### SSL-SET-004 — Deploy phases are time-simulated, not real (MEDIUM)

The `DEPLOY_PHASES` array in Settings.tsx simulates progress by emitting log messages based on elapsed time (e.g., "after: 2 seconds, msg: Triggering setup notebook"). This is a fake progress indicator — actual notebook execution progress is not tracked. The real deployment flow in DeploymentManager.tsx uses SSE events for actual progress.

#### SSL-SET-005 — GeneralTab font picker works correctly (OK)

The `GeneralTab` component uses `FONT_OPTIONS` from `lib/fontSettings.ts` and applies font changes via `applyFont()` which sets the `--font-family` CSS variable. This follows the project's established pattern (ref: `font-selection-feature` in MEMORY.md). Changes persist to localStorage. No issues found.

---

## GRP-003: Environment Setup

**Route**: `/setup`
**Primary file**: `pages/EnvironmentSetup.tsx` (~130 lines)
**Sub-components**: `setup/ProvisionAll.tsx` (~450 lines), `setup/SetupWizard.tsx` (~120 lines), `setup/SetupSettings.tsx` (~210 lines), `setup/types.ts` (~90 lines)
**Wizard steps**: `setup/steps/CapacityStep.tsx`, `WorkspaceStep.tsx`, `ConnectionStep.tsx`, `LakehouseStep.tsx`, `DatabaseStep.tsx`, `ReviewStep.tsx`
**Shared components**: `setup/components/FabricDropdown.tsx`, `StepIndicator.tsx`, `ValidationResults.tsx`
**Backend**: `api/routes/admin.py` (endpoints: `/api/setup/current-config`, `/api/fabric/workspaces`, `/api/fabric/connections`, `/api/fabric/security-groups`)

### Architecture

EnvironmentSetup is a **3-mode tabbed interface**:

| Mode | Component | Purpose |
|------|-----------|---------|
| `provision` | `ProvisionAll` | One-click fresh environment creation |
| `wizard` | `SetupWizard` | 6-step guided configuration |
| `settings` | `SetupSettings` | Direct field-by-field editing |

State management: `EnvironmentConfig` is lifted to the parent (`EnvironmentSetup`) and passed down as props. All 3 modes share the same config object. On mount, config is loaded from `GET /api/setup/current-config`. If `workspaces.data_dev.id` exists, auto-switches to "settings" mode.

### Findings

#### SSL-SETUP-001 — Wizard flow is well-structured with proper validation gates (OK)

The `SetupWizard` component implements a 6-step flow:
1. **Capacity** — requires `config.capacity` to proceed
2. **Workspaces** — requires `config.workspaces.data_dev` (minimum)
3. **Connections** — optional, always allows proceed
4. **Lakehouses** — requires `config.lakehouses.LH_DATA_LANDINGZONE`
5. **Database** — optional
6. **Review** — always allows proceed

Step completion is tracked via `completedSteps: Set<WizardStep>`. Navigation uses `goNext()`/`goBack()` with `canProceed()` validation. `StepIndicator` provides visual progress. This is a clean implementation.

#### SSL-SETUP-002 — ProvisionAll calls /api/setup/provision-all but endpoint not found in admin.py (HIGH)

`ProvisionAll.tsx` sends `POST /api/setup/provision-all` with `{ capacityId, capacityDisplayName }`. However, scanning `admin.py` endpoints:
- `GET /api/health`
- `POST /api/admin/auth`
- `POST /api/admin/config`
- `GET /api/admin/config`
- `GET /api/fabric/workspaces`
- `GET /api/fabric/connections`
- `GET /api/fabric/security-groups`
- `GET /api/setup/current-config`

The `/api/setup/provision-all` endpoint is **not registered in admin.py**. It may exist in another route file, but the manifest assigns `admin.py` as the backend for setup. If this endpoint is missing, the "Provision Fresh Environment" feature silently fails with an HTTP error.

**Action needed**: Locate which route file registers `/api/setup/provision-all`, or confirm it is missing.

#### SSL-SETUP-003 — Config not auto-saved on wizard completion (MEDIUM)

The `SetupWizard` modifies the shared `EnvironmentConfig` via `onConfigChange()` callbacks, but the Review step (step 6) does not appear to trigger a save to the backend. The config lives in React state in the parent `EnvironmentSetup` component. If the user completes the wizard and navigates away without an explicit save action, all configuration is lost.

The `SetupSettings` mode similarly updates config in state but there is no visible "Save" button or auto-persist mechanism in the parent component.

#### SSL-SETUP-004 — ProvisionAll handles errors and completion well (OK)

The provision flow shows step-by-step progress with icons (creating/ok/error/warning), handles errors with retry button, and on success offers "Review in Settings" and "Open Fabric Portal" actions. The `configRef` stores the result for navigation. Idempotency is documented ("safe to run again"). Good UX.

#### SSL-SETUP-005 — FabricDropdown shared component used across all setup modes (OK)

`FabricDropdown` is a reusable async dropdown that fetches options from a given endpoint (`/api/fabric/workspaces`, etc.) with a `responseKey` to extract the array. Used consistently across CapacityStep, WorkspaceStep, ConnectionStep, LakehouseStep, DatabaseStep, and SetupSettings. Clean abstraction.

#### SSL-SETUP-006 — Type system is comprehensive and well-defined (OK)

`setup/types.ts` defines:
- `EnvironmentConfig` with all 7 config sections (capacity, workspaces, connections, lakehouses, notebooks, pipelines, database)
- `WIZARD_STEPS` constant with labels and descriptions
- `NAMING_CONVENTIONS` for default resource names
- `EMPTY_CONFIG` initializer
- Supporting interfaces: `FabricEntity`, `FabricCapacity`, `FabricSqlDatabase`, `FabricConnection`, `LakehouseAssignment`

All well-typed, no `any` usage. Clean.

---

## LAB-001: CleansingRuleEditor

**Route**: `/labs/cleansing`
**Primary file**: `pages/CleansingRuleEditor.tsx` (~900+ lines)
**Backend**: `api/routes/cleansing.py` (~300 lines)
**Manifest claim**: "Coming Soon stub (~48 lines)"

### Verdict: NOT A STUB — Fully implemented page

#### SSL-LAB-001 — Manifest is wrong: CleansingRuleEditor is a full implementation (HIGH — manifest error)

The manifest claims this is a "Coming Soon" stub of ~48 lines. In reality, `CleansingRuleEditor.tsx` is a **900+ line fully functional page** that:
- Uses `useEntityDigest` hook to load Silver-layer entities
- Fetches real cleansing rules from `/api/cleansing/rules/{entityId}`
- Supports CRUD: create, edit, delete rules with inline editing
- Has entity selector, rule type filtering, expand/collapse per rule
- Uses `EntitySelector` shared component
- Injects custom animation styles

**Backend** (`cleansing.py`, ~300 lines) has **real endpoints**:
- `GET /api/cleansing/rules/{entityId}` — fetch rules for an entity
- `POST /api/cleansing/rules` — create a new rule
- `PUT /api/cleansing/rules/{ruleId}` — update a rule
- `DELETE /api/cleansing/rules/{ruleId}` — delete a rule

This is a complete, functional feature gated behind a default-off feature flag.

---

## LAB-002: ScdAudit

**Route**: `/labs/scd-audit`
**Primary file**: `pages/ScdAudit.tsx` (~700+ lines)
**Backend**: `api/routes/scd_audit.py` (~280 lines)
**Manifest claim**: "Coming Soon stub (~48 lines)"

### Verdict: NOT A STUB — Fully implemented page

#### SSL-LAB-002 — Manifest is wrong: ScdAudit is a full implementation (HIGH — manifest error)

ScdAudit.tsx is a **700+ line fully functional page** that:
- Fetches SCD2 merge summary via `GET /api/scd/summary`
- Supports source filtering, pagination, search
- Shows per-entity Silver layer run history
- Displays insert/update/delete counts per run
- Has expandable detail rows for entity drill-down

**Backend** (`scd_audit.py`, ~280 lines) has **real endpoints**:
- `GET /api/scd/summary` — aggregate Silver stats per entity (latest run), with source/limit/offset
- `GET /api/scd/entity/{entityId}` — all Silver runs for one entity
- `GET /api/scd/runs` — Silver task log entries, optional run_id filter

All endpoints query real SQLite data from `engine_task_log` table (Silver layer entries).

---

## LAB-003: GoldMlvManager

**Route**: `/labs/gold-mlv`
**Primary file**: `pages/GoldMlvManager.tsx` (~800+ lines)
**Backend**: `api/routes/gold.py` (~200 lines)
**Manifest claim**: "Coming Soon stub (~48 lines)"

### Verdict: NOT A STUB — Fully implemented page

#### SSL-LAB-003 — Manifest is wrong: GoldMlvManager is a full implementation (HIGH — manifest error)

GoldMlvManager.tsx is an **800+ line fully functional page** that:
- Fetches Gold specs from `GET /api/gold/mlvs` with domain/status/type filters
- Fetches summary from `GET /api/gold/mlvs/summary`
- Shows type breakdown (MLVs, Views, Tables) in hero stats
- Supports expandable detail rows fetching `GET /api/gold/mlvs/{id}`
- Has domain summary cards, ratio bars (fact/dimension proportions)
- Includes search, pagination, sort
- Custom animation keyframes injected

**Backend** (`gold.py`, ~200 lines) has **real endpoints**:
- `GET /api/gold/mlvs/summary` — aggregate totals by type, domain, status
- `GET /api/gold/mlvs` — paginated list with domain/status/type filters
- `GET /api/gold/mlvs/{id}` — single spec detail with validation runs

All endpoints query real SQLite data from `gs_gold_specs` and `gs_canonical_entities` tables.

---

## LAB-004: DqScorecard

**Route**: `/labs/dq-scorecard`
**Primary file**: `pages/DqScorecard.tsx` (~700+ lines)
**Backend**: `api/routes/quality.py` (~170 lines)
**Manifest claim**: "Coming Soon stub (~48 lines)"

### Verdict: NOT A STUB — Fully implemented page

#### SSL-LAB-004 — Manifest is wrong: DqScorecard is a full implementation (HIGH — manifest error)

DqScorecard.tsx is a **700+ line fully functional page** that:
- Fetches quality scores from `GET /api/quality/scores` with tier filter and pagination
- Shows tier distribution bar (gold/silver/bronze/unclassified) with click-to-filter
- Displays per-entity quality breakdown: completeness, freshness, consistency, volume, composite
- Supports sort by any metric column
- Has a "Refresh" action that calls `POST /api/quality/refresh` to trigger full recomputation
- Tier filter tabs with counts

**Backend** (`quality.py`, ~170 lines) has **real endpoints**:
- `GET /api/quality/scores` — paginated quality scores with tier filter
- `GET /api/mdm/quality/scores` — alias for Business Portal
- `GET /api/quality/score/{entityId}` — single entity quality breakdown
- `POST /api/quality/refresh` — trigger full recomputation

All endpoints query real SQLite data from `quality_scores` table.

---

## Cross-Cutting Findings

### SSL-CROSS-001 — Labs routes are not gated by feature flags (MEDIUM)

All 4 lab pages are registered as unconditional routes in `App.tsx` (lines 146-149):
```
<Route path="/labs/cleansing" element={<CleansingRuleEditor />} />
<Route path="/labs/scd-audit" element={<ScdAudit />} />
<Route path="/labs/gold-mlv" element={<GoldMlvManager />} />
<Route path="/labs/dq-scorecard" element={<DqScorecard />} />
```

The feature flags in `lib/featureFlags.ts` only control **sidebar visibility** in AppLayout (lines 123-125, 166). Anyone with the direct URL can access any lab page regardless of whether the flag is enabled. If the intent is to truly gate these features, the routes should check the flag and redirect to a "feature not enabled" page.

### SSL-CROSS-002 — Admin, Settings, and Setup share components with no clear ownership (MEDIUM)

The same components appear in multiple routes with different parent contexts:

| Component | Used in `/admin` | Used in `/settings` | Used in `/setup` |
|-----------|:-:|:-:|:-:|
| `GeneralTab` | Environment tab imports it | Defined here (named export) | -- |
| `DeploymentManager` | Deployment tab | -- (has its own DeployWizard) | -- |
| `SetupSettings` | Environment tab | -- | Settings mode |
| `AdminGovernance` | Governance tab | -- | -- |

This creates confusion about where settings "live." A user could change font settings via `/admin` > General tab or `/settings` > General section. Both render the same `GeneralTab` but in different layout contexts.

### SSL-CROSS-003 — Two completely separate deployment workflows exist (HIGH)

As documented in SSL-SET-002:
1. `/settings` page contains an inline `DeployWizard` (~500 lines) with simulated progress
2. `/admin` > Deployment tab renders `DeploymentManager` with real SSE streaming

These are two different implementations of the same feature. The DeploymentManager is clearly the newer, more capable version. The Settings.tsx DeployWizard should be removed or replaced with a link/redirect to the Admin deployment tab.

### SSL-CROSS-004 — Manifest accuracy for Labs section is completely wrong (HIGH)

All 4 labs pages were classified as "Coming Soon stubs (~48 lines each)" in the manifest. In reality:
- CleansingRuleEditor: ~900+ lines, fully functional
- ScdAudit: ~700+ lines, fully functional
- GoldMlvManager: ~800+ lines, fully functional
- DqScorecard: ~700+ lines, fully functional

All 4 have real backend endpoints with real SQLite queries. None are stubs. The manifest needs correction.

### SSL-CROSS-005 — No config persistence layer between Setup modes (MEDIUM)

The three Setup modes (Provision, Wizard, Settings) share an `EnvironmentConfig` object in React state, but there is no auto-save or explicit save mechanism in the parent `EnvironmentSetup` component. Config loaded from `GET /api/setup/current-config` on mount, but changes made in any mode are lost on navigation unless the specific mode triggers a backend write (only ProvisionAll does this implicitly via its provision flow).

---

## Summary Scoreboard

| ID | Surface | Severity | Category | Summary |
|----|---------|----------|----------|---------|
| SSL-ADMIN-001 | AdminGateway | MEDIUM | Security | No rate limiting on admin auth, plaintext password |
| SSL-ADMIN-002 | AdminGateway | LOW | Architecture | Environment tab duplicates SetupSettings without save |
| SSL-ADMIN-003 | AdminGateway | INFO | Security | Password re-sent on every save (no session) |
| SSL-ADMIN-004 | AdminGateway | MEDIUM | Drift | ALL_PAGES array manually maintained, 25/55 routes covered |
| SSL-ADMIN-005 | AdminGateway | INFO | Architecture | Governance tab wraps full standalone component |
| SSL-SET-001 | Settings | MEDIUM | Architecture | 1127-line file with 3 unrelated concerns |
| SSL-SET-002 | Settings | HIGH | Duplication | Two divergent deployment UIs (inline vs DeploymentManager) |
| SSL-SET-003 | Settings | INFO | Feature flags | Labs flags localStorage-only, no server sync |
| SSL-SET-004 | Settings | MEDIUM | UX | Deploy progress is time-simulated, not real |
| SSL-SET-005 | Settings | OK | UX | Font picker works correctly |
| SSL-SETUP-001 | Setup | OK | Architecture | Wizard flow well-structured with validation |
| SSL-SETUP-002 | Setup | HIGH | Backend | /api/setup/provision-all endpoint not found in admin.py |
| SSL-SETUP-003 | Setup | MEDIUM | Data loss | Config not auto-saved on wizard completion |
| SSL-SETUP-004 | Setup | OK | UX | ProvisionAll error handling and completion UX |
| SSL-SETUP-005 | Setup | OK | Architecture | FabricDropdown shared component |
| SSL-SETUP-006 | Setup | OK | Architecture | Type system comprehensive |
| SSL-LAB-001 | CleansingRuleEditor | HIGH | Manifest | Not a stub — 900+ line full implementation |
| SSL-LAB-002 | ScdAudit | HIGH | Manifest | Not a stub — 700+ line full implementation |
| SSL-LAB-003 | GoldMlvManager | HIGH | Manifest | Not a stub — 800+ line full implementation |
| SSL-LAB-004 | DqScorecard | HIGH | Manifest | Not a stub — 700+ line full implementation |
| SSL-CROSS-001 | All Labs | MEDIUM | Security | Routes not gated by feature flags, only sidebar hidden |
| SSL-CROSS-002 | Admin/Settings/Setup | MEDIUM | Architecture | Shared components with no clear ownership |
| SSL-CROSS-003 | Settings/Admin | HIGH | Duplication | Two separate deployment workflows |
| SSL-CROSS-004 | All Labs | HIGH | Manifest | All 4 labs wrongly classified as stubs |
| SSL-CROSS-005 | Setup | MEDIUM | Data loss | No config persistence between Setup modes |

### Totals

| Severity | Count |
|----------|-------|
| HIGH | 8 |
| MEDIUM | 7 |
| LOW | 1 |
| INFO | 3 |
| OK | 5 |

### Files Audited

| File | Lines | Classification |
|------|-------|----------------|
| `pages/AdminGateway.tsx` | ~430 | REAL — tabbed admin container |
| `pages/AdminGovernance.tsx` | ~690 | REAL — governance panel |
| `pages/Settings.tsx` | ~1127 | REAL — settings + embedded deploy wizard |
| `pages/EnvironmentSetup.tsx` | ~130 | REAL — 3-mode setup orchestrator |
| `pages/CleansingRuleEditor.tsx` | ~900+ | REAL — full CRUD for cleansing rules |
| `pages/ScdAudit.tsx` | ~700+ | REAL — SCD2 merge audit viewer |
| `pages/GoldMlvManager.tsx` | ~800+ | REAL — Gold layer object browser |
| `pages/DqScorecard.tsx` | ~700+ | REAL — quality tier scorecard |
| `settings/DeploymentManager.tsx` | ~370 | REAL — SSE deployment manager |
| `settings/PreDeploymentPanel.tsx` | ~270 | REAL — deploy config panel |
| `settings/PhaseProgressTracker.tsx` | ~180 | REAL — phase progress UI |
| `settings/LiveLogPanel.tsx` | ~80 | REAL — streaming log viewer |
| `settings/PostDeploymentSummary.tsx` | ~140 | REAL — deploy results |
| `settings/ResumeBanner.tsx` | ~55 | REAL — resume failed deploy |
| `settings/AgentCollaboration.tsx` | ~350 | REAL — agent collab panel |
| `setup/ProvisionAll.tsx` | ~450 | REAL — one-click provisioning |
| `setup/SetupWizard.tsx` | ~120 | REAL — 6-step wizard |
| `setup/SetupSettings.tsx` | ~210 | REAL — field-by-field config |
| `setup/types.ts` | ~90 | Types — comprehensive config types |
| `setup/steps/*.tsx` (6 files) | ~120 avg | REAL — wizard step components |
| `setup/components/*.tsx` (3 files) | ~150 avg | REAL — shared setup UI |
| `lib/featureFlags.ts` | ~40 | REAL — localStorage flag management |
| `api/routes/admin.py` | ~150 | REAL — admin/setup/fabric endpoints |
| `api/routes/config_manager.py` | ~550 | REAL — config CRUD endpoints |
| `api/routes/cleansing.py` | ~300 | REAL — cleansing rule CRUD |
| `api/routes/scd_audit.py` | ~280 | REAL — SCD audit queries |
| `api/routes/quality.py` | ~170 | REAL — quality score queries |
| `api/routes/gold.py` | ~200 | REAL — Gold MLV queries |
