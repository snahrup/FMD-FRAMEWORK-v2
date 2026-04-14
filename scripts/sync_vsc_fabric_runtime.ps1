[CmdletBinding()]
param(
    [string]$Server = "vsc-fabric",
    [string]$RemoteProjectRoot = "C:\Projects\FMD_FRAMEWORK",
    [string]$RemotePython = "python",
    [string]$RemoteServiceName = "FMD-Dashboard",
    [switch]$CopyControlPlaneDb = $true,
    [switch]$RestartDashboard = $true,
    [switch]$StartExtraction,
    [ValidateSet("auto", "bcp", "arrow-odbc", "pyodbc")]
    [string]$Method = "pyodbc",
    [int]$Workers = 8,
    [int]$Timeout = 300,
    [switch]$SkipExisting = $true,
    [string]$Source,
    [int]$Limit,
    [string]$OutputDir = "C:\Projects\FMD_FRAMEWORK\parquet_out",
    [switch]$GitPull
)

$ErrorActionPreference = "Stop"

$localProjectRoot = Split-Path -Parent $PSScriptRoot
$payloadDir = Join-Path $localProjectRoot ".tmp\vsc-fabric-payload"
$localSnapshot = Join-Path $payloadDir "fmd_control_plane.snapshot.db"
$localEntities = Join-Path $payloadDir "entities_export.json"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host $Message -ForegroundColor Cyan
}

function Invoke-Remote {
    param(
        [System.Management.Automation.Runspaces.PSSession]$Session,
        [scriptblock]$ScriptBlock,
        [object[]]$ArgumentList = @()
    )
    Invoke-Command -Session $Session -ScriptBlock $ScriptBlock -ArgumentList $ArgumentList
}

Write-Step "[1/4] Preparing local payload"
New-Item -ItemType Directory -Force -Path $payloadDir | Out-Null

$prepScript = Join-Path $PSScriptRoot "prepare_vsc_fabric_payload.py"
& python $prepScript --out-dir $payloadDir
if ($LASTEXITCODE -ne 0) {
    throw "prepare_vsc_fabric_payload.py failed."
}

Write-Step "[2/4] Opening PowerShell remoting session to $Server"
try {
    $session = New-PSSession -ComputerName $Server
} catch {
    throw "Could not open a PowerShell remoting session to '$Server'. Ensure WinRM is enabled and your account has access."
}

