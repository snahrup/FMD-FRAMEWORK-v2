<#
.SYNOPSIS
    FMD Dashboard Server Provisioning Script
    Installs Chrome, Claude Desktop, Claude Code, Nexus, MCP configs,
    claude-mcp Chrome extension, NSSM, ODBC drivers, and the FMD Dashboard.

.DESCRIPTION
    Run this on a fresh Windows Server (2019/2022) or Windows 11 machine.
    Must run as Administrator.

    What it installs/configures:
    - Chocolatey (package manager)
    - Git, Node.js 22 LTS, Python 3.12, Google Chrome, NSSM
    - ODBC Driver 18 for SQL Server
    - Claude Code (npm global)
    - Claude Desktop (official installer)
    - Nexus session bridge (cloned from GitHub, installed as Windows service)
    - Nexus MCP server (v2, 17 tools)
    - claude-mcp Chrome extension (built from source)
    - FMD Dashboard (cloned, built, installed as Windows service)
    - All MCP config files for Claude Code + Claude Desktop

.PARAMETER GitHubRepo
    GitHub repo URL for FMD Framework. Default: https://github.com/snahrup/FMD-FRAMEWORK-v2

.PARAMETER NexusRepo
    GitHub repo URL for Nexus. Default: https://github.com/snahrup/nexus

.PARAMETER ProjectDir
    Root directory for projects. Default: C:\Projects

.PARAMETER FabricClientSecret
    Fabric Service Principal client secret (required for dashboard API)

.PARAMETER InternalHostname
    Internal DNS hostname for IIS site (e.g., "VSC-Fabric"). If empty, IIS setup is skipped.

.PARAMETER SkipChrome
    Skip Chrome installation (e.g., if already installed)

.PARAMETER SkipClaudeDesktop
    Skip Claude Desktop installation

.PARAMETER SkipIIS
    Skip IIS reverse proxy setup

.EXAMPLE
    .\provision-remote-server.ps1 -FabricClientSecret "Te.8Q~secret..." -InternalHostname "VSC-Fabric"
#>

param(
    [string]$GitHubRepo = "https://github.com/snahrup/FMD-FRAMEWORK-v2",
    [string]$NexusRepo  = "https://github.com/snahrup/nexus",
    [string]$GitHubToken = "",  # Pass via provision-launcher.ps1 or env var
    [string]$ProjectDir = "C:\Projects",
    [string]$FabricClientSecret = "",
    [string]$InternalHostname = "",
    [switch]$SkipChrome,
    [switch]$SkipClaudeDesktop,
    [switch]$SkipIIS
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# -- Helpers --------------------------------------------------------------

function Write-Step($msg) {
    Write-Host ""
    Write-Host "===========================================================" -ForegroundColor Cyan
    Write-Host "  $msg" -ForegroundColor White
    Write-Host "===========================================================" -ForegroundColor Cyan
}

function Write-Info($msg)    { Write-Host "  [INFO] $msg" -ForegroundColor Gray }
function Write-Ok($msg)      { Write-Host "  [OK]   $msg" -ForegroundColor Green }
function Write-Warn($msg)    { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Write-Fail($msg)    { Write-Host "  [FAIL] $msg" -ForegroundColor Red }

function Test-CommandExists($cmd) {
    $found = Get-Command $cmd -ErrorAction SilentlyContinue
    if (-not $found) { return $false }
    # Reject Windows Store alias stubs (they pretend to be real executables)
    $resolvedPath = $found.Source
    if ($resolvedPath -and $resolvedPath -like "*\Microsoft\WindowsApps\*") {
        return $false
    }
    return $true
}

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path", "User")
}

# -- Preflight ------------------------------------------------------------

Write-Step "PREFLIGHT CHECKS"

if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Info "Not running as admin -- re-launching elevated..."
    Start-Process powershell -Verb RunAs -ArgumentList @(
        "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`""
    )
    exit 0
}

$UserHome   = $env:USERPROFILE
$UserName   = $env:USERNAME
$AppData    = $env:APPDATA
$ClaudeDir  = Join-Path $UserHome ".claude"
$NexusDir   = Join-Path $ProjectDir "nexus"
$FmdDir     = Join-Path $ProjectDir "FMD_FRAMEWORK"
$DashDir    = Join-Path $FmdDir "dashboard\app"
$McpFile    = Join-Path $ClaudeDir ".mcp.json"
$DesktopCfg = Join-Path $AppData "Claude\claude_desktop_config.json"
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$BundleDir  = Join-Path $ScriptDir "config-bundle"

# Path substitution: replace source machine paths with this machine's paths
# Source machine used: C:\Users\snahrup\CascadeProjects and C:/Users/snahrup/CascadeProjects
$OldPathWin  = "C:\\Users\\snahrup\\CascadeProjects"
$OldPathUnix = "C:/Users/snahrup/CascadeProjects"
$NewPathWin  = $ProjectDir -replace '/', '\'
$NewPathUnix = $ProjectDir -replace '\\', '/'

Write-Info "User:        $UserName"
Write-Info "Home:        $UserHome"
Write-Info "Project dir: $ProjectDir"
Write-Info "Claude dir:  $ClaudeDir"

# -- Phase 1: Chocolatey -------------------------------------------------

Write-Step "PHASE 1: Package Manager (Chocolatey)"

if (Test-CommandExists choco) {
    Write-Ok "Chocolatey already installed"
} else {
    Write-Info "Installing Chocolatey..."
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    Refresh-Path
    Write-Ok "Chocolatey installed"
}

# -- Phase 2: Core Tools -------------------------------------------------

Write-Step "PHASE 2: Core Tools (Git, Node.js, Python, NSSM)"

# Disable Windows Store python/python3 alias stubs (they shadow real Python)
$appAliasDir = "$env:LOCALAPPDATA\Microsoft\WindowsApps"
@("python.exe", "python3.exe") | ForEach-Object {
    $stub = Join-Path $appAliasDir $_
    if (Test-Path $stub -ErrorAction SilentlyContinue) {
        try {
            Remove-Item $stub -Force -ErrorAction SilentlyContinue
            Write-Info "Disabled Windows Store alias: $_"
        } catch {
            Write-Warn "Could not remove Store alias $_ -- you may need to disable it in Settings > App Execution Aliases"
        }
    }
}

$packages = @(
    @{ Name = "git";        Cmd = "git"    },
    @{ Name = "nodejs-lts";  Cmd = "node"   },
    @{ Name = "python312";   Cmd = "python" },
    @{ Name = "nssm";        Cmd = "nssm"   }
)

