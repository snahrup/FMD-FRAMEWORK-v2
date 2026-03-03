<#
.SYNOPSIS
    Removes Claude tools and Nexus from a provisioned FMD server.
    Leaves the FMD Dashboard and all its dependencies intact.

.DESCRIPTION
    This is the inverse of provision-remote-server.ps1, minus the dashboard.

    REMOVES:
    - Claude Code CLI (npm global)
    - Claude Desktop (MSIX / EXE)
    - Nexus service + repo
    - claude-mcp Chrome extension repo
    - .claude/ config directory (settings, credentials, MCP config, commands)
    - Claude Desktop config (~\AppData\Roaming\Claude\)
    - Nexus firewall rule

    KEEPS:
    - FMD Dashboard (service, repo, config, firewall rule)
    - Git, Node.js, Python, NSSM, npm (dashboard dependencies)
    - ODBC Driver 18, pyodbc
    - Google Chrome
    - Chocolatey

.PARAMETER ProjectDir
    Root directory for projects. Default: C:\Projects

.PARAMETER SkipClaudeDesktop
    Skip Claude Desktop removal (e.g., if you want to keep it)

.PARAMETER DryRun
    Show what would be removed without actually removing anything

.EXAMPLE
    .\teardown-claude-tools.ps1
    .\teardown-claude-tools.ps1 -DryRun
    .\teardown-claude-tools.ps1 -ProjectDir "D:\Projects"
#>

param(
    [string]$ProjectDir = "C:\Projects",
    [switch]$SkipClaudeDesktop,
    [switch]$DryRun
)

$ErrorActionPreference = "Continue"

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

function Remove-SafeItem($path, $label) {
    if (Test-Path $path -ErrorAction SilentlyContinue) {
        if ($DryRun) {
            Write-Info "[DRY RUN] Would remove: $path"
        } else {
            try {
                Remove-Item -Path $path -Recurse -Force -ErrorAction Stop
                Write-Ok "Removed: $label"
            } catch {
                Write-Warn "Failed to remove $label : $_"
            }
        }
    } else {
        Write-Info "Not found (already clean): $label"
    }
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
$ClaudeMcpDir = Join-Path $ProjectDir "claude-mcp"
$DesktopCfgDir = Join-Path $AppData "Claude"

if ($DryRun) {
    Write-Warn "DRY RUN MODE -- nothing will actually be removed"
}

Write-Info "User:        $UserName"
Write-Info "Home:        $UserHome"
Write-Info "Project dir: $ProjectDir"
Write-Host ""

# -- Step 1: Stop and remove Nexus service --------------------------------

Write-Step "STEP 1: Nexus Service"

$nexusSvc = Get-Service -Name "Nexus" -ErrorAction SilentlyContinue
if ($nexusSvc) {
    if ($DryRun) {
        Write-Info "[DRY RUN] Would stop and remove Nexus service"
    } else {
        Write-Info "Stopping Nexus service..."
        nssm stop "Nexus" 2>$null
        Start-Sleep -Seconds 2
        Write-Info "Removing Nexus service..."
        nssm remove "Nexus" confirm 2>$null
        Write-Ok "Nexus service removed"
    }
} else {
    Write-Info "Nexus service not found (already clean)"
}

# -- Step 2: Remove Nexus directory ---------------------------------------

Write-Step "STEP 2: Nexus Repository"

Remove-SafeItem $NexusDir "Nexus repo ($NexusDir)"

# -- Step 3: Remove claude-mcp Chrome extension ---------------------------

Write-Step "STEP 3: claude-mcp Chrome Extension"

Remove-SafeItem $ClaudeMcpDir "claude-mcp extension ($ClaudeMcpDir)"

# -- Step 4: Uninstall Claude Code CLI ------------------------------------

Write-Step "STEP 4: Claude Code CLI"

$claudeCmd = Get-Command claude -ErrorAction SilentlyContinue
if ($claudeCmd) {
    if ($DryRun) {
        Write-Info "[DRY RUN] Would run: npm uninstall -g @anthropic-ai/claude-code"
    } else {
        Write-Info "Uninstalling Claude Code..."
        npm uninstall -g @anthropic-ai/claude-code 2>$null
        Write-Ok "Claude Code uninstalled"
    }
} else {
    Write-Info "Claude Code not found (already clean)"
}

# -- Step 5: Remove Claude Desktop ----------------------------------------

Write-Step "STEP 5: Claude Desktop"

if ($SkipClaudeDesktop) {
    Write-Warn "Skipped (flag)"
} else {
    $removed = $false

    # Check MSIX first
    $msixPkg = Get-AppxPackage -Name "AnthropicPBC.claude" -ErrorAction SilentlyContinue
    if (-not $msixPkg) {
        $msixPkg = Get-AppxPackage -AllUsers -Name "AnthropicPBC.claude" -ErrorAction SilentlyContinue
    }

    if ($msixPkg) {
        if ($DryRun) {
            Write-Info "[DRY RUN] Would remove MSIX: $($msixPkg.PackageFullName)"
        } else {
            Write-Info "Removing MSIX package: $($msixPkg.PackageFullName)"
            try {
                Remove-AppxPackage -Package $msixPkg.PackageFullName -ErrorAction Stop
                Write-Ok "Claude Desktop MSIX removed"
                $removed = $true
            } catch {
                Write-Warn "Remove-AppxPackage failed: $_"
                # Try AllUsers variant
                try {
                    Remove-AppxPackage -Package $msixPkg.PackageFullName -AllUsers -ErrorAction Stop
                    Write-Ok "Claude Desktop MSIX removed (all users)"
                    $removed = $true
                } catch {
                    Write-Warn "AllUsers removal also failed: $_"
                }
            }
        }
    }

    # Check for EXE-based install
    $claudeExePaths = @(
        "$env:LOCALAPPDATA\Programs\claude-desktop",
        "C:\Users\$UserName\AppData\Local\Programs\claude-desktop",
        "C:\Users\$UserName\AppData\Local\AnthropicClaude"
    )
    foreach ($p in $claudeExePaths) {
        if (Test-Path $p -ErrorAction SilentlyContinue) {
            # Check for uninstaller
            $uninstaller = Join-Path $p "unins000.exe"
            if (Test-Path $uninstaller) {
                if ($DryRun) {
                    Write-Info "[DRY RUN] Would run uninstaller: $uninstaller"
                } else {
                    Write-Info "Running uninstaller..."
                    try {
                        Start-Process -FilePath $uninstaller -ArgumentList "/SILENT" -Wait -NoNewWindow
                        Write-Ok "Claude Desktop uninstalled via uninstaller"
                        $removed = $true
                    } catch {
                        Write-Warn "Uninstaller failed: $_"
                    }
                }
            }
            # Remove directory if it still exists
            Remove-SafeItem $p "Claude Desktop install dir ($p)"
            $removed = $true
        }
    }

    if (-not $removed -and -not $DryRun) {
        Write-Info "Claude Desktop not found (already clean)"
    }
}

# -- Step 6: Remove .claude/ config directory -----------------------------

Write-Step "STEP 6: Claude Config Directory ($ClaudeDir)"

if (Test-Path $ClaudeDir -ErrorAction SilentlyContinue) {
    # List what's in there before removing
    Write-Info "Contents:"
    Get-ChildItem $ClaudeDir -Force -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Info "  $($_.Name)"
    }
    Remove-SafeItem $ClaudeDir ".claude/ config directory"
} else {
    Write-Info ".claude/ not found (already clean)"
}

