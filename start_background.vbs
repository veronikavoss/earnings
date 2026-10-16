' =======================================================
' Earnings Viewer - 백그라운드 무음 실행기 (Windows)
' 검은색 콘솔 창 없이 백그라운드에서 완전히 조용히 서버를 구동하고 브라우저를 엽니다.
' =======================================================
Option Explicit
Dim WshShell, FSO, ScriptDir

Set FSO = CreateObject("Scripting.FileSystemObject")
ScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
Set WshShell = CreateObject("WScript.Shell")

' cmd /c 를 경유하여 환경변수 PATH를 온전히 상속받고 무음(0, False)으로 실행
WshShell.Run "cmd /c cd /d """ & ScriptDir & """ && node server.js", 0, False

' 1초 대기 후 브라우저 열기
WScript.Sleep 1000
WshShell.Run "cmd /c start http://localhost:8000", 0, False
