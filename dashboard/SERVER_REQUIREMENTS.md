# FMD Operations Dashboard — Server Requirements

> **Document for IT / deployment owners**
> Updated: 2026-04-11

---

## Overview

The FMD dashboard is a single-process Python application that serves a pre-built React frontend and exposes the API used by the UI. It is not a Flask service. The runtime entry point is [`dashboard/app/api/server.py`](./app/api/server.py), which uses Python's built-in `http.server` stack plus the internal route registry.

The application also maintains a local SQLite control-plane database for dashboard state and caches, and it connects outbound to Microsoft Fabric, Fabric SQL, and OneLake.

---

## Runtime Stack

| Component | Version | Purpose |
|-----------|---------|---------|
| Python | 3.10+ | API server and in-process background jobs |
| Node.js / npm | 18+ | Frontend build tooling only |
| ODBC Driver 18 for SQL Server | Current | Fabric SQL connectivity |

### Python packages

There is no separate `dashboard/app/api/requirements.txt` today. For a full runtime-capable environment, install the engine dependencies:

```bash
pip install -r engine/requirements.txt
```

That covers the key non-stdlib packages used by the runtime, including:

- `pyodbc`
- `pyarrow`
- `polars`
- `azure-storage-file-datalake`
- `deltalake`
- `connectorx`
- `pandera[polars]`

---

## Runtime Architecture

```text
Users (Browser)
     |
     v
+------------------------------+
| FMD Dashboard Server         |
| Python stdlib HTTP server    |
| Port 8787                    |
|                              |
|  - serves dashboard/app/dist |
|  - handles /api/* routes     |
|  - writes local SQLite state |
|  - runs in-process helpers   |
+---------------+--------------+
                |
     +----------+-----------+
     |          |           |
     v          v           v
 Azure AD   Fabric SQL   Fabric / OneLake
  tokens     metadata    REST + storage
```

Key points:

- Static frontend files are served from `dashboard/app/dist`
- Control-plane state is stored in `dashboard/app/api/fmd_control_plane.db`
- Runtime logs are written to `dashboard/app/api/fmd-dashboard.log`
- The server also starts background sync helpers used by dashboard features

---

## Required Files

| Path | Purpose |
|------|---------|
| `dashboard/app/api/server.py` | Runtime entry point |
| `dashboard/app/api/config.json` | Non-secret runtime configuration |
| `dashboard/app/api/.env` | Secrets and local overrides |
| `dashboard/app/dist/` | Built frontend assets |
| `dashboard/app/api/fmd_control_plane.db` | Local SQLite control-plane DB |

---

## Environment Variables

The `.env` file must exist at `dashboard/app/api/.env`.

Required:

```env
FABRIC_CLIENT_SECRET=<service-principal-secret>
ADMIN_PASSWORD=<admin-ui-password>
```

Optional, depending on enabled features:

```env
ONELAKE_MOUNT_PATH=<local mount path if used>
PURVIEW_ACCOUNT_NAME=<purview account name>
```

`config.json` already contains the non-secret tenant/client/workspace/database identifiers and resolves `${...}` placeholders from the process environment at startup.

---

## Network / Firewall Rules

The server requires outbound access to:

| Destination | Port | Protocol | Purpose |
|-------------|------|----------|---------|
| `login.microsoftonline.com` | 443 | HTTPS | OAuth2 token acquisition |
| `api.fabric.microsoft.com` | 443 | HTTPS | Fabric REST operations |
| `*.database.fabric.microsoft.com` | 1433 | TDS/SQL | Fabric SQL metadata and source access |
| `*.dfs.fabric.microsoft.com` | 443 | HTTPS | OneLake / ADLS operations when enabled |

Inbound:

- Application listens on `8787/tcp`

---

## Build And Startup

Build the frontend whenever UI code changes:

```bash
cd dashboard/app
npm install
npm run build
```

Start the server:

```bash
cd dashboard/app/api
python server.py
```

The server serves both the UI and the API on the same port.

---

## Sizing Guidance

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 cores | 4 cores |
| RAM | 4 GB | 8 GB |
| Disk | 2 GB free | 5 GB free |
| OS | Windows Server 2019+ or modern Linux | Windows preferred for parity with current dev/runtime setup |

The dashboard can run as a single process, but local SQLite state, ODBC connectivity, and engine-assisted data operations make it heavier than a static-only site.

---

## Operational Notes

- No Flask, nginx, IIS, or separate app server is required to run the app
- Node.js is not required after the frontend has been built
- The application is sensitive to missing secrets and broken outbound Fabric connectivity
- If `dashboard/app/dist` is missing, the root UI will not render

---

## Summary

- Single Python runtime on port `8787`
- React frontend served from `dist`
- Local SQLite control-plane database is required
- Fabric and SQL connectivity are outbound dependencies
- `FABRIC_CLIENT_SECRET` and `ADMIN_PASSWORD` must be present before startup
