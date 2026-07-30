import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { getPool } from "../db.js";

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";
const DEVICE_LINK_TTL_SECONDS = 10 * 60;
const POLL_INTERVAL_SECONDS = 3;
const DEVICE_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;
const PRIVILEGED_DEVICE_AUTH_MAX_AGE_SECONDS = DEVICE_TOKEN_TTL_SECONDS;
const PLATFORM_MANAGED_N8N_URL = "https://n8n.mad4b.com/";

function nowMs() {
  return Date.now();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function randomDisplayCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i += 1) out += alphabet[crypto.randomInt(0, alphabet.length)];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

function cleanId(value, { fallback = "", max = 128 } = {}) {
  const raw = String(value || "").trim().slice(0, max);
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return safe || fallback;
}

function cleanText(value, max = 255) {
  return String(value || "").trim().slice(0, max);
}

function jsonString(value) {
  try {
    return JSON.stringify(value || {});
  } catch {
    return "{}";
  }
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function getBaseUrl(req) {
  const proto = String(req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim() || "https";
  const host = req.get("host") || "auth.mad4b.com";
  return (process.env.PUBLIC_BASE_URL || `${proto}://${host}`).replace(/\/$/, "");
}

function defaultN8nProfile({ device }) {
  const tenantSlug = cleanId(device.tenant_id || "tenant", { fallback: "tenant", max: 64 });
  const userSlug = cleanId(device.user_id || "user", { fallback: "user", max: 64 });
  return {
    profile_source: "default_local_profile",
    lifecycle_mode: "local_manager_autopilot",
    install_mode: "npm_global_if_missing",
    local_only: true,
    command_path: "D:\\npm-global\\n8n.cmd",
    npm_prefix: "D:\\npm-global",
    user_folder: `D:\\Mad4B\\Tenants\\${tenantSlug}\\Users\\${userSlug}\\n8n-data`,
    runtime_role: "tenant_local",
    exposure_scope: "local_only",
    reserved_platform_domain: false,
    local_url: "http://127.0.0.1:5682/",
    public_url: "",
    port: 5682,
    listen_address: "127.0.0.1",
    task_broker_port: 5683,
    task_broker_url: "http://127.0.0.1:5683/",
    task_broker_listen_address: "127.0.0.1",
    launcher_health_check_port: 5684,
    editor_base_url: "http://127.0.0.1:5682/",
    webhook_url: "http://127.0.0.1:5682/",
    secrets_included: false,
  };
}

function sanitizeN8nProfileConfig(value, { device }) {
  const fallback = defaultN8nProfile({ device });
  const cfg = parseJson(value) || {};
  const requestedPublicUrl = cleanText(cfg.public_url || cfg.tunnel_url || "", 255);
  const runtimeRole = cleanText(cfg.runtime_role || fallback.runtime_role || "tenant_local", 80) || "tenant_local";
  const isPlatformManaged = runtimeRole === "platform_managed" || cfg.reserved_platform_domain === true;
  const publicUrl = !isPlatformManaged && requestedPublicUrl.replace(/\/$/, "") === PLATFORM_MANAGED_N8N_URL.replace(/\/$/, "") ? "" : requestedPublicUrl;
  const requestedPort = Math.min(Math.max(parseInt(cfg.port || fallback.port, 10) || fallback.port, 1024), 65535);
  const port = !isPlatformManaged && requestedPort === 5678 ? fallback.port : requestedPort;
  const requestedLocalUrl = cleanText(cfg.local_url || fallback.local_url, 255) || fallback.local_url;
  const localUrl = !isPlatformManaged && requestedLocalUrl.includes("127.0.0.1:5678") ? fallback.local_url : requestedLocalUrl;
  const listenAddress = cleanText(cfg.listen_address || fallback.listen_address, 64) || fallback.listen_address;
  const taskBrokerPort = Math.min(Math.max(parseInt(cfg.task_broker_port || fallback.task_broker_port, 10) || fallback.task_broker_port, 1024), 65535);
  const taskBrokerUrl = cleanText(cfg.task_broker_url || `http://127.0.0.1:${taskBrokerPort}/`, 255) || `http://127.0.0.1:${taskBrokerPort}/`;
  const taskBrokerListenAddress = cleanText(cfg.task_broker_listen_address || fallback.task_broker_listen_address || listenAddress, 64) || listenAddress;
  const launcherHealthCheckPort = Math.min(Math.max(parseInt(cfg.launcher_health_check_port || fallback.launcher_health_check_port, 10) || fallback.launcher_health_check_port, 1024), 65535);
  const userFolder = cleanText(cfg.user_folder || fallback.user_folder, 260) || fallback.user_folder;
  const commandPath = cleanText(cfg.command_path || fallback.command_path, 260) || fallback.command_path;
  const editorBaseUrl = cleanText(cfg.editor_base_url || publicUrl || localUrl, 255) || localUrl;
  const webhookUrl = cleanText(cfg.webhook_url || publicUrl || localUrl, 255) || localUrl;
  return {
    ...fallback,
    profile_source: cfg.profile_source || "connected_systems",
    lifecycle_mode: cleanText(cfg.lifecycle_mode || fallback.lifecycle_mode, 80) || fallback.lifecycle_mode,
    install_mode: cleanText(cfg.install_mode || fallback.install_mode, 80) || fallback.install_mode,
    runtime_role: isPlatformManaged ? "platform_managed" : cleanText(cfg.runtime_role || fallback.runtime_role || "tenant_local", 80),
    exposure_scope: isPlatformManaged ? "public_platform_domain" : cleanText(cfg.exposure_scope || fallback.exposure_scope || "local_only", 80),
    reserved_platform_domain: Boolean(isPlatformManaged),
    local_only: isPlatformManaged ? false : cfg.local_only !== false,
    command_path: commandPath,
    npm_prefix: cleanText(cfg.npm_prefix || fallback.npm_prefix, 260) || fallback.npm_prefix,
    user_folder: userFolder,
    local_url: localUrl,
    public_url: publicUrl,
    port,
    listen_address: listenAddress,
    task_broker_port: taskBrokerPort,
    task_broker_url: taskBrokerUrl,
    task_broker_listen_address: taskBrokerListenAddress,
    launcher_health_check_port: launcherHealthCheckPort,
    editor_base_url: editorBaseUrl,
    webhook_url: webhookUrl,
    secrets_included: false,
  };
}

async function resolveOrCreateTenantN8nProfile(device) {
  const pool = getPool();
  const systemKey = `local_n8n:${cleanId(device.device_id, { fallback: "device", max: 64 })}`;
  const [rows] = await pool.query(
    `SELECT cs.*, i.installation_id, i.meta_json AS installation_meta_json
       FROM \`connected_systems\` cs
       LEFT JOIN \`installations\` i ON i.system_id = cs.system_id
        AND i.tenant_id = cs.tenant_id
        AND i.status = 'active'
        AND JSON_UNQUOTE(JSON_EXTRACT(i.meta_json, '$.user_id')) = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(i.meta_json, '$.device_id')) = ?
      WHERE cs.tenant_id = ?
        AND cs.system_key = ?
        AND cs.provider_family = 'n8n'
        AND cs.status IN ('active','pending')
      ORDER BY FIELD(cs.status, 'active', 'pending'), cs.updated_at DESC
      LIMIT 1`,
    [device.user_id, device.device_id, device.tenant_id || "", systemKey]
  );
  if (rows[0]) {
    return {
      system_id: rows[0].system_id,
      installation_id: rows[0].installation_id || null,
      display_name: rows[0].display_name,
      status: rows[0].status,
      profile: sanitizeN8nProfileConfig(rows[0].config_json, { device }),
      created: false,
    };
  }

  const systemId = crypto.randomUUID();
  const installationId = crypto.randomUUID();
  const profile = defaultN8nProfile({ device });
  await pool.query(
    `INSERT INTO \`connected_systems\`
      (system_id, tenant_id, system_key, display_name, provider_family, provider_domain, connector_family, auth_type, service_mode, self_serve_capable, assisted_capable, managed_capable, status, config_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'n8n', 'n8n.io', 'local_desktop', 'local_manual', 'self_serve', 1, 0, 0, 'active', ?, NOW(), NOW())`,
    [systemId, device.tenant_id || "", systemKey, "Local n8n", jsonString(profile)]
  );
  await pool.query(
    `INSERT INTO \`installations\`
      (installation_id, system_id, tenant_id, scope, credential_ref, status, installed_at, expires_at, meta_json)
     VALUES (?, ?, ?, 'local_device', NULL, 'active', NOW(), NULL, ?)`,
    [installationId, systemId, device.tenant_id || "", jsonString({ user_id: device.user_id, device_id: device.device_id, autopilot_enabled: true, local_only: true, writes_local_files: true, secrets_included: false })]
  );
  return { system_id: systemId, installation_id: installationId, display_name: "Local n8n", status: "active", profile, created: true };
}

async function ensureDeviceLinkTable() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS \`local_manager_device_link_sessions\` (
      \`session_id\` VARCHAR(64) NOT NULL,
      \`display_code\` VARCHAR(16) NOT NULL,
      \`display_code_hash\` VARCHAR(64) NOT NULL,
      \`poll_token_hash\` VARCHAR(64) NOT NULL,
      \`status\` VARCHAR(24) NOT NULL DEFAULT 'pending',
      \`device_id\` VARCHAR(128) NOT NULL,
      \`hostname\` VARCHAR(255) NULL,
      \`platform\` VARCHAR(32) NULL,
      \`app_version\` VARCHAR(80) NULL,
      \`user_id\` VARCHAR(64) NULL,
      \`tenant_id\` VARCHAR(64) NULL,
      \`approved_at\` DATETIME NULL,
      \`completed_at\` DATETIME NULL,
      \`expires_at\` DATETIME NOT NULL,
      \`metadata_json\` JSON NULL,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`session_id\`),
      UNIQUE KEY \`uq_local_manager_display_code_hash\` (\`display_code_hash\`),
      KEY \`idx_local_manager_device_link_status\` (\`status\`, \`expires_at\`),
      KEY \`idx_local_manager_device_link_owner\` (\`user_id\`, \`tenant_id\`),
      KEY \`idx_local_manager_device_link_device\` (\`device_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

function sanitizeSession(row) {
  if (!row) return null;
  return {
    session_id: row.session_id,
    status: row.status,
    device_id: row.device_id,
    hostname: row.hostname || null,
    platform: row.platform || null,
    app_version: row.app_version || null,
    user_id: row.user_id || null,
    tenant_id: row.tenant_id || null,
    approved_at: row.approved_at ? new Date(row.approved_at).toISOString() : null,
    completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    expires_at: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    metadata: parseJson(row.metadata_json),
  };
}

async function fetchUserMembership({ userId, tenantId = null }) {
  const pool = getPool();
  const [userRows] = await pool.query(
    `SELECT user_id, email, display_name, status FROM \`users\` WHERE user_id = ? LIMIT 1`,
    [userId]
  );
  const user = userRows[0] || null;
  if (!user || user.status !== "active") return null;

  if (tenantId) {
    const [rows] = await pool.query(
      `SELECT m.tenant_id, m.role, m.status, t.display_name AS tenant_display_name
         FROM \`memberships\` m
         LEFT JOIN \`tenants\` t ON t.tenant_id = m.tenant_id
        WHERE m.user_id = ? AND m.tenant_id = ? AND m.status = 'active'
        LIMIT 1`,
      [userId, tenantId]
    );
    return rows[0] ? { user, membership: rows[0] } : null;
  }

  const [rows] = await pool.query(
    `SELECT m.tenant_id, m.role, m.status, t.display_name AS tenant_display_name
       FROM \`memberships\` m
       LEFT JOIN \`tenants\` t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ? AND m.status = 'active'
      ORDER BY m.granted_at ASC
      LIMIT 1`,
    [userId]
  );
  return rows[0] ? { user, membership: rows[0] } : { user, membership: { tenant_id: null, role: null, status: null, tenant_display_name: null } };
}

