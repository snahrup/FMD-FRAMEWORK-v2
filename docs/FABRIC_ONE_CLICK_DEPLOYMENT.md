# Fabric One-Click Deployment

This guide covers the FMD deployment cockpit in **Environment Setup -> Deploy**. It creates or reuses the Fabric resources needed by FMD, records the deployment profile, writes the generated IDs into the runtime config, and runs validation checks before handoff.

## What It Deploys

The deployment profile lets an operator name every resource before anything is created:

- Five Fabric workspaces: data dev, code dev, config, data prod, code prod.
- Three data lakehouses in the data dev workspace: landing, bronze, silver.
- One metadata SQL database in the config workspace.
- Optional Fabric items in the code workspace: landing-to-bronze notebook, bronze-to-silver notebook, copy SQL pipeline.

Notebook and pipeline definition upload is intentionally not faked. If a matching item already exists, FMD binds to it. If it does not exist and no definition payload is configured, the step is recorded as a warning/manual-binding item.

## Required Fabric Permissions

The identity used for deployment must be able to:

- List capacities.
- Create workspaces.
- Assign workspaces to the selected capacity.
- Create lakehouses in the data workspace.
- Create or list SQL database items in the config workspace.
- List notebook and pipeline items in the code workspace.

For unattended deployments, use service-principal mode. For a first-run admin deployment, delegated OAuth/device-code mode is available when the tenant has a public-client app configured.

## Auth Modes

### Service Principal

Configure the dashboard API environment or `dashboard/app/api/config.json`:

```json
{
  "fabric": {
    "tenant_id": "${FABRIC_TENANT_ID}",
    "client_id": "${FABRIC_CLIENT_ID}",
    "client_secret": "${FABRIC_CLIENT_SECRET}"
  }
}
```

The deployment backend requests `https://api.fabric.microsoft.com/.default`.

### Delegated OAuth

Configure:

```text
FABRIC_TENANT_ID=<tenant-guid>
FABRIC_OAUTH_CLIENT_ID=<public-client-app-id>
```

The UI can start a device-code flow. Token cache material stays server-side under `dashboard/app/api/.fabric_token_cache.json` and is never returned to the browser.

## Operator Flow

1. Open **Environment Setup -> Deploy**.
2. Confirm the auth panel shows an available auth mode.
3. Select a Fabric capacity.
4. Enter profile name, profile key, workspace names, lakehouse names, SQL database name, and optional item names.
5. Click **Preview**. This lists each step as `create`, `reuse`, `warning`, or `blocked`.
6. Click **Execute** only after required blocked steps are resolved.
7. Click **Validate**. Review every proof check.
8. Click **Activate** after deployment succeeds and validation has no failed checks.

Activation writes `dashboard/app/api/config.json`, mirrors workspace/lakehouse/pipeline IDs into SQLite, and creates a config backup first:

```text
dashboard/app/api/config.backup.<profileKey>.<YYYYMMDD-HHMMSS>.json
```

## Validation Proof

The validation endpoint checks:

- Fabric token acquisition.
- Target capacity visibility.
- Workspace visibility.
- Lakehouse visibility.
- SQL metadata binding.
- OneLake local mount visibility.
- Parquet probe write/read when `pyarrow` is available.
- Delta probe write/read when `deltalake` and `pyarrow` are available.
- Dagster GraphQL reachability.
- Real smoke load status placeholder.

The real smoke run remains a separate explicit operator action:

```powershell
cd C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK
pwsh .\scripts\run_real_smoke_load.ps1 -RequireApiPreflight
```

The smoke harness now auto-detects `C:\Users\<user>\OneLake - Microsoft` and passes it into the artifact verifier when present.

## Resume And Recovery

Every deployment profile and step is stored in SQLite:

- `deployment_profiles`
- `deployment_steps`

Failed profiles can be reopened from **Environment Setup -> Profiles**. Rerunning the same profile is safe because create operations are idempotent: exact display-name matches are reused instead of duplicated.

Common failures:

- `403`: the deployment identity lacks capacity/workspace/item permissions.
- `ItemDisplayNameAlreadyInUse`: the name exists but is not usable in the selected workspace; rename or bind manually.
- Long-running operation timeout: rerun the same profile after Fabric finishes or clears the operation.
- OAuth unavailable: configure `FABRIC_TENANT_ID` and `FABRIC_OAUTH_CLIENT_ID`, and enable public-client/device-code flow in Entra.
- SQL database API unavailable: create/bind the SQL database manually, then rerun validation.

## Known Limits

- This build creates/reuses Fabric workspaces, lakehouses, and SQL database items.
- This build does not upload notebook definitions or Fabric pipeline definitions yet.
- This build does not write Fabric variable libraries.
- This build does not delete Fabric resources. Decommissioning should be a separate explicit workflow with typed confirmation.
