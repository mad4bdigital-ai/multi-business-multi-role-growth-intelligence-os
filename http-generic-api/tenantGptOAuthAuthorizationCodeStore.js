import { createHash } from "node:crypto";

export const TENANT_GPT_OAUTH_CODE_CONSUMPTION_OUTCOMES = Object.freeze([
  "consumed",
  "not_found",
  "binding_mismatch",
  "expired",
  "already_consumed",
  "revoked",
  "issued_not_consumed",
  "consumption_outcome_unknown",
  "store_unavailable_code_still_issued",
]);

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

function rowsFromQueryResult(result) {
  if (Array.isArray(result)) {
    if (Array.isArray(result[0])) return result[0];
    return result;
  }
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
}

function resultFromQueryResult(result) {
  if (Array.isArray(result)) return result[0] || null;
  return result || null;
}

function safeErrorCode(error) {
  const code = String(error?.code || "").trim().slice(0, 64);
  if (code) return code;
  const errno = Number(error?.errno);
  return Number.isInteger(errno) ? `errno_${errno}` : "authorization_code_store_error";
}

function mysqlTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace("T", " ");
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

function classifyAuthorizationCodeRow(row, nowMs = Date.now()) {
  if (!row) return "not_found";
  if (!Boolean(Number(row.client_matches)) || !Boolean(Number(row.redirect_matches))) {
    return "binding_mismatch";
  }
  if (row.status === "consumed" || row.consumed_at) return "already_consumed";
  if (row.status === "revoked") return "revoked";
  const expiresAtMs = new Date(row.expires_at).getTime();
  if (row.status === "expired" || !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    return "expired";
  }
  return "issued_not_consumed";
}

async function readAuthorizationCodeState(execute, {
  codeJtiHash,
  clientId,
  redirectUriHash,
  nowMs = Date.now(),
} = {}) {
  const result = await execute(
    `SELECT status, expires_at, consumed_at,
            CASE WHEN client_id = ? THEN 1 ELSE 0 END AS client_matches,
            CASE WHEN redirect_uri_hash = ? THEN 1 ELSE 0 END AS redirect_matches
       FROM \`tenant_gpt_oauth_authorization_codes\`
      WHERE code_jti_hash = ?
      LIMIT 1`,
    [clientId, redirectUriHash, codeJtiHash],
  );
  const row = rowsFromQueryResult(result)[0] || null;
  return {
    outcome: classifyAuthorizationCodeRow(row, nowMs),
    status: row?.status || null,
    consumed_at_present: Boolean(row?.consumed_at),
    expires_at: mysqlTimestamp(row?.expires_at),
  };
}

export async function inspectTenantGptOAuthAuthorizationCode({
  query,
  jti,
  client_id,
  redirect_uri,
  now_ms = Date.now(),
} = {}) {
  const execute = requireQuery(query);
  const normalizedJti = requireText("jti", jti);
  const normalizedClientId = requireText("client_id", client_id);
  const normalizedRedirectUri = requireText("redirect_uri", redirect_uri);
  const readback = await runWithAuthorizationCodeTableRecovery(execute, () => readAuthorizationCodeState(execute, {
    codeJtiHash: sha256(normalizedJti),
    clientId: normalizedClientId,
    redirectUriHash: sha256(normalizedRedirectUri),
    nowMs: now_ms,
  }));
  return {
    ...readback.result,
    table_recovered: readback.table_recovered,
    secrets_included: false,
  };
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

  return { stored: true, table_recovered: persisted.table_recovered, secrets_included: false };
}

export async function consumeTenantGptOAuthAuthorizationCode({
  query,
  jti,
  client_id,
  redirect_uri,
  now_ms = Date.now(),
} = {}) {
  const execute = requireQuery(query);
  const normalizedJti = requireText("jti", jti);
  const normalizedClientId = requireText("client_id", client_id);
  const normalizedRedirectUri = requireText("redirect_uri", redirect_uri);
  const codeJtiHash = sha256(normalizedJti);
  const redirectUriHash = sha256(normalizedRedirectUri);
  const params = [codeJtiHash, normalizedClientId, redirectUriHash];

  let consumed;
  try {
    consumed = await runWithAuthorizationCodeTableRecovery(execute, () => execute(
      `UPDATE \`tenant_gpt_oauth_authorization_codes\`
          SET status = 'consumed', consumed_at = UTC_TIMESTAMP(3)
        WHERE code_jti_hash = ?
          AND client_id = ?
          AND redirect_uri_hash = ?
          AND status = 'issued'
          AND consumed_at IS NULL
          AND expires_at > UTC_TIMESTAMP(3)`,
      params,
    ));
  } catch (error) {
    let readback = null;
    try {
      readback = await readAuthorizationCodeState(execute, {
        codeJtiHash,
        clientId: normalizedClientId,
        redirectUriHash,
        nowMs: now_ms,
      });
    } catch {
      readback = null;
    }
    const readbackShowsConsumed = readback?.outcome === "already_consumed";
    const readbackShowsIssued = readback?.outcome === "issued_not_consumed";
    return {
      consumed: false,
      outcome: readbackShowsConsumed
        ? "consumption_outcome_unknown"
        : readbackShowsIssued
          ? "store_unavailable_code_still_issued"
          : "consumption_outcome_unknown",
      readback_outcome: readback?.outcome || null,
      replay_allowed: readbackShowsIssued,
      store_error_code: safeErrorCode(error),
      table_recovered: false,
      secrets_included: false,
    };
  }

  const result = resultFromQueryResult(consumed.result);
  if (Number(result?.affectedRows || 0) === 1) {
    return {
      consumed: true,
      outcome: "consumed",
      readback_outcome: "already_consumed",
      replay_allowed: false,
      store_error_code: null,
      table_recovered: consumed.table_recovered,
      secrets_included: false,
    };
  }

  const readback = await readAuthorizationCodeState(execute, {
    codeJtiHash,
    clientId: normalizedClientId,
    redirectUriHash,
    nowMs: now_ms,
  });
  return {
    consumed: false,
    outcome: readback.outcome,
    readback_outcome: readback.outcome,
    replay_allowed: false,
    store_error_code: null,
    table_recovered: consumed.table_recovered,
    secrets_included: false,
  };
}
