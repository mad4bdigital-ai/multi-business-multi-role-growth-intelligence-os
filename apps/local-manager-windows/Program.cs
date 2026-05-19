using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Windows.Forms;

namespace Mad4B.LocalManager.Windows;

internal static class Program
{
    private const string BaseUrl = "https://auth.mad4b.com";
    private const string LocalManagerUrl = BaseUrl + "/app/local-manager";
    private const string SignInUrl = BaseUrl + "/connect?return_to=%2Fapp%2Flocal-manager%2Flink-device&source=windows-app";
    private const string SignUpUrl = BaseUrl + "/connect?return_to=%2Fapp%2Flocal-manager%2Flink-device&source=windows-app&mode=signup";
    private const string DevicesUrl = BaseUrl + "/app/local-manager/devices?source=windows-app";
    private const string RoutesUrl = BaseUrl + "/app/local-manager/routes?source=windows-app";
    private const string BackupsUrl = BaseUrl + "/app/local-manager/backups?source=windows-app";
    private const string SettingsUrl = BaseUrl + "/app/local-manager/settings?source=windows-app";
    private const string UpdateUrl = BaseUrl + "/app/local-manager/download/windows";
    private const string UpdateInfoUrl = BaseUrl + "/app/local-manager/update/windows";
    private const string DeviceLinkStartUrl = BaseUrl + "/local-manager/device-link/start";
    private const string DeviceLinkPollUrl = BaseUrl + "/local-manager/device-link/poll";
    private const string DeviceSessionUrl = BaseUrl + "/local-manager/device/session";
    private const string DeviceControlsUrl = BaseUrl + "/local-manager/device/controls";

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
        private readonly TextBox _output;
        private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

        public MainForm()
        {
            Text = "Mad4B Local Manager";
            MinimumSize = new Size(860, 720);
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
                Text = "Sign in with Mad4B, link this Windows device, then use the stored device-scoped token for controls.\n\nThe token is protected with Windows DPAPI for the current Windows user and is not written in plaintext.",
                AutoSize = false,
                Location = new Point(28, 72),
                Size = new Size(780, 82)
            };

            var signInButton = MakeButton("Sign in", 28, 164, 140, (_, _) => OpenUrl(SignInUrl));
            var signUpButton = MakeButton("Create account", 184, 164, 150, (_, _) => OpenUrl(SignUpUrl));
            var linkButton = MakeButton("Link this device", 350, 164, 160, async (_, _) => await StartDeviceLinkAsync());
            var openButton = MakeButton("Open web app", 526, 164, 140, (_, _) => OpenUrl(LocalManagerUrl));
            var forgetButton = MakeButton("Forget device", 682, 164, 140, (_, _) => ForgetDeviceToken());

            _pairingCode = new Label
            {
                Text = "Pairing code: not started",
                Font = new Font("Segoe UI", 14, FontStyle.Bold),
                AutoSize = false,
                Location = new Point(28, 218),
                Size = new Size(780, 38)
            };

            var devicesButton = MakeButton("Device session", 28, 272, 150, async (_, _) => await LoadDeviceSessionAsync());
            var routesButton = MakeButton("Routes", 194, 272, 140, async (_, _) => await LoadDeviceControlsAsync("routes", RoutesUrl));
            var backupsButton = MakeButton("Backups / DR", 350, 272, 150, async (_, _) => await LoadDeviceControlsAsync("backups", BackupsUrl));
            var settingsButton = MakeButton("Settings", 516, 272, 140, async (_, _) => await LoadDeviceControlsAsync("settings", SettingsUrl));
            var webDevicesButton = MakeButton("Web devices", 672, 272, 150, (_, _) => OpenUrl(DevicesUrl));

            var shortcutButton = MakeButton("Create desktop shortcut", 28, 336, 210, (_, _) => CreateShortcut());
            var folderButton = MakeButton("Open local folder", 254, 336, 170, (_, _) => OpenLocalFolder());
            var updateButton = MakeButton("Check / install update", 440, 336, 200, async (_, _) => await CheckAndInstallUpdateAsync(true));
            var tokenStatusButton = MakeButton("Token status", 656, 336, 160, (_, _) => ShowTokenStatus());

            _status = new Label
            {
                Name = "StatusLabel",
                Text = "Ready. No plaintext device token is stored.",
                AutoSize = false,
                Location = new Point(28, 406),
                Size = new Size(780, 48)
            };

            _progress = new ProgressBar
            {
                Location = new Point(28, 464),
                Size = new Size(780, 22),
                Minimum = 0,
                Maximum = 100,
                Value = 0
            };

            _output = new TextBox
            {
                Location = new Point(28, 506),
                Size = new Size(780, 150),
                Multiline = true,
                ScrollBars = ScrollBars.Vertical,
                ReadOnly = true,
                Font = new Font("Consolas", 9),
                Text = "No device control response yet."
            };

