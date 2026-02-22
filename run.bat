@echo off
title Image Describer
cd /d "%~dp0"

echo.
echo  ======================================
echo    Image Describer Launcher
echo  ======================================
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

:: Kill any existing process on port 5000
echo [*] Ensuring port 5000 is free...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5000 " ^| findstr "LISTENING"') do (
    echo [!] Found existing process on port 5000 ^(PID: %%a^), terminating...
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo [*] Starting Image Describer...
echo     Open http://localhost:5000 in your browser
echo     Press Ctrl+C to stop
echo.

python app.py

deactivate
pause