foreach ($pkg in $packages) {
    if (Test-CommandExists $pkg.Cmd) {
        $ver = "unknown"
        try { $ver = (& $pkg.Cmd --version 2>&1 | Select-Object -First 1) } catch {}
        Write-Ok "$($pkg.Name) already installed ($ver)"
    } else {
        Write-Info "Installing $($pkg.Name)..."
        choco install $pkg.Name -y --no-progress
        Refresh-Path
        Write-Ok "$($pkg.Name) installed"
    }
}

# Ensure npm is on path
Refresh-Path

# -- Phase 3: Chrome -----------------------------------------------------

Write-Step "PHASE 3: Google Chrome"

if ($SkipChrome) {
    Write-Warn "Skipped (flag)"
} elseif (Test-Path "C:\Program Files\Google\Chrome\Application\chrome.exe") {
    Write-Ok "Chrome already installed"
} else {
    Write-Info "Installing Chrome..."
    choco install googlechrome -y --no-progress
    Write-Ok "Chrome installed"
}

# -- Phase 4: ODBC Driver 18 ---------------------------------------------

Write-Step "PHASE 4: ODBC Driver 18 for SQL Server"

$odbcInstalled = Get-OdbcDriver -Name "ODBC Driver 18 for SQL Server" -ErrorAction SilentlyContinue
if ($odbcInstalled) {
    Write-Ok "ODBC Driver 18 already installed"
} else {
    Write-Info "Installing ODBC Driver 18..."
    choco install sqlserver-odbcdriver -y --no-progress
    Write-Ok "ODBC Driver 18 installed"
}

# -- Phase 5: Python dependencies ----------------------------------------

Write-Step "PHASE 5: Python Dependencies"

Refresh-Path
Write-Info "Upgrading pip..."
python -m pip install --upgrade pip --quiet 2>$null

# Dashboard requires: pyodbc (only stdlib + pyodbc)
# Engine requires:    pyodbc, polars, azure-storage-file-datalake
$pipPackages = @("pyodbc", "polars", "azure-storage-file-datalake")
foreach ($pkg in $pipPackages) {
    Write-Info "Installing $pkg..."
    python -m pip install $pkg --quiet 2>$null
    Write-Ok "$pkg installed"
}

# Also install engine requirements.txt if present
$engineReqs = Join-Path $FmdDir "engine\requirements.txt"
if (Test-Path $engineReqs) {
    Write-Info "Installing engine requirements from requirements.txt..."
    python -m pip install -r $engineReqs --quiet 2>$null
    Write-Ok "Engine requirements installed"
}

# -- Phase 6: Claude Code ------------------------------------------------

Write-Step "PHASE 6: Claude Code (CLI)"

if (Test-CommandExists claude) {
    Write-Ok "Claude Code already installed"
} else {
    Write-Info "Installing Claude Code via npm..."
    npm install -g @anthropic-ai/claude-code
    Refresh-Path
    Write-Ok "Claude Code installed"
}

# -- Phase 7: Claude Desktop (MSIX-aware) ------------------------------
#
# KNOWN ISSUE: Claude Desktop ships as an MSIX package wrapped in an EXE.
# In enterprise environments with split admin/user accounts (e.g., your
# login is "jdoe" but elevation runs as "admin-jdoe"), the MSIX registers
# under the ELEVATION account, not the calling user. This means:
#   - The app won't appear in the Start menu for the real user
#   - The app data goes to the wrong profile (%APPDATA% of admin account)
#   - Config files deployed to the real user's profile are ignored
#
# Additionally, enterprise security stacks (Sophos, Arctic Wolf, HitmanPro.Alert)
# may block PowerShell MSIX provisioning commands (Add-AppxPackage, DISM, etc.)
# with "Access Denied" (0x80070005) even under full admin elevation.
#
# This phase detects the split-account scenario, warns about it, and offers
# multiple installation strategies with graceful fallback.
#
# GitHub issue tracking this: https://github.com/anthropics/claude-code/issues/25055

Write-Step "PHASE 7: Claude Desktop (MSIX-aware enterprise install)"

