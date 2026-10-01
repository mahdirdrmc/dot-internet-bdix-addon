@echo off
title High-Speed BDIX Deep Archive Scraper
echo ============================================================
echo   Running High-Speed Deep Archive Scraper (Batch of 30 pages)
echo   Uses parallel workers to crawl thousands of titles
echo ============================================================
echo.
cd /d "E:\Codes\Stremio"
node scraper/scrape_deep_archive.js 30
echo.
echo Changes saved to local cache!
pause
