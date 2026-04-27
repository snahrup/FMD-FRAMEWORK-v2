@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "PROJECT_ROOT=%%~fI"

set "REMOTE_HOST=sasnahrup@172.29.97.125"
set "REMOTE_ROOT=C:\Projects\FMD_FRAMEWORK"
set "REMOTE_BRANCH=main"
set "REMOTE_SERVICE=FMD-Dashboard"
set "REMOTE_PS1=%TEMP%\fmd-vsc-fabric-deploy-%RANDOM%.ps1"

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
echo [4/5] Preparing remote deployment payload...
> "%REMOTE_PS1%" echo $ErrorActionPreference = 'Stop'
>> "%REMOTE_PS1%" echo Set-Location '%REMOTE_ROOT%'
>> "%REMOTE_PS1%" echo $dirty = git status --porcelain
>> "%REMOTE_PS1%" echo if ^($dirty^) { Write-Host 'Remote repo is dirty. Creating safety stash...' -ForegroundColor Yellow; git stash push -u -m 'pre-deploy %STAMP%' ^| Out-Host }
>> "%REMOTE_PS1%" echo git checkout %REMOTE_BRANCH% ^| Out-Host
>> "%REMOTE_PS1%" echo ^& '.\scripts\bootstrap_vsc_fabric_runtime.ps1' -ProjectRoot '%REMOTE_ROOT%' -Branch '%REMOTE_BRANCH%' -RemoteName 'origin'
>> "%REMOTE_PS1%" echo if ^(Get-Command nssm -ErrorAction SilentlyContinue^) { Write-Host ''; Write-Host 'Service status:' -ForegroundColor Cyan; nssm status %REMOTE_SERVICE% ^| Out-Host }
>> "%REMOTE_PS1%" echo Write-Host ''
>> "%REMOTE_PS1%" echo Write-Host 'Remote HEAD:' -ForegroundColor Cyan
>> "%REMOTE_PS1%" echo git rev-parse --short HEAD ^| Out-Host

echo.
echo [5/6] Deploying on %REMOTE_HOST%...
for /f %%I in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$bytes = [System.Text.Encoding]::Unicode.GetBytes((Get-Content -Raw ''%REMOTE_PS1%'')); [Convert]::ToBase64String($bytes)"') do set "REMOTE_ENCODED=%%I"
del "%REMOTE_PS1%" >nul 2>nul
ssh %REMOTE_HOST% powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand %REMOTE_ENCODED%
if errorlevel 1 goto :fail

echo.
echo [6/6] Deployment complete.
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
