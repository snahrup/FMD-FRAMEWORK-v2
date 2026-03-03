$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$mainScript = Join-Path $scriptDir "teardown-claude-tools.ps1"

Set-Location $scriptDir
& $mainScript
