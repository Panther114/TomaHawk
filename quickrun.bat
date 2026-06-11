@echo off
setlocal

set "PORT=4173"
set "URL=http://127.0.0.1:%PORT%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$port = %PORT%; Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"

start "TomaHawk Server" cmd /k "cd /d ""%~dp0"" && npm start"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$url = '%URL%'; for ($i = 0; $i -lt 60; $i++) { try { Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 1 | Out-Null; Start-Process $url; exit 0 } catch { Start-Sleep -Seconds 1 } }; Start-Process $url"

endlocal
