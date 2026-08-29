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

            // Otherwise show GUI
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }
    }

    public class MainForm : Form
    {
        TextBox txtUser;
        TextBox txtPass;
        Button btnRegister;
        Button btnDeregister;
        Button btnTestLogin;
        Label lblStatus;

        public MainForm()
        {
            this.Text = "CURAJ Campus Connect - 1-Click Auto Login";
            this.Size = new Size(460, 360);
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(15, 23, 42);
            this.ForeColor = Color.White;
            this.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);

            Label lblTitle = new Label();
            lblTitle.Text = "CURAJ Wi-Fi Auto-Login";
            lblTitle.Font = new Font("Segoe UI", 14f, FontStyle.Bold);
            lblTitle.ForeColor = Color.FromArgb(56, 189, 248);
            lblTitle.Location = new Point(25, 18);
            lblTitle.AutoSize = true;
            this.Controls.Add(lblTitle);

            Label lblSub = new Label();
            lblSub.Text = "Automates login on 'CURAJ CAMPUS CONNECT'. Open Source & Local.";
            lblSub.ForeColor = Color.FromArgb(148, 163, 184);
            lblSub.Location = new Point(27, 48);
            lblSub.Size = new Size(400, 20);
            this.Controls.Add(lblSub);

            Label lblUser = new Label();
            lblUser.Text = "Username / Mobile Number:";
            lblUser.Location = new Point(25, 85);
            lblUser.AutoSize = true;
            this.Controls.Add(lblUser);

            txtUser = new TextBox();
            txtUser.Location = new Point(27, 108);
            txtUser.Size = new Size(390, 26);
            txtUser.BackColor = Color.FromArgb(30, 41, 59);
            txtUser.ForeColor = Color.White;
            this.Controls.Add(txtUser);

            Label lblPass = new Label();
            lblPass.Text = "Wi-Fi Password:";
            lblPass.Location = new Point(25, 145);
            lblPass.AutoSize = true;
            this.Controls.Add(lblPass);

            txtPass = new TextBox();
            txtPass.PasswordChar = '●';
            txtPass.Location = new Point(27, 168);
            txtPass.Size = new Size(390, 26);
            txtPass.BackColor = Color.FromArgb(30, 41, 59);
            txtPass.ForeColor = Color.White;
            this.Controls.Add(txtPass);

            btnRegister = new Button();
            btnRegister.Text = "⚡ Register Auto-Login";
            btnRegister.Location = new Point(27, 215);
            btnRegister.Size = new Size(185, 40);
            btnRegister.BackColor = Color.FromArgb(2, 132, 199);
            btnRegister.ForeColor = Color.White;
            btnRegister.FlatStyle = FlatStyle.Flat;
            btnRegister.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            btnRegister.Click += BtnRegister_Click;
            this.Controls.Add(btnRegister);

            btnDeregister = new Button();
            btnDeregister.Text = "❌ Deregister";
            btnDeregister.Location = new Point(232, 215);
            btnDeregister.Size = new Size(185, 40);
            btnDeregister.BackColor = Color.FromArgb(71, 85, 105);
            btnDeregister.ForeColor = Color.White;
            btnDeregister.FlatStyle = FlatStyle.Flat;
            btnDeregister.Click += BtnDeregister_Click;
            this.Controls.Add(btnDeregister);

            btnTestLogin = new Button();
            btnTestLogin.Text = "Test Login Now";
            btnTestLogin.Location = new Point(27, 265);
            btnTestLogin.Size = new Size(390, 30);
            btnTestLogin.BackColor = Color.FromArgb(30, 41, 59);
            btnTestLogin.FlatStyle = FlatStyle.Flat;
            btnTestLogin.Click += BtnTestLogin_Click;
            this.Controls.Add(btnTestLogin);

            lblStatus = new Label();
            lblStatus.Location = new Point(27, 305);
            lblStatus.Size = new Size(390, 22);
            lblStatus.TextAlign = ContentAlignment.MiddleCenter;
            lblStatus.ForeColor = Color.FromArgb(52, 211, 153);
            this.Controls.Add(lblStatus);

            LoadSavedData();
        }

        void LoadSavedData()
        {
            if (Program.IsAutoStartRegistered())
            {
                lblStatus.Text = "Status: Active & Registered on this PC";
                lblStatus.ForeColor = Color.FromArgb(52, 211, 153);
            }
            else
            {
                lblStatus.Text = "Status: Not registered for auto-login";
                lblStatus.ForeColor = Color.FromArgb(148, 163, 184);
            }

            string u, p;
            if (Program.LoadCredentials(out u, out p))
            {
                txtUser.Text = u;
                txtPass.Text = p;
            }
        }

        void BtnRegister_Click(object sender, EventArgs e)
        {
            string user = txtUser.Text.Trim();
            string pass = txtPass.Text;
            if (string.IsNullOrEmpty(user) || string.IsNullOrEmpty(pass))
            {
                MessageBox.Show("Please enter both Username and Password.", "Required", MessageBoxButtons.OK, MessageBoxIcon.Warning);
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
                lblStatus.Text = "Status: Active & Registered!";
                lblStatus.ForeColor = Color.FromArgb(52, 211, 153);
                MessageBox.Show("Auto-Login is now registered!\n\nIt will silently keep you logged into CURAJ Wi-Fi whenever your PC is on.", "Registered Successfully", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            else
            {
                MessageBox.Show("Could not set startup registry key.", "Notice", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        void BtnDeregister_Click(object sender, EventArgs e)
        {
            bool ok = Program.UnregisterAutoStart();
            lblStatus.Text = "Status: Deregistered (Disabled)";
            lblStatus.ForeColor = Color.FromArgb(239, 68, 68);
            MessageBox.Show("Auto-Login has been completely removed and stopped.", "Deregistered", MessageBoxButtons.OK, MessageBoxIcon.Information);
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

            lblStatus.Text = "Testing connection...";
            lblStatus.ForeColor = Color.FromArgb(56, 189, 248);
            Application.DoEvents();

            string res = Program.PerformLogin(user, pass);
            if (res == "SUCCESS")
            {
                lblStatus.Text = "Login successful! Internet active.";
                lblStatus.ForeColor = Color.FromArgb(52, 211, 153);
                MessageBox.Show("Login successful! You are now connected to the internet.", "Success", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            else
            {
                lblStatus.Text = "Login failed: " + res;
                lblStatus.ForeColor = Color.FromArgb(239, 68, 68);
                MessageBox.Show("Login response: " + res, "Result", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }
    }
}
