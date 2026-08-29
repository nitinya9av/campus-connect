using System;
using System.IO;
using System.Net;
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
                req.Timeout = 3000;
                req.Method = "GET";
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    return (int)res.StatusCode == 204;
                }
            }
            catch { return false; }
        }

        public static bool IsPortalReachable()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://" + PORTAL_IP + "/userportal/pages/usermedia/curaj/app/campus/ui/login.html");
                req.Timeout = 3000;
                req.Method = "GET";
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    return res.StatusCode == HttpStatusCode.OK;
                }
            }
            catch { return false; }
        }

        public static string PerformLogin(string user, string pass)
        {
            try
            {
                string postData = "username=" + Uri.EscapeDataString(user) +
                                  "&password=" + Uri.EscapeDataString(pass) +
                                  "&phone=0&type=2&jsonresponse=1";
                byte[] data = Encoding.UTF8.GetBytes(postData);

                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://" + PORTAL_IP + "/userportal/newlogin.do");
                req.Method = "POST";
                req.ContentType = "application/x-www-form-urlencoded; charset=UTF-8";
                req.ContentLength = data.Length;
                req.Timeout = 8000;
                req.Headers.Add("X-Requested-With", "XMLHttpRequest");
                req.Referer = "http://" + PORTAL_IP + "/userportal/pages/usermedia/curaj/app/campus/ui/login.html";

                using (Stream stream = req.GetRequestStream())
                {
                    stream.Write(data, 0, data.Length);
                }

                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                using (StreamReader reader = new StreamReader(res.GetResponseStream()))
                {
                    string response = reader.ReadToEnd();
                    if (response.Contains("success_net") || response.Contains("redirect_to_nas") || response.Contains("\"errorKey\":\"success\""))
                    {
                        return "SUCCESS";
                    }
                    return response;
                }
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
                foreach (Process p in Process.GetProcessesByName("curaj_connect"))
                {
                    if (p.Id != current.Id)
                    {
                        try { p.Kill(); } catch { }
                    }
                }
            }
            catch { }
        }

        static void RunWatch()
        {
            string user, pass;
            if (!LoadCredentials(out user, out pass)) return;

            while (true)
            {
                try
                {
                    if (!IsOnline())
                    {
                        if (IsPortalReachable())
                        {
                            PerformLogin(user, pass);
                        }
                    }
                }
                catch { }
                Thread.Sleep(40000);
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

            Label lblSub = new Label();
            lblSub.Text = "Central University of Rajasthan";
            lblSub.Font = new Font("Segoe UI", 9f, FontStyle.Regular);
            lblSub.ForeColor = ColMuted;
            lblSub.AutoSize = true;
            lblSub.Location = new Point(52, lblBrand.Bottom + 4);
            pnlHeader.Controls.Add(lblSub);

            // Adjust header height dynamically with generous padding
            pnlHeader.Height = Math.Max(94, lblSub.Bottom + 18);

            // Status Pill Badge in top right
            lblPill = new Label();
            lblPill.Text = "○ IDLE";
            lblPill.Font = new Font("Segoe UI", 8f, FontStyle.Bold);
            lblPill.ForeColor = ColMuted;
            lblPill.BackColor = Color.FromArgb(35, 33, 30);
            lblPill.Location = new Point(415, 26);
            lblPill.Size = new Size(90, 28);
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
            lblSec1.ForeColor = ColMuted;
            lblSec1.Location = new Point(36, pnlHeader.Bottom + 22);
            lblSec1.AutoSize = true;
            this.Controls.Add(lblSec1);

            Panel pnlCard = new Panel();
            pnlCard.Location = new Point(36, lblSec1.Bottom + 8);
            pnlCard.Size = new Size(468, 168);
            pnlCard.BackColor = ColSurface;
            pnlCard.Paint += (s, e) => {
                e.Graphics.DrawRectangle(new Pen(ColBorder, 1), 0, 0, 467, 167);
            };
            this.Controls.Add(pnlCard);

            Label lblUser = new Label();
            lblUser.Text = "MOBILE NUMBER (USERNAME)";
            lblUser.Font = new Font("Segoe UI", 7.5f, FontStyle.Bold);
            lblUser.ForeColor = ColMuted;
            lblUser.Location = new Point(18, 16);
            lblUser.AutoSize = true;
            pnlCard.Controls.Add(lblUser);

            txtUser = new TextBox();
            txtUser.Location = new Point(18, 38);
            txtUser.Size = new Size(432, 28);
            txtUser.BackColor = ColInputBg;
            txtUser.ForeColor = ColText;
            txtUser.BorderStyle = BorderStyle.FixedSingle;
            txtUser.Font = new Font("Segoe UI", 11f);
            txtUser.MaxLength = 10;
            txtUser.KeyPress += (s, e) => {
                // Strict numerical input filter
                if (!char.IsControl(e.KeyChar) && !char.IsDigit(e.KeyChar))
                {
                    e.Handled = true;
                }
            };
            pnlCard.Controls.Add(txtUser);

            Label lblPass = new Label();
            lblPass.Text = "WI-FI PASSWORD";
            lblPass.Font = new Font("Segoe UI", 7.5f, FontStyle.Bold);
            lblPass.ForeColor = ColMuted;
            lblPass.Location = new Point(18, 86);
            lblPass.AutoSize = true;
            pnlCard.Controls.Add(lblPass);

            txtPass = new TextBox();
            txtPass.PasswordChar = '●';
            txtPass.Location = new Point(18, 108);
            txtPass.Size = new Size(432, 28);
            txtPass.BackColor = ColInputBg;
            txtPass.ForeColor = ColText;
            txtPass.BorderStyle = BorderStyle.FixedSingle;
            txtPass.Font = new Font("Segoe UI", 11f);
            pnlCard.Controls.Add(txtPass);

            // --- Section 02: Actions ---
            Label lblSec2 = new Label();
            lblSec2.Text = "02 • SETUP & CONTROLS";
            lblSec2.Font = new Font("Segoe UI", 8f, FontStyle.Bold);
            lblSec2.ForeColor = ColMuted;
            lblSec2.Location = new Point(36, 316);
            lblSec2.AutoSize = true;
            this.Controls.Add(lblSec2);

            btnRegister = new Button();
            btnRegister.Text = "Register Auto-Login";
            btnRegister.Location = new Point(36, 340);
            btnRegister.Size = new Size(468, 48);
            btnRegister.BackColor = ColAccent;
            btnRegister.ForeColor = Color.White;
            btnRegister.FlatStyle = FlatStyle.Flat;
            btnRegister.FlatAppearance.BorderSize = 0;
            btnRegister.Font = new Font("Segoe UI", 10.5f, FontStyle.Bold);
            btnRegister.Cursor = Cursors.Hand;
            btnRegister.Click += BtnRegister_Click;
            this.Controls.Add(btnRegister);

            btnTestLogin = new Button();
            btnTestLogin.Text = "Test Connection";
            btnTestLogin.Location = new Point(36, 402);
            btnTestLogin.Size = new Size(226, 42);
            btnTestLogin.BackColor = ColSurface;
            btnTestLogin.ForeColor = ColText;
            btnTestLogin.FlatStyle = FlatStyle.Flat;
            btnTestLogin.FlatAppearance.BorderColor = ColBorder;
            btnTestLogin.Font = new Font("Segoe UI", 9.5f);
            btnTestLogin.Cursor = Cursors.Hand;
            btnTestLogin.Click += BtnTestLogin_Click;
            this.Controls.Add(btnTestLogin);

            btnDeregister = new Button();
            btnDeregister.Text = "Deregister";
            btnDeregister.Location = new Point(278, 402);
            btnDeregister.Size = new Size(226, 42);
            btnDeregister.BackColor = ColSurface;
            btnDeregister.ForeColor = ColMuted;
            btnDeregister.FlatStyle = FlatStyle.Flat;
            btnDeregister.FlatAppearance.BorderColor = ColBorder;
            btnDeregister.Font = new Font("Segoe UI", 9.5f);
            btnDeregister.Cursor = Cursors.Hand;
            btnDeregister.Click += BtnDeregister_Click;
            this.Controls.Add(btnDeregister);

            // --- Status and Feedback ---
            lblStatus = new Label();
            lblStatus.Location = new Point(36, 466);
            lblStatus.Size = new Size(468, 48);
            lblStatus.TextAlign = ContentAlignment.MiddleCenter;
            lblStatus.ForeColor = ColMuted;
            lblStatus.Font = new Font("Segoe UI", 9.5f);
            this.Controls.Add(lblStatus);

            // Footer note
            Label lblFooter = new Label();
            lblFooter.Text = "100% Client-Side & Local • Zero Admin Rights • Open Source";
            lblFooter.Location = new Point(36, 595);
            lblFooter.Size = new Size(468, 24);
            lblFooter.TextAlign = ContentAlignment.MiddleCenter;
            lblFooter.ForeColor = Color.FromArgb(90, 86, 80);
            lblFooter.Font = new Font("Segoe UI", 8.25f);
            this.Controls.Add(lblFooter);

            LoadSavedData();
        }

        void LoadSavedData()
        {
            string u, p;
            bool hasCreds = Program.LoadCredentials(out u, out p);

            if (Program.IsAutoStartRegistered())
            {
                lblStatus.Text = "✓ Auto-login active and registered on this PC.";
                lblStatus.ForeColor = ColGreen;
                lblPill.Text = "● ACTIVE";
                lblPill.ForeColor = ColGreen;
                lblPill.BackColor = ColGreenBg;
            }
            else
            {
                lblStatus.Text = "Not registered. Enter credentials and click Register.";
                lblStatus.ForeColor = ColMuted;
                lblPill.Text = "○ IDLE";
                lblPill.ForeColor = ColMuted;
                lblPill.BackColor = Color.FromArgb(35, 33, 30);
            }

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
            string targetExe = Path.Combine(dir, "curaj_connect.exe");

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
                lblStatus.Text = "✓ Registered successfully! Silent watchdog is active.";
                lblStatus.ForeColor = ColGreen;
                lblPill.Text = "● ACTIVE";
                lblPill.ForeColor = ColGreen;
                lblPill.BackColor = ColGreenBg;
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

            lblStatus.Text = "Auto-login deregistered & credentials deleted.";
            lblStatus.ForeColor = ColRed;
            lblPill.Text = "○ IDLE";
            lblPill.ForeColor = ColMuted;
            lblPill.BackColor = Color.FromArgb(35, 33, 30);
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

            lblStatus.Text = "Connecting to university gateway (122.252.242.93)...";
            lblStatus.ForeColor = ColAccent;
            Application.DoEvents();

            string res = Program.PerformLogin(user, pass);
            if (res == "SUCCESS")
            {
                lblStatus.Text = "✓ Login successful! Campus internet active.";
                lblStatus.ForeColor = ColGreen;
                MessageBox.Show("Login successful! You are connected to campus internet.", "Connected", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            else
            {
                lblStatus.Text = "Gateway response: " + res;
                lblStatus.ForeColor = ColRed;
                MessageBox.Show("Gateway response: " + res, "Gateway Status", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }
    }
}
