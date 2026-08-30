using System;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Text;
using System.Threading;
using System.Diagnostics;
using System.Windows.Forms;
using System.Drawing;
using Microsoft.Win32;

namespace CurajConnect
{
    static class Program
    {
        const string REG_NAME = "CURAJ_WiFi_AutoLogin";
        const string PORTAL_IP = "122.252.242.93";
        const string NAS_IP = "1.254.254.254";
        const string CHECK_URL = "http://connectivitycheck.gstatic.com/generate_204";

        public static string GetConfigDir()
        {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string dir = Path.Combine(appData, "CURAJ_Connect");
            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
            return dir;
        }

        public static string GetConfigFile()
        {
            return Path.Combine(GetConfigDir(), "config.json");
        }

        public static void SaveCredentials(string user, string pass)
        {
            string json = "{\n  \"username\": \"" + user.Replace("\"", "\\\"") + "\",\n  \"password\": \"" + pass.Replace("\"", "\\\"") + "\"\n}";
            File.WriteAllText(GetConfigFile(), json);
        }

        public static void DeleteCredentials()
        {
            try
            {
                string path = GetConfigFile();
                if (File.Exists(path))
                {
                    File.Delete(path);
                }
            }
            catch { }
        }

        public static bool LoadCredentials(out string user, out string pass)
        {
            user = ""; pass = "";
            string path = GetConfigFile();
            if (!File.Exists(path)) return false;
            try
            {
                string text = File.ReadAllText(path);
                int uIdx = text.IndexOf("\"username\":");
                int pIdx = text.IndexOf("\"password\":");
                if (uIdx != -1 && pIdx != -1)
                {
                    user = ExtractValue(text, uIdx);
                    pass = ExtractValue(text, pIdx);
                    return !string.IsNullOrEmpty(user) && !string.IsNullOrEmpty(pass);
                }
            }
            catch { }
            return false;
        }

        static string ExtractValue(string text, int keyIdx)
        {
            int colon = text.IndexOf(':', keyIdx);
            int quote1 = text.IndexOf('"', colon + 1);
            int quote2 = text.IndexOf('"', quote1 + 1);
            if (quote1 != -1 && quote2 != -1)
            {
                return text.Substring(quote1 + 1, quote2 - quote1 - 1);
            }
            return "";
        }

