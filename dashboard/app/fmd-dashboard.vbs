Set ws = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

appDir = "C:\Users\snahrup\CascadeProjects\FMD_FRAMEWORK\dashboard\app"
logDir = appDir & "\logs"
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)

' ── Kill any existing server on 8787 ──
ws.Run "cmd /c for /f ""tokens=5"" %p in ('netstat -aon ^| findstr "":8787 "" ^| findstr ""LISTENING""') do taskkill /PID %p /F >nul 2>&1", 0, True
WScript.Sleep 1000

' ── Build frontend ──
ws.Run "cmd /c ""cd /d " & appDir & " && npx vite build > """ & logDir & "\vite-build.log"" 2>&1""", 0, True

' ── Start API server (serves built frontend on port 8787) ──
ws.Run "cmd /c ""cd /d " & appDir & " && python api/server.py > """ & logDir & "\api-server.log"" 2>&1""", 0, False

' ── Wait for server to be ready (up to 15 seconds) ──
apiReady = False
For i = 1 To 15
    WScript.Sleep 1000
    On Error Resume Next
    Set http = CreateObject("MSXML2.XMLHTTP")
    http.Open "GET", "http://127.0.0.1:8787/api/health", False
    http.Send
    If Err.Number = 0 And http.Status = 200 Then
        apiReady = True
        Exit For
    End If
    Set http = Nothing
    On Error GoTo 0
Next

If Not apiReady Then
    MsgBox "FMD API server failed to start after 15 seconds." & vbCrLf & vbCrLf & _
           "Check log: " & logDir & "\api-server.log", vbExclamation, "FMD Dashboard"
    WScript.Quit 1
End If

' ── Open browser ──
ws.Run "cmd /c start http://localhost:8787", 0, False
