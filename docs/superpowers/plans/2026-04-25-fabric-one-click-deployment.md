# Fabric One-Click Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real one-click Fabric deployment capability that lets an operator authenticate, name a deployment, auto-create/reuse Fabric workspaces and items, propagate all generated IDs through the FMD app, and prove the deployment is runnable before users launch pipelines.

**Architecture:** Replace the current fixed-name `ProvisionAll` flow with a deployment profile engine. The backend owns Fabric REST operations, profile persistence, config/SQLite propagation, validation, smoke-proof generation, and rollback metadata. The frontend becomes a guided deployment cockpit with authentication status, editable resource names, dry-run preview, live step progress, final proof, and a safe “activate this deployment” action.

**Tech Stack:** Python stdlib + existing API router, optional `msal` for delegated OAuth/device-code login, Fabric REST API, SQLite control-plane DB, React/TypeScript, Vite, existing FMD UI tokens.

---

## Source References

- Microsoft Fabric Create Workspace API: `POST /v1/workspaces`
- Microsoft Fabric Assign Workspace to Capacity API: `POST /v1/workspaces/{workspaceId}/assignToCapacity`
- Microsoft Fabric Create Lakehouse API: `POST /v1/workspaces/{workspaceId}/lakehouses`
- Microsoft Fabric Create Item API: `POST /v1/workspaces/{workspaceId}/items`

## Current State And Gaps

The app already has a setup surface at `dashboard/app/src/pages/EnvironmentSetup.tsx` and provisioning code in `dashboard/app/api/routes/setup.py`, but it is not production handoff-ready.

Current strengths:
- Lists capacities, workspaces, lakehouses, notebooks, pipelines, and SQL databases.
- Can create fixed-name workspaces and lakehouses through Fabric REST using service-principal credentials.
- Saves selected IDs into `dashboard/app/api/config.json` and mirrors workspaces/lakehouses/pipelines into SQLite.
- Has a UI tab called `Provision`.

Current gaps that must be fixed:
- Fixed resource names are hardcoded in backend dictionaries and the UI; the user cannot name the deployment or override workspace/lakehouse/item names in one place.
- Authentication only uses service-principal client credentials; no delegated OAuth path exists for a Fabric admin/operator to sign in interactively.
- The provisioning route is synchronous and opaque; long-running Fabric operations can appear stuck and cannot be resumed.
- The backend claims it propagates `item_config.yaml`, SQL metadata, and variable libraries, but current `_save_environment_config()` only writes `config.json` and SQLite mirror.
- There is no durable deployment profile/history table. A failed run cannot be audited, resumed, or rolled back safely.
- SQL database creation is attempted, but downstream schema deployment and SQL endpoint validation are not part of the same flow.
- Notebook/pipeline creation is not implemented; the route only looks for existing named items.
- There is no dry-run plan describing exactly what will be created, reused, skipped, or overwritten.
- There is no final proof gate that validates auth, SQL metadata, OneLake write/read, Delta write/read, Dagster connectivity, and real smoke load.

## Definition Of Done

This feature is done only when:
- A user can open Environment Setup, choose OAuth/device-code login or service-principal mode, and see whether the app has valid Fabric permissions.
- A user can name a deployment, customize every workspace/lakehouse/database/notebook/pipeline display name, and select a target capacity.
- The backend can preview the deployment without changing Fabric.
- The backend can create or reuse every requested workspace and lakehouse idempotently.
- The backend can create or reuse required Fabric items where supported; unsupported items are shown as explicit manual/blocked steps rather than silently ignored.
- Generated workspace, lakehouse, SQL database, notebook, and pipeline IDs are persisted into `config.json`, SQLite, and any supported config bundle files.
- The app records deployment profiles and step history in SQLite.
- Failed deployments show exact step/error/actionable recovery guidance and can be resumed safely.
- A final validation run proves the active deployment is usable, including the real smoke load receipt path.
- Tests cover preview, idempotency, config propagation, error handling, and UI state transitions.
- No UI text claims resources were created or propagated unless that actually happened.

## File Structure

Backend files:
- Modify `dashboard/app/api/control_plane_db.py`
  Add deployment profile and deployment step tables plus helper functions.
