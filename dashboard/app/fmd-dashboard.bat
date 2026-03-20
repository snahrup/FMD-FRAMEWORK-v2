@echo off
:: FMD Dashboard Launcher — immediately hands off to VBScript (truly invisible)
if not "%1"=="hidden" (
    start /min "" cmd /c "%~f0" hidden
    exit
)
cscript //nologo "%~dp0fmd-dashboard.vbs"
exit
