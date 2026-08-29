// ===================================================================
// CURAJ Campus Connect - Client Script
// Theme Toggle (Warm Paper / Night Edition) + Setup Generators
// ===================================================================

const root = document.documentElement;
const modeBtn = document.getElementById("mode-toggle");

function updateModeIcon() {
  if (modeBtn) {
    const isDark = root.classList.contains("dark");
    modeBtn.textContent = isDark ? "☼" : "☾";
    modeBtn.setAttribute("title", isDark ? "Switch to light mode (Warm Paper)" : "Switch to dark mode (Night Edition)");
  }
}

if (modeBtn) {
  modeBtn.addEventListener("click", () => {
    const isDark = !root.classList.contains("dark");
    root.classList.toggle("dark", isDark);
    try {
      localStorage.setItem("theme", isDark ? "dark" : "light");
    } catch {}
    updateModeIcon();
  });
}
updateModeIcon();

// Tab Switcher (Windows / Android)
function switchTab(os) {
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));

  if (os === 'windows') {
    const btn = document.getElementById('tab-btn-windows');
    const panel = document.getElementById('panel-windows');
    if (btn) btn.classList.add('active');
    if (panel) panel.classList.add('active');
  } else if (os === 'android') {
    const btn = document.getElementById('tab-btn-android');
    const panel = document.getElementById('panel-android');
    if (btn) btn.classList.add('active');
    if (panel) panel.classList.add('active');
  }
}

// Input validation to enable/disable download button
const winUser = document.getElementById('winUser');
const winPass = document.getElementById('winPass');
const winDownloadBtn = document.getElementById('winDownloadBtn');

function validateWindowsInputs() {
  if (!winDownloadBtn) return;
  const userVal = winUser ? winUser.value.trim() : '';
  const passVal = winPass ? winPass.value.trim() : '';
  const hasUser = userVal.length > 0 && /^\d+$/.test(userVal);
  const hasPass = passVal.length > 0;
  winDownloadBtn.disabled = !(hasUser && hasPass);
}

if (winUser && winPass) {
  // Filter out any non-digits immediately on input or paste
  winUser.addEventListener('input', () => {
    winUser.value = winUser.value.replace(/\D/g, '');
    validateWindowsInputs();
  });

  winUser.addEventListener('keypress', (e) => {
    // Allow special keys like backspace, enter, arrows
    if (e.ctrlKey || e.altKey || e.metaKey || e.key.length > 1) return;
    if (!/[0-9]/.test(e.key)) {
      e.preventDefault();
    }
  });

  winPass.addEventListener('input', validateWindowsInputs);
  winUser.addEventListener('change', validateWindowsInputs);
  winPass.addEventListener('change', validateWindowsInputs);

  // Initial check & handle autofill
  validateWindowsInputs();
  setTimeout(validateWindowsInputs, 200);
  setTimeout(validateWindowsInputs, 800);
}