async function resolveCanonicalConnectorConfig({ userId, tenantId, deviceId, hostname }) {
  const pool = getPool();
  const candidateIds = [...new Set([deviceId, hostname].map((value) => cleanId(value, { max: 128 })).filter(Boolean))];

  if (candidateIds.length) {
    const placeholders = candidateIds.map(() => "?").join(", ");
    const [exactRows] = await pool.query(
      `SELECT config_id, user_id, tenant_id, device_id
         FROM \`local_connector_user_configs\`
        WHERE is_enabled = 1
          AND user_id = ?
          AND device_id IN (${placeholders})
        ORDER BY CASE WHEN tenant_id = ? THEN 0 WHEN tenant_id = '00000000-0000-0000-0000-000000000000' THEN 1 ELSE 2 END,
                 COALESCE(last_health_at, updated_at, created_at) DESC
        LIMIT 1`,
      [userId, ...candidateIds, tenantId || ""]
    );
    if (exactRows[0]) return exactRows[0];
  }

  const [fallbackRows] = await pool.query(
    `SELECT config_id, user_id, tenant_id, device_id
       FROM \`local_connector_user_configs\`
      WHERE is_enabled = 1
        AND user_id = ?
        AND (? IS NULL OR tenant_id = ? OR tenant_id = '00000000-0000-0000-0000-000000000000')
        AND COALESCE(tunnel_url, public_gateway_url, device_runtime_url, admin_recovery_url) IS NOT NULL
      ORDER BY CASE WHEN tenant_id = ? THEN 0 WHEN tenant_id = '00000000-0000-0000-0000-000000000000' THEN 1 ELSE 2 END,
               COALESCE(last_health_at, updated_at, created_at) DESC
      LIMIT 2`,
    [userId, tenantId || null, tenantId || null, tenantId || ""]
  );

  return fallbackRows.length === 1 ? fallbackRows[0] : null;
}

async function upsertConnectorAlias({ aliasDeviceId, canonical, principal }) {
  const pool = getPool();
  const alias = cleanId(aliasDeviceId, { max: 128 });
  const canonicalDeviceId = cleanId(canonical?.device_id, { max: 128 });
  if (!alias || !canonicalDeviceId || alias.toLowerCase() === canonicalDeviceId.toLowerCase()) return null;

  const reason = "Auto-created from Local Manager device-link approval so app hostname/device id resolves to the executable local connector device.";
  const [updateResult] = await pool.query(
    `UPDATE \`local_connector_device_aliases\`
        SET canonical_device_id = ?, canonical_config_id = ?, user_id = ?, tenant_id = ?, reason = ?, status = 'active', updated_at = NOW()
      WHERE alias_device_id = ?
        AND (user_id = ? OR user_id IS NULL)
      LIMIT 1`,
    [canonicalDeviceId, canonical.config_id, principal.user_id, principal.tenant_id || null, reason, alias, principal.user_id]
  );

  if (!Number(updateResult?.affectedRows || 0)) {
    await pool.query(
      `INSERT INTO \`local_connector_device_aliases\`
        (alias_device_id, canonical_device_id, canonical_config_id, user_id, tenant_id, reason, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', NOW(), NOW())`,
      [alias, canonicalDeviceId, canonical.config_id, principal.user_id, principal.tenant_id || null, reason]
    );
  }

  return {
    alias_device_id: alias,
    canonical_device_id: canonicalDeviceId,
    canonical_config_id: canonical.config_id,
    status: "active",
  };
}