- Create `dashboard/app/api/deployment_profiles.py`
  Profile schema, default naming, profile persistence, config propagation helpers.
- Create `dashboard/app/api/fabric_deployment.py`
  Fabric REST client, auth abstraction, idempotent create/reuse operations, LRO polling, retry/error normalization.
- Create `dashboard/app/api/routes/deployment.py`
  API routes for auth status, OAuth start/poll, preview, execute, resume, activate, validate, list profiles, get profile.
- Modify `dashboard/app/api/routes/setup.py`
  Keep legacy setup endpoints for dropdowns, but delegate one-click deployment to `routes/deployment.py` and remove misleading claims from `provision-all`.
- Modify `dashboard/app/api/server.py` or route loader if needed
  Ensure new deployment route module registers.
- Create `dashboard/app/api/tests/test_routes_deployment.py`
  Route-level tests with fake Fabric client.
- Create `engine/tests/test_deployment_profiles.py`
  Config propagation and profile model tests.
- Modify `requirements-real-loader.txt` or dashboard requirements if needed
  Add `msal` only if the dashboard server environment does not already include it.

Frontend files:
- Modify `dashboard/app/src/pages/EnvironmentSetup.tsx`
  Replace current three-tab layout with Deploy / Profiles / Manual Settings.
- Replace `dashboard/app/src/pages/setup/ProvisionAll.tsx`
  New guided deploy flow with editable names, auth status, dry-run preview, live step progress, final proof.
- Modify `dashboard/app/src/pages/setup/types.ts`
  Add deployment profile, resource naming, auth mode, deployment step, validation proof types.
- Create `dashboard/app/src/pages/setup/DeploymentNameStep.tsx`
  Resource naming and capacity selection.
- Create `dashboard/app/src/pages/setup/DeploymentAuthPanel.tsx`
  OAuth/SP status and sign-in flow.
- Create `dashboard/app/src/pages/setup/DeploymentPreview.tsx`
  Shows create/reuse/skip actions before execution.
- Create `dashboard/app/src/pages/setup/DeploymentProgress.tsx`
  Shows live step state and exact Fabric IDs.
- Create `dashboard/app/src/pages/setup/DeploymentProof.tsx`
  Shows validation and smoke-load proof.
- Create `dashboard/app/src/pages/setup/DeploymentProfiles.tsx`
  Deployment history and activate/rollback UI.
- Create or modify frontend tests if test harness exists; otherwise add Playwright smoke script for setup page.

Documentation:
- Create `docs/FABRIC_ONE_CLICK_DEPLOYMENT.md`
  Operator guide and troubleshooting.
- Update `docs/REAL_LOAD_SMOKE_RUNBOOK.md`
  Explain how deployment proof connects to smoke verification.
- Update `docs/superpowers/plans/2026-04-25-fmd-launch-readiness-roadmap.md`
  Link this plan as the deployment workstream.

---

## Data Model

Add these SQLite tables:

```sql
CREATE TABLE IF NOT EXISTS deployment_profiles (
  DeploymentProfileId INTEGER PRIMARY KEY AUTOINCREMENT,
  ProfileKey TEXT NOT NULL UNIQUE,
  DisplayName TEXT NOT NULL,
  Status TEXT NOT NULL DEFAULT 'draft',
  AuthMode TEXT NOT NULL DEFAULT 'service_principal',
  CapacityId TEXT,
  CapacityName TEXT,
  ConfigSnapshot TEXT NOT NULL DEFAULT '{}',
  ResourcePlan TEXT NOT NULL DEFAULT '{}',
  ResultSnapshot TEXT NOT NULL DEFAULT '{}',
  ActivatedAt TEXT,
  CreatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS deployment_steps (
  DeploymentStepId INTEGER PRIMARY KEY AUTOINCREMENT,
  ProfileKey TEXT NOT NULL,
  StepKey TEXT NOT NULL,
  StepType TEXT NOT NULL,
  DisplayName TEXT NOT NULL,
  Status TEXT NOT NULL DEFAULT 'pending',
  FabricResourceId TEXT,
  FabricWorkspaceId TEXT,
  Action TEXT NOT NULL DEFAULT 'create',
  StartedAt TEXT,
  EndedAt TEXT,
  ErrorMessage TEXT,
  Details TEXT NOT NULL DEFAULT '{}',
  UNIQUE(ProfileKey, StepKey)
);
```

