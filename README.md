# CURAJ Campus Connect • 1-Click Wi-Fi Auto-Login

Automated login and watchdog tool for the Central University of Rajasthan (CURAJ) Wi-Fi captive portal (`http://122.252.242.93/.../login.html`).

Designed for **simplicity, privacy, and full transparency**. Requires zero administrator privileges, fully reversible in one click, and 100% open source.

---

## 🌐 Web Portal (`index.html`)

The root portal is built with a minimalist, warm editorial aesthetic featuring:
- **Light Mode ("Warm Paper")** & **Dark Mode ("Night Edition")** with a persistent `☼` / `☾` theme toggle.

### Features
1. **Windows (PC / Laptop)**:
   - **Native 1-Click Portable App (`campus-connect.exe`)**: 15 KB standalone native Windows executable with dark GUI. Enter credentials once and click Register.
   - **Zero Administrator Rights**: Runs in standard user space, creates startup entry in `HKCU\...\Run`, and stores settings locally in `%APPDATA%\CURAJ_Connect`.
   - **1-Click Deregistration**: Open the app anytime and click Deregister to clean up all background entries.
2. **Android (Phone / Tablet)**:
   - **Dedicated Lightweight App (Coming Soon)**: Under construction. Simply install and enter credentials once to connect forever; uninstalling immediately deregisters.
3. **Privacy & Security**:
   - **100% Client-Side**: No backend, no telemetry. Passwords are saved strictly on your local PC.
   - **Direct Gateway**: All requests go directly to the campus portal (`122.252.242.93`).

---

## Repository Structure

```
curaj-wifi/
├── index.html            <- Web portal at root (works directly on GitHub Pages)
├── style.css             <- Minimalist warm editorial styles (Light & Dark theme)
├── app.js                <- Theme toggle & client-side file generators
├── windows/
│   ├── README.md         <- Windows build & command-line usage guide
│   ├── campus-connect.cs <- 100% auditable C# source code
│   └── app.manifest      <- Per-Monitor V2 High-DPI manifest
├── android/
│   ├── README.md         <- MacroDroid setup guide (Randomized MAC)
│   ├── CURAJ_AutoLogin.macro <- Universal macro template
│   ├── macrodroid_quick_copy.txt <- Copy-paste credentials snippet
│   └── test_login_android.sh <- Lightweight test script
├── .gitignore            <- Protects local private credentials
└── README.md
```

---

## Standalone Windows App (`campus-connect.exe`)

Downloadable directly from [GitHub Releases](https://github.com/nitinya9av/campus-connect/releases/latest):
- **GUI Mode**: Double-click to open a clean dialog to enter credentials, click `Register Auto-Login`, or `Deregister`.
- **CLI Flags**:
  ```powershell
  campus-connect.exe --register <username> <password>
  campus-connect.exe --unregister
  campus-connect.exe --login
  campus-connect.exe --watch
  ```
- **Compile from Source**: Can be recompiled anytime using Windows' built-in C# compiler (`csc.exe`):
  ```powershell
  & "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /target:winexe /win32manifest:windows\app.manifest /out:campus-connect.exe campus-connect.cs
  ```

---

## Android App (In Development)

A dedicated, lightweight Android client is currently under construction.
- **Zero Configuration**: No third-party automation tools needed.
- **1-Click Setup**: Install the app and enter your campus credentials once.
- **Easy Deregistration**: Simply uninstall the app anytime to remove it completely.

---

## Security & Transparency

- **Zero Data Collection**: This project does not have a backend server or telemetry. Everything executes locally in the browser or on your device.
- **Local Storage Only**: On Windows, credentials live strictly in `%APPDATA%\CURAJ_Connect\config.json` to authenticate with the university gateway.
- **Direct Connection**: All HTTP requests are sent directly to the official CURAJ captive portal (`122.252.242.93`).

---

## Acknowledgements

Free code signing provided by the [SignPath Foundation](https://signpath.org).