async function ensureLocalConnectorAliasForDeviceLink({ session, principal }) {
  try {
    const canonical = await resolveCanonicalConnectorConfig({
      userId: principal.user_id,
      tenantId: principal.tenant_id,
      deviceId: session.device_id,
      hostname: session.hostname,
    });
    if (!canonical) {
      return { attempted: true, resolved: false, reason: "canonical_connector_config_not_found", secrets_included: false };
    }

    const aliasInputs = [...new Set([session.device_id, session.hostname].filter(Boolean))];
    const aliases = [];
    for (const aliasDeviceId of aliasInputs) {
      const alias = await upsertConnectorAlias({ aliasDeviceId, canonical, principal });
      if (alias) aliases.push(alias);
    }

    return {
      attempted: true,
      resolved: true,
      canonical_device_id: canonical.device_id,
      canonical_config_id: canonical.config_id,
      aliases,
      secrets_included: false,
    };
  } catch (err) {
    return {
      attempted: true,
      resolved: false,
      reason: "connector_alias_upsert_failed",
      error: { code: err?.code || "connector_alias_upsert_failed", message: err?.message || String(err) },
      secrets_included: false,
    };
  }
}

export async function requireLocalManagerUser(req) {
  const auth = String(req.headers.authorization || "");
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    const err = new Error("A signed-in user token is required.");
    err.status = 401;
    err.code = "user_jwt_required";
    throw err;
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    const err = new Error("User token is invalid or expired.");
    err.status = 401;
    err.code = "invalid_user_jwt";
    throw err;
  }

  const userId = cleanText(payload.user_id, 64);
  if (!userId) {
    const err = new Error("User token is missing user_id.");
    err.status = 401;
    err.code = "invalid_user_jwt";
    throw err;
  }
  const tenantId = cleanText(payload.tenant_id, 64) || null;
  const resolved = await fetchUserMembership({ userId, tenantId });
  if (!resolved) {
    const err = new Error("Active user membership was not found.");
    err.status = 403;
    err.code = "tenant_membership_required";
    throw err;
  }

  return {
    user_id: resolved.user.user_id,
    email: resolved.user.email,
    display_name: resolved.user.display_name,
    tenant_id: resolved.membership?.tenant_id || tenantId,
    role: resolved.membership?.role || null,
    tenant_display_name: resolved.membership?.tenant_display_name || null,
  };
}

export async function startDeviceLinkSession(req, res) {
  try {
    await ensureDeviceLinkTable();
    const body = req.body || {};
    const hostname = cleanText(body.hostname || body.device_name || "", 255);
    const deviceId = cleanId(body.device_id, { fallback: cleanId(hostname, { fallback: `device-${crypto.randomUUID().slice(0, 8)}` }), max: 128 });
    const platform = cleanText(body.platform || "windows", 32) || "windows";
    const appVersion = cleanText(body.app_version || "", 80);
    const displayCode = randomDisplayCode();
    const pollToken = randomToken(32);
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(nowMs() + DEVICE_LINK_TTL_SECONDS * 1000);
    const metadata = {
      source: "local_manager_windows_app",
      user_agent: cleanText(req.get("user-agent") || "", 255),
      ip_seen: cleanText(req.ip || req.socket?.remoteAddress || "", 64),
    };

    await getPool().query(
      `INSERT INTO \`local_manager_device_link_sessions\`
        (session_id, display_code, display_code_hash, poll_token_hash, status, device_id, hostname, platform, app_version, expires_at, metadata_json)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
      [sessionId, displayCode, sha256(displayCode), sha256(pollToken), deviceId, hostname || null, platform, appVersion || null, expiresAt, jsonString(metadata)]
    );

    const verificationUri = `${getBaseUrl(req)}/app/local-manager/link-device?code=${encodeURIComponent(displayCode)}`;
    return res.status(201).json({
      ok: true,
      session_id: sessionId,
      device_code: displayCode,
      user_code: displayCode,
      verification_uri: verificationUri,
      verification_uri_complete: verificationUri,
      expires_in: DEVICE_LINK_TTL_SECONDS,
      interval: POLL_INTERVAL_SECONDS,
      poll_token: pollToken,
      secrets_included: false,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "device_link_start_failed", message: err.message }, secrets_included: false });
  }
}

export async function previewDeviceLinkSession(req, res) {
  try {
    await ensureDeviceLinkTable();
    const displayCode = cleanText(req.query?.code || req.query?.device_code || req.query?.user_code, 16).toUpperCase();
    if (!displayCode) {
      return res.status(400).json({ ok: false, error: { code: "missing_device_code", message: "A pairing code is required." }, secrets_included: false });
    }
    const [rows] = await getPool().query(
      `SELECT * FROM \`local_manager_device_link_sessions\` WHERE display_code_hash = ? LIMIT 1`,
      [sha256(displayCode)]
    );
    const row = rows[0] || null;
    if (!row) {
      return res.status(404).json({ ok: false, error: { code: "device_link_not_found", message: "Pairing code was not found." }, secrets_included: false });
    }
    if (new Date(row.expires_at).getTime() <= nowMs() && row.status === "pending") {
      await getPool().query(`UPDATE \`local_manager_device_link_sessions\` SET status = 'expired' WHERE session_id = ?`, [row.session_id]);
      row.status = "expired";
    }
    const safe = sanitizeSession(row);
    delete safe.user_id;
    delete safe.tenant_id;
    return res.status(200).json({ ok: true, status: safe.status, device: safe, secrets_included: false });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "device_link_preview_failed", message: err.message }, secrets_included: false });
  }
}

export async function pollDeviceLinkSession(req, res) {
  try {
    await ensureDeviceLinkTable();
    const displayCode = cleanText(req.body?.device_code || req.body?.user_code || req.body?.code, 16).toUpperCase();
    const pollToken = cleanText(req.body?.poll_token, 200);
    if (!displayCode || !pollToken) {
      return res.status(400).json({ ok: false, error: { code: "missing_poll_fields", message: "device_code and poll_token are required." }, secrets_included: false });
    }

    const [rows] = await getPool().query(
      `SELECT * FROM \`local_manager_device_link_sessions\` WHERE display_code_hash = ? LIMIT 1`,
      [sha256(displayCode)]
    );
    const row = rows[0] || null;
    if (!row || row.poll_token_hash !== sha256(pollToken)) {
      return res.status(404).json({ ok: false, error: { code: "device_link_not_found", message: "Pairing session was not found." }, secrets_included: false });
    }
    if (new Date(row.expires_at).getTime() <= nowMs() && row.status === "pending") {
      await getPool().query(`UPDATE \`local_manager_device_link_sessions\` SET status = 'expired' WHERE session_id = ?`, [row.session_id]);
      return res.status(410).json({ ok: false, status: "expired", error: { code: "device_link_expired", message: "Pairing code expired." }, secrets_included: false });
    }
    if (row.status === "pending") {
      return res.status(202).json({ ok: true, status: "pending", interval: POLL_INTERVAL_SECONDS, expires_at: new Date(row.expires_at).toISOString(), secrets_included: false });
    }
    if (row.status !== "approved") {
      return res.status(200).json({ ok: true, status: row.status, device: sanitizeSession(row), secrets_included: false });
    }
    if (row.completed_at) {
      return res.status(200).json({ ok: true, status: "completed", device: sanitizeSession(row), secrets_included: false });
    }

    const deviceAccessToken = jwt.sign(
      {
        purpose: "local_manager_device_access",
        user_id: row.user_id,
        tenant_id: row.tenant_id,
        device_id: row.device_id,
        session_id: row.session_id,
        scope: "local_manager.device",
      },
      JWT_SECRET,
      { expiresIn: DEVICE_TOKEN_TTL_SECONDS, jwtid: crypto.randomUUID() }
    );
    await getPool().query(
      `UPDATE \`local_manager_device_link_sessions\` SET status = 'completed', completed_at = NOW() WHERE session_id = ?`,
      [row.session_id]
    );
    return res.status(200).json({
      ok: true,
      status: "approved",
      device_access_token: deviceAccessToken,
      token_type: "Bearer",
      expires_in: DEVICE_TOKEN_TTL_SECONDS,
      device: sanitizeSession({ ...row, status: "completed", completed_at: new Date() }),
      secrets_included: false,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "device_link_poll_failed", message: err.message }, secrets_included: false });
  }
}

