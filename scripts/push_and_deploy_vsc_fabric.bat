@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "PROJECT_ROOT=%%~fI"

set "REMOTE_HOST=sasnahrup@172.29.97.125"
set "REMOTE_ROOT=C:\Projects\FMD_FRAMEWORK"
set "REMOTE_BRANCH=main"
set "REMOTE_SERVICE=FMD-Dashboard"

for /f %%I in ('powershell -NoProfile -Command "(Get-Date).ToString('yyyyMMdd-HHmmss')"') do set "STAMP=%%I"

echo.
echo =======================================================
echo   FMD Push ^& Deploy - VSC-Fabric
echo =======================================================
echo.
echo Local project:  %PROJECT_ROOT%
echo Remote host:    %REMOTE_HOST%
echo Remote project: %REMOTE_ROOT%
echo Remote branch:  %REMOTE_BRANCH%
echo.

pushd "%PROJECT_ROOT%" >nul
if errorlevel 1 goto :fail_popd

echo [1/4] Switching local repo to %REMOTE_BRANCH%...
git checkout %REMOTE_BRANCH%
if errorlevel 1 goto :fail

echo.
echo [2/4] Rebasing local %REMOTE_BRANCH% onto origin/%REMOTE_BRANCH%...
git fetch origin %REMOTE_BRANCH%
if errorlevel 1 goto :fail
git pull --rebase origin %REMOTE_BRANCH%
if errorlevel 1 goto :fail

echo.
echo [3/5] Pushing local %REMOTE_BRANCH% to GitHub...
git push origin %REMOTE_BRANCH%
if errorlevel 1 goto :fail

echo.
echo [4/5] Deploying on %REMOTE_HOST%...
ssh %REMOTE_HOST% powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "Set-Location '%REMOTE_ROOT%';" ^
  "$dirty = git status --porcelain;" ^
  "if ($dirty) { Write-Host 'Remote repo is dirty. Creating safety stash...' -ForegroundColor Yellow; git stash push -u -m 'pre-deploy %STAMP%' | Out-Host };" ^
  "git checkout %REMOTE_BRANCH% | Out-Host;" ^
  "& '.\scripts\bootstrap_vsc_fabric_runtime.ps1' -ProjectRoot '%REMOTE_ROOT%' -Branch '%REMOTE_BRANCH%' -RemoteName 'origin';" ^
  "if (Get-Command nssm -ErrorAction SilentlyContinue) { Write-Host ''; Write-Host 'Service status:' -ForegroundColor Cyan; nssm status %REMOTE_SERVICE% | Out-Host };" ^
  "Write-Host ''; Write-Host 'Remote HEAD:' -ForegroundColor Cyan; git rev-parse --short HEAD | Out-Host;"
if errorlevel 1 goto :fail

echo.
echo [5/5] Deployment complete.
echo Dashboard: http://vsc-fabric/
echo.
popd >nul
exit /b 0

:fail
echo.
echo Deployment failed. Review the output above.
popd >nul
exit /b 1

:fail_popd
echo.
echo Could not enter project root: %PROJECT_ROOT%
exit /b 1