# -- Step 7: Remove Claude Desktop config ---------------------------------

Write-Step "STEP 7: Claude Desktop Config ($DesktopCfgDir)"

Remove-SafeItem $DesktopCfgDir "Claude Desktop config dir"

# -- Step 8: Remove Nexus firewall rule -----------------------------------

Write-Step "STEP 8: Nexus Firewall Rule"

$nexusRule = Get-NetFirewallRule -DisplayName "Nexus Bridge (3777)" -ErrorAction SilentlyContinue
if ($nexusRule) {
    if ($DryRun) {
        Write-Info "[DRY RUN] Would remove firewall rule: Nexus Bridge (3777)"
    } else {
        Remove-NetFirewallRule -DisplayName "Nexus Bridge (3777)" -ErrorAction SilentlyContinue
        Write-Ok "Nexus firewall rule removed"
    }
} else {
    Write-Info "Nexus firewall rule not found (already clean)"
}

# -- Step 9: Scrub Claude traces from FMD Dashboard repo ------------------

Write-Step "STEP 9: Scrub Claude Traces from Dashboard"

$FmdDir = Join-Path $ProjectDir "FMD_FRAMEWORK"
$scrubTargets = @(
    # .claude directory in the repo (project-level configs)
    @{ Path = (Join-Path $FmdDir ".claude");           Label = "FMD .claude/ project config" },
    # Claude avatar icon
    @{ Path = (Join-Path $FmdDir "dashboard\app\public\icons\claude_profile.jpg"); Label = "Claude avatar icon" },
    # CLAUDE.md in repo root
    @{ Path = (Join-Path $FmdDir "CLAUDE.md");         Label = "CLAUDE.md" }
)

foreach ($target in $scrubTargets) {
    Remove-SafeItem $target.Path $target.Label
}