export async function approveDeviceLinkSession(req, res) {
  try {
    await ensureDeviceLinkTable();
    const principal = await requireLocalManagerUser(req);
    const displayCode = cleanText(req.body?.device_code || req.body?.user_code || req.body?.code, 16).toUpperCase();
    if (!displayCode) {
      return res.status(400).json({ ok: false, error: { code: "missing_device_code", message: "A pairing code is required." }, secrets_included: false });
    }

    const [rows] = await getPool().query(
      `SELECT * FROM \`local_manager_device_link_sessions\` WHERE display_code_hash = ? LIMIT 1`,
      [sha256(displayCode)]
    );
    const row = rows[0] || null;
    if (!row) {
      return res.status(404).json({ ok: false, error: { code: "device_link_not_found", message: "Pairing code was not found." }, secrets_included: false });
    }
    if (new Date(row.expires_at).getTime() <= nowMs()) {
      await getPool().query(`UPDATE \`local_manager_device_link_sessions\` SET status = 'expired' WHERE session_id = ? AND status = 'pending'`, [row.session_id]);
      return res.status(410).json({ ok: false, error: { code: "device_link_expired", message: "Pairing code expired." }, secrets_included: false });
    }
    if (row.status !== "pending") {
      const sameOwner = row.user_id === principal.user_id && (!row.tenant_id || !principal.tenant_id || row.tenant_id === principal.tenant_id);
      if (sameOwner && ["approved", "completed"].includes(row.status)) {
        const connectorAlias = await ensureLocalConnectorAliasForDeviceLink({ session: row, principal });
        return res.status(200).json({
          ok: true,
          status: row.status,
          already_linked: true,
          user: principal,
          device: sanitizeSession(row),
          connector_alias: connectorAlias,
          message: "This pairing code was already approved for your account.",
          secrets_included: false,
        });
      }
      return res.status(409).json({ ok: false, status: row.status, error: { code: "device_link_not_pending", message: "Pairing code is no longer pending." }, secrets_included: false });
    }

    const [existingRows] = await getPool().query(
      `SELECT * FROM \`local_manager_device_link_sessions\`
        WHERE device_id = ?
          AND user_id = ?
          AND (? IS NULL OR tenant_id = ?)
          AND status IN ('approved','completed')
        ORDER BY COALESCE(completed_at, approved_at, created_at) DESC
        LIMIT 1`,
      [row.device_id, principal.user_id, principal.tenant_id, principal.tenant_id]
    );
    const existingLinked = existingRows[0] || null;

    await getPool().query(
      `UPDATE \`local_manager_device_link_sessions\`
          SET status = 'approved', user_id = ?, tenant_id = ?, approved_at = NOW()
        WHERE session_id = ? AND status = 'pending'`,
      [principal.user_id, principal.tenant_id, row.session_id]
    );
    const approved = { ...row, status: "approved", user_id: principal.user_id, tenant_id: principal.tenant_id, approved_at: new Date() };
    const connectorAlias = await ensureLocalConnectorAliasForDeviceLink({ session: approved, principal });
    return res.status(200).json({
      ok: true,
      status: "approved",
      already_linked: Boolean(existingLinked),
      reauthorized_existing_device: Boolean(existingLinked),
      user: principal,
      device: sanitizeSession(approved),
      connector_alias: connectorAlias,
      message: existingLinked
        ? "This device was already linked for your account. The current app session was re-authorized."
        : undefined,
      secrets_included: false,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "device_link_approve_failed", message: err.message }, secrets_included: false });
  }
}

export async function listLinkedDevices(req, res) {
  try {
    await ensureDeviceLinkTable();
    const principal = await requireLocalManagerUser(req);
    const [linkRows] = await getPool().query(
      `SELECT * FROM \`local_manager_device_link_sessions\`
        WHERE user_id = ? AND (? IS NULL OR tenant_id = ?)
        ORDER BY COALESCE(completed_at, approved_at, created_at) DESC
        LIMIT 50`,
      [principal.user_id, principal.tenant_id, principal.tenant_id]
    );
    return res.status(200).json({ ok: true, user: principal, devices: linkRows.map(sanitizeSession), secrets_included: false });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "device_list_failed", message: err.message }, secrets_included: false });
  }
}

export async function requireLocalManagerDevice(req) {
  const auth = String(req.headers.authorization || "");
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    const err = new Error("A linked device token is required.");
    err.status = 401;
    err.code = "device_token_required";
    throw err;
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    const err = new Error("Device token is invalid or expired.");
    err.status = 401;
    err.code = "invalid_device_token";
    throw err;
  }

  if (payload.purpose !== "local_manager_device_access" || payload.scope !== "local_manager.device") {
    const err = new Error("Token is not a Local Manager device token.");
    err.status = 403;
    err.code = "wrong_token_scope";
    throw err;
  }

  const device = {
    user_id: cleanText(payload.user_id, 64),
    tenant_id: cleanText(payload.tenant_id, 64) || null,
    device_id: cleanText(payload.device_id, 128),
    session_id: cleanText(payload.session_id, 64),
  };
  if (!device.user_id || !device.device_id || !device.session_id) {
    const err = new Error("Device token is missing required claims.");
    err.status = 401;
    err.code = "invalid_device_token_claims";
    throw err;
  }

  await ensureDeviceLinkTable();
  const [rows] = await getPool().query(
    `SELECT * FROM \`local_manager_device_link_sessions\`
      WHERE session_id = ? AND device_id = ? AND user_id = ? AND status IN ('approved','completed')
      LIMIT 1`,
    [device.session_id, device.device_id, device.user_id]
  );
  const row = rows[0] || null;
  if (!row) {
    const err = new Error("Linked device session was not found.");
    err.status = 403;
    err.code = "device_session_not_found";
    throw err;
  }
  const issuedAtSeconds = Number(payload.iat || 0) || null;
  const expiresAtSeconds = Number(payload.exp || 0) || null;
  const authAgeSeconds = issuedAtSeconds ? Math.max(0, Math.floor(Date.now() / 1000) - issuedAtSeconds) : null;
  const authContext = {
    source: "saved_device_token",
    token_scope: "local_manager.device",
    saved_device_token: true,
    interactive_user_session_present: false,
    requires_reauth_for_privileged_installers: false,
    privileged_authorization_max_age_seconds: PRIVILEGED_DEVICE_AUTH_MAX_AGE_SECONDS,
    privileged_authorization_fresh: authAgeSeconds !== null && authAgeSeconds <= PRIVILEGED_DEVICE_AUTH_MAX_AGE_SECONDS,
    auth_age_seconds: authAgeSeconds,
    token_issued_at: issuedAtSeconds ? new Date(issuedAtSeconds * 1000).toISOString() : null,
    token_expires_at: expiresAtSeconds ? new Date(expiresAtSeconds * 1000).toISOString() : null,
  };
  return { ...device, session: sanitizeSession(row), auth_context: authContext };
}

