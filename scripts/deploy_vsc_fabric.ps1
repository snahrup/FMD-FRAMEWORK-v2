#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
$ProjectRoot = "C:\Projects\FMD_FRAMEWORK"

Write-Host ""
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  FMD Framework - vsc-fabric Deployment Script" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Pull latest code
Write-Host "[1/6] Pulling latest code from GitHub..." -ForegroundColor Yellow
Set-Location $ProjectRoot
git pull origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: git pull failed." -ForegroundColor Red
    exit 1
}
Write-Host "  OK - Code is up to date." -ForegroundColor Green
Write-Host ""

# Step 2: Python dependencies
Write-Host "[2/6] Installing Python dependencies..." -ForegroundColor Yellow
python -m pip install --upgrade polars pyodbc arrow-odbc pyarrow requests tqdm 2>&1
if (Test-Path "$ProjectRoot\requirements.txt") {
    python -m pip install -r "$ProjectRoot\requirements.txt" 2>&1
}
Write-Host "  OK - Python packages installed." -ForegroundColor Green
Write-Host ""

# Step 3: BCP check
Write-Host "[3/6] Checking for BCP..." -ForegroundColor Yellow
$bcpPath = Get-Command bcp -ErrorAction SilentlyContinue
if ($bcpPath) {
    Write-Host ("  OK - BCP found: " + $bcpPath.Source) -ForegroundColor Green
} else {
    Write-Host "  BCP not found. Will use pyodbc method instead." -ForegroundColor Yellow
    Write-Host "  To install: winget install Microsoft.Sqlcmd" -ForegroundColor DarkGray
}
Write-Host ""

# Step 4: ODBC Driver check
Write-Host "[4/6] Checking ODBC drivers..." -ForegroundColor Yellow
$drivers = Get-OdbcDriver | Where-Object { $_.Name -like "*SQL Server*" }
foreach ($d in $drivers) {
    Write-Host ("  Found: " + $d.Name) -ForegroundColor DarkGray
}
if ($drivers.Name -contains "ODBC Driver 18 for SQL Server") {
    Write-Host "  OK - ODBC Driver 18 present." -ForegroundColor Green
} elseif ($drivers.Name -contains "ODBC Driver 17 for SQL Server") {
    Write-Host "  ODBC Driver 17 found (18 preferred but 17 works)." -ForegroundColor Yellow
} else {
    Write-Host "  WARNING: No modern ODBC driver found!" -ForegroundColor Red
}
Write-Host ""

# Step 5: Dashboard
Write-Host "[5/6] Updating dashboard..." -ForegroundColor Yellow
$dashDir = Join-Path $ProjectRoot "dashboard\app"
$nodePath = Get-Command node -ErrorAction SilentlyContinue
if ($nodePath -and (Test-Path (Join-Path $dashDir "package.json"))) {
    Write-Host ("  Node: " + (node --version)) -ForegroundColor DarkGray
    Set-Location $dashDir
    npm install 2>&1 | Out-Null
    Write-Host "  npm packages installed." -ForegroundColor Green
    npm run build 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Frontend built." -ForegroundColor Green
    } else {
        Write-Host "  Frontend build failed - dashboard may use stale assets." -ForegroundColor Yellow
    }
    Set-Location $ProjectRoot
} else {
    Write-Host "  Skipped (Node.js not found or no package.json)." -ForegroundColor Yellow
}

# Restart NSSM service if present
$nssmPath = Get-Command nssm -ErrorAction SilentlyContinue
if ($nssmPath) {
    $svcCheck = nssm status FMD-Dashboard 2>&1
    if ($svcCheck -match "SERVICE") {
        Write-Host "  Restarting FMD-Dashboard service..." -ForegroundColor DarkGray
        nssm restart FMD-Dashboard 2>&1 | Out-Null
        Start-Sleep -Seconds 3
        Write-Host ("  FMD-Dashboard: " + (nssm status FMD-Dashboard 2>&1)) -ForegroundColor Green
    }
}
Write-Host ""

# Step 6: Connection tests via separate Python script
Write-Host "[6/6] Testing database connections..." -ForegroundColor Yellow

$testScript = Join-Path $ProjectRoot "scripts\_test_connections.py"
Set-Content -Path $testScript -Value @'
import pyodbc, time, sys

servers = [
    ("MES",    "m3-db1",        "mes"),
    ("ETQ",    "M3-DB3",        "ETQStagingPRD"),
    ("M3 ERP", "sqllogshipprd", "m3fdbprd"),
]

all_ok = True
for name, server, db in servers:
    sys.stdout.write(f"  Testing {name} ({server})... ")
    sys.stdout.flush()
    t0 = time.time()
    try:
        conn = pyodbc.connect(
            f"DRIVER={{ODBC Driver 18 for SQL Server}};"
            f"SERVER={server};DATABASE={db};"
            f"Trusted_Connection=yes;TrustServerCertificate=yes;",
            timeout=10
        )
        conn.execute("SELECT 1").fetchone()
        conn.close()
        ms = int((time.time() - t0) * 1000)
        print(f"OK ({ms}ms)")
    except Exception as e:
        print(f"FAIL: {e}")
        all_ok = False

sys.exit(0 if all_ok else 1)
'@

python $testScript
$connOk = ($LASTEXITCODE -eq 0)

# Clean up temp script
Remove-Item $testScript -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  Deployment Complete!" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host ""

if ($connOk) {
    Write-Host "  All connections OK. Ready to extract." -ForegroundColor Green
} else {
    Write-Host "  Some connections failed. Check network/auth." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  EXTRACTION COMMANDS:" -ForegroundColor White
Write-Host ""
Write-Host "    cd $ProjectRoot" -ForegroundColor Cyan
Write-Host ""
Write-Host "    # BCP (fastest - native TDS bulk export)" -ForegroundColor DarkGray
Write-Host "    python scripts/turbo_extract.py --method bcp --workers 16 --skip-existing" -ForegroundColor Cyan
Write-Host ""
Write-Host "    # arrow-odbc (Rust Arrow batches)" -ForegroundColor DarkGray
Write-Host "    python scripts/turbo_extract.py --method arrow-odbc --workers 16 --skip-existing" -ForegroundColor Cyan
Write-Host ""
Write-Host "    # pyodbc (proven reliable)" -ForegroundColor DarkGray
Write-Host "    python scripts/turbo_extract.py --method pyodbc --workers 16 --skip-existing" -ForegroundColor Cyan
Write-Host ""
