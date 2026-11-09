@echo off
title ORBIT
cd /d "%~dp0"
rem ORBIT runs at http://localhost:4173 - always use this address: your data is stored per address, in this browser.
set "NODE_ENV="

rem Already running? Just open it.
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:4173/ | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
  echo ORBIT is already running - opening it.
  start "" "http://localhost:4173/"
  timeout /t 2 >nul
  exit /b 0
)

if not exist "node_modules\.bin\vite.cmd" (
  echo Installing dependencies - first run only, takes a minute...
  call npm install --include=dev --no-fund --no-audit
  if errorlevel 1 goto error
)

if not exist "dist\index.html" (
  echo Building ORBIT...
  call npm run build
  if errorlevel 1 goto error
)

echo.
echo ORBIT is running at http://localhost:4173
echo Keep this window open while you use ORBIT. Close it to stop.
echo.
call "node_modules\.bin\vite.cmd" preview --port 4173 --strictPort --open
if errorlevel 1 goto error
exit /b 0

:error
echo.
echo Something went wrong - see the messages above.
pause
exit /b 1
