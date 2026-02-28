@echo off
setlocal enabledelayedexpansion
title Image Describer (Modern Stack)

echo ===============================================
echo Starting Vision Agent Setup...
echo ===============================================

:: Check for Node
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH! Required for React UI.
    pause
    exit /b 1
)

:: Check for Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python is not installed or not in PATH!
    pause
    exit /b 1
)

:: Create virtual environment if it doesn't exist
if not exist "venv\Scripts\activate.bat" (
    echo [*] Creating Python virtual environment...
    python -m venv venv
)

:: Activate venv
call venv\Scripts\activate.bat

:: Install / upgrade deps
echo [*] Checking Python dependencies...
python -m pip install -r requirements.txt --quiet --disable-pip-version-check

echo [*] Compiling React + Tailwind Frontend...
cd frontend
call npm install --silent
call npm run build
cd ..

:: Kill any existing process on port 5000
echo [*] Ensuring port 5000 is free...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5000 " ^| findstr "LISTENING"') do (
    echo [!] Found existing process on port 5000 ^(PID: %%a^), terminating...
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo [*] Starting Image Describer...
echo     Open http://127.0.0.1:5000 in your browser
echo     Make sure LM Studio is running on port 1234
echo.
python -m uvicorn main:app --host 127.0.0.1 --port 5000 --log-level warning

pause
