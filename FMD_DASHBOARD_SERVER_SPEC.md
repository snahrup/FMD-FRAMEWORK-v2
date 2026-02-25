# FMD Operations Dashboard — Server Specification

**Prepared by:** Steve Nahrup
**Date:** February 25, 2026
**Purpose:** Infrastructure requirements for a dedicated on-premises server hosting the FMD Operations Dashboard

---

## 1. Application Overview

The FMD Operations Dashboard is a single-process web application that provides real-time monitoring and management of Microsoft Fabric data pipelines. It serves a React frontend (static files) and a Python REST API backend from one process.

**What it does:**
- Monitors 44+ Fabric data pipelines across Landing Zone, Bronze, Silver, and Gold layers
- Displays real-time pipeline execution status, error intelligence, and record counts
- Triggers pipeline runs and manages entity scoping
- Connects outbound to Microsoft Fabric REST APIs and a Fabric SQL Database (cloud-hosted)
- Serves a browser-based dashboard to internal users on the corporate network

**What it does NOT do:**
- No local database (all data lives in Microsoft Fabric cloud)
- No heavy compute (no ML models, no data processing)
- No file storage beyond application logs
- No inbound internet traffic required

---

## 2. Recommended Server Specifications

| Component | Minimum | Recommended | Notes |
|-----------|---------|-------------|-------|
| **OS** | Windows Server 2022 Standard | Windows Server 2025 Standard | Must support ODBC Driver 18 |
| **CPU** | 2 vCPU / cores | 4 vCPU / cores | Thread pool parallelism (up to 6 workers) |
| **RAM** | 4 GB | 8 GB | Python process ~200-400 MB under load; headroom for OS + ODBC |
| **Disk** | 40 GB SSD | 60 GB SSD | OS (~20 GB) + Python (~500 MB) + Node.js build tools (~500 MB) + App (~50 MB) + Logs |
| **Network** | 1 Gbps NIC | 1 Gbps NIC | Internal LAN access + outbound HTTPS to Azure/Fabric |

**Patrick's suggested 2 proc / 8 GB is fine.** The app is lightweight — a single Python process serving HTTP. The 8 GB gives comfortable headroom.

---

## 3. Network Requirements

### Outbound Access (REQUIRED — the app cannot function without these)

| Destination | Port | Protocol | Purpose |
|-------------|------|----------|---------|
| `login.microsoftonline.com` | 443 | HTTPS | Azure AD / Entra ID token acquisition |
| `*.fabric.microsoft.com` | 443 | HTTPS | Fabric REST API (pipeline status, jobs, triggers) |
| `*.database.fabric.microsoft.com` | 1433 | TDS/SQL | Fabric SQL Database (metadata, entity config, logging) |
| `api.fabric.microsoft.com` | 443 | HTTPS | Fabric management API |
| `*.pbidedicated.windows.net` | 443 | HTTPS | Lakehouse SQL analytics endpoints |
| `*.onelake.dfs.fabric.microsoft.com` | 443 | HTTPS | OneLake data access (future) |

### Inbound Access

| Source | Port | Protocol | Purpose |
|--------|------|----------|---------|
| Corporate LAN / VPN users | **8787** (configurable) | HTTP | Dashboard web UI + API |

> **Note:** If you want HTTPS termination, place an IIS reverse proxy or nginx in front on port 443 and proxy to localhost:8787. The app itself serves HTTP.

### DNS Resolution
Standard corporate DNS. No special records needed — all destinations are public Azure endpoints.

---

## 4. Software Requirements

### Required Packages

| Software | Version | Purpose | Install Method |
|----------|---------|---------|----------------|
| **Python** | 3.11+ (recommend 3.12) | Backend API server | python.org MSI installer or winget |
| **pyodbc** | Latest | SQL Database connectivity | `pip install pyodbc` |
| **ODBC Driver 18 for SQL Server** | Latest | Required by pyodbc for TDS connections | Microsoft MSI installer |
| **Node.js** | 20 LTS or 22 LTS | Frontend build only (not needed at runtime) | nodejs.org MSI or winget |

### Installation Commands (after base OS)

```powershell
# 1. Install Python 3.12 (MSI from python.org, check "Add to PATH")
# 2. Install ODBC Driver 18
#    Download: https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server
# 3. Install Python dependency
pip install pyodbc
# 4. Install Node.js 22 LTS (MSI from nodejs.org) — for building frontend only
# 5. Build the frontend (one-time, or on each deployment)
cd C:\Apps\FMD-Dashboard\dashboard\app
npm install
npm run build
```

### Runtime Process

Only **one process** runs in production:

```powershell
python C:\Apps\FMD-Dashboard\dashboard\app\api\server.py --config C:\Apps\FMD-Dashboard\config\config.json
```

That's it. No web server (IIS/Apache/nginx) is strictly required — the Python server handles both static file serving and the API. However, IIS can be configured as a reverse proxy for HTTPS if needed.

---

