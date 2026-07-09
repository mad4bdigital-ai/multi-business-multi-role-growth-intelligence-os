const ALLOWED_CONTEXT_KEYS = new Set([
  "purpose",
  "activation_mode",
  "cloudflare_mode",
  "google_auth_mode",
  "n8n_activation_mode",
  "device_id",
  "workspace_name",
  "screen_hint",
  "sign_in_options",
]);

const SAFE_OPTION_VALUES = {
  purpose: new Set(["tenant_activation"]),
  activation_mode: new Set(["managed", "dedicated"]),
  cloudflare_mode: new Set(["managed", "dedicated"]),
  google_auth_mode: new Set(["managed", "dedicated", "user_oauth"]),
  n8n_activation_mode: new Set(["managed_main_server", "self_hosted_local"]),
  screen_hint: new Set(["signin", "signup", "google"]),
  sign_in_options: new Set(["google", "email", "register"]),
};

function cleanText(value, maxLength = 120) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanOption(key, value) {
  const text = cleanText(value, 120).toLowerCase();
  const allowed = SAFE_OPTION_VALUES[key];
  return allowed?.has(text) ? text : null;
}

function parseMaybeJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function mysqlDate(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) return mysqlDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  return date.toISOString().slice(0, 19).replace("T", " ");
}

async function runQuery(query, sql, params = []) {
  const result = await query(sql, params);
  if (Array.isArray(result)) return result[0];
  if (result && typeof result === "object" && Array.isArray(result.rows)) return result.rows;
  return result;
}

let activationContextTableReady = false;

async function ensureTenantGptActivationContextTable(query) {
  if (activationContextTableReady) return;
  await runQuery(
    query,
    `CREATE TABLE IF NOT EXISTS \`tenant_gpt_activation_contexts\` (
      \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`access_jti\` VARCHAR(96) NOT NULL,
      \`oauth_code_jti\` VARCHAR(96) NULL,
      \`user_id\` VARCHAR(64) NOT NULL,
      \`tenant_id\` VARCHAR(64) NULL,
      \`client_id\` VARCHAR(191) NULL,
      \`activation_context_json\` LONGTEXT NULL CHECK (JSON_VALID(\`activation_context_json\`) OR \`activation_context_json\` IS NULL),
      \`status\` ENUM('active','expired') NOT NULL DEFAULT 'active',
      \`expires_at\` DATETIME NOT NULL,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uq_tenant_gpt_activation_context_access_jti\` (\`access_jti\`),
      KEY \`idx_tenant_gpt_activation_context_subject\` (\`tenant_id\`, \`user_id\`, \`status\`, \`updated_at\`),
      KEY \`idx_tenant_gpt_activation_context_expiry\` (\`expires_at\`, \`status\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  activationContextTableReady = true;
}

export function sanitizeTenantGptActivationContext(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const context = {};

  for (const key of ALLOWED_CONTEXT_KEYS) {
    if (!(key in source)) continue;
    if (key === "sign_in_options") {
      const options = Array.isArray(source[key]) ? source[key] : String(source[key] || "").split(",");
      const cleaned = [...new Set(options.map((option) => cleanOption(key, option)).filter(Boolean))].slice(0, 3);
      if (cleaned.length) context[key] = cleaned;
      continue;
    }
    if (key === "workspace_name") {
      const text = cleanText(source[key], 120);
      if (text) context[key] = text;
      continue;
    }
    if (key === "device_id") {
      const text = cleanText(source[key], 64);
      if (text) context[key] = text;
      continue;
    }
    const option = cleanOption(key, source[key]);
    if (option) context[key] = option;
  }

  if (!context.purpose) context.purpose = "tenant_activation";
  return { context, secrets_included: false };
}

export async function recordTenantGptActivationContext({
  query,
  access_jti,
  oauth_code_jti = null,
  user_id,
  tenant_id = null,
  client_id = null,
  activation_context = {},
  expires_at,
} = {}) {
  try {
    if (typeof query !== "function") return { ok: false, stored: false, reason: "query_unavailable", secrets_included: false };
    const accessJti = cleanText(access_jti, 96);
    const userId = cleanText(user_id, 64);
    if (!accessJti || !userId) return { ok: true, stored: false, reason: "missing_access_jti_or_user_id", secrets_included: false };

    const sanitized = sanitizeTenantGptActivationContext(activation_context);
    await ensureTenantGptActivationContextTable(query);
    await runQuery(
      query,
      `INSERT INTO \`tenant_gpt_activation_contexts\`
        (access_jti, oauth_code_jti, user_id, tenant_id, client_id, activation_context_json, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
       ON DUPLICATE KEY UPDATE
         oauth_code_jti = VALUES(oauth_code_jti),
         user_id = VALUES(user_id),
         tenant_id = VALUES(tenant_id),
         client_id = VALUES(client_id),
         activation_context_json = VALUES(activation_context_json),
         status = 'active',
         expires_at = VALUES(expires_at),
         updated_at = CURRENT_TIMESTAMP`,
      [
        accessJti,
        cleanText(oauth_code_jti, 96) || null,
        userId,
        cleanText(tenant_id, 64) || null,
        cleanText(client_id, 191) || null,
        JSON.stringify({ ...sanitized.context, secrets_included: false }),
        mysqlDate(expires_at),
      ]
    );
    return { ok: true, stored: true, source: "tenant_gpt_activation_contexts", secrets_included: false };
  } catch (err) {
    console.warn("tenant_gpt_activation_context_store_failed", { message: err?.message });
    return { ok: false, stored: false, reason: err?.code || "activation_context_store_failed", secrets_included: false };
  }
}

export async function loadTenantGptActivationContext({ query, access_jti, user_id, tenant_id = null } = {}) {
  try {
    if (typeof query !== "function") return { available: false, reason: "query_unavailable", secrets_included: false };
    const accessJti = cleanText(access_jti, 96);
    const userId = cleanText(user_id, 64);
    const tenantId = cleanText(tenant_id, 64) || null;
    if (!accessJti || !userId) return { available: false, reason: "missing_access_jti_or_user_id", secrets_included: false };

    const rows = await runQuery(
      query,
      `SELECT access_jti, user_id, tenant_id, activation_context_json, created_at, updated_at, expires_at
         FROM \`tenant_gpt_activation_contexts\`
        WHERE access_jti = ?
          AND user_id = ?
          AND (? IS NULL OR tenant_id = ?)
          AND status = 'active'
          AND expires_at > UTC_TIMESTAMP()
        LIMIT 1`,
      [accessJti, userId, tenantId, tenantId]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return { available: false, source: "tenant_gpt_activation_contexts", reason: "not_found", secrets_included: false };

    const parsed = parseMaybeJson(row.activation_context_json) || {};
    const sanitized = sanitizeTenantGptActivationContext(parsed);
    return {
      available: true,
      source: "tenant_gpt_activation_contexts",
      matched_by: "access_jti",
      context: sanitized.context,
      created_at: row.created_at || null,
      updated_at: row.updated_at || null,
      expires_at: row.expires_at || null,
      secrets_included: false,
    };
  } catch (err) {
    const missing = /doesn't exist|ER_NO_SUCH_TABLE/i.test(String(err?.message || ""));
    return {
      available: false,
      source: "tenant_gpt_activation_contexts",
      reason: missing ? "table_not_installed" : err?.code || "activation_context_load_failed",
      degraded: !missing,
      secrets_included: false,
    };
  }
}
