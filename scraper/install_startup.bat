@echo off
title Install Background Scraper on Windows Startup
echo ============================================================
echo   Installing Dot Internet Scraper to Windows Startup...
echo ============================================================
echo.

set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "TARGET_VBS=E:\Codes\Stremio\scraper\run_background.vbs"
set "SHORTCUT_PATH=%STARTUP_DIR%\DotInternet-BDIX-Sync.lnk"

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = '%TARGET_VBS%'; $s.WorkingDirectory = 'E:\Codes\Stremio'; $s.Save()"

if exist "%SHORTCUT_PATH%" (
    echo [SUCCESS] Auto-updater installed successfully!
    echo Whenever your PC boots, it will automatically and silently:
    echo  1. Crawl new releases on DFlix and CircleFTP
    echo  2. Update the cloud database for your Stremio Addon
    echo No command prompt window will interrupt you.
) else (
    echo [ERROR] Could not create startup shortcut.
)

echo.
pause