## 5. Service Configuration

### Run as Windows Service (Recommended)

Use **NSSM** (Non-Sucking Service Manager) to wrap the Python process:

```powershell
# Install NSSM
choco install nssm
# or download from nssm.cc

# Create service
nssm install FMD-Dashboard "C:\Python312\python.exe" "C:\Apps\FMD-Dashboard\dashboard\app\api\server.py --config C:\Apps\FMD-Dashboard\config\config.json"
nssm set FMD-Dashboard AppDirectory "C:\Apps\FMD-Dashboard\dashboard\app\api"
nssm set FMD-Dashboard DisplayName "FMD Operations Dashboard"
nssm set FMD-Dashboard Start SERVICE_AUTO_START
nssm set FMD-Dashboard AppStdout "C:\Apps\FMD-Dashboard\logs\stdout.log"
nssm set FMD-Dashboard AppStderr "C:\Apps\FMD-Dashboard\logs\stderr.log"

# Start
nssm start FMD-Dashboard
```

### Service Account

The service should run under a **domain service account** or Local System. No special Active Directory privileges required — all authentication to Fabric uses a pre-configured Service Principal (client_id + client_secret in config.json).

### Environment Variable

One secret must be set as an environment variable for the service account:

```
FABRIC_CLIENT_SECRET=<service principal secret>
```

This is referenced in config.json as `${FABRIC_CLIENT_SECRET}`.

---

## 6. Application File Layout

```
C:\Apps\FMD-Dashboard\
├── dashboard\
│   └── app\
│       ├── api\
│       │   ├── server.py          # Backend server (single file, ~5500 lines)
│       │   └── config.json        # Configuration (endpoints, workspace IDs)
│       ├── dist\                  # Built frontend (static HTML/JS/CSS)
│       │   ├── index.html
│       │   └── assets\
│       └── public\
│           └── icons\             # Fabric SVG icons
├── config\
│   └── config.json                # Production config (copy from api/config.json, update secret)
└── logs\
    ├── fmd-dashboard.log          # Application log
    ├── stdout.log                 # NSSM stdout capture
    └── stderr.log                 # NSSM stderr capture
```

---

## 7. Deployment Procedure

```powershell
# 1. Copy application files to server
# 2. Install prerequisites (Python, ODBC Driver, Node.js)
# 3. Install pyodbc
pip install pyodbc
# 4. Build frontend
cd C:\Apps\FMD-Dashboard\dashboard\app
npm install
npm run build
# 5. Configure
#    - Copy config.json, update any environment-specific values
#    - Set FABRIC_CLIENT_SECRET environment variable
# 6. Test manually
python C:\Apps\FMD-Dashboard\dashboard\app\api\server.py
#    → Open http://localhost:8787 in browser, verify dashboard loads
# 7. Install as Windows service via NSSM
# 8. Open firewall port 8787 for inbound LAN traffic
```

---

## 8. Monitoring & Maintenance

- **Log rotation:** Application log grows slowly (~1-5 MB/day). Set up a scheduled task to archive/rotate logs monthly.
- **Updates:** Pull new code, run `npm run build`, restart service. Zero-downtime not required (internal tool, <30s restart).
- **Health check:** `GET http://localhost:8787/api/health` — returns JSON with server uptime and connection status.
- **Resource usage:** Expect ~150-400 MB RAM, <5% CPU at idle, brief spikes during dashboard refreshes (parallel Fabric API calls).

---

## 9. Future Growth Considerations

These are planned but not yet implemented. The 4-core / 8 GB recommendation accounts for this headroom:

| Feature | Resource Impact |
|---------|----------------|
| AI-powered error analysis (OpenAI API calls) | Negligible — outbound HTTPS calls, no local compute |
| Additional data sources (5-10 more SQL Server connections) | Marginal — more pyodbc connections, +50-100 MB RAM |
| Multiple concurrent dashboard users (10-20) | The server uses Python's `ThreadingMixIn` — handles concurrent requests fine up to ~50 users |
| Scheduled health checks / alerting | Minimal — periodic API calls on a timer |

---

## 10. Summary

| Item | Value |
|------|-------|
| **OS** | Windows Server 2022 or 2025 Standard |
| **CPU** | 2-4 cores |
| **RAM** | 8 GB |
| **Disk** | 40-60 GB SSD |
| **Software** | Python 3.12, pyodbc, ODBC Driver 18, Node.js 22 LTS (build only) |
| **Port** | 8787 (HTTP inbound from LAN) |
| **Outbound** | HTTPS to Azure AD + Fabric APIs, TDS to Fabric SQL (port 1433) |
| **Service** | Single Python process, wrapped with NSSM as Windows Service |
| **Auth** | Service Principal (client_id/secret) — no user credentials stored |

**Patrick's 2 proc / 8 GB with newest OS is perfectly adequate.** This is a lightweight monitoring dashboard, not a data processing engine. All heavy lifting happens in Microsoft Fabric cloud.
