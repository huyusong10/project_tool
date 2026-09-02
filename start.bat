@echo off
cd /d "%~dp0"
if not exist ".env" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0configure.ps1"
  if errorlevel 1 exit /b 1
)
if not exist "node_modules" (
  call npm install
  if errorlevel 1 exit /b 1
)
if not exist "dist-server\index.js" (
  call npm run build
  if errorlevel 1 exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-server.ps1"
