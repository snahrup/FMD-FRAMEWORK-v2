[CmdletBinding()]
param(
    [string]$ProjectRoot = "C:\Projects\FMD_FRAMEWORK",
    [string]$Branch = "main",
    [string]$RemoteName = "origin",
    [string]$PythonExe = "python",
    [string]$NodeBuildCommand = "npx vite build",
    [string]$DashboardServiceName = "FMD-Dashboard",
    [switch]$InstallPythonDeps = $true,
    [switch]$BuildFrontend = $true,
    [switch]$RestartDashboard = $true,
    [switch]$CleanupStaleRuns = $true,
    [switch]$StartExtraction,
    [ValidateSet("auto", "bcp", "arrow-odbc", "pyodbc")]
    [string]$Method = "pyodbc",
    [int]$Workers = 8,
    [int]$Timeout = 300,
    [switch]$SkipExisting = $true,
    [string]$Source,
    [int]$Limit,
    [string]$OutputDir = "C:\Projects\FMD_FRAMEWORK\parquet_out"
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host $Message -ForegroundColor Cyan
}

function Assert-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found on PATH: $Name"
    }
}

if (-not (Test-Path $ProjectRoot)) {
    throw "Project root not found: $ProjectRoot"
}

Assert-Command git
Assert-Command $PythonExe

Write-Step "[1/6] Pulling latest code from GitHub"
Set-Location $ProjectRoot
git fetch $RemoteName $Branch
git pull --ff-only $RemoteName $Branch

if ($InstallPythonDeps) {
    Write-Step "[2/6] Installing Python dependencies"
    $requirements = Join-Path $ProjectRoot "engine\requirements.txt"
    if (Test-Path $requirements) {
        & $PythonExe -m pip install -r $requirements
    } else {
        Write-Host "engine\\requirements.txt not found; skipping pip install." -ForegroundColor Yellow
    }
}

if ($CleanupStaleRuns) {
    Write-Step "[3/6] Cleaning up stale runs"
    & $PythonExe (Join-Path $ProjectRoot "scripts\cleanup_stale_runs.py")
}

if ($BuildFrontend) {
    Write-Step "[4/6] Rebuilding dashboard frontend"
    $dashboardRoot = Join-Path $ProjectRoot "dashboard\app"
    if (-not (Test-Path (Join-Path $dashboardRoot "package.json"))) {
        throw "dashboard\\app\\package.json not found under $ProjectRoot"
    }

    Assert-Command npm
    Push-Location $dashboardRoot
    try {
        npm install
        Invoke-Expression $NodeBuildCommand
    } finally {
        Pop-Location
    }
}

if ($RestartDashboard) {
    Write-Step "[5/6] Restarting dashboard service"
    $nssm = Get-Command nssm -ErrorAction SilentlyContinue
    if (-not $nssm) {
        throw "nssm is required to manage $DashboardServiceName on vsc-fabric"
    }
    & nssm restart $DashboardServiceName
}

if ($StartExtraction) {
    Write-Step "[6/6] Starting turbo extraction"
    $logDir = Join-Path $ProjectRoot "logs"
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $stdout = Join-Path $logDir "turbo_extract-$stamp.log"
    $stderr = Join-Path $logDir "turbo_extract-$stamp.err.log"

    $argList = @(
        "scripts/turbo_extract.py",
        "--method", $Method,
        "--workers", "$Workers",
        "--timeout", "$Timeout",
        "--output", $OutputDir
    )
    if ($SkipExisting) {
        $argList += "--skip-existing"
    }
    if ($Source) {
        $argList += @("--source", $Source)
    }
    if ($Limit) {
        $argList += @("--limit", "$Limit")
    }

    $proc = Start-Process -FilePath $PythonExe `
        -ArgumentList $argList `
        -WorkingDirectory $ProjectRoot `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -WindowStyle Hidden `
        -PassThru

    Write-Host ""
    Write-Host "Extraction started." -ForegroundColor Green
    Write-Host ("  PID: " + $proc.Id)
    Write-Host ("  STDOUT: " + $stdout)
    Write-Host ("  STDERR: " + $stderr)
    Write-Host "  Dashboard: http://localhost:8787/load-mission-control"
} else {
    Write-Step "[6/6] Runtime refresh complete"
    Write-Host "Dashboard: http://localhost:8787/" -ForegroundColor Green
}