Profile statuses:
- `draft`: User has created a profile but not executed.
- `planned`: Dry-run preview completed.
- `deploying`: Execution in progress.
- `failed`: At least one required step failed.
- `deployed`: Fabric resources are created/reused and config propagated.
- `validated`: Proof checks passed.
- `active`: This profile is the currently active app deployment.
- `archived`: Retained for audit but not active.

Step statuses:
- `pending`, `running`, `succeeded`, `warning`, `failed`, `skipped`.

---

## Deployment Resource Contract

Default editable resource names:

```json
{
  "profileKey": "ipcorp-dev",
  "displayName": "IP Corp Dev",
  "authMode": "delegated_oauth",
  "capacity": {
    "id": "<capacity-guid>",
    "displayName": "F64 - East US"
  },
  "workspaces": {
    "data_dev": "IPCorp FMD Data Dev",
    "code_dev": "IPCorp FMD Code Dev",
    "config": "IPCorp FMD Config",
    "data_prod": "IPCorp FMD Data Prod",
    "code_prod": "IPCorp FMD Code Prod"
  },
  "lakehouses": {
    "landing": "LH_FMD_LANDING",
    "bronze": "LH_FMD_BRONZE",
    "silver": "LH_FMD_SILVER"
  },
  "database": {
    "metadata": "SQL_FMD_CONTROL_PLANE"
  },
  "items": {
    "landingBronzeNotebook": "NB_FMD_LOAD_LANDING_BRONZE",
    "bronzeSilverNotebook": "NB_FMD_LOAD_BRONZE_SILVER",
    "copySqlPipeline": "PL_FMD_LDZ_COPY_SQL"
  }
}
```

Backend normalized output:

```json
{
  "profileKey": "ipcorp-dev",
  "status": "deployed",
  "config": {
    "fabric": {
      "capacity_id": "...",
      "workspace_data_id": "...",
      "workspace_code_id": "...",
      "workspace_config_id": "..."
    },
    "engine": {
      "lz_lakehouse_id": "...",
      "bronze_lakehouse_id": "...",
      "silver_lakehouse_id": "...",
      "pipeline_copy_sql_id": "...",
      "pipeline_workspace_id": "..."
    }
  },
  "steps": [
    {
      "stepKey": "workspace.data_dev",
      "status": "succeeded",
      "action": "created",
      "fabricResourceId": "..."
    }
  ]
}
```

---

## API Contract

### `GET /api/deployments/auth/status`

Returns current supported auth state.

```json
{
  "authModes": {
    "service_principal": {
      "available": true,
      "reason": "FABRIC_CLIENT_SECRET present"
    },
    "delegated_oauth": {
      "available": true,
      "reason": "OAuth app client configured"
    }
  },
  "activeMode": "service_principal",
  "scopes": [
    "Workspace.ReadWrite.All",
    "Capacity.ReadWrite.All",
    "Lakehouse.ReadWrite.All",
    "Item.ReadWrite.All"
  ]
}
```

### `POST /api/deployments/oauth/start`

Starts delegated OAuth/device-code login when configured.

Response:

```json
{
  "deviceCode": "...",
  "userCode": "ABCD-EFGH",
  "verificationUri": "https://microsoft.com/devicelogin",
  "message": "To sign in, use a web browser..."
}
```

### `POST /api/deployments/oauth/poll`

Polls token acquisition and stores the delegated token cache locally.

### `POST /api/deployments/preview`

Accepts resource names/capacity/auth mode and returns a no-change plan.

Step action values:
- `create`: resource not found and will be created.
- `reuse`: exact display name exists and will be reused.
- `blocked`: missing permissions or unsupported API.
- `warning`: supported but optional or not required for local engine mode.

### `POST /api/deployments/execute`

Executes a profile. Must be idempotent and can resume based on `deployment_steps`.

### `POST /api/deployments/{profileKey}/activate`

Writes the profile result into `config.json`, SQLite mirrors, and supported config bundle files. Takes a backup first.

### `POST /api/deployments/{profileKey}/validate`