export async function requireFreshLocalManagerDeviceForPrivilegedInstaller(req) {
  // A valid, non-revoked Local Manager device token is sufficient. Windows UAC
  // remains required locally for every privileged installer execution.
  return requireLocalManagerDevice(req);
}

export async function getDeviceSession(req, res) {
  try {
    const device = await requireLocalManagerDevice(req);
    return res.status(200).json({
      ok: true,
      device,
      controls: {
        devices: "/local-manager/device/session",
        routes: "/local-manager/device/controls?section=routes",
        backups: "/local-manager/device/controls?section=backups",
        repairs: "/local-manager/device/controls?section=repairs",
        n8n: "/local-manager/device/controls?section=n8n",
        connector_repair_installer: "/local-connector/install/device-download-link",
        settings: "/local-manager/device/controls?section=settings",
        runtime_readback: "/local-manager/device/agent-runtime",
      },
      secrets_included: false,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "device_session_failed", message: err.message }, secrets_included: false });
  }
}

function localManagerControlTemplateSeeds() {
  return [
    { template_type: "capability", template_key: "powershell_admin", label: "Admin PowerShell recovery", env_flag: "CONNECTOR_POWERSHELL_ENABLED", risk_class: "high", sort_order: 10, surface_type: "helper_tool", execution_location: "local_device", integration_type: "capability", credential_scope: "device", metadata: { note: "Break-glass recovery only. Enables governed /ps proxy after local elevated reinstall." } },
    { template_type: "capability", template_key: "windows_control", label: "Windows app/process control", env_flag: "CONNECTOR_WIN_ENABLED", risk_class: "high", sort_order: 20, surface_type: "desktop_control", execution_location: "local_device", integration_type: "capability", credential_scope: "device", metadata: { note: "Break-glass/desktop-control only. Enables governed /win proxy after local elevated reinstall." } },
    { template_type: "capability", template_key: "hermes_agent_surface", label: "Hermes Agent Surface", env_flag: "CONNECTOR_HERMES_AGENT_SURFACE_ENABLED", risk_class: "interactive", sort_order: 30, surface_type: "agent_surface", execution_location: "local_device", integration_type: "capability", credential_scope: "tenant", metadata: { note: "Enables governed local Hermes agent surface controls when tenant policy grants it." } },
    { template_type: "capability", template_key: "auto_browser", label: "Auto Browser", env_flag: "CONNECTOR_AUTO_BROWSER_ENABLED", risk_class: "interactive", sort_order: 40, surface_type: "automation_surface", execution_location: "platform_managed", integration_type: "capability", credential_scope: "tenant", metadata: { note: "Enables governed automated browser surface controls when tenant policy grants it." } },
    { template_type: "app", template_key: "managed_n8n_client", label: "Managed n8n Client", process_name: "n8n", browser: false, capability_class: "workflow_runtime", risk_class: "managed", sort_order: 50, surface_type: "workflow_runtime", execution_location: "mad4b_service_side", integration_type: "managed_service_client", credential_scope: "tenant", metadata: { app_manager_scope: "managed_mad4b_service_side", current_hosting_target: "essam_local_device", future_hosting_target: "vps", managed_by: "mad4b", tenant_installs_local_service: false, note: "Mad4B-managed n8n client. Currently may run on Essam local device during bootstrap; target hosting is VPS/platform service side." } },
    { template_type: "app", template_key: "tenant_dedicated_n8n", label: "Dedicated tenant n8n", process_name: "n8n", browser: false, capability_class: "workflow_runtime", risk_class: "interactive", sort_order: 60, surface_type: "workflow_runtime", execution_location: "tenant_local_device", integration_type: "tenant_local_service", credential_scope: "tenant", metadata: { app_manager_scope: "tenant_local_device_side", managed_by: "tenant", tenant_installs_local_service: true, writes_local_files: true, note: "Tenant-dedicated n8n installation that is installed and run on the tenant local device." } },
    { template_type: "app", template_key: "edge", label: "Microsoft Edge", process_name: "msedge", browser: true, capability_class: "browser", risk_class: "interactive", sort_order: 100, surface_type: "browser_runtime", execution_location: "local_device", integration_type: "local_app", credential_scope: "none", metadata: { app_manager_scope: "tenant_local_device_side" } },
    { template_type: "app", template_key: "chrome", label: "Google Chrome", process_name: "chrome", browser: true, capability_class: "browser", risk_class: "interactive", sort_order: 110, surface_type: "browser_runtime", execution_location: "local_device", integration_type: "local_app", credential_scope: "none" },
    { template_type: "app", template_key: "firefox", label: "Mozilla Firefox", process_name: "firefox", browser: true, capability_class: "browser", risk_class: "interactive", sort_order: 112, surface_type: "browser_runtime", execution_location: "local_device", integration_type: "local_app", credential_scope: "none" },
    { template_type: "app", template_key: "brave", label: "Brave Browser", process_name: "brave", browser: true, capability_class: "browser", risk_class: "interactive", sort_order: 114, surface_type: "browser_runtime", execution_location: "local_device", integration_type: "local_app", credential_scope: "none" },
    { template_type: "app", template_key: "opera", label: "Opera", process_name: "opera", browser: true, capability_class: "browser", risk_class: "interactive", sort_order: 116, surface_type: "browser_runtime", execution_location: "local_device", integration_type: "local_app", credential_scope: "none" },
    { template_type: "app", template_key: "chromium", label: "Chromium", process_name: "chromium", browser: true, capability_class: "browser", risk_class: "interactive", sort_order: 118, surface_type: "browser_runtime", execution_location: "local_device", integration_type: "local_app", credential_scope: "none" },
    { template_type: "app", template_key: "browserbase", label: "Browserbase", process_name: "browserbase", browser: true, capability_class: "browser_provider", risk_class: "external", sort_order: 121, surface_type: "browser_runtime", execution_location: "external_cloud", integration_type: "external_provider", credential_scope: "tenant", metadata: { requires_credentials: true } },
    { template_type: "app", template_key: "browserless", label: "Browserless", process_name: "browserless", browser: true, capability_class: "browser_provider", risk_class: "external", sort_order: 122, surface_type: "browser_runtime", execution_location: "external_cloud", integration_type: "external_provider", credential_scope: "tenant", metadata: { requires_credentials: true } },
    { template_type: "app", template_key: "steel_browser", label: "Steel Browser", process_name: "steel", browser: true, capability_class: "browser_provider", risk_class: "external", sort_order: 123, surface_type: "browser_runtime", execution_location: "external_cloud", integration_type: "external_provider", credential_scope: "tenant", metadata: { requires_credentials: true } },
    { template_type: "capability", template_key: "playwright_adapter", label: "Playwright Adapter", env_flag: "CONNECTOR_PLAYWRIGHT_ENABLED", risk_class: "interactive", sort_order: 124, surface_type: "browser_adapter", execution_location: "local_device", integration_type: "plugin_adapter", credential_scope: "device", metadata: { note: "Governed browser automation adapter; requires local runtime installation and tenant consent." } },
    { template_type: "capability", template_key: "puppeteer_adapter", label: "Puppeteer Adapter", env_flag: "CONNECTOR_PUPPETEER_ENABLED", risk_class: "interactive", sort_order: 125, surface_type: "browser_adapter", execution_location: "local_device", integration_type: "plugin_adapter", credential_scope: "device", metadata: { note: "Governed browser automation adapter; requires local runtime installation and tenant consent." } },
    { template_type: "capability", template_key: "selenium_adapter", label: "Selenium Adapter", env_flag: "CONNECTOR_SELENIUM_ENABLED", risk_class: "interactive", sort_order: 126, surface_type: "browser_adapter", execution_location: "local_device", integration_type: "plugin_adapter", credential_scope: "device", metadata: { note: "Governed browser automation adapter; requires local runtime installation and tenant consent." } },
    { template_type: "app", template_key: "vscode", label: "Visual Studio Code", process_name: "Code", browser: false, capability_class: "developer_tool", risk_class: "interactive", sort_order: 130, surface_type: "desktop_app", execution_location: "local_device", integration_type: "local_app", credential_scope: "none" },
    { template_type: "app", template_key: "cursor", label: "Cursor", process_name: "Cursor", browser: false, capability_class: "developer_tool", risk_class: "interactive", sort_order: 130 },
    { template_type: "app", template_key: "open_claude", label: "Open Claude", process_name: "Claude", browser: false, capability_class: "agent_surface", risk_class: "interactive", sort_order: 140, metadata: { aliases: ["open_cloude"] } },
    { template_type: "app", template_key: "open_claw", label: "Open Claw", process_name: "OpenClaw", browser: false, capability_class: "agent_surface", risk_class: "interactive", sort_order: 150, metadata: { aliases: ["open_claw", "open_claude_claw"] } },
    { template_type: "app", template_key: "notepad", label: "Windows Notepad", process_name: "notepad", browser: false, capability_class: "desktop_app", risk_class: "low", sort_order: 900 },
    { template_type: "app", template_key: "git_bash", label: "Git Bash", process_name: "git-bash", browser: false, capability_class: "developer_tool", risk_class: "interactive", sort_order: 910 },
  ];
}

