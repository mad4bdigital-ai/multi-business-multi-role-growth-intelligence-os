import { Router } from "express";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../db.js";
import {
  connectorAuthPredicateForToken,
  connectorLocalApiKeySelectFragment,
} from "../connectorSchemaCompatibility.js";

const AGENT_VERSION = "2026.05.28.1";
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(MODULE_DIR, "../..");
const CONNECTOR_PORT = 7070;

const FILES = {
  "server.mjs": {
    relativePath: "local-connector/server.mjs",
    contentType: "text/javascript; charset=utf-8",
    executable: false,
  },
  "connector-watchdog.ps1": {
    relativePath: "local-connector/connector-watchdog.ps1",
    contentType: "text/plain; charset=utf-8",
    executable: false,
  },
  "connector-safe-upgrade.ps1": {
    relativePath: "local-connector/connector-safe-upgrade.ps1",
    contentType: "text/plain; charset=utf-8",
    executable: false,
  },
  "db-restore-certifier.mjs": {
    relativePath: "local-connector/db-restore-certifier.mjs",
    contentType: "text/javascript; charset=utf-8",
    executable: false,
  },
  "n8n-restore-certifier.mjs": {
    relativePath: "local-connector/n8n-restore-certifier.mjs",
    contentType: "text/javascript; charset=utf-8",
    executable: false,
  },
  "browser4-adapter.mjs": {
    relativePath: "local-connector/browser4-adapter.mjs",
    contentType: "text/javascript; charset=utf-8",
    executable: false,
  },
  "local-agent-runtime.mjs": {
    relativePath: "local-connector/local-agent-runtime.mjs",
    contentType: "text/javascript; charset=utf-8",
    executable: false,
  },
};

const LOCAL_TOOL_RELEASES = [
  {
    tool_key: "browser4",
    display_name: "Browser4 Local Adapter",
    owner_app: "mad4b-local-manager",
    install_kind: "connector_agent_manifest",
    status: "active",
    platform: "windows",
    files: ["browser4-adapter.mjs", "server.mjs"],
    env: {
      CONNECTOR_BROWSER4_ENABLED: "true",
      BROWSER4_ALLOWED_HOSTS: "mad4b.com,n8n.mad4b.com",
      BROWSER4_WORK_DIR: "D:\\n8n-data\\browser-runtime-artifacts",
      BROWSER4_JAVA_HOME: "D:\\n8n-data\\browser-runtime\\jre17\\jdk-17.0.19+10-jre",
      BROWSER4_SERVER_URL: "http://localhost:8182",
    },
    install_policy: {
      allowlisted_domains_only: true,
      no_raw_shell_surface: true,
      no_secret_return: true,
      governed_runtime_binding_required: true,
    },
  },
  {
    tool_key: "auto_browser",
    display_name: "Auto Browser Visual Takeover Candidate",
    owner_app: "mad4b-local-manager",
    install_kind: "external_provider_manifest_candidate",
    status: "candidate_pending_install_plan",
    platform: "windows",
    files: ["server.mjs"],
    source_url: "https://github.com/LvcidPsyche/auto-browser",
    env: {
      CONNECTOR_AUTO_BROWSER_ENABLED: "false",
      AUTO_BROWSER_BASE_URL: "http://127.0.0.1:8000",
      AUTO_BROWSER_HEALTH_PATH: "/healthz",
      AUTO_BROWSER_ALLOWED_HOSTS: "mad4b.com,n8n.mad4b.com",
    },
    install_policy: {
      allowlisted_domains_only: true,
      no_raw_shell_surface: true,
      no_secret_return: true,
      governed_runtime_binding_required: true,
      explicit_user_approval_required: true,
      adapter_poc_required_before_activation: true,
    },
  },
];

const DEFAULT_WINDOWS_ALIASES = [
  { alias: "node_ver", cmd: "node", args: ["--version"], allow_extra_args: false, description: "Node.js version" },
  { alias: "git_status", cmd: "git", args: ["status"], allow_extra_args: false, description: "Git status" },
  { alias: "list_processes", cmd: "tasklist", args: ["/FO", "CSV", "/NH"], allow_extra_args: false, description: "Running processes (CSV)" },
  { alias: "disk_usage", cmd: "wmic", args: ["logicaldisk", "get", "size,freespace,caption"], allow_extra_args: false, description: "Disk usage" },
  { alias: "n8n_health", cmd: "curl", args: ["-s", "--max-time", "10", "http://127.0.0.1:5678/"], allow_extra_args: false, description: "n8n health check" },
  { alias: "db_restore_certify_probe", cmd: "node", args: ["db-restore-certifier.mjs"], allow_extra_args: false, description: "Read-only DB restore certification prerequisite probe" },
  { alias: "n8n_restore_certify_probe", cmd: "node", args: ["n8n-restore-certifier.mjs"], allow_extra_args: false, description: "Read-only n8n restore certification prerequisite probe" },
];

const LOCAL_CONNECTOR_CAPABILITY_FLAGS = {
  powershell_admin: "CONNECTOR_POWERSHELL_ENABLED",
  windows_control: "CONNECTOR_WIN_ENABLED",
  dependencies: "CONNECTOR_DEPENDENCIES_ENABLED",
  auto_browser: "CONNECTOR_AUTO_BROWSER_ENABLED",
};

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function publicBaseUrl(req) {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "auth.mad4b.com").split(",")[0].trim();
  return `${proto}://${host}`;
}

