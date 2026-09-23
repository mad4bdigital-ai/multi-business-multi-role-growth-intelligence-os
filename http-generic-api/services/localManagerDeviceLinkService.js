import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { getPool } from "../db.js";
import { verifyUserJwtAuthorization } from "../userJwtAuth.js";
import {
  localManagerN8nSystemKey,
  localManagerWriteAuthorityEnabled,
  provisionLocalManagerN8n,
  reconcileLocalConnectorAliases,
} from "../localManagerWriteAuthority.js";

const DEFAULT_LOCAL_MANAGER_JWT_ISSUER = "https://auth.mad4b.com";

function localManagerJwtIssuer(env = process.env) {
  return String(env?.PLATFORM_JWT_ISSUER || DEFAULT_LOCAL_MANAGER_JWT_ISSUER).trim().replace(/\/$/u, "");
}
const DEVICE_JWT_AUDIENCE = "mad4b-local-manager-device";
const LOCAL_MANAGER_USER_JWT_AUDIENCE = "mad4b-local-manager-user";
const LOCAL_MANAGER_USER_JWT_PURPOSE = "local_manager_user_access";
const LOCAL_MANAGER_USER_JWT_SCOPE = "local_manager.user";
const DEVICE_JWT_SECRET_MAX_LENGTH = 4096;
const DEVICE_LINK_TTL_SECONDS = 10 * 60;
const POLL_INTERVAL_SECONDS = 3;
const DEVICE_LINK_INSERT_MAX_ATTEMPTS = 5;
const DEVICE_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;
const PRIVILEGED_DEVICE_AUTH_MAX_AGE_SECONDS = 15 * 60;
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


function isDuplicateKeyError(error) {
  return error?.code === "ER_DUP_ENTRY" || Number(error?.errno || 0) === 1062;
}

async function createDeviceLinkSessionWithRetry({
  pool,
  deviceId,
  hostname,
  platform,
  appVersion,
  devicePublicKey,
  requestMetadata = {},
  maxAttempts = DEVICE_LINK_INSERT_MAX_ATTEMPTS,
  generators = {},
}) {
  const makeDisplayCode = generators.displayCode || randomDisplayCode;
  const makeToken = generators.token || randomToken;
  const makeSessionId = generators.sessionId || (() => crypto.randomUUID());
  const attempts = Math.max(1, Math.min(Number(maxAttempts) || DEVICE_LINK_INSERT_MAX_ATTEMPTS, 10));
  let lastDuplicate = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const displayCode = makeDisplayCode();
    const pollToken = makeToken(32);
    const deviceProofChallenge = makeToken(32);
    const sessionId = makeSessionId();
    const expiresAt = new Date(nowMs() + DEVICE_LINK_TTL_SECONDS * 1000);
    const metadata = {
      source: "local_manager_windows_app",
      user_agent: cleanText(requestMetadata.user_agent || "", 255),
      ip_seen: cleanText(requestMetadata.ip_seen || "", 64),
      device_public_key_spki: devicePublicKey.encoded,
      device_public_key_fingerprint_sha256: devicePublicKey.fingerprint,
      device_proof_challenge_sha256: sha256(deviceProofChallenge),
      device_proof_contract: "mad4b.local-manager.device-proof.v1",
      pairing_insert_attempt: attempt,
    };

    try {
      await pool.query(
        "INSERT INTO local_manager_device_link_sessions " +
        "(session_id, display_code, display_code_hash, poll_token_hash, status, device_id, hostname, platform, app_version, expires_at, metadata_json) " +
        "VALUES (?, NULL, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)",
        [sessionId, sha256(displayCode), sha256(pollToken), deviceId, hostname || null, platform, appVersion || null, expiresAt, jsonString(metadata)]
      );
      return { displayCode, pollToken, deviceProofChallenge, sessionId, expiresAt, metadata, insert_attempt: attempt };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      lastDuplicate = error;
    }
  }

  const err = new Error("Pairing code allocation is temporarily saturated. Retry the pairing request.");
  err.status = 503;
  err.code = "device_link_code_allocation_exhausted";
  err.details = { attempts, duplicate_key_retries_exhausted: true, secrets_included: false };
  if (lastDuplicate?.code) err.cause_code = lastDuplicate.code;
  throw err;
}

function deviceJwtSecret(env = process.env) {
  const secret = String(env?.LOCAL_MANAGER_DEVICE_JWT_SECRET || "").trim();
  if (!secret || secret.length < 32 || secret.length > DEVICE_JWT_SECRET_MAX_LENGTH) {
    const err = new Error("Local Manager device authentication is temporarily unavailable.");
    err.status = 503;
    err.code = "local_manager_device_jwt_unavailable";
    throw err;
  }
  return secret;
}

function signDeviceAccessToken(row, env = process.env) {
  const issuedAt = Number(row.device_token_issued_at_seconds || 0)
    || Math.floor(new Date(row.device_token_issued_at || Date.now()).getTime() / 1000);
  const jti = cleanText(row.device_token_jti, 64);
  if (!jti || !issuedAt) {
    const err = new Error("Device token issuance state is incomplete.");
    err.status = 503;
    err.code = "device_token_issuance_state_incomplete";
    throw err;
  }
  return jwt.sign(
    {
      iss: localManagerJwtIssuer(env),
      aud: DEVICE_JWT_AUDIENCE,
      purpose: "local_manager_device_access",
      user_id: row.user_id,
      tenant_id: row.tenant_id,
      device_id: row.device_id,
      session_id: row.session_id,
      scope: "local_manager.device",
      iat: issuedAt,
    },
    deviceJwtSecret(env),
    { expiresIn: DEVICE_TOKEN_TTL_SECONDS, jwtid: jti, algorithm: "HS256" }
  );
}