            Controls.AddRange(new Control[]
            {
                title, body,
                signInButton, signUpButton, linkButton, openButton, forgetButton,
                _pairingCode,
                devicesButton, routesButton, backupsButton, settingsButton, webDevicesButton,
                shortcutButton, folderButton, updateButton, tokenStatusButton,
                _status, _progress, _output
            });

            Shown += async (_, _) =>
            {
                EnsureLocalFiles(_status);
                ShowTokenStatus();
                await CheckAndInstallUpdateAsync(false);
            };
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
        private static string ProtectedTokenPath => Path.Combine(InstallRoot, "device-token.dpapi");

        private static void EnsureLocalFiles(Label? status = null)
        {
            Directory.CreateDirectory(InstallRoot);
            Directory.CreateDirectory(UpdatesRoot);
            var readme = Path.Combine(InstallRoot, "README.txt");
            File.WriteAllText(readme,
                "Mad4B Local Manager\r\n\r\n" +
                "This app contains no shared backend key, platform token, or preloaded device credential.\r\n" +
                "After device linking, the device-scoped token is protected with Windows DPAPI CurrentUser and saved as device-token.dpapi.\r\n\r\n" +
                $"Local Manager URL: {LocalManagerUrl}\r\n" +
                $"Sign in URL: {SignInUrl}\r\n" +
                $"Update URL: {UpdateUrl}\r\n" +
                $"Installed at: {InstallRoot}\r\n");
            if (status is not null) status.Text = $"Local files prepared at {InstallRoot}";
        }

        private void SaveDeviceToken(string token, string? deviceId, string? status)
        {
            EnsureLocalFiles(_status);
            var plaintext = Encoding.UTF8.GetBytes(token);
            var entropy = Encoding.UTF8.GetBytes("mad4b-local-manager-device-token-v1");
            var protectedBytes = ProtectedData.Protect(plaintext, entropy, DataProtectionScope.CurrentUser);
            File.WriteAllBytes(ProtectedTokenPath, protectedBytes);
            File.WriteAllText(LinkStatusPath, JsonSerializer.Serialize(new
            {
                linked = true,
                linked_at = DateTimeOffset.UtcNow,
                device_id = deviceId,
                status,
                token_persisted = true,
                token_storage = "Windows DPAPI CurrentUser",
                token_file = ProtectedTokenPath,
                secrets_included = false
            }, _json));
            _status.Text = "Device token saved with Windows DPAPI CurrentUser.";
        }

        private string? LoadDeviceToken(bool showErrors = true)
        {
            try
            {
                if (!File.Exists(ProtectedTokenPath)) return null;
                var protectedBytes = File.ReadAllBytes(ProtectedTokenPath);
                var entropy = Encoding.UTF8.GetBytes("mad4b-local-manager-device-token-v1");
                var plaintext = ProtectedData.Unprotect(protectedBytes, entropy, DataProtectionScope.CurrentUser);
                return Encoding.UTF8.GetString(plaintext);
            }
            catch (Exception ex)
            {
                if (showErrors) _status.Text = "Could not read DPAPI token: " + ex.Message;
                return null;
            }
        }

        private void ShowTokenStatus()
        {
            EnsureLocalFiles(_status);
            var hasFile = File.Exists(ProtectedTokenPath);
            var token = LoadDeviceToken(false);
            _status.Text = token is not null
                ? "Linked. Device token is available from DPAPI for this Windows user."
                : hasFile
                    ? "Device token file exists but could not be unprotected for this Windows user."
                    : "Not linked. No DPAPI device token is stored.";
            _output.Text = JsonSerializer.Serialize(new
            {
                linked = token is not null,
                token_file_exists = hasFile,
                token_storage = "Windows DPAPI CurrentUser",
                token_plaintext_shown = false,
                local_folder = InstallRoot,
                secrets_included = false
            }, _json);
        }

        private void ForgetDeviceToken()
        {
            if (File.Exists(ProtectedTokenPath)) File.Delete(ProtectedTokenPath);
            if (File.Exists(LinkStatusPath)) File.Delete(LinkStatusPath);
            _pairingCode.Text = "Pairing code: not started";
            _progress.Value = 0;
            _status.Text = "Device token removed from this Windows profile.";
            _output.Text = "Device token removed. Link this device again to restore controls.";
        }

        private async Task StartDeviceLinkAsync()
        {
            try
            {
                EnsureLocalFiles(_status);
                _progress.Value = 0;
                _status.Text = "Creating pairing code…";
                _pairingCode.Text = "Pairing code: creating…";
                _output.Text = "Waiting for pairing code…";

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
                    _output.Text = text;
                    return;
                }

                _pairingCode.Text = "Pairing code: " + start.UserCode;
                _status.Text = "Pairing code created. Browser opened for approval.";
                _progress.Value = 10;
                _output.Text = JsonSerializer.Serialize(new { pairing_code = start.UserCode, expires_in = start.ExpiresIn, secrets_included = false }, _json);
                OpenUrl(start.VerificationUriComplete ?? start.VerificationUri ?? (BaseUrl + "/app/local-manager/link-device"));
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
                    SaveDeviceToken(poll.DeviceAccessToken, poll.Device?.DeviceId, poll.Status);
                    _progress.Value = 100;
                    _status.Text = "Device approved, linked, and token saved with DPAPI.";
                    _output.Text = JsonSerializer.Serialize(new
                    {
                        linked = true,
                        device_id = poll.Device?.DeviceId,
                        token_saved_with_dpapi = true,
                        token_plaintext_shown = false,
                        secrets_included = false
                    }, _json);
                    return;
                }

