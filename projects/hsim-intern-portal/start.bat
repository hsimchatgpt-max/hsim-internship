@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org , install it, then double-click start.bat again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies - first time only, please wait...
  call npm install
  if errorlevel 1 ( echo npm install failed. & pause & exit /b 1 )
)
call npx tsx scripts/local.ts
pause
