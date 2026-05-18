import { Router } from "express";
import { getPool } from "../db.js";
import { createHash, randomUUID } from "node:crypto";
import { decryptCredentials } from "../tokenEncryption.js";

const CF_API = "https://api.cloudflare.com/client/v4";
const CONNECTOR_PORT = 7070;
const CONNECTOR_SUBDOMAIN_SUFFIX = ".connector.mad4b.com";
const DNS_DOMAIN = "mad4b.com";
const CONNECTOR_DNS_PARENT = "connector";
const DEFAULT_N8N_PORT = 5678;
const DEFAULT_BROWSER_PORT = 9222;
const PLATFORM_TENANT_ID = "00000000-0000-4000-a000-000000000001";
const PLATFORM_ADMIN_USER_ID = "00000000-0000-4000-a000-000000000002";

const DEFAULT_WINDOWS_ALIASES = [
  { alias: "node_ver",       cmd: "node",     args: ["--version"],                              allow_extra_args: false, description: "Node.js version" },
  { alias: "git_status",     cmd: "git",      args: ["status"],                                 allow_extra_args: false, description: "Git status" },
  { alias: "list_processes", cmd: "tasklist", args: ["/FO", "CSV", "/NH"],                      allow_extra_args: false, description: "Running processes (CSV)" },
  { alias: "disk_usage",     cmd: "wmic",     args: ["logicaldisk", "get", "size,freespace,caption"], allow_extra_args: false, description: "Disk usage" },
  { alias: "n8n_health",     cmd: "curl",     args: ["-s", "--max-time", "10", "http://127.0.0.1:5678/"], allow_extra_args: false, description: "n8n health check" },
];

function resolveLocalConnectorPrincipalAliases(userId, tenantId) {
  const normalizedUser = String(userId || "").trim().toLowerCase();
  const normalizedTenant = String(tenantId || "").trim().toLowerCase();
  return {
    userId: ["admin", "nagy", "platform_admin"].includes(normalizedUser)
      ? PLATFORM_ADMIN_USER_ID
      : userId,
    tenantId: ["platform", "mad4b", "platform_owner"].includes(normalizedTenant)
      ? PLATFORM_TENANT_ID
      : tenantId,
  };
}

function firstString(...values) {
  for (const value of values) {
    const str = String(value || "").trim();
    if (str) return str;
  }
  return "";
}

