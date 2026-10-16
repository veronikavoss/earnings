@echo off
chcp 65001 > nul
cd /d "%~dp0"
title Earnings Viewer - SEC EDGAR Server
echo =======================================================
echo   Earnings Viewer - 기업 실적 검색기 (SEC EDGAR)
echo =======================================================
echo.

powershell -Command "if (Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %ERRORLEVEL% EQU 0 (
    echo [안내] 8000번 포트 서버가 이미 실행 중입니다. 브라우저를 엽니다...
    start http://localhost:8000
    goto end
)

echo [1/2] 초고속 SEC EDGAR 로컬 서버를 구동합니다...
echo [2/2] 웹 브라우저(http://localhost:8000)를 엽니다...
echo.
echo 💡 팁: 이 검은색 창을 닫으면 서버가 종료됩니다.
echo 💡 검은색 창 없이 백그라운드로 계속 켜두고 싶으시면 'start_background.vbs'를 실행하세요.
echo.
start http://localhost:8000
node server.js

:end
pause