async function ensureLocalManagerControlTemplatesTable() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS \`local_manager_control_templates\` (
      \`template_id\` VARCHAR(128) NOT NULL,
      \`template_type\` ENUM('capability','app','helper') NOT NULL,
      \`template_key\` VARCHAR(128) NOT NULL,
      \`label\` VARCHAR(191) NOT NULL,
      \`env_flag\` VARCHAR(128) NULL,
      \`process_name\` VARCHAR(191) NULL,
      \`browser\` TINYINT(1) NOT NULL DEFAULT 0,
      \`capability_class\` VARCHAR(128) NULL,
      \`risk_class\` VARCHAR(64) NOT NULL DEFAULT 'interactive',
      \`metadata_json\` JSON NULL,
      \`sort_order\` INT NOT NULL DEFAULT 1000,
      \`status\` ENUM('active','disabled','deprecated') NOT NULL DEFAULT 'active',
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`template_id\`),
      UNIQUE KEY \`uq_local_manager_control_template\` (\`template_type\`, \`template_key\`),
      KEY \`idx_local_manager_control_status\` (\`status\`, \`template_type\`, \`sort_order\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function seedLocalManagerControlTemplates() {
  const rows = localManagerControlTemplateSeeds();
  for (const row of rows) {
    await getPool().query(
      `INSERT INTO \`local_manager_control_templates\`
        (template_id, template_type, template_key, label, env_flag, process_name, browser, capability_class, risk_class, metadata_json, sort_order, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
       ON DUPLICATE KEY UPDATE
         label = VALUES(label), env_flag = VALUES(env_flag), process_name = VALUES(process_name), browser = VALUES(browser),
         capability_class = VALUES(capability_class), risk_class = VALUES(risk_class), metadata_json = VALUES(metadata_json),
         sort_order = VALUES(sort_order), updated_at = NOW()`,
      [
        `local-manager-${row.template_type}-${row.template_key}`,
        row.template_type,
        row.template_key,
        row.label,
        row.env_flag || null,
        row.process_name || null,
        row.browser ? 1 : 0,
        row.capability_class || null,
        row.risk_class || "interactive",
        jsonString({
          ...(row.metadata || {}),
          surface_type: row.surface_type || row.capability_class || row.template_type,
          execution_location: row.execution_location || "local_device",
          integration_type: row.integration_type || (row.template_type === "app" ? "local_app" : "capability"),
          credential_scope: row.credential_scope || "device",
          requires_credentials: Boolean(row.metadata?.requires_credentials || row.integration_type === "external_provider"),
        }),
        Number(row.sort_order || 1000),
      ]
    );
  }
}

function normalizeControlTemplate(row) {
  const metadata = parseJson(row.metadata_json) || {};
  if (row.template_type === "capability") {
    return {
      key: row.template_key,
      label: row.label,
      env_flag: row.env_flag || null,
      risk: row.risk_class || "interactive",
      note: metadata.note || "Governed Local Manager capability loaded from registry.",
      surface_type: metadata.surface_type || "capability",
      execution_location: metadata.execution_location || "local_device",
      integration_type: metadata.integration_type || "capability",
      credential_scope: metadata.credential_scope || "device",
      requires_credentials: Boolean(metadata.requires_credentials),
      metadata,
    };
  }
  return {
    app_alias: row.template_key,
    display_name: row.label,
    process_name: row.process_name || row.template_key,
    browser: Boolean(Number(row.browser || 0)),
    capability_class: row.capability_class || "desktop_app",
    risk_class: row.risk_class || "interactive",
    surface_type: metadata.surface_type || row.capability_class || "desktop_app",
    execution_location: metadata.execution_location || "local_device",
    integration_type: metadata.integration_type || "local_app",
    credential_scope: metadata.credential_scope || "none",
    requires_credentials: Boolean(metadata.requires_credentials),
    metadata,
  };
}

