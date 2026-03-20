@echo off
title FMD Framework Guide
cd /d "%~dp0"

echo ========================================
echo   FMD Framework Guide
echo   http://localhost:5174
echo ========================================
echo.

if not exist node_modules (
    echo Installing dependencies...
    call npm install
    echo.
)

echo Starting dev server...
call npm run dev
