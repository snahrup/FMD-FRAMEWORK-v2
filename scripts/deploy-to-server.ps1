# deploy-to-server.ps1 — Run this ON VSC-Fabric to pull latest code and rebuild
# Usage: .\deploy-to-server.ps1

$ErrorActionPreference = "Stop"
$fmdDir = "C:\Projects\FMD_FRAMEWORK"
$dashDir = Join-Path $fmdDir "dashboard\app"

Write-Host "`n=== FMD Dashboard Deploy ===" -ForegroundColor Cyan

# 1. Pull latest
Write-Host "`n[1/3] Pulling latest from GitHub..." -ForegroundColor Yellow
Push-Location $fmdDir
git pull --quiet
Pop-Location
Write-Host "  OK" -ForegroundColor Green

# 2. Rebuild frontend
Write-Host "`n[2/3] Building frontend..." -ForegroundColor Yellow
Push-Location $dashDir
$ErrorActionPreference = "Continue"
npm install --silent 2>$null
npm run build 2>$null
$ErrorActionPreference = "Stop"
Pop-Location
if (Test-Path (Join-Path $dashDir "dist\index.html")) {
    Write-Host "  OK — dist/index.html exists" -ForegroundColor Green
} else {
    Write-Host "  FAIL — build did not produce dist/" -ForegroundColor Red
    exit 1
}

# 3. Restart dashboard service
Write-Host "`n[3/3] Restarting FMD-Dashboard service..." -ForegroundColor Yellow
$ErrorActionPreference = "Continue"
nssm restart "FMD-Dashboard" 2>$null
$ErrorActionPreference = "Stop"
Start-Sleep -Seconds 2

# Verify
$response = try { Invoke-WebRequest -Uri "http://localhost:8787" -UseBasicParsing -TimeoutSec 5 } catch { $null }
if ($response -and $response.StatusCode -eq 200) {
    Write-Host "`n=== DEPLOY SUCCESS ===" -ForegroundColor Green
    Write-Host "  Dashboard: http://localhost:8787" -ForegroundColor Cyan
    Write-Host "  IIS Proxy: http://VSC-Fabric" -ForegroundColor Cyan
} else {
    Write-Host "`n=== WARNING: Dashboard not responding ===" -ForegroundColor Red
    Write-Host "  Check: nssm status FMD-Dashboard" -ForegroundColor Yellow
}