try {
    $remoteRuntimeDir = Join-Path $RemoteProjectRoot ".runtime-sync"
    $remoteSnapshotIncoming = Join-Path $remoteRuntimeDir "fmd_control_plane.incoming.db"
    $remoteEntitiesIncoming = Join-Path $remoteRuntimeDir "entities_export.incoming.json"
    $remoteDbPath = Join-Path $RemoteProjectRoot "dashboard\app\api\fmd_control_plane.db"
    $remoteEntitiesPath = Join-Path $RemoteProjectRoot "scripts\entities_export.json"

    Invoke-Remote -Session $session -ArgumentList $RemoteProjectRoot, $remoteRuntimeDir -ScriptBlock {
        param($projectRoot, $runtimeDir)
        if (-not (Test-Path $projectRoot)) {
            throw "Remote project root not found: $projectRoot"
        }
        New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
        New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot "logs") | Out-Null
    } | Out-Null

    if ($GitPull) {
        Write-Step "[3/4] Pulling latest code on $Server"
        Invoke-Remote -Session $session -ArgumentList $RemoteProjectRoot -ScriptBlock {
            param($projectRoot)
            Set-Location $projectRoot
            git pull --ff-only origin main
        }
    } else {
        Write-Step "[3/4] Syncing runtime state to $Server"
    }

    Copy-Item -ToSession $session -Path $localEntities -Destination $remoteEntitiesIncoming -Force

    if ($CopyControlPlaneDb) {
        Copy-Item -ToSession $session -Path $localSnapshot -Destination $remoteSnapshotIncoming -Force
    }

    Invoke-Remote -Session $session -ArgumentList `
        $RemoteServiceName, $remoteSnapshotIncoming, $remoteDbPath, $remoteEntitiesIncoming, $remoteEntitiesPath, `
        [bool]$CopyControlPlaneDb, [bool]$RestartDashboard `
        -ScriptBlock {
        param(
            $serviceName,
            $snapshotIncoming,
            $dbPath,
            $entitiesIncoming,
            $entitiesPath,
            $copyDb,
            $restartDashboard
        )

        $nssm = Get-Command nssm -ErrorAction SilentlyContinue
        $serviceExists = $false
        if ($nssm) {
            try {
                $status = & nssm status $serviceName 2>&1
                if ($status -match "SERVICE") {
                    $serviceExists = $true
                }
            } catch {
                $serviceExists = $false
            }
        }

        if ($copyDb -and $serviceExists) {
            & nssm stop $serviceName confirm | Out-Null
            Start-Sleep -Seconds 2
        }

        if ($copyDb) {
            Move-Item -Force $snapshotIncoming $dbPath
        }
        Move-Item -Force $entitiesIncoming $entitiesPath

        if ($restartDashboard -and $serviceExists) {
            & nssm start $serviceName | Out-Null
        }

        [pscustomobject]@{
            ControlPlaneDb = $dbPath
            EntitiesJson = $entitiesPath
            DashboardRestarted = ($restartDashboard -and $serviceExists)
        }
    }

    if ($StartExtraction) {
        Write-Step "[4/4] Starting remote extraction on $Server"
        $remoteResult = Invoke-Remote -Session $session -ArgumentList `
            $RemoteProjectRoot, $RemotePython, $Method, $Workers, $Timeout, [bool]$SkipExisting, `
            $Source, $Limit, $OutputDir `
            -ScriptBlock {
            param(
                $projectRoot,
                $pythonExe,
                $method,
                $workers,
                $timeout,
                $skipExisting,
                $source,
                $limit,
                $outputDir
            )

            $logDir = Join-Path $projectRoot "logs"
            New-Item -ItemType Directory -Force -Path $logDir | Out-Null
            $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
            $stdout = Join-Path $logDir "turbo_extract-$stamp.log"
            $stderr = Join-Path $logDir "turbo_extract-$stamp.err.log"

            $argList = @("scripts/turbo_extract.py", "--method", $method, "--workers", "$workers", "--timeout", "$timeout", "--output", $outputDir)
            if ($skipExisting) {
                $argList += "--skip-existing"
            }
            if ($source) {
                $argList += @("--source", $source)
            }
            if ($limit) {
                $argList += @("--limit", "$limit")
            }

            $proc = Start-Process -FilePath $pythonExe `
                -ArgumentList $argList `
                -WorkingDirectory $projectRoot `
                -RedirectStandardOutput $stdout `
                -RedirectStandardError $stderr `
                -WindowStyle Hidden `
                -PassThru

            [pscustomobject]@{
                Pid = $proc.Id
                StdOut = $stdout
                StdErr = $stderr
                DashboardUrl = "http://$env:COMPUTERNAME/load-mission-control"
            }
        }

        Write-Host ""
        Write-Host "Remote extraction started." -ForegroundColor Green
        Write-Host ("  PID: " + $remoteResult.Pid)
        Write-Host ("  STDOUT: " + $remoteResult.StdOut)
        Write-Host ("  STDERR: " + $remoteResult.StdErr)
        Write-Host ("  Dashboard: " + $remoteResult.DashboardUrl)
    } else {
        Write-Host ""
        Write-Host "Runtime sync complete." -ForegroundColor Green
        Write-Host ("  Remote DB: " + $remoteDbPath)
        Write-Host ("  Remote entities export: " + $remoteEntitiesPath)
        Write-Host ("  Dashboard: http://$Server/")
    }
}
finally {
    if ($session) {
        Remove-PSSession $session
    }
}
