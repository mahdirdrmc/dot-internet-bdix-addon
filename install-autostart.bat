@echo off
title Install DFLIX Addon Auto-Start
echo ============================================================
echo   Setting up DFLIX Addon to start automatically in background
echo ============================================================
echo.

set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "TARGET_VBS=E:\Codes\Stremio\start-hidden.vbs"
set "SHORTCUT_PATH=%STARTUP_DIR%\DFLIX-Stremio-Addon.lnk"

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = '%TARGET_VBS%'; $s.WorkingDirectory = 'E:\Codes\Stremio'; $s.Save()"

if exist "%SHORTCUT_PATH%" (
    echo [SUCCESS] Auto-start configured successfully!
    echo The DFLIX addon will now run silently in the background whenever your PC starts.
    echo No command prompt window will appear.
) else (
    echo [ERROR] Failed to create startup shortcut.
)

echo.
pause
