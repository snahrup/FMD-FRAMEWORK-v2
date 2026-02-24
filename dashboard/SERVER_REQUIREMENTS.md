# FMD Operations Dashboard — Server Requirements

> **Document for IT Infrastructure team**
> Prepared by: Steve Nahrup
> Date: February 23, 2026

---

## Overview

The FMD Operations Dashboard is a lightweight web application that provides real-time monitoring and management of the Fabric Metadata-Driven (FMD) data pipeline framework. It consists of a Python API backend that serves a pre-built React frontend as static files.

---

## Runtime Stack

| Component | Version | Purpose |
|-----------|---------|---------|
| **Python** | 3.10 or higher | Backend API server |
| **Node.js / npm** | 18+ | Frontend build tooling only (not required at runtime) |
| **ODBC Driver 18 for SQL Server** | Latest | Connectivity to Microsoft Fabric SQL Database |

### Python Packages (install via `pip install -r requirements.txt`)

```
flask
flask-cors
pyodbc
msal
pyyaml
```

---

## Network / Firewall Rules

The server requires **outbound HTTPS and SQL** access to the following endpoints:

| Destination | Port | Protocol | Purpose |
|-------------|------|----------|---------|
| `login.microsoftonline.com` | 443 | HTTPS | Azure AD OAuth2 token acquisition |
| `api.fabric.microsoft.com` | 443 | HTTPS | Fabric REST API (pipeline monitoring, triggers, job status) |
| `*.database.fabric.microsoft.com` | 1433 | TDS/SQL | Fabric SQL Database (metadata and configuration) |

**Inbound:** The application listens on **port 8787** (configurable). Users access the dashboard via `http://<server>:8787`.

---

## Authentication

The application authenticates to Microsoft Fabric using a **Service Principal** (OAuth2 client credentials grant). No user login or interactive authentication is required.

| Property | Value |
|----------|-------|
| Tenant ID | `ca81e9fd-06dd-49cf-b5a9-ee7441ff5303` |
| Client ID | `ac937c5d-4bdd-438f-be8b-84a850021d2d` |
| Client Secret | Stored in `.env` file on the server (see Deployment section) |

The Service Principal requires **Contributor** role on the following Fabric workspaces:
- INTEGRATION CODE (D) — pipeline definitions
- INTEGRATION DATA (D) — data lakehouses
- INTEGRATION CONFIG (D) — configuration database

---

## Deployment Artifacts

| Path | Description |
|------|-------------|
| `dashboard/app/api/server.py` | Python API server (single file, ~1400 lines) |
| `dashboard/app/api/.env` | Environment secrets — **do not commit to source control** |
| `dashboard/app/dist/` | Pre-built static frontend (HTML, JS, CSS) |
| `config/item_config.yaml` | Workspace and lakehouse GUID configuration |

### Environment File (`.env`)

The `.env` file must be placed at `dashboard/app/api/.env` and contain:

```env
FABRIC_CLIENT_SECRET=<service-principal-client-secret>
SQL_SERVER=<fabric-sql-server-hostname>,1433
SQL_DATABASE=<fabric-sql-database-name>
```

---

## How to Start the Application

```bash
cd dashboard/app/api
python server.py
```

The server starts on **port 8787** and serves both the REST API and the static frontend. No additional web server (nginx, IIS, Apache) is required, though a reverse proxy can be placed in front if desired.

### Optional: Building the Frontend

If the frontend code is modified, rebuild it with:

```bash
cd dashboard/app
npm install      # first time only
npm run build    # outputs to dist/
```

The API server automatically serves the contents of `dist/` at the root URL.

---

## Server Sizing

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 1 core | 2 cores |
| RAM | 1 GB | 2 GB |
| Disk | 500 MB | 1 GB |
| OS | Windows Server 2019+ or Linux (Ubuntu 22.04+) | Windows Server preferred (matches dev environment) |

This is a lightweight application — a single Python process handles all requests. No database server, message queue, or background workers are needed on this machine.

### Linux-Specific Note

If deploying on Linux, the Microsoft ODBC Driver must be installed separately:

```bash
# Ubuntu/Debian
curl https://packages.microsoft.com/keys/microsoft.asc | sudo tee /etc/apt/trusted.gpg.d/microsoft.asc
sudo add-apt-repository "$(curl https://packages.microsoft.com/config/ubuntu/$(lsb_release -rs)/prod.list)"
sudo apt-get update
sudo apt-get install -y msodbcsql18 unixodbc-dev
```

---

## Architecture Diagram

```
 Users (Browser)
      │
      ▼
 ┌─────────────────────────┐
 │  FMD Dashboard Server   │
 │  (Python / Flask)       │
 │  Port 8787              │
 │                         │
 │  ┌───────────────────┐  │
 │  │ Static Frontend   │  │   ← Pre-built React app (dist/)
 │  │ (HTML/JS/CSS)     │  │
 │  └───────────────────┘  │
 │  ┌───────────────────┐  │
 │  │ REST API          │  │   ← /api/* endpoints
 │  │ (server.py)       │  │
 │  └───────┬───────────┘  │
 └──────────┼──────────────┘
            │
    ┌───────┼───────────────────┐
    │       │                   │
    ▼       ▼                   ▼
 Azure AD   Fabric SQL DB    Fabric REST API
 (tokens)   (metadata)       (pipelines, jobs)
```

---

## Summary

- **Single Python process** — no complex infrastructure
- **No local database** — connects to existing Fabric SQL remotely
- **Pre-built frontend** — Node.js only needed if frontend code changes
- **Service Principal auth** — no user credentials stored
- **Port 8787** — single port for both UI and API