Runs:
- Fabric token validation.
- Workspace existence checks.
- Lakehouse existence checks.
- OneLake write/read probe.
- Delta write/read probe.
- SQL metadata DB availability.
- Dagster GraphQL availability when Dagster is configured.
- Optional real smoke load if user supplies/accepts a smoke entity.

### `GET /api/deployments`

Lists deployment profiles and active profile.

### `GET /api/deployments/{profileKey}`

Returns profile, steps, result, validation proof, and config snapshot.

---

## Task 1: Add Deployment Persistence

**Files:**
- Modify: `dashboard/app/api/control_plane_db.py`
- Create: `engine/tests/test_deployment_profiles.py`

- [ ] **Step 1: Write failing tests for schema creation**

Create `engine/tests/test_deployment_profiles.py`:

```python
import importlib

import dashboard.app.api.control_plane_db as cpdb
import dashboard.app.api.db as db


def test_deployment_tables_created(tmp_path):
    db_path = tmp_path / "deployments.db"
    original_db = db.DB_PATH
    original_cpdb = cpdb.DB_PATH
    db.DB_PATH = db_path
    cpdb.DB_PATH = db_path
    try:
        db.init_db()
        rows = db.query(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN "
            "('deployment_profiles', 'deployment_steps')"
        )
        assert {row["name"] for row in rows} == {"deployment_profiles", "deployment_steps"}
    finally:
        db.DB_PATH = original_db
        cpdb.DB_PATH = original_cpdb
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'
C:\Users\snahrup\CascadeProjects\FMD_ORCHESTRATOR\.venv\Scripts\python.exe -m pytest engine\tests\test_deployment_profiles.py -q
```

Expected before implementation: fails because tables do not exist.

- [ ] **Step 3: Add tables and helpers**

In `dashboard/app/api/control_plane_db.py`, add the two `CREATE TABLE` statements in the schema initialization block and create helper functions:

```python
def upsert_deployment_profile(row: dict) -> None:
    execute(
        """
        INSERT INTO deployment_profiles (
          ProfileKey, DisplayName, Status, AuthMode, CapacityId, CapacityName,
          ConfigSnapshot, ResourcePlan, ResultSnapshot, UpdatedAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(ProfileKey) DO UPDATE SET
          DisplayName=excluded.DisplayName,
          Status=excluded.Status,
          AuthMode=excluded.AuthMode,
          CapacityId=excluded.CapacityId,
          CapacityName=excluded.CapacityName,
          ConfigSnapshot=excluded.ConfigSnapshot,
          ResourcePlan=excluded.ResourcePlan,
          ResultSnapshot=excluded.ResultSnapshot,
          UpdatedAt=CURRENT_TIMESTAMP
        """,
        (
            row["ProfileKey"],
            row["DisplayName"],
            row.get("Status", "draft"),
            row.get("AuthMode", "service_principal"),
            row.get("CapacityId", ""),
            row.get("CapacityName", ""),
            row.get("ConfigSnapshot", "{}"),
            row.get("ResourcePlan", "{}"),
            row.get("ResultSnapshot", "{}"),
        ),
    )
```

Also add:
- `list_deployment_profiles()`
- `get_deployment_profile(profile_key: str)`
- `upsert_deployment_step(row: dict)`
- `list_deployment_steps(profile_key: str)`
- `mark_deployment_profile_status(profile_key: str, status: str)`

- [ ] **Step 4: Run test**

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add dashboard\app\api\control_plane_db.py engine\tests\test_deployment_profiles.py
git commit -m "Add deployment profile persistence"
```

---

## Task 2: Build Fabric Deployment Client

**Files:**
- Create: `dashboard/app/api/fabric_deployment.py`
- Create: `dashboard/app/api/tests/test_fabric_deployment.py`

- [ ] **Step 1: Write fake-client unit tests**

Test cases:
- `preview()` returns `reuse` when workspace/lakehouse names already exist.
- `preview()` returns `create` when they do not exist.
- `execute()` records idempotent created/reused IDs.
- LRO polling handles `202 Location` then succeeded.
- API errors return normalized actionable messages.

- [ ] **Step 2: Implement client**

Create `dashboard/app/api/fabric_deployment.py` with:

```python
class FabricDeploymentClient:
    def __init__(self, token_provider, base_url: str = "https://api.fabric.microsoft.com/v1"):
        self.token_provider = token_provider
        self.base_url = base_url.rstrip("/")

    def list_workspaces(self) -> list[dict]:
        ...

    def create_or_reuse_workspace(self, display_name: str, capacity_id: str | None) -> tuple[dict, str]:
        ...

    def assign_workspace_to_capacity(self, workspace_id: str, capacity_id: str) -> None:
        ...

    def list_lakehouses(self, workspace_id: str) -> list[dict]:
        ...

    def create_or_reuse_lakehouse(self, workspace_id: str, display_name: str) -> tuple[dict, str]:
        ...

    def create_or_reuse_item(self, workspace_id: str, display_name: str, item_type: str) -> tuple[dict | None, str]:
        ...
