using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using Microsoft.Win32;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
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
        ApplicationConfiguration.Initialize();
        if (TryBootstrapInstallFromPortablePath()) return;

        CloseExistingLocalManagerProcesses();
        using var singleInstanceMutex = new System.Threading.Mutex(true, "Mad4B.LocalManager.Windows.SingleInstance", out var isFirstInstance);
        if (!isFirstInstance)
        {
            CloseExistingLocalManagerProcesses();
            System.Threading.Thread.Sleep(750);
            using var retryMutex = new System.Threading.Mutex(true, "Mad4B.LocalManager.Windows.SingleInstance", out var retryIsFirstInstance);
            if (!retryIsFirstInstance)
            {
                MessageBox.Show("Mad4B Local Manager is already running. Close the existing window before starting another copy.", "Mad4B Local Manager", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            Application.Run(new MainForm());
            return;
        }

        Application.Run(new MainForm());
    }

    private static string ProgramInstallRoot => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Mad4B", "LocalManager");

    private static string InstalledExePath => Path.Combine(ProgramInstallRoot, "Mad4B-Local-Manager.exe");

    private static bool TryBootstrapInstallFromPortablePath()
    {
        var currentPath = Path.GetFullPath(Application.ExecutablePath);
        var installedPath = Path.GetFullPath(InstalledExePath);
        if (PathsEqual(currentPath, installedPath)) return false;

        try
        {
            Directory.CreateDirectory(ProgramInstallRoot);
            CloseExistingLocalManagerProcesses();

            Exception? lastError = null;
            for (var attempt = 1; attempt <= 5; attempt++)
            {
                try
                {
                    File.Copy(currentPath, installedPath, true);
                    lastError = null;
                    break;
                }
                catch (Exception ex)
                {
                    lastError = ex;
                    System.Threading.Thread.Sleep(500);
                }
            }

            if (lastError is not null) throw lastError;
            Process.Start(new ProcessStartInfo { FileName = installedPath, UseShellExecute = true, WorkingDirectory = ProgramInstallRoot, Verb = "open" });
            return true;
        }
        catch (Exception ex)
        {
            MessageBox.Show("Could not install Mad4B Local Manager to the local app folder. " + ex.Message, "Mad4B Local Manager", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return true;
        }
    }

    private static bool PathsEqual(string left, string right) => string.Equals(Path.GetFullPath(left).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), Path.GetFullPath(right).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), StringComparison.OrdinalIgnoreCase);

    private static void CloseExistingLocalManagerProcesses()
    {
        var currentProcessId = Environment.ProcessId;
        foreach (var process in Process.GetProcesses())
        {
            try
            {
                if (process.Id == currentProcessId || !LooksLikeLocalManagerProcess(process)) continue;
                if (process.MainWindowHandle != IntPtr.Zero) process.CloseMainWindow();
                if (!process.WaitForExit(3000)) process.Kill(true);
            }
            catch { }
            finally { process.Dispose(); }
        }
    }

    private static bool LooksLikeLocalManagerProcess(Process process)
    {
        try
        {
            var title = process.MainWindowTitle ?? "";
            if (title.Contains("Mad4B Local Manager", StringComparison.OrdinalIgnoreCase)) return true;
            var name = process.ProcessName ?? "";
            if (LooksLikeLocalManagerText(name)) return true;
            var module = process.MainModule;
            var modulePath = module?.FileName ?? "";
            if (LooksLikeLocalManagerText(modulePath)) return true;
            var versionInfo = module?.FileVersionInfo;
            var metadata = string.Join(" ", new[] { versionInfo?.ProductName, versionInfo?.FileDescription, versionInfo?.OriginalFilename });
            return LooksLikeLocalManagerText(metadata);
        }
        catch { return false; }
    }

    private static bool LooksLikeLocalManagerText(string value) => value.Contains("Mad4B", StringComparison.OrdinalIgnoreCase) && (value.Contains("LocalManager", StringComparison.OrdinalIgnoreCase) || value.Contains("Local-Manager", StringComparison.OrdinalIgnoreCase) || value.Contains("Local Manager", StringComparison.OrdinalIgnoreCase));

    private sealed class MainForm : Form
    {
        private readonly System.Windows.Forms.Timer _desktopCommandTimer = new() { Interval = 5000 };
        private bool _desktopCommandPollRunning;
        private int _desktopCommandPollFailureCount;
        private DateTimeOffset _desktopCommandPollBackoffUntil = DateTimeOffset.MinValue;
        private readonly Label _status;
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

            var repairButton = MakeButton("Repair connector", 28, 392, 170, async (_, _) => await RepairConnectorAsync());
            var capabilitiesButton = MakeButton("Capabilities", 214, 392, 150, async (_, _) => await ConfigureConnectorCapabilitiesAsync());
            var repairControlsButton = MakeButton("Repair controls", 380, 392, 150, async (_, _) => await LoadDeviceControlsAsync("repairs", LocalManagerUrl));
            var startN8nButton = MakeButton("Start n8n", 546, 392, 130, async (_, _) => await StartN8nLocalAsync());
            var openN8nButton = MakeButton("Open n8n", 692, 392, 130, async (_, _) => await OpenN8nLocalAsync());

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
                shortcutButton, folderButton, updateButton, tokenStatusButton, repairButton, capabilitiesButton, repairControlsButton,
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

                await RunElevatedInstallerAndVerifyAsync(
                    target,
                    "connector repair installer",
                    "Repair connector",
                    "This will repair and restart the local connector service. Approve the Windows UAC prompt to continue.",
                    async () => await RefreshDeviceControlsAfterInstallerAsync("repairs", "Repair verification"));
            }
            catch (Exception ex)
            {
                _status.Text = "Connector repair failed: " + ex.Message;
                _output.Text = ex.ToString();
            }
        }

        private async Task ConfigureConnectorCapabilitiesAsync()
        {
            var token = LoadDeviceToken();
            if (string.IsNullOrWhiteSpace(token))
            {
                _output.Text = "No linked device token.\r\nUse 'Link this device' first.";
                return;
            }

            using var form = new Form
            {
                Text = "Connector capabilities",
                StartPosition = FormStartPosition.CenterParent,
                Size = new Size(760, 610),
                FormBorderStyle = FormBorderStyle.FixedDialog,
                MaximizeBox = false,
                MinimizeBox = false,
                Font = new Font("Segoe UI", 10)
            };
            var intro = new Label
            {
                Text = "Choose optional high-risk capabilities to enable on this device.\nThey require a device-scoped installer and local Administrator approval.",
                Location = new Point(18, 18),
                Size = new Size(500, 52)
            };
            var powershell = new CheckBox
            {
                Text = "Admin PowerShell recovery (/ps)",
                Location = new Point(22, 84),
                Size = new Size(480, 28)
            };
            var windowsControl = new CheckBox
            {
                Text = "Windows app/process control (/win)",
                Location = new Point(22, 122),
                Size = new Size(480, 28)
            };
            var appLabel = new Label { Text = "Optional app executable grant", Location = new Point(22, 160), Size = new Size(690, 22) };
            var appAlias = new TextBox { PlaceholderText = "app alias e.g. photoshop", Location = new Point(22, 188), Size = new Size(180, 28) };
            var appPath = new TextBox { PlaceholderText = "C:\\Path\\To\\App.exe", Location = new Point(212, 188), Size = new Size(390, 28) };
            var browseApp = new Button { Text = "Browse", Location = new Point(614, 186), Size = new Size(90, 32) };
            browseApp.Click += (_, _) =>
            {
                using var dialog = new OpenFileDialog { Title = "Choose application executable", Filter = "Applications (*.exe;*.cmd;*.bat)|*.exe;*.cmd;*.bat|All files (*.*)|*.*" };
                if (dialog.ShowDialog(form) == DialogResult.OK)
                {
                    appPath.Text = dialog.FileName;
                    if (string.IsNullOrWhiteSpace(appAlias.Text)) appAlias.Text = SafeFileSegment(Path.GetFileNameWithoutExtension(dialog.FileName)).ToLowerInvariant();
                }
            };
            var discoverApps = new Button { Text = "Installed apps", Location = new Point(614, 222), Size = new Size(110, 32) };
            discoverApps.Click += (_, _) =>
            {
                var selected = PickInstalledApp(form);
                if (selected is null) return;
                appAlias.Text = SafeFileSegment(selected.DisplayName).ToLowerInvariant();
                appPath.Text = selected.ExecutablePath;
            };

            var folderLabel = new Label { Text = "Optional allowed folder/path grant", Location = new Point(22, 230), Size = new Size(690, 22) };
            var allowedPath = new TextBox { PlaceholderText = "Allowed folder for read/write/list operations", Location = new Point(22, 258), Size = new Size(580, 28) };
            var browseFolder = new Button { Text = "Browse", Location = new Point(614, 256), Size = new Size(90, 32) };
            browseFolder.Click += (_, _) =>
            {
                using var dialog = new FolderBrowserDialog { Description = "Choose an allowed folder for this connector" };
                if (dialog.ShowDialog(form) == DialogResult.OK) allowedPath.Text = dialog.SelectedPath;
            };

            var helperLabel = new Label { Text = "Optional helper command grant", Location = new Point(22, 300), Size = new Size(690, 22) };
            var helperAlias = new TextBox { PlaceholderText = "helper alias e.g. app_status", Location = new Point(22, 328), Size = new Size(180, 28) };
            var helperPath = new TextBox { PlaceholderText = "C:\\Path\\To\\Helper.exe or .cmd", Location = new Point(212, 328), Size = new Size(390, 28) };
            var browseHelper = new Button { Text = "Browse", Location = new Point(614, 326), Size = new Size(90, 32) };
            browseHelper.Click += (_, _) =>
            {
                using var dialog = new OpenFileDialog { Title = "Choose helper command", Filter = "Executables/scripts (*.exe;*.cmd;*.bat)|*.exe;*.cmd;*.bat|All files (*.*)|*.*" };
                if (dialog.ShowDialog(form) == DialogResult.OK)
                {
                    helperPath.Text = dialog.FileName;
                    if (string.IsNullOrWhiteSpace(helperAlias.Text)) helperAlias.Text = SafeFileSegment(Path.GetFileNameWithoutExtension(dialog.FileName)).ToLowerInvariant();
                }
            };

            var warning = new Label
            {
                Text = "These options are explicit local grants. They become connector allowlists only after this app downloads a short-lived installer and you approve UAC.",
                Location = new Point(22, 380),
                Size = new Size(690, 60),
                ForeColor = Color.DarkOrange
            };
            var ok = new Button { Text = "Create installer", DialogResult = DialogResult.OK, Location = new Point(488, 508), Size = new Size(130, 34) };
            var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, Location = new Point(626, 508), Size = new Size(82, 34) };
            form.Controls.AddRange(new Control[] { intro, powershell, windowsControl, appLabel, appAlias, appPath, browseApp, discoverApps, folderLabel, allowedPath, browseFolder, helperLabel, helperAlias, helperPath, browseHelper, warning, ok, cancel });
            form.AcceptButton = ok;
            form.CancelButton = cancel;

            if (form.ShowDialog(this) != DialogResult.OK) return;
            var requestedCapabilities = new List<string>();
            if (powershell.Checked) requestedCapabilities.Add("powershell_admin");
            if (windowsControl.Checked) requestedCapabilities.Add("windows_control");
            var selectedApps = new List<object>();
            if (!string.IsNullOrWhiteSpace(appPath.Text))
            {
                selectedApps.Add(new
                {
                    app_alias = string.IsNullOrWhiteSpace(appAlias.Text) ? SafeFileSegment(Path.GetFileNameWithoutExtension(appPath.Text)).ToLowerInvariant() : SafeFileSegment(appAlias.Text).ToLowerInvariant(),
                    display_name = string.IsNullOrWhiteSpace(appAlias.Text) ? Path.GetFileNameWithoutExtension(appPath.Text) : appAlias.Text.Trim(),
                    executable_path = appPath.Text.Trim(),
                    process_name = Path.GetFileNameWithoutExtension(appPath.Text),
                    browser = false,
                    capability_class = "desktop_app",
                    risk_class = "interactive"
                });
            }
            var selectedPaths = new List<string>();
            if (!string.IsNullOrWhiteSpace(allowedPath.Text)) selectedPaths.Add(allowedPath.Text.Trim());
            var selectedHelpers = new List<object>();
            if (!string.IsNullOrWhiteSpace(helperPath.Text))
            {
                selectedHelpers.Add(new
                {
                    alias = string.IsNullOrWhiteSpace(helperAlias.Text) ? SafeFileSegment(Path.GetFileNameWithoutExtension(helperPath.Text)).ToLowerInvariant() : SafeFileSegment(helperAlias.Text).ToLowerInvariant(),
                    command = helperPath.Text.Trim(),
                    args = Array.Empty<string>(),
                    allow_extra_args = false,
                    description = string.IsNullOrWhiteSpace(helperAlias.Text) ? Path.GetFileNameWithoutExtension(helperPath.Text) : helperAlias.Text.Trim()
                });
            }
            if (requestedCapabilities.Count == 0 && selectedApps.Count == 0 && selectedPaths.Count == 0 && selectedHelpers.Count == 0)
            {
                _status.Text = "No connector capability or permission changes selected.";
                return;
            }

            try
            {
                EnsureLocalFiles(_status);
                _progress.Value = 0;
                _status.Text = "Requesting capability installer from auth.mad4b.com…";
                using var client = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
                using var req = new HttpRequestMessage(HttpMethod.Post, DeviceRepairInstallerUrl)
                {
                    Content = JsonContent(new
                    {
                        format = "bat",
                        ttl_minutes = 30,
                        capabilities = requestedCapabilities,
                        permission_grants = new
                        {
                            apps = selectedApps,
                            allowed_paths = selectedPaths,
                            shell_aliases = selectedHelpers
                        }
                    })
                };
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                req.Headers.Accept.ParseAdd("application/json");
                using var response = await client.SendAsync(req);
                var text = await response.Content.ReadAsStringAsync();
                var link = JsonSerializer.Deserialize<DeviceInstallerLinkResponse>(text, _json);
                if (!response.IsSuccessStatusCode || link?.Ok != true || string.IsNullOrWhiteSpace(link.DownloadUrl))
                {
                    _status.Text = "Capability installer request failed: " + (link?.Error?.Message ?? response.ReasonPhrase ?? "unknown error");
                    _output.Text = text;
                    return;
                }

                _progress.Value = 25;
                var safeDeviceId = SafeFileSegment(link.CanonicalDeviceId ?? link.DeviceId ?? Environment.MachineName);
                var target = Path.Combine(UpdatesRoot, $"enable-connector-capabilities-{safeDeviceId}.bat");
                using (var installerResponse = await client.GetAsync(link.DownloadUrl, HttpCompletionOption.ResponseHeadersRead))
                {
                    installerResponse.EnsureSuccessStatusCode();
                    await using var source = await installerResponse.Content.ReadAsStreamAsync();
                    await using var destination = File.Create(target);
                    await source.CopyToAsync(destination);
                }
                var fileInfo = new FileInfo(target);
                if (!fileInfo.Exists || fileInfo.Length < 64) throw new InvalidOperationException("Downloaded capability installer file is missing or too small.");
                _progress.Value = 75;
                _output.Text = JsonSerializer.Serialize(new
                {
                    capability_installer_downloaded = true,
                    installer_path = target,
                    capabilities = requestedCapabilities,
                    app_grants = selectedApps.Count,
                    allowed_paths = selectedPaths,
                    helper_grants = selectedHelpers.Count,
                    canonical_device_id = link.CanonicalDeviceId,
                    run_as_admin_required = link.RunAsAdminRequired,
                    secrets_included = false
                }, _json);

                var result = MessageBox.Show(
                    "Capability installer downloaded. Run it as Administrator now?\n\nThis will update the local connector service configuration for the selected capabilities.",
                    "Connector capabilities",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning);
                if (result != DialogResult.Yes)
                {
                    _status.Text = $"Capability installer downloaded: {target}. Run as Administrator when ready.";
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
                _status.Text = "Capability installer launched with elevation request. Verify connector health after it finishes.";
            }
            catch (Exception ex)
            {
                _status.Text = "Capability installer failed: " + ex.Message;
                _output.Text = ex.ToString();
            }
        }

        private sealed record InstalledAppChoice(string DisplayName, string ExecutablePath)
        {
            public override string ToString() => $"{DisplayName} — {ExecutablePath}";
        }

        private static InstalledAppChoice? PickInstalledApp(IWin32Window owner)
        {
            var apps = DiscoverInstalledApps().OrderBy(app => app.DisplayName, StringComparer.OrdinalIgnoreCase).ToList();
            if (apps.Count == 0)
            {
                MessageBox.Show(owner, "No installed applications with executable paths were discovered. Use Browse instead.", "Installed apps", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return null;
            }

            using var form = new Form
            {
                Text = "Choose installed app",
                StartPosition = FormStartPosition.CenterParent,
                Size = new Size(760, 520),
                FormBorderStyle = FormBorderStyle.FixedDialog,
                MaximizeBox = false,
                MinimizeBox = false,
                Font = new Font("Segoe UI", 10)
            };
            var filter = new TextBox { PlaceholderText = "Search installed apps…", Location = new Point(16, 16), Size = new Size(710, 30) };
            var list = new ListBox { Location = new Point(16, 56), Size = new Size(710, 360), HorizontalScrollbar = true };
            var ok = new Button { Text = "Use selected", DialogResult = DialogResult.OK, Location = new Point(500, 430), Size = new Size(130, 34) };
            var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, Location = new Point(642, 430), Size = new Size(82, 34) };
            void RefreshList()
            {
                var q = filter.Text.Trim();
                list.Items.Clear();
                foreach (var app in apps.Where(app => string.IsNullOrWhiteSpace(q) || app.DisplayName.Contains(q, StringComparison.OrdinalIgnoreCase) || app.ExecutablePath.Contains(q, StringComparison.OrdinalIgnoreCase)).Take(300))
                {
                    list.Items.Add(app);
                }
                if (list.Items.Count > 0 && list.SelectedIndex < 0) list.SelectedIndex = 0;
            }
            filter.TextChanged += (_, _) => RefreshList();
            list.DoubleClick += (_, _) => { if (list.SelectedItem is not null) form.DialogResult = DialogResult.OK; };
            form.Controls.AddRange(new Control[] { filter, list, ok, cancel });
            form.AcceptButton = ok;
            form.CancelButton = cancel;
            RefreshList();
            return form.ShowDialog(owner) == DialogResult.OK ? list.SelectedItem as InstalledAppChoice : null;
        }

        private static IEnumerable<InstalledAppChoice> DiscoverInstalledApps()
        {
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var root in new[] { Registry.CurrentUser, Registry.LocalMachine })
            foreach (var subkeyPath in new[] { @"Software\Microsoft\Windows\CurrentVersion\Uninstall", @"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall" })
            {
                using var rootKey = root.OpenSubKey(subkeyPath);
                if (rootKey is null) continue;
                foreach (var name in rootKey.GetSubKeyNames())
                {
                    using var key = rootKey.OpenSubKey(name);
                    var displayName = Convert.ToString(key?.GetValue("DisplayName"))?.Trim();
                    if (string.IsNullOrWhiteSpace(displayName)) continue;
                    var exe = ResolveInstalledAppExecutable(
                        Convert.ToString(key?.GetValue("DisplayIcon")),
                        Convert.ToString(key?.GetValue("InstallLocation")),
                        Convert.ToString(key?.GetValue("UninstallString")));
                    if (string.IsNullOrWhiteSpace(exe) || !File.Exists(exe) || !seen.Add(exe)) continue;
                    yield return new InstalledAppChoice(displayName, exe);
                }
            }
        }

        private static string ResolveInstalledAppExecutable(string? displayIcon, string? installLocation, string? uninstallString)
        {
            foreach (var candidate in new[] { displayIcon, uninstallString })
            {
                var exe = ExtractExecutablePath(candidate);
                if (!string.IsNullOrWhiteSpace(exe) && File.Exists(exe)) return exe;
            }
            var folder = (installLocation ?? "").Trim().Trim('"');
            if (Directory.Exists(folder))
            {
                foreach (var exe in Directory.EnumerateFiles(folder, "*.exe", SearchOption.TopDirectoryOnly).OrderBy(path => Path.GetFileName(path).Length).Take(5))
                {
                    if (File.Exists(exe)) return exe;
                }
            }
            return "";
        }

        private static string ExtractExecutablePath(string? raw)
        {
            var value = (raw ?? "").Trim();
            if (string.IsNullOrWhiteSpace(value)) return "";
            if (value.StartsWith("\""))
            {
                var end = value.IndexOf('"', 1);
                if (end > 1) value = value.Substring(1, end - 1);
            }
            else
            {
                var exeIndex = value.IndexOf(".exe", StringComparison.OrdinalIgnoreCase);
                if (exeIndex >= 0) value = value.Substring(0, exeIndex + 4);
                else value = value.Split(',', ' ').FirstOrDefault() ?? "";
            }
            value = value.Trim().Trim('"');
            if (value.Contains(',')) value = value.Split(',')[0].Trim().Trim('"');
            return value.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? value : "";
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
                    "set \"N8N_LISTEN_ADDRESS=" + profile.ListenAddress + "\"", "set \"N8N_RUNNERS_BROKER_PORT=" + profile.TaskBrokerPort + "\"", "set \"N8N_RUNNERS_BROKER_LISTEN_ADDRESS=" + profile.TaskBrokerListenAddress + "\"", "set \"N8N_RUNNERS_TASK_BROKER_URI=" + profile.TaskBrokerUrl.TrimEnd('/') + "\"", "set \"N8N_RUNNERS_LAUNCHER_HEALTH_CHECK_PORT=" + profile.LauncherHealthCheckPort + "\"",
                    "set \"N8N_RUNNERS_BROKER_PORT=" + profile.TaskBrokerPort + "\"",
                    "set \"N8N_RUNNERS_BROKER_LISTEN_ADDRESS=" + profile.TaskBrokerListenAddress + "\"",
                    "set \"N8N_RUNNERS_TASK_BROKER_URI=" + profile.TaskBrokerUrl.TrimEnd('/') + "\"",
                    "set \"N8N_RUNNERS_LAUNCHER_HEALTH_CHECK_PORT=" + profile.LauncherHealthCheckPort + "\"",
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

        private void LaunchUpdaterAndRestart(string installerPath) { var helperPath = Path.Combine(UpdatesRoot, "run-local-manager-update.cmd"); var appPath = Application.ExecutablePath; var currentPid = Environment.ProcessId; var script = string.Join("\r\n", new[] { "@echo off", "setlocal", "set \"INSTALLER=" + installerPath + "\"", "set \"APP=" + appPath + "\"", "set \"PID=" + currentPid + "\"", "echo Updating Mad4B Local Manager...", "timeout /t 1 /nobreak >nul", "taskkill /PID %PID% /T /F >nul 2>nul", "for /l %%i in (1,1,30) do ( tasklist /fi \"PID eq %PID%\" | find \"%PID%\" >nul || goto app_stopped & timeout /t 1 /nobreak >nul )", ":app_stopped", "copy /y \"%INSTALLER%\" \"%APP%\" >nul", "if errorlevel 1 ( echo ERROR: Could not replace Local Manager executable. & pause & exit /b 1 )", "start \"\" \"%APP%\"", "exit /b 0" }) + "\r\n"; File.WriteAllText(helperPath, script, Encoding.ASCII); Process.Start(new ProcessStartInfo { FileName = "cmd.exe", Arguments = "/c \"" + helperPath + "\"", WorkingDirectory = UpdatesRoot, UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden }); BeginInvoke(new Action(Close)); }
        private void ShowTopMostMessage(string title, string message) { var previousTopMost = TopMost; try { if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal; Show(); Activate(); TopMost = true; MessageBox.Show(this, message, title, MessageBoxButtons.OK, MessageBoxIcon.Information); } finally { TopMost = previousTopMost; } }
        private void StartDesktopCommandPolling() { if (_desktopCommandTimer.Enabled) return; _desktopCommandTimer.Tick += async (_, _) => await PollDesktopCommandsAsync(); _desktopCommandTimer.Start(); _ = PollDesktopCommandsAsync(); }
        private async Task PollDesktopCommandsAsync()
        {
            if (_desktopCommandPollRunning) return;
            if (DateTimeOffset.UtcNow < _desktopCommandPollBackoffUntil) return;
            var token = LoadDeviceToken(false);
            if (string.IsNullOrWhiteSpace(token)) return;
            _desktopCommandPollRunning = true;
            try
            {
                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
                using var req = new HttpRequestMessage(HttpMethod.Get, DesktopCommandsUrl + "/pending?limit=5");
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                req.Headers.Accept.ParseAdd("application/json");
                using var response = await client.SendAsync(req);
                var text = await response.Content.ReadAsStringAsync();
                if (!response.IsSuccessStatusCode)
                {
                    if (response.StatusCode != System.Net.HttpStatusCode.Unauthorized && response.StatusCode != System.Net.HttpStatusCode.Forbidden)
                    {
                        RegisterDesktopCommandPollFailure("HTTP " + (int)response.StatusCode + " " + response.StatusCode, text);
                    }
                    return;
                }
                _desktopCommandPollFailureCount = 0;
                _desktopCommandPollBackoffUntil = DateTimeOffset.MinValue;
                using var doc = JsonDocument.Parse(text);
                if (!doc.RootElement.TryGetProperty("commands", out var commands) || commands.ValueKind != JsonValueKind.Array) return;
                foreach (var command in commands.EnumerateArray()) await ExecuteDesktopCommandAsync(client, token, command);
            }
            catch (Exception ex)
            {
                RegisterDesktopCommandPollFailure(ex.Message, ex.GetBaseException().Message);
            }
            finally
            {
                _desktopCommandPollRunning = false;
            }
        }
        private void RegisterDesktopCommandPollFailure(string message, string? diagnostic = null)
        {
            _desktopCommandPollFailureCount += 1;
            var backoffSeconds = Math.Min(300, _desktopCommandPollFailureCount switch
            {
                <= 1 => 15,
                2 => 30,
                3 => 60,
                _ => 120
            });
            _desktopCommandPollBackoffUntil = DateTimeOffset.UtcNow.AddSeconds(backoffSeconds);

            // Desktop command polling is a background convenience path. Do not keep
            // overwriting the main status every timer tick for transient TLS/network
            // failures; show only the first and periodic failures, and write a
            // sanitized diagnostic payload with no token or command payload secrets.
            if (_desktopCommandPollFailureCount == 1 || _desktopCommandPollFailureCount % 5 == 0)
            {
                _status.Text = $"Desktop command polling paused for {backoffSeconds}s: {message}";
                _output.Text = JsonSerializer.Serialize(new
                {
                    desktop_command_polling = "paused",
                    failure_count = _desktopCommandPollFailureCount,
                    backoff_seconds = backoffSeconds,
                    message,
                    diagnostic,
                    token_plaintext_shown = false,
                    secrets_included = false
                }, _json);
            }
        }

        private async Task ExecuteDesktopCommandAsync(HttpClient client, string token, JsonElement command)
        {
            var commandId = JsonValue(command, "command_id");
            var action = JsonValue(command, "action");
            command.TryGetProperty("payload", out var payload);
            try
            {
                if (string.Equals(action, "open_url", StringComparison.OrdinalIgnoreCase))
                {
                    var url = JsonValue(payload, "url");
                    if (string.IsNullOrWhiteSpace(url)) throw new InvalidOperationException("open_url command is missing url.");
                    OpenUrl(url);
                    _status.Text = "Desktop command opened URL.";
                    await CompleteDesktopCommandAsync(client, token, commandId, true, new { action, opened_url = url, handled_by = "local_manager_windows", visible_desktop = true, secrets_included = false });
                    return;
                }
                if (string.Equals(action, "open_n8n", StringComparison.OrdinalIgnoreCase))
                {
                    var profile = await LoadN8nProfileAsync();
                    var url = string.IsNullOrWhiteSpace(profile.PublicUrl) ? profile.LocalUrl : profile.PublicUrl;
                    OpenUrl(url);
                    _status.Text = "Desktop command opened n8n.";
                    await CompleteDesktopCommandAsync(client, token, commandId, true, new { action, opened_url = url, system_id = profile.SystemId, handled_by = "local_manager_windows", visible_desktop = true, secrets_included = false });
                    return;
                }
                if (string.Equals(action, "notify", StringComparison.OrdinalIgnoreCase))
                {
                    var title = JsonValue(payload, "title", "Mad4B");
                    var message = JsonValue(payload, "message", "");
                    ShowTopMostMessage(title, message);
                    await CompleteDesktopCommandAsync(client, token, commandId, true, new { action, shown = true, handled_by = "local_manager_windows", visible_desktop = true, secrets_included = false });
                    return;
                }
                if (string.Equals(action, "focus_local_manager", StringComparison.OrdinalIgnoreCase))
                {
                    if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
                    Show();
                    Activate();
                    await CompleteDesktopCommandAsync(client, token, commandId, true, new { action, focused = true, handled_by = "local_manager_windows", visible_desktop = true, secrets_included = false });
                    return;
                }
                if (string.Equals(action, "codex_exec_readonly", StringComparison.OrdinalIgnoreCase))
                {
                    await ExecuteCodexReadOnlyCommandAsync(client, token, commandId, payload);
                    return;
                }
                throw new NotSupportedException("Unsupported desktop action: " + action);
            }
            catch (Exception ex)
            {
                await CompleteDesktopCommandAsync(client, token, commandId, false, new { action, handled_by = "local_manager_windows", visible_desktop = true, secrets_included = false }, "desktop_action_failed", ex.Message);
            }
        }

        private async Task ExecuteCodexReadOnlyCommandAsync(HttpClient client, string token, string commandId, JsonElement payload)
        {
            var action = "codex_exec_readonly";
            var commandPath = JsonValue(payload, "command_path", Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "npm", "codex.cmd"));
            var workingDirectory = JsonValue(payload, "working_directory", @"D:\mad4b-agent-workspaces\growth-intelligence-os-readonly");
            var prompt = JsonValue(payload, "prompt");
            var sandbox = JsonValue(payload, "sandbox", "read-only");
            var timeoutSeconds = Math.Clamp(JsonInt(payload, "timeout_seconds", 300), 30, 1800);
            var outputMaxChars = Math.Clamp(JsonInt(payload, "output_max_chars", 5000), 500, 20000);

            if (string.IsNullOrWhiteSpace(prompt)) throw new InvalidOperationException("codex_exec_readonly is missing prompt.");
            if (!string.Equals(sandbox, "read-only", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("codex_exec_readonly requires sandbox=read-only.");
            if (!File.Exists(commandPath)) throw new FileNotFoundException("Codex command was not found.", commandPath);
            if (!Directory.Exists(workingDirectory)) throw new DirectoryNotFoundException("Codex working directory was not found: " + workingDirectory);

            Directory.CreateDirectory(Path.Combine(InstallRoot, "codex-runs"));
            var stamp = DateTimeOffset.UtcNow.ToString("yyyyMMdd-HHmmss");
            var outputPath = Path.Combine(InstallRoot, "codex-runs", $"codex-readonly-output-{stamp}.txt");
            var lastMessagePath = Path.Combine(InstallRoot, "codex-runs", $"codex-readonly-last-message-{stamp}.txt");
            var startedAt = DateTimeOffset.UtcNow;
            _status.Text = "Running Codex read-only analysis…";

            using var process = new Process();
            process.StartInfo.FileName = commandPath;
            process.StartInfo.WorkingDirectory = workingDirectory;
            process.StartInfo.UseShellExecute = false;
            process.StartInfo.CreateNoWindow = true;
            process.StartInfo.RedirectStandardOutput = true;
            process.StartInfo.RedirectStandardError = true;
            process.StartInfo.ArgumentList.Add("exec");
            process.StartInfo.ArgumentList.Add("--cd");
            process.StartInfo.ArgumentList.Add(workingDirectory);
            process.StartInfo.ArgumentList.Add("--sandbox");
            process.StartInfo.ArgumentList.Add("read-only");
            process.StartInfo.ArgumentList.Add("--color");
            process.StartInfo.ArgumentList.Add("never");
            process.StartInfo.ArgumentList.Add("--ephemeral");
            process.StartInfo.ArgumentList.Add("-o");
            process.StartInfo.ArgumentList.Add(lastMessagePath);
            process.StartInfo.ArgumentList.Add(prompt);

            process.Start();
            var stdoutTask = process.StandardOutput.ReadToEndAsync();
            var stderrTask = process.StandardError.ReadToEndAsync();
            var completed = await Task.WhenAny(process.WaitForExitAsync(), Task.Delay(TimeSpan.FromSeconds(timeoutSeconds))) != null && process.HasExited;
            if (!completed)
            {
                try { process.Kill(true); } catch { }
            }
            var stdout = await stdoutTask;
            var stderr = await stderrTask;
            File.WriteAllText(outputPath, stdout + Environment.NewLine + stderr, Encoding.UTF8);
            var lastMessage = File.Exists(lastMessagePath) ? await File.ReadAllTextAsync(lastMessagePath, Encoding.UTF8) : "";
            var exitCode = completed ? process.ExitCode : -1;
            var ok = completed && exitCode == 0;
            var durationMs = (long)(DateTimeOffset.UtcNow - startedAt).TotalMilliseconds;
            var safeStdout = TailText(RedactLocalCommandOutput(stdout), outputMaxChars);
            var safeStderr = TailText(RedactLocalCommandOutput(stderr), Math.Min(outputMaxChars, 5000));
            var safeLastMessage = TailText(RedactLocalCommandOutput(lastMessage), outputMaxChars);
            _status.Text = ok ? "Codex read-only analysis completed." : "Codex read-only analysis failed.";
            _output.Text = JsonSerializer.Serialize(new { ok, exit_code = exitCode, duration_ms = durationMs, output_path = outputPath, last_message_path = lastMessagePath, secrets_included = false }, _json);
            await CompleteDesktopCommandAsync(client, token, commandId, ok, new
            {
                action,
                handled_by = "local_manager_windows",
                visible_desktop = true,
                command_path = commandPath,
                working_directory = workingDirectory,
                sandbox = "read-only",
                ephemeral = true,
                exit_code = exitCode,
                timed_out = !completed,
                duration_ms = durationMs,
                output_path = outputPath,
                last_message_path = lastMessagePath,
                stdout_tail = safeStdout,
                stderr_tail = safeStderr,
                last_message = safeLastMessage,
                auto_mutate_repo = false,
                secrets_included = false
            }, ok ? null : "codex_exec_readonly_failed", ok ? null : (completed ? "Codex exited with code " + exitCode : "Codex timed out."));
        }

        private async Task CompleteDesktopCommandAsync(HttpClient client, string token, string commandId, bool ok, object result, string? errorCode = null, string? errorMessage = null) { if (string.IsNullOrWhiteSpace(commandId)) return; using var req = new HttpRequestMessage(HttpMethod.Post, DesktopCommandsUrl + "/" + Uri.EscapeDataString(commandId) + "/complete") { Content = JsonContent(new { status = ok ? "completed" : "failed", result, error_code = errorCode, error_message = errorMessage }) }; req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token); req.Headers.Accept.ParseAdd("application/json"); using var response = await client.SendAsync(req); }
        private static string JsonValue(JsonElement element, string name, string fallback = "") { if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var value) || value.ValueKind == JsonValueKind.Null) return fallback; var text = value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString(); return string.IsNullOrWhiteSpace(text) ? fallback : text!; }
        private static int JsonInt(JsonElement element, string name, int fallback) { if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var value)) return fallback; return value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number) ? number : (int.TryParse(value.ToString(), out var parsed) ? parsed : fallback); }
        private static string RedactLocalCommandOutput(string value) => Regex.Replace(value ?? "", @"(?i)(access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|secret|authorization|bearer|password)\s*[:=]\s*\S+", "$1=[redacted]");
        private static string TailText(string value, int maxChars) { var text = value ?? ""; if (text.Length <= maxChars) return text; return "...[truncated]\n" + text.Substring(text.Length - maxChars); }
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
        public string LocalUrl { get; init; } = "http://127.0.0.1:5682/";
        public string PublicUrl { get; init; } = N8nPublicUrl;
        public int Port { get; init; } = 5682;
        public string ListenAddress { get; init; } = "127.0.0.1";
        public int TaskBrokerPort { get; init; } = 5683; public string TaskBrokerUrl { get; init; } = "http://127.0.0.1:5683/"; public string TaskBrokerListenAddress { get; init; } = "127.0.0.1"; public int LauncherHealthCheckPort { get; init; } = 5684; public string EditorBaseUrl { get; init; } = "http://127.0.0.1:5682/";
        public string WebhookUrl { get; init; } = "http://127.0.0.1:5682/";

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
                ListenAddress = GetString(profile, "listen_address", fallback.ListenAddress), TaskBrokerPort = GetInt(profile, "task_broker_port", fallback.TaskBrokerPort), TaskBrokerUrl = GetString(profile, "task_broker_url", fallback.TaskBrokerUrl), TaskBrokerListenAddress = GetString(profile, "task_broker_listen_address", fallback.TaskBrokerListenAddress), LauncherHealthCheckPort = GetInt(profile, "launcher_health_check_port", fallback.LauncherHealthCheckPort),
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
