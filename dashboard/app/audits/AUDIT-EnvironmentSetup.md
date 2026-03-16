# AUDIT: EnvironmentSetup.tsx

**File**: `dashboard/app/src/pages/EnvironmentSetup.tsx` (140 lines)
**Audited**: 2026-03-13
**Verdict**: BACKEND MISSING — both API endpoints referenced have no backend route

---

## Page Overview

Environment Setup provides a 3-mode interface (Provision, Wizard, Settings) for configuring Fabric workspaces, lakehouses, SQL database, and connections. The main page loads current config on mount, and the Provision tab triggers full environment provisioning.

---

## Data Sources

### 1. Current Config Load (on mount)

| What | Detail |
|------|--------|
| **Frontend call** | `fetch(\`${API}/setup/current-config\`)` (line 22) |
| **Expected response** | `{ config: { workspaces, lakehouses, database, ... } }` or `{ workspaces, ... }` at top level |
| **Backend route** | **DOES NOT EXIST** — no `/api/setup/current-config` route in any route module |
| **Legacy** | Existed in `server.py.bak` (line 8663) as `setup_get_current_config()` but was never migrated |
| **Impact** | Page will show "Could not load current config" warning on mount but still renders with `EMPTY_CONFIG` defaults |

**Note on URL**: The frontend uses `/api` prefix (`const API = "/api"`) then calls `${API}/setup/current-config` which resolves to `/api/setup/current-config`. The server dispatches all `/api/*` paths through the route registry.

### 2. Provision All (ProvisionAll sub-component)

| What | Detail |
|------|--------|
| **Frontend call** | `fetch(\`${API}/setup/provision-all\`, { method: "POST", body: { capacityId, capacityDisplayName } })` |
| **Backend route** | **DOES NOT EXIST** — no `/api/setup/provision-all` route in any route module |
| **Legacy** | Likely existed in `server.py.bak` but not migrated |
| **Impact** | Clicking "Provision" button will fail with 404 |

### 3. Sub-components (SetupWizard, SetupSettings)

| Component | API Calls | Status |
|-----------|-----------|--------|
| `SetupWizard` | None — purely local state manipulation of `config` prop | PASS — no data fetching |
| `SetupSettings` | None — purely local display/edit of `config` prop | PASS — no data fetching |

---

## SQLite Tables Relevant

The `EnvironmentConfig` type expects data about workspaces, lakehouses, connections, and database — all of which exist in the SQLite schema:

| Config Property | SQLite Table | Available? |
|-----------------|-------------|------------|
| Workspaces | `workspaces` (5 rows) | Yes |
| Lakehouses | `lakehouses` (6 rows) | Yes |
| Connections | `connections` (10 rows) | Yes |
| Database | Not directly stored | Partial (connection info exists) |
| Capacity | Not stored | No — Fabric API only |

However, no backend route exists to assemble this data into the expected `EnvironmentConfig` shape.

---

## Error Handling

The page handles the missing backend gracefully:
- `loadConfig()` catches errors and sets `loadError` state
- Displays amber warning banner: "Could not load current config: {error}. Starting with empty configuration."
- Provides a "Retry" button
- Falls back to `EMPTY_CONFIG` (all null values)
- All three mode views (Provision, Wizard, Settings) still render

---

## Issues Found

### CRITICAL: `/api/setup/current-config` backend route missing

- **Location**: `EnvironmentSetup.tsx` line 22
- **Status**: Route existed in monolithic `server.py.bak` but was not migrated to the route registry
- **Impact**: Config always loads as empty; users cannot see current environment state
- **Recommendation**: Create `routes/setup.py` with a handler that reads from `workspaces`, `lakehouses`, `connections` SQLite tables and assembles into `EnvironmentConfig` shape

### CRITICAL: `/api/setup/provision-all` backend route missing

- **Location**: `ProvisionAll.tsx` line 89
- **Status**: Not migrated from legacy server
- **Impact**: Provisioning functionality is completely broken
- **Recommendation**: This is a Fabric API-dependent endpoint (creates workspaces/lakehouses via REST). Needs service principal token + Fabric API calls. Complex to implement.

---

## Summary

Both API endpoints this page depends on (`/api/setup/current-config` and `/api/setup/provision-all`) are missing from the backend. They existed in the legacy monolithic `server.py.bak` but were not migrated during the server refactor. The page handles failures gracefully but is essentially non-functional. The Wizard and Settings sub-modes work for local editing but cannot persist or load real configuration. No incorrect data is displayed — the page simply cannot fetch any data.