function cleanId(value, { fallback = "", max = 128 } = {}) {
  const raw = String(value || "").trim().slice(0, max);
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return safe || fallback;
}

function cleanText(value, max = 255) {
  return String(value || "").trim().slice(0, max);
}

function sameTenantScope(leftTenantId, rightTenantId) {
  const left = cleanText(leftTenantId, 64) || null;
  const right = cleanText(rightTenantId, 64) || null;
  return left === right;
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

function credentialDelivery(fields = []) {
  return {
    contains_credentials: fields.length > 0,
    safe_to_log: fields.length === 0,
    credential_delivery: {
      intentional: fields.length > 0,
      fields,
      transport: fields.length > 0 ? "tls_response_body" : "none",
    },
    secrets_included: fields.length > 0,
  };
}

function importDevicePublicKey(value) {
  const encoded = cleanText(value, 2048);
  if (!encoded) return null;
  try {
    const der = Buffer.from(encoded, "base64");
    if (der.length < 64 || der.length > 1024) return null;
    const key = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") return null;
    return { key, encoded: der.toString("base64"), fingerprint: crypto.createHash("sha256").update(der).digest("hex") };
  } catch {
    return null;
  }
}

function pairingFingerprint(row, displayCode = "") {
  return sha256([
    "mad4b.local-manager.pairing-preview.v1",
    row.session_id,
    cleanText(displayCode || row.display_code, 16).toUpperCase(),
    row.device_id,
    row.hostname || "",
    row.platform || "",
    row.app_version || "",
    row.expires_at ? new Date(row.expires_at).toISOString() : "",
  ].join("\n"));
}

function sanitizePublicPairingPreview(row, displayCode = "") {
  return {
    device_id: row.device_id,
    display_label: row.hostname || row.device_id || "Local Manager device",
    hostname: row.hostname || null,
    platform: row.platform || null,
    app_version: row.app_version || null,
    effective_status: row.status,
    expires_at: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    pairing_fingerprint: pairingFingerprint(row, displayCode),
  };
}

function verifyDevicePossession({ row, displayCode, pollToken, challenge, signature }) {
  const metadata = parseJson(row.metadata_json) || {};
  const publicKey = importDevicePublicKey(metadata.device_public_key_spki);
  if (!publicKey || publicKey.fingerprint !== metadata.device_public_key_fingerprint_sha256) return false;
  if (!challenge || sha256(challenge) !== metadata.device_proof_challenge_sha256 || !signature) return false;
  const canonical = ["mad4b.local-manager.device-proof.v1", row.session_id, cleanText(displayCode, 16).toUpperCase(), sha256(pollToken), challenge].join("\n");
  try {
    return crypto.verify("sha256", Buffer.from(canonical, "utf8"), publicKey.key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

function getBaseUrl(req, env = process.env) {
  const configured = String(env.PUBLIC_BASE_URL || "").trim();
  if (configured) return configured.replace(/\/$/, "");
  const nodeEnv = String(env.NODE_ENV || "").trim().toLowerCase();
  if (nodeEnv === "production" || nodeEnv === "staging") {
    const err = new Error("PUBLIC_BASE_URL is required for Local Manager pairing in deployed environments.");
    err.status = 503;
    err.code = "local_manager_canonical_origin_required";
    throw err;
  }
  const proto = String(req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim() || "https";
  const host = req.get("host") || "localhost";
  return `${proto}://${host}`.replace(/\/$/, "");
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

async function resolveTenantN8nProfile(device) {
  const pool = getPool();
  const systemKey = localManagerN8nSystemKey(device.device_id);
  if (!systemKey) {
    return {
      system_id: null,
      installation_id: null,
      display_name: "Local n8n",
      status: "not_provisioned",
      profile: defaultN8nProfile({ device }),
      provisioned: false,
      provisioning_required: true,
      provisioning_reason: "invalid_device_identity",
      mutation_performed: false,
      secrets_included: false,
    };
  }
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
      LIMIT 2`,
    [device.user_id, device.device_id, device.tenant_id, systemKey]
  );
  if (rows.length > 1) {
    return {
      system_id: null,
      installation_id: null,
      display_name: "Local n8n",
      status: "ambiguous",
      profile: defaultN8nProfile({ device }),
      provisioned: false,
      provisioning_required: true,
      provisioning_reason: "ambiguous_provisioning_state",
      mutation_performed: false,
      secrets_included: false,
    };
  }
  const [row = null] = rows;
  if (row) {
    return {
      system_id: row.system_id,
      installation_id: row.installation_id || null,
      display_name: row.display_name,
      status: row.status,
      profile: sanitizeN8nProfileConfig(row.config_json, { device }),
      provisioned: true,
      provisioning_required: false,
      mutation_performed: false,
      secrets_included: false,
    };
  }

  return {
    system_id: null,
    installation_id: null,
    display_name: "Local n8n",
    status: "not_provisioned",
    profile: defaultN8nProfile({ device }),
    provisioned: false,
    provisioning_required: true,
    mutation_performed: false,
    apply_authorized: false,
    required_authority: "local_manager_n8n_provisioning_writer",
    reason: "No governed runtime-database writer is bound for n8n provisioning; the device control read remains SELECT-only.",
    secrets_included: false,
  };
}

async function assertDeviceLinkTableSchema() {
  try {
    const [rows] = await getPool().query(
      `SELECT COLUMN_NAME
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'local_manager_device_link_sessions'`
    );
    const columns = new Set(rows.map((row) => String(row.COLUMN_NAME || row.column_name || "")));
    const required = [
      "session_id", "display_code_hash", "poll_token_hash", "status", "device_id",
      "user_id", "tenant_id", "approved_at", "completed_at", "expires_at",
      "device_token_jti", "device_token_issued_at", "revoked_at", "revoked_by_user_id",
    ];
    const missing = required.filter((column) => !columns.has(column));
    if (missing.length) {
      const err = new Error("Local Manager device-link schema is not ready.");
      err.status = 503;
      err.code = "device_link_schema_not_ready";
      err.details = { missing_columns: missing, migration_required: "20260922_local_manager_device_link_authority.sql", secrets_included: false };
      throw err;
    }
    return true;
  } catch (error) {
    if (error?.code === "device_link_schema_not_ready") throw error;
    const err = new Error("Local Manager device-link schema is unavailable to runtime authority.");
    err.status = 503;
    err.code = "device_link_schema_unavailable";
    err.details = { required_operations: ["SELECT", "INSERT", "UPDATE"], secrets_included: false };
    throw err;
  }
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
    revoked_at: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
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
          AND ((? IS NULL AND tenant_id IS NULL) OR tenant_id = ?)
        ORDER BY COALESCE(last_health_at, updated_at, created_at) DESC
        LIMIT 1`,
      [userId, ...candidateIds, tenantId || null, tenantId || null]
    );
    if (exactRows[0]) return exactRows[0];
  }

  const [fallbackRows] = await pool.query(
    `SELECT config_id, user_id, tenant_id, device_id
       FROM \`local_connector_user_configs\`
      WHERE is_enabled = 1
        AND user_id = ?
        AND ((? IS NULL AND tenant_id IS NULL) OR tenant_id = ?)
        AND COALESCE(tunnel_url, public_gateway_url, device_runtime_url, admin_recovery_url) IS NOT NULL
      ORDER BY COALESCE(last_health_at, updated_at, created_at) DESC
      LIMIT 2`,
    [userId, tenantId || null, tenantId || null]
  );

  return fallbackRows.length === 1 ? fallbackRows[0] : null;
}

async function inspectLocalConnectorAliasForDeviceLink({ session, principal }) {
  try {
    const canonical = await resolveCanonicalConnectorConfig({
      userId: principal.user_id,
      tenantId: principal.tenant_id,
      deviceId: session.device_id,
      hostname: session.hostname,
    });
    if (!canonical) {
      return {
        attempted: true,
        resolved: false,
        reconciliation_required: true,
        mutation_performed: false,
        apply_authorized: false,
        required_authority: "local_connector_alias_reconciliation_writer",
        reason: "canonical_connector_config_not_found",
        secrets_included: false,
      };
    }

    const canonicalDeviceId = cleanId(canonical.device_id, { max: 128 });
    const aliasInputs = [...new Set([session.device_id, session.hostname]
      .map((value) => cleanId(value, { max: 128 }))
      .filter(Boolean)
      .filter((value) => value.toLowerCase() !== canonicalDeviceId.toLowerCase()))];

    if (!aliasInputs.length) {
      return {
        attempted: true,
        resolved: true,
        reconciliation_required: false,
        mutation_performed: false,
        canonical_device_id: canonicalDeviceId,
        canonical_config_id: canonical.config_id,
        aliases: [],
        secrets_included: false,
      };
    }

    const placeholders = aliasInputs.map(() => "?").join(", ");
    const [rows] = await getPool().query(
      `SELECT alias_device_id, canonical_device_id, canonical_config_id, user_id, tenant_id, status, updated_at
         FROM \`local_connector_device_aliases\`
        WHERE status = 'active'
          AND user_id = ?
          AND alias_device_id IN (${placeholders})`,
      [principal.user_id, ...aliasInputs]
    );
    const matching = rows.filter((row) =>
      cleanId(row.canonical_device_id, { max: 128 }).toLowerCase() === canonicalDeviceId.toLowerCase()
      && (sameTenantScope(row.tenant_id, principal.tenant_id))
    );
    const resolvedAliases = new Set(matching.map((row) => cleanId(row.alias_device_id, { max: 128 }).toLowerCase()));
    const missingAliases = aliasInputs.filter((alias) => !resolvedAliases.has(alias.toLowerCase()));

    return {
      attempted: true,
      resolved: missingAliases.length === 0,
      reconciliation_required: missingAliases.length > 0,
      mutation_performed: false,
      apply_authorized: false,
      required_authority: missingAliases.length ? "local_connector_alias_reconciliation_writer" : null,
      canonical_device_id: canonicalDeviceId,
      canonical_config_id: canonical.config_id,
      aliases: matching.map((row) => ({
        alias_device_id: row.alias_device_id,
        canonical_device_id: row.canonical_device_id,
        canonical_config_id: row.canonical_config_id || null,
        status: row.status,
      })),
      missing_aliases: missingAliases,
      reason: missingAliases.length ? "connector_alias_reconciliation_required" : null,
      secrets_included: false,
    };
  } catch (err) {
    return {
      attempted: true,
      resolved: false,
      reconciliation_required: true,
      mutation_performed: false,
      apply_authorized: false,
      required_authority: "local_connector_alias_reconciliation_writer",
      reason: "connector_alias_read_failed",
      error: { code: "connector_alias_read_failed", request_id: crypto.randomUUID() },
      secrets_included: false,
    };
  }
}

async function reconcileLocalConnectorAliasForDeviceLink({ session, principal }) {
  const inspected = await inspectLocalConnectorAliasForDeviceLink({ session, principal });
  if (inspected.resolved || !inspected.reconciliation_required) return inspected;
  if (!localManagerWriteAuthorityEnabled()) {
    return {
      ...inspected,
      writer_ready: false,
      apply_authorized: false,
      mutation_performed: false,
      required_authority: "local_connector_alias_reconciliation_writer",
    };
  }
  if (!inspected.canonical_device_id || !inspected.canonical_config_id || !Array.isArray(inspected.missing_aliases)) {
    return {
      ...inspected,
      writer_ready: true,
      apply_authorized: false,
      mutation_performed: false,
      reason: inspected.reason || "canonical_connector_config_not_found",
    };
  }
  try {
    const applied = await reconcileLocalConnectorAliases({
      userId: principal.user_id,
      tenantId: principal.tenant_id,
      canonicalDeviceId: inspected.canonical_device_id,
      canonicalConfigId: inspected.canonical_config_id,
      aliases: inspected.missing_aliases,
    });
    const readback = await inspectLocalConnectorAliasForDeviceLink({ session, principal });
    return {
      ...readback,
      writer_ready: true,
      apply_authorized: true,
      mutation_performed: Boolean(applied.mutation_performed),
      writer_authority: "local_connector_alias_reconciliation_writer",
      writer_readback_proven: readback.resolved === true,
      secrets_included: false,
    };
  } catch (error) {
    return {
      ...inspected,
      writer_ready: true,
      apply_authorized: true,
      mutation_performed: false,
      reason: "connector_alias_reconciliation_writer_failed",
      error: { code: "connector_alias_write_failed", request_id: crypto.randomUUID() },
      secrets_included: false,
    };
  }
}

export async function requireLocalManagerUser(req) {
  const result = verifyUserJwtAuthorization(req.headers?.authorization, {
    issuer: localManagerJwtIssuer(),
    audience: LOCAL_MANAGER_USER_JWT_AUDIENCE,
    requiredPurpose: LOCAL_MANAGER_USER_JWT_PURPOSE,
    requiredScope: LOCAL_MANAGER_USER_JWT_SCOPE,
  });
  if (!result.ok) {
    const err = new Error(result.message);
    err.status = result.status;
    err.code = result.code;
    throw err;
  }
  const payload = result.claims;
  if (payload?.purpose === "local_manager_device_access" || payload?.scope === "local_manager.device") {
    const err = new Error("A device token cannot be used as signed-in user authority.");
    err.status = 403;
    err.code = "wrong_user_token_class";
    throw err;
  }
  const userId = cleanText(payload.user_id, 64);
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

export async function requireLocalManagerUserRouteGuard(req, res, next) {
  try {
    req.local_manager_user_principal = await requireLocalManagerUser(req);
    return next();
  } catch (err) {
    return res.status(err.status || 401).json({
      ok: false,
      error: { code: err.code || "local_manager_user_authorization_required", message: err.message },
      secrets_included: false,
    });
  }
}

export async function startDeviceLinkSession(req, res) {
  try {
    await assertDeviceLinkTableSchema();
    const body = req.body || {};
    const hostname = cleanText(body.hostname || body.device_name || "", 255);
    const deviceId = cleanId(body.device_id, { fallback: cleanId(hostname, { fallback: `device-${crypto.randomUUID().slice(0, 8)}` }), max: 128 });
    const platform = cleanText(body.platform || "windows", 32) || "windows";
    const appVersion = cleanText(body.app_version || "", 80);
    const devicePublicKey = importDevicePublicKey(body.device_public_key);
    if (!devicePublicKey) {
      return res.status(400).json({ ok: false, error: { code: "device_public_key_required", message: "A P-256 device public key is required." }, secrets_included: false });
    }
    const {
      displayCode,
      pollToken,
      deviceProofChallenge,
      sessionId,
      expiresAt,
      insert_attempt: insertAttempt,
    } = await createDeviceLinkSessionWithRetry({
      pool: getPool(),
      deviceId,
      hostname,
      platform,
      appVersion,
      devicePublicKey,
      requestMetadata: {
        user_agent: req.get("user-agent") || "",
        ip_seen: req.ip || req.socket?.remoteAddress || "",
      },
    });
    const [createdRows] = await getPool().query(    const [createdRows] = await getPool().query(
      `SELECT session_id, status, expires_at
         FROM \`local_manager_device_link_sessions\`
        WHERE session_id = ?
        LIMIT 1`,
      [sessionId]
    );
    const created = createdRows[0] || null;
    if (!created || created.status !== "pending") {
      return res.status(409).json({
        ok: false,
        error: { code: "device_link_start_readback_failed", message: "Pairing session creation could not be proven from durable state." },
        secrets_included: false,
      });
    }

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
      device_proof_challenge: deviceProofChallenge,
      device_public_key_fingerprint_sha256: devicePublicKey.fingerprint,
      pairing_insert_attempt: insertAttempt,
      ...credentialDelivery(["poll_token"]),
    });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "device_link_start_failed", message: err.message }, secrets_included: false });
  }
}

export async function previewDeviceLinkSession(req, res) {
  try {
    await assertDeviceLinkTableSchema();
    const displayCode = cleanText(req.query?.code || req.query?.device_code || req.query?.user_code, 16).toUpperCase();
    if (!displayCode) {
      return res.status(400).json({ ok: false, error: { code: "missing_device_code", message: "A pairing code is required." }, secrets_included: false });
    }
    const [rows] = await getPool().query(
      `SELECT * FROM \`local_manager_device_link_sessions\` WHERE display_code_hash = ? LIMIT 1`,
      [sha256(displayCode)]
    );
    if (rows.length > 1) {
      const error = new Error("Device-link session cardinality is ambiguous.");
      error.status = 409;
      error.code = "local_manager_device_link_cardinality_conflict";
      throw error;
    }
    const [row = null] = rows;
    if (!row) {
      return res.status(404).json({ ok: false, error: { code: "device_link_not_found", message: "Pairing code was not found." }, secrets_included: false });
    }
    const durableStatus = row.status;
    const effectiveStatus = new Date(row.expires_at).getTime() <= nowMs() && durableStatus === "pending"
      ? "expired"
      : durableStatus;
    const safe = sanitizePublicPairingPreview({ ...row, status: effectiveStatus }, displayCode);
    return res.status(200).json({
      ok: true,
      status: effectiveStatus,
      durable_status: durableStatus,
      effective_status: effectiveStatus,
      device: safe,
      mutation_performed: false,
      secrets_included: false,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "device_link_preview_failed", message: err.message }, secrets_included: false });
  }
}