                _status.Text = "Pairing stopped: " + (poll?.Error?.Message ?? poll?.Status ?? response.ReasonPhrase ?? "unknown status");
                _output.Text = text;
                return;
            }

            _status.Text = "Pairing timed out. Start a new code to try again.";
        }

        private async Task LoadDeviceSessionAsync()
        {
            var token = LoadDeviceToken();
            if (string.IsNullOrWhiteSpace(token))
            {
                _output.Text = "No linked device token. Use 'Link this device' first.";
                return;
            }
            await CallDeviceApiAsync(DeviceSessionUrl, token, "Device session");
        }

        private async Task LoadDeviceControlsAsync(string section, string fallbackUrl)
        {
            var token = LoadDeviceToken(false);
            if (string.IsNullOrWhiteSpace(token))
            {
                _status.Text = "No device token yet; opening web page instead.";
                OpenUrl(fallbackUrl);
                return;
            }
            await CallDeviceApiAsync(DeviceControlsUrl + "?section=" + Uri.EscapeDataString(section), token, section);
        }

        private async Task CallDeviceApiAsync(string url, string token, string label)
        {
            try
            {
                _status.Text = "Loading " + label + " using DPAPI-protected device token…";
                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
                using var req = new HttpRequestMessage(HttpMethod.Get, url);
                req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
                req.Headers.Accept.ParseAdd("application/json");
                using var response = await client.SendAsync(req);
                var text = await response.Content.ReadAsStringAsync();
                _status.Text = response.IsSuccessStatusCode ? label + " loaded." : label + " failed: " + response.StatusCode;
                _output.Text = text;
            }
            catch (Exception ex)
            {
                _status.Text = label + " failed: " + ex.Message;
            }
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

        private async Task CheckAndInstallUpdateAsync(bool userInitiated)
        {
            try
            {
                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
                var infoUrl = UpdateInfoUrl + "?current_version=" + Uri.EscapeDataString(Application.ProductVersion ?? "0.0.0");
                using var response = await client.GetAsync(infoUrl);
                var text = await response.Content.ReadAsStringAsync();
                var info = JsonSerializer.Deserialize<WindowsUpdateInfo>(text, _json);

                if (!response.IsSuccessStatusCode || info?.Ok != true)
                {
                    if (userInitiated)
                    {
                        _status.Text = "Could not check for updates.";
                        _output.Text = text;
                    }
                    return;
                }

                if (info.UpdateAvailable == true)
                {
                    _status.Text = $"Update available: {info.LatestVersion} (current {info.CurrentVersion ?? Application.ProductVersion}).";
                    _output.Text = JsonSerializer.Serialize(new
                    {
                        update_available = true,
                        current_version = info.CurrentVersion ?? Application.ProductVersion,
                        latest_version = info.LatestVersion,
                        release_notes = info.ReleaseNotes,
                        secrets_included = false
                    }, _json);

                    var result = MessageBox.Show(
                        $"Mad4B Local Manager {info.LatestVersion} is available. Download and install now?",
                        "Update available",
                        MessageBoxButtons.YesNo,
                        MessageBoxIcon.Information);
                    if (result == DialogResult.Yes) await DownloadAndRunLatestAsync();
                    return;
                }

                if (userInitiated)
                {
                    _status.Text = $"Local Manager is up to date ({info.LatestVersion}).";
                    _output.Text = JsonSerializer.Serialize(new
                    {
                        update_available = false,
                        current_version = info.CurrentVersion ?? Application.ProductVersion,
                        latest_version = info.LatestVersion,
                        secrets_included = false
                    }, _json);
                    MessageBox.Show("Mad4B Local Manager is up to date.", "No update available", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
            }
            catch (Exception ex)
            {
                if (userInitiated)
                {
                    _status.Text = "Update check failed: " + ex.Message;
                    _output.Text = ex.ToString();
                }
            }
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

    private sealed class WindowsUpdateInfo
    {
        [JsonPropertyName("ok")]
        public bool Ok { get; set; }

        [JsonPropertyName("latest_version")]
        public string? LatestVersion { get; set; }

        [JsonPropertyName("current_version")]
        public string? CurrentVersion { get; set; }

        [JsonPropertyName("update_available")]
        public bool? UpdateAvailable { get; set; }

        [JsonPropertyName("release_notes")]
        public string[]? ReleaseNotes { get; set; }
    }

    private sealed class DeviceLinkError
    {
        [JsonPropertyName("code")]
        public string? Code { get; set; }

        [JsonPropertyName("message")]
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

        [JsonPropertyName("expires_in")]
        public int ExpiresIn { get; set; }

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