# Rebuild dashboard frontend to remove any compiled-in Claude references
$DashDir = Join-Path $FmdDir "dashboard\app"
if (Test-Path (Join-Path $DashDir "package.json")) {
    if ($DryRun) {
        Write-Info "[DRY RUN] Would rebuild dashboard frontend"
    } else {
        Write-Info "Rebuilding dashboard frontend (removes compiled traces)..."
        Push-Location $DashDir
        npm run build 2>$null
        Pop-Location
        if (Test-Path (Join-Path $DashDir "dist\index.html")) {
            Write-Ok "Dashboard rebuilt clean"
        } else {
            Write-Warn "Dashboard rebuild may have failed -- check manually"
        }
    }
}

# Restart dashboard service to pick up changes
if (-not $DryRun) {
    $dashSvc = Get-Service -Name "FMD-Dashboard" -ErrorAction SilentlyContinue
    if ($dashSvc) {
        Write-Info "Restarting FMD-Dashboard service..."
        nssm restart "FMD-Dashboard" 2>$null
        Write-Ok "Dashboard service restarted"
    }
}

# -- Verification ---------------------------------------------------------

Write-Step "VERIFICATION"

Write-Host ""

$cleanChecks = @(
    @{ Label = "Claude Code CLI";       Test = { -not (Get-Command claude -ErrorAction SilentlyContinue) } },
    @{ Label = "Nexus service";         Test = { -not (Get-Service -Name "Nexus" -ErrorAction SilentlyContinue) } },
    @{ Label = "Nexus directory";       Test = { -not (Test-Path $NexusDir) } },
    @{ Label = "claude-mcp directory";  Test = { -not (Test-Path $ClaudeMcpDir) } },
    @{ Label = ".claude/ directory";    Test = { -not (Test-Path $ClaudeDir) } },
    @{ Label = "Desktop config dir";    Test = { -not (Test-Path $DesktopCfgDir) } },
    @{ Label = "Nexus firewall rule";   Test = { -not (Get-NetFirewallRule -DisplayName "Nexus Bridge (3777)" -ErrorAction SilentlyContinue) } },
    @{ Label = "Claude avatar icon";   Test = { -not (Test-Path (Join-Path $ProjectDir "FMD_FRAMEWORK\dashboard\app\public\icons\claude_profile.jpg")) } },
    @{ Label = "Repo .claude/ dir";    Test = { -not (Test-Path (Join-Path $ProjectDir "FMD_FRAMEWORK\.claude")) } },
    @{ Label = "CLAUDE.md in repo";    Test = { -not (Test-Path (Join-Path $ProjectDir "FMD_FRAMEWORK\CLAUDE.md")) } }
)

$preserveChecks = @(
    @{ Label = "FMD Dashboard service"; Test = { Get-Service -Name "FMD-Dashboard" -ErrorAction SilentlyContinue } },
    @{ Label = "FMD Dashboard dir";     Test = { Test-Path (Join-Path $ProjectDir "FMD_FRAMEWORK") } },
    @{ Label = "Dashboard firewall";    Test = { Get-NetFirewallRule -DisplayName "FMD Dashboard (8787)" -ErrorAction SilentlyContinue } },
    @{ Label = "Node.js";              Test = { Get-Command node -ErrorAction SilentlyContinue } },
    @{ Label = "Python";               Test = { Get-Command python -ErrorAction SilentlyContinue } },
    @{ Label = "NSSM";                 Test = { Get-Command nssm -ErrorAction SilentlyContinue } }
)

Write-Host "  REMOVED (should all be green):" -ForegroundColor White
foreach ($check in $cleanChecks) {
    try {
        if (& $check.Test) {
            Write-Ok "$($check.Label) -- gone"
        } else {
            if ($DryRun) {
                Write-Warn "$($check.Label) -- still present (dry run)"
            } else {
                Write-Fail "$($check.Label) -- still present!"
            }
        }
    } catch {
        Write-Fail "$($check.Label) -- error: $_"
    }
}

Write-Host ""
Write-Host "  PRESERVED (should all be green):" -ForegroundColor White
foreach ($check in $preserveChecks) {
    try {
        if (& $check.Test) {
            Write-Ok "$($check.Label) -- intact"
        } else {
            Write-Fail "$($check.Label) -- MISSING!"
        }
    } catch {
        Write-Fail "$($check.Label) -- error: $_"
    }
}

# -- Summary --------------------------------------------------------------

Write-Step "TEARDOWN COMPLETE"

Write-Host ""
if ($DryRun) {
    Write-Warn "This was a DRY RUN -- nothing was actually removed."
    Write-Warn "Run again without -DryRun to execute."
} else {
    Write-Host "  Claude tools removed. FMD Dashboard is untouched." -ForegroundColor Green
    Write-Host ""
    Write-Host "  Dashboard: http://localhost:8787  (nssm status FMD-Dashboard)" -ForegroundColor Gray
}
Write-Host ""
Write-Host "Press any key to close..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