```

Rules:
- No silent success. If a Fabric API returns a blocked/unsupported error, return a step with `status=failed` or `status=warning` depending on whether the item is required.
- Do not delete Fabric resources automatically.
- Use display-name matching only within the target workspace.
- Poll Fabric LROs using `Location`, `Retry-After`, and a bounded timeout.

- [ ] **Step 3: Run tests**

```powershell
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'
C:\Users\snahrup\CascadeProjects\FMD_ORCHESTRATOR\.venv\Scripts\python.exe -m pytest dashboard\app\api\tests\test_fabric_deployment.py -q
```

- [ ] **Step 4: Commit**

```powershell
git add dashboard\app\api\fabric_deployment.py dashboard\app\api\tests\test_fabric_deployment.py
git commit -m "Add Fabric deployment client"
```

---

## Task 3: Add Auth Provider Abstraction

**Files:**
- Create: `dashboard/app/api/deployment_auth.py`
- Modify: `requirements-real-loader.txt` or dashboard runtime dependency file if needed.
- Test: `dashboard/app/api/tests/test_deployment_auth.py`

- [ ] **Step 1: Define supported auth modes**

Implement:
- `ServicePrincipalFabricTokenProvider`
- `DelegatedOAuthFabricTokenProvider`
- `get_deployment_token_provider(auth_mode: str)`
- `get_auth_status()`

Service principal mode uses existing tenant/client/secret config.

Delegated OAuth mode uses MSAL device-code flow when configured:
- `FABRIC_OAUTH_CLIENT_ID`
- `FABRIC_TENANT_ID` or config tenant
- Token cache file under `dashboard/app/api/.fabric_token_cache.json`

Scopes:

```python
FABRIC_SCOPES = [
    "https://api.fabric.microsoft.com/Workspace.ReadWrite.All",
    "https://api.fabric.microsoft.com/Capacity.ReadWrite.All",
    "https://api.fabric.microsoft.com/Lakehouse.ReadWrite.All",
    "https://api.fabric.microsoft.com/Item.ReadWrite.All",
]
```

If Fabric rejects delegated scopes in this form, fall back to `https://api.fabric.microsoft.com/.default` for app permissions and make delegated mode unavailable with a precise reason.

- [ ] **Step 2: Add tests**

Tests must prove:
- Missing service-principal secret returns unavailable.
- Present service-principal secret returns available.
- Delegated OAuth unavailable without client id.
- Token cache is never returned to the UI.

- [ ] **Step 3: Commit**

```powershell
git add dashboard\app\api\deployment_auth.py dashboard\app\api\tests\test_deployment_auth.py requirements-real-loader.txt
git commit -m "Add deployment auth providers"
```

---

## Task 4: Implement Deployment API Routes

**Files:**
- Create: `dashboard/app/api/routes/deployment.py`
- Modify: route module loading if necessary.
- Test: `dashboard/app/api/tests/test_routes_deployment.py`

- [ ] **Step 1: Write route tests with a fake deployment client**

Tests:
- `GET /api/deployments/auth/status` returns modes and scopes.
- `POST /api/deployments/preview` rejects missing capacity/profile name.
- `POST /api/deployments/preview` returns planned steps with create/reuse actions.
- `POST /api/deployments/execute` persists profile and steps.
- `POST /api/deployments/{profileKey}/activate` writes config with backup.
- `POST /api/deployments/{profileKey}/validate` returns required proof checks.

- [ ] **Step 2: Implement routes**

