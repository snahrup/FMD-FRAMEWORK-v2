<#
.SYNOPSIS
    Re-exports config files from Steve's machine into the config-bundle directory.
    Run this BEFORE deploying to the remote server to ensure the bundle reflects
    the latest config state.

.DESCRIPTION
    Copies:
      - ~/.claude/CLAUDE.md, settings.json, settings.local.json, .credentials.json, .mcp.json
      - ~/.claude/commands/*.md
      - Claude Desktop config
      - Dashboard API config.json and .env

    The provisioning script (provision-remote-server.ps1) reads from config-bundle/
    and does path substitution when deploying to the target machine.
#>

$ErrorActionPreference = "Stop"

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$BundleDir  = Join-Path $ScriptDir "config-bundle"
$UserHome   = $env:USERPROFILE
$ClaudeDir  = Join-Path $UserHome ".claude"
$AppData    = $env:APPDATA
$FmdDir     = Split-Path -Parent $ScriptDir
$DashApiDir = Join-Path $FmdDir "dashboard\app\api"

function Write-Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "Refreshing config-bundle from local machine..." -ForegroundColor Cyan
Write-Host ""

# Ensure bundle directories exist
@(
    $BundleDir,
    (Join-Path $BundleDir ".claude"),
    (Join-Path $BundleDir ".claude\commands"),
    (Join-Path $BundleDir "claude-desktop")
) | ForEach-Object {
    if (-not (Test-Path $_)) {
        New-Item -ItemType Directory -Path $_ -Force | Out-Null
    }
}

# Claude Code configs
$claudeFiles = @(
    "CLAUDE.md",
    "settings.json",
    "settings.local.json",
    ".credentials.json",
    ".mcp.json"
)

foreach ($f in $claudeFiles) {
    $src = Join-Path $ClaudeDir $f
    $dst = Join-Path $BundleDir ".claude\$f"
    if (Test-Path $src) {
        Copy-Item $src $dst -Force
        Write-Ok ".claude\$f"
    } else {
        Write-Warn ".claude\$f not found at $src"
    }
}

# Commands
$commandsDir = Join-Path $ClaudeDir "commands"
if (Test-Path $commandsDir) {
    Get-ChildItem "$commandsDir\*.md" | ForEach-Object {
        Copy-Item $_.FullName (Join-Path $BundleDir ".claude\commands\$($_.Name)") -Force
        Write-Ok ".claude\commands\$($_.Name)"
    }
}

# Claude Desktop config
$desktopCfg = Join-Path $AppData "Claude\claude_desktop_config.json"
if (Test-Path $desktopCfg) {
    Copy-Item $desktopCfg (Join-Path $BundleDir "claude-desktop\claude_desktop_config.json") -Force
    Write-Ok "claude-desktop\claude_desktop_config.json"
} else {
    Write-Warn "Claude Desktop config not found"
}

# Dashboard API config
$dashConfig = Join-Path $DashApiDir "config.json"
if (Test-Path $dashConfig) {
    Copy-Item $dashConfig (Join-Path $BundleDir "dashboard-config.json") -Force
    Write-Ok "dashboard-config.json"
}

$dashEnv = Join-Path $DashApiDir ".env"
if (Test-Path $dashEnv) {
    Copy-Item $dashEnv (Join-Path $BundleDir "dashboard-.env") -Force
    Write-Ok "dashboard-.env"
}

Write-Host ""
Write-Host "Config bundle refreshed at: $BundleDir" -ForegroundColor Green
Write-Host "Files:" -ForegroundColor Gray
Get-ChildItem $BundleDir -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($BundleDir.Length + 1)
    Write-Host "  $rel" -ForegroundColor Gray
}
Write-Host ""
