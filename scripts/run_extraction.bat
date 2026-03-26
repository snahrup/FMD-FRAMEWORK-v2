@echo off
title FMD Turbo Extract — vsc-fabric
color 0A
echo.
echo  ========================================================
echo   FMD Turbo Extract — vsc-fabric LAN Extraction
echo  ========================================================
echo.

cd /d C:\Projects\FMD_FRAMEWORK

echo  [1] Pulling latest code...
git pull origin main
echo.

echo  [2] Starting extraction (pyodbc, 16 workers, skip existing)...
echo      Output: C:\Projects\FMD_FRAMEWORK\parquet_out
echo      Ctrl+C to stop. Re-run to resume where you left off.
echo.

python scripts/turbo_extract.py --method pyodbc --workers 16 --skip-existing

echo.
echo  ========================================================
echo   EXTRACTION COMPLETE
echo  ========================================================
echo.
pause