function parseMaybeJsonObject(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function httpError(status, code, message) {
  const err = new Error(message || code);
  err.status = status;
  err.code = code;
  return err;
}

async function assertActiveMembership(userId, tenantId) {
  const [rows] = await getPool().query(
    "SELECT 1 FROM `memberships` WHERE user_id = ? AND tenant_id = ? AND status = 'active' LIMIT 1",
    [userId, tenantId]
  );
  if (!rows.length) throw httpError(403, "membership_required", "User is not an active member of this tenant.");
}

function assertApiCredentialScope(req, acceptedScopes = []) {
  if (req.auth?.mode !== "api_credential") return;
  const scopes = Array.isArray(req.auth.scopes) ? req.auth.scopes : [];
  if (!scopes.length) return;
  const allowed = acceptedScopes.some((scope) => scopes.includes(scope)) || scopes.includes("local_connector.*");
  if (!allowed) throw httpError(403, "scope_not_granted", `API credential requires one of: ${acceptedScopes.join(", ")}`);
}

async function resolveRequestedLocalPrincipal(req, { user_id, tenant_id }) {
  if (req.auth?.is_admin === true) {
    const principal = resolveLocalConnectorPrincipalAliases(user_id, tenant_id);
    return { ...principal, source: "admin_env" };
  }

  if (req.auth?.mode === "user_jwt") {
    const userId = req.auth.user_id;
    const tenantId = req.auth.tenant_id || tenant_id;
    if (!userId || !tenantId) throw httpError(400, "missing_principal", "Signed-in user and tenant_id are required.");
    if (req.auth.tenant_id && tenant_id && req.auth.tenant_id !== tenant_id) {
      throw httpError(403, "tenant_mismatch", "Request tenant_id does not match the signed-in user's token.");
    }
    await assertActiveMembership(userId, tenantId);
    return { userId, tenantId, source: "user_jwt" };
  }

  if (req.auth?.mode === "api_credential") {
    assertApiCredentialScope(req, ["local_connector.install", "local_connector.manage"]);
    const tenantId = req.auth.tenant_id;
    const userId = user_id || req.auth.user_id;
    if (!tenantId || !userId) {
      throw httpError(400, "missing_principal", "API credential calls require a user_id for the device owner.");
    }
    if (tenant_id && tenant_id !== tenantId) {
      throw httpError(403, "tenant_mismatch", "Request tenant_id does not match the API credential tenant.");
    }
    await assertActiveMembership(userId, tenantId);
    return { userId, tenantId, source: "api_credential" };
  }

  throw httpError(403, "unsupported_auth_mode", "Unsupported authentication mode for local connector install.");
}

async function loadConnectionCredentials({ connectionId = null, tenantId, userId, appKeys = [] }) {
  const params = [];
  let sql = "SELECT * FROM `user_app_connections` WHERE status = 'active'";
  if (connectionId) {
    sql += " AND connection_id = ?";
    params.push(connectionId);
  } else {
    sql += " AND tenant_id = ? AND app_key IN (?) AND (user_id = ? OR is_primary = 1)";
    params.push(tenantId, appKeys, userId);
  }
  sql += " ORDER BY (user_id = ?) DESC, is_primary DESC, connected_at DESC LIMIT 1";
  params.push(userId);

  const [rows] = await getPool().query(sql, params);
  const connection = rows[0];
  if (!connection) return null;
  return {
    connection,
    credentials: decryptCredentials(connection.encrypted_credentials) || {},
  };
}

async function resolveProvisioningCredentials(req, principal, body = {}) {
  // Managed platform: admin, user JWT, and api_credential all use platform CF credentials.
  // Only dedicated mode (body.provisioning_credential_mode === "dedicated") uses tenant-owned creds.
  const useManagedCreds =
    req.auth?.is_admin === true ||
    req.auth?.mode === "user_jwt" ||
    req.auth?.mode === "api_credential" ||
    body.provisioning_credential_mode === "managed";

  if (useManagedCreds && body.provisioning_credential_mode !== "dedicated") {
    return {
      source: req.auth?.is_admin === true ? "server_env" : "managed_server_env",
      cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      cloudflareToken: process.env.CLOUDFLARE_API_TOKEN,
      hostingerToken: hostingerApiKey(),
    };
  }

  const cloudflare = await loadConnectionCredentials({
    connectionId: body.cloudflare_connection_id || null,
    tenantId: principal.tenantId,
    userId: principal.userId,
    appKeys: ["cloudflare"],
  });
  const hostinger = await loadConnectionCredentials({
    connectionId: body.hostinger_connection_id || null,
    tenantId: principal.tenantId,
    userId: principal.userId,
    appKeys: ["hostinger"],
  });

  const cloudflareCreds = cloudflare?.credentials || {};
  const hostingerCreds = hostinger?.credentials || {};
  const cloudflareMetadata = parseMaybeJsonObject(cloudflare?.connection?.account_metadata);
  const cloudflareToken = firstString(
    cloudflareCreds.cloudflare_api_token,
    cloudflareCreds.api_token,
    cloudflareCreds.bearer_token,
    cloudflareCreds.api_key,
    cloudflareCreds.access_token
  );
  const cloudflareAccountId = firstString(
    cloudflareCreds.cloudflare_account_id,
    cloudflareCreds.account_id,
    cloudflareMetadata.cloudflare_account_id,
    cloudflareMetadata.account_id
  );
  const hostingerToken = firstString(
    hostingerCreds.hostinger_api_token,
    hostingerCreds.api_token,
    hostingerCreds.bearer_token,
    hostingerCreds.api_key,
    hostingerCreds.access_token
  );

  if (!cloudflareToken || !cloudflareAccountId || !hostingerToken) {
    throw httpError(
      403,
      "customer_credentials_required",
      "Customer local integration routing requires active DB app connections for cloudflare and hostinger credentials."
    );
  }

  return {
    source: "db_user_app_connections",
    cloudflareAccountId,
    cloudflareToken,
    hostingerToken,
    cloudflareConnectionId: cloudflare.connection.connection_id,
    hostingerConnectionId: hostinger.connection.connection_id,
  };
}

// ── Cloudflare tunnel helpers ──────────────────────────────────────────────────

function cfHeaders(tokenOverride = null) {
  const token = tokenOverride || process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN not configured.");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function cfRequest(method, path, body, tokenOverride = null) {
  const res = await fetch(`${CF_API}${path}`, {
    method,
    headers: cfHeaders(tokenOverride),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.errors?.[0]?.message || "Cloudflare API error");
  return json.result;
}

async function provisionTunnel(accountId, tunnelName, cfToken = null) {
  const tunnel = await cfRequest("POST", `/accounts/${accountId}/cfd_tunnel`, {
    name: tunnelName,
    tunnel_secret: Buffer.from(randomUUID().replace(/-/g, ""), "hex").toString("base64"),
    config_src: "cloudflare",
  }, cfToken);
  const tokenResult = await cfRequest("GET", `/accounts/${accountId}/cfd_tunnel/${tunnel.id}/token`, null, cfToken);
  return { tunnelId: tunnel.id, tunnelName: tunnel.name, token: tokenResult };
}

async function readTunnelIngress(accountId, tunnelId, cfToken = null) {
  try {
    const result = await cfRequest("GET", `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, null, cfToken);
    return Array.isArray(result?.config?.ingress) ? result.config.ingress : [];
  } catch (err) {
    console.warn("[install] Cloudflare ingress read warning:", err.message);
    return [];
  }
}

function upsertIngressEntry(existingIngress, hostname, serviceUrl) {
  const targetHost = String(hostname || "").toLowerCase();
  const targetPath = "";
  const existingRoutes = existingIngress
    .filter((entry) => entry && entry.hostname)
    .filter((entry) => {
      const sameHost = String(entry.hostname).toLowerCase() === targetHost;
      const samePath = String(entry.path || "") === targetPath;
      return !(sameHost && samePath);
    });
  return [
    ...existingRoutes,
    { hostname, service: serviceUrl },
    { service: "http_status:404" },
  ];
}

function normalizeIngressRoute(route = {}) {
  return {
    hostname: String(route.hostname || "").trim().toLowerCase(),
    path: String(route.path || "").trim(),
    service: String(route.service || route.serviceUrl || "").trim(),
  };
}

function upsertIngressRoutes(existingIngress, desiredRoutes = []) {
  const normalizedRoutes = desiredRoutes
    .map(normalizeIngressRoute)
    .filter((route) => route.hostname && route.service);
  const routeKeys = new Set(normalizedRoutes.map((route) => `${route.hostname}|${route.path}`));
  const preservedRoutes = existingIngress
    .filter((entry) => entry && entry.hostname)
    .filter((entry) => !routeKeys.has(`${String(entry.hostname).toLowerCase()}|${String(entry.path || "")}`));
  return [
    ...preservedRoutes,
    ...normalizedRoutes.map((route) => ({
      hostname: route.hostname,
      ...(route.path ? { path: route.path } : {}),
      service: route.service,
    })),
    { service: "http_status:404" },
  ];
}

async function publishTunnelIngress(accountId, tunnelId, hostname, serviceUrl = `http://localhost:${CONNECTOR_PORT}`, cfToken = null) {
  const existingIngress = await readTunnelIngress(accountId, tunnelId, cfToken);
  return cfRequest("PUT", `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, {
    config: {
      ingress: upsertIngressEntry(existingIngress, hostname, serviceUrl),
    },
  }, cfToken);
}

async function publishPrivateTunnelIngress(accountId, tunnelId, serviceUrl = `http://localhost:${CONNECTOR_PORT}`, cfToken = null) {
  return cfRequest("PUT", `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, {
    config: { ingress: [{ service: serviceUrl }] },
  }, cfToken);
}

async function publishTunnelIngressRoutes(accountId, tunnelId, routes = [], cfToken = null) {
  const existingIngress = await readTunnelIngress(accountId, tunnelId, cfToken);
  return cfRequest("PUT", `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, {
    config: {
      ingress: upsertIngressRoutes(existingIngress, routes),
    },
  }, cfToken);
}

function hostingerApiKey(tokenOverride = null) {
  if (tokenOverride) return tokenOverride;
  return (
    process.env.HOSTINGER_CLOUD_PLAN_01_API_KEY ||
    process.env.HOSTINGER_API_TOKEN ||
    process.env.HOSTINGER_SHARED_MANAGER_01_API_KEY ||
    ""
  );
}

async function upsertHostingerCname(recordName, tunnelId, hostingerToken = null) {
  const target = `${tunnelId}.cfargotunnel.com.`;
  const res = await fetch(`https://developers.hostinger.com/api/v1/dns/zone/${encodeURIComponent(DNS_DOMAIN)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${hostingerApiKey(hostingerToken)}` },
    body: JSON.stringify({ records: [{ name: recordName, type: "CNAME", ttl: 300, content: target }] }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Hostinger DNS failed (${res.status}): ${txt.slice(0, 120)}`);
  }
  return await res.json();
}

function safeDnsLabel(value, fallback = "device") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return (normalized || fallback).slice(0, 32).replace(/^-+|-+$/g, "") || fallback;
}

function shortHash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 10);
}

function buildUserDeviceRoute({ userId, deviceId, requestedHostname }) {
  const requested = String(requestedHostname || "").trim().toLowerCase();
  if (requested) {
    if (!requested.endsWith(CONNECTOR_SUBDOMAIN_SUFFIX)) {
      const err = new Error(`hostname must end with ${CONNECTOR_SUBDOMAIN_SUFFIX}`);
      err.status = 400; err.code = "invalid_hostname"; throw err;
    }
    const recordName = requested.slice(0, -`.${DNS_DOMAIN}`.length);
    return { hostname: requested, recordName };
  }

  const userLabel = safeDnsLabel(userId, "user");
  const deviceLabel = safeDnsLabel(deviceId, "device");
  const readableLabel = `${userLabel}-${deviceLabel}`.slice(0, 63).replace(/-+$/g, "");
  const label = readableLabel || `${userLabel.slice(0, 18)}-${deviceLabel.slice(0, 24)}-${shortHash(`${userId}:${deviceId}`)}`.slice(0, 63).replace(/-+$/g, "");
  return {
    hostname: `${label}${CONNECTOR_SUBDOMAIN_SUFFIX}`,
    recordName: `${label}.${CONNECTOR_DNS_PARENT}`,
  };
}

function buildDefaultLocalAppRoutes({ hostname, includeN8n = true, includeBrowser = true, localApps = [] }) {
  const routes = [
    {
      app_key: "connector",
      route_mode: "host",
      hostname,
      path_prefix: null,
      local_port: CONNECTOR_PORT,
      service_url: `http://localhost:${CONNECTOR_PORT}`,
      public_url: `https://${hostname}`,
      status: "active",
    },
  ];
  if (includeN8n) {
    routes.push({
      app_key: "n8n",
      route_mode: "path",
      hostname,
      path_prefix: "/n8n",
      local_port: DEFAULT_N8N_PORT,
      service_url: `http://localhost:${DEFAULT_N8N_PORT}`,
      public_url: `https://${hostname}/n8n`,
      status: "planned",
    });
  }
  if (includeBrowser) {
    routes.push({
      app_key: "browser",
      route_mode: "path",
      hostname,
      path_prefix: "/browser",
      local_port: DEFAULT_BROWSER_PORT,
      service_url: `http://localhost:${DEFAULT_BROWSER_PORT}`,
      public_url: `https://${hostname}/browser`,
      status: "planned",
    });
  }
  for (const app of localApps) {
    const appKey = safeDnsLabel(app.app_key || app.key, "app");
    const pathPrefix = String(app.path_prefix || `/${appKey}`).trim();
    const localPort = Number(app.local_port || app.port || 0);
    if (!appKey || !pathPrefix.startsWith("/") || !localPort) continue;
    routes.push({
      app_key: appKey,
      route_mode: "path",
      hostname,
      path_prefix: pathPrefix,
      local_port: localPort,
      service_url: `http://localhost:${localPort}`,
      public_url: `https://${hostname}${pathPrefix}`,
      status: app.status || "planned",
    });
  }
  return routes;
}

function toCloudflareIngressRoutes(localAppRoutes = []) {
  return localAppRoutes
    .filter((route) => route.status === "active")
    .map((route) => ({
      hostname: route.hostname,
      path: route.route_mode === "path" ? `${route.path_prefix}*` : "",
      service: route.service_url,
    }));
}

async function seedLocalAppRoutes(pool, configId, routes = []) {
  for (const route of routes) {
    await pool.query(
      `INSERT INTO \`local_connector_app_routes\`
         (config_id, app_key, route_mode, hostname, path_prefix, local_port, service_url, public_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         route_mode = VALUES(route_mode),
         hostname = VALUES(hostname),
         path_prefix = VALUES(path_prefix),
         local_port = VALUES(local_port),
         service_url = VALUES(service_url),
         public_url = VALUES(public_url),
         status = VALUES(status)`,
      [
        configId,
        route.app_key,
        route.route_mode,
        route.hostname,
        route.path_prefix,
        route.local_port,
        route.service_url,
        route.public_url,
        route.status,
      ]
    );
  }
}

async function loadLocalAppRoutes(pool, configId) {
  try {
    const [routes] = await pool.query(
      "SELECT app_key, route_mode, hostname, path_prefix, local_port, service_url, public_url, status FROM `local_connector_app_routes` WHERE config_id = ? ORDER BY FIELD(app_key, 'connector', 'n8n', 'browser'), app_key",
      [configId]
    );
    return routes;
  } catch (err) {
    if (err.code === "ER_NO_SUCH_TABLE") return [];
    throw err;
  }
}

export {
  buildUserDeviceRoute,
  buildDefaultLocalAppRoutes,
  toCloudflareIngressRoutes,
  upsertIngressRoutes,
};

// ── Builders ──────────────────────────────────────────────────────────────────

function buildAllowlistEnvValue(aliases) {
  const obj = {};
  for (const a of aliases) {
    obj[a.alias] = { command: a.cmd, args: a.args || [], display_name: a.description || a.alias, allow_extra_args: !!a.allow_extra_args };
  }
  return JSON.stringify(obj);
}

function buildInstallScript({ cfToken, connectorSecret, tunnelUrl, aliases, port }) {
  const allowlistVal = buildAllowlistEnvValue(aliases);
  return [
    "@echo off",
    "setlocal EnableDelayedExpansion",
    "REM Mad4B Local Connector — auto-provisioned by platform",
    "REM Run once as Administrator: installs cloudflared + Node service via NSSM.",
    "",
    "net session >nul 2>&1",
    "if %ERRORLEVEL% neq 0 (echo ERROR: Run as Administrator. & pause & exit /b 1)",
    "",
    "set CF_SERVICE=cloudflared",
    "set NODE_SERVICE=local-connector",
    "set CONNECTOR_DIR=%~dp0",
    "set SERVER_MJS=%~dp0server.mjs",
    "",
    "REM ── 1. Install cloudflared ──",
    "where cloudflared >nul 2>&1 || (winget install Cloudflare.cloudflared -e --silent)",
    "sc query %CF_SERVICE% >nul 2>&1 || (cloudflared service install " + cfToken + ")",
    "sc query %CF_SERVICE% >nul 2>&1 && net start %CF_SERVICE% >nul 2>&1",
    "",
    "REM ── 2. Write .env ──",
    `echo BACKEND_API_KEY=${connectorSecret}> "%~dp0.env"`,
    `echo CONNECTOR_PORT=${port}>> "%~dp0.env"`,
    "echo MAIN_API_URL=https://api.mad4b.com>> \"%~dp0.env\"",
    "echo CONNECTOR_SHELL_ENABLED=true>> \"%~dp0.env\"",
    "echo CONNECTOR_FILES_ENABLED=true>> \"%~dp0.env\"",
    "echo CONNECTOR_APPS_ENABLED=true>> \"%~dp0.env\"",
    "echo CONNECTOR_FETCH_UPLOAD_ENABLED=true>> \"%~dp0.env\"",
    "echo CONNECTOR_N8N_ENABLED=true>> \"%~dp0.env\"",
    "echo N8N_COMMAND=D:\\npm-global\\n8n.cmd>> \"%~dp0.env\"",
    "echo N8N_USER_FOLDER=D:\\n8n-data>> \"%~dp0.env\"",
    "echo N8N_PORT=5678>> \"%~dp0.env\"",
    "echo N8N_LISTEN_ADDRESS=127.0.0.1>> \"%~dp0.env\"",
    "echo N8N_PUBLIC_URL=https://n8n.mad4b.com/>> \"%~dp0.env\"",
    `echo CONNECTOR_SHELL_ALLOWLIST=${allowlistVal}>> "%~dp0.env"`,
    "",
    "REM ── 3. Install Node connector as Windows service via NSSM ──",
    "where nssm >nul 2>&1 || (winget install NSSM.NSSM -e --silent)",
    "sc query %NODE_SERVICE% >nul 2>&1",
    "if %ERRORLEVEL% neq 0 (",
    "  for /f \"tokens=*\" %%p in ('where node') do set NODE_EXE=%%p",
    "  nssm install %NODE_SERVICE% \"!NODE_EXE!\" \"\\\"%SERVER_MJS%\\\"\"",
    "  nssm set %NODE_SERVICE% AppDirectory \"%CONNECTOR_DIR%\"",
    "  nssm set %NODE_SERVICE% AppStdout \"%CONNECTOR_DIR%connector.log\"",
    "  nssm set %NODE_SERVICE% AppStderr \"%CONNECTOR_DIR%connector-error.log\"",
    "  nssm set %NODE_SERVICE% AppRotateFiles 1",
    "  nssm set %NODE_SERVICE% AppRotateBytes 5242880",
    "  nssm set %NODE_SERVICE% Start SERVICE_AUTO_START",
    "  nssm set %NODE_SERVICE% ObjectName LocalSystem",
    ")",
    "net start %NODE_SERVICE% >nul 2>&1",
    "",
    "echo.",
    `echo Done. Tunnel: ${tunnelUrl}`,
    "echo Connector service running on port " + port,
    "pause",
  ].join("\r\n");
}

function buildConnectorEnv({ connectorSecret, aliases, port }) {
  const allowlistVal = buildAllowlistEnvValue(aliases);
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
    `CONNECTOR_SHELL_ALLOWLIST=${allowlistVal}`,
  ].join("\r\n");
}

function buildStartConnectorBat() {
  return [
    "@echo off",
    "setlocal",
    "cd /d \"%~dp0\"",
    "node \"%~dp0server.mjs\" >> \"%~dp0connector.log\" 2>&1",
  ].join("\r\n");
}

function buildInstallPowerShell({ cfToken, connectorSecret, tunnelUrl, aliases, port }) {
  const envText = buildConnectorEnv({ connectorSecret, aliases, port });
  return [
    "# Mad4B Local Connector — run once as Administrator",
    "$ErrorActionPreference = 'Stop'",
    "$Root = Split-Path -Parent $MyInvocation.MyCommand.Path",
    "$CfService   = 'cloudflared'",
    "$NodeService = 'local-connector'",
    "$ServerMjs   = Join-Path $Root 'server.mjs'",
    "",
    "# 1. Install Node.js if missing",
    "if (-not (Get-Command node -ErrorAction SilentlyContinue)) {",
    "  Write-Host 'Installing Node.js LTS...'",
    "  winget install OpenJS.NodeJS.LTS -e --silent",
    "  $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')",
    "}",
    "",
    "# 2. Download connector agent",
    "Write-Host 'Downloading connector agent...'",
    "Invoke-WebRequest -Uri 'https://auth.mad4b.com/connector-agent/server.mjs' -OutFile $ServerMjs -UseBasicParsing",
    "",
    "# 3. Write .env",
    "$EnvText = @'",
    envText,
    "'@",
    "Set-Content -Path (Join-Path $Root '.env') -Value $EnvText -Encoding ascii",
    "",
    "# 4. Part A — cloudflared tunnel service",
    "if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {",
    "  Write-Host 'Installing cloudflared...'",
    "  winget install Cloudflare.cloudflared -e --silent",
    "}",
    "$cfSvc = Get-Service -Name $CfService -ErrorAction SilentlyContinue",
    "if (-not $cfSvc) {",
    `  cloudflared service install ${cfToken}`,
    "}",
    "Start-Service $CfService -ErrorAction SilentlyContinue",
    "",
    "# 4. Part B — Node connector as Windows service (NSSM)",
    "if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {",
    "  Write-Host 'Installing NSSM...'",
    "  winget install NSSM.NSSM -e --silent",
    "}",
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
    "Start-Service $NodeService -ErrorAction SilentlyContinue",
    "Start-Sleep -Seconds 3",
    "$nodeSvc = Get-Service -Name $NodeService -ErrorAction SilentlyContinue",
    "if ($nodeSvc?.Status -eq 'Running') { Write-Host \"Connector running on port ${port}.\" }",
    "else { Write-Host 'WARN: connector service did not start. Check connector-error.log' }",
    "",
    `Write-Host "Done. Tunnel: ${tunnelUrl}"`,
  ].join("\r\n");
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function provisionLocalConnectorInstall(req, body = {}) {
  const {
    user_id, tenant_id, device_id,
    hostname = null,
    custom_aliases = [],
    local_apps = [],
    reprovision = false,
  } = body || {};
  if (!user_id || !tenant_id || !device_id) {
    throw httpError(400, "missing_fields", "user_id, tenant_id, device_id required.");
  }

  const pool = getPool();
  const principal = await resolveRequestedLocalPrincipal(req, { user_id, tenant_id });
  const resolvedUserId = principal.userId;
  const resolvedTenantId = principal.tenantId;
  const provisioningCredentials = await resolveProvisioningCredentials(req, principal, body || {});
  const accountId = provisioningCredentials.cloudflareAccountId;
  if (!accountId) throw httpError(500, "missing_config", "Cloudflare account id not configured.");

  const [[tenant]] = await pool.query("SELECT tenant_id FROM `tenants` WHERE tenant_id = ? LIMIT 1", [resolvedTenantId]);
  if (!tenant) throw httpError(404, "tenant_not_found", "Tenant not found.");

  const [[existing]] = await pool.query(
    "SELECT config_id, cf_tunnel_id, cf_token, connector_secret, tunnel_url FROM `local_connector_user_configs` WHERE user_id = ? AND tenant_id = ? AND device_id = ? LIMIT 1",
    [resolvedUserId, resolvedTenantId, device_id]
  );

  let configId = existing?.config_id || randomUUID();
  let tunnelId = existing?.cf_tunnel_id || null;
  let tunnelToken = existing?.cf_token || null;
  let tunnelUrl = existing?.tunnel_url || null;
  let connectorSecret = existing?.connector_secret || null;

  if (!existing || reprovision) {
    const tunnelName = `${safeDnsLabel(resolvedUserId, "user")}-${safeDnsLabel(device_id, "device")}-connector`.slice(0, 128);
    const provisioned = await provisionTunnel(accountId, tunnelName, provisioningCredentials.cloudflareToken);
    tunnelId = provisioned.tunnelId;
    tunnelToken = provisioned.token;
    tunnelUrl = `https://${tunnelId}.cfargotunnel.com`;
    connectorSecret = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");

    await pool.query(
      `INSERT INTO \`local_connector_user_configs\`
         (config_id, user_id, tenant_id, device_id, tunnel_url, connector_secret, cf_tunnel_id, cf_tunnel_name, cf_token, is_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         tunnel_url = VALUES(tunnel_url),
         connector_secret = VALUES(connector_secret),
         cf_tunnel_id = VALUES(cf_tunnel_id),
         cf_tunnel_name = VALUES(cf_tunnel_name),
         cf_token = VALUES(cf_token),
         is_enabled = 1`,
      [configId, resolvedUserId, resolvedTenantId, device_id, tunnelUrl, connectorSecret, tunnelId, tunnelName, tunnelToken]
    );
    await publishPrivateTunnelIngress(accountId, tunnelId, `http://localhost:${CONNECTOR_PORT}`, provisioningCredentials.cloudflareToken);
  }

  const [[cfgRow]] = await pool.query(
    "SELECT config_id FROM `local_connector_user_configs` WHERE user_id = ? AND tenant_id = ? AND device_id = ? LIMIT 1",
    [resolvedUserId, resolvedTenantId, device_id]
  );
  const finalConfigId = cfgRow.config_id;

  const allAliases = [...DEFAULT_WINDOWS_ALIASES, ...custom_aliases];
  for (const entry of allAliases) {
    const cmdTemplate = [entry.cmd, ...(entry.args || [])].join(" ");
    await pool.query(
      `INSERT IGNORE INTO \`local_connector_shell_allowlists\`
         (config_id, alias, command_template, allow_extra_args, description)
       VALUES (?, ?, ?, ?, ?)`,
      [finalConfigId, entry.alias, cmdTemplate, entry.allow_extra_args ? 1 : 0, entry.description || null]
    );
  }

  const installPowerShell = buildInstallPowerShell({ cfToken: tunnelToken, connectorSecret, tunnelUrl, aliases: allAliases, port: CONNECTOR_PORT });
  const connectorEnv = buildConnectorEnv({ connectorSecret, aliases: allAliases, port: CONNECTOR_PORT });
  const startConnectorBat = buildStartConnectorBat();
  const installScript = buildInstallScript({ cfToken: tunnelToken, connectorSecret, tunnelUrl, aliases: allAliases, port: CONNECTOR_PORT });

  return {
    ok: true,
    config_id: finalConfigId,
    device_id,
    tunnel_url: tunnelUrl,
    connector_secret: connectorSecret,
    cf_tunnel_id: tunnelId,
    credential_source: provisioningCredentials.source,
    app_routes: await loadLocalAppRoutes(pool, finalConfigId),
    installation: {
      aliases: allAliases.map((a) => a.alias),
      install_bat: installScript,
      install_ps1: installPowerShell,
      files: {
        ".env": connectorEnv,
        "start-connector.bat": startConnectorBat,
        "install-local-connector.ps1": installPowerShell,
        "install.bat": installScript,
      },
      local_runtime: {
        port: CONNECTOR_PORT,
        env_file: ".env",
        start_command: "start-connector.bat",
        tunnel_command: `cloudflared service install ${tunnelToken}`,
      },
      steps: [
        "1. Put server.mjs and install-local-connector.ps1 in the local-connector folder.",
        "2. Run install-local-connector.ps1 as Administrator — writes .env, installs cloudflared, starts server.mjs.",
        "3. On later boots run start-connector.bat or configure it as a Windows startup task.",
        `4. Test: GET /local-connector/health?user_id=${resolvedUserId}&tenant_id=${resolvedTenantId}&device_id=${device_id}`,
      ],
    },
  };
}

export function buildLocalConnectorInstallRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // ── POST /local-connector/install ─────────────────────────────────────────
  // Governs the full install lifecycle for any user/device.
  // Creates a Cloudflare tunnel, adds DNS CNAME, seeds DB config + allowlist,
  // returns a ready-to-run install.bat. Idempotent per user+device.
  router.post("/local-connector/install", requireBackendApiKey, async (req, res) => {
    try {
      const {
        user_id, tenant_id, device_id,
        hostname = null,
        custom_aliases = [],
        reprovision = false,
      } = req.body || {};

      // user_id and tenant_id are optional in the body when a user JWT is present —
      // resolveRequestedLocalPrincipal reads them from the token.
      const isUserAuth = req.auth?.mode === "user_jwt" || req.auth?.mode === "api_credential";
      if (!device_id) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "device_id is required." } });
      }
      if (!isUserAuth && (!user_id || !tenant_id)) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "user_id and tenant_id are required for admin/service calls." } });
      }

      const pool = getPool();
      const principal = await resolveRequestedLocalPrincipal(req, { user_id, tenant_id });
      const resolvedUserId = principal.userId;
      const resolvedTenantId = principal.tenantId;
      const provisioningCredentials = await resolveProvisioningCredentials(req, principal, req.body || {});
      const accountId = provisioningCredentials.cloudflareAccountId;
      if (!accountId) return res.status(500).json({ ok: false, error: { code: "missing_config", message: "Cloudflare account id not configured." } });

      const [[tenant]] = await pool.query("SELECT tenant_id FROM `tenants` WHERE tenant_id = ? LIMIT 1", [resolvedTenantId]);
      if (!tenant) return res.status(404).json({ ok: false, error: { code: "tenant_not_found" } });

      // Lookup by user_id + device_id only — a device belongs to a user, not a specific
      // tenant context. The tenant_id on the config may differ from the caller's active tenant.
      const [[existing]] = await pool.query(
        "SELECT config_id, cf_tunnel_id, cf_token, connector_secret, tunnel_url, tenant_id FROM `local_connector_user_configs` WHERE user_id = ? AND device_id = ? LIMIT 1",
        [resolvedUserId, device_id]
      );

      let configId, tunnelId, tunnelToken, tunnelUrl, connectorSecret, dnsRecordName;

      if (existing && !reprovision) {
        configId = existing.config_id;
        tunnelId = existing.cf_tunnel_id;
        tunnelToken = existing.cf_token;
        tunnelUrl = existing.tunnel_url;
        connectorSecret = existing.connector_secret;
      } else {
        const tunnelName = `${safeDnsLabel(resolvedUserId, "user")}-${safeDnsLabel(device_id, "device")}-connector`.slice(0, 128);
        const { tunnelId: newTunnelId, token } = await provisionTunnel(accountId, tunnelName, provisioningCredentials.cloudflareToken);
        await publishPrivateTunnelIngress(accountId, newTunnelId, `http://localhost:${CONNECTOR_PORT}`, provisioningCredentials.cloudflareToken);

        tunnelId = newTunnelId;
        tunnelToken = token;
        tunnelUrl = `https://${newTunnelId}.cfargotunnel.com`;
        connectorSecret = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
        configId = existing?.config_id || randomUUID();

        await pool.query(
          `INSERT INTO \`local_connector_user_configs\`
             (config_id, user_id, tenant_id, device_id, tunnel_url, connector_secret, cf_tunnel_id, cf_tunnel_name, cf_token, is_enabled)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE
             tunnel_url = VALUES(tunnel_url),
             connector_secret = VALUES(connector_secret),
             cf_tunnel_id = VALUES(cf_tunnel_id),
             cf_tunnel_name = VALUES(cf_tunnel_name),
             cf_token = VALUES(cf_token),
             is_enabled = 1`,
          [configId, resolvedUserId, resolvedTenantId, device_id, tunnelUrl, connectorSecret, tunnelId, tunnelName, tunnelToken]
        );
      }

      // Seed allowlist (idempotent)
      const [[cfgRow]] = await pool.query(
        "SELECT config_id FROM `local_connector_user_configs` WHERE user_id = ? AND device_id = ? LIMIT 1",
        [resolvedUserId, device_id]
      );
      const finalConfigId = cfgRow.config_id;
      const hostnameForRoutes = tunnelUrl ? new URL(tunnelUrl).hostname : null;
      const localAppRoutes = hostnameForRoutes ? buildDefaultLocalAppRoutes({
        hostname: hostnameForRoutes,
        localApps: req.body?.local_apps || [],
      }) : [];
      if (localAppRoutes.length) {
        await seedLocalAppRoutes(pool, finalConfigId, localAppRoutes);
        if (tunnelId) {
          await publishTunnelIngressRoutes(
            accountId,
            tunnelId,
            toCloudflareIngressRoutes(localAppRoutes),
            provisioningCredentials.cloudflareToken
          );
        }
      }

      const allAliases = [...DEFAULT_WINDOWS_ALIASES, ...custom_aliases];
      for (const entry of allAliases) {
        const cmdTemplate = [entry.cmd, ...(entry.args || [])].join(" ");
        await pool.query(
          `INSERT IGNORE INTO \`local_connector_shell_allowlists\`
             (config_id, alias, command_template, allow_extra_args, description)
           VALUES (?, ?, ?, ?, ?)`,
          [finalConfigId, entry.alias, cmdTemplate, entry.allow_extra_args ? 1 : 0, entry.description || null]
        );
      }

      const installScript = buildInstallScript({
        cfToken: tunnelToken,
        connectorSecret,
        tunnelUrl,
        aliases: allAliases,
        port: CONNECTOR_PORT,
      });
      const connectorEnv = buildConnectorEnv({ connectorSecret, aliases: allAliases, port: CONNECTOR_PORT });
      const startConnectorBat = buildStartConnectorBat();
      const installPowerShell = buildInstallPowerShell({
        cfToken: tunnelToken,
        connectorSecret,
        tunnelUrl,
        aliases: allAliases,
        port: CONNECTOR_PORT,
      });

      return res.status(200).json({
        ok: true,
        config_id: finalConfigId,
        device_id,
        tunnel_url: tunnelUrl,
        connector_secret: connectorSecret,
        cf_tunnel_id: tunnelId,
        credential_source: provisioningCredentials.source,
        server_env: {
          CONNECTOR_LOCAL_API_KEY: connectorSecret,
          instruction: `Set CONNECTOR_LOCAL_API_KEY=${connectorSecret} in hPanel environment variables for the connector.mad4b.com Node.js app.`,
        },
        app_routes: await loadLocalAppRoutes(pool, finalConfigId),
        installation: {
          aliases: allAliases.map((a) => a.alias),
          install_bat: installScript,
          install_ps1: installPowerShell,
          files: {
            ".env": connectorEnv,
            "start-connector.bat": startConnectorBat,
            "install-local-connector.ps1": installPowerShell,
            "install.bat": installScript,
          },
          local_runtime: {
            port: CONNECTOR_PORT,
            env_file: ".env",
            start_command: "start-connector.bat",
            tunnel_command: `cloudflared service install ${tunnelToken}`,
          },
          steps: [
            "1. Put server.mjs and install-local-connector.ps1 in the local-connector folder.",
            "2. Run install-local-connector.ps1 as Administrator — writes .env, installs cloudflared, starts server.mjs.",
            "3. On later boots run start-connector.bat or configure it as a Windows startup task.",
            `4. Set CONNECTOR_LOCAL_API_KEY=${connectorSecret} in hPanel env vars for connector.mad4b.com.`,
            `5. Test: GET /local-connector/health?user_id=${user_id}&tenant_id=${tenant_id}&device_id=${device_id}`,
          ],
        },
      });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "install_failed", message: err.message } });
    }
  });

  // ── GET /local-connector/install/status ───────────────────────────────────
  router.get("/local-connector/install/status", requireBackendApiKey, async (req, res) => {
    try {
      const { user_id, tenant_id, device_id } = req.query;
      const isUserAuthStatus = req.auth?.mode === "user_jwt" || req.auth?.mode === "api_credential";
      if (!device_id) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "device_id is required." } });
      }
      if (!isUserAuthStatus && (!user_id || !tenant_id)) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "user_id and tenant_id are required for admin/service calls." } });
      }
      const principal = await resolveRequestedLocalPrincipal(req, { user_id, tenant_id });
      const [[config]] = await getPool().query(
        "SELECT config_id, tunnel_url, cf_tunnel_id, cf_tunnel_name, is_enabled, created_at, updated_at FROM `local_connector_user_configs` WHERE user_id = ? AND tenant_id = ? AND device_id = ? LIMIT 1",
        [principal.userId, principal.tenantId, device_id]
      );
      if (!config) return res.status(200).json({ ok: true, installed: false });

      const [aliases] = await getPool().query(
        "SELECT alias, command_template, allow_extra_args, description FROM `local_connector_shell_allowlists` WHERE config_id = ?",
        [config.config_id]
      );
      const appRoutes = await loadLocalAppRoutes(getPool(), config.config_id);
      return res.status(200).json({ ok: true, installed: true, config, aliases, app_routes: appRoutes });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "status_failed", message: err.message } });
    }
  });

  // ── DELETE /local-connector/uninstall ─────────────────────────────────────
  router.delete("/local-connector/uninstall", requireBackendApiKey, async (req, res) => {
    try {
      const { user_id, tenant_id, device_id } = req.body || {};
      const isUserAuthUninstall = req.auth?.mode === "user_jwt" || req.auth?.mode === "api_credential";
      if (!device_id) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "device_id is required." } });
      }
      if (!isUserAuthUninstall && (!user_id || !tenant_id)) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "user_id and tenant_id are required for admin/service calls." } });
      }
      const principal = await resolveRequestedLocalPrincipal(req, { user_id, tenant_id });
      const [result] = await getPool().query(
        "UPDATE `local_connector_user_configs` SET is_enabled = 0 WHERE user_id = ? AND tenant_id = ? AND device_id = ?",
        [principal.userId, principal.tenantId, device_id]
      );
      if (result.affectedRows === 0) return res.status(404).json({ ok: false, error: { code: "config_not_found" } });
      return res.status(200).json({ ok: true, message: "Local connector disabled for this device." });
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "uninstall_failed", message: err.message } });
    }
  });

  return router;
}
