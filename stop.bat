@echo off
title Stop DFLIX Addon Server
echo Stopping DFLIX Addon Server...
powershell -Command "$conns = Get-NetTCPConnection -LocalPort 7000 -ErrorAction SilentlyContinue; if ($conns) { foreach ($c in $conns) { if ($c.OwningProcess -ne 0) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue } } Write-Host '[OK] DFLIX server stopped.' } else { Write-Host 'Server was not running.' }"
pause
