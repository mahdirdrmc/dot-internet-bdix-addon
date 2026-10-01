@echo off
title DFLIX Stremio ^& Nuvio Addon Server
echo ============================================================
echo   Starting DFLIX BDIX Addon for Stremio and Nuvio...
echo ============================================================
echo.

node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

start "" http://localhost:7000
node server.js
pause
