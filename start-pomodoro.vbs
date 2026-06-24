Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

' Get the directory where this script is located
scriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)

' Run npm start silently (0 = hidden window, False = don't wait)
WshShell.Run "cmd /c ""cd /d " & scriptDir & " && npm start""", 0, False
