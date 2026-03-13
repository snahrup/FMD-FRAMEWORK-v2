# AUDIT: Settings.tsx

**Page**: `dashboard/app/src/pages/Settings.tsx`
**Backend**: `dashboard/app/api/routes/engine.py`, `dashboard/app/api/routes/config_manager.py`, `dashboard/app/api/routes/pipeline.py` (various)
**Audited**: 2026-03-13

---

## Summary

Settings.tsx has two tabs: "General" (DeployWizard + Labs feature flags) and "Deployment" (DeploymentManager). The General tab's DeployWizard calls several API endpoints. Labs flags are stored in localStorage only (no backend). The page itself has 3 missing backend routes that were not migrated from server.py.bak to the new route registry.

**Verdict**: FAIL -- 3 missing backend routes, 1 major schema mismatch

---

## API Calls Traced

### GeneralTab Component

The GeneralTab manages Labs feature flags via `localStorage` only (no API calls). This is correct -- feature flags are client-side via `@/lib/featureFlags`.

### DeployWizard Component

#### 1. `GET /api/notebook-config`

**Frontend** (line 196-198): `fetchJson<...>("/notebook-config")`

**Backend** (`config_manager.py` line 425): `get_notebook_config()`

Reads `item_config.yaml`, `VAR_CONFIG_FMD.VariableLibrary`, and `VAR_FMD.VariableLibrary` from the repo. No SQLite queries. Returns `{ itemConfig, varConfigFmd, varFmd, templateMapping, missingConnections }`.

**Correctness**: PASS -- file-based, no DB dependency.

#### 2. `GET /api/fabric/workspaces`

**Frontend** (line 199): `fetchJson<...>("/fabric/workspaces")`

**Backend**: **MISSING** -- this route does NOT exist in any `routes/*.py` file. It existed in `server.py.bak` (line 8668) but was not migrated to the new route registry.

**Impact**: Returns 404. The dropdown for selecting Fabric workspaces during deployment will be empty.

#### 3. `GET /api/fabric/connections`

**Frontend** (line 200): `fetchJson<...>("/fabric/connections")`

**Backend**: **MISSING** -- same as above, was in `server.py.bak` (line 8678) but not migrated.

**Impact**: Returns 404. Connection dropdown empty during deployment.

#### 4. `GET /api/fabric/security-groups`

**Frontend** (line 201): `fetchJson<...>("/fabric/security-groups")`

**Backend**: **MISSING** -- was in `server.py.bak` (line 8694) but not migrated.

**Impact**: Returns 404. Security group selection unavailable.

#### 5. `GET /api/fabric-jobs`

**Frontend** (line 264): `fetchJson<...>("/fabric-jobs")`

**Backend** (`pipeline.py` line 338): `get_fabric_jobs()` -- EXISTS.

Queries Fabric REST API for notebook job instances. No SQLite dependency.

**Correctness**: PASS (Fabric API, not SQLite).

#### 6. `POST /api/notebook-config/update`

**Frontend** (lines 308, 315, 537, 542): `postJson<...>("/notebook-config/update", {...})`

**Backend** (`config_manager.py` line 456): `post_notebook_config_update()`

Updates `item_config.yaml` or variable library JSON files on disk. No SQLite queries.

**Correctness**: PASS -- file-based.

#### 7. `POST /api/deploy-pipelines`

**Frontend** (referenced via DeployWizard flow)

**Backend** (`pipeline.py` line 422): EXISTS. Deploys pipeline JSON to Fabric via REST API.

**Correctness**: PASS (Fabric API).

### DeploymentManager Component (`settings/DeploymentManager.tsx`)

#### 8. `GET /api/deploy/state`

**Frontend** (line 34): `fetch(\`${API}/deploy/state\`)`

**Backend**: **MISSING** -- no route registered for `/api/deploy/state` in any `routes/*.py` file.

**Impact**: Returns 404. Deployment state panel shows nothing.

#### 9. `POST /api/deploy/start`

**Frontend** (line 168): `fetch(\`${API}/deploy/start\`, ...)`

**Backend**: **MISSING** -- no route registered.

**Impact**: Returns 404. Cannot start deployments from the UI.

#### 10. `POST /api/deploy/cancel`

**Frontend** (line 202): `fetch(\`${API}/deploy/cancel\`, ...)`

**Backend**: **MISSING** -- no route registered.

**Impact**: Returns 404.

#### 11. `GET /api/deploy/preflight`

**Frontend** (line 547): `fetchJson<PreflightResult>("/deploy/preflight")`

**Backend**: **MISSING** -- no route registered.

---

## Bugs Found

### BUG-SET-1: `/api/fabric/workspaces` route not migrated (CRITICAL)

**Impact**: DeployWizard workspace dropdown is empty. Users cannot select target workspaces for deployment.
**Was in**: `server.py.bak` line 8668
**Fix**: Create route in a new `routes/fabric.py` or add to `routes/admin.py`

### BUG-SET-2: `/api/fabric/connections` route not migrated (CRITICAL)

**Impact**: Connection dropdown empty during deployment.
**Was in**: `server.py.bak` line 8678

### BUG-SET-3: `/api/fabric/security-groups` route not migrated (CRITICAL)

**Impact**: Security group selection unavailable.
**Was in**: `server.py.bak` line 8694

### BUG-SET-4: `/api/deploy/*` routes not migrated (CRITICAL)

**Impact**: The entire DeploymentManager tab is non-functional -- state, start, cancel, preflight all return 404.
**Was in**: `server.py.bak` (POST handlers)
**Note**: These are likely part of the server refactor work in progress.

---

## Verdict

- Labs flags: client-side only (`localStorage`), no backend needed -- CORRECT
- `GET /api/notebook-config`: file-based, CORRECT
- `POST /api/notebook-config/update`: file-based, CORRECT
- `GET /api/fabric-jobs`: Fabric API, EXISTS
- 3 Fabric API routes MISSING: `/api/fabric/workspaces`, `/api/fabric/connections`, `/api/fabric/security-groups`
- 4 Deploy routes MISSING: `/api/deploy/state`, `/api/deploy/start`, `/api/deploy/cancel`, `/api/deploy/preflight`
- None of these missing routes involve SQLite queries -- they are all Fabric REST API proxies
