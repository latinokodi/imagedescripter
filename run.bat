@echo off
title Image Describer
cd /d "%~dp0"

echo.
echo  ╔══════════════════════════════════════╗
echo  ║        Image Describer Launcher      ║
echo  ╚══════════════════════════════════════╝
echo.

:: Check Python
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found. Please install Python 3.10+ and add to PATH.
    pause
    exit /b 1
)

:: Create venv if needed
if not exist "venv" (
    echo [*] Creating virtual environment...
    python -m venv venv
    echo [OK] Virtual environment created.
)

:: Activate venv
call venv\Scripts\activate.bat

:: Install / upgrade deps
echo [*] Checking dependencies...
pip install -r requirements.txt --quiet --disable-pip-version-check
echo [OK] Dependencies ready.

echo.
echo [*] Starting Image Describer...
echo     Open http://localhost:5000 in your browser
echo     Press Ctrl+C to stop
echo.

python app.py

deactivate
pause