        public static bool IsOnline()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(CHECK_URL);
                req.Timeout = 3500;
                req.Method = "GET";
                req.AllowAutoRedirect = false; // CRITICAL: Stop following captive portal 302 redirects
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    // 204 No Content with no redirect verifies active Internet routing
                    return res.StatusCode == HttpStatusCode.NoContent;
                }
            }
            catch
            {
                return false;
            }
        }

        public static bool IsPortalReachable()
        {
            // Fast LAN probe to Inventum NAS controller (1.254.254.254)
            try
            {
                HttpWebRequest reqNas = (HttpWebRequest)WebRequest.Create("http://" + NAS_IP + "/");
                reqNas.Timeout = 1200;
                reqNas.Method = "GET";
                using (HttpWebResponse resNas = (HttpWebResponse)reqNas.GetResponse())
                {
                    return resNas.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                try
                {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://" + PORTAL_IP + "/userportal/pages/usermedia/curaj/app/campus/ui/login.html");
                    req.Timeout = 1500;
                    req.Method = "GET";
                    using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                    {
                        return res.StatusCode == HttpStatusCode.OK;
                    }
                }
                catch { return false; }
            }
        }

        public static string PerformLogin(string user, string pass)
        {
            try
            {
                CookieContainer cookies = new CookieContainer();

                // Step 1: Prime session challenge with Inventum NAS controller
                try
                {
                    HttpWebRequest initReq = (HttpWebRequest)WebRequest.Create("http://" + NAS_IP + "/");
                    initReq.Timeout = 1500;
                    initReq.Method = "GET";
                    initReq.CookieContainer = cookies;
                    using (HttpWebResponse initRes = (HttpWebResponse)initReq.GetResponse())
                    using (StreamReader sr = new StreamReader(initRes.GetResponseStream()))
                    {
                        string html = sr.ReadToEnd();
                        int idx = html.IndexOf("URL=http://");
                        if (idx != -1)
                        {
                            int endIdx = html.IndexOf('"', idx + 4);
                            if (endIdx != -1)
                            {
                                string portalUrl = html.Substring(idx + 4, endIdx - idx - 4);
                                HttpWebRequest portalReq = (HttpWebRequest)WebRequest.Create(portalUrl);
                                portalReq.Timeout = 1500;
                                portalReq.CookieContainer = cookies;
                                using (HttpWebResponse portalRes = (HttpWebResponse)portalReq.GetResponse()) { }
                            }
                        }
                    }
                }
                catch { }

                // Step 2: Post credentials to userportal endpoint
                string postData = "username=" + Uri.EscapeDataString(user) +
                                  "&password=" + Uri.EscapeDataString(pass) +
                                  "&phone=0&type=2&jsonresponse=1";
                byte[] data = Encoding.UTF8.GetBytes(postData);

                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://" + PORTAL_IP + "/userportal/newlogin.do");
                req.Method = "POST";
                req.ContentType = "application/x-www-form-urlencoded; charset=UTF-8";
                req.ContentLength = data.Length;
                req.Timeout = 3000;
                req.CookieContainer = cookies;
                req.Headers.Add("X-Requested-With", "XMLHttpRequest");
                req.Referer = "http://" + PORTAL_IP + "/userportal/pages/usermedia/curaj/app/campus/ui/login.html";

                using (Stream stream = req.GetRequestStream())
                {
                    stream.Write(data, 0, data.Length);
                }

                string response = "";
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                using (StreamReader reader = new StreamReader(res.GetResponseStream()))
                {
                    response = reader.ReadToEnd();
                }

                // Step 3: Trigger NAS controller handshake if redirect_to_nas
                if (response.Contains("redirect_to_nas"))
                {
                    try
                    {
                        HttpWebRequest nasReq = (HttpWebRequest)WebRequest.Create("http://" + NAS_IP + "/");
                        nasReq.Timeout = 1500;
                        nasReq.CookieContainer = cookies;
                        using (HttpWebResponse nasRes = (HttpWebResponse)nasReq.GetResponse()) { }
                    }
                    catch { }
                }

                // Instant verification on known success indicators
                if (response.Contains("redirect_to_nas") || response.Contains("success_net") || response.Contains("\"errorKey\":\"success\""))
                {
                    return "SUCCESS";
                }

                if (IsOnline())
                {
                    return "SUCCESS";
                }

                // Error diagnostics
                if (response.Contains("Session already running"))
                {
                    if (IsOnline()) return "SUCCESS";
                    return "Session already active on another port. Re-authenticating...";
                }
                if (response.Contains("Invalid") || response.Contains("Incorrect") || response.Contains("fail"))
                {
                    return "Invalid Mobile Number or Password.";
                }

                return "Gateway responded (" + response.Trim() + "). Verifying connection...";
            }
            catch (Exception ex)
            {
                return "ERROR: " + ex.Message;
            }
        }

        public static bool RegisterAutoStart(string exePath)
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                {
                    if (key != null)
                    {
                        key.SetValue(REG_NAME, "\"" + exePath + "\" --watch");
                        return true;
                    }
                }
            }
            catch { }
            return false;
        }

        public static bool UnregisterAutoStart()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                {
                    if (key != null)
                    {
                        key.DeleteValue(REG_NAME, false);
                    }
                }

                // Kill any running watch instance
                KillBackgroundWatch();

                // Delete local saved credentials
                DeleteCredentials();
                return true;
            }
            catch { }
            return false;
        }

        public static bool IsAutoStartRegistered()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", false))
                {
                    if (key != null)
                    {
                        return key.GetValue(REG_NAME) != null;
                    }
                }
            }
            catch { }
            return false;
        }

        public static void StartBackgroundWatch(string exePath)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(exePath, "--watch");
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                Process.Start(psi);
            }
            catch { }
        }

        public static void KillBackgroundWatch()
        {
            try
            {
                Process current = Process.GetCurrentProcess();
                string[] procNames = new string[] { "campus-connect", "curaj_connect" };
                foreach (string name in procNames)
                {
                    foreach (Process p in Process.GetProcessesByName(name))
                    {
                        if (p.Id != current.Id)
                        {
                            try { p.Kill(); } catch { }
                        }
                    }
                }
            }
            catch { }
        }

        static void RunWatch()
        {
            string user, pass;
            if (!LoadCredentials(out user, out pass)) return;

            AutoResetEvent wakeEvent = new AutoResetEvent(false);

            // Instant event trigger: fires the exact millisecond Wi-Fi connects or IP changes
            NetworkChange.NetworkAddressChanged += (s, e) => { try { wakeEvent.Set(); } catch { } };
            NetworkChange.NetworkAvailabilityChanged += (s, e) => { try { wakeEvent.Set(); } catch { } };

            while (true)
            {
                try
                {
                    if (IsPortalReachable())
                    {
                        PerformLogin(user, pass);
                    }
                }
                catch { }

                // Sleep up to 8s, or wake up instantly (0ms) when network changes
                wakeEvent.WaitOne(8000);
            }
        }

        [STAThread]
        static void Main(string[] args)
        {
            if (args.Length > 0)
            {
                string cmd = args[0].ToLower();
                if (cmd == "--watch" || cmd == "-w")
                {
                    RunWatch();
                    return;
                }
                else if (cmd == "--login" || cmd == "-l")
                {
                    string u, p;
                    if (LoadCredentials(out u, out p))
                    {
                        string res = PerformLogin(u, p);
                        Console.WriteLine("Login result: " + res);
                    }
                    else
                    {
                        Console.WriteLine("No credentials found.");
                    }
                    return;
                }
                else if (cmd == "--register" && args.Length >= 3)
                {
                    SaveCredentials(args[1], args[2]);
                    bool ok = RegisterAutoStart(Application.ExecutablePath);
                    Console.WriteLine(ok ? "Registered successfully." : "Failed to register.");
                    return;
                }
                else if (cmd == "--unregister")
                {
                    bool ok = UnregisterAutoStart();
                    Console.WriteLine(ok ? "Unregistered successfully." : "Failed or not found.");
                    return;
                }
            }

            // 1. Enable Native Per-Monitor High DPI Awareness (fixes scaling blurriness)
            try
            {
                SetProcessDpiAwareness(2); // Process_Per_Monitor_DPI_Aware
            }
            catch
            {
                try { SetProcessDPIAware(); } catch { }
            }

            // 2. Launch GUI with native visual styles and ClearType
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }

        [System.Runtime.InteropServices.DllImport("shcore.dll")]
        static extern int SetProcessDpiAwareness(int awareness);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        static extern bool SetProcessDPIAware();

        [System.Runtime.InteropServices.DllImport("dwmapi.dll")]
        public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);
    }

    public class MainForm : Form
    {
        TextBox txtUser;
        TextBox txtPass;
        Button btnRegister;
        Button btnDeregister;
        Button btnTestLogin;
        Label lblStatus;
        Label lblPill;
        Label lblSub;
        System.Windows.Forms.Timer pollTimer;
        bool isAuthenticating = false;

        // Theme Palette matching portal (alokranjan.me Night Edition)
        static readonly Color ColBg = Color.FromArgb(18, 17, 16);          // #121110
        static readonly Color ColSurface = Color.FromArgb(26, 25, 23);     // #1a1917
        static readonly Color ColInputBg = Color.FromArgb(20, 19, 18);     // #141312
        static readonly Color ColBorder = Color.FromArgb(46, 44, 40);      // #2e2c28
        static readonly Color ColText = Color.FromArgb(234, 230, 223);     // #eae6df
        static readonly Color ColMuted = Color.FromArgb(142, 138, 130);    // #8e8a82
        static readonly Color ColAccent = Color.FromArgb(217, 83, 47);     // #d9532f (Terracotta)
        static readonly Color ColGreen = Color.FromArgb(52, 211, 153);     // #34d399
        static readonly Color ColGreenBg = Color.FromArgb(22, 45, 34);
        static readonly Color ColRed = Color.FromArgb(248, 113, 113);

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            try
            {
                int darkMode = 1;
                // Enable immersive dark mode on Windows 11 (attr 20) & Windows 10 (attr 19)
                if (Program.DwmSetWindowAttribute(this.Handle, 20, ref darkMode, sizeof(int)) != 0)
                {
                    Program.DwmSetWindowAttribute(this.Handle, 19, ref darkMode, sizeof(int));
                }
            }
            catch { }
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            if (pollTimer != null)
            {
                pollTimer.Stop();
                pollTimer.Dispose();
                pollTimer = null;
            }
            base.OnFormClosed(e);
        }

        public MainForm()
        {
            this.Text = "Campus Connect • CURAJ";
            this.AutoScaleMode = AutoScaleMode.None;
            this.ClientSize = new Size(540, 670);
            this.FormBorderStyle = FormBorderStyle.FixedSingle;
            this.MaximizeBox = false;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = ColBg;
            this.ForeColor = ColText;
            this.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);

            // --- Top Navigation / Running Head ---
            Panel pnlHeader = new Panel();
            pnlHeader.Location = new Point(0, 0);
            pnlHeader.Size = new Size(540, 94);
            pnlHeader.BackColor = ColSurface;
            this.Controls.Add(pnlHeader);

            Label lblBrand = new Label();
            lblBrand.Text = "campus.connect";
            lblBrand.Font = new Font("Segoe UI", 13f, FontStyle.Bold);
            lblBrand.ForeColor = ColText;
            lblBrand.Location = new Point(50, 20);
            lblBrand.AutoSize = true;
            pnlHeader.Controls.Add(lblBrand);

            lblSub = new Label();
            lblSub.Text = "Central University of Rajasthan • Auto-Start: Checking...";
            lblSub.Font = new Font("Segoe UI", 9f, FontStyle.Regular);
            lblSub.ForeColor = ColMuted;
            lblSub.AutoSize = true;
            lblSub.Location = new Point(52, lblBrand.Bottom + 4);
            pnlHeader.Controls.Add(lblSub);

            // Adjust header height dynamically with generous padding
            pnlHeader.Height = Math.Max(94, lblSub.Bottom + 18);

            // Status Pill Badge in top right
            lblPill = new Label();
            lblPill.Text = "○ CHECKING";
            lblPill.Font = new Font("Segoe UI", 8f, FontStyle.Bold);
            lblPill.ForeColor = ColMuted;
            lblPill.BackColor = Color.FromArgb(35, 33, 30);
            lblPill.Location = new Point(390, 26);
            lblPill.Size = new Size(118, 28);
            lblPill.TextAlign = ContentAlignment.MiddleCenter;
            pnlHeader.Controls.Add(lblPill);

            pnlHeader.Paint += (s, e) => {
                e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                e.Graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
                int lineY = pnlHeader.Height - 1;
                e.Graphics.DrawLine(new Pen(ColBorder, 1), 0, lineY, pnlHeader.Width, lineY);
                // Terracotta dot vertically aligned with brand text
                using (Brush b = new SolidBrush(ColAccent))
                {
                    int dotY = lblBrand.Top + (lblBrand.Height / 2) - 5;
                    e.Graphics.FillEllipse(b, 28, dotY, 10, 10);
                }
            };

            // --- Section 01: Credentials ---
            Label lblSec1 = new Label();
            lblSec1.Text = "01 • CREDENTIALS";
            lblSec1.Font = new Font("Segoe UI", 8f, FontStyle.Bold);
            lblSec1.ForeColor = ColAccent;
            lblSec1.Location = new Point(36, pnlHeader.Bottom + 24);
            lblSec1.AutoSize = true;
            this.Controls.Add(lblSec1);

            Panel pnlCard1 = new Panel();
            pnlCard1.Location = new Point(36, lblSec1.Bottom + 8);
            pnlCard1.Size = new Size(468, 192);
            pnlCard1.BackColor = ColSurface;
            pnlCard1.Paint += (s, e) => {
                e.Graphics.DrawRectangle(new Pen(ColBorder, 1), 0, 0, pnlCard1.Width - 1, pnlCard1.Height - 1);
            };
            this.Controls.Add(pnlCard1);

            // User field
            Label lblUser = new Label();
            lblUser.Text = "MOBILE NUMBER (10 DIGITS)";
            lblUser.Font = new Font("Segoe UI", 7.5f, FontStyle.Bold);
            lblUser.ForeColor = ColMuted;
            lblUser.Location = new Point(20, 16);
            lblUser.AutoSize = true;
            pnlCard1.Controls.Add(lblUser);

            txtUser = new TextBox();
            txtUser.Location = new Point(20, 36);
            txtUser.Size = new Size(428, 28);
            txtUser.Font = new Font("Segoe UI", 10.5f);
            txtUser.BackColor = ColInputBg;
            txtUser.ForeColor = ColText;
            txtUser.BorderStyle = BorderStyle.FixedSingle;
            txtUser.MaxLength = 10;
            txtUser.KeyPress += (s, e) => {
                if (!char.IsControl(e.KeyChar) && !char.IsDigit(e.KeyChar)) e.Handled = true;
            };
            pnlCard1.Controls.Add(txtUser);

            // Pass field
            Label lblPass = new Label();
            lblPass.Text = "WI-FI PASSWORD";
            lblPass.Font = new Font("Segoe UI", 7.5f, FontStyle.Bold);
            lblPass.ForeColor = ColMuted;
            lblPass.Location = new Point(20, 80);
            lblPass.AutoSize = true;
            pnlCard1.Controls.Add(lblPass);

            txtPass = new TextBox();
            txtPass.Location = new Point(20, 100);
            txtPass.Size = new Size(428, 28);
            txtPass.Font = new Font("Segoe UI", 10.5f);
            txtPass.BackColor = ColInputBg;
            txtPass.ForeColor = ColText;
            txtPass.BorderStyle = BorderStyle.FixedSingle;
            txtPass.UseSystemPasswordChar = true;
            pnlCard1.Controls.Add(txtPass);

            CheckBox chkShow = new CheckBox();
            chkShow.Text = "Show password";
            chkShow.Font = new Font("Segoe UI", 8.5f);
            chkShow.ForeColor = ColMuted;
            chkShow.Location = new Point(20, 140);
            chkShow.AutoSize = true;
            chkShow.CheckedChanged += (s, e) => {
                txtPass.UseSystemPasswordChar = !chkShow.Checked;
            };
            pnlCard1.Controls.Add(chkShow);

            // --- Section 02: Actions ---
            Label lblSec2 = new Label();
            lblSec2.Text = "02 • AUTOMATION ACTIONS";
            lblSec2.Font = new Font("Segoe UI", 8f, FontStyle.Bold);
            lblSec2.ForeColor = ColAccent;
            lblSec2.Location = new Point(36, pnlCard1.Bottom + 20);
            lblSec2.AutoSize = true;
            this.Controls.Add(lblSec2);

            Panel pnlCard2 = new Panel();
            pnlCard2.Location = new Point(36, lblSec2.Bottom + 8);
            pnlCard2.Size = new Size(468, 114);
            pnlCard2.BackColor = ColSurface;
            pnlCard2.Paint += (s, e) => {
                e.Graphics.DrawRectangle(new Pen(ColBorder, 1), 0, 0, pnlCard2.Width - 1, pnlCard2.Height - 1);
            };
            this.Controls.Add(pnlCard2);

            // Register Button (Terracotta Accent)
            btnRegister = new Button();
            btnRegister.Text = "Register Auto-Login";
            btnRegister.Location = new Point(18, 16);
            btnRegister.Size = new Size(208, 42);
            btnRegister.FlatStyle = FlatStyle.Flat;
            btnRegister.FlatAppearance.BorderSize = 0;
            btnRegister.BackColor = ColAccent;
            btnRegister.ForeColor = Color.White;
            btnRegister.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            btnRegister.Cursor = Cursors.Hand;
            btnRegister.Click += BtnRegister_Click;
            pnlCard2.Controls.Add(btnRegister);

            // Deregister Button (Muted Dark)
            btnDeregister = new Button();
            btnDeregister.Text = "Deregister & Delete";
            btnDeregister.Location = new Point(242, 16);
            btnDeregister.Size = new Size(208, 42);
            btnDeregister.FlatStyle = FlatStyle.Flat;
            btnDeregister.FlatAppearance.BorderColor = ColBorder;
            btnDeregister.BackColor = ColInputBg;
            btnDeregister.ForeColor = ColMuted;
            btnDeregister.Font = new Font("Segoe UI", 9f, FontStyle.Regular);
            btnDeregister.Cursor = Cursors.Hand;
            btnDeregister.Click += BtnDeregister_Click;
            pnlCard2.Controls.Add(btnDeregister);

            // Test Connection Button (Secondary outline)
            btnTestLogin = new Button();
            btnTestLogin.Text = "Test Connection / Reconnect Now";
            btnTestLogin.Location = new Point(18, 66);
            btnTestLogin.Size = new Size(432, 34);
            btnTestLogin.FlatStyle = FlatStyle.Flat;
            btnTestLogin.FlatAppearance.BorderColor = ColBorder;
            btnTestLogin.BackColor = Color.Transparent;
            btnTestLogin.ForeColor = ColText;
            btnTestLogin.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
            btnTestLogin.Cursor = Cursors.Hand;
            btnTestLogin.Click += BtnTestLogin_Click;
            pnlCard2.Controls.Add(btnTestLogin);

            // Status Bar at Bottom
            lblStatus = new Label();
            lblStatus.Text = "Initializing connection check...";
            lblStatus.Location = new Point(36, pnlCard2.Bottom + 16);
            lblStatus.Size = new Size(468, 38);
            lblStatus.TextAlign = ContentAlignment.MiddleCenter;
            lblStatus.ForeColor = ColMuted;
            lblStatus.Font = new Font("Segoe UI", 9f, FontStyle.Regular);
            this.Controls.Add(lblStatus);

            // Footer credits
            Label lblFooter = new Label();
            lblFooter.Text = "100% Client-Side & Local • Zero Admin Rights • Open Source";
            lblFooter.Location = new Point(36, 610);
            lblFooter.Size = new Size(468, 24);
            lblFooter.TextAlign = ContentAlignment.MiddleCenter;
            lblFooter.ForeColor = Color.FromArgb(90, 86, 80);
            lblFooter.Font = new Font("Segoe UI", 8.25f);
            this.Controls.Add(lblFooter);

            LoadSavedData();

            // Background polling timer for real-time network status (every 3.5s)
            pollTimer = new System.Windows.Forms.Timer();
            pollTimer.Interval = 3500;
            pollTimer.Tick += (s, ev) => RefreshNetworkState(true);
            pollTimer.Start();
        }

        void LoadSavedData()
        {
            string u, p;
            bool hasCreds = Program.LoadCredentials(out u, out p);

            bool isReg = Program.IsAutoStartRegistered();
            lblSub.Text = "Central University of Rajasthan • Auto-Start: " + (isReg ? "ACTIVE" : "OFF");

            // Auto-fill saved credentials if available
            if (hasCreds)
            {
                txtUser.Text = u;
                txtPass.Text = p;
            }
            else
            {
                txtUser.Text = "";
                txtPass.Text = "";
            }

            // Trigger immediate real-time network state check
            RefreshNetworkState(true);
        }

        void RefreshNetworkState(bool autoLoginIfExpired)
        {
            ThreadPool.QueueUserWorkItem((state) => {
                bool online = Program.IsOnline();
                bool portal = false;
                if (!online)
                {
                    portal = Program.IsPortalReachable();
                }

                if (this.IsDisposed || !this.IsHandleCreated) return;

                this.BeginInvoke(new Action(() => {
                    if (this.IsDisposed) return;

                    if (online)
                    {
                        lblPill.Text = "● ONLINE";
                        lblPill.ForeColor = ColGreen;
                        lblPill.BackColor = ColGreenBg;
                        if (!isAuthenticating)
                        {
                            lblStatus.Text = "✓ Internet connection verified and active.";
                            lblStatus.ForeColor = ColGreen;
                        }
                    }
                    else if (portal)
                    {
                        lblPill.Text = "● LOGIN NEEDED";
                        lblPill.ForeColor = Color.White;
                        lblPill.BackColor = ColAccent;
                        if (!isAuthenticating)
                        {
                            lblStatus.Text = "⚠ Action Needed: CURAJ Wi-Fi session expired or inactive.";
                            lblStatus.ForeColor = ColAccent;

                            // If credentials are saved, auto-authenticate seamlessly
                            if (autoLoginIfExpired)
                            {
                                string u = txtUser.Text.Trim();
                                string p = txtPass.Text;
                                if (!string.IsNullOrEmpty(u) && !string.IsNullOrEmpty(p))
                                {
                                    TriggerAutoLogin(u, p, false);
                                }
                            }
                        }
                    }
                    else
                    {
                        lblPill.Text = "○ NO WI-FI";
                        lblPill.ForeColor = ColMuted;
                        lblPill.BackColor = Color.FromArgb(35, 33, 30);
                        if (!isAuthenticating)
                        {
                            lblStatus.Text = "Not connected to CURAJ network gateway.";
                            lblStatus.ForeColor = ColMuted;
                        }
                    }
                }));
            });
        }

        void TriggerAutoLogin(string user, string pass, bool showPopup)
        {
            if (isAuthenticating) return;
            isAuthenticating = true;

            lblPill.Text = "⚡ CONNECTING";
            lblPill.ForeColor = ColAccent;
            lblPill.BackColor = Color.FromArgb(43, 34, 26);
            lblStatus.Text = "Authenticating with CURAJ gateway...";
            lblStatus.ForeColor = ColAccent;

            ThreadPool.QueueUserWorkItem((state) => {
                string res = Program.PerformLogin(user, pass);
                if (this.IsDisposed || !this.IsHandleCreated) return;

                this.BeginInvoke(new Action(() => {
                    isAuthenticating = false;
                    if (this.IsDisposed) return;

                    if (res == "SUCCESS")
                    {
                        lblPill.Text = "● ONLINE";
                        lblPill.ForeColor = ColGreen;
                        lblPill.BackColor = ColGreenBg;
                        lblStatus.Text = "✓ Login successful! Campus internet active.";
                        lblStatus.ForeColor = ColGreen;
                        if (showPopup)
                        {
                            MessageBox.Show("Login successful! You are connected to campus internet.", "Connected", MessageBoxButtons.OK, MessageBoxIcon.Information);
                        }
                    }
                    else
                    {
                        lblStatus.Text = res;
                        lblStatus.ForeColor = ColRed;
                        if (showPopup)
                        {
                            MessageBox.Show("Gateway response: " + res, "Gateway Status", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                        }
                        RefreshNetworkState(false);
                    }
                }));
            });
        }

        void BtnRegister_Click(object sender, EventArgs e)
        {
            string user = txtUser.Text.Trim();
            string pass = txtPass.Text;
            if (string.IsNullOrEmpty(user) || string.IsNullOrEmpty(pass))
            {
                MessageBox.Show("Please enter both Mobile Number and Wi-Fi Password.", "Credentials Required", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            string dir = Program.GetConfigDir();
            string targetExe = Path.Combine(dir, "campus-connect.exe");

            try
            {
                if (!string.Equals(Application.ExecutablePath, targetExe, StringComparison.OrdinalIgnoreCase))
                {
                    File.Copy(Application.ExecutablePath, targetExe, true);
                }
            }
            catch { targetExe = Application.ExecutablePath; }

            Program.SaveCredentials(user, pass);

            bool ok = Program.RegisterAutoStart(targetExe);
            if (ok)
            {
                Program.StartBackgroundWatch(targetExe);
                lblSub.Text = "Central University of Rajasthan • Auto-Start: ACTIVE";
                lblStatus.Text = "✓ Registered successfully! Silent watchdog is active.";
                lblStatus.ForeColor = ColGreen;
                TriggerAutoLogin(user, pass, false);
                MessageBox.Show("Auto-Login is now active!\n\nYour PC will now automatically authenticate to 'CURAJ CAMPUS CONNECT' whenever you connect.", "Campus Connect", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            else
            {
                MessageBox.Show("Could not save auto-login registry setting.", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        void BtnDeregister_Click(object sender, EventArgs e)
        {
            bool ok = Program.UnregisterAutoStart();

            // Clear input fields immediately upon deregistration
            txtUser.Text = "";
            txtPass.Text = "";

            lblSub.Text = "Central University of Rajasthan • Auto-Start: OFF";
            lblStatus.Text = "Auto-login deregistered & credentials deleted.";
            lblStatus.ForeColor = ColRed;
            RefreshNetworkState(false);
            MessageBox.Show("Campus Connect has been completely deregistered.\n\nSaved credentials and startup tasks have been deleted.", "Deregistered", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        void BtnTestLogin_Click(object sender, EventArgs e)
        {
            string user = txtUser.Text.Trim();
            string pass = txtPass.Text;
            if (string.IsNullOrEmpty(user) || string.IsNullOrEmpty(pass))
            {
                MessageBox.Show("Please enter credentials first.", "Notice", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            TriggerAutoLogin(user, pass, true);
        }
    }
}
