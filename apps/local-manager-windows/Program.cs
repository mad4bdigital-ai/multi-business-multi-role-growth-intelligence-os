using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
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
    private const string SignInUrl = BaseUrl + "/app/local-manager/link-device?mode=signin&source=windows-app";
    private const string UpdateUrl = BaseUrl + "/app/local-manager/download/windows";
    private const string UpdateInfoUrl = BaseUrl + "/app/local-manager/update/windows";
    private const string DevicesUrl = BaseUrl + "/app/local-manager/devices?source=windows-app";
    private const string RoutesUrl = BaseUrl + "/app/local-manager/routes?source=windows-app";
    private const string BackupsUrl = BaseUrl + "/app/local-manager/backups?source=windows-app";
    private const string SettingsUrl = BaseUrl + "/app/local-manager/settings?source=windows-app";
    private const string DeviceLinkStartUrl = BaseUrl + "/local-manager/device-link/start";
    private const string DeviceLinkPollUrl = BaseUrl + "/local-manager/device-link/poll";
    private const string DeviceSessionUrl = BaseUrl + "/local-manager/device/session";
    private const string DeviceControlsUrl = BaseUrl + "/local-manager/device/controls";
    private const string DeviceRepairInstallerUrl = BaseUrl + "/local-connector/install/device-download-link"; private const string DesktopCommandsUrl = BaseUrl + "/local-manager/device/desktop-commands";
    private const string N8nPublicUrl = "";
    private const string N8nCommandPath = @"D:\npm-global\n8n.cmd";
    private const string N8nUserFolder = @"D:\n8n-data";

    [STAThread]
    private static void Main()
    {
        var currentProcess = Process.GetCurrentProcess(); foreach (var otherProcess in Process.GetProcessesByName(currentProcess.ProcessName)) { if (otherProcess.Id == currentProcess.Id) continue; try { if (otherProcess.MainWindowHandle != IntPtr.Zero) otherProcess.CloseMainWindow(); if (!otherProcess.WaitForExit(3000)) otherProcess.Kill(); } catch { } } ApplicationConfiguration.Initialize();
        using var singleInstanceMutex = new System.Threading.Mutex(true, "Mad4B.LocalManager.Windows.SingleInstance", out var isFirstInstance); if (!isFirstInstance) { MessageBox.Show("Mad4B Local Manager is already running. Close the existing window before starting another copy.", "Mad4B Local Manager", MessageBoxButtons.OK, MessageBoxIcon.Information); return; } Application.Run(new MainForm());
    }

    private sealed class MainForm : Form
    {
        private readonly System.Windows.Forms.Timer _desktopCommandTimer = new() { Interval = 5000 }; private bool _desktopCommandPollRunning; private readonly Label _status;
        private readonly Label _pairingCode;
        private readonly ProgressBar _progress;
        private readonly TextBox _output;
        private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

        public MainForm()
        {
            Text = "Mad4B Local Manager";
            MinimumSize = new Size(900, 780);
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
                Size = new Size(820, 82)
            };

            var signInButton = MakeButton("Sign in", 28, 164, 140, async (_, _) => await StartDeviceLinkAsync("signin"));
            var signUpButton = MakeButton("Create account", 184, 164, 150, async (_, _) => await StartDeviceLinkAsync("signup"));
            var linkButton = MakeButton("Link this device", 350, 164, 160, async (_, _) => await StartDeviceLinkAsync("link"));
            var openButton = MakeButton("Open web app", 526, 164, 140, (_, _) => OpenUrl(LocalManagerUrl));
            var forgetButton = MakeButton("Forget device", 682, 164, 150, (_, _) => ForgetDeviceToken());

            _pairingCode = new Label
            {
                Text = "Pairing code: not started",
                Font = new Font("Segoe UI", 14, FontStyle.Bold),
                AutoSize = false,
                Location = new Point(28, 218),
                Size = new Size(820, 38)
            };

            var devicesButton = MakeButton("Device session", 28, 272, 150, async (_, _) => await LoadDeviceSessionAsync());
            var routesButton = MakeButton("Routes", 194, 272, 140, async (_, _) => await LoadDeviceControlsAsync("routes", RoutesUrl));
            var backupsButton = MakeButton("Backups / DR", 350, 272, 150, async (_, _) => await LoadDeviceControlsAsync("backups", BackupsUrl));
            var settingsButton = MakeButton("Settings", 516, 272, 140, async (_, _) => await LoadDeviceControlsAsync("settings", SettingsUrl));
            var webDevicesButton = MakeButton("Web devices", 672, 272, 150, (_, _) => OpenUrl(DevicesUrl));

            var shortcutButton = MakeButton("Create desktop shortcut", 28, 336, 210, (_, _) => CreateShortcut());
            var folderButton = MakeButton("Open local folder", 254, 336, 170, (_, _) => OpenLocalFolder());
            var updateButton = MakeButton("Check / install update", 440, 336, 200, async (_, _) => await CheckAndInstallUpdateAsync(true));
            var tokenStatusButton = MakeButton("Token status", 656, 336, 166, (_, _) => ShowTokenStatus());

            var repairButton = MakeButton("Repair connector", 28, 392, 210, async (_, _) => await RepairConnectorAsync());
            var repairControlsButton = MakeButton("Repair controls", 254, 392, 170, async (_, _) => await LoadDeviceControlsAsync("repairs", LocalManagerUrl));
            var startN8nButton = MakeButton("Start n8n", 440, 392, 170, async (_, _) => await StartN8nLocalAsync());
            var openN8nButton = MakeButton("Open n8n", 626, 392, 196, async (_, _) => await OpenN8nLocalAsync());

            _status = new Label
            {
                Name = "StatusLabel",
                Text = "Ready.\nNo plaintext device token is stored.",
                AutoSize = false,
                Location = new Point(28, 450),
                Size = new Size(820, 48)
            };
            _progress = new ProgressBar
            {
                Location = new Point(28, 508),
                Size = new Size(820, 22),
                Minimum = 0,
                Maximum = 100,
                Value = 0
            };
            _output = new TextBox
            {
                Location = new Point(28, 550),
                Size = new Size(820, 150),
                Multiline = true,
                ScrollBars = ScrollBars.Vertical,
                ReadOnly = true,
                Font = new Font("Consolas", 9),
                Text = "No device control response yet."
            };

            Controls.AddRange(new Control[]
            {
                title, body, signInButton, signUpButton, linkButton, openButton, forgetButton, _pairingCode,
                devicesButton, routesButton, backupsButton, settingsButton, webDevicesButton,
                shortcutButton, folderButton, updateButton, tokenStatusButton, repairButton, repairControlsButton,
                startN8nButton, openN8nButton, _status, _progress, _output
            });

            Shown += async (_, _) =>
            {
                EnsureLocalFiles(_status);
                ShowTokenStatus();
                await CheckAndInstallUpdateAsync(false); StartDesktopCommandPolling();
            };
        }

        private static Button MakeButton(string text, int x, int y, int width, EventHandler onClick)
        {
            var button = new Button { Text = text, Location = new Point(x, y), Size = new Size(width, 42) };
            button.Click += onClick;
            return button;
        }

        private static string InstallRoot => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Mad4B", "LocalManager");
        private static string UpdatesRoot => Path.Combine(InstallRoot, "updates");
        private static string LinkStatusPath => Path.Combine(InstallRoot, "device-link-status.json");
        private static string ProtectedTokenPath => Path.Combine(InstallRoot, "device-token.dpapi");

        private static string CurrentSemVer()
        {
            var raw = Application.ProductVersion ?? "0.0.0";
            var core = raw.Split(new[] { '-', '+' }, 2)[0];
            return string.IsNullOrWhiteSpace(core) ? raw : core;
        }

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
                ? "Linked.\nDevice token is available from DPAPI for this Windows user."
                : hasFile
                    ? "Device token file exists but could not be unprotected for this Windows user."
                    : "Not linked.\nNo DPAPI device token is stored.";
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
            _output.Text = "Device token removed.\r\nLink this device again to restore controls.";
        }

        private async Task StartDeviceLinkAsync(string mode = "link")
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
                using var response = await client.PostAsync(DeviceLinkStartUrl, JsonContent(payload));
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
                _status.Text = "Pairing code created.\nBrowser opened for approval.";
                _progress.Value = 10;
                _output.Text = JsonSerializer.Serialize(new { pairing_code = start.UserCode, expires_in = start.ExpiresIn, secrets_included = false }, _json);
                var approvalUrl = start.VerificationUriComplete ?? start.VerificationUri ?? (BaseUrl + "/app/local-manager/link-device");
                approvalUrl += approvalUrl.Contains('?') ? "&mode=" + Uri.EscapeDataString(mode) : "?mode=" + Uri.EscapeDataString(mode);
                OpenUrl(approvalUrl);
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
                using var response = await client.PostAsync(DeviceLinkPollUrl, JsonContent(payload));
                var text = await response.Content.ReadAsStringAsync();
                var poll = JsonSerializer.Deserialize<DeviceLinkPollResponse>(text, _json);
                if ((int)response.StatusCode == 202 || string.Equals(poll?.Status, "pending", StringComparison.OrdinalIgnoreCase)) continue;
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
            _status.Text = "Pairing timed out.\nStart a new code to try again.";
        }

        private async Task LoadDeviceSessionAsync()
        {
            var token = LoadDeviceToken();
            if (string.IsNullOrWhiteSpace(token))
            {
                _output.Text = "No linked device token.\r\nUse 'Link this device' first.";
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
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
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

        private async Task RepairConnectorAsync()
        {
            var token = LoadDeviceToken();
            if (string.IsNullOrWhiteSpace(token))
            {
                _output.Text = "No linked device token.\r\nUse 'Link this device' first.";
                return;
            }

            try
            {
                EnsureLocalFiles(_status);
                _progress.Value = 0;
                _status.Text = "Requesting device-scoped connector repair installer…";
                using var client = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
                using var req = new HttpRequestMessage(HttpMethod.Post, DeviceRepairInstallerUrl)
                {
                    Content = JsonContent(new { format = "bat", ttl_minutes = 30 })
                };
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                req.Headers.Accept.ParseAdd("application/json");
                using var response = await client.SendAsync(req);
                var text = await response.Content.ReadAsStringAsync();
                var link = JsonSerializer.Deserialize<DeviceInstallerLinkResponse>(text, _json);
                if (!response.IsSuccessStatusCode || link?.Ok != true || string.IsNullOrWhiteSpace(link.DownloadUrl))
                {
                    _status.Text = "Repair link request failed: " + (link?.Error?.Message ?? response.ReasonPhrase ?? "unknown error");
                    _output.Text = text;
                    return;
                }

                _progress.Value = 25;
                var safeDeviceId = SafeFileSegment(link.CanonicalDeviceId ?? link.DeviceId ?? Environment.MachineName);
                var target = Path.Combine(UpdatesRoot, $"install-local-connector-{safeDeviceId}.bat");
                _status.Text = "Downloading signed repair installer…";
                using (var installerResponse = await client.GetAsync(link.DownloadUrl, HttpCompletionOption.ResponseHeadersRead))
                {
                    installerResponse.EnsureSuccessStatusCode();
                    await using var source = await installerResponse.Content.ReadAsStreamAsync();
                    await using var destination = File.Create(target);
                    await source.CopyToAsync(destination);
                }

                var fileInfo = new FileInfo(target);
                if (!fileInfo.Exists || fileInfo.Length < 64) throw new InvalidOperationException("Downloaded installer file is missing or too small.");
                _progress.Value = 75;
                _output.Text = JsonSerializer.Serialize(new
                {
                    repair_installer_downloaded = true,
                    installer_path = target,
                    canonical_device_id = link.CanonicalDeviceId,
                    config_id = link.ConfigId,
                    run_as_admin_required = link.RunAsAdminRequired,
                    secrets_included = false
                }, _json);

                var result = MessageBox.Show(
                    "A connector repair installer was downloaded. Run it as Administrator now?\n\nWindows will show a UAC prompt.",
                    "Repair connector",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning);
                if (result != DialogResult.Yes)
                {
                    _status.Text = $"Repair installer downloaded: {target}. Run as Administrator when ready.";
                    return;
                }

                Process.Start(new ProcessStartInfo
                {
                    FileName = target,
                    UseShellExecute = true,
                    WorkingDirectory = Path.GetDirectoryName(target) ?? UpdatesRoot,
                    Verb = "runas"
                });
                _progress.Value = 100;
                _status.Text = "Repair installer launched with elevation request. After it finishes, click Device session or Repair controls to verify.";
            }
            catch (Exception ex)
            {
                _status.Text = "Connector repair failed: " + ex.Message;
                _output.Text = ex.ToString();
            }
        }

        private static StringContent JsonContent(object payload) => new(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

        private static string SafeFileSegment(string value)
        {
            var chars = value.Select(ch => char.IsLetterOrDigit(ch) || ch is '-' or '_' or '.' ? ch : '-').ToArray();
            var safe = new string(chars).Trim('-');
            return string.IsNullOrWhiteSpace(safe) ? "device" : safe;
        }

        private async Task OpenN8nLocalAsync() { try { var profile = await LoadN8nProfileAsync(); var url = string.IsNullOrWhiteSpace(profile.PublicUrl) ? profile.LocalUrl : profile.PublicUrl; OpenUrl(url); _status.Text = string.IsNullOrWhiteSpace(profile.PublicUrl) ? "Opening local n8n." : "Opening public n8n."; } catch (Exception ex) { _status.Text = "Could not open n8n: " + ex.Message; _output.Text = ex.ToString(); } }

        private async Task StartN8nLocalAsync()
        {
            try
            {
                EnsureLocalFiles(_status);
                var profile = await LoadN8nProfileAsync();
                var commandPath = profile.CommandPath;
                var userFolder = profile.UserFolder;
                var localUrl = profile.LocalUrl;
                var publicUrl = profile.PublicUrl;
                var openUrl = string.IsNullOrWhiteSpace(publicUrl) ? localUrl : publicUrl;
                Directory.CreateDirectory(userFolder);
                Directory.CreateDirectory(Path.GetDirectoryName(commandPath) ?? N8nUserFolder);

                var scriptPath = Path.Combine(InstallRoot, "start-n8n-local.cmd");
                var script = string.Join("\r\n", new[]
                {
                    "@echo off",
                    "title Mad4B n8n Local Runtime",
                    "setlocal EnableExtensions",
                    "echo Mad4B Local n8n autopilot",
                    "echo Profile source: " + profile.ProfileSource,
                    "echo System ID: " + profile.SystemId,
                    "echo.",
                    "set \"PATH=%ProgramFiles%\\nodejs;%PATH%\"",
                    "where node >nul 2>&1",
                    "if errorlevel 1 goto install_node",
                    "goto node_ready",
                    ":install_node",
                    "echo Node.js was not found. Installing Node.js LTS with winget...",
                    "winget install OpenJS.NodeJS.LTS -e --silent",
                    "set \"PATH=%ProgramFiles%\\nodejs;%PATH%\"",
                    ":node_ready",
                    "where node >nul 2>&1",
                    "if errorlevel 1 (echo ERROR: Node.js is still missing. Install Node.js LTS and run again. & pause & exit /b 1)",
                    "if not exist \"" + userFolder + "\" mkdir \"" + userFolder + "\"",
                    "if not exist \"" + (Path.GetDirectoryName(commandPath) ?? N8nUserFolder) + "\" mkdir \"" + (Path.GetDirectoryName(commandPath) ?? N8nUserFolder) + "\"",
                    "set \"NPM_CONFIG_PREFIX=" + profile.NpmPrefix + "\"",
                    "set \"PATH=" + profile.NpmPrefix + ";" + profile.NpmPrefix + "\\node_modules\\.bin;%PATH%\"",
                    "if not exist \"" + commandPath + "\" (",
                    "  echo n8n was not found. Installing n8n globally into %NPM_CONFIG_PREFIX%...",
                    "  call npm config set prefix \"%NPM_CONFIG_PREFIX%\"",
                    "  call npm install -g n8n",
                    ")",
                    "if not exist \"" + commandPath + "\" (echo ERROR: n8n command is still missing at " + commandPath + " & pause & exit /b 1)",
                    "set \"N8N_USER_FOLDER=" + userFolder + "\"",
                    "set \"N8N_PORT=" + profile.Port + "\"",
                    "set \"N8N_LISTEN_ADDRESS=" + profile.ListenAddress + "\"",
                    "set \"N8N_EDITOR_BASE_URL=" + profile.EditorBaseUrl + "\"",
                    "set \"WEBHOOK_URL=" + profile.WebhookUrl + "\"",
                    "cd /d \"" + userFolder + "\"",
                    "echo Starting n8n...",
                    "echo Local:  " + localUrl,
                    "echo Public: " + (string.IsNullOrWhiteSpace(publicUrl) ? "not configured" : publicUrl),
                    "echo Keep this window open while using n8n.",
                    "call \"" + commandPath + "\"",
                    "echo.",
                    "echo n8n stopped. Press any key to close this window.",
                    "pause >nul"
                }) + "\r\n";
                File.WriteAllText(scriptPath, script, Encoding.ASCII);

                Process.Start(new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/k \"" + scriptPath + "\"",
                    WorkingDirectory = userFolder,
                    UseShellExecute = true
                });

                _status.Text = "n8n autopilot launched. Keep the terminal window open.";
                _output.Text = JsonSerializer.Serialize(new
                {
                    n8n_start_requested = true,
                    lifecycle = profile.LifecycleMode,
                    system_id = profile.SystemId,
                    installation_id = profile.InstallationId,
                    command = commandPath,
                    user_folder = userFolder,
                    local_url = localUrl,
                    public_url = publicUrl,
                    local_only = profile.LocalOnly,
                    script_path = scriptPath,
                    secrets_included = false
                }, _json);
                OpenUrl(openUrl);
            }
            catch (Exception ex)
            {
                _status.Text = "Could not start n8n: " + ex.Message;
                _output.Text = ex.ToString();
            }
        }

        private async Task<N8nLocalProfile> LoadN8nProfileAsync()
        {
            var token = LoadDeviceToken(false);
            if (string.IsNullOrWhiteSpace(token)) return N8nLocalProfile.Default();
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
            using var req = new HttpRequestMessage(HttpMethod.Get, DeviceControlsUrl + "?section=n8n");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            req.Headers.Accept.ParseAdd("application/json");
            using var response = await client.SendAsync(req);
            var text = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode) return N8nLocalProfile.Default();
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            var connector = root.TryGetProperty("n8n_connector", out var c) ? c : default;
            var profile = connector.ValueKind == JsonValueKind.Object && connector.TryGetProperty("profile", out var p) ? p : default;
            return N8nLocalProfile.FromJson(connector, profile);
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
                var infoUrl = UpdateInfoUrl + "?current_version=" + Uri.EscapeDataString(CurrentSemVer());
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
                        $"Mad4B Local Manager {info.LatestVersion} is available.\nDownload and install now?",
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
                var safeVersion = DateTimeOffset.UtcNow.ToString("yyyyMMddHHmmssfff");
                var target = Path.Combine(UpdatesRoot, $"Mad4B-Local-Manager-Setup-{safeVersion}.exe");
                await using (var source = await response.Content.ReadAsStreamAsync())
                await using (var destination = File.Create(target))
                {
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
                            var pct = (int)Math.Min(100, readTotal * 100L / total.Value);
                            _progress.Value = pct;
                        }
                    }
                }

                var fileInfo = new FileInfo(target);
                if (!fileInfo.Exists || fileInfo.Length < 2) throw new InvalidOperationException("Downloaded installer file is missing or empty.");
                var signature = File.ReadAllBytes(target).Take(2).ToArray();
                if (signature.Length < 2 || signature[0] != (byte)'M' || signature[1] != (byte)'Z')
                {
                    throw new InvalidOperationException("Downloaded file is not a valid Windows EXE. Please download again from the web app.");
                }
                _progress.Value = 100;
                _status.Text = $"Latest installer downloaded: {target}.\nLaunching update handoff…"; LaunchUpdaterAndRestart(target); return;
                Process.Start(new ProcessStartInfo
                {
                    FileName = target,
                    UseShellExecute = true,
                    WorkingDirectory = Path.GetDirectoryName(target) ?? UpdatesRoot,
                    Verb = "open"
                });
            }
            catch (Exception ex)
            {
                _status.Text = "Update failed: " + ex.Message;
            }
        }

        private void LaunchUpdaterAndRestart(string installerPath) { var helperPath = Path.Combine(UpdatesRoot, "run-local-manager-update.cmd"); var appPath = Application.ExecutablePath; var currentPid = Environment.ProcessId; var script = string.Join("\r\n", new[] { "@echo off", "setlocal", "set \"INSTALLER=" + installerPath + "\"", "set \"APP=" + appPath + "\"", "set \"PID=" + currentPid + "\"", "echo Updating Mad4B Local Manager...", "timeout /t 1 /nobreak >nul", "taskkill /PID %PID% /T /F >nul 2>nul", "start \"\" /wait \"%INSTALLER%\"", "start \"\" \"%APP%\"" }) + "\r\n"; File.WriteAllText(helperPath, script, Encoding.ASCII); Process.Start(new ProcessStartInfo { FileName = "cmd.exe", Arguments = "/c \"" + helperPath + "\"", WorkingDirectory = UpdatesRoot, UseShellExecute = true, CreateNoWindow = true }); BeginInvoke(new Action(Close)); }
        private void StartDesktopCommandPolling() { if (_desktopCommandTimer.Enabled) return; _desktopCommandTimer.Tick += async (_, _) => await PollDesktopCommandsAsync(); _desktopCommandTimer.Start(); _ = PollDesktopCommandsAsync(); }
        private async Task PollDesktopCommandsAsync() { if (_desktopCommandPollRunning) return; var token = LoadDeviceToken(false); if (string.IsNullOrWhiteSpace(token)) return; _desktopCommandPollRunning = true; try { using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) }; using var req = new HttpRequestMessage(HttpMethod.Get, DesktopCommandsUrl + "/pending?limit=5"); req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token); req.Headers.Accept.ParseAdd("application/json"); using var response = await client.SendAsync(req); var text = await response.Content.ReadAsStringAsync(); if (!response.IsSuccessStatusCode) { if (response.StatusCode != System.Net.HttpStatusCode.Unauthorized && response.StatusCode != System.Net.HttpStatusCode.Forbidden) _status.Text = "Desktop command poll failed: " + response.StatusCode; return; } using var doc = JsonDocument.Parse(text); if (!doc.RootElement.TryGetProperty("commands", out var commands) || commands.ValueKind != JsonValueKind.Array) return; foreach (var command in commands.EnumerateArray()) await ExecuteDesktopCommandAsync(client, token, command); } catch (Exception ex) { _status.Text = "Desktop command polling failed: " + ex.Message; } finally { _desktopCommandPollRunning = false; } }
        private async Task ExecuteDesktopCommandAsync(HttpClient client, string token, JsonElement command) { var commandId = JsonValue(command, "command_id"); var action = JsonValue(command, "action"); command.TryGetProperty("payload", out var payload); try { if (string.Equals(action, "open_url", StringComparison.OrdinalIgnoreCase)) { var url = JsonValue(payload, "url"); if (string.IsNullOrWhiteSpace(url)) throw new InvalidOperationException("open_url command is missing url."); OpenUrl(url); _status.Text = "Desktop command opened URL."; await CompleteDesktopCommandAsync(client, token, commandId, true, new { action, opened_url = url, handled_by = "local_manager_windows", visible_desktop = true, secrets_included = false }); return; } if (string.Equals(action, "open_n8n", StringComparison.OrdinalIgnoreCase)) { var profile = await LoadN8nProfileAsync(); var url = string.IsNullOrWhiteSpace(profile.PublicUrl) ? profile.LocalUrl : profile.PublicUrl; OpenUrl(url); _status.Text = "Desktop command opened n8n."; await CompleteDesktopCommandAsync(client, token, commandId, true, new { action, opened_url = url, system_id = profile.SystemId, handled_by = "local_manager_windows", visible_desktop = true, secrets_included = false }); return; } if (string.Equals(action, "notify", StringComparison.OrdinalIgnoreCase)) { var title = JsonValue(payload, "title", "Mad4B"); var message = JsonValue(payload, "message", ""); MessageBox.Show(message, title, MessageBoxButtons.OK, MessageBoxIcon.Information); await CompleteDesktopCommandAsync(client, token, commandId, true, new { action, shown = true, handled_by = "local_manager_windows", visible_desktop = true, secrets_included = false }); return; } if (string.Equals(action, "focus_local_manager", StringComparison.OrdinalIgnoreCase)) { if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal; Show(); Activate(); await CompleteDesktopCommandAsync(client, token, commandId, true, new { action, focused = true, handled_by = "local_manager_windows", visible_desktop = true, secrets_included = false }); return; } throw new NotSupportedException("Unsupported desktop action: " + action); } catch (Exception ex) { await CompleteDesktopCommandAsync(client, token, commandId, false, new { action, handled_by = "local_manager_windows", visible_desktop = true, secrets_included = false }, "desktop_action_failed", ex.Message); } }
        private async Task CompleteDesktopCommandAsync(HttpClient client, string token, string commandId, bool ok, object result, string? errorCode = null, string? errorMessage = null) { if (string.IsNullOrWhiteSpace(commandId)) return; using var req = new HttpRequestMessage(HttpMethod.Post, DesktopCommandsUrl + "/" + Uri.EscapeDataString(commandId) + "/complete") { Content = JsonContent(new { status = ok ? "completed" : "failed", result, error_code = errorCode, error_message = errorMessage }) }; req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token); req.Headers.Accept.ParseAdd("application/json"); using var response = await client.SendAsync(req); }
        private static string JsonValue(JsonElement element, string name, string fallback = "") { if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var value) || value.ValueKind == JsonValueKind.Null) return fallback; var text = value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString(); return string.IsNullOrWhiteSpace(text) ? fallback : text!; }
        private static void OpenUrl(string url)
        {
            Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
        }
    }

    private sealed class N8nLocalProfile
    {
        public string SystemId { get; init; } = "default-local-n8n";
        public string? InstallationId { get; init; }
        public string ProfileSource { get; init; } = "app_fallback";
        public string LifecycleMode { get; init; } = "local_manager_autopilot";
        public string InstallMode { get; init; } = "npm_global_if_missing";
        public bool LocalOnly { get; init; } = true;
        public string CommandPath { get; init; } = N8nCommandPath;
        public string NpmPrefix { get; init; } = @"D:\npm-global";
        public string UserFolder { get; init; } = N8nUserFolder;
        public string LocalUrl { get; init; } = "http://127.0.0.1:5678/";
        public string PublicUrl { get; init; } = N8nPublicUrl;
        public int Port { get; init; } = 5678;
        public string ListenAddress { get; init; } = "127.0.0.1";
        public string EditorBaseUrl { get; init; } = "http://127.0.0.1:5678/";
        public string WebhookUrl { get; init; } = "http://127.0.0.1:5678/";

        public static N8nLocalProfile Default() => new();

        public static N8nLocalProfile FromJson(JsonElement connector, JsonElement profile)
        {
            var fallback = Default();
            return new N8nLocalProfile
            {
                SystemId = GetString(connector, "system_id", fallback.SystemId),
                InstallationId = GetNullableString(connector, "installation_id"),
                ProfileSource = GetString(profile, "profile_source", fallback.ProfileSource),
                LifecycleMode = GetString(profile, "lifecycle_mode", fallback.LifecycleMode),
                InstallMode = GetString(profile, "install_mode", fallback.InstallMode),
                LocalOnly = GetBool(profile, "local_only", fallback.LocalOnly),
                CommandPath = GetString(profile, "command_path", fallback.CommandPath),
                NpmPrefix = GetString(profile, "npm_prefix", fallback.NpmPrefix),
                UserFolder = GetString(profile, "user_folder", fallback.UserFolder),
                LocalUrl = GetString(profile, "local_url", fallback.LocalUrl),
                PublicUrl = GetString(profile, "public_url", fallback.PublicUrl),
                Port = GetInt(profile, "port", fallback.Port),
                ListenAddress = GetString(profile, "listen_address", fallback.ListenAddress),
                EditorBaseUrl = GetString(profile, "editor_base_url", fallback.EditorBaseUrl),
                WebhookUrl = GetString(profile, "webhook_url", fallback.WebhookUrl),
            };
        }

        private static string GetString(JsonElement element, string name, string fallback)
        {
            if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var value)) return fallback;
            var text = value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString();
            return string.IsNullOrWhiteSpace(text) ? fallback : text!;
        }

        private static string? GetNullableString(JsonElement element, string name)
        {
            if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var value) || value.ValueKind == JsonValueKind.Null) return null;
            var text = value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString();
            return string.IsNullOrWhiteSpace(text) ? null : text;
        }

        private static bool GetBool(JsonElement element, string name, bool fallback)
        {
            if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var value)) return fallback;
            return value.ValueKind switch
            {
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                JsonValueKind.String => bool.TryParse(value.GetString(), out var parsed) ? parsed : fallback,
                _ => fallback,
            };
        }

        private static int GetInt(JsonElement element, string name, int fallback)
        {
            if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var value)) return fallback;
            if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)) return number;
            return int.TryParse(value.ToString(), out var parsed) ? parsed : fallback;
        }
    }

    private sealed class WindowsUpdateInfo
    {
        [JsonPropertyName("ok")] public bool Ok { get; set; }
        [JsonPropertyName("latest_version")] public string? LatestVersion { get; set; }
        [JsonPropertyName("current_version")] public string? CurrentVersion { get; set; }
        [JsonPropertyName("update_available")] public bool? UpdateAvailable { get; set; }
        [JsonPropertyName("release_notes")] public string[]? ReleaseNotes { get; set; }
    }

    private sealed class DeviceLinkError
    {
        [JsonPropertyName("code")] public string? Code { get; set; }
        [JsonPropertyName("message")] public string? Message { get; set; }
    }

    private sealed class DeviceLinkStartResponse
    {
        [JsonPropertyName("ok")] public bool Ok { get; set; }
        [JsonPropertyName("device_code")] public string? DeviceCode { get; set; }
        [JsonPropertyName("user_code")] public string? UserCode { get; set; }
        [JsonPropertyName("verification_uri")] public string? VerificationUri { get; set; }
        [JsonPropertyName("verification_uri_complete")] public string? VerificationUriComplete { get; set; }
        [JsonPropertyName("poll_token")] public string? PollToken { get; set; }
        [JsonPropertyName("interval")] public int Interval { get; set; } = 3;
        [JsonPropertyName("expires_in")] public int ExpiresIn { get; set; }
        [JsonPropertyName("error")] public DeviceLinkError? Error { get; set; }
    }

    private sealed class DeviceLinkPollResponse
    {
        [JsonPropertyName("ok")] public bool Ok { get; set; }
        [JsonPropertyName("status")] public string? Status { get; set; }
        [JsonPropertyName("device_access_token")] public string? DeviceAccessToken { get; set; }
        [JsonPropertyName("device")] public DeviceLinkDevice? Device { get; set; }
        [JsonPropertyName("error")] public DeviceLinkError? Error { get; set; }
    }

    private sealed class DeviceLinkDevice
    {
        [JsonPropertyName("device_id")] public string? DeviceId { get; set; }
    }

    private sealed class DeviceInstallerLinkResponse
    {
        [JsonPropertyName("ok")] public bool Ok { get; set; }
        [JsonPropertyName("device_id")] public string? DeviceId { get; set; }
        [JsonPropertyName("canonical_device_id")] public string? CanonicalDeviceId { get; set; }
        [JsonPropertyName("config_id")] public string? ConfigId { get; set; }
        [JsonPropertyName("format")] public string? Format { get; set; }
        [JsonPropertyName("ttl_minutes")] public int TtlMinutes { get; set; }
        [JsonPropertyName("download_url")] public string? DownloadUrl { get; set; }
        [JsonPropertyName("run_as_admin_required")] public bool RunAsAdminRequired { get; set; }
        [JsonPropertyName("error")] public DeviceLinkError? Error { get; set; }
    }
}
