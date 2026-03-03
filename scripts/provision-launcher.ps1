$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$mainScript = Join-Path $scriptDir "provision-remote-server.ps1"
$secret = $env:FABRIC_CLIENT_SECRET
$ghToken = $env:GITHUB_TOKEN

if (-not $secret) { Write-Host "ERROR: Set FABRIC_CLIENT_SECRET env var first" -ForegroundColor Red; exit 1 }
if (-not $ghToken) { Write-Host "ERROR: Set GITHUB_TOKEN env var first" -ForegroundColor Red; exit 1 }

Set-Location $scriptDir
& $mainScript -FabricClientSecret $secret -GitHubToken $ghToken -InternalHostname "VSC-Fabric"
