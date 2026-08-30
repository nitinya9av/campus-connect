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

// Tab Switcher (Windows / Android / macOS)
function switchTab(os) {
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));

  const btn = document.getElementById(`tab-btn-${os}`);
  const panel = document.getElementById(`panel-${os}`);
  if (btn) btn.classList.add('active');
  if (panel) panel.classList.add('active');
}

// Auto-detect default tab based on user operating system
function initDefaultTab() {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) {
    switchTab('android');
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    switchTab('macos');
  } else {
    switchTab('windows');
  }
}

initDefaultTab();

