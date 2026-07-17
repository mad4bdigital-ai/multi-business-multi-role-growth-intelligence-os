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

  await execute(
    `INSERT INTO \`tenant_gpt_oauth_authorization_codes\`
      (code_jti_hash, user_id, tenant_id, client_id, redirect_uri_hash, status, expires_at)
     VALUES (?, ?, ?, ?, ?, 'issued', ?)`,
    [
      sha256(normalizedJti),
      normalizedUserId,
      tenant_id ? String(tenant_id).trim() : null,
      normalizedClientId,
      sha256(normalizedRedirectUri),
      expiresAt,
    ],
  );

  return { stored: true };
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

  const [result] = await execute(
    `UPDATE \`tenant_gpt_oauth_authorization_codes\`
        SET status = 'consumed', consumed_at = CURRENT_TIMESTAMP
      WHERE code_jti_hash = ?
        AND client_id = ?
        AND redirect_uri_hash = ?
        AND status = 'issued'
        AND consumed_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP`,
    [sha256(normalizedJti), normalizedClientId, sha256(normalizedRedirectUri)],
  );

  return { consumed: Number(result?.affectedRows || 0) === 1 };
}