if ($SkipClaudeDesktop) {
    Write-Warn "Skipped (flag)"
} else {
    # -- Detect existing installation --------------------------------
    $claudeExePaths = @(
        "C:\Users\$UserName\AppData\Local\Programs\claude-desktop\Claude.exe",
        "$env:LOCALAPPDATA\Programs\claude-desktop\Claude.exe",
        "C:\Users\$UserName\AppData\Local\AnthropicClaude\Claude.exe"
    )
    $claudeInstalled = $false
    foreach ($p in $claudeExePaths) {
        if (Test-Path $p -ErrorAction SilentlyContinue) {
            Write-Ok "Claude Desktop already installed at: $p"
            $claudeInstalled = $true
            break
        }
    }

    # Also check if it's installed as an MSIX package (may be under a different account)
    if (-not $claudeInstalled) {
        $msixPkg = Get-AppxPackage -Name "AnthropicPBC.claude" -ErrorAction SilentlyContinue
        if (-not $msixPkg) {
            # Try all users (requires admin)
            $msixPkg = Get-AppxPackage -AllUsers -Name "AnthropicPBC.claude" -ErrorAction SilentlyContinue
        }
        if ($msixPkg) {
            Write-Ok "Claude Desktop found as MSIX: $($msixPkg.PackageFullName)"
            Write-Info "  Install location: $($msixPkg.InstallLocation)"
            $claudeInstalled = $true
        }
    }

    if ($claudeInstalled) {
        Write-Ok "Claude Desktop already installed -- skipping"
    } else {
        # -- Split-account detection ---------------------------------
        $callingUser    = $env:USERNAME
        $elevatedUser   = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name.Split('\')[-1]
        $isSplitAccount = ($callingUser -ne $elevatedUser)

        if ($isSplitAccount) {
            Write-Warn "SPLIT-ACCOUNT DETECTED!"
            Write-Warn "  Calling user:   $callingUser"
            Write-Warn "  Elevated as:    $elevatedUser"
            Write-Warn "  The MSIX installer will register under '$elevatedUser', NOT '$callingUser'."
            Write-Warn "  This is a known bug: https://github.com/anthropics/claude-code/issues/25055"
            Write-Host ""
        }

        # -- Strategy 1: Download and try EXE installer --------------
        Write-Info "Downloading Claude Desktop installer..."
        $installerUrl  = "https://storage.googleapis.com/osprey-downloads-c02f6a0d-347c-492b-a752-3e0651722e97/nest-win-x64/Claude-Setup-x64.exe"
        $installerPath = Join-Path $env:TEMP "Claude-Setup-x64.exe"
        try {
            Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing
            Write-Ok "Downloaded: $installerPath"
        } catch {
            Write-Fail "Download failed: $_"
            Write-Warn "You may need to download Claude Desktop manually from https://claude.ai/download"
            # Continue -- don't exit, just skip this phase
            $installerPath = $null
        }

        $installSucceeded = $false

        if ($installerPath -and (Test-Path $installerPath)) {
            # Try the EXE silent install first (works on clean single-account machines)
            Write-Info "Attempting EXE silent install..."
            try {
                $proc = Start-Process -FilePath $installerPath -ArgumentList "/S" -Wait -NoNewWindow -PassThru
                if ($proc.ExitCode -eq 0) {
                    Write-Ok "EXE installer completed (exit code 0)"
                    $installSucceeded = $true
                } else {
                    Write-Warn "EXE installer exited with code $($proc.ExitCode)"
                }
            } catch {
                Write-Warn "EXE installer failed: $_"
            }

            # Verify it actually registered for the right user
            if ($installSucceeded) {
                Start-Sleep -Seconds 3
                $verifyPaths = @(
                    "C:\Users\$callingUser\AppData\Local\Programs\claude-desktop\Claude.exe",
                    "$env:LOCALAPPDATA\Programs\claude-desktop\Claude.exe"
                )
                $foundForUser = $false
                foreach ($vp in $verifyPaths) {
                    if (Test-Path $vp -ErrorAction SilentlyContinue) {
                        $foundForUser = $true
                        break
                    }
                }

                if (-not $foundForUser -and $isSplitAccount) {
                    Write-Warn "Installation completed but Claude Desktop not found in $callingUser's profile."
                    Write-Warn "It likely registered under the elevation account ($elevatedUser) instead."
                    $installSucceeded = $false
                }
            }
        }

        # -- Strategy 2: Direct MSIX provisioning (split-account fix) --
        if (-not $installSucceeded -and $installerPath -and (Test-Path $installerPath)) {
            Write-Info "Attempting direct MSIX provisioning..."
            Write-Info "(This extracts the MSIX from the EXE and registers for all users)"
            Write-Warn "NOTE: Enterprise security software (Sophos, CrowdStrike, Arctic Wolf)"
            Write-Warn "      may block this with 'Access Denied'. If so, see manual steps below."

            # The EXE is a Squirrel/Electron installer that contains the MSIX.
            # Try extracting it, or use Add-AppxPackage directly if we can find it.
            try {
                # Method A: Look for the MSIX in the extracted installer temp files
                $squirrelTemp = Join-Path $env:TEMP "SquirrelSetup*"
                $msixFiles = Get-ChildItem $squirrelTemp -Filter "*.msix" -Recurse -ErrorAction SilentlyContinue

                if (-not $msixFiles) {
                    # Method B: Download MSIX directly if available
                    # Anthropic publishes MSIX at a known path pattern
                    $msixUrl = "https://storage.googleapis.com/osprey-downloads-c02f6a0d-347c-492b-a752-3e0651722e97/nest-win-x64/Claude.msix"
                    $msixPath = Join-Path $env:TEMP "Claude.msix"
                    try {
                        Invoke-WebRequest -Uri $msixUrl -OutFile $msixPath -UseBasicParsing -ErrorAction Stop
                        Write-Ok "Downloaded MSIX directly"
                        $msixFiles = @(Get-Item $msixPath)
                    } catch {
                        Write-Info "Direct MSIX download not available (this is normal)"
                    }
                }

                if ($msixFiles) {
                    $targetMsix = ($msixFiles | Select-Object -First 1).FullName
                    Write-Info "Found MSIX: $targetMsix"

                    # Try Add-AppxPackage for all users (admin required)
                    try {
                        Add-AppxPackage -Path $targetMsix -ErrorAction Stop
                        Write-Ok "MSIX registered for current user"
                        $installSucceeded = $true
                    } catch {
                        Write-Warn "Add-AppxPackage failed: $_"
                        Write-Info "Trying DISM provisioning for all users..."
                        try {
                            DISM /Online /Add-ProvisionedAppxPackage /PackagePath:$targetMsix /SkipLicense 2>$null
                            Write-Ok "MSIX provisioned via DISM for all users"
                            $installSucceeded = $true
                        } catch {
                            Write-Warn "DISM provisioning also failed: $_"
                        }
                    }
                } else {
                    Write-Warn "Could not locate MSIX package from installer"
                }
            } catch {
                Write-Warn "MSIX extraction/provisioning failed: $_"
            }
        }

        # -- Strategy 3: Scheduled task as the real user --------------
        if (-not $installSucceeded -and $isSplitAccount -and $installerPath -and (Test-Path $installerPath)) {
            Write-Info "Attempting scheduled-task workaround (runs installer as $callingUser)..."
            Write-Warn "This creates a one-shot scheduled task to run the installer as the logged-in user."
            try {
                $taskName = "Claude-Desktop-Install-Temp"
                $action   = New-ScheduledTaskAction -Execute $installerPath -Argument "/S"
                $trigger  = New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(5)
                $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

                # Run as the calling user, not the elevation account
                Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
                    -Settings $settings -User $callingUser -RunLevel Limited -Force | Out-Null

                Write-Info "Scheduled task created -- waiting 30 seconds for install..."
                Start-ScheduledTask -TaskName $taskName
                Start-Sleep -Seconds 30

                # Clean up
                Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

                # Verify
                $callingUserProfile = "C:\Users\$callingUser"
                if (Test-Path "$callingUserProfile\AppData\Local\Programs\claude-desktop\Claude.exe" -ErrorAction SilentlyContinue) {
                    Write-Ok "Claude Desktop installed via scheduled task workaround!"
                    $installSucceeded = $true
                } else {
                    Write-Warn "Scheduled task completed but Claude Desktop not found -- may have been blocked by security software"
                }
            } catch {
                Write-Warn "Scheduled task workaround failed: $_"
            }
        }

        # -- Final status --------------------------------------------
        if ($installSucceeded) {
            Write-Ok "Claude Desktop installed successfully"
        } else {
            Write-Host ""
            Write-Fail "+==============================================================+"
            Write-Fail "|  CLAUDE DESKTOP INSTALL FAILED -- MANUAL STEPS REQUIRED      |"
            Write-Fail "+==============================================================+"
            Write-Fail "|                                                              |"
            Write-Fail "|  All automated methods failed. This is typically caused by:   |"
            Write-Fail "|    1. Split admin/user account (MSIX registers wrong user)    |"
            Write-Fail "|    2. Sophos/CrowdStrike/Arctic Wolf blocking provisioning    |"
            Write-Fail "|    3. AppLocker or WDAC policies blocking MSIX installs       |"
            Write-Fail "|                                                              |"
            Write-Fail "|  MANUAL FIX:                                                 |"
            Write-Fail "|    1. Log in as the REAL user (not admin elevation)           |"
            Write-Fail "|    2. Download from: https://claude.ai/download               |"
            Write-Fail "|    3. Run the installer from a NON-ELEVATED prompt            |"
            Write-Fail "|    4. If that fails, ask IT to whitelist the MSIX:            |"
            Write-Fail "|       Publisher: AnthropicPBC                                 |"
            Write-Fail "|       Package:   AnthropicPBC.claude                          |"
            Write-Fail "|                                                              |"
            Write-Fail "|  The rest of provisioning will continue -- Claude Desktop      |"
            Write-Fail "|  can be installed later. All configs are already deployed.    |"
            Write-Fail "+==============================================================+"
            Write-Host ""
            Write-Warn "Continuing with remaining phases..."
        }

        # Clean up temp files
        if ($installerPath -and (Test-Path $installerPath -ErrorAction SilentlyContinue)) {
            Remove-Item $installerPath -Force -ErrorAction SilentlyContinue
        }
    }
}

# -- Phase 8: Create project directories ---------------------------------

Write-Step "PHASE 8: Project Directories"

@($ProjectDir, $ClaudeDir, (Split-Path $DesktopCfg)) | ForEach-Object {
    if (-not (Test-Path $_)) {
        New-Item -ItemType Directory -Path $_ -Force | Out-Null
        Write-Info "Created: $_"
    }
}
Write-Ok "Directories ready"

# -- Phase 9: Clone repos ------------------------------------------------

Write-Step "PHASE 9: Clone Repositories"

# Inject PAT into GitHub URLs for auth-free cloning
function Get-AuthUrl($repoUrl) {
    if ($GitHubToken -and $repoUrl -match "^https://github\.com/") {
        return $repoUrl -replace "^https://github\.com/", "https://$GitHubToken@github.com/"
    }
    return $repoUrl
}

# Also configure credential helper so future git operations work
if ($GitHubToken) {
    git config --global credential.helper manager
    Write-Info "GitHub PAT embedded in clone URLs (no auth prompts)"
}

# Nexus
if (Test-Path $NexusDir) {
    Write-Info "Nexus dir exists, pulling latest..."
    Push-Location $NexusDir
    git pull --quiet 2>$null
    Pop-Location
} else {
    Write-Info "Cloning Nexus..."
    git clone (Get-AuthUrl $NexusRepo) $NexusDir
    if (-not (Test-Path $NexusDir)) {
        Write-Fail "Nexus clone failed! Check that $NexusRepo is accessible."
        Write-Warn "Skipping Nexus -- continuing with remaining setup..."
    }
}
if (Test-Path $NexusDir) { Write-Ok "Nexus ready at $NexusDir" }

# FMD Framework
if (Test-Path $FmdDir) {
    Write-Info "FMD dir exists, pulling latest..."
    Push-Location $FmdDir
    git pull --quiet 2>$null
    Pop-Location
} else {
    Write-Info "Cloning FMD Framework..."
    git clone (Get-AuthUrl $GitHubRepo) $FmdDir
    if (-not (Test-Path $FmdDir)) {
        Write-Fail "FMD Framework clone failed! Check that $GitHubRepo is accessible."
        Write-Warn "Skipping FMD Framework -- continuing with remaining setup..."
    }
}
if (Test-Path $FmdDir) { Write-Ok "FMD Framework ready at $FmdDir" }

# claude-mcp Chrome extension (public repo -- no token needed)
$ClaudeMcpDir = Join-Path $ProjectDir "claude-mcp"
if (Test-Path $ClaudeMcpDir) {
    Write-Info "claude-mcp dir exists, pulling latest..."
    Push-Location $ClaudeMcpDir
    git pull --quiet 2>$null
    Pop-Location
} else {
    Write-Info "Cloning claude-mcp extension..."
    git clone https://github.com/dnakov/claude-mcp.git $ClaudeMcpDir
    if (-not (Test-Path $ClaudeMcpDir)) {
        Write-Fail "claude-mcp clone failed!"
        Write-Warn "Skipping claude-mcp -- continuing with remaining setup..."
    }
}
if (Test-Path $ClaudeMcpDir) { Write-Ok "claude-mcp ready at $ClaudeMcpDir" }

# -- Phase 10: Install npm dependencies ----------------------------------

Write-Step "PHASE 10: npm Dependencies"

# Node/npm write informational output to stderr, so relax error handling
$ErrorActionPreference = "Continue"

# Nexus
if (Test-Path $NexusDir) {
    Write-Info "Installing Nexus deps..."
    Push-Location $NexusDir
    npm install --quiet 2>$null
    Pop-Location
    Write-Ok "Nexus deps installed"
} else {
    Write-Warn "Nexus dir missing -- skipping npm install"
}

# FMD Dashboard
if (Test-Path $DashDir) {
    Write-Info "Installing FMD Dashboard deps..."
    Push-Location $DashDir
    npm install --quiet 2>$null
    Pop-Location
    Write-Ok "Dashboard deps installed"
} else {
    Write-Warn "Dashboard dir missing -- skipping npm install"
}

# claude-mcp extension
if (Test-Path $ClaudeMcpDir) {
    Write-Info "Installing claude-mcp deps..."
    Push-Location $ClaudeMcpDir
    npm install --quiet 2>$null
    Pop-Location
    Write-Ok "claude-mcp deps installed"
} else {
    Write-Warn "claude-mcp dir missing -- skipping npm install"
}

$ErrorActionPreference = "Stop"

# -- Phase 11: Build artifacts -------------------------------------------

Write-Step "PHASE 11: Build Artifacts"

# Node/npm write informational output to stderr, so relax error handling
$ErrorActionPreference = "Continue"

# Build FMD Dashboard frontend
if (Test-Path $DashDir) {
    Write-Info "Building FMD Dashboard frontend..."
    Push-Location $DashDir
    npm run build 2>$null
    Pop-Location
    Write-Ok "Dashboard built -> $DashDir\dist"
} else {
    Write-Warn "Dashboard dir missing -- skipping build"
}

# Build claude-mcp extension
if (Test-Path $ClaudeMcpDir) {
    Write-Info "Building claude-mcp Chrome extension..."
    Push-Location $ClaudeMcpDir
    npm run build 2>$null
    Pop-Location
    Write-Ok "Extension built -> $ClaudeMcpDir\dist-chrome"
} else {
    Write-Warn "claude-mcp dir missing -- skipping build"
}

$ErrorActionPreference = "Stop"

# -- Phase 12: Deploy Config Bundle --------------------------------------
#
# Copies EXACT config files from Steve's machine (packaged in config-bundle/)
# and does path substitution: C:\Users\snahrup\CascadeProjects -> $ProjectDir
#
# Bundle contents:
#   .claude/CLAUDE.md              -- Global Claude Code instructions (13KB)
#   .claude/settings.json          -- Hooks, MCP servers, permissions, OAuth
#   .claude/settings.local.json    -- Local permission overrides
#   .claude/.credentials.json      -- OAuth tokens
#   .claude/.mcp.json              -- Claude Code MCP server config
#   .claude/commands/*.md          -- Custom slash commands
#   claude-desktop/claude_desktop_config.json  -- Claude Desktop config
#   dashboard-config.json          -- FMD Dashboard API config
#   dashboard-.env                 -- Dashboard environment secrets

Write-Step "PHASE 12: Deploy Config Bundle (from source machine)"

if (-not (Test-Path $BundleDir)) {
    Write-Fail "Config bundle not found at $BundleDir"
    Write-Fail "The config-bundle/ directory must be next to this script."
    Write-Fail "It contains the exact config files from the source machine."
    exit 1
}

function Deploy-ConfigFile {
    param(
        [string]$Source,
        [string]$Destination,
        [switch]$PathSubstitution
    )
    if (-not (Test-Path $Source)) {
        Write-Warn "Bundle missing: $Source"
        return
    }

    $destDir = Split-Path $Destination
    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }

    if ($PathSubstitution) {
        $content = Get-Content $Source -Raw
        # Replace Windows-style paths (double-backslash in JSON)
        $content = $content -replace [regex]::Escape($OldPathWin), $NewPathWin
        # Replace Unix-style paths (forward slashes in JSON)
        $content = $content -replace [regex]::Escape($OldPathUnix), $NewPathUnix
        # Replace single-backslash paths (appears in some JSON)
        $OldPathSingleBS = "C:\Users\snahrup\CascadeProjects"
        $NewPathSingleBS = $ProjectDir
        $content = $content -replace [regex]::Escape($OldPathSingleBS), $NewPathSingleBS
        Set-Content -Path $Destination -Value $content -Encoding UTF8 -NoNewline
    } else {
        Copy-Item -Path $Source -Destination $Destination -Force
    }

    Write-Ok "Deployed: $Destination"
}

