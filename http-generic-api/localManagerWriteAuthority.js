import crypto from "node:crypto";
import mysql from "mysql2/promise";

let localManagerWritePool = null;

export const LOCAL_MANAGER_WRITE_IDENTITY_CONTRACT = Object.freeze({
  enabled_env: "LOCAL_MANAGER_WRITE_AUTHORITY_ENABLED",
  identity_prefix: "LOCAL_MANAGER_WRITE_DB_",
  mode: "dedicated_local_manager_writer",
  separated_identity_required: true,
  generic_runtime_fallback_forbidden: true,
  secrets_included: false,
});

export const LOCAL_MANAGER_WRITE_PRIVILEGE_MATRIX = Object.freeze({
  local_connector_device_aliases: Object.freeze(["SELECT", "INSERT", "UPDATE"]),
  connected_systems: Object.freeze(["SELECT", "INSERT", "UPDATE"]),
  installations: Object.freeze(["SELECT", "INSERT", "UPDATE"]),
});

function clean(value, max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function fail(code, message, status = 503, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  return error;
}

export function localManagerWriteAuthorityEnabled(env = process.env) {
  return enabled(env.LOCAL_MANAGER_WRITE_AUTHORITY_ENABLED);
}

export function resolveLocalManagerWriteDbConfig(env = process.env) {
  if (!localManagerWriteAuthorityEnabled(env)) {
    throw fail("LOCAL_MANAGER_WRITE_AUTHORITY_DISABLED", "Local Manager dedicated write authority is disabled.");
  }
  const required = ["HOST", "NAME", "USER", "PASSWORD"];
  const missing = required.filter((key) => !clean(env[`LOCAL_MANAGER_WRITE_DB_${key}`]));
  if (missing.length) {
    throw fail(
      "LOCAL_MANAGER_WRITE_DB_CONFIG_MISSING",
      "Local Manager dedicated write authority is enabled but incomplete.",
      503,
      { missing_keys: missing.map((key) => `LOCAL_MANAGER_WRITE_DB_${key}`) },
    );
  }
  const user = clean(env.LOCAL_MANAGER_WRITE_DB_USER, 128);
  const runtimeUser = clean(env.DB_USER, 128);
  if (!user || user.toLowerCase() === "root" || (runtimeUser && user === runtimeUser)) {
    throw fail(
      "LOCAL_MANAGER_WRITE_DB_IDENTITY_NOT_DEDICATED",
      "Local Manager write authority must use a non-root identity distinct from DB_USER.",
    );
  }
  return {
    host: clean(env.LOCAL_MANAGER_WRITE_DB_HOST, 255),
    port: Number(env.LOCAL_MANAGER_WRITE_DB_PORT) || 3306,
    database: clean(env.LOCAL_MANAGER_WRITE_DB_NAME, 128),
    user,
    password: String(env.LOCAL_MANAGER_WRITE_DB_PASSWORD),
    waitForConnections: true,
    connectionLimit: Number(env.LOCAL_MANAGER_WRITE_DB_CONNECTION_LIMIT) || 3,
    queueLimit: 0,
    connectTimeout: Number(env.LOCAL_MANAGER_WRITE_DB_CONNECT_TIMEOUT_MS) || 10000,
    timezone: "Z",
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  };
}

export function getLocalManagerWritePool(env = process.env) {
  if (!localManagerWritePool) {
    localManagerWritePool = mysql.createPool(resolveLocalManagerWriteDbConfig(env));
  }
  return localManagerWritePool;
}

function sameTenant(left, right) {
  const a = clean(left, 64) || null;
  const b = clean(right, 64) || null;
  return a === b;
}

export async function reconcileLocalConnectorAliases({
  userId,
  tenantId,
  canonicalDeviceId,
  canonicalConfigId,
  aliases = [],
  pool = null,
} = {}) {
  const writer = pool || getLocalManagerWritePool();
  const user = clean(userId, 64);
  const tenant = clean(tenantId, 64) || null;
  const canonicalDevice = clean(canonicalDeviceId, 128);
  const canonicalConfig = clean(canonicalConfigId, 64);
  const normalizedAliases = [...new Set((aliases || [])
    .map((value) => clean(value, 128))
    .filter(Boolean)
    .filter((value) => value.toLowerCase() !== canonicalDevice.toLowerCase()))];

  if (!user || !canonicalDevice || !canonicalConfig) {
    throw fail("LOCAL_MANAGER_ALIAS_RECONCILIATION_SCOPE_INVALID", "Alias reconciliation requires exact user and canonical connector identity.", 400);
  }
  if (!normalizedAliases.length) {
    return { ok: true, resolved: true, mutation_performed: false, aliases: [], secrets_included: false };
  }

  const reason = "Governed Local Manager device-link approval reconciliation.";
  for (const alias of normalizedAliases) {
    await writer.query(
      `INSERT INTO \`local_connector_device_aliases\`
        (alias_device_id, canonical_device_id, canonical_config_id, user_id, tenant_id, reason, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         canonical_device_id = VALUES(canonical_device_id),
         canonical_config_id = VALUES(canonical_config_id),
         user_id = VALUES(user_id),
         tenant_id = VALUES(tenant_id),
         reason = VALUES(reason),
         status = 'active',
         updated_at = NOW()`,
      [alias, canonicalDevice, canonicalConfig, user, tenant, reason],
    );
  }

  const placeholders = normalizedAliases.map(() => "?").join(", ");
  const [rows] = await writer.query(
    `SELECT alias_device_id, canonical_device_id, canonical_config_id, user_id, tenant_id, status
       FROM \`local_connector_device_aliases\`
      WHERE user_id = ?
        AND alias_device_id IN (${placeholders})
        AND status = 'active'`,
    [user, ...normalizedAliases],
  );
  const matching = rows.filter((row) =>
    clean(row.canonical_device_id, 128).toLowerCase() === canonicalDevice.toLowerCase()
    && clean(row.canonical_config_id, 64) === canonicalConfig
    && sameTenant(row.tenant_id, tenant)
  );
  if (matching.length !== normalizedAliases.length) {
    throw fail(
      "LOCAL_MANAGER_ALIAS_RECONCILIATION_READBACK_FAILED",
      "Alias reconciliation could not be proven from the dedicated writer readback.",
      409,
      { expected_alias_count: normalizedAliases.length, observed_alias_count: matching.length },
    );
  }
  return {
    ok: true,
    resolved: true,
    mutation_performed: true,
    aliases: matching.map((row) => ({
      alias_device_id: row.alias_device_id,
      canonical_device_id: row.canonical_device_id,
      canonical_config_id: row.canonical_config_id,
      status: row.status,
    })),
    secrets_included: false,
  };
}

export async function provisionLocalManagerN8n({
  device,
  profile,
  pool = null,
} = {}) {
  const writer = pool || getLocalManagerWritePool();
  const userId = clean(device?.user_id, 64);
  const tenantId = clean(device?.tenant_id, 64);
  const deviceId = clean(device?.device_id, 128);
  if (!userId || !tenantId || !deviceId) {
    throw fail("LOCAL_MANAGER_N8N_PROVISIONING_SCOPE_INVALID", "n8n provisioning requires exact user, tenant, and device scope.", 400);
  }
  const systemKey = `local_n8n:${clean(deviceId, 64)}`;
  const profileJson = JSON.stringify({ ...(profile || {}), secrets_included: false });
  const installationMeta = JSON.stringify({
    user_id: userId,
    device_id: deviceId,
    autopilot_enabled: true,
    local_only: true,
    writes_local_files: true,
    secrets_included: false,
  });

  const [existing] = await writer.query(
    `SELECT cs.system_id, cs.display_name, cs.status, cs.config_json, i.installation_id
       FROM \`connected_systems\` cs
       LEFT JOIN \`installations\` i
         ON i.system_id = cs.system_id
        AND i.tenant_id = cs.tenant_id
        AND i.status = 'active'
        AND JSON_UNQUOTE(JSON_EXTRACT(i.meta_json, '$.user_id')) = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(i.meta_json, '$.device_id')) = ?
      WHERE cs.tenant_id = ?
        AND cs.system_key = ?
        AND cs.provider_family = 'n8n'
        AND cs.status IN ('active','pending')
      LIMIT 1`,
    [userId, deviceId, tenantId, systemKey],
  );
  if (existing[0]?.installation_id) {
    return {
      ok: true,
      provisioned: true,
      created: false,
      mutation_performed: false,
      system_id: existing[0].system_id,
      installation_id: existing[0].installation_id,
      status: existing[0].status,
      secrets_included: false,
    };
  }

  let systemId = existing[0]?.system_id || crypto.randomUUID();
  if (!existing[0]) {
    await writer.query(
      `INSERT INTO \`connected_systems\`
        (system_id, tenant_id, system_key, display_name, provider_family, provider_domain, connector_family, auth_type, service_mode, self_serve_capable, assisted_capable, managed_capable, status, config_json, created_at, updated_at)
       VALUES (?, ?, ?, 'Local n8n', 'n8n', 'n8n.io', 'local_desktop', 'local_manual', 'self_serve', 1, 0, 0, 'active', ?, NOW(), NOW())`,
      [systemId, tenantId, systemKey, profileJson],
    );
  } else {
    await writer.query(
      `UPDATE \`connected_systems\`
          SET config_json = ?, status = 'active', updated_at = NOW()
        WHERE system_id = ? AND tenant_id = ? AND system_key = ? AND provider_family = 'n8n'
        LIMIT 1`,
      [profileJson, systemId, tenantId, systemKey],
    );
  }

  const installationId = crypto.randomUUID();
  await writer.query(
    `INSERT INTO \`installations\`
      (installation_id, system_id, tenant_id, scope, credential_ref, status, installed_at, expires_at, meta_json)
     VALUES (?, ?, ?, 'local_device', NULL, 'active', NOW(), NULL, ?)`,
    [installationId, systemId, tenantId, installationMeta],
  );

  const [readback] = await writer.query(
    `SELECT cs.system_id, cs.status, i.installation_id
       FROM \`connected_systems\` cs
       JOIN \`installations\` i
         ON i.system_id = cs.system_id
        AND i.tenant_id = cs.tenant_id
        AND i.status = 'active'
      WHERE cs.system_id = ?
        AND cs.tenant_id = ?
        AND cs.system_key = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(i.meta_json, '$.user_id')) = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(i.meta_json, '$.device_id')) = ?
      LIMIT 1`,
    [systemId, tenantId, systemKey, userId, deviceId],
  );
  if (!readback[0]?.installation_id) {
    throw fail("LOCAL_MANAGER_N8N_PROVISIONING_READBACK_FAILED", "n8n provisioning could not be proven from the dedicated writer readback.", 409);
  }
  return {
    ok: true,
    provisioned: true,
    created: true,
    mutation_performed: true,
    system_id: readback[0].system_id,
    installation_id: readback[0].installation_id,
    status: readback[0].status,
    secrets_included: false,
  };
}
