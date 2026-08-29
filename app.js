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

// Auto-detect default tab based on screen width / device
function initDefaultTab() {
  const isMobile = window.innerWidth <= 768 || /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  switchTab(isMobile ? 'android' : 'windows');
}

initDefaultTab();