# Claude Code config directory
Write-Info "Deploying .claude/ configs..."
Deploy-ConfigFile "$BundleDir\.claude\CLAUDE.md"            "$ClaudeDir\CLAUDE.md"
Deploy-ConfigFile "$BundleDir\.claude\settings.json"        "$ClaudeDir\settings.json"        -PathSubstitution
Deploy-ConfigFile "$BundleDir\.claude\settings.local.json"  "$ClaudeDir\settings.local.json"
Deploy-ConfigFile "$BundleDir\.claude\.credentials.json"    "$ClaudeDir\.credentials.json"
Deploy-ConfigFile "$BundleDir\.claude\.mcp.json"            "$ClaudeDir\.mcp.json"             -PathSubstitution

# Custom commands
$commandsDir = Join-Path $BundleDir ".claude\commands"
if (Test-Path $commandsDir) {
    $destCommandsDir = Join-Path $ClaudeDir "commands"
    if (-not (Test-Path $destCommandsDir)) {
        New-Item -ItemType Directory -Path $destCommandsDir -Force | Out-Null
    }
    Get-ChildItem "$commandsDir\*.md" | ForEach-Object {
        Copy-Item $_.FullName (Join-Path $destCommandsDir $_.Name) -Force
        Write-Ok "  Command: $($_.Name)"
    }
}

