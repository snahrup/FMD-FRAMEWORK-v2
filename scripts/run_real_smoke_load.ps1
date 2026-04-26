param(
    [string]$FrameworkPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$Python = "",
    [int]$EntityId = 0,
    [string[]]$Layers = @("landing", "bronze", "silver"),
    [string]$RunId = "",
    [string]$ApiBaseUrl = "http://127.0.0.1:5288",
    [string]$OneLakeMountPath = "",
    [switch]$RequireApiPreflight,
    [switch]$SkipApiPreflight,
    [switch]$AllowUnverifiedArtifacts,
    [switch]$Incremental
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==== $Message ===="
}

function Resolve-Python {
    param([string]$Requested)
    if ($Requested) {
        return $Requested
    }
    if ($env:FMD_PYTHON) {
        return $env:FMD_PYTHON
    }
    $orchestratorPython = "C:\Users\snahrup\CascadeProjects\FMD_ORCHESTRATOR\.venv\Scripts\python.exe"
    if (Test-Path $orchestratorPython) {
        return $orchestratorPython
    }
    return "python"
}

function Resolve-OneLakeMount {
    param([string]$Requested)
    if ($Requested) {
        return $Requested
    }
    if ($env:ONELAKE_MOUNT_PATH) {
        return $env:ONELAKE_MOUNT_PATH
    }
    $defaultMount = Join-Path $env:USERPROFILE "OneLake - Microsoft"
    if (Test-Path $defaultMount) {
        return $defaultMount
    }
    return ""
}

function Invoke-Native {
    param(
        [string]$Exe,
        [string[]]$Arguments,
        [string]$LogPath = ""
    )
    if ($LogPath) {
        & $Exe @Arguments 2>&1 | Tee-Object -FilePath $LogPath
    } else {
        & $Exe @Arguments
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE`: $Exe $($Arguments -join ' ')"
    }
}

$FrameworkPath = (Resolve-Path $FrameworkPath).Path
$Python = Resolve-Python -Requested $Python
$OneLakeMountPath = Resolve-OneLakeMount -Requested $OneLakeMountPath
if ($OneLakeMountPath) {
    $env:ONELAKE_MOUNT_PATH = $OneLakeMountPath
}
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
Set-Location $FrameworkPath

Write-Host "FMD real smoke load"
Write-Host "Project: $FrameworkPath"
Write-Host "Python:  $Python"
Write-Host "Layers:  $($Layers -join ', ')"
Write-Host "OneLake: $(if ($OneLakeMountPath) { $OneLakeMountPath } else { 'not configured; ADLS verifier fallback will be used' })"
Write-Host "Mode:    $(if ($Incremental) { 'incremental watermark mode' } else { 'full-refresh seed mode (watermarks unchanged)' })"

Write-Step "Verify Python runtime"
$runtimeProbe = "import _overlapped; import pyodbc, polars, pyarrow, deltalake; print('python socket stack and real-loader deps ok')"
Invoke-Native -Exe $Python -Arguments @("-c", $runtimeProbe)

Write-Step "Resolve smoke entity"
if ($EntityId -eq 0) {
    $smokeJson = & $Python "scripts\select_smoke_entity.py"
    if ($LASTEXITCODE -ne 0) {
        throw "Smoke entity selection failed."
    }
    $smoke = $smokeJson | ConvertFrom-Json
    if (-not $smoke.entity_id) {
        throw "Smoke entity selector did not return entity_id: $smokeJson"
    }
    $EntityId = [int]$smoke.entity_id
    Write-Host "Selected entity $EntityId ($($smoke.source) $($smoke.schema).$($smoke.table))"
} else {
    Write-Host "Using provided entity $EntityId"
}

if (-not $RunId) {
    $RunId = "real-smoke-$timestamp-e$EntityId"
}

$runDir = Join-Path $FrameworkPath ".runs\real-smoke\$RunId"
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
$workerLog = Join-Path $runDir "worker.log"
$receiptPath = Join-Path $runDir "receipt.json"

Write-Step "Optional API preflight"
if ($SkipApiPreflight) {
    Write-Host "Skipped by flag."
} else {
    $body = @{
        runtime_mode = "framework"
        entity_ids = @($EntityId)
        layers = $Layers
        force_full_refresh = (-not [bool]$Incremental)
    } | ConvertTo-Json -Depth 5
    try {
        $preflight = Invoke-RestMethod -Method Post -Uri "$ApiBaseUrl/api/engine/preflight" -ContentType "application/json" -Body $body -TimeoutSec 30
        $preflight | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $runDir "preflight.json") -Encoding UTF8
        if (-not $preflight.ok) {
            $failed = @($preflight.checks | Where-Object { $_.status -eq "failed" })
            $failedText = ($failed | ForEach-Object { "$($_.label): $($_.message)" }) -join "; "
            throw "API preflight failed: $failedText"
        }
        Write-Host "API preflight passed."
    } catch {
        if ($RequireApiPreflight) {
            throw
        }
        Write-Warning "API preflight unavailable or failed; continuing because -RequireApiPreflight was not supplied. $($_.Exception.Message)"
    }
}

Write-Step "Run real scoped load"
$workerArgs = @(
    "-m", "engine.worker",
    "--run-id", $RunId,
    "--layers"
) + $Layers + @(
    "--entity-ids", "$EntityId",
    "--triggered-by", "real-smoke-load"
)
if (-not $Incremental) {
    $workerArgs += "--force-full-refresh"
}
Invoke-Native -Exe $Python -Arguments $workerArgs -LogPath $workerLog

Write-Step "Verify receipt"
$verifyArgs = @(
    "scripts\verify_real_smoke_load.py",
    "--run-id", $RunId,
    "--entity-id", "$EntityId",
    "--layers"
) + $Layers + @(
    "--output", $receiptPath
)
if ($AllowUnverifiedArtifacts) {
    $verifyArgs += "--allow-unverified-artifacts"
}
if ($OneLakeMountPath) {
    $verifyArgs += @("--onelake-mount", $OneLakeMountPath)
}
Invoke-Native -Exe $Python -Arguments $verifyArgs

Write-Host ""
Write-Host "Real smoke load verified."
Write-Host "Run ID:  $RunId"
Write-Host "Receipt: $receiptPath"
Write-Host "Log:     $workerLog"
Write-Host "UI:      http://127.0.0.1:5288/mission-control?run=$RunId"
