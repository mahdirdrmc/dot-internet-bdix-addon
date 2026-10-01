@echo off
title Dot Internet BDIX Scraper Sync
echo ============================================================
echo   Running Dot Internet BDIX Scraper Sync (DFlix + CircleFTP)
echo ============================================================
echo.
cd /d "E:\Codes\Stremio"
node scraper/sync_master.js
echo.
pause