# Claude Desktop config
Write-Info "Deploying Claude Desktop config..."
Deploy-ConfigFile "$BundleDir\claude-desktop\claude_desktop_config.json" $DesktopCfg -PathSubstitution

# Skills symlink (MCP Router skills)
$skillsLink = Join-Path $ClaudeDir "skills"
$skillsTarget = Join-Path $AppData "MCP Router\skills"
if ((Test-Path $skillsTarget) -and -not (Test-Path $skillsLink)) {
    New-Item -ItemType SymbolicLink -Path $skillsLink -Target $skillsTarget -Force | Out-Null
    Write-Ok "Skills symlink: $skillsLink -> $skillsTarget"
} elseif (Test-Path $skillsLink) {
    Write-Ok "Skills symlink already exists"
} else {
    Write-Warn "MCP Router skills dir not found at $skillsTarget -- skipping symlink"
}

# -- Phase 13: Dashboard API Config --------------------------------------

Write-Step "PHASE 13: FMD Dashboard API Config (from bundle)"

$apiDir     = Join-Path $DashDir "api"
$configFile = Join-Path $apiDir "config.json"
$envFile    = Join-Path $apiDir ".env"

# Deploy config.json from bundle (exact copy -- no path changes needed, paths are relative)
Deploy-ConfigFile "$BundleDir\dashboard-config.json" $configFile

# .env -- use bundle as base, override secret if provided
if ($FabricClientSecret) {
    $envContent = @"
FABRIC_CLIENT_SECRET=$FabricClientSecret
PURVIEW_ACCOUNT_NAME=
ADMIN_PASSWORD=fmd-admin-2026
"@
    Set-Content -Path $envFile -Value $envContent -Encoding UTF8
    Write-Ok ".env configured with provided secret"
} else {
    Deploy-ConfigFile "$BundleDir\dashboard-.env" $envFile
    Write-Warn ".env copied from bundle -- verify FABRIC_CLIENT_SECRET is correct for this environment"
}

# -- Phase 14: Windows Services (NSSM) -----------------------------------

Write-Step "PHASE 14: Windows Services"

Refresh-Path

# Nexus service
Write-Info "Installing Nexus service..."
$nexusServerJs = Join-Path $NexusDir "src\server.js"
$nodePath = (Get-Command node).Source

$ErrorActionPreference = "Continue"
nssm stop "Nexus" 2>$null
nssm remove "Nexus" confirm 2>$null
$ErrorActionPreference = "Stop"
nssm install "Nexus" $nodePath $nexusServerJs
nssm set "Nexus" AppDirectory $NexusDir
nssm set "Nexus" DisplayName "Nexus Session Bridge"
nssm set "Nexus" Description "Multi-session bridge for Claude Code -- shared memory, messaging, archive"
nssm set "Nexus" Start SERVICE_AUTO_START
nssm set "Nexus" AppStdout (Join-Path $NexusDir "service-stdout.log")
nssm set "Nexus" AppStderr (Join-Path $NexusDir "service-stderr.log")
nssm set "Nexus" AppRotateFiles 1
nssm set "Nexus" AppRotateBytes 10485760
nssm start "Nexus"
Write-Ok "Nexus service installed and started (port 3777)"

