Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "E:\Codes\Stremio"
WshShell.Run """C:\Program Files\nodejs\node.exe"" server.js", 0, False