export async function pollDeviceLinkSession(req, res) {
  try {
    await assertDeviceLinkTableSchema();
    const displayCode = cleanText(req.body?.device_code || req.body?.user_code || req.body?.code, 16).toUpperCase();
    const pollToken = cleanText(req.body?.poll_token, 200);
    const challenge = cleanText(req.body?.device_proof_challenge, 200);
    const signature = cleanText(req.body?.device_proof, 1024);
    if (!displayCode || !pollToken || !challenge || !signature) {
      return res.status(400).json({ ok: false, error: { code: "missing_poll_fields", message: "device_code, poll_token, device_proof_challenge, and device_proof are required." }, secrets_included: false });
    }

    const [rows] = await getPool().query(
      `SELECT * FROM \`local_manager_device_link_sessions\` WHERE display_code_hash = ? LIMIT 1`,
      [sha256(displayCode)]
    );
    const row = rows[0] || null;
    if (!row || row.poll_token_hash !== sha256(pollToken)) {
      return res.status(404).json({ ok: false, error: { code: "device_link_not_found", message: "Pairing session was not found." }, secrets_included: false });
    }
    if (!verifyDevicePossession({ row, displayCode, pollToken, challenge, signature })) {
      return res.status(401).json({ ok: false, error: { code: "invalid_device_proof", message: "Device proof-of-possession is invalid." }, secrets_included: false });
    }
    if (new Date(row.expires_at).getTime() <= nowMs() && row.status === "pending") {
      await getPool().query(`UPDATE \`local_manager_device_link_sessions\` SET status = 'expired' WHERE session_id = ?`, [row.session_id]);
      return res.status(410).json({ ok: false, status: "expired", error: { code: "device_link_expired", message: "Pairing code expired." }, secrets_included: false });
    }
    if (row.status === "pending") {
      return res.status(202).json({ ok: true, status: "pending", interval: POLL_INTERVAL_SECONDS, expires_at: new Date(row.expires_at).toISOString(), secrets_included: false });
    }
    if (row.status === "revoked" || row.revoked_at) {
      return res.status(403).json({ ok: false, status: "revoked", error: { code: "device_link_revoked", message: "This linked device has been revoked." }, secrets_included: false });
    }
    if (!["approved", "completed"].includes(row.status)) {
      return res.status(200).json({ ok: true, status: row.status, device: sanitizeSession(row), secrets_included: false });
    }

    const connectorAlias = await inspectLocalConnectorAliasForDeviceLink({
      session: row,
      principal: { user_id: row.user_id, tenant_id: row.tenant_id || null },
    });
    if (!connectorAlias.resolved) {
      return res.status(409).json({
        ok: false,
        status: "approved",
        error: {
          code: "connector_alias_reconciliation_required",
          message: "Device approval is durable, but canonical connector identity must be reconciled before a device token can be issued.",
          details: {
            reconciliation_required: true,
            required_authority: connectorAlias.required_authority,
            missing_aliases: connectorAlias.missing_aliases || [],
          },
        },
        connector_alias: connectorAlias,
        secrets_included: false,
      });
    }

    let issuedRow = row;
    if (row.status === "approved" && !row.completed_at) {
      const issuanceJti = crypto.randomUUID();
      const [issuanceResult] = await getPool().query(
        `UPDATE \`local_manager_device_link_sessions\`
            SET status = 'completed',
                completed_at = NOW(),
                device_token_jti = ?,
                device_token_issued_at = NOW(),
                display_code = NULL
          WHERE session_id = ?
            AND status = 'approved'
            AND completed_at IS NULL
            AND revoked_at IS NULL
          LIMIT 1`,
        [issuanceJti, row.session_id]
      );
      const [issuedRows] = await getPool().query(
        `SELECT * FROM \`local_manager_device_link_sessions\`
          WHERE session_id = ?
            AND status = 'completed'
            AND revoked_at IS NULL
          LIMIT 1`,
        [row.session_id]
      );
      issuedRow = issuedRows[0] || null;
      if (!issuedRow?.device_token_jti || !issuedRow?.device_token_issued_at) {
        const code = Number(issuanceResult?.affectedRows || 0) === 1
          ? "device_token_issuance_readback_failed"
          : "device_token_issuance_not_owned";
        return res.status(409).json({ ok: false, error: { code, message: "Device token issuance could not be proven from durable state." }, secrets_included: false });
      }
    }

    if (!issuedRow?.device_token_jti || !issuedRow?.device_token_issued_at) {
      return res.status(409).json({ ok: false, error: { code: "device_token_issuance_state_missing", message: "This device link predates durable token issuance. Re-link the device." }, secrets_included: false });
    }

    const deviceAccessToken = signDeviceAccessToken(issuedRow);
    return res.status(200).json({
      ok: true,
      status: "approved",
      authorization_status: "approved",
      device_status: issuedRow.status,
      device_access_token: deviceAccessToken,
      token_type: "Bearer",
      expires_in: DEVICE_TOKEN_TTL_SECONDS,
      device: sanitizeSession(issuedRow),
      token_replay_idempotent: true,
      ...credentialDelivery(["device_access_token"]),
    });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "device_link_poll_failed", message: err.message }, secrets_included: false });
  }
}

