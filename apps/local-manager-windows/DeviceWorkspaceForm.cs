using System.Drawing;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;

namespace Mad4B.LocalManager.Windows;

/// <summary>
/// Local-only, explicitly unlocked Device Workspace. Connector credentials and
/// approval fields remain in this form's memory; they are never persisted.
/// This UI never routes through Production or uses the linked-device OAuth token
/// as an Admin Connector credential.
/// </summary>
internal sealed class DeviceWorkspaceForm : Form
{
    private static readonly Uri ConnectorOrigin = new("http://127.0.0.1:7070/");
    private readonly HttpClient _client = new() { BaseAddress = ConnectorOrigin, Timeout = TimeSpan.FromSeconds(30) };
    private readonly TextBox _deviceId = Field(235);
    private readonly TextBox _connectorSecret = Field(220, secret: true);
    private readonly TextBox _terminalApproval = Field(180, secret: true);
    private readonly TextBox _fileApproval = Field(180, secret: true);
    private readonly TextBox _mcpApproval = Field(180, secret: true);
    private readonly TextBox _tenantId = Field(160);
    private readonly TextBox _oauthSubject = Field(160);
    private readonly TextBox _oauthClient = Field(160);
    private readonly TextBox _mcpArguments = Field(500);
    private readonly ComboBox _mcpTool = new() { Width = 230, DropDownStyle = ComboBoxStyle.DropDownList };
    private readonly Label _status = new()
    {
        AutoSize = true, ForeColor = Color.FromArgb(30, 70, 100),
        Text = "Local connector only. Enter credentials for this Windows session; nothing is saved."
    };
    private readonly TabControl _tabs = new() { Dock = DockStyle.Fill };
    private readonly Dictionary<TabPage, TextBox> _outputs = new();
    private readonly TextBox _filePath = Field(250);
    private readonly TextBox _targetPath = Field(250);
    private readonly TextBox _fileContent = Field(350);
    private readonly TextBox _search = Field(200);
    private readonly TextBox _expectedSha = Field(500);
    private readonly TextBox _replaceOld = Field(220);
    private readonly TextBox _replaceNew = Field(220);
    private readonly TextBox _transaction = Field(280);
    private readonly ComboBox _profile = new() { Width = 165, DropDownStyle = ComboBoxStyle.DropDownList };
    private readonly TextBox _session = Field(300);
    private readonly TextBox _processSession = Field(300);
    private readonly TextBox _terminalInput = Field(500);
    private readonly TextBox _cursor = Field(100);
    private bool _busy;

