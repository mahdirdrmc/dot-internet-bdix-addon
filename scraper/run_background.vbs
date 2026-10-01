Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "E:\Codes\Stremio"
WshShell.Run """C:\Program Files\nodejs\node.exe"" scraper/sync_master.js", 0, False
