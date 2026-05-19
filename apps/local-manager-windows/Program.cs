using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

namespace Mad4B.LocalManager.Windows;

internal static class Program
{
    private const string LocalManagerUrl = "https://auth.mad4b.com/app/local-manager";
    private const string PairingUrl = "https://auth.mad4b.com/app/local-manager#link-device";

    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }

    private sealed class MainForm : Form
    {
        public MainForm()
        {
            Text = "Mad4B Local Manager";
            MinimumSize = new Size(620, 420);
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 10);

            var title = new Label
            {
                Text = "Mad4B Local Manager",
                Font = new Font("Segoe UI", 20, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(24, 22)
            };

            var body = new Label
            {
                Text = "Install complete. Sign in with Mad4B, then link this Windows device when device linking is available.\n\nThis launcher contains no backend key, platform token, or device credential.",
                AutoSize = false,
                Location = new Point(26, 74),
                Size = new Size(550, 94)
            };

            var openButton = new Button
            {
                Text = "Open Local Manager",
                Location = new Point(28, 188),
                Size = new Size(180, 42)
            };
            openButton.Click += (_, _) => OpenUrl(LocalManagerUrl);

            var linkButton = new Button
            {
                Text = "Sign in / Link device",
                Location = new Point(224, 188),
                Size = new Size(190, 42)
            };
            linkButton.Click += (_, _) => OpenUrl(PairingUrl);

            var shortcutButton = new Button
            {
                Text = "Create desktop shortcut",
                Location = new Point(28, 246),
                Size = new Size(210, 38)
            };
            shortcutButton.Click += (_, _) => CreateShortcut();

            var readmeButton = new Button
            {
                Text = "Open local folder",
                Location = new Point(254, 246),
                Size = new Size(160, 38)
            };
            readmeButton.Click += (_, _) => OpenLocalFolder();

            var status = new Label
            {
                Name = "StatusLabel",
                Text = "Ready. No secrets are stored by this launcher.",
                AutoSize = false,
                Location = new Point(28, 310),
                Size = new Size(540, 42)
            };

            Controls.AddRange(new Control[] { title, body, openButton, linkButton, shortcutButton, readmeButton, status });
            Shown += (_, _) => EnsureLocalFiles(status);
        }

        private static string InstallRoot => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Mad4B", "LocalManager");

        private static void EnsureLocalFiles(Label? status = null)
        {
            Directory.CreateDirectory(InstallRoot);
            var readme = Path.Combine(InstallRoot, "README.txt");
            File.WriteAllText(readme,
                "Mad4B Local Manager\r\n\r\n" +
                "This launcher contains no backend key, platform token, or device credential.\r\n" +
                "Open Local Manager, sign in, and link this device when the device-link flow is available.\r\n\r\n" +
                $"Local Manager URL: {LocalManagerUrl}\r\n" +
                $"Installed at: {InstallRoot}\r\n");
            status!.Text = $"Local files prepared at {InstallRoot}";
        }

        private void CreateShortcut()
        {
            EnsureLocalFiles((Label)Controls["StatusLabel"]!);
            var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            var shortcut = Path.Combine(desktop, "Mad4B Local Manager.url");
            File.WriteAllText(shortcut, "[InternetShortcut]\r\nURL=" + LocalManagerUrl + "\r\nIconIndex=0\r\n");
            ((Label)Controls["StatusLabel"]!).Text = $"Shortcut created: {shortcut}";
        }

        private void OpenLocalFolder()
        {
            EnsureLocalFiles((Label)Controls["StatusLabel"]!);
            Process.Start(new ProcessStartInfo { FileName = InstallRoot, UseShellExecute = true });
        }

        private static void OpenUrl(string url)
        {
            Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
        }
    }
}