# FMD Dashboard service
Write-Info "Installing FMD Dashboard service..."
$pythonPath = (Get-Command python).Source
$serverPy   = Join-Path $apiDir "server.py"

$ErrorActionPreference = "Continue"
nssm stop "FMD-Dashboard" 2>$null
nssm remove "FMD-Dashboard" confirm 2>$null
$ErrorActionPreference = "Stop"
nssm install "FMD-Dashboard" $pythonPath $serverPy
nssm set "FMD-Dashboard" AppDirectory $apiDir
nssm set "FMD-Dashboard" DisplayName "FMD Operations Dashboard"
nssm set "FMD-Dashboard" Description "FMD Data Pipeline Operations Dashboard and API Server"
nssm set "FMD-Dashboard" Start SERVICE_AUTO_START
nssm set "FMD-Dashboard" AppStdout (Join-Path $apiDir "service-stdout.log")
nssm set "FMD-Dashboard" AppStderr (Join-Path $apiDir "service-stderr.log")
nssm set "FMD-Dashboard" AppRotateFiles 1
nssm set "FMD-Dashboard" AppRotateBytes 10485760
nssm start "FMD-Dashboard"
Write-Ok "FMD Dashboard service installed and started (port 8787)"

# -- Phase 15: Firewall Rules --------------------------------------------

Write-Step "PHASE 15: Firewall Rules"

$rules = @(
    @{ Name = "FMD Dashboard (8787)";  Port = 8787 },
    @{ Name = "Nexus Bridge (3777)";   Port = 3777 }
)

