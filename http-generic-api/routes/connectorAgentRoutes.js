import { Router } from "express";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getPool } from "../db.js";

const AGENT_VERSION = "2026.05.18.1";
const ROOT = process.cwd();
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
};

const DEFAULT_WINDOWS_ALIASES = [
  { alias: "node_ver", cmd: "node", args: ["--version"], allow_extra_args: false, description: "Node.js version" },
  { alias: "git_status", cmd: "git", args: ["status"], allow_extra_args: false, description: "Git status" },
  { alias: "list_processes", cmd: "tasklist", args: ["/FO", "CSV", "/NH"], allow_extra_args: false, description: "Running processes (CSV)" },
  { alias: "disk_usage", cmd: "wmic", args: ["logicaldisk", "get", "size,freespace,caption"], allow_extra_args: false, description: "Disk usage" },
  { alias: "n8n_health", cmd: "curl", args: ["-s", "--max-time", "10", "http://127.0.0.1:5678/"], allow_extra_args: false, description: "n8n health check" },
  { alias: "db_restore_certify_probe", cmd: "node", args: ["db-restore-certifier.mjs"], allow_extra_args: false, description: "Read-only DB restore certification prerequisite probe" },
];

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

function buildAllowlistEnvValue(aliases) {
  const obj = {};
  for (const a of aliases) {
    obj[a.alias] = { command: a.cmd, args: a.args || [], display_name: a.description || a.alias, allow_extra_args: !!a.allow_extra_args };
  }
  return JSON.stringify(obj);
}

function buildConnectorEnv({ connectorSecret, aliases, port }) {
  return [
    `BACKEND_API_KEY=${connectorSecret}`,
    "MAIN_API_URL=https://api.mad4b.com",
    `CONNECTOR_PORT=${port}`,
    "CONNECTOR_SHELL_ENABLED=true",
    "CONNECTOR_FILES_ENABLED=true",
    "CONNECTOR_APPS_ENABLED=true",
    "CONNECTOR_FETCH_UPLOAD_ENABLED=true",
    "CONNECTOR_N8N_ENABLED=true",
    "N8N_COMMAND=D:\\npm-global\\n8n.cmd",
    "N8N_USER_FOLDER=D:\\n8n-data",
    "N8N_PORT=5678",
    "N8N_LISTEN_ADDRESS=127.0.0.1",
    "N8N_PUBLIC_URL=https://n8n.mad4b.com/",
    `CONNECTOR_SHELL_ALLOWLIST=${buildAllowlistEnvValue(aliases)}`,
  ].join("\r\n");
}

function buildInstallPowerShell({ cfToken, connectorSecret, tunnelUrl, aliases, port }) {
  const envText = buildConnectorEnv({ connectorSecret, aliases, port });
  return [
    "# Mad4B Local Connector — run once as Administrator",
    "$ErrorActionPreference = 'Stop'",
    "$Root = Split-Path -Parent $MyInvocation.MyCommand.Path",
    "$CfService = 'cloudflared'",
    "$NodeService = 'local-connector'",
    "$ServerMjs = Join-Path $Root 'server.mjs'",
    "$ManifestUrl = 'https://auth.mad4b.com/connector-agent/manifest.json'",
    "$ManifestPath = Join-Path $Root 'connector-agent-manifest.json'",
    "$WatchdogPs1 = Join-Path $Root 'connector-watchdog.ps1'",
    "$SafeUpgradePs1 = Join-Path $Root 'connector-safe-upgrade.ps1'",
    "$DbRestoreCertifier = Join-Path $Root 'db-restore-certifier.mjs'", 
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
    "if (-not $nodeSvc) {",
    "  $nodePath = (Get-Command node).Source",
    "  & nssm install $NodeService $nodePath \"`\"$ServerMjs`\"\"",
    "  & nssm set $NodeService AppDirectory $Root",
    "  & nssm set $NodeService AppStdout (Join-Path $Root 'connector.log')",
    "  & nssm set $NodeService AppStderr (Join-Path $Root 'connector-error.log')",
    "  & nssm set $NodeService AppRotateFiles 1",
    "  & nssm set $NodeService AppRotateBytes 5242880",
    "  & nssm set $NodeService Start SERVICE_AUTO_START",
    "  & nssm set $NodeService ObjectName LocalSystem",
    "}",
    "",
    "$TaskName = 'Mad4B-LocalConnector-Watchdog'",
    "$TaskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument \"-NoProfile -ExecutionPolicy Bypass -File `\"$WatchdogPs1`\"\"",
    "$TaskTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)",
    "$TaskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest",
    "Register-ScheduledTask -TaskName $TaskName -Action $TaskAction -Trigger $TaskTrigger -Principal $TaskPrincipal -Force | Out-Null",
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
    sql += " AND connector_secret = ? ORDER BY updated_at DESC LIMIT 1";
    params.push(token);
  }
  const [rows] = await getPool().query(sql, params);
  if (rows[0]) return rows[0];
  throw httpError(403, "connector_auth_failed", "Connector heartbeat auth failed.");
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
        upgrade_policy: {
          verify_sha256: true,
          node_check_required: true,
          backup_before_replace: true,
          health_check_required: true,
          rollback_on_failed_health: true,
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
      const [[config]] = await getPool().query(
        "SELECT config_id, user_id, tenant_id, device_id, COALESCE(device_runtime_url, tunnel_url) AS tunnel_url, connector_secret, cf_token FROM `local_connector_user_configs` WHERE user_id = ? AND device_id = ? AND is_enabled = 1 LIMIT 1",
        [payload.user_id, payload.device_id]
      );
      if (!config) throw httpError(404, "connector_config_not_found", "No active connector config was found for this download token.");
      if (!config.cf_token || !config.connector_secret) throw httpError(409, "connector_config_incomplete", "Connector config is missing recovery token or connector secret.");
      const installer = buildInstallPowerShell({
        cfToken: config.cf_token,
        connectorSecret: config.connector_secret,
        tunnelUrl: config.tunnel_url,
        aliases: DEFAULT_WINDOWS_ALIASES,
        port: CONNECTOR_PORT,
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