async function loadLocalManagerControlTemplates() {
  try {
    await ensureLocalManagerControlTemplatesTable();
    await seedLocalManagerControlTemplates();
    const [rows] = await getPool().query(
      `SELECT * FROM \`local_manager_control_templates\`
        WHERE status = 'active' AND template_type IN ('capability','app')
        ORDER BY template_type ASC, sort_order ASC, label ASC`
    );
    const supportedCapabilities = rows.filter((row) => row.template_type === "capability").map(normalizeControlTemplate);
    const supportedApps = rows.filter((row) => row.template_type === "app").map(normalizeControlTemplate);
    const supportedBrowsers = supportedApps.filter((item) => item.surface_type === "browser_runtime" && item.integration_type === "local_app");
    const supportedBrowserProviders = supportedApps.filter((item) => item.surface_type === "browser_runtime" && item.integration_type === "external_provider");
    const supportedBrowserAdapters = supportedCapabilities.filter((item) => item.surface_type === "browser_adapter" || item.integration_type === "plugin_adapter");
    const supportedAgentSurfaces = supportedCapabilities.filter((item) => item.surface_type === "agent_surface" || item.surface_type === "automation_surface");
    const allControlSurfaces = supportedCapabilities.concat(supportedApps);
    const supportedManagedMad4bServices = allControlSurfaces.filter((item) => item.metadata?.app_manager_scope === "managed_mad4b_service_side" || item.execution_location === "mad4b_service_side" || item.integration_type === "managed_service_client");
    const supportedTenantLocalServices = allControlSurfaces.filter((item) => item.metadata?.app_manager_scope === "tenant_local_device_side" || item.execution_location === "tenant_local_device" || item.integration_type === "tenant_local_service");
    return {
      source: "db",
      registry_table: "local_manager_control_templates",
      supported_capabilities: supportedCapabilities,
      supported_apps: supportedApps,
      supported_browsers: supportedBrowsers,
      supported_browser_providers: supportedBrowserProviders,
      supported_browser_adapters: supportedBrowserAdapters,
      supported_agent_surfaces: supportedAgentSurfaces,
      supported_managed_mad4b_services: supportedManagedMad4bServices,
      supported_tenant_local_services: supportedTenantLocalServices,
      last_loaded_at: new Date().toISOString(),
      secrets_included: false,
    };
  } catch (err) {
    const fallbackRows = localManagerControlTemplateSeeds();
    const supportedCapabilities = fallbackRows.filter((row) => row.template_type === "capability").map((row) => {
      const metadata = {
        ...(row.metadata || {}),
        surface_type: row.surface_type || row.capability_class || row.template_type,
        execution_location: row.execution_location || "local_device",
        integration_type: row.integration_type || "capability",
        credential_scope: row.credential_scope || "device",
        requires_credentials: Boolean(row.metadata?.requires_credentials || row.integration_type === "external_provider"),
      };
      return { key: row.template_key, label: row.label, env_flag: row.env_flag || null, risk: row.risk_class || "interactive", note: metadata.note || "Fallback Local Manager capability.", ...metadata, metadata };
    });
    const supportedApps = fallbackRows.filter((row) => row.template_type === "app").map((row) => {
      const metadata = {
        ...(row.metadata || {}),
        surface_type: row.surface_type || row.capability_class || "desktop_app",
        execution_location: row.execution_location || "local_device",
        integration_type: row.integration_type || "local_app",
        credential_scope: row.credential_scope || "none",
        requires_credentials: Boolean(row.metadata?.requires_credentials || row.integration_type === "external_provider"),
      };
      return { app_alias: row.template_key, display_name: row.label, process_name: row.process_name || row.template_key, browser: Boolean(row.browser), capability_class: row.capability_class || "desktop_app", risk_class: row.risk_class || "interactive", ...metadata, metadata };
    });
    return {
      source: "code_fallback",
      registry_table: "local_manager_control_templates",
      error: { code: err?.code || "control_template_registry_unavailable", message: err?.message || String(err) },
      supported_capabilities: supportedCapabilities,
      supported_apps: supportedApps,
      supported_browsers: supportedApps.filter((item) => item.surface_type === "browser_runtime" && item.integration_type === "local_app"),
      supported_browser_providers: supportedApps.filter((item) => item.surface_type === "browser_runtime" && item.integration_type === "external_provider"),
      supported_browser_adapters: supportedCapabilities.filter((item) => item.surface_type === "browser_adapter" || item.integration_type === "plugin_adapter"),
      supported_agent_surfaces: supportedCapabilities.filter((item) => item.surface_type === "agent_surface" || item.surface_type === "automation_surface"),
      supported_managed_mad4b_services: supportedCapabilities.concat(supportedApps).filter((item) => item.metadata?.app_manager_scope === "managed_mad4b_service_side" || item.execution_location === "mad4b_service_side" || item.integration_type === "managed_service_client"),
      supported_tenant_local_services: supportedCapabilities.concat(supportedApps).filter((item) => item.metadata?.app_manager_scope === "tenant_local_device_side" || item.execution_location === "tenant_local_device" || item.integration_type === "tenant_local_service"),
      last_loaded_at: new Date().toISOString(),
      secrets_included: false,
    };
  }
}

async function resolveConnectorRuntimeReadback(device) {
  const canonical = await resolveCanonicalConnectorConfig({
    userId: device.user_id,
    tenantId: device.tenant_id,
    deviceId: device.device_id,
    hostname: device.session?.hostname || device.device_id,
  });
  if (!canonical) {
    return {
      resolved: false,
      connector_active: false,
      health_recent: false,
      alias_resolved: false,
      registered_route_count: 0,
      reason: "canonical_connector_config_not_found",
      secrets_included: false,
    };
  }

  const pool = getPool();
  const [configRows] = await pool.query(
    `SELECT config_id, device_id, last_health_at, last_repair_at, last_repair_status, last_error_code
       FROM \`local_connector_user_configs\`
      WHERE config_id = ? AND user_id = ?
      LIMIT 1`,
    [canonical.config_id, device.user_id]
  );
  const config = configRows[0] || {};
  const [routeRows] = await pool.query(
    `SELECT COUNT(*) AS registered_route_count, MAX(last_success_at) AS last_route_success_at
       FROM \`local_connector_device_routes\`
      WHERE config_id = ? AND is_enabled = 1`,
    [canonical.config_id]
  );

  const aliasInputs = [...new Set([device.device_id, device.session?.hostname]
    .map((value) => cleanId(value, { max: 128 }))
    .filter(Boolean))];
  let aliasResolved = aliasInputs.some((value) => value.toLowerCase() === String(canonical.device_id || "").toLowerCase());
  if (!aliasResolved && aliasInputs.length) {
    const placeholders = aliasInputs.map(() => "?").join(", ");
    const [aliasRows] = await pool.query(
      `SELECT COUNT(*) AS alias_count
         FROM \`local_connector_device_aliases\`
        WHERE canonical_config_id = ?
          AND status = 'active'
          AND alias_device_id IN (${placeholders})`,
      [canonical.config_id, ...aliasInputs]
    );
    aliasResolved = Number(aliasRows[0]?.alias_count || 0) > 0;
  }

  const registeredRouteCount = Number(routeRows[0]?.registered_route_count || 0);
  const lastHealthMs = config.last_health_at ? new Date(config.last_health_at).getTime() : 0;
  const healthAgeSeconds = lastHealthMs > 0 ? Math.max(0, Math.floor((Date.now() - lastHealthMs) / 1000)) : null;
  const healthRecent = healthAgeSeconds !== null && healthAgeSeconds <= 600;
  const connectorActive = Boolean(healthRecent && registeredRouteCount > 0 && aliasResolved);

  return {
    resolved: true,
    canonical_config_id: canonical.config_id,
    canonical_device_id: canonical.device_id,
    connector_active: connectorActive,
    health_recent: healthRecent,
    health_age_seconds: healthAgeSeconds,
    alias_resolved: aliasResolved,
    registered_route_count: registeredRouteCount,
    last_health_at: config.last_health_at ? new Date(config.last_health_at).toISOString() : null,
    last_route_success_at: routeRows[0]?.last_route_success_at ? new Date(routeRows[0].last_route_success_at).toISOString() : null,
    last_repair_at: config.last_repair_at ? new Date(config.last_repair_at).toISOString() : null,
    last_repair_status: cleanText(config.last_repair_status || "", 80) || null,
    last_error_code: cleanText(config.last_error_code || "", 120) || null,
    evidence_source: "mysql_primary_connector_registry",
    secrets_included: false,
  };
}