foreach ($rule in $rules) {
    $existing = Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Ok "Firewall rule exists: $($rule.Name)"
    } else {
        New-NetFirewallRule -DisplayName $rule.Name -Direction Inbound -Protocol TCP `
            -LocalPort $rule.Port -Action Allow -Profile Domain,Private | Out-Null
        Write-Ok "Firewall rule created: $($rule.Name)"
    }
}

# -- Phase 16: IIS Reverse Proxy with Windows Auth -------------------------
#
# Architecture:
#   [Users on domain] → https://<InternalHostname> (IIS, port 443/80)
#                         ├─ Windows Auth (NTLM/Kerberos) — automatic SSO
#                         ├─ SSL termination (if cert provided)
#                         └─ URL Rewrite → http://localhost:8787 (Python dashboard)
#
# Prerequisites:
#   - Server must be domain-joined for Windows Auth
#   - DNS team must create an A record pointing InternalHostname to this server's IP
#   - For HTTPS: import an SSL cert and update the binding (or use Let's Encrypt)

Write-Step "PHASE 16: IIS Reverse Proxy (Windows Auth)"

if ($SkipIIS) {
    Write-Warn "Skipped (flag)"
} elseif (-not $InternalHostname) {
    Write-Warn "Skipped -- no -InternalHostname provided"
    Write-Info "To enable IIS reverse proxy, re-run with: -InternalHostname 'VSC-Fabric'"
} else {
    Write-Info "Hostname: $InternalHostname"

    # 16a: Install IIS + required features
    # Detect Server vs Client OS -- Server uses Install-WindowsFeature, Client uses Enable-WindowsOptionalFeature
    $isServer = (Get-Command Install-WindowsFeature -ErrorAction SilentlyContinue) -ne $null

    if ($isServer) {
        Write-Info "Windows Server detected -- using Install-WindowsFeature"
        $serverFeatures = @(
            "Web-Server",
            "Web-Default-Doc",
            "Web-Static-Content",
            "Web-Http-Errors",
            "Web-Windows-Auth",
            "Web-Filtering",
            "Web-Http-Logging",
            "Web-Mgmt-Console",
            "Web-WebSockets"
        )
        foreach ($feature in $serverFeatures) {
            $installed = (Get-WindowsFeature -Name $feature -ErrorAction SilentlyContinue)
            if ($installed -and $installed.Installed) {
                Write-Ok "$feature already installed"
            } else {
                try {
                    Install-WindowsFeature -Name $feature -IncludeManagementTools -ErrorAction Stop | Out-Null
                    Write-Ok "$feature installed"
                } catch {
                    Write-Warn "Could not install $feature : $_"
                }
            }
        }
    } else {
        Write-Info "Windows Client detected -- using Enable-WindowsOptionalFeature"
        $clientFeatures = @(
            "IIS-WebServerRole",
            "IIS-WebServer",
            "IIS-CommonHttpFeatures",
            "IIS-DefaultDocument",
            "IIS-StaticContent",
            "IIS-HttpErrors",
            "IIS-Security",
            "IIS-WindowsAuthentication",
            "IIS-RequestFiltering",
            "IIS-HttpLogging",
            "IIS-ManagementConsole",
            "IIS-WebSockets"
        )
        foreach ($feature in $clientFeatures) {
            $state = (Get-WindowsOptionalFeature -Online -FeatureName $feature -ErrorAction SilentlyContinue)
            if ($state -and $state.State -eq "Enabled") {
                Write-Ok "$feature already enabled"
            } else {
                try {
                    Enable-WindowsOptionalFeature -Online -FeatureName $feature -All -NoRestart -ErrorAction Stop | Out-Null
                    Write-Ok "$feature enabled"
                } catch {
                    Write-Warn "Could not enable $feature -- may need Server Manager: $_"
                }
            }
        }
    }

    # 16b: Install URL Rewrite Module (required for reverse proxy)
    Write-Info "Checking URL Rewrite Module..."
    $urlRewriteDll = "C:\Windows\System32\inetsrv\rewrite.dll"
    if (Test-Path $urlRewriteDll) {
        Write-Ok "URL Rewrite Module already installed"
    } else {
        Write-Info "Installing URL Rewrite Module..."
        $urlRewriteUrl = "https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi"
        $urlRewriteMsi = Join-Path $env:TEMP "rewrite_amd64.msi"
        try {
            Invoke-WebRequest -Uri $urlRewriteUrl -OutFile $urlRewriteMsi -UseBasicParsing
            Start-Process msiexec -ArgumentList "/i `"$urlRewriteMsi`" /qn /norestart" -Wait -NoNewWindow
            Write-Ok "URL Rewrite Module installed"
        } catch {
            Write-Warn "URL Rewrite install failed -- download manually from https://www.iis.net/downloads/microsoft/url-rewrite"
            Write-Warn "Error: $_"
        }
    }

    # 16c: Install Application Request Routing (ARR) for proxy capability
    Write-Info "Checking Application Request Routing..."
    $arrDll = "C:\Program Files\IIS\Application Request Routing\requestRouter.dll"
    if (Test-Path $arrDll) {
        Write-Ok "ARR already installed"
    } else {
        Write-Info "Installing Application Request Routing..."
        $arrUrl = "https://download.microsoft.com/download/E/9/8/E9849D6A-020E-47E4-9FD0-A023E99B54EB/requestRouter_amd64.msi"
        $arrMsi = Join-Path $env:TEMP "requestRouter_amd64.msi"
        try {
            Invoke-WebRequest -Uri $arrUrl -OutFile $arrMsi -UseBasicParsing
            Start-Process msiexec -ArgumentList "/i `"$arrMsi`" /qn /norestart" -Wait -NoNewWindow
            Write-Ok "ARR installed"
        } catch {
            Write-Warn "ARR install failed -- download from https://www.iis.net/downloads/microsoft/application-request-routing"
            Write-Warn "Error: $_"
        }
    }

    # 16d: Enable ARR proxy at the server level
    Import-Module WebAdministration -ErrorAction SilentlyContinue
    try {
        Set-WebConfigurationProperty -PSPath "MACHINE/WEBROOT/APPHOST" `
            -Filter "system.webServer/proxy" -Name "enabled" -Value $true -ErrorAction Stop
        Write-Ok "ARR proxy enabled at server level"
    } catch {
        Write-Warn "Could not enable ARR proxy via config -- may need manual IIS Manager config"
    }

    # 16e: Create IIS Site with reverse proxy to localhost:8787
    Write-Info "Configuring IIS site: FMD-Dashboard..."

    $siteName = "FMD-Dashboard"
    $siteDir  = "C:\inetpub\fmd-dashboard"

    # Create site directory (IIS needs a physical path even for proxy)
    if (-not (Test-Path $siteDir)) {
        New-Item -ItemType Directory -Path $siteDir -Force | Out-Null
    }

    # Write a minimal web.config with reverse proxy rules
    $webConfig = @"
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <system.webServer>
        <rewrite>
            <rules>
                <rule name="ReverseProxy-Dashboard" stopProcessing="true">
                    <match url="(.*)" />
                    <action type="Rewrite" url="http://localhost:8787/{R:1}" />
                </rule>
            </rules>
        </rewrite>
        <security>
            <authentication>
                <anonymousAuthentication enabled="false" />
                <windowsAuthentication enabled="true" />
            </authentication>
        </security>
    </system.webServer>
</configuration>
"@
    Set-Content -Path (Join-Path $siteDir "web.config") -Value $webConfig -Encoding UTF8
    Write-Ok "web.config deployed with reverse proxy + Windows Auth"

    # Remove existing site if present, then create fresh
    try {
        $existingSite = Get-Website -Name $siteName -ErrorAction SilentlyContinue
        if ($existingSite) {
            Remove-Website -Name $siteName -ErrorAction SilentlyContinue
            Write-Info "Removed existing IIS site: $siteName"
        }
    } catch {}

    # Remove Default Web Site binding on port 80 to avoid conflicts
    try {
        $defaultSite = Get-Website -Name "Default Web Site" -ErrorAction SilentlyContinue
        if ($defaultSite) {
            Stop-Website -Name "Default Web Site" -ErrorAction SilentlyContinue
            Write-Info "Stopped Default Web Site to free port 80"
        }
    } catch {}

    # Create the site
    try {
        New-Website -Name $siteName -PhysicalPath $siteDir `
            -HostHeader $InternalHostname -Port 80 -Force | Out-Null
        Write-Ok "IIS site '$siteName' created on port 80 (http://$InternalHostname)"
    } catch {
        Write-Fail "Failed to create IIS site: $_"
    }

    # Disable anonymous auth and enable Windows auth on the site
    try {
        Set-WebConfigurationProperty -PSPath "IIS:\Sites\$siteName" `
            -Filter "/system.webServer/security/authentication/anonymousAuthentication" `
            -Name "enabled" -Value $false
        Set-WebConfigurationProperty -PSPath "IIS:\Sites\$siteName" `
            -Filter "/system.webServer/security/authentication/windowsAuthentication" `
            -Name "enabled" -Value $true
        Write-Ok "Windows Authentication enabled (anonymous disabled)"
    } catch {
        Write-Warn "Auth config failed via PowerShell -- may need manual IIS Manager config: $_"
    }

    # Start the site
    try {
        Start-Website -Name $siteName
        Write-Ok "IIS site started"
    } catch {
        Write-Warn "Site start failed: $_"
    }

    # Add firewall rule for HTTP (80) and HTTPS (443)
    $iisRules = @(
        @{ Name = "FMD IIS HTTP (80)";  Port = 80 },
        @{ Name = "FMD IIS HTTPS (443)"; Port = 443 }
    )
    foreach ($rule in $iisRules) {
        $existing = Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue
        if ($existing) {
            Write-Ok "Firewall rule exists: $($rule.Name)"
        } else {
            New-NetFirewallRule -DisplayName $rule.Name -Direction Inbound -Protocol TCP `
                -LocalPort $rule.Port -Action Allow -Profile Domain,Private | Out-Null
            Write-Ok "Firewall rule created: $($rule.Name)"
        }
    }

    Write-Host ""
    Write-Info "IIS reverse proxy setup complete."
    Write-Info "Users on the domain can access: http://$InternalHostname"
    Write-Info ""
    Write-Info "FOR HTTPS (recommended):"
    Write-Info "  1. Import an SSL certificate into IIS (Server Certificates)"
    Write-Info "  2. Add an HTTPS binding to the FMD-Dashboard site"
    Write-Info "  3. Or install win-acme for automatic Let's Encrypt certs:"
    Write-Info "     choco install win-acme -y"
    Write-Info "     wacs --target iis --siteid (Get-Website '$siteName').Id --installation iis"
    Write-Info ""
    Write-Info "DNS: Ask your DNS team to create an A record:"
    Write-Info "  $InternalHostname -> $(hostname)"
}

# -- Phase 17: Verification ----------------------------------------------

Write-Step "PHASE 17: VERIFICATION"

