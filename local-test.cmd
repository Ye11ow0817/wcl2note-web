@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.11 or newer.
  pause
  exit /b 1
)
node scripts/local-test.mjs %1
set "result=%errorlevel%"
if not "%result%"=="0" pause
exit /b %result%
