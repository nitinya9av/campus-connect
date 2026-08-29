# CURAJ Campus Connect for Windows

Native Windows client (15 KB) with zero external dependencies.

---

## Features
- **Zero Admin Rights**: Runs entirely in user-space using `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.
- **1-Click Register**: Saves credentials in `%APPDATA%\CURAJ_Connect\config.json` and launches background keep-alive loop.
- **1-Click Deregister**: Completely cleans up startup registry, stops background processes, and deletes local credentials.
- **Offline/Campus Auto-Detection**: Pings Google's 204 connectivity check every 40s; if disconnected, detects the CURAJ gateway and logs in silently.
- **Open Source**: 100% auditable C# code in `campus-connect.cs`.

---

## How to Compile from Source

No Visual Studio or heavy SDK required! Windows includes the Microsoft C# compiler (`csc.exe`) by default.

Run in PowerShell:
```powershell
& "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /target:winexe /win32manifest:app.manifest /out:curaj_connect.exe campus-connect.cs
```

---

## Command Line Usage

| Command | Action |
| :--- | :--- |
| `curaj_connect.exe` | Launches the graphical user interface (GUI). |
| `curaj_connect.exe --register <user> <pass>` | Registers auto-start and saves credentials. |
| `curaj_connect.exe --unregister` | Stops background monitor and removes auto-start. |
| `curaj_connect.exe --login` | Tests immediate login. |
| `curaj_connect.exe --watch` | Silent background loop (used by auto-start). |