Write-Host ""
$checks = @(
    @{ Label = "Git";              Test = { git --version 2>$null } },
    @{ Label = "Node.js";          Test = { node --version 2>$null } },
    @{ Label = "Python";           Test = { python --version 2>$null } },
    @{ Label = "npm";              Test = { npm --version 2>$null } },
    @{ Label = "NSSM";             Test = { nssm version 2>$null } },
    @{ Label = "Claude Code";      Test = { claude --version 2>$null } },
    @{ Label = "ODBC Driver 18";   Test = { Get-OdbcDriver -Name "ODBC Driver 18*" } },
    @{ Label = "pyodbc";           Test = { python -c "import pyodbc" 2>$null } },
    @{ Label = "polars";           Test = { python -c "import polars" 2>$null } },
    @{ Label = "azure-datalake";   Test = { python -c "import azure.storage.filedatalake" 2>$null } },
    @{ Label = "Chrome";           Test = { Test-Path "C:\Program Files\Google\Chrome\Application\chrome.exe" } },
    @{ Label = "Claude Desktop";   Test = {
        (Test-Path "C:\Users\$UserName\AppData\Local\Programs\claude-desktop\Claude.exe") -or
        (Test-Path "$env:LOCALAPPDATA\Programs\claude-desktop\Claude.exe") -or
        ($null -ne (Get-AppxPackage -Name "AnthropicPBC.claude" -ErrorAction SilentlyContinue)) -or
        ($null -ne (Get-AppxPackage -AllUsers -Name "AnthropicPBC.claude" -ErrorAction SilentlyContinue))
    } },
    @{ Label = "Nexus MCP (file)"; Test = { Test-Path (Join-Path $NexusDir "mcp\server.js") } },
    @{ Label = "Dashboard dist";   Test = { Test-Path (Join-Path $DashDir "dist\index.html") } },
    @{ Label = "Extension dist";   Test = { Test-Path (Join-Path $ClaudeMcpDir "dist-chrome\manifest.json") } },
    @{ Label = "CLAUDE.md";        Test = { Test-Path (Join-Path $ClaudeDir "CLAUDE.md") } },
    @{ Label = "settings.json";    Test = { Test-Path (Join-Path $ClaudeDir "settings.json") } },
    @{ Label = "credentials";      Test = { Test-Path (Join-Path $ClaudeDir ".credentials.json") } },
    @{ Label = ".mcp.json";        Test = { Test-Path $McpFile } },
    @{ Label = "Desktop config";   Test = { Test-Path $DesktopCfg } },
    @{ Label = "Dashboard config"; Test = { Test-Path (Join-Path $apiDir "config.json") } }
)

$passCount = 0
foreach ($check in $checks) {
    try {
        $result = & $check.Test
        if ($result) {
            Write-Ok $check.Label
            $passCount++
        } else {
            Write-Fail $check.Label
        }
    } catch {
        Write-Fail "$($check.Label): $_"
    }
}

# Service checks (give them a moment)
Start-Sleep -Seconds 3

try {
    $nexusHealth = Invoke-RestMethod -Uri "http://localhost:3777/api/health" -TimeoutSec 5
    Write-Ok "Nexus service responding (sessions: $($nexusHealth.activeSessions))"
    $passCount++
} catch {
    Write-Fail "Nexus service not responding on :3777"
}

try {
    $dashHealth = Invoke-RestMethod -Uri "http://localhost:8787/api/health" -TimeoutSec 5
    Write-Ok "Dashboard service responding"
    $passCount++
} catch {
    Write-Warn "Dashboard service not responding on :8787 (may need .env secret configured)"
}

# IIS check
if ($InternalHostname -and -not $SkipIIS) {
    $iisSite = Get-Website -Name "FMD-Dashboard" -ErrorAction SilentlyContinue
    if ($iisSite -and $iisSite.State -eq "Started") {
        Write-Ok "IIS site 'FMD-Dashboard' is running (http://$InternalHostname)"
        $passCount++
    } else {
        Write-Fail "IIS site 'FMD-Dashboard' not running"
    }
}

# -- Summary --------------------------------------------------------------

Write-Step "PROVISIONING COMPLETE"

Write-Host ""
Write-Host "  Checks passed: $passCount / $($checks.Count + 2)" -ForegroundColor $(if ($passCount -ge $checks.Count) { "Green" } else { "Yellow" })
Write-Host ""
Write-Host "  SERVICES:" -ForegroundColor White
Write-Host "    Nexus:       http://localhost:3777    (nssm status Nexus)" -ForegroundColor Gray
Write-Host "    Dashboard:   http://localhost:8787    (nssm status FMD-Dashboard)" -ForegroundColor Gray
if ($InternalHostname -and -not $SkipIIS) {
    Write-Host "    IIS Proxy:   http://$InternalHostname  (Windows Auth)" -ForegroundColor Gray
}
Write-Host ""
Write-Host "  CONFIG FILES:" -ForegroundColor White
Write-Host "    Claude Code: $McpFile" -ForegroundColor Gray
Write-Host "    Desktop:     $DesktopCfg" -ForegroundColor Gray
Write-Host "    Dashboard:   $configFile" -ForegroundColor Gray
Write-Host "    Dash .env:   $envFile" -ForegroundColor Gray
Write-Host ""
Write-Host "  CHROME EXTENSION:" -ForegroundColor White
Write-Host "    1. Open chrome://extensions/" -ForegroundColor Gray
Write-Host "    2. Enable Developer mode" -ForegroundColor Gray
Write-Host "    3. Load unpacked -> $ClaudeMcpDir\dist-chrome" -ForegroundColor Gray
Write-Host "    4. Go to claude.ai, click extension, add Nexus server:" -ForegroundColor Gray
Write-Host "       Name: nexus | Command: node" -ForegroundColor Gray
$NexusMcpPath = ($NexusDir -replace '\\', '/') + "/mcp/server.js"
Write-Host "       Args: $NexusMcpPath" -ForegroundColor Gray
Write-Host "       Env:  NEXUS_URL=http://localhost:3777" -ForegroundColor Gray
Write-Host ""
Write-Host "  NEXT STEPS:" -ForegroundColor White
if (-not $FabricClientSecret) {
    Write-Host "    [!] Edit $envFile with the real FABRIC_CLIENT_SECRET" -ForegroundColor Yellow
    Write-Host "    [!] Then: nssm restart FMD-Dashboard" -ForegroundColor Yellow
}
Write-Host "    [ ] Open Claude Desktop -- Nexus tools will be available automatically" -ForegroundColor Gray
Write-Host "    [ ] Run 'claude' in terminal -- Nexus MCP tools available" -ForegroundColor Gray
Write-Host "    [ ] Load Chrome extension and configure Nexus in claude.ai" -ForegroundColor Gray
Write-Host ""