function httpError(status, code, message) {
  const err = new Error(message || code);
  err.status = status;
  err.code = code;
  return err;
}

function installerTokenSecret() {
  const secret = String(process.env.BACKEND_API_KEY || "").trim();
  if (!secret) throw httpError(500, "installer_token_secret_missing", "BACKEND_API_KEY is required for installer download links.");
  return secret;
}

function verifyInstallerDownloadToken(token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) throw httpError(401, "invalid_download_token", "Invalid installer download token.");
  const expected = crypto.createHmac("sha256", installerTokenSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw httpError(401, "invalid_download_token", "Invalid installer download token signature.");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (!payload.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) {
    throw httpError(401, "download_token_expired", "Installer download token has expired.");
  }
  return payload;
}

function psQuote(value) {
  return String(value ?? "").replace(/'/g, "''");
}

function normalizeGrantAlias(value, fallback = "item") {
  const clean = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
  return clean || fallback;
}

function normalizeWindowsPath(value, max = 260) {
  const raw = String(value || "").trim().replace(/^\"|\"$/g, "").slice(0, max);
  if (!raw) return "";
  if (!/^[a-zA-Z]:\\/.test(raw) && !raw.startsWith("\\\\")) return "";
  if (/[\n\r<>|?*&^%!]/.test(raw)) return "";
  return raw;
}

function normalizeRequestedCapabilities(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(raw.map((item) => String(item || "").trim()).filter((item) => LOCAL_CONNECTOR_CAPABILITY_FLAGS[item]))];
}

function normalizePermissionGrants(value = {}) {
  const grants = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const capabilities = normalizeRequestedCapabilities(grants.capabilities || grants.connector_capabilities || []);
  const pathGrantValues = Array.isArray(grants.allowed_paths)
    ? grants.allowed_paths
    : (Array.isArray(grants.file_paths) ? grants.file_paths : []);
  const allowedPaths = [...new Set(pathGrantValues.map((item) => normalizeWindowsPath(item, 260)).filter(Boolean))].slice(0, 25);

  const appGrantValues = Array.isArray(grants.apps)
    ? grants.apps
    : Object.entries(grants.apps || {}).map(([alias, value]) => ({ alias, ...(value && typeof value === "object" ? value : {}) }));
  const apps = {};
  for (const item of appGrantValues) {
    const alias = normalizeGrantAlias(item?.app_alias || item?.alias || item?.display_name, "app");
    const command = normalizeWindowsPath(item?.command || item?.executable_path || item?.path, 260);
    if (!alias || !command) continue;
    const processName = String(item?.process_name || command.split(/[/\\]/).pop() || alias).replace(/\.exe$/i, "").replace(/[^A-Za-z0-9_.-]+/g, "").slice(0, 80) || alias;
    apps[alias] = {
      display_name: String(item?.display_name || alias).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || alias,
      command,
      process_name: processName,
      browser: item?.browser === true,
      capability_class: String(item?.capability_class || "desktop_app").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "desktop_app",
      risk_class: String(item?.risk_class || "interactive").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "interactive",
    };
    if (Object.keys(apps).length >= 50) break;
  }

  const shellAliases = [];
  for (const item of Array.isArray(grants.shell_aliases || grants.helpers) ? (grants.shell_aliases || grants.helpers) : []) {
    const alias = normalizeGrantAlias(item?.alias || item?.display_name, "helper");
    const command = normalizeWindowsPath(item?.command || item?.command_path || item?.cmd, 260);
    if (!alias || !command) continue;
    const args = Array.isArray(item?.args)
      ? item.args.map((arg) => String(arg || "").slice(0, 200)).filter((arg) => !/[;&|`$<>\n\r]/.test(arg)).slice(0, 20)
      : [];
    shellAliases.push({
      alias,
      cmd: command,
      args,
      allow_extra_args: item?.allow_extra_args === true,
      description: String(item?.description || item?.display_name || alias).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) || alias,
    });
    if (shellAliases.length >= 50) break;
  }
  return { capabilities, allowed_paths: allowedPaths, apps, shell_aliases: shellAliases };
}

function connectorCapabilityEnvLines(capabilities = []) {
  return normalizeRequestedCapabilities(capabilities).map((capability) => `${LOCAL_CONNECTOR_CAPABILITY_FLAGS[capability]}=true`);
}

function envJsonLine(key, value) {
  const json = JSON.stringify(value || {});
  return `${key}=${json.replace(/\r?\n/g, "")}`;
}

function buildAllowlistEnvValue(aliases) {
  const obj = {};
  for (const a of aliases) {
    obj[a.alias] = { command: a.cmd, args: a.args || [], display_name: a.description || a.alias, allow_extra_args: !!a.allow_extra_args };
  }
  return JSON.stringify(obj);
}

function tokenizeCommandTemplate(template) {
  const raw = String(template || "").trim();
  if (!raw) return null;
  const cmdMatch = raw.match(/^cmd(?:\.exe)?\s+\/c\s+(.+)$/i);
  if (cmdMatch) return { command: "cmd.exe", args: ["/d", "/c", cmdMatch[1]] };
  const tokens = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (/\s/.test(ch)) {
      if (current) { tokens.push(current); current = ""; }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  if (!tokens.length) return null;
  return { command: tokens[0], args: tokens.slice(1) };
}

function checksumShellPolicy(aliases) {
  return crypto.createHash("sha256").update(JSON.stringify(aliases)).digest("hex");
}

function checksumConnectorPolicy(parts = {}) {
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function mergePermissionGrants(...values) {
  const merged = { capabilities: [], allowed_paths: [], apps: {}, shell_aliases: [] };
  for (const value of values) {
    const normalized = normalizePermissionGrants(value || {});
    merged.capabilities.push(...normalized.capabilities);
    merged.allowed_paths.push(...normalized.allowed_paths);
    Object.assign(merged.apps, normalized.apps);
    merged.shell_aliases.push(...normalized.shell_aliases);
  }
  return {
    capabilities: [...new Set(merged.capabilities)].filter((item) => LOCAL_CONNECTOR_CAPABILITY_FLAGS[item]),
    allowed_paths: [...new Set(merged.allowed_paths)].slice(0, 25),
    apps: Object.fromEntries(Object.entries(merged.apps).slice(0, 50)),
    shell_aliases: merged.shell_aliases.slice(0, 50),
  };
}

function normalizeAppPolicyRow(row) {
  const alias = normalizeGrantAlias(row.app_alias || row.alias || row.app_key, "app");
  const command = normalizeWindowsPath(row.command_path || row.command || row.executable_path, 260);
  if (!alias || !command) return null;
  const processName = String(row.process_name || command.split(/[/\\]/).pop() || alias).replace(/\.exe$/i, "").replace(/[^A-Za-z0-9_.-]+/g, "").slice(0, 80) || alias;
  return {
    display_name: String(row.display_name || alias).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || alias,
    command,
    process_name: processName,
    browser: row.browser === 1 || row.browser === true,
    capability_class: String(row.capability_class || "desktop_app").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "desktop_app",
    risk_class: String(row.risk_class || "interactive").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "interactive",
  };
}

async function loadConnectorGrantPolicy(configId) {
  const [capRows] = await getPool().query(
    `SELECT capability_key, COALESCE(status, 'active') AS status, COALESCE(source, 'db') AS source, updated_at
       FROM local_connector_capability_grants
      WHERE config_id = ? AND COALESCE(status, 'active') = 'active'
      ORDER BY capability_key`,
    [configId]
  ).catch((err) => {
    if (String(err?.message || '').includes('local_connector_capability_grants')) return [[]];
    throw err;
  });
  const capabilities = [...new Set((capRows || []).map((row) => String(row.capability_key || '').trim()).filter((key) => LOCAL_CONNECTOR_CAPABILITY_FLAGS[key]))];

  const [fileRows] = await getPool().query(
    `SELECT path_pattern, access_mode, description, created_at AS updated_at
       FROM local_connector_file_access_rules
      WHERE config_id = ?
      ORDER BY id`,
    [configId]
  ).catch(() => [[]]);
  const allowedPaths = [...new Set((fileRows || [])
    .map((row) => normalizeWindowsPath(String(row.path_pattern || '').replace(/\\\*$/, ''), 260))
    .filter(Boolean))].slice(0, 25);

  const [appRows] = await getPool().query(
    `SELECT app_alias, display_name, command_path, process_name, browser, capability_class, risk_class,
            COALESCE(status, 'active') AS status,
            COALESCE(source, 'db') AS source,
            updated_at
       FROM local_connector_app_allowlists
      WHERE config_id = ? AND COALESCE(status, 'active') = 'active'
      ORDER BY app_alias`,
    [configId]
  ).catch((err) => {
    if (String(err?.message || '').includes('local_connector_app_allowlists')) return [[]];
    throw err;
  });
  const apps = {};
  for (const row of appRows || []) {
    const alias = normalizeGrantAlias(row.app_alias, "app");
    const entry = normalizeAppPolicyRow(row);
    if (alias && entry) apps[alias] = entry;
  }

  return mergePermissionGrants({ capabilities, allowed_paths: allowedPaths, apps });
}

function normalizeShellPolicyRow(row) {
  const alias = normalizeGrantAlias(row.alias, "alias");
  if (!alias) return null;
  let parsed = null;
  try {
    const obj = JSON.parse(row.command_template);
    if (obj && typeof obj === "object" && typeof obj.command === "string") {
      parsed = { command: obj.command, args: Array.isArray(obj.args) ? obj.args.map(String) : [] };
    }
  } catch {
    parsed = tokenizeCommandTemplate(row.command_template);
  }
  if (!parsed?.command) return null;
  return {
    alias,
    command: parsed.command,
    args: parsed.args || [],
    display_name: String(row.description || alias).slice(0, 160),
    allow_extra_args: row.allow_extra_args === 1 || row.allow_extra_args === true,
    max_extra_args: Number(row.max_extra_args || 0) || 0,
    risk_class: String(row.risk_class || "read_only"),
    source: String(row.source || "db"),
    updated_at: row.updated_at || null,
  };
}

function buildConnectorEnv({ connectorSecret, connectorLocalApiKey = '', aliases, port, capabilities = [], permissionGrants = {} }) {
  const grants = normalizePermissionGrants(permissionGrants);
  const allAliases = [...aliases, ...grants.shell_aliases];
  const appAllowlistLine = Object.keys(grants.apps).length ? [envJsonLine("CONNECTOR_APP_ALLOWLIST", grants.apps)] : [];
  const filePathLine = grants.allowed_paths.length ? [`CONNECTOR_FILE_PATHS=${grants.allowed_paths.join(",")}`] : [];
  const connectorLocalApiKeyLine = String(connectorLocalApiKey || '').trim()
    ? [`CONNECTOR_LOCAL_API_KEY=${String(connectorLocalApiKey).trim()}`]
    : [];
  return [
    `CONNECTOR_SECRET=${connectorSecret}`,
    ...connectorLocalApiKeyLine,
    "MAIN_API_URL=https://api.mad4b.com",
    "CONNECTOR_HEARTBEAT_URL=https://auth.mad4b.com/connector-agent/heartbeat",
    `CONNECTOR_PORT=${port}`,
    "CONNECTOR_SHELL_ENABLED=true",
    "CONNECTOR_FILES_ENABLED=true",
    "CONNECTOR_APPS_ENABLED=true",
    "CONNECTOR_FETCH_UPLOAD_ENABLED=true",
    "CONNECTOR_N8N_ENABLED=true",
    ...connectorCapabilityEnvLines([...capabilities, ...grants.capabilities]),
    ...appAllowlistLine,
    ...filePathLine,
    "CONNECTOR_BROWSER4_ENABLED=true",
    "BROWSER4_ALLOWED_HOSTS=mad4b.com,n8n.mad4b.com",
    "BROWSER4_WORK_DIR=D:\\n8n-data\\browser-runtime-artifacts",
    "BROWSER4_JAVA_HOME=D:\\n8n-data\\browser-runtime\\jre17\\jdk-17.0.19+10-jre",
    "BROWSER4_SERVER_URL=http://localhost:8182",
    "CONNECTOR_AUTO_BROWSER_ENABLED=false",
    "AUTO_BROWSER_BASE_URL=http://127.0.0.1:8000",
    "AUTO_BROWSER_HEALTH_PATH=/healthz",
    "AUTO_BROWSER_ALLOWED_HOSTS=mad4b.com,n8n.mad4b.com",
    "N8N_COMMAND=D:\\npm-global\\n8n.cmd",
    "N8N_USER_FOLDER=D:\\n8n-data",
    "N8N_PORT=5678",
    "N8N_LISTEN_ADDRESS=127.0.0.1",
    "N8N_PUBLIC_URL=https://n8n.mad4b.com/",
    `CONNECTOR_SHELL_ALLOWLIST=${buildAllowlistEnvValue(allAliases)}`,
  ].join("\r\n");
}

function buildInstallPowerShell({ cfToken, connectorSecret, connectorLocalApiKey = '', tunnelUrl, aliases, port, capabilities = [], permissionGrants = {} }) {
  const envText = buildConnectorEnv({ connectorSecret, connectorLocalApiKey, aliases, port, capabilities, permissionGrants });
  return [
    "# Mad4B Local Connector — run once as Administrator",
    "$ErrorActionPreference = 'Stop'",
    "$InstallerPath = Split-Path -Parent $MyInvocation.MyCommand.Path",
    "$Root = Join-Path $env:LOCALAPPDATA 'Mad4B\\LocalManager\\updates'",
    "New-Item -ItemType Directory -Force -Path $Root | Out-Null",
    "$CfService = 'cloudflared'",
    "$NodeService = 'local-connector'",
    "$ServerMjs = Join-Path $Root 'server.mjs'",
    "$ManifestUrl = 'https://auth.mad4b.com/connector-agent/manifest.json'",
    "$ManifestPath = Join-Path $Root 'connector-agent-manifest.json'",
    "$WatchdogPs1 = Join-Path $Root 'connector-watchdog.ps1'",
    "$SafeUpgradePs1 = Join-Path $Root 'connector-safe-upgrade.ps1'",
    "$DbRestoreCertifier = Join-Path $Root 'db-restore-certifier.mjs'",
    "$N8nRestoreCertifier = Join-Path $Root 'n8n-restore-certifier.mjs'",
    "$Browser4Adapter = Join-Path $Root 'browser4-adapter.mjs'",
    "$LocalAgentRuntime = Join-Path $Root 'local-agent-runtime.mjs'",
    "",
    "function Get-Mad4BManifestFile {",
    "  param([Parameter(Mandatory=$true)][string]$Name, [Parameter(Mandatory=$true)][string]$OutFile)",
    "  $entry = $Manifest.files.$Name",
    "  if (-not $entry -or -not $entry.url -or -not $entry.sha256) { throw \"Manifest missing file entry: $Name\" }",
    "  Invoke-WebRequest -Uri $entry.url -OutFile $OutFile -UseBasicParsing -TimeoutSec 90",
    "  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $OutFile).Hash.ToLowerInvariant()",
    "  if ($actual -ne $entry.sha256.ToLowerInvariant()) { throw \"SHA256 mismatch for $Name\" }",
    "}",
    "",
    "if (-not (Get-Command node -ErrorAction SilentlyContinue)) {",
    "  Write-Host 'Installing Node.js LTS...'",
    "  winget install OpenJS.NodeJS.LTS -e --silent",
    "  $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')",
    "}",
    "",
    "Write-Host 'Downloading connector agent manifest...'",
    "Invoke-WebRequest -Uri $ManifestUrl -OutFile $ManifestPath -UseBasicParsing -TimeoutSec 60",
    "$Manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json",
    "if (-not $Manifest.ok -or -not $Manifest.files) { throw 'Invalid connector agent manifest.' }",
    "Get-Mad4BManifestFile -Name 'server.mjs' -OutFile $ServerMjs",
    "Get-Mad4BManifestFile -Name 'connector-watchdog.ps1' -OutFile $WatchdogPs1",
    "Get-Mad4BManifestFile -Name 'connector-safe-upgrade.ps1' -OutFile $SafeUpgradePs1",
    "Get-Mad4BManifestFile -Name 'db-restore-certifier.mjs' -OutFile $DbRestoreCertifier",
    "Get-Mad4BManifestFile -Name 'n8n-restore-certifier.mjs' -OutFile $N8nRestoreCertifier",
    "Get-Mad4BManifestFile -Name 'browser4-adapter.mjs' -OutFile $Browser4Adapter",
    "Get-Mad4BManifestFile -Name 'local-agent-runtime.mjs' -OutFile $LocalAgentRuntime",
    "Copy-Item -LiteralPath $ServerMjs -Destination (Join-Path $Root 'server.mjs.stable') -Force",
    "",
    "$EnvText = @'",
    envText,
    "'@",
    "Set-Content -Path (Join-Path $Root '.env') -Value $EnvText -Encoding ascii",
    "",
    "if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) { winget install Cloudflare.cloudflared -e --silent }",
    "$cfSvc = Get-Service -Name $CfService -ErrorAction SilentlyContinue",
    "if (-not $cfSvc) {",
    `  cloudflared service install '${psQuote(cfToken)}'`,
    "}",
    "Start-Service $CfService -ErrorAction SilentlyContinue",
    "",
    "if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) { winget install NSSM.NSSM -e --silent }",
    "$nodeSvc = Get-Service -Name $NodeService -ErrorAction SilentlyContinue",
    "$nodePath = (Get-Command node).Source",
    "if (-not $nodeSvc) {",
    "  & nssm install $NodeService $nodePath \"`\"$ServerMjs`\"\"",
    "}",
    "& nssm set $NodeService Application $nodePath",
    "& nssm set $NodeService AppParameters \"`\"$ServerMjs`\"\"",
    "& nssm set $NodeService AppDirectory $Root",
    "& nssm set $NodeService AppStdout (Join-Path $Root 'connector.log')",
    "& nssm set $NodeService AppStderr (Join-Path $Root 'connector-error.log')",
    "& nssm set $NodeService AppRotateFiles 1",
    "& nssm set $NodeService AppRotateBytes 5242880",
    "& nssm set $NodeService Start SERVICE_AUTO_START",
    "& nssm set $NodeService ObjectName LocalSystem",
    "Stop-Service $NodeService -Force -ErrorAction SilentlyContinue",
    "Start-Sleep -Seconds 2",
    "Start-Service $NodeService -ErrorAction SilentlyContinue",
    "",
    "$TaskName = 'Mad4B-LocalConnector-Watchdog'",
    "$TaskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument \"-NoProfile -ExecutionPolicy Bypass -File `\"$WatchdogPs1`\" -Root `\"$Root`\"\"", 
    "$TaskTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)",
    "$TaskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest",
    "Register-ScheduledTask -TaskName $TaskName -Action $TaskAction -Trigger $TaskTrigger -Principal $TaskPrincipal -Force | Out-Null",
    "Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue",
    "Start-Service $NodeService -ErrorAction SilentlyContinue",
    "Start-Sleep -Seconds 3",
    `Write-Host 'Done. Tunnel: ${psQuote(tunnelUrl)}'`,
  ].join("\r\n");
}

async function loadAgentFile(fileName) {
  const meta = FILES[fileName];
  if (!meta) return null;
  const fullPath = path.resolve(ROOT, meta.relativePath);
  const buffer = await readFile(fullPath);
  return { ...meta, fileName, fullPath, buffer, size: buffer.length, sha256: sha256(buffer) };
}

function bearerToken(req) {
  const header = String(req.headers.authorization || "").trim();
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

function boundedString(value, max = 128) {
  const str = String(value || "").trim();
  return str ? str.slice(0, max) : null;
}

function safeJsonObject(value, maxBytes = 4000) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(key)) continue;
    if (["token", "secret", "password", "key", "authorization"].some((needle) => key.toLowerCase().includes(needle))) continue;
    if (["string", "number", "boolean"].includes(typeof raw) || raw === null) out[key] = raw;
  }
  const json = JSON.stringify(out);
  return Buffer.byteLength(json, "utf8") <= maxBytes ? json : JSON.stringify({ truncated: true });
}

function enumValue(value, allowed, fallback) {
  const str = String(value || "").trim();
  return allowed.includes(str) ? str : fallback;
}

async function resolveHeartbeatConfig(req, body = {}) {
  const token = bearerToken(req);
  if (!token) throw httpError(401, "connector_auth_required", "Connector heartbeat requires bearer auth.");
  const params = [];
  let sql = "SELECT * FROM `local_connector_user_configs` WHERE is_enabled = 1";
  if (body.config_id) { sql += " AND config_id = ?"; params.push(body.config_id); }
  if (body.device_id) { sql += " AND device_id = ?"; params.push(body.device_id); }
  if (!body.config_id && !body.device_id) throw httpError(400, "connector_identity_required", "config_id or device_id is required.");
  const backendToken = String(process.env.BACKEND_API_KEY || "").trim();
  if (backendToken && token === backendToken) {
    sql += " ORDER BY updated_at DESC LIMIT 1";
  } else {
    const authPredicate = await connectorAuthPredicateForToken(token);
    sql += ` AND ${authPredicate.sql} ORDER BY updated_at DESC LIMIT 1`;
    params.push(...authPredicate.params);
  }
  const [rows] = await getPool().query(sql, params);
  if (rows[0]) return rows[0];
  throw httpError(403, "connector_auth_failed", "Connector heartbeat auth failed.");
}

async function syncPrimaryRouteFromHeartbeat(config, { status, errorCode = null, errorMessage = null } = {}) {
  const primaryUrl = String(config?.device_runtime_url || config?.tunnel_url || "").trim().replace(/\/$/, "");
  if (!config?.config_id || !primaryUrl) return;
  const routeHealth = status === "failed" ? "degraded" : "healthy";
  const params = status === "failed"
    ? [routeHealth, String(errorCode || "heartbeat_failed").slice(0, 128), String(errorMessage || "Connector heartbeat reported failure.").slice(0, 1000), config.config_id, primaryUrl]
    : [routeHealth, config.config_id, primaryUrl];
  const sql = status === "failed"
    ? `UPDATE \`local_connector_device_routes\`
          SET health_status = ?,
              last_health_at = NOW(),
              last_failure_at = NOW(),
              last_error_code = ?,
              last_error_message = ?,
              updated_at = NOW()
        WHERE config_id = ?
          AND route_type = 'cloudflare_tunnel'
          AND REPLACE(TRIM(TRAILING '/' FROM endpoint_url), '\\n', '') = ?`
    : `UPDATE \`local_connector_device_routes\`
          SET health_status = ?,
              last_health_at = NOW(),
              last_success_at = NOW(),
              last_error_code = NULL,
              last_error_message = NULL,
              updated_at = NOW()
        WHERE config_id = ?
          AND route_type = 'cloudflare_tunnel'
          AND REPLACE(TRIM(TRAILING '/' FROM endpoint_url), '\\n', '') = ?`;
  const [updateResult] = await getPool().query(sql, params);
  if (Number(updateResult?.affectedRows || 0) > 0) return;

  const routeMetadata = JSON.stringify({
    source: "connector_heartbeat",
    default_route: true,
    secrets_included: false,
  });
  const routeIdentity = [
    crypto.randomUUID(),
    config.config_id,
    config.user_id || null,
    config.tenant_id || null,
    config.device_id || null,
    primaryUrl,
  ];

  if (status === "failed") {
    await getPool().query(
      `INSERT INTO \`local_connector_device_routes\`
         (route_id, config_id, user_id, tenant_id, device_id, route_type, route_label, endpoint_url,
          priority, is_enabled, is_customer_selectable, requires_admin_setup, requires_router_config,
          requires_vpn_agent, tls_mode, auth_mode, health_status, last_health_at, last_failure_at,
          last_error_code, last_error_message, route_metadata)
       VALUES (?, ?, ?, ?, ?, 'cloudflare_tunnel', 'Cloudflare Tunnel', ?,
               50, 1, 1, 0, 0, 0, 'required', 'bearer_connector_secret', ?, NOW(), NOW(), ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         user_id = VALUES(user_id),
         tenant_id = VALUES(tenant_id),
         device_id = VALUES(device_id),
         is_enabled = 1,
         health_status = VALUES(health_status),
         last_health_at = NOW(),
         last_failure_at = NOW(),
         last_error_code = VALUES(last_error_code),
         last_error_message = VALUES(last_error_message),
         route_metadata = VALUES(route_metadata),
         updated_at = NOW()`,
      [
        ...routeIdentity,
        routeHealth,
        String(errorCode || "heartbeat_failed").slice(0, 128),
        String(errorMessage || "Connector heartbeat reported failure.").slice(0, 1000),
        routeMetadata,
      ]
    );
    return;
  }

  await getPool().query(
    `INSERT INTO \`local_connector_device_routes\`
       (route_id, config_id, user_id, tenant_id, device_id, route_type, route_label, endpoint_url,
        priority, is_enabled, is_customer_selectable, requires_admin_setup, requires_router_config,
        requires_vpn_agent, tls_mode, auth_mode, health_status, last_health_at, last_success_at,
        last_error_code, last_error_message, route_metadata)
     VALUES (?, ?, ?, ?, ?, 'cloudflare_tunnel', 'Cloudflare Tunnel', ?,
             50, 1, 1, 0, 0, 0, 'required', 'bearer_connector_secret', ?, NOW(), NOW(), NULL, NULL, ?)
     ON DUPLICATE KEY UPDATE
       user_id = VALUES(user_id),
       tenant_id = VALUES(tenant_id),
       device_id = VALUES(device_id),
       is_enabled = 1,
       health_status = VALUES(health_status),
       last_health_at = NOW(),
       last_success_at = NOW(),
       last_error_code = NULL,
       last_error_message = NULL,
       route_metadata = VALUES(route_metadata),
       updated_at = NOW()`,
    [...routeIdentity, routeHealth, routeMetadata]
  );
}

async function writeHeartbeat(config, body = {}) {
  const eventType = enumValue(body.event_type, ["health_ok", "health_failed", "service_restart", "cloudflared_restart", "safe_upgrade", "rollback", "repair_bundle", "manual_recovery", "watchdog_install"], body.status === "failed" ? "health_failed" : "health_ok");
  const status = enumValue(body.status, ["started", "ok", "failed", "skipped"], eventType === "health_failed" ? "failed" : "ok");
  const source = enumValue(body.source, ["watchdog", "auth_repair", "installer", "admin", "manual"], "watchdog");
  const activeSlot = enumValue(body.active_slot, ["a", "b", "legacy"], config.active_slot || "legacy");
  const agentVersion = boundedString(body.agent_version || AGENT_VERSION, 64);
  const watchdogVersion = boundedString(body.watchdog_version, 64);
  const errorCode = boundedString(body.error_code, 128);
  const errorMessage = boundedString(body.error_message, 1000);
  const repairStatus = enumValue(body.repair_status || (status === "failed" ? "failed" : "ok"), ["ok", "failed", "rollback", "manual_required"], status === "failed" ? "failed" : "ok");
  const metadataJson = safeJsonObject(body.metadata_json || body.metadata);

  await getPool().query(
    `UPDATE \`local_connector_user_configs\`
        SET watchdog_installed = IF(? IS NULL, watchdog_installed, ?),
            watchdog_version = COALESCE(?, watchdog_version),
            agent_version = COALESCE(?, agent_version),
            active_slot = ?,
            last_health_at = NOW(),
            last_reconnect_at = IF(? IN ('service_restart','cloudflared_restart'), NOW(), last_reconnect_at),
            last_repair_at = IF(? IN ('safe_upgrade','rollback','repair_bundle','manual_recovery'), NOW(), last_repair_at),
            last_repair_status = IF(? IN ('safe_upgrade','rollback','repair_bundle','manual_recovery'), ?, last_repair_status),
            last_error_code = ?,
            last_error_message = ?,
            updated_at = NOW()
      WHERE config_id = ?`,
    [
      body.watchdog_installed === undefined ? null : 1,
      body.watchdog_installed ? 1 : 0,
      watchdogVersion,
      agentVersion,
      activeSlot,
      eventType,
      eventType,
      eventType,
      repairStatus,
      errorCode,
      errorMessage,
      config.config_id,
    ]
  );

  await syncPrimaryRouteFromHeartbeat(config, { status, errorCode, errorMessage });

  const eventId = crypto.randomUUID();
  await getPool().query(
    `INSERT INTO \`local_connector_recovery_events\`
       (event_id, config_id, user_id, tenant_id, device_id, event_type, status, source, agent_version, active_slot, error_code, error_message, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [eventId, config.config_id, config.user_id, config.tenant_id, config.device_id, eventType, status, source, agentVersion, activeSlot, errorCode, errorMessage, metadataJson]
  );

  return { event_id: eventId, event_type: eventType, status, source, agent_version: agentVersion, active_slot: activeSlot };
}

export function buildConnectorAgentRoutes() {
  const router = Router();

  router.get("/connector-agent/version", async (_req, res) => {
    try {
      const server = await loadAgentFile("server.mjs");
      const watchdog = await loadAgentFile("connector-watchdog.ps1");
      const safeUpgrade = await loadAgentFile("connector-safe-upgrade.ps1");
      return res.status(200).json({
        ok: true,
        agent: {
          name: "mad4b-local-connector",
          version: AGENT_VERSION,
          sha256: server.sha256,
          server_sha256: server.sha256,
          watchdog_sha256: watchdog.sha256,
          safe_upgrade_sha256: safeUpgrade.sha256,
          has_watchdog: true,
          has_safe_upgrade: true,
          has_n8n_lifecycle: true,
          has_local_tool_releases: true,
          local_tool_count: LOCAL_TOOL_RELEASES.length,
        },
        secrets_included: false,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "connector_agent_version_failed", message: err.message } });
    }
  });

  router.get("/connector-agent/manifest.json", async (req, res) => {
    try {
      const base = publicBaseUrl(req);
      const files = {};
      for (const fileName of Object.keys(FILES)) {
        const loaded = await loadAgentFile(fileName);
        files[fileName] = {
          url: `${base}/connector-agent/files/${encodeURIComponent(fileName)}`,
          sha256: loaded.sha256,
          size: loaded.size,
          content_type: loaded.contentType,
          executable: loaded.executable,
        };
      }

      return res.status(200).json({
        ok: true,
        agent: "mad4b-local-connector",
        version: AGENT_VERSION,
        release_channel: "stable",
        minimum_watchdog_version: "2026.05.18.1",
        generated_at: new Date().toISOString(),
        files,
        local_tools: {
          owner_app: "mad4b-local-manager",
          release_model: "manifest_driven_allowlisted_tools",
          install_scope: "per_user_device",
          tools: LOCAL_TOOL_RELEASES,
        },
        upgrade_policy: {
          verify_sha256: true,
          node_check_required: true,
          backup_before_replace: true,
          health_check_required: true,
          rollback_on_failed_health: true,
          local_tool_release_owner: "mad4b-local-manager",
        },
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "connector_agent_manifest_failed", message: err.message } });
    }
  });

  router.get("/connector-agent/installer.ps1", async (req, res) => {
    try {
      const payload = verifyInstallerDownloadToken(req.query.token);
      if (payload.format !== "ps1") throw httpError(400, "unsupported_format", "Only ps1 installer downloads are supported.");
      const connectorLocalApiKeySelect = await connectorLocalApiKeySelectFragment();
      const [[config]] = await getPool().query(
        `SELECT config_id, user_id, tenant_id, device_id, COALESCE(device_runtime_url, tunnel_url) AS tunnel_url, connector_secret, ${connectorLocalApiKeySelect}, cf_token FROM \`local_connector_user_configs\` WHERE user_id = ? AND device_id = ? AND is_enabled = 1 LIMIT 1`,
        [payload.user_id, payload.device_id]
      );
      if (!config) throw httpError(404, "connector_config_not_found", "No active connector config was found for this download token.");
      if (!config.cf_token || !config.connector_secret) throw httpError(409, "connector_config_incomplete", "Connector config is missing recovery token or connector secret.");
      const dbGrants = await loadConnectorGrantPolicy(config.config_id);
      const installer = buildInstallPowerShell({
        cfToken: config.cf_token,
        connectorSecret: config.connector_secret,
        connectorLocalApiKey: config.connector_local_api_key || '',
        tunnelUrl: config.tunnel_url,
        aliases: DEFAULT_WINDOWS_ALIASES,
        port: CONNECTOR_PORT,
        capabilities: payload.capabilities || [],
        permissionGrants: mergePermissionGrants(dbGrants, payload.permission_grants || {}),
      });
      const filename = `install-local-connector-${String(config.device_id).replace(/[^a-zA-Z0-9_-]+/g, "-")}.ps1`;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
      return res.status(200).send(installer);
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "connector_agent_installer_failed", message: err.message } });
    }
  });

  router.get("/connector-agent/files/:fileName", async (req, res) => {
    try {
      const requested = String(req.params.fileName || "").trim();
      if (!FILES[requested]) {
        return res.status(404).json({ ok: false, error: { code: "connector_agent_file_not_found", message: "Unknown connector agent file." } });
      }
      const loaded = await loadAgentFile(requested);
      res.setHeader("Content-Type", loaded.contentType);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Mad4B-Agent-Version", AGENT_VERSION);
      res.setHeader("X-Mad4B-SHA256", loaded.sha256);
      return res.status(200).send(loaded.buffer);
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "connector_agent_file_failed", message: err.message } });
    }
  });

  router.get("/connector-agent/policy", async (req, res) => {
    try {
      const token = bearerToken(req);
      if (!token) throw httpError(401, "connector_auth_required", "Connector policy requires bearer auth.");
      const configId = boundedString(req.query.config_id, 64);
      const deviceId = boundedString(req.query.device_id, 128);
      const params = [];
      let sql = "SELECT * FROM `local_connector_user_configs` WHERE is_enabled = 1";
      if (configId) { sql += " AND config_id = ?"; params.push(configId); }
      if (deviceId) { sql += " AND device_id = ?"; params.push(deviceId); }
      const backendToken = String(process.env.BACKEND_API_KEY || "").trim();
      if (backendToken && token === backendToken) {
        sql += " ORDER BY updated_at DESC LIMIT 1";
      } else {
        const authPredicate = await connectorAuthPredicateForToken(token);
        sql += ` AND ${authPredicate.sql} ORDER BY updated_at DESC LIMIT 1`;
        params.push(...authPredicate.params);
      }
      const [[config]] = await getPool().query(sql, params);
      if (!config) throw httpError(403, "connector_policy_auth_failed", "Connector policy auth failed.");

      const [rows] = await getPool().query(
        `SELECT alias, command_template, allow_extra_args, description,
                COALESCE(status, 'active') AS status,
                COALESCE(risk_class, 'read_only') AS risk_class,
                COALESCE(source, 'db') AS source,
                updated_at
           FROM \`local_connector_shell_allowlists\`
          WHERE config_id = ?
            AND COALESCE(status, 'active') = 'active'
          ORDER BY alias`,
        [config.config_id]
      );
      const aliases = {};
      for (const row of rows) {
        const entry = normalizeShellPolicyRow(row);
        if (entry) aliases[entry.alias] = entry;
      }
      const aliasList = Object.entries(aliases).map(([alias, entry]) => ({ alias, ...entry }));
      const grantPolicy = await loadConnectorGrantPolicy(config.config_id);
      const checksum = checksumConnectorPolicy({ aliases: aliasList, grants: grantPolicy });
      const policyVersion = aliasList.reduce((max, item) => {
        const ts = item.updated_at ? Date.parse(item.updated_at) : 0;
        return Number.isFinite(ts) && ts > max ? ts : max;
      }, 0) || Date.now();
      return res.status(200).json({
        ok: true,
        config_id: config.config_id,
        user_id: config.user_id,
        tenant_id: config.tenant_id,
        device_id: config.device_id,
        auth: {
          connector_secret_configured: Boolean(config.connector_secret),
          connector_local_api_key_configured: Boolean(config.connector_local_api_key),
        },
        policy_version: String(policyVersion),
        checksum,
        shell_aliases: aliases,
        alias_count: Object.keys(aliases).length,
        capability_grants: {
          capabilities: grantPolicy.capabilities,
          allowed_paths: grantPolicy.allowed_paths,
          apps: grantPolicy.apps,
          app_aliases: Object.keys(grantPolicy.apps),
        },
        generated_at: new Date().toISOString(),
        ttl_seconds: 300,
        secrets_included: false,
      });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "connector_agent_policy_failed", message: err.message }, secrets_included: false });
    }
  });

  router.post("/connector-agent/heartbeat", async (req, res) => {
    try {
      const body = req.body || {};
      const config = await resolveHeartbeatConfig(req, body);
      const event = await writeHeartbeat(config, body);
      return res.status(200).json({
        ok: true,
        config_id: config.config_id,
        device_id: config.device_id,
        event,
        secrets_included: false,
      });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "connector_heartbeat_failed", message: err.message } });
    }
  });

  return router;
}