Routes:
- `GET /api/deployments/auth/status`
- `POST /api/deployments/oauth/start`
- `POST /api/deployments/oauth/poll`
- `GET /api/deployments`
- `GET /api/deployments/{profileKey}`
- `POST /api/deployments/preview`
- `POST /api/deployments/execute`
- `POST /api/deployments/{profileKey}/activate`
- `POST /api/deployments/{profileKey}/validate`

Route behavior:
- Preview does not mutate Fabric.
- Execute persists every step as it starts/ends.
- Activate writes `dashboard/app/api/config.json` only after all required create/reuse steps succeed.
- Config backup path format:

```text
dashboard/app/api/config.backup.<profileKey>.<YYYYMMDD-HHMMSS>.json
```

- Validation proof must include:

```json
{
  "ok": true,
  "checks": [
    {"id": "fabric_token", "status": "passed"},
    {"id": "workspaces", "status": "passed"},
    {"id": "lakehouses", "status": "passed"},
    {"id": "sql_metadata", "status": "passed"},
    {"id": "onelake_probe", "status": "passed"},
    {"id": "dagster", "status": "warning"}
  ]
}
```

- [ ] **Step 3: Commit**

```powershell
git add dashboard\app\api\routes\deployment.py dashboard\app\api\tests\test_routes_deployment.py
git commit -m "Add deployment API routes"
```

---

## Task 5: Make Config Propagation Honest And Complete

**Files:**
- Create: `dashboard/app/api/deployment_profiles.py`
- Modify: `dashboard/app/api/routes/setup.py`
- Test: `engine/tests/test_deployment_profiles.py`

- [ ] **Step 1: Implement config mapper**

`deployment_profiles.py` should map deployment output into:
- `fabric.capacity_id`
- `fabric.capacity_name`
- `fabric.workspace_data_id`
- `fabric.workspace_code_id`
- `fabric.workspace_config_id`
- `fabric.workspace_data_prod_id`
- `fabric.workspace_code_prod_id`
- `fabric.sql_database_id`
- `fabric.sql_database_name`
- `engine.lz_lakehouse_id`
- `engine.bronze_lakehouse_id`
- `engine.silver_lakehouse_id`
- `engine.notebook_bronze_id`
- `engine.notebook_silver_id`
- `engine.pipeline_copy_sql_id`
- `engine.pipeline_workspace_id`

Also mirror to SQLite:
- `workspaces`
- `lakehouses`
- `pipelines`

Do not claim support for:
- `item_config.yaml`
- Fabric variable libraries
- notebook definitions

unless the code actually writes them. Unsupported propagation targets should be returned as warnings, not success.

- [ ] **Step 2: Update legacy `ProvisionAll` route**

Either:
- remove `/api/setup/provision-all`, or
- make it call the new `/api/deployments/execute` engine internally.

It must not maintain a second provisioning path.

- [ ] **Step 3: Commit**

```powershell
git add dashboard\app\api\deployment_profiles.py dashboard\app\api\routes\setup.py engine\tests\test_deployment_profiles.py
git commit -m "Centralize deployment config propagation"
```

---

## Task 6: Rebuild Frontend One-Click Deployment UI

**Files:**
- Modify: `dashboard/app/src/pages/EnvironmentSetup.tsx`
- Replace: `dashboard/app/src/pages/setup/ProvisionAll.tsx`
- Modify: `dashboard/app/src/pages/setup/types.ts`
- Create: `dashboard/app/src/pages/setup/DeploymentAuthPanel.tsx`
- Create: `dashboard/app/src/pages/setup/DeploymentNameStep.tsx`
- Create: `dashboard/app/src/pages/setup/DeploymentPreview.tsx`
- Create: `dashboard/app/src/pages/setup/DeploymentProgress.tsx`
- Create: `dashboard/app/src/pages/setup/DeploymentProof.tsx`
- Create: `dashboard/app/src/pages/setup/DeploymentProfiles.tsx`

- [ ] **Step 1: Define frontend types**

Add:

