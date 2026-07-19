import { createHash } from "node:crypto";

function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function requireQuery(query) {
  if (typeof query !== "function") throw new TypeError("query must be a function.");
  return query;
}

function requireText(name, value) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${name} is required.`);
  return normalized;
}

const CREATE_AUTHORIZATION_CODE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS \`tenant_gpt_oauth_authorization_codes\` (
  \`code_jti_hash\` CHAR(64) NOT NULL,
  \`user_id\` VARCHAR(64) NOT NULL,
  \`tenant_id\` VARCHAR(64) NULL,
  \`client_id\` VARCHAR(191) NOT NULL,
  \`redirect_uri_hash\` CHAR(64) NOT NULL,
  \`status\` ENUM('issued','consumed','expired','revoked') NOT NULL DEFAULT 'issued',
  \`expires_at\` DATETIME NOT NULL,
  \`consumed_at\` DATETIME NULL,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`code_jti_hash\`),
  KEY \`idx_tenant_gpt_oauth_codes_status_expiry\` (\`status\`, \`expires_at\`),
  KEY \`idx_tenant_gpt_oauth_codes_user_created\` (\`user_id\`, \`created_at\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

function isMissingAuthorizationCodeTable(error) {
  return error?.code === "ER_NO_SUCH_TABLE"
    || Number(error?.errno) === 1146
    || /tenant_gpt_oauth_authorization_codes[^\n]*(?:doesn't exist|does not exist)/i.test(String(error?.message || ""));
}

async function runWithAuthorizationCodeTableRecovery(execute, operation) {
  try {
    return { result: await operation(), table_recovered: false };
  } catch (error) {
    if (!isMissingAuthorizationCodeTable(error)) throw error;
    await execute(CREATE_AUTHORIZATION_CODE_TABLE_SQL);
    return { result: await operation(), table_recovered: true };
  }
}

export async function persistTenantGptOAuthAuthorizationCode({
  query,
  jti,
  user_id,
  tenant_id = null,
  client_id,
  redirect_uri,
  expires_at,
} = {}) {
  const execute = requireQuery(query);
  const normalizedJti = requireText("jti", jti);
  const normalizedUserId = requireText("user_id", user_id);
  const normalizedClientId = requireText("client_id", client_id);
  const normalizedRedirectUri = requireText("redirect_uri", redirect_uri);
  const expiresAt = expires_at instanceof Date ? expires_at : new Date(expires_at);
  if (Number.isNaN(expiresAt.getTime())) throw new TypeError("expires_at must be a valid date.");

  const params = [
    sha256(normalizedJti),
    normalizedUserId,
    tenant_id ? String(tenant_id).trim() : null,
    normalizedClientId,
    sha256(normalizedRedirectUri),
    expiresAt,
  ];
  const persisted = await runWithAuthorizationCodeTableRecovery(execute, () => execute(
    `INSERT INTO \`tenant_gpt_oauth_authorization_codes\`
      (code_jti_hash, user_id, tenant_id, client_id, redirect_uri_hash, status, expires_at)
     VALUES (?, ?, ?, ?, ?, 'issued', ?)`,
    params,
  ));

  return { stored: true, table_recovered: persisted.table_recovered };
}

export async function consumeTenantGptOAuthAuthorizationCode({
  query,
  jti,
  client_id,
  redirect_uri,
} = {}) {
  const execute = requireQuery(query);
  const normalizedJti = requireText("jti", jti);
  const normalizedClientId = requireText("client_id", client_id);
  const normalizedRedirectUri = requireText("redirect_uri", redirect_uri);

  const params = [sha256(normalizedJti), normalizedClientId, sha256(normalizedRedirectUri)];
  const consumed = await runWithAuthorizationCodeTableRecovery(execute, () => execute(
    `UPDATE \`tenant_gpt_oauth_authorization_codes\`
        SET status = 'consumed', consumed_at = CURRENT_TIMESTAMP
      WHERE code_jti_hash = ?
        AND client_id = ?
        AND redirect_uri_hash = ?
        AND status = 'issued'
        AND consumed_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP`,
    params,
  ));
  const [result] = consumed.result;

  return {
    consumed: Number(result?.affectedRows || 0) === 1,
    table_recovered: consumed.table_recovered,
  };
}