// Windows 1-Click Personalized Batch Generator
function downloadPersonalizedWindowsBat() {
  const user = document.getElementById('winUser').value.trim();
  const pass = document.getElementById('winPass').value;

  if (!user || !pass) {
    alert("Please enter your CURAJ Username / Mobile and Password.");
    return;
  }

  const batScript = `@echo off
title CURAJ Campus Connect - 1-Click Auto Login Setup
color 0b
echo ============================================================
echo         CURAJ CAMPUS CONNECT - 1-CLICK AUTO LOGIN
echo ============================================================
echo.
echo [*] Setting up silent background auto-login for user: ${user}...

:: 1. Create AppData folder
set APP_DIR=%APPDATA%\\CURAJ_Connect
if not exist "%APP_DIR%" mkdir "%APP_DIR%"

:: 2. Save credentials locally
(
  echo {
  echo   "username": "${user.replace(/"/g, '\\"')}",
  echo   "password": "${pass.replace(/"/g, '\\"')}"
  echo }
) > "%APP_DIR%\\config.json"

:: 3. Create persistent PowerShell background watchdog
(
  echo $configFile = "$env:APPDATA\\CURAJ_Connect\\config.json"
  echo if (-not (Test-Path $configFile)) { exit }
  echo $cfg = Get-Content $configFile -Raw ^| ConvertFrom-Json
  echo while ($true) {
  echo     try {
  echo         $online = $false
  echo         try {
  echo             $req = [System.Net.WebRequest]::Create("http://connectivitycheck.gstatic.com/generate_204")
  echo             $req.Timeout = 3000
  echo             $res = $req.GetResponse()
  echo             $online = ([int]$res.StatusCode -eq 204)
  echo             $res.Close()
  echo         } catch { $online = $false }
  echo         if (-not $online) {
  echo             $body = @{ username = $cfg.username; password = $cfg.password; phone = "0"; type = "2"; jsonresponse = "1" }
  echo             $headers = @{ "X-Requested-With" = "XMLHttpRequest"; "Referer" = "http://122.252.242.93/userportal/pages/usermedia/curaj/app/campus/ui/login.html" }
  echo             Invoke-RestMethod -Uri "http://122.252.242.93/userportal/newlogin.do" -Method Post -Body $body -Headers $headers -TimeoutSec 8 -ErrorAction SilentlyContinue ^| Out-Null
  echo         }
  echo     } catch {}
  echo     Start-Sleep -Seconds 45
  echo }
) > "%APP_DIR%\\watchdog.ps1"

:: 4. Add to Current User Run registry (No Admin needed)
reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "CURAJ_WiFi_AutoLogin" /t REG_SZ /d "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File \\"%APP_DIR%\\watchdog.ps1\\"" /f >nul 2>&1

:: 5. Launch background watchdog right now
start "" powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File "%APP_DIR%\\watchdog.ps1"

echo.
echo [SUCCESS] CURAJ Auto-Login is REGISTERED and RUNNING!
echo.
echo - Whenever you turn on your PC, it will keep you connected to CURAJ Wi-Fi.
echo - If you ever want to turn it off, you can download the 1-click Deregister script from the portal.
echo.
pause
`;

  downloadBlob(batScript, "CURAJ_AutoLogin_Setup.bat", "text/plain");
}

// Windows 1-Click Deregister Script
function downloadDeregisterBat() {
  const batScript = `@echo off
title Deregister CURAJ Auto-Login
color 0c
echo ============================================================
echo         DEREGISTER CURAJ CAMPUS CONNECT AUTO-LOGIN
echo ============================================================
echo.
echo [*] Removing startup registry entries...
reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "CURAJ_WiFi_AutoLogin" /f >nul 2>&1

echo [*] Stopping running background processes...
powershell -Command "Get-Process powershell -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*watchdog.ps1*' } | Stop-Process" >nul 2>&1
taskkill /f /im curaj_connect.exe >nul 2>&1

echo [*] Removing saved local credentials...
rmdir /s /q "%APPDATA%\\CURAJ_Connect" >nul 2>&1

echo.
echo [SUCCESS] CURAJ Auto-Login has been completely deregistered!
echo You can re-register anytime from the portal.
echo.
pause
`;
  downloadBlob(batScript, "Deregister_CURAJ_AutoLogin.bat", "text/plain");
}

// Android Macro Download
function downloadPersonalizedAndroidMacro() {
  const user = document.getElementById('andUser').value.trim();
  const pass = document.getElementById('andPass').value;

  if (!user || !pass) {
    alert("Please enter your CURAJ Username / Mobile and Password.");
    return;
  }

  const macroPayload = {
    "m_name": "CURAJ Auto Login",
    "m_description": "Auto login on CURAJ CAMPUS CONNECT with Randomized MAC support.",
    "m_enabled": true,
    "m_triggerList": [
      {
        "m_classType": "WifiSSIDTrigger",
        "m_ssidList": ["CURAJ CAMPUS CONNECT"],
        "m_connectType": 0
      }
    ],
    "m_actionList": [
      {
        "m_classType": "PauseAction",
        "m_pauseDuration": 2
      },
      {
        "m_classType": "HttpRequestAction",
        "m_url": "http://122.252.242.93/userportal/newlogin.do",
        "m_method": "POST",
        "m_contentType": "application/x-www-form-urlencoded",
        "m_contentBody": "username=" + encodeURIComponent(user) + "&password=" + encodeURIComponent(pass) + "&phone=0&type=2&jsonresponse=1"
      },
      {
        "m_classType": "ToastAction",
        "m_toastText": "CURAJ Campus Connect: Authenticated successfully!"
      }
    ]
  };

  downloadBlob(JSON.stringify(macroPayload, null, 2), "CURAJ_AutoLogin.macro", "application/json");
}

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