```ts
export type DeploymentAuthMode = "service_principal" | "delegated_oauth";
export type DeploymentStepStatus = "pending" | "running" | "succeeded" | "warning" | "failed" | "skipped";
export type DeploymentAction = "create" | "reuse" | "blocked" | "warning";

export interface DeploymentResourceNames {
  profileKey: string;
  displayName: string;
  authMode: DeploymentAuthMode;
  capacityId: string;
  capacityDisplayName: string;
  workspaces: Record<"data_dev" | "code_dev" | "config" | "data_prod" | "code_prod", string>;
  lakehouses: Record<"landing" | "bronze" | "silver", string>;
  database: { metadata: string };
  items: {
    landingBronzeNotebook: string;
    bronzeSilverNotebook: string;
    copySqlPipeline: string;
  };
}

export interface DeploymentStep {
  stepKey: string;
  displayName: string;
  status: DeploymentStepStatus;
  action: DeploymentAction;
  fabricResourceId?: string;
  details?: string;
  errorMessage?: string;
}
```

- [ ] **Step 2: Implement UI workflow**

Stages:
1. Authentication.
2. Naming and capacity selection.
3. Preview plan.
4. Execute deployment.
5. Validate/prove deployment.
6. Activate profile.

Rules:
- The execute button is disabled until preview has no required `blocked` steps.
- “Activate” is disabled until required deployment steps succeed.
- “Mark validated” is disabled until proof checks pass or user explicitly accepts warnings.
- No fixed resource name is hidden from the user.
- Every created/reused Fabric ID is visible and copyable.

- [ ] **Step 3: Remove misleading success copy**

Replace text like:

```text
Config saved to item_config.yaml, config.json, SQL metadata, and variable libraries.
```

with actual backend-returned target results only.

- [ ] **Step 4: Build and test**

```powershell
cd C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\dashboard\app
npx tsc -b --pretty false
npx vite build
```

- [ ] **Step 5: Commit**

```powershell
git add dashboard\app\src\pages\EnvironmentSetup.tsx dashboard\app\src\pages\setup
git commit -m "Rebuild one-click deployment UI"
```

---

## Task 7: Add Deployment Validation Proof

**Files:**
- Create: `dashboard/app/api/deployment_validation.py`
- Modify: `dashboard/app/api/routes/deployment.py`
- Modify: `scripts/run_real_smoke_load.ps1`
- Modify: `scripts/verify_real_smoke_load.py`
- Test: `dashboard/app/api/tests/test_deployment_validation.py`

- [ ] **Step 1: Implement proof checks**

Checks:
- `fabric_token`: can acquire token.
- `capacity`: target capacity is visible.
- `workspaces`: configured workspaces exist.
- `lakehouses`: configured lakehouses exist in data workspace.
- `sql_metadata`: configured SQL database has endpoint fields or clear warning.
- `onelake_parquet`: writes and reads a tiny probe parquet under a `_fmd_probe` folder.
- `onelake_delta`: writes and reads a tiny probe Delta table.
- `dagster_graphql`: can reach configured GraphQL URL.
- `real_smoke`: optional; invoke existing smoke harness or return not-run until user starts it.

- [ ] **Step 2: Make validation non-destructive**

Probe paths must be clearly named and safe:

```text
Files/_fmd_probe/<profileKey>/deployment_probe.parquet
Tables/_fmd_probe/<profileKey>_deployment_probe
```

Do not delete production data. Optional cleanup can remove only the probe path created by the current profile.

- [ ] **Step 3: Commit**

```powershell
git add dashboard\app\api\deployment_validation.py dashboard\app\api\routes\deployment.py dashboard\app\api\tests\test_deployment_validation.py scripts\run_real_smoke_load.ps1 scripts\verify_real_smoke_load.py
git commit -m "Add deployment validation proof"
```

---

## Task 8: Documentation And Operator Handoff

**Files:**
- Create: `docs/FABRIC_ONE_CLICK_DEPLOYMENT.md`
- Modify: `docs/REAL_LOAD_SMOKE_RUNBOOK.md`
- Modify: `docs/superpowers/plans/2026-04-25-fmd-launch-readiness-roadmap.md`

- [ ] **Step 1: Write operator guide**

Include:
- Required Fabric permissions.
- Required Entra app settings for service-principal mode.
- Required Entra app settings for delegated OAuth/device-code mode.
- How to create a deployment.
- What each resource does.
- How IDs propagate.
- How to validate.
- How to resume failed deployments.
- How to activate/rollback.
- Known limitations: Fabric APIs that are preview or unavailable for a tenant.

