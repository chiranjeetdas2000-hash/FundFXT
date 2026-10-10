@echo off
REM TID MT5 Sync Worker — 1-click launcher
REM Double-click this file to start the sync worker

cd /d "%~dp0"

echo ================================
echo  TID MT5 Sync Worker
echo ================================
echo.

REM Check .env exists
if not exist ".env" (
    echo ERROR: .env file not found.
    echo Copy .env.example to .env and fill in real values.
    pause
    exit /b 1
)

REM Check Python
where python >nul 2>nul
if errorlevel 1 (
    echo ERROR: Python not found in PATH.
    echo Install Python 3.8+ and add to PATH.
    pause
    exit /b 1
)

echo Starting sync worker...
echo Logs will be written to sync.log
echo Press Ctrl+C to stop.
echo.

REM Run the worker, append output to log file
python mt5_sync.py

echo.
echo Sync worker stopped.
pause