    internal DeviceWorkspaceForm()
    {
        Text = "MAD4B Device Workspace — Local Connector";
        MinimumSize = new Size(1000, 760);
        Size = new Size(1120, 860);
        Font = new Font("Segoe UI", 9);
        StartPosition = FormStartPosition.CenterParent;
        _filePath.Text = ".";
        _cursor.Text = "0";
        _profile.Items.AddRange(new object[] { "git_status", "git_log", "node_repl",
            "python_repl", "powershell", "cmd" });
        _profile.SelectedIndex = 0;
        _mcpTool.Items.AddRange(new object[] { "files_create_directory", "files_create_file",
            "files_copy", "files_move", "files_patch", "files_rollback",
            "terminal_start_interactive", "terminal_input" });
        _mcpTool.SelectedIndex = 0;
        _mcpArguments.Text = "{\\\"relative_path\\\":\\\"src/new-folder\\\"}";

        var header = new FlowLayoutPanel
        {
            Dock = DockStyle.Top, Height = 113, Padding = new Padding(10),
            BackColor = Color.FromArgb(241, 246, 250), AutoScroll = true,
            WrapContents = true
        };
        AddField(header, "Device ID", _deviceId);
        AddField(header, "Connector secret", _connectorSecret);
        AddField(header, "Terminal approval", _terminalApproval);
        AddField(header, "File write approval", _fileApproval);
        header.Controls.Add(ActionButton("Verify connection", async () =>
            await SendAsync("/recovery/capabilities", null, "GET")));
        header.Controls.Add(_status);

        AddTab("Devices", panel =>
        {
            panel.Controls.Add(ActionButton("Connector capabilities", async () =>
                await SendAsync("/recovery/capabilities", null, "GET")));
            panel.Controls.Add(new Label
            {
                Text = "Read active device and tool capability state. All changes require explicit local approval.",
                AutoSize = true, Padding = new Padding(8, 12, 8, 0)
            });
        });
        AddTab("Files & Search", panel =>
        {
            AddField(panel, "Project-relative path", _filePath);
            panel.Controls.Add(ActionButton("List", async () => await FilesAsync("list")));
            panel.Controls.Add(ActionButton("Read", async () => await FilesAsync("read")));
            panel.Controls.Add(ActionButton("SHA / Info", async () => await FilesAsync("info")));
            panel.Controls.Add(ActionButton("Stat", async () => await FilesAsync("stat")));
            panel.Controls.Add(ActionButton("Read multiple (comma-separated)", async () => await FilesAsync("read_many")));
            panel.Controls.Add(ActionButton("Create directory", async () => await FilesAsync("create_directory")));
            AddField(panel, "New text file content", _fileContent);
            panel.Controls.Add(ActionButton("Create text file", async () => await FilesAsync("create_file")));
            AddField(panel, "Copy / move destination", _targetPath);
            panel.Controls.Add(ActionButton("Copy (exclusive)", async () => await FilesAsync("copy")));
            panel.Controls.Add(ActionButton("Move (same-volume)", async () => await FilesAsync("move")));
            AddField(panel, "Search text", _search);
            panel.Controls.Add(ActionButton("Search content", async () => await FilesAsync("search")));
            AddField(panel, "Current SHA-256", _expectedSha);
            AddField(panel, "Replace text", _replaceOld);
            AddField(panel, "With text", _replaceNew);
            panel.Controls.Add(ActionButton("Atomic patch", async () => await FilesAsync("patch")));
            AddField(panel, "Transaction ID", _transaction);
            panel.Controls.Add(ActionButton("Rollback", async () => await FilesAsync("rollback")));
        });
        AddTab("MCP Local Consent", panel =>
        {
            panel.Controls.Add(new Label
            {
                AutoSize = true, Padding = new Padding(8, 12, 8, 0),
                Text = "Approve exactly one operation for an OAuth subject/client. " +
                    "Consent is local, single-use, expires in 90 seconds, and never sends the approval secret to AI."
            });
            AddField(panel, "MCP local approval secret", _mcpApproval);
            AddField(panel, "OAuth tenant ID", _tenantId);
            AddField(panel, "OAuth subject (sub)", _oauthSubject);
            AddField(panel, "OAuth client (azp)", _oauthClient);
            AddField(panel, "Tool", _mcpTool);
            AddField(panel, "Exact JSON arguments", _mcpArguments);
            panel.Controls.Add(ActionButton("Approve exact operation once", ApproveMcpAsync));
        });
        AddTab("Terminal & Sessions", panel =>
        {
            AddField(panel, "Profile", _profile);
            panel.Controls.Add(ActionButton("Start", async () => await TerminalAsync("start")));
            panel.Controls.Add(ActionButton("List sessions", async () => await TerminalAsync("list")));
            AddField(panel, "Session ID", _session);
            AddField(panel, "Output cursor", _cursor);
            panel.Controls.Add(ActionButton("Output", async () => await TerminalAsync("output")));
            panel.Controls.Add(ActionButton("Resume transcript", async () => await TerminalAsync("resume")));
            AddField(panel, "STDIN", _terminalInput);
            panel.Controls.Add(ActionButton("Send input", async () => await TerminalAsync("input")));
            panel.Controls.Add(ActionButton("Cancel owned session", async () => await TerminalAsync("cancel")));
            panel.Controls.Add(ActionButton("Close finished", async () => await TerminalAsync("close")));
        });
        AddTab("Owned Processes", panel =>
        {
            panel.Controls.Add(ActionButton("List owned processes", async () => await TerminalAsync("process_list")));
            AddField(panel, "Owned session ID", _processSession);
            panel.Controls.Add(ActionButton("Status", async () => await TerminalAsync("process_status")));
            panel.Controls.Add(ActionButton("Terminate owned process", async () =>
            {
                if (MessageBox.Show(this, "Terminate the process started by this session?",
                    "Confirm session cancellation", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return;
                await TerminalAsync("process_terminate");
            }));
        });

        Controls.Add(_tabs);
        Controls.Add(header);
        FormClosed += (_, _) =>
        {
            _connectorSecret.Clear();
            _terminalApproval.Clear();
            _fileApproval.Clear();
            _mcpApproval.Clear();
            _tenantId.Clear();
            _oauthSubject.Clear();
            _oauthClient.Clear();
            _mcpArguments.Clear();
            _terminalInput.Clear();
            _client.Dispose();
        };
    }

    private static TextBox Field(int width, bool secret = false) => new()
    {
        Width = width, UseSystemPasswordChar = secret,
        Margin = new Padding(4), MaxLength = secret ? 1024 : 8192
    };

    private static void AddField(FlowLayoutPanel panel, string title, Control control)
    {
        var group = new FlowLayoutPanel
        {
            AutoSize = true, FlowDirection = FlowDirection.LeftToRight,
            WrapContents = false, Margin = new Padding(5, 4, 8, 4)
        };
        group.Controls.Add(new Label
        {
            Text = title, AutoSize = true, TextAlign = ContentAlignment.MiddleLeft,
            Padding = new Padding(0, 6, 3, 0)
        });
        group.Controls.Add(control);
        panel.Controls.Add(group);
    }

    private static Button ActionButton(string title, Func<Task> run)
    {
        var button = new Button
        {
            Text = title, AutoSize = true, Height = 34,
            Margin = new Padding(4), UseVisualStyleBackColor = true
        };
        button.Click += async (_, _) => await run();
        return button;
    }

    private void AddTab(string title, Action<FlowLayoutPanel> configure)
    {
        var tab = new TabPage(title) { Padding = new Padding(8) };
        var inputs = new FlowLayoutPanel
        {
            Dock = DockStyle.Top, AutoSize = true, MaximumSize = new Size(0, 280),
            AutoScroll = true, WrapContents = true
        };
        configure(inputs);
        var response = new TextBox
        {
            Multiline = true, Dock = DockStyle.Fill, ReadOnly = true,
            ScrollBars = ScrollBars.Both, WordWrap = false,
            Font = new Font("Consolas", 9),
            Text = "No operation yet. Interactive actions are disabled unless the device allows them."
        };
        tab.Controls.Add(response);
        tab.Controls.Add(inputs);
        _outputs[tab] = response;
        _tabs.TabPages.Add(tab);
    }

    private async Task FilesAsync(string action)
    {
        var payload = new Dictionary<string, object?>
        {
            ["device_id"] = _deviceId.Text.Trim(),
            ["action"] = action, ["relative_path"] = _filePath.Text.Trim()
        };
        if (action == "read_many")
            payload["paths"] = _filePath.Text.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (action == "create_file") payload["content"] = _fileContent.Text;
        if (action is "copy" or "move")
        {
            payload["target_path"] = _targetPath.Text.Trim();
            payload["expected_sha256"] = _expectedSha.Text.Trim();
        }
        if (action == "search")
        {
            payload["query"] = _search.Text;
            payload["mode"] = "content";
        }
        if (action == "patch")
        {
            payload["expected_sha256"] = _expectedSha.Text.Trim();
            payload["old_text"] = _replaceOld.Text;
            payload["new_text"] = _replaceNew.Text;
        }
        if (action == "rollback") payload["transaction_id"] = _transaction.Text.Trim();
        await SendAsync("/device/files", payload, "POST", action is "patch" or "rollback" or "create_file" or "create_directory" or "copy" or "move" ? "files" : null);
    }

    private async Task TerminalAsync(string action)
    {
        var payload = new Dictionary<string, object?>
        {
            ["device_id"] = _deviceId.Text.Trim(), ["action"] = action
        };
        if (action == "start") payload["profile"] = _profile.SelectedItem?.ToString();
        if (action is "input" or "output" or "resume" or "status" or "cancel" or
            "close" or "process_status" or "process_terminate")
        {
            payload["session_id"] = action.StartsWith("process_", StringComparison.Ordinal) ? _processSession.Text.Trim() : _session.Text.Trim();
            if (int.TryParse(_cursor.Text, out var cursor) && cursor >= 0) payload["cursor"] = cursor;
        }
        if (action == "input") payload["input"] = _terminalInput.Text + Environment.NewLine;
        // Always submit terminal approval only from this local, masked input,
        // not from AI-generated JSON or a remote MCP bearer.
        await SendAsync("/device/terminal", payload, "POST",
            action is "start" or "input" ? "terminal" : null);
        if (action == "input") _terminalInput.Clear();
    }

    private async Task ApproveMcpAsync()
    {
        if (_mcpTool.SelectedItem is not string tool ||
            string.IsNullOrWhiteSpace(_oauthSubject.Text) ||
            string.IsNullOrWhiteSpace(_oauthClient.Text))
        {
            _status.Text = "Tool, OAuth subject and OAuth client are required.";
            return;
        }
        JsonElement args;
        try
        {
            using var document = JsonDocument.Parse(_mcpArguments.Text);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
                throw new JsonException("Arguments must be an object");
            args = document.RootElement.Clone();
        }
        catch (JsonException)
        {
            _status.Text = "Provide an exact JSON object for MCP tool arguments.";
            return;
        }
        var actionSummary = $"Device: {_deviceId.Text.Trim()}\\n" +
            $"OAuth subject: {_oauthSubject.Text.Trim()}\\n" +
            $"Client: {_oauthClient.Text.Trim()}\\nTool: {tool}\\n" +
            $"Arguments: {_mcpArguments.Text}\\n\\nAuthorize this exact operation ONCE?";
        if (MessageBox.Show(this, actionSummary, "MAD4B exact local MCP consent",
            MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return;
        var payload = new Dictionary<string, object?>
        {
            ["action"] = "issue", ["device_id"] = _deviceId.Text.Trim(),
            ["tenant_id"] = _tenantId.Text.Trim(),
            ["subject"] = _oauthSubject.Text.Trim(),
            ["client_id"] = _oauthClient.Text.Trim(),
            ["tool"] = tool, ["arguments"] = args
        };

        await SendAsync("/device/mcp/approvals", payload, "POST", "mcp");
    }

    private async Task SendAsync(
        string endpoint, Dictionary<string, object?>? payload, string method,
        string? approvalType = null)
    {
        if (_busy) return;
        if (string.IsNullOrWhiteSpace(_connectorSecret.Text) ||
            string.IsNullOrWhiteSpace(_deviceId.Text))
        {
            _status.Text = "Exact device ID and local Connector secret are required.";
            return;
        }
        _busy = true;
        try
        {
            using var request = new HttpRequestMessage(
                method == "GET" ? HttpMethod.Get : HttpMethod.Post, endpoint);
            request.Headers.TryAddWithoutValidation("x-connector-secret", _connectorSecret.Text.Trim());
            request.Headers.Accept.ParseAdd("application/json");
            if (approvalType == "terminal" && !string.IsNullOrWhiteSpace(_terminalApproval.Text))
                request.Headers.TryAddWithoutValidation("x-mad4b-device-terminal-approval", _terminalApproval.Text);
            if (approvalType == "mcp" && !string.IsNullOrWhiteSpace(_mcpApproval.Text))
                request.Headers.TryAddWithoutValidation("x-mad4b-device-mcp-approval", _mcpApproval.Text);
            if (approvalType == "files" && !string.IsNullOrWhiteSpace(_fileApproval.Text))
                request.Headers.TryAddWithoutValidation("x-mad4b-device-write-approval", _fileApproval.Text);
            if (payload is not null)
                request.Content = new StringContent(JsonSerializer.Serialize(payload),
                    Encoding.UTF8, "application/json");
            using var response = await _client.SendAsync(request);
            var raw = await response.Content.ReadAsStringAsync();
            if (raw.Length > 65536) raw = raw[..65536] + "\n[response truncated for display]";
            var display = raw;
            try
            {
                using var parsed = JsonDocument.Parse(raw);
                display = JsonSerializer.Serialize(parsed.RootElement,
                    new JsonSerializerOptions { WriteIndented = true });
                if (parsed.RootElement.TryGetProperty("session_id", out var sessionId) &&
                    sessionId.ValueKind == JsonValueKind.String)
                    { _session.Text = sessionId.GetString() ?? ""; _processSession.Text = _session.Text; }
                if (parsed.RootElement.TryGetProperty("next_cursor", out var cursor) &&
                    cursor.ValueKind == JsonValueKind.Number)
                    _cursor.Text = cursor.GetInt32().ToString();
                if (parsed.RootElement.TryGetProperty("transaction_id", out var transactionId) &&
                    transactionId.ValueKind == JsonValueKind.String)
                    _transaction.Text = transactionId.GetString() ?? "";
                if (parsed.RootElement.TryGetProperty("sha256", out var sha) &&
                    sha.ValueKind == JsonValueKind.String)
                    _expectedSha.Text = sha.GetString() ?? "";
            }
            catch (JsonException) { /* bounded raw response remains displayable */ }
            _outputs[_tabs.SelectedTab!].Text = display;
            _status.Text = $"{endpoint}: HTTP {(int)response.StatusCode} — " +
                (response.IsSuccessStatusCode ? "completed" : "rejected");
        }
        catch (Exception ex)
        {
            _status.Text = "Local connector unavailable: " + ex.GetType().Name;
        }
        finally { _busy = false; }
    }
}