- [ ] **Step 2: Add troubleshooting**

Common failures:
- `403`: caller lacks workspace/capacity permission.
- `ItemDisplayNameAlreadyInUse`: existing item with conflicting name.
- `202` never completes: Fabric LRO timeout; safe to rerun.
- OAuth unavailable: public client flow not enabled.
- SQL database API unavailable in tenant: use manual SQL database binding, then save/validate.

- [ ] **Step 3: Commit**

```powershell
git add docs\FABRIC_ONE_CLICK_DEPLOYMENT.md docs\REAL_LOAD_SMOKE_RUNBOOK.md docs\superpowers\plans\2026-04-25-fmd-launch-readiness-roadmap.md
git commit -m "Document Fabric one-click deployment"
```

---

## Task 9: End-To-End Verification

**Files:**
- No new files unless fixing test failures.

- [ ] **Step 1: Backend tests**

```powershell
$env:PYTEST_DISABLE_PLUGIN_AUTOLOAD='1'
C:\Users\snahrup\CascadeProjects\FMD_ORCHESTRATOR\.venv\Scripts\python.exe -m pytest `
  dashboard\app\api\tests\test_routes_deployment.py `
  dashboard\app\api\tests\test_fabric_deployment.py `
  dashboard\app\api\tests\test_deployment_auth.py `
  dashboard\app\api\tests\test_deployment_validation.py `
  engine\tests\test_deployment_profiles.py `
  engine\tests\test_real_smoke_verifier.py `
  -q
```

- [ ] **Step 2: Frontend build**

```powershell
cd C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\dashboard\app
npx tsc -b --pretty false
npx vite build
```

- [ ] **Step 3: API smoke**

From a fresh PowerShell if this Codex shell still has the inherited socket issue:

```powershell
cd C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK
pwsh .\scripts\run_real_smoke_load.ps1 -RequireApiPreflight
```

- [ ] **Step 4: UI smoke**

Run the dashboard and manually verify:
- Environment Setup loads.
- Auth status panel shows either available service principal or delegated OAuth.
- User can enter custom resource names.
- Preview shows create/reuse/blocked steps.
- Execute cannot run when preview is blocked.
- Existing resources are reused on second run.
- Activate writes config and shows backup path.
- Validation proof shows exact pass/warn/fail checks.

- [ ] **Step 5: Final review**

Run:

```powershell
git status --short
git log --oneline -5
```

Verify:
- No unrelated files staged.
- No secrets committed.
- No config backup containing secrets committed.
- No UI copy overclaims unsupported propagation.

---

## Rollback Strategy

Every activation writes a config backup first:

```text
dashboard/app/api/config.backup.<profileKey>.<timestamp>.json
```

Rollback implementation:
- `POST /api/deployments/{profileKey}/rollback`
- Restores selected config backup.
- Marks profile status as `archived` or previous active profile as `active`.
- Does not delete Fabric resources automatically.

If the user truly wants Fabric resource deletion later, build it as a separate “decommission profile” workflow with explicit typed confirmation. Do not bundle destructive cleanup into deployment.

---

## Risks And Design Decisions

- OAuth/device-code depends on Entra app registration settings. The app must support it when configured but cannot assume the tenant allows public-client flow.
- Fabric SQL database REST APIs may be tenant/preview gated. The deployment must show this as a blocked or manual-binding step, not fake success.
- Creating notebooks and pipelines from definitions may require public definition payloads. If unsupported in the current tenant, create/reuse detection still works, but item deployment must be marked warning/manual until definition upload is implemented.
- OneLake local mount and ADLS SDK are both valid. Validation should prefer configured mount when available and fall back to ADLS SDK.
- Service-principal auth is better for unattended deployment; delegated OAuth is better for first-run tenant admin provisioning. Support both.

## Implementation Order

1. Persistence tables.
2. Fabric client and auth providers.
3. Deployment routes and config propagation.
4. Frontend deploy workflow.
5. Validation proof.
6. Documentation.
7. End-to-end smoke.

Do not start frontend work until the route contracts and tests exist. Do not activate a generated profile until config propagation has a backup and tests.
