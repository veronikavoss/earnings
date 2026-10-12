@echo off
chcp 65001 > nul
echo =======================================================
echo   Earnings Viewer - 기업 실적 검색기 (SEC EDGAR)
echo =======================================================
echo.
echo 서버를 시작하고 브라우저를 엽니다...
echo.
start http://localhost:8000
node server.js
pause
