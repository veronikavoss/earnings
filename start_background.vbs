' =======================================================
' Earnings Viewer - 백그라운드 무음 실행기 (Windows)
' 검은색 콘솔 창 없이 백그라운드에서 조용히 서버를 구동하고 브라우저를 엽니다.
' =======================================================
Option Explicit
Dim WshShell, FSO, ScriptDir
Set FSO = CreateObject("Scripting.FileSystemObject")
ScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = ScriptDir

' 1. 이미 8000 포트가 열려있는지 확인 후, 열려있지 않을 때만 node server.js 무음 구동
WshShell.Run "powershell -NoProfile -WindowStyle Hidden -Command ""if (-not (Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue)) { Start-Process -WorkingDirectory '" & ScriptDir & "' -WindowStyle Hidden node -ArgumentList 'server.js' }""", 0, True

' 2. 잠시 대기 후 브라우저 열기
WScript.Sleep 600
WshShell.Run "cmd /c start http://localhost:8000", 0, False
