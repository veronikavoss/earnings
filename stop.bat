@echo off
chcp 65001 > nul
echo =======================================================
echo   Earnings Viewer - 서버 종료 (8000번 포트)
echo =======================================================
echo.
powershell -Command "$conns = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue; if ($conns) { $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($pidVal in $pids) { Stop-Process -Id $pidVal -Force -ErrorAction SilentlyContinue; Write-Host ('[성공] PID ' + $pidVal + ' 서버 프로세스를 종료했습니다.') } } else { Write-Host '[안내] 현재 실행 중인 8000 포트 서버가 없습니다.' }"
echo.
echo 처리가 완료되었습니다. 아무 키나 누르면 창이 닫힙니다.
pause > nul