export async function approveDeviceLinkSession(req, res) {
  try {
    await assertDeviceLinkTableSchema();
    const principal = await requireLocalManagerUser(req);
    const displayCode = cleanText(req.body?.device_code || req.body?.user_code || req.body?.code, 16).toUpperCase();
    const consent = cleanText(req.body?.consent, 64);
    const previewFingerprint = cleanText(req.body?.pairing_fingerprint, 64).toLowerCase();
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
    if (consent !== "approve_device" || previewFingerprint !== pairingFingerprint(row, displayCode)) {
      return res.status(400).json({ ok: false, error: { code: "explicit_pairing_consent_required", message: "Review the device preview and explicitly approve this exact pairing request." }, secrets_included: false });
    }
    if (new Date(row.expires_at).getTime() <= nowMs()) {
      await getPool().query(`UPDATE \`local_manager_device_link_sessions\` SET status = 'expired' WHERE session_id = ? AND status = 'pending'`, [row.session_id]);
      return res.status(410).json({ ok: false, error: { code: "device_link_expired", message: "Pairing code expired." }, secrets_included: false });
    }
    if (row.status !== "pending") {
      const sameOwner = row.user_id === principal.user_id && (sameTenantScope(row.tenant_id, principal.tenant_id));
      if (sameOwner && ["approved", "completed"].includes(row.status)) {
        const connectorAlias = await reconcileLocalConnectorAliasForDeviceLink({ session: row, principal });
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
          AND ((? IS NULL AND tenant_id IS NULL) OR tenant_id = ?)
          AND status IN ('approved','completed')
        ORDER BY COALESCE(completed_at, approved_at, created_at) DESC
        LIMIT 1`,
      [row.device_id, principal.user_id, principal.tenant_id, principal.tenant_id]
    );
    const existingLinked = existingRows[0] || null;

    const [approvalResult] = await getPool().query(
      `UPDATE \`local_manager_device_link_sessions\`
          SET status = 'approved',
              user_id = ?,
              tenant_id = ?,
              approved_at = NOW(),
              display_code = NULL
        WHERE session_id = ?
          AND status = 'pending'
          AND expires_at > NOW()
          AND revoked_at IS NULL
        LIMIT 1`,
      [principal.user_id, principal.tenant_id, row.session_id]
    );
    if (Number(approvalResult?.affectedRows || 0) !== 1) {
      const [currentRows] = await getPool().query(
        `SELECT * FROM \`local_manager_device_link_sessions\` WHERE session_id = ? LIMIT 1`,
        [row.session_id]
      );
      const current = currentRows[0] || null;
      const sameOwner = current
        && current.user_id === principal.user_id
        && (sameTenantScope(current.tenant_id, principal.tenant_id));
      if (sameOwner && ["approved", "completed"].includes(current.status) && !current.revoked_at) {
        return res.status(200).json({
          ok: true,
          status: current.status,
          already_linked: true,
          reauthorized_existing_device: true,
          user: principal,
          device: sanitizeSession(current),
          connector_alias: { attempted: false, resolved: false, reason: "approval_transition_already_owned", secrets_included: false },
          secrets_included: false,
        });
      }
      return res.status(409).json({ ok: false, status: current?.status || "unknown", error: { code: "device_link_approval_not_owned", message: "Pairing approval was completed or changed by another request." }, secrets_included: false });
    }
    const [approvedRows] = await getPool().query(
      `SELECT * FROM \`local_manager_device_link_sessions\` WHERE session_id = ? AND status = 'approved' LIMIT 1`,
      [row.session_id]
    );
    const approved = approvedRows[0] || null;
    if (!approved) {
      return res.status(409).json({ ok: false, error: { code: "device_link_approval_readback_failed", message: "Pairing approval could not be proven from durable state." }, secrets_included: false });
    }
    const connectorAlias = await reconcileLocalConnectorAliasForDeviceLink({ session: approved, principal });
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

export async function provisionDeviceN8n(req, res) {
  try {
    await assertDeviceLinkTableSchema();
    const principal = await requireLocalManagerUser(req);
    const sessionId = cleanText(req.body?.session_id, 64);
    if (!sessionId) {
      return res.status(400).json({
        ok: false,
        error: { code: "local_manager_n8n_session_required", message: "session_id is required for explicit n8n provisioning." },
        secrets_included: false,
      });
    }
    const [rows] = await getPool().query(
      `SELECT * FROM \`local_manager_device_link_sessions\`
        WHERE session_id = ?
          AND user_id = ?
          AND ((? IS NULL AND tenant_id IS NULL) OR tenant_id = ?)
          AND status IN ('approved','completed')
          AND revoked_at IS NULL
        LIMIT 1`,
      [sessionId, principal.user_id, principal.tenant_id, principal.tenant_id]
    );
    if (rows.length > 1) {
      const error = new Error("Device-link session cardinality is ambiguous.");
      error.status = 409;
      error.code = "local_manager_device_link_cardinality_conflict";
      throw error;
    }
    const [row = null] = rows;
    if (!row) {
      return res.status(404).json({
        ok: false,
        error: { code: "local_manager_n8n_device_not_found", message: "An active linked device was not found for this user and tenant." },
        secrets_included: false,
      });
    }
    if (!localManagerWriteAuthorityEnabled()) {
      return res.status(503).json({
        ok: false,
        provisioning_required: true,
        mutation_performed: false,
        apply_authorized: false,
        required_authority: "local_manager_n8n_provisioning_writer",
        error: { code: "local_manager_n8n_writer_not_ready", message: "Dedicated Local Manager write authority is not enabled." },
        secrets_included: false,
      });
    }
    const device = {
      user_id: principal.user_id,
      tenant_id: principal.tenant_id,
      device_id: row.device_id,
      session_id: row.session_id,
    };
    const applied = await provisionLocalManagerN8n({
      device,
      profile: defaultN8nProfile({ device }),
    });
    const readback = await resolveTenantN8nProfile(device);
    if (!readback.provisioned || !readback.installation_id) {
      return res.status(409).json({
        ok: false,
        provisioning_required: true,
        mutation_performed: Boolean(applied.mutation_performed),
        apply_authorized: true,
        required_authority: "local_manager_n8n_provisioning_writer",
        error: { code: "local_manager_n8n_provisioning_readback_failed", message: "n8n provisioning was not visible through the runtime read path." },
        secrets_included: false,
      });
    }
    return res.status(applied.created ? 201 : 200).json({
      ok: true,
      provisioned: true,
      provisioning_required: false,
      mutation_performed: Boolean(applied.mutation_performed),
      apply_authorized: true,
      writer_authority: "local_manager_n8n_provisioning_writer",
      writer_readback_proven: true,
      n8n_connector: readback,
      secrets_included: false,
    });
  } catch (err) {
    return res.status(err.status || 500).json({
      ok: false,
      error: { code: err.code || "local_manager_n8n_provision_failed", message: err.message, ...(err.details ? { details: err.details } : {}) },
      secrets_included: false,
    });
  }
}

export async function listLinkedDevices(req, res) {
  try {
    await assertDeviceLinkTableSchema();
    const principal = await requireLocalManagerUser(req);
    const [linkRows] = await getPool().query(
      `SELECT * FROM \`local_manager_device_link_sessions\`
        WHERE user_id = ? AND ((? IS NULL AND tenant_id IS NULL) OR tenant_id = ?)
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
    payload = jwt.verify(token, deviceJwtSecret(), {
      algorithms: ["HS256"],
      issuer: localManagerJwtIssuer(),
      audience: DEVICE_JWT_AUDIENCE,
    });
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

  await assertDeviceLinkTableSchema();
  const [rows] = await getPool().query(
    `SELECT * FROM \`local_manager_device_link_sessions\`
      WHERE session_id = ?
        AND device_id = ?
        AND user_id = ?
        AND ((? IS NULL AND tenant_id IS NULL) OR tenant_id = ?)
        AND status = 'completed'
        AND revoked_at IS NULL
        AND device_token_jti = ?
      LIMIT 1`,
    [device.session_id, device.device_id, device.user_id, device.tenant_id, device.tenant_id, cleanText(payload.jti, 64)]
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
    requires_reauth_for_privileged_installers: true,
    privileged_authorization_max_age_seconds: PRIVILEGED_DEVICE_AUTH_MAX_AGE_SECONDS,
    privileged_authorization_fresh: authAgeSeconds !== null && authAgeSeconds <= PRIVILEGED_DEVICE_AUTH_MAX_AGE_SECONDS,
    auth_age_seconds: authAgeSeconds,
    token_issued_at: issuedAtSeconds ? new Date(issuedAtSeconds * 1000).toISOString() : null,
    token_expires_at: expiresAtSeconds ? new Date(expiresAtSeconds * 1000).toISOString() : null,
  };
  return { ...device, session: sanitizeSession(row), auth_context: authContext };
}

export async function requireFreshLocalManagerDeviceForPrivilegedInstaller(req) {
  const device = await requireLocalManagerDevice(req);
  if (device.auth_context?.privileged_authorization_fresh === true) return device;

  const stepUpAuthorization = cleanText(req.headers?.["x-local-manager-user-authorization"], 8192);
  const result = verifyUserJwtAuthorization(stepUpAuthorization, {
    issuer: localManagerJwtIssuer(),
    audience: LOCAL_MANAGER_USER_JWT_AUDIENCE,
    requiredPurpose: LOCAL_MANAGER_USER_JWT_PURPOSE,
    requiredScope: LOCAL_MANAGER_USER_JWT_SCOPE,
  });
  const claims = result.ok ? result.claims : null;
  const issuedAtSeconds = Number(claims?.iat || 0) || null;
  const authAgeSeconds = issuedAtSeconds ? Math.max(0, Math.floor(Date.now() / 1000) - issuedAtSeconds) : null;
  const deviceTenantId = cleanText(device.tenant_id, 64) || null;
  const claimTenantId = cleanText(claims?.tenant_id, 64) || null;
  const tenantMatches = deviceTenantId ? claimTenantId === deviceTenantId : claimTenantId === null;
  if (!result.ok
      || cleanText(claims?.user_id, 64) !== device.user_id
      || !tenantMatches
      || authAgeSeconds === null
      || authAgeSeconds > PRIVILEGED_DEVICE_AUTH_MAX_AGE_SECONDS) {
    const err = new Error("Fresh Local Manager user authorization is required for privileged installer actions.");
    err.status = 401;
    err.code = "fresh_local_manager_user_authorization_required";
    err.details = {
      header: "x-local-manager-user-authorization",
      max_age_seconds: PRIVILEGED_DEVICE_AUTH_MAX_AGE_SECONDS,
      same_user_required: true,
      same_tenant_required: true,
      secrets_included: false,
    };
    throw err;
  }
  return {
    ...device,
    auth_context: {
      ...device.auth_context,
      source: "saved_device_token_plus_fresh_user_step_up",
      interactive_user_session_present: true,
      requires_reauth_for_privileged_installers: true,
      privileged_authorization_fresh: true,
      step_up_auth_age_seconds: authAgeSeconds,
      step_up_purpose: LOCAL_MANAGER_USER_JWT_PURPOSE,
    },
  };
}

export async function revokeDeviceLinkSession(req, res) {
  try {
    await assertDeviceLinkTableSchema();
    const principal = req.local_manager_user_principal || await requireLocalManagerUser(req);
    const sessionId = cleanText(req.params?.sessionId || req.body?.session_id, 64);
    if (!sessionId) {
      return res.status(400).json({ ok: false, error: { code: "device_link_session_id_required", message: "session_id is required." }, secrets_included: false });
    }
    const [result] = await getPool().query(
      `UPDATE \`local_manager_device_link_sessions\`
          SET status = 'revoked',
              revoked_at = NOW(),
              revoked_by_user_id = ?
        WHERE session_id = ?
          AND user_id = ?
          AND ((? IS NULL AND tenant_id IS NULL) OR tenant_id = ?)
          AND status IN ('approved','completed')
          AND revoked_at IS NULL
        LIMIT 1`,
      [principal.user_id, sessionId, principal.user_id, principal.tenant_id, principal.tenant_id]
    );
    if (Number(result?.affectedRows || 0) !== 1) {
      const [rows] = await getPool().query(
        `SELECT * FROM \`local_manager_device_link_sessions\`
          WHERE session_id = ? AND user_id = ? AND ((? IS NULL AND tenant_id IS NULL) OR tenant_id = ?)
          LIMIT 1`,
        [sessionId, principal.user_id, principal.tenant_id, principal.tenant_id]
      );
      if (rows.length > 1) {
        const error = new Error("Device-link session cardinality is ambiguous.");
        error.status = 409;
        error.code = "local_manager_device_link_cardinality_conflict";
        throw error;
      }
      const [current = null] = rows;
      if (current?.status === "revoked" || current?.revoked_at) {
        return res.status(200).json({ ok: true, status: "revoked", already_revoked: true, device: sanitizeSession(current), secrets_included: false });
      }
      return res.status(404).json({ ok: false, error: { code: "device_link_not_found", message: "Linked device session was not found for this user." }, secrets_included: false });
    }
    const [rows] = await getPool().query(
      `SELECT * FROM \`local_manager_device_link_sessions\`
        WHERE session_id = ?
          AND user_id = ?
          AND ((? IS NULL AND tenant_id IS NULL) OR tenant_id = ?)
        LIMIT 1`,
      [sessionId, principal.user_id, principal.tenant_id, principal.tenant_id]
    );
    if (rows.length > 1) {
      const error = new Error("Device-link session cardinality is ambiguous.");
      error.status = 409;
      error.code = "local_manager_device_link_cardinality_conflict";
      throw error;
    }
    const [revokedRow = null] = rows;
    const device = revokedRow || { session_id: sessionId, status: "revoked" };
    return res.status(200).json({ ok: true, status: "revoked", device: sanitizeSession(device), secrets_included: false });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: { code: err.code || "device_link_revoke_failed", message: err.message, ...(err.details ? { details: err.details } : {}) }, secrets_included: false });
  }
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
    const [rows] = await getPool().query(
      `SELECT * FROM \`local_manager_control_templates\`
        WHERE status = 'active' AND template_type IN ('capability','app')
        ORDER BY template_type ASC, sort_order ASC, label ASC`
    );
    if (!rows.length) {
      const error = new Error("Local Manager control-template registry is empty.");
      error.status = 503;
      error.code = "local_manager_control_template_registry_empty";
      error.details = {
        registry_table: "local_manager_control_templates",
        migration_required: "20260922_local_manager_control_templates_registry.sql",
        governed_seed_required: true,
        code_fallback_allowed: false,
        secrets_included: false,
      };
      throw error;
    }
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
    const error = new Error("Local Manager control-template registry is unavailable to runtime read authority.");
    error.status = 503;
    error.code = "local_manager_control_template_registry_unavailable";
    error.details = {
      registry_table: "local_manager_control_templates",
      migration_required: "20260922_local_manager_control_templates_registry.sql",
      required_operations: ["SELECT"],
      runtime_schema_mutation_allowed: false,
      code_fallback_allowed: false,
      cause_code: err?.code || null,
      secrets_included: false,
    };
    throw error;
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

    const n8nConnector = section === "n8n" ? await resolveTenantN8nProfile(device) : null;
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

export const _testingLocalManagerDeviceLink = Object.freeze({
  credentialDelivery,
  importDevicePublicKey,
  pairingFingerprint,
  sanitizePublicPairingPreview,
  verifyDevicePossession,
  isDuplicateKeyError,
  createDeviceLinkSessionWithRetry,
});
