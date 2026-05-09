import { randomBytes, timingSafeEqual } from "node:crypto";
import { getPool } from "./db.js";
import {
  TENANT_GPT_CALLBACK_URLS_TO_ALLOW,
  TENANT_GPT_OAUTH_CLIENT_ID,
  TENANT_GPT_SCOPE,
  TENANT_GPT_SCOPE_LINKS,
} from "./tenantGptOAuthPreset.js";

export const TENANT_GPT_OAUTH_CLIENT_CONFIG_KEY = "tenant_gpt.oauth.client";

function parseJsonConfig(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function cleanClientId(value) {
  const normalized = String(value || "").trim();
  return normalized || TENANT_GPT_OAUTH_CLIENT_ID;
}

function cleanSecret(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function cleanCallbackUrls(value) {
  const raw = Array.isArray(value) ? value : [];
  const cleaned = raw
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return [...new Set(cleaned.length ? cleaned : TENANT_GPT_CALLBACK_URLS_TO_ALLOW)];
}

function fixedTimeEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

export function generateTenantGptOAuthClientSecret() {
  return `m4b_tgpt_${randomBytes(32).toString("base64url")}`;
}

export function sanitizeTenantGptOAuthClientConfig(config = {}, source = "unknown") {
  const clientId = cleanClientId(config.client_id);
  const clientSecret = cleanSecret(config.client_secret);

  return {
    source,
    client_id: clientId,
    client_secret: clientSecret,
    client_secret_required: Boolean(clientSecret),
    scope: TENANT_GPT_SCOPE,
    scope_links: TENANT_GPT_SCOPE_LINKS,
    callback_urls_to_allow: cleanCallbackUrls(config.callback_urls_to_allow),
    created_at: config.created_at || null,
    rotated_at: config.rotated_at || null,
  };
}

export async function ensureTenantGptOAuthClientConfigTable(pool = getPool()) {
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

export async function readTenantGptOAuthClientConfig(queryFn = null) {
  try {
    const execute = queryFn || ((sql, params) => getPool().query(sql, params));
    const [rows] = await execute(
      `SELECT config_json
         FROM \`platform_runtime_config\`
        WHERE config_key = ?
          AND status = 'active'
        LIMIT 1`,
      [TENANT_GPT_OAUTH_CLIENT_CONFIG_KEY]
    );

    const config = parseJsonConfig(Array.isArray(rows) ? rows[0]?.config_json : null);
    if (!config?.client_secret) {
      return {
        ok: false,
        source: "db_runtime",
        error: "tenant_gpt_oauth_client_config_not_found",
      };
    }

    return {
      ok: true,
      source: "db_runtime",
      config: sanitizeTenantGptOAuthClientConfig(config, "db_runtime"),
    };
  } catch (err) {
    return {
      ok: false,
      source: "db_runtime",
      error: err.code || "tenant_gpt_oauth_client_config_read_failed",
      message: err.message,
    };
  }
}

export function readTenantGptOAuthClientConfigFromEnv() {
  const clientSecret = cleanSecret(process.env.TENANT_GPT_OAUTH_CLIENT_SECRET);
  if (!clientSecret) {
    return {
      ok: false,
      source: "server_env",
      error: "tenant_gpt_oauth_client_secret_env_missing",
    };
  }

  return {
    ok: true,
    source: "server_env",
    config: sanitizeTenantGptOAuthClientConfig(
      {
        client_id: process.env.TENANT_GPT_OAUTH_CLIENT_ID || TENANT_GPT_OAUTH_CLIENT_ID,
        client_secret: clientSecret,
        callback_urls_to_allow: TENANT_GPT_CALLBACK_URLS_TO_ALLOW,
      },
      "server_env"
    ),
  };
}

export async function resolveTenantGptOAuthClientConfig(options = {}) {
  const dbConfig = await readTenantGptOAuthClientConfig(options.query);
  if (dbConfig.ok) return dbConfig;

  const envConfig = readTenantGptOAuthClientConfigFromEnv();
  if (envConfig.ok) return envConfig;

  const compatibilityErrors = new Set([
    "DB_CONFIG_MISSING",
    "ER_NO_SUCH_TABLE",
    "tenant_gpt_oauth_client_config_not_found",
  ]);
  if (!compatibilityErrors.has(dbConfig.error)) {
    return {
      ok: false,
      source: "none",
      error: "tenant_gpt_oauth_client_config_unavailable",
      db_error: dbConfig,
      env_error: envConfig,
    };
  }

  return {
    ok: true,
    source: "default_unconfigured",
    config: sanitizeTenantGptOAuthClientConfig(
      {
        client_id: TENANT_GPT_OAUTH_CLIENT_ID,
        client_secret: "",
        callback_urls_to_allow: TENANT_GPT_CALLBACK_URLS_TO_ALLOW,
      },
      "default_unconfigured"
    ),
    warning: "No Tenant GPT OAuth client secret is configured; token exchange is running in compatibility mode.",
    db_error: dbConfig,
    env_error: envConfig,
  };
}

export async function validateTenantGptOAuthClientCredentials(credentials = {}, options = {}) {
  const resolved = await resolveTenantGptOAuthClientConfig(options);
  if (!resolved.ok) {
    return {
      ok: false,
      status: 503,
      error: "temporarily_unavailable",
      message: "OAuth client configuration is temporarily unavailable.",
      source: resolved.source,
    };
  }

  const config = resolved.config;
  const clientId = cleanClientId(credentials.client_id);
  const clientSecret = cleanSecret(credentials.client_secret);

  if (clientId !== config.client_id) {
    return {
      ok: false,
      status: 401,
      error: "invalid_client",
      message: "Invalid OAuth client credentials.",
      source: resolved.source,
    };
  }

  if (config.client_secret_required && !fixedTimeEqual(clientSecret, config.client_secret)) {
    return {
      ok: false,
      status: 401,
      error: "invalid_client",
      message: "Invalid OAuth client credentials.",
      source: resolved.source,
    };
  }

  return {
    ok: true,
    source: resolved.source,
    client_id: config.client_id,
    client_secret_required: config.client_secret_required,
  };
}

export async function upsertTenantGptOAuthClientConfig(args = {}) {
  const pool = args.pool || getPool();
  const now = new Date().toISOString();
  const rotate = args.rotate === true;
  const requestedSecret = cleanSecret(args.client_secret);
  const existing = await readTenantGptOAuthClientConfig((sql, params) => pool.query(sql, params));
  const existingConfig = existing.ok ? existing.config : null;
  const clientSecret =
    requestedSecret ||
    (rotate ? "" : existingConfig?.client_secret) ||
    generateTenantGptOAuthClientSecret();

  const config = {
    client_id: cleanClientId(args.client_id || existingConfig?.client_id),
    client_secret: clientSecret,
    scope: TENANT_GPT_SCOPE,
    scope_links: TENANT_GPT_SCOPE_LINKS,
    callback_urls_to_allow: cleanCallbackUrls(args.callback_urls_to_allow || existingConfig?.callback_urls_to_allow),
    created_at: existingConfig?.created_at || now,
    rotated_at: existingConfig?.client_secret && clientSecret !== existingConfig.client_secret ? now : existingConfig?.rotated_at || null,
  };
  const note = String(args.note || "tenant_gpt_oauth_client").trim().slice(0, 255);

  await ensureTenantGptOAuthClientConfigTable(pool);
  await pool.query(
    `INSERT INTO \`platform_runtime_config\`
       (config_key, config_json, status, note)
     VALUES (?, ?, 'active', ?)
     ON DUPLICATE KEY UPDATE
       config_json = VALUES(config_json),
       status = 'active',
       note = VALUES(note),
       updated_at = CURRENT_TIMESTAMP`,
    [TENANT_GPT_OAUTH_CLIENT_CONFIG_KEY, JSON.stringify(config), note]
  );

  return {
    ok: true,
    config_key: TENANT_GPT_OAUTH_CLIENT_CONFIG_KEY,
    client_id: config.client_id,
    client_secret: config.client_secret,
    client_secret_created: !existingConfig?.client_secret || clientSecret !== existingConfig.client_secret,
    client_secret_required: true,
    scope: config.scope,
    scope_links: config.scope_links,
    callback_urls_to_allow: config.callback_urls_to_allow,
    next_step: "Save client_id and client_secret in the Custom GPT OAuth authentication panel.",
  };
}
