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
    } catch { }
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

// Modal helpers
function showThankYouModal() {
  const modal = document.getElementById('thankYouModal');
  if (modal) modal.classList.add('open');
}

function closeThankYouModal() {
  const modal = document.getElementById('thankYouModal');
  if (modal) modal.classList.remove('open');
}

function closeSuccessModal() {
  const modal = document.getElementById('successModal');
  if (modal) modal.classList.remove('open');
}

function closeDeregisterModal() {
  const modal = document.getElementById('deregisterModal');
  if (modal) modal.classList.remove('open');
}

// Check URL params when redirected from setup script
function checkUrlStatus() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const status = urlParams.get('status');
    if (status === 'success') {
      const modal = document.getElementById('successModal');
      if (modal) modal.classList.add('open');
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (status === 'deregistered') {
      const modal = document.getElementById('deregisterModal');
      if (modal) modal.classList.add('open');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  } catch (err) { }
}
checkUrlStatus();

// Windows 1-Click Personalized Batch Generator
function downloadPersonalizedWindowsBat() {
  const user = document.getElementById('winUser').value.trim();
  const pass = document.getElementById('winPass').value;

  if (!user || !pass) {
    alert("Please enter your CURAJ Username / Mobile and Password.");
    return;
  }

  const portalUrl = window.location.href.split('?')[0].split('#')[0];
  let redirectCmd = '';
  if (portalUrl.startsWith('http://') || portalUrl.startsWith('https://')) {
    redirectCmd = `start "" "${portalUrl}?status=success"`;
  } else {
    redirectCmd = `start "" "http://127.0.0.1:8080/index.html?status=success" 2>nul || start "" "https://nitinya9av.github.io/campus-connect/?status=success"`;
  }

  const watchdogScript = `# CURAJ Campus Connect Background Watchdog
$configFile = "$env:APPDATA\\CURAJ_Connect\\config.json"
if (-not (Test-Path $configFile)) { exit }
$cfg = Get-Content $configFile -Raw | ConvertFrom-Json

# Immediate login / session verification on startup
try {
    $body = @{ username = $cfg.username; password = $cfg.password; phone = "0"; type = "2"; jsonresponse = "1" }
    $headers = @{ "X-Requested-With" = "XMLHttpRequest"; "Referer" = "http://122.252.242.93/userportal/pages/usermedia/curaj/app/campus/ui/login.html" }
    Invoke-RestMethod -Uri "http://122.252.242.93/userportal/newlogin.do" -Method Post -Body $body -Headers $headers -TimeoutSec 6 -ErrorAction SilentlyContinue | Out-Null
} catch {}

# Continuous background monitoring loop
while ($true) {
    Start-Sleep -Seconds 45
    try {
        $online = $false
        try {
            $req = [System.Net.WebRequest]::Create("http://connectivitycheck.gstatic.com/generate_204")
            $req.Timeout = 3000
            $res = $req.GetResponse()
            $online = ([int]$res.StatusCode -eq 204)
            $res.Close()
        } catch { $online = $false }
        if (-not $online) {
            $body = @{ username = $cfg.username; password = $cfg.password; phone = "0"; type = "2"; jsonresponse = "1" }
            $headers = @{ "X-Requested-With" = "XMLHttpRequest"; "Referer" = "http://122.252.242.93/userportal/pages/usermedia/curaj/app/campus/ui/login.html" }
            Invoke-RestMethod -Uri "http://122.252.242.93/userportal/newlogin.do" -Method Post -Body $body -Headers $headers -TimeoutSec 8 -ErrorAction SilentlyContinue | Out-Null
        }
    } catch {}
}
`;

  const configJson = JSON.stringify({ username: user, password: pass }, null, 2);
  const configB64 = btoa(unescape(encodeURIComponent(configJson)));
  const watchdogB64 = btoa(unescape(encodeURIComponent(watchdogScript)));

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
powershell -Command "[IO.File]::WriteAllBytes(\\"$env:APPDATA\\CURAJ_Connect\\config.json\\", [Convert]::FromBase64String('${configB64}'))"

:: 3. Create persistent PowerShell background watchdog with immediate login
powershell -Command "[IO.File]::WriteAllBytes(\\"$env:APPDATA\\CURAJ_Connect\\watchdog.ps1\\", [Convert]::FromBase64String('${watchdogB64}'))"

:: 4. Create silent VBScript background launcher (prevents PowerShell console popup)
echo CreateObject("WScript.Shell").Run "powershell.exe -WindowStyle Hidden -File ""%APP_DIR%\watchdog.ps1""", 0, False > "%APP_DIR%\\silent_runner.vbs"

:: 5. Add to Current User Run registry
reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "CURAJ_WiFi_AutoLogin" /t REG_SZ /d "wscript.exe \\"%APP_DIR%\\silent_runner.vbs\\"" /f >nul 2>&1

:: 6. Launch background watchdog silently (zero window popup)
start "" wscript.exe "%APP_DIR%\\silent_runner.vbs"

echo.
echo ============================================================
echo [SUCCESS] CURAJ Campus Connect Auto-Login is Active!
echo ============================================================
echo.
echo - Config saved to: %APP_DIR%\\config.json
echo - Startup watchdog registered successfully.
echo - Immediate session check initiated.
echo - Opening confirmation in browser...
echo.

:: 7. Launch browser redirect to portal with thank you / success feedback
${redirectCmd}

ping 127.0.0.1 -n 3 >nul
exit
`;

  downloadBlob(batScript, "CURAJ_AutoLogin_Setup.bat", "text/plain");
  showThankYouModal();
}

// Windows 1-Click Deregister Script
function downloadDeregisterBat() {
  const portalUrl = window.location.href.split('?')[0].split('#')[0];
  let redirectDeregisterCmd = '';
  if (portalUrl.startsWith('http://') || portalUrl.startsWith('https://')) {
    redirectDeregisterCmd = `start "" "${portalUrl}?status=deregistered"`;
  } else {
    redirectDeregisterCmd = `start "" "http://127.0.0.1:8080/index.html?status=deregistered" 2>nul || start "" "https://nitinya9av.github.io/campus-connect/?status=deregistered"`;
  }

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
echo Redirecting back to portal...
echo.

:: Launch browser redirect to portal with deregister feedback
${redirectDeregisterCmd}

ping 127.0.0.1 -n 3 >nul
exit
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