export async function getDeviceControls(req, res) {
  try {
    const device = await requireLocalManagerDevice(req);
    const section = cleanText(req.query.section || "overview", 32) || "overview";
    const allowedSections = new Set(["overview", "routes", "backups", "repairs", "n8n", "settings"]);
    if (!allowedSections.has(section)) {
      return res.status(400).json({ ok: false, error: { code: "invalid_control_section", message: "Unsupported device control section." }, secrets_included: false });
    }

    const controlTemplates = section === "settings" ? await loadLocalManagerControlTemplates() : null;
    const baseControls = {
      overview: {
        label: "Device overview",
        actions: ["view_link_status", "open_dashboard", "check_update"],
        destructive_actions_enabled: false,
      },
      routes: {
        label: "Routes",
        actions: ["view_route_health", "view_selected_route"],
        write_actions_enabled: false,
        note: "Route mutations remain admin-governed until consent and entitlement checks are complete.",
      },
      backups: {
        label: "Backups and DR",
        actions: ["view_backup_policy_status", "view_restore_probe_readiness"],
        write_actions_enabled: false,
        note: "Restore probes require upgraded local connector aliases before execution.",
      },
      repairs: {
        label: "Connector repairs",
        actions: ["request_connector_upgrade_installer", "download_signed_installer", "run_installer_as_administrator", "verify_connector_policy"],
        write_actions_enabled: true,
        endpoint: "/local-connector/install/device-download-link",
        default_format: "bat",
        elevation_required: true,
        note: "Local Manager should call the endpoint with its device token, download the signed installer, elevate locally, run it, then verify /policy and alias refresh.",
      },
      repairs: {
        label: "Connector repairs",
        actions: ["request_connector_upgrade_installer", "download_signed_installer", "run_installer_as_administrator", "verify_connector_policy"],
        write_actions_enabled: true,
        endpoint: "/local-connector/install/device-download-link",
        default_format: "bat",
        elevation_required: true,
        note: "Local Manager should call the endpoint with its device token, download the signed installer, elevate locally, run it, then verify /policy and alias refresh.",
      },
      n8n: {
        label: "Local n8n",
        actions: ["resolve_connected_system_profile", "install_node_if_missing", "install_n8n_if_missing", "write_tenant_start_script", "start_local_n8n", "open_local_or_public_url", "validate_local_reachability"],
        write_actions_enabled: true,
        autopilot_enabled: true,
        local_only_default: true,
        requires_device_token: true,
        requires_tenant_membership: true,
        credential_policy: "No n8n API key is required for local start. API keys are optional and must be stored separately as credential_refs.",
        note: "Local Manager should use the returned profile. It may install Node/n8n locally, create the tenant data folder, write a start script, and launch n8n on 127.0.0.1.",
      },
      settings: {
        label: "Settings",
        actions: ["view_device_identity", "view_token_storage_status", "open_account_settings", "request_capability_installer"],
        write_actions_enabled: true,
        capability_consent: {
          endpoint: "/local-connector/install/device-download-link",
          method: "POST",
          requires_device_token: true,
          requires_local_user_consent: true,
          requires_local_admin_elevation: true,
          default_format: "bat",
          supported_capabilities: [
            {
              key: "powershell_admin",
              label: "Admin PowerShell recovery",
              env_flag: "CONNECTOR_POWERSHELL_ENABLED",
              risk: "high",
              note: "Break-glass recovery only. Enables governed /ps proxy after local elevated reinstall.",
            },
            {
              key: "windows_control",
              label: "Windows app/process control",
              env_flag: "CONNECTOR_WIN_ENABLED",
              risk: "high",
              note: "Break-glass/desktop-control only. Enables governed /win proxy after local elevated reinstall.",
            },
          ],
          supported_apps: [
            { app_alias: "chrome", display_name: "Google Chrome", process_name: "chrome", browser: true, capability_class: "browser", risk_class: "interactive" },
            { app_alias: "edge", display_name: "Microsoft Edge", process_name: "msedge", browser: true, capability_class: "browser", risk_class: "interactive" },
            { app_alias: "vscode", display_name: "Visual Studio Code", process_name: "Code", browser: false, capability_class: "developer_tool", risk_class: "interactive" },
            { app_alias: "cursor", display_name: "Cursor", process_name: "Cursor", browser: false, capability_class: "developer_tool", risk_class: "interactive" },
            { app_alias: "notepad", display_name: "Windows Notepad", process_name: "notepad", browser: false, capability_class: "desktop_app", risk_class: "low" },
            { app_alias: "git_bash", display_name: "Git Bash", process_name: "git-bash", browser: false, capability_class: "developer_tool", risk_class: "interactive" },
          ],
          dynamic_grants: {
            apps_env: "CONNECTOR_APP_ALLOWLIST",
            file_paths_env: "CONNECTOR_FILE_PATHS",
            helper_aliases_env: "CONNECTOR_SHELL_ALLOWLIST",
            supported_grant_types: ["app", "allowed_path", "helper_alias"],
            supported_apps: [
              { app_alias: "edge", display_name: "Microsoft Edge", process_name: "msedge", browser: true, capability_class: "browser", risk_class: "interactive" },
              { app_alias: "chrome", display_name: "Google Chrome", process_name: "chrome", browser: true, capability_class: "browser", risk_class: "interactive" },
              { app_alias: "vscode", display_name: "Visual Studio Code", process_name: "Code", browser: false, capability_class: "desktop_app", risk_class: "interactive" },
              { app_alias: "notepad", display_name: "Windows Notepad", process_name: "notepad", browser: false, capability_class: "desktop_app", risk_class: "low" },
            ],
            note: "The Windows app must show supported app templates and collect explicit local user selections for app executable paths, allowed folders, and helper aliases before requesting a scoped installer.",
          },
        },
      },
    };

    if (section === "settings" && controlTemplates && baseControls.settings?.capability_consent) {
      baseControls.settings.capability_consent.registry_source = controlTemplates.source;
      baseControls.settings.capability_consent.registry_table = controlTemplates.registry_table;
      baseControls.settings.capability_consent.registry_loaded_at = controlTemplates.last_loaded_at;
      baseControls.settings.capability_consent.supported_capabilities = controlTemplates.supported_capabilities;
      baseControls.settings.capability_consent.supported_apps = controlTemplates.supported_apps;
      if (baseControls.settings.capability_consent.dynamic_grants) {
        baseControls.settings.capability_consent.dynamic_grants.supported_apps = controlTemplates.supported_apps;
      }
    }

    if (section === "settings" && controlTemplates && baseControls.settings?.capability_consent) {
      baseControls.settings.capability_consent.registry_source = controlTemplates.source;
      baseControls.settings.capability_consent.registry_table = controlTemplates.registry_table;
      baseControls.settings.capability_consent.registry_loaded_at = controlTemplates.last_loaded_at;
      baseControls.settings.capability_consent.supported_capabilities = controlTemplates.supported_capabilities;
      baseControls.settings.capability_consent.supported_apps = controlTemplates.supported_apps;
      baseControls.settings.capability_consent.supported_browsers = controlTemplates.supported_browsers;
      baseControls.settings.capability_consent.supported_browser_providers = controlTemplates.supported_browser_providers;
      baseControls.settings.capability_consent.supported_browser_adapters = controlTemplates.supported_browser_adapters;
      baseControls.settings.capability_consent.supported_agent_surfaces = controlTemplates.supported_agent_surfaces;
      baseControls.settings.capability_consent.supported_managed_mad4b_services = controlTemplates.supported_managed_mad4b_services;
      baseControls.settings.capability_consent.supported_tenant_local_services = controlTemplates.supported_tenant_local_services;
      if (baseControls.settings.capability_consent.dynamic_grants) {
        baseControls.settings.capability_consent.dynamic_grants.supported_apps = controlTemplates.supported_apps;
        baseControls.settings.capability_consent.dynamic_grants.supported_browsers = controlTemplates.supported_browsers;
        baseControls.settings.capability_consent.dynamic_grants.supported_browser_providers = controlTemplates.supported_browser_providers;
        baseControls.settings.capability_consent.dynamic_grants.supported_browser_adapters = controlTemplates.supported_browser_adapters;
        baseControls.settings.capability_consent.dynamic_grants.supported_agent_surfaces = controlTemplates.supported_agent_surfaces;
        baseControls.settings.capability_consent.dynamic_grants.supported_managed_mad4b_services = controlTemplates.supported_managed_mad4b_services;
        baseControls.settings.capability_consent.dynamic_grants.supported_tenant_local_services = controlTemplates.supported_tenant_local_services;
      }
    }

    const n8nConnector = section === "n8n" ? await resolveOrCreateTenantN8nProfile(device) : null;
    const runtimeReadback = section === "repairs" ? await resolveConnectorRuntimeReadback(device) : null;
    return res.status(200).json({
      ok: true,
      section,
      device,
      controls: baseControls[section],
      runtime_readback: runtimeReadback,
      n8n_connector: n8nConnector,
      token_scope: "local_manager.device",
      secrets_included: false,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "device_controls_failed", message: err.message }, secrets_included: false });
  }
}
