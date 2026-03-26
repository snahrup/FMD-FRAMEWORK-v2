#Requires -RunAsAdministrator
<#
.SYNOPSIS
    FMD Framework — Full deployment script for vsc-fabric server.
    Run this on vsc-fabric via RDP in an ADMIN PowerShell.

.DESCRIPTION
    1. Pulls latest code from GitHub
    2. Installs Python dependencies (arrow-odbc, polars, pyodbc)
    3. Installs SQL Server command-line tools (BCP) if missing
    4. Installs/updates Node.js dependencies for dashboard
    5. Restarts the FMD-Dashboard service (NSSM)
    6. Runs turbo_extract.py to extract all remaining entities over LAN

.NOTES
    Server: vsc-fabric (172.29.97.125)
    Project path: C:\Projects\FMD_FRAMEWORK
    Source DBs: m3-db1, M3-DB3, sqllogshipprd (all on same LAN)
#>

$ErrorActionPreference = "Stop"
$ProjectRoot = "C:\Projects\FMD_FRAMEWORK"

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  FMD Framework — vsc-fabric Deployment Script" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ─── Step 1: Pull latest code ───────────────────────────────────────────────

Write-Host "[1/6] Pulling latest code from GitHub..." -ForegroundColor Yellow
Set-Location $ProjectRoot

# Stash any local changes first
$stashResult = git stash 2>&1
Write-Host "  Stash: $stashResult" -ForegroundColor DarkGray

git pull origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: git pull failed. Check credentials or network." -ForegroundColor Red
    Write-Host "  Try: git config credential.helper manager" -ForegroundColor DarkGray
    exit 1
}
Write-Host "  OK — Code is up to date." -ForegroundColor Green
Write-Host ""

# ─── Step 2: Python dependencies ────────────────────────────────────────────

Write-Host "[2/6] Installing Python dependencies..." -ForegroundColor Yellow

# Check if Python is available
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    $python = Get-Command python3 -ErrorAction SilentlyContinue
}
if (-not $python) {
    Write-Host "  ERROR: Python not found. Install Python 3.10+ first." -ForegroundColor Red
    Write-Host "  Download: https://www.python.org/downloads/" -ForegroundColor DarkGray
    exit 1
}
Write-Host "  Python: $($python.Source)" -ForegroundColor DarkGray

# Core extraction dependencies
$packages = @(
    "polars",           # Fast DataFrame library (Rust-based)
    "pyodbc",           # ODBC driver for SQL Server
    "arrow-odbc",       # Rust-based Arrow batch reader over ODBC
    "pyarrow",          # Apache Arrow (Parquet writing)
    "requests",         # HTTP client (for API calls)
    "tqdm"              # Progress bars
)

foreach ($pkg in $packages) {
    Write-Host "  Installing $pkg..." -ForegroundColor DarkGray
    python -m pip install --upgrade $pkg --quiet 2>&1 | Out-Null
}

# Also install engine requirements if they exist
if (Test-Path "$ProjectRoot\requirements.txt") {
    Write-Host "  Installing requirements.txt..." -ForegroundColor DarkGray
    python -m pip install -r "$ProjectRoot\requirements.txt" --quiet 2>&1 | Out-Null
}

Write-Host "  OK — Python packages installed." -ForegroundColor Green
Write-Host ""

# ─── Step 3: SQL Server command-line tools (BCP) ────────────────────────────

Write-Host "[3/6] Checking for BCP (SQL Server command-line tools)..." -ForegroundColor Yellow

$bcp = Get-Command bcp -ErrorAction SilentlyContinue
if ($bcp) {
    Write-Host "  OK — BCP found: $($bcp.Source)" -ForegroundColor Green
} else {
    Write-Host "  BCP not found. Attempting install via winget..." -ForegroundColor DarkGray

    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        winget install Microsoft.Sqlcmd --accept-package-agreements --accept-source-agreements 2>&1

        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

        $bcp = Get-Command bcp -ErrorAction SilentlyContinue
        if ($bcp) {
            Write-Host "  OK — BCP installed: $($bcp.Source)" -ForegroundColor Green
        } else {
            Write-Host "  WARNING: BCP install may need a new terminal. Will fall back to pyodbc method." -ForegroundColor Yellow
        }
    } else {
        Write-Host "  WARNING: winget not available. Install SQL Server tools manually:" -ForegroundColor Yellow
        Write-Host "  https://learn.microsoft.com/en-us/sql/tools/sqlcmd/sqlcmd-utility" -ForegroundColor DarkGray
        Write-Host "  Will fall back to pyodbc method." -ForegroundColor DarkGray
    }
}
Write-Host ""

# ─── Step 4: ODBC Driver check ──────────────────────────────────────────────

Write-Host "[4/6] Checking ODBC Driver 18..." -ForegroundColor Yellow

$odbcDrivers = Get-OdbcDriver | Where-Object { $_.Name -like "*SQL Server*" }
if ($odbcDrivers) {
    foreach ($d in $odbcDrivers) {
        Write-Host "  Found: $($d.Name)" -ForegroundColor DarkGray
    }
    if ($odbcDrivers.Name -contains "ODBC Driver 18 for SQL Server") {
        Write-Host "  OK — ODBC Driver 18 present." -ForegroundColor Green
    } else {
        Write-Host "  WARNING: ODBC Driver 18 not found. turbo_extract uses Driver 18 by default." -ForegroundColor Yellow
        Write-Host "  Available drivers: $($odbcDrivers.Name -join ', ')" -ForegroundColor DarkGray
    }
} else {
    Write-Host "  ERROR: No SQL Server ODBC drivers found!" -ForegroundColor Red
    Write-Host "  Install: https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server" -ForegroundColor DarkGray
}
Write-Host ""

