import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

export const PLATFORM_CREDENTIAL_CLIENT_CONFIG_PREFIX = "platform_credential_client";

export const PLATFORM_CREDENTIAL_CLIENT_TYPES = Object.freeze([
  "api_key",
  "oauth_client",
  "service_account",
]);

const VALID_CREDENTIAL_TYPES = new Set(PLATFORM_CREDENTIAL_CLIENT_TYPES);
const VALID_OWNER_TYPES = new Set(["platform", "tenant"]);

function parseJsonConfig(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function cleanKey(value, fallback = "") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function cleanText(value, fallback = "", max = 255) {
  const normalized = String(value || "").trim().slice(0, max);
  return normalized || fallback;
}

function cleanStringArray(value) {
  const raw = Array.isArray(value) ? value : [];
  return [...new Set(raw.map((item) => String(item || "").trim()).filter(Boolean))];
}

export function buildPlatformCredentialClientConfigKey(config = {}) {
  const ownerType = cleanKey(config.owner_type, "platform");
  const ownerId = ownerType === "tenant" ? cleanKey(config.tenant_id, "unassigned").slice(0, 24) : "global";
  const channelKey = cleanKey(config.channel_key, "default").slice(0, 24);
  const credentialType = cleanKey(config.credential_type, "oauth_client");
  const clientKey = cleanKey(config.client_key, "default").slice(0, 24);
  return `${PLATFORM_CREDENTIAL_CLIENT_CONFIG_PREFIX}.${ownerType}.${ownerId}.${channelKey}.${credentialType}.${clientKey}`;
}

export function normalizePlatformCredentialClientConfig(args = {}) {
  const ownerType = cleanKey(args.owner_type, "platform");
  if (!VALID_OWNER_TYPES.has(ownerType)) {
    const err = new Error("owner_type must be platform or tenant.");
    err.status = 400;
    err.code = "invalid_owner_type";
    throw err;
  }

  const credentialType = cleanKey(args.credential_type, "oauth_client");
  if (!VALID_CREDENTIAL_TYPES.has(credentialType)) {
    const err = new Error(`credential_type must be one of: ${PLATFORM_CREDENTIAL_CLIENT_TYPES.join(", ")}.`);
    err.status = 400;
    err.code = "invalid_credential_type";
    throw err;
  }

  const channelKey = cleanKey(args.channel_key, "custom_gpt");
  const clientKey = cleanKey(args.client_key || args.project_key, randomUUID());
  const tenantId = ownerType === "tenant" ? cleanText(args.tenant_id, "", 128) : null;
  if (ownerType === "tenant" && !tenantId) {
    const err = new Error("tenant_id is required for tenant-owned credential clients.");
    err.status = 400;
    err.code = "missing_tenant_id";
    throw err;
  }

  return {
    owner_type: ownerType,
    tenant_id: tenantId,
    channel_key: channelKey,
    credential_type: credentialType,
    client_key: clientKey,
    display_name: cleanText(args.display_name, `${channelKey} ${credentialType}`),
    provider: cleanKey(args.provider, "google"),
    project_id: cleanText(args.project_id, "", 128) || null,
    status: cleanKey(args.status, "active"),
    api_key: credentialType === "api_key"
      ? {
          key_secret_ref: cleanText(args.key_secret_ref, "", 255) || null,
          allowed_apis: cleanStringArray(args.allowed_apis),
          restrictions: args.restrictions && typeof args.restrictions === "object" ? args.restrictions : {},
        }
      : undefined,
    oauth_client: credentialType === "oauth_client"
      ? {
          client_id: cleanText(args.client_id, "", 255) || null,
          client_secret_ref: cleanText(args.client_secret_ref, "", 255) || null,
          redirect_uris: cleanStringArray(args.redirect_uris || args.callback_urls_to_allow),
          scopes: cleanStringArray(args.scopes),
          token_exchange_method: cleanText(args.token_exchange_method, "default_post_request", 64),
        }
      : undefined,
    service_account: credentialType === "service_account"
      ? {
          service_account_email: cleanText(args.service_account_email, "", 255) || null,
          key_secret_ref: cleanText(args.key_secret_ref, "", 255) || null,
          roles: cleanStringArray(args.roles),
        }
      : undefined,
    notes: cleanText(args.notes || args.note, "", 500) || null,
    updated_at: new Date().toISOString(),
  };
}

export async function ensurePlatformCredentialClientConfigTable(pool = getPool()) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS \`platform_runtime_config\` (
      \`config_key\`  VARCHAR(128) NOT NULL,
      \`config_json\` JSON         NOT NULL,
      \`status\`      ENUM('active','disabled') NOT NULL DEFAULT 'active',
      \`note\`        VARCHAR(255) NULL,
      \`created_at\`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`config_key\`),
      KEY \`idx_prc_status\` (\`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

export async function upsertPlatformCredentialClientConfig(args = {}) {
  const config = normalizePlatformCredentialClientConfig(args);
  const pool = args.pool || getPool();
  const configKey = buildPlatformCredentialClientConfigKey(config);
  const note = cleanText(args.note, "platform_credential_client", 255);

  await ensurePlatformCredentialClientConfigTable(pool);
  await pool.query(
    `INSERT INTO \`platform_runtime_config\`
       (config_key, config_json, status, note)
     VALUES (?, ?, 'active', ?)
     ON DUPLICATE KEY UPDATE
       config_json = VALUES(config_json),
       status = 'active',
       note = VALUES(note),
       updated_at = CURRENT_TIMESTAMP`,
    [configKey, JSON.stringify(config), note]
  );

  return {
    ok: true,
    config_key: configKey,
    config,
    credential_options_supported: PLATFORM_CREDENTIAL_CLIENT_TYPES,
    next_step: "Use this DB record as the governed credential-client authority for platform-controlled projects.",
  };
}

export async function listPlatformCredentialClientConfigs(args = {}) {
  const ownerType = args.owner_type ? cleanKey(args.owner_type) : "";
  const channelKey = args.channel_key ? cleanKey(args.channel_key) : "";
  const credentialType = args.credential_type ? cleanKey(args.credential_type) : "";
  const prefix = [
    PLATFORM_CREDENTIAL_CLIENT_CONFIG_PREFIX,
    ownerType,
    ownerType === "tenant" ? cleanKey(args.tenant_id, "") : ownerType ? "global" : "",
    channelKey,
    credentialType,
  ].filter(Boolean).join(".");
  const like = `${prefix || PLATFORM_CREDENTIAL_CLIENT_CONFIG_PREFIX}.%`;

  const [rows] = await getPool().query(
    `SELECT config_key, config_json, status, note, updated_at
       FROM \`platform_runtime_config\`
      WHERE config_key LIKE ?
      ORDER BY updated_at DESC
      LIMIT ?`,
    [like, Math.min(Math.max(Number(args.limit) || 50, 1), 200)]
  );

  return {
    ok: true,
    credential_options_supported: PLATFORM_CREDENTIAL_CLIENT_TYPES,
    clients: rows.map((row) => ({
      config_key: row.config_key,
      status: row.status,
      note: row.note,
      updated_at: row.updated_at,
      config: parseJsonConfig(row.config_json),
    })),
  };
}
