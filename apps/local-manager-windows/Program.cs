using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Windows.Forms;

namespace Mad4B.LocalManager.Windows;

internal static class Program
{
    private const string BaseUrl = "https://auth.mad4b.com";
    private const string LocalManagerUrl = BaseUrl + "/app/local-manager";
    private const string SignInUrl = BaseUrl + "/app/local-manager/sign-in?source=windows-app";
    private const string SignUpUrl = BaseUrl + "/app/local-manager/sign-up?source=windows-app";
    private const string PairingUrl = BaseUrl + "/app/local-manager/link-device?platform=windows&source=windows-app";
    private const string DevicesUrl = BaseUrl + "/app/local-manager/devices?source=windows-app";
    private const string RoutesUrl = BaseUrl + "/app/local-manager/routes?source=windows-app";
    private const string BackupsUrl = BaseUrl + "/app/local-manager/backups?source=windows-app";
    private const string SettingsUrl = BaseUrl + "/app/local-manager/settings?source=windows-app";
    private const string UpdateUrl = BaseUrl + "/app/local-manager/download/windows";
    private const string DeviceLinkStartUrl = BaseUrl + "/local-manager/device-link/start";
    private const string DeviceLinkPollUrl = BaseUrl + "/local-manager/device-link/poll";

    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }

    private sealed class MainForm : Form
    {
        private readonly Label _status;
        private readonly Label _pairingCode;
        private readonly ProgressBar _progress;
        private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web);

        public MainForm()
        {
            Text = "Mad4B Local Manager";
            MinimumSize = new Size(800, 610);
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 10);

            var title = new Label
            {
                Text = "Mad4B Local Manager",
                Font = new Font("Segoe UI", 22, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(24, 20)
            };

            var body = new Label
            {
                Text = "Sign in with Mad4B, link this Windows device, then manage routes, backups, DR probes, and settings.\n\nThis app starts a short-lived pairing code and contains no shared backend key, platform token, or preloaded device credential.",
                AutoSize = false,
                Location = new Point(28, 72),
                Size = new Size(720, 82)
            };

            var signInButton = MakeButton("Sign in", 28, 164, 150, (_, _) => OpenUrl(SignInUrl));
            var signUpButton = MakeButton("Create account", 194, 164, 160, (_, _) => OpenUrl(SignUpUrl));
            var linkButton = MakeButton("Link this device", 370, 164, 170, async (_, _) => await StartDeviceLinkAsync());
            var openButton = MakeButton("Open Local Manager", 556, 164, 180, (_, _) => OpenUrl(LocalManagerUrl));

            _pairingCode = new Label
            {
                Text = "Pairing code: not started",
                Font = new Font("Segoe UI", 14, FontStyle.Bold),
                AutoSize = false,
                Location = new Point(28, 218),
                Size = new Size(708, 38)
            };

            var devicesButton = MakeButton("My devices", 28, 272, 150, (_, _) => OpenUrl(DevicesUrl));
            var routesButton = MakeButton("Routes", 194, 272, 150, (_, _) => OpenUrl(RoutesUrl));
            var backupsButton = MakeButton("Backups / DR", 360, 272, 160, (_, _) => OpenUrl(BackupsUrl));
            var settingsButton = MakeButton("Settings", 536, 272, 150, (_, _) => OpenUrl(SettingsUrl));

            var shortcutButton = MakeButton("Create desktop shortcut", 28, 346, 210, (_, _) => CreateShortcut());
            var folderButton = MakeButton("Open local folder", 254, 346, 170, (_, _) => OpenLocalFolder());
            var updateButton = MakeButton("Check / install update", 440, 346, 200, async (_, _) => await DownloadAndRunLatestAsync());

            _status = new Label
            {
                Name = "StatusLabel",
                Text = "Ready. No secrets are stored before device approval.",
                AutoSize = false,
                Location = new Point(28, 420),
                Size = new Size(720, 50)
            };

            _progress = new ProgressBar
            {
                Location = new Point(28, 480),
                Size = new Size(720, 22),
                Minimum = 0,
                Maximum = 100,
                Value = 0
            };

            var note = new Label
            {
                Text = "After sign-in, the web dashboard controls access by your Mad4B account role. Device-scoped access is issued only after the link-device consent flow.",
                AutoSize = false,
                Location = new Point(28, 518),
                Size = new Size(720, 44)
            };

            Controls.AddRange(new Control[]
            {
                title, body,
                signInButton, signUpButton, linkButton, openButton,
                _pairingCode,
                devicesButton, routesButton, backupsButton, settingsButton,
                shortcutButton, folderButton, updateButton,
                _status, _progress, note
            });

            Shown += (_, _) => EnsureLocalFiles(_status);
        }

        private static Button MakeButton(string text, int x, int y, int width, EventHandler onClick)
        {
            var button = new Button
            {
                Text = text,
                Location = new Point(x, y),
                Size = new Size(width, 42)
            };
            button.Click += onClick;
            return button;
        }

        private static string InstallRoot => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Mad4B", "LocalManager");
        private static string UpdatesRoot => Path.Combine(InstallRoot, "updates");
        private static string LinkStatusPath => Path.Combine(InstallRoot, "device-link-status.json");

        private static void EnsureLocalFiles(Label? status = null)
        {
            Directory.CreateDirectory(InstallRoot);
            Directory.CreateDirectory(UpdatesRoot);
            var readme = Path.Combine(InstallRoot, "README.txt");
            File.WriteAllText(readme,
                "Mad4B Local Manager\r\n\r\n" +
                "This app contains no shared backend key, platform token, or preloaded device credential.\r\n" +
                "Open Local Manager, sign in, and link this device through the platform flow.\r\n\r\n" +
                $"Local Manager URL: {LocalManagerUrl}\r\n" +
                $"Sign in URL: {SignInUrl}\r\n" +
                $"Link-device URL: {PairingUrl}\r\n" +
                $"Update URL: {UpdateUrl}\r\n" +
                $"Installed at: {InstallRoot}\r\n");
            if (status is not null) status.Text = $"Local files prepared at {InstallRoot}";
        }

        private async Task StartDeviceLinkAsync()
        {
            try
            {
                EnsureLocalFiles(_status);
                _progress.Value = 0;
                _status.Text = "Creating pairing code…";
                _pairingCode.Text = "Pairing code: creating…";

                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
                var payload = new
                {
                    device_id = Environment.MachineName,
                    hostname = Environment.MachineName,
                    platform = "windows",
                    app_version = Application.ProductVersion
                };
                using var response = await client.PostAsync(
                    DeviceLinkStartUrl,
                    new StringContent(JsonSerializer.Serialize(payload, _json), Encoding.UTF8, "application/json"));
                var text = await response.Content.ReadAsStringAsync();
                var start = JsonSerializer.Deserialize<DeviceLinkStartResponse>(text, _json);
                if (!response.IsSuccessStatusCode || start?.Ok != true || string.IsNullOrWhiteSpace(start.UserCode) || string.IsNullOrWhiteSpace(start.PollToken))
                {
                    _status.Text = "Could not create pairing code: " + (start?.Error?.Message ?? response.ReasonPhrase ?? "unknown error");
                    _pairingCode.Text = "Pairing code: failed";
                    return;
                }

                _pairingCode.Text = "Pairing code: " + start.UserCode;
                _status.Text = "Pairing code created. Browser opened for approval.";
                _progress.Value = 10;
                OpenUrl(start.VerificationUriComplete ?? start.VerificationUri ?? PairingUrl);
                await PollDeviceLinkAsync(start.UserCode, start.PollToken, Math.Max(2, start.Interval));
            }
            catch (Exception ex)
            {
                _status.Text = "Pairing failed: " + ex.Message;
            }
        }

        private async Task PollDeviceLinkAsync(string code, string pollToken, int intervalSeconds)
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
            var started = DateTimeOffset.UtcNow;
            while (DateTimeOffset.UtcNow - started < TimeSpan.FromMinutes(10))
            {
                await Task.Delay(TimeSpan.FromSeconds(intervalSeconds));
                _status.Text = "Waiting for approval in browser…";
                _progress.Value = Math.Min(90, _progress.Value + 5);

                var payload = new { device_code = code, poll_token = pollToken };
                using var response = await client.PostAsync(
                    DeviceLinkPollUrl,
                    new StringContent(JsonSerializer.Serialize(payload, _json), Encoding.UTF8, "application/json"));
                var text = await response.Content.ReadAsStringAsync();
                var poll = JsonSerializer.Deserialize<DeviceLinkPollResponse>(text, _json);

                if ((int)response.StatusCode == 202 || string.Equals(poll?.Status, "pending", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (response.IsSuccessStatusCode && poll?.Ok == true && !string.IsNullOrWhiteSpace(poll.DeviceAccessToken))
                {
                    _progress.Value = 100;
                    _status.Text = "Device approved and linked. Device-scoped token received.";
                    File.WriteAllText(LinkStatusPath, JsonSerializer.Serialize(new
                    {
                        linked = true,
                        linked_at = DateTimeOffset.UtcNow,
                        device_id = poll.Device?.DeviceId,
                        status = poll.Status,
                        token_persisted = false,
                        note = "Device access token was received but not written to disk by this preview build."
                    }, _json));
                    return;
                }

                _status.Text = "Pairing stopped: " + (poll?.Error?.Message ?? poll?.Status ?? response.ReasonPhrase ?? "unknown status");
                return;
            }

            _status.Text = "Pairing timed out. Start a new code to try again.";
        }

        private void CreateShortcut()
        {
            EnsureLocalFiles(_status);
            var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            var shortcut = Path.Combine(desktop, "Mad4B Local Manager.url");
            File.WriteAllText(shortcut, "[InternetShortcut]\r\nURL=" + LocalManagerUrl + "\r\nIconIndex=0\r\n");
            _status.Text = $"Shortcut created: {shortcut}";
        }

        private void OpenLocalFolder()
        {
            EnsureLocalFiles(_status);
            Process.Start(new ProcessStartInfo { FileName = InstallRoot, UseShellExecute = true });
        }

        private async Task DownloadAndRunLatestAsync()
        {
            try
            {
                EnsureLocalFiles(_status);
                _status.Text = "Checking latest Windows app…";
                _progress.Value = 0;

                using var client = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
                using var response = await client.GetAsync(UpdateUrl, HttpCompletionOption.ResponseHeadersRead);
                response.EnsureSuccessStatusCode();

                var total = response.Content.Headers.ContentLength;
                var target = Path.Combine(UpdatesRoot, "Mad4B-Local-Manager-Setup-latest.exe");
                await using var source = await response.Content.ReadAsStreamAsync();
                await using var destination = File.Create(target);

                var buffer = new byte[81920];
                long readTotal = 0;
                while (true)
                {
                    var read = await source.ReadAsync(buffer.AsMemory(0, buffer.Length));
                    if (read == 0) break;
                    await destination.WriteAsync(buffer.AsMemory(0, read));
                    readTotal += read;
                    if (total.HasValue && total.Value > 0)
                    {
                        var pct = (int)Math.Min(100, (readTotal * 100L) / total.Value);
                        _progress.Value = pct;
                    }
                }

                _progress.Value = 100;
                _status.Text = $"Latest installer downloaded: {target}. Launching…";
                Process.Start(new ProcessStartInfo { FileName = target, UseShellExecute = true });
            }
            catch (Exception ex)
            {
                _status.Text = "Update failed: " + ex.Message;
            }
        }

        private static void OpenUrl(string url)
        {
            Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
        }
    }

    private sealed class DeviceLinkError
    {
        public string? Code { get; set; }
        public string? Message { get; set; }
    }

    private sealed class DeviceLinkStartResponse
    {
        [JsonPropertyName("ok")]
        public bool Ok { get; set; }

        [JsonPropertyName("device_code")]
        public string? DeviceCode { get; set; }

        [JsonPropertyName("user_code")]
        public string? UserCode { get; set; }

        [JsonPropertyName("verification_uri")]
        public string? VerificationUri { get; set; }

        [JsonPropertyName("verification_uri_complete")]
        public string? VerificationUriComplete { get; set; }

        [JsonPropertyName("poll_token")]
        public string? PollToken { get; set; }

        [JsonPropertyName("interval")]
        public int Interval { get; set; } = 3;

        [JsonPropertyName("error")]
        public DeviceLinkError? Error { get; set; }
    }

    private sealed class DeviceLinkPollResponse
    {
        [JsonPropertyName("ok")]
        public bool Ok { get; set; }

        [JsonPropertyName("status")]
        public string? Status { get; set; }

        [JsonPropertyName("device_access_token")]
        public string? DeviceAccessToken { get; set; }

        [JsonPropertyName("device")]
        public DeviceLinkDevice? Device { get; set; }

        [JsonPropertyName("error")]
        public DeviceLinkError? Error { get; set; }
    }

    private sealed class DeviceLinkDevice
    {
        [JsonPropertyName("device_id")]
        public string? DeviceId { get; set; }
    }
}