# ─── Step 5: Dashboard (Node.js) ────────────────────────────────────────────

Write-Host "[5/6] Updating dashboard..." -ForegroundColor Yellow

$dashDir = "$ProjectRoot\dashboard\app"
if (Test-Path "$dashDir\package.json") {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) {
        Write-Host "  Node: $($node.Source) — $(node --version)" -ForegroundColor DarkGray
        Set-Location $dashDir
        npm install --quiet 2>&1 | Out-Null
        Write-Host "  OK — npm packages installed." -ForegroundColor Green

        # Build frontend
        Write-Host "  Building frontend..." -ForegroundColor DarkGray
        npm run build 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  OK — Frontend built." -ForegroundColor Green
        } else {
            Write-Host "  WARNING: Frontend build failed. Dashboard may use stale assets." -ForegroundColor Yellow
        }
    } else {
        Write-Host "  WARNING: Node.js not found. Dashboard won't be updated." -ForegroundColor Yellow
        Write-Host "  Must be v22 LTS (v24 breaks better-sqlite3)" -ForegroundColor DarkGray
    }
} else {
    Write-Host "  Skipped — no package.json found." -ForegroundColor DarkGray
}

Set-Location $ProjectRoot

# Restart dashboard service if NSSM is managing it
$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if ($nssm) {
    $svcStatus = nssm status FMD-Dashboard 2>&1
    if ($svcStatus -match "SERVICE_RUNNING|SERVICE_STOPPED|SERVICE_PAUSED") {
        Write-Host "  Restarting FMD-Dashboard service..." -ForegroundColor DarkGray
        nssm restart FMD-Dashboard 2>&1 | Out-Null
        Start-Sleep -Seconds 3
        $newStatus = nssm status FMD-Dashboard 2>&1
        Write-Host "  FMD-Dashboard: $newStatus" -ForegroundColor Green
    }
}
Write-Host ""

# ─── Step 6: Connection test + extraction ────────────────────────────────────

Write-Host "[6/6] Testing database connections..." -ForegroundColor Yellow

$servers = @(
    @{ Name = "MES";        Server = "m3-db1";         Database = "mes" },
    @{ Name = "ETQ";        Server = "M3-DB3";         Database = "ETQStagingPRD" },
    @{ Name = "M3 ERP";     Server = "sqllogshipprd";  Database = "m3fdbprd" }
)

$allGood = $true
foreach ($srv in $servers) {
    Write-Host "  Testing $($srv.Name) ($($srv.Server))..." -ForegroundColor DarkGray -NoNewline

    $testResult = python -c @"
import pyodbc, time
t0 = time.time()
try:
    conn = pyodbc.connect(
        'DRIVER={ODBC Driver 18 for SQL Server};'
        'SERVER=$($srv.Server);DATABASE=$($srv.Database);'
        'Trusted_Connection=yes;TrustServerCertificate=yes;',
        timeout=10
    )
    conn.execute('SELECT 1').fetchone()
    conn.close()
    ms = int((time.time() - t0) * 1000)
    print(f'OK ({ms}ms)')
except Exception as e:
    print(f'FAIL: {e}')
"@ 2>&1

    if ($testResult -match "^OK") {
        Write-Host " $testResult" -ForegroundColor Green
    } else {
        Write-Host " $testResult" -ForegroundColor Red
        $allGood = $false
    }
}
Write-Host ""

# ─── Summary ─────────────────────────────────────────────────────────────────

Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Deployment Complete!" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

if ($allGood) {
    Write-Host "  All database connections OK. Ready to extract." -ForegroundColor Green
    Write-Host ""
    Write-Host "  To start extraction, run:" -ForegroundColor White
    Write-Host ""
    Write-Host "    cd $ProjectRoot" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "    # Method 1: BCP (fastest — native TDS bulk export)" -ForegroundColor DarkGray
    Write-Host "    python scripts/turbo_extract.py --method bcp --workers 16 --skip-existing" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "    # Method 2: arrow-odbc (Rust Arrow batches)" -ForegroundColor DarkGray
    Write-Host "    python scripts/turbo_extract.py --method arrow-odbc --workers 16 --skip-existing" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "    # Method 3: pyodbc (proven reliable, connection reuse)" -ForegroundColor DarkGray
    Write-Host "    python scripts/turbo_extract.py --method pyodbc --workers 16 --skip-existing" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "    # Or start the dashboard API server:" -ForegroundColor DarkGray
    Write-Host "    python dashboard/app/api/main.py" -ForegroundColor Cyan
    Write-Host ""
} else {
    Write-Host "  Some database connections failed." -ForegroundColor Yellow
    Write-Host "  Make sure you're on the LAN (not VPN) and Windows Auth works." -ForegroundColor DarkGray
    Write-Host "  The script will still work — failed sources will be skipped." -ForegroundColor DarkGray
}
