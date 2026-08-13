import { randomUUID, createHash, randomBytes } from "node:crypto";
import { getPool } from "./db.js";

export const TENANT_GPT_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export function tenantGptRefreshTokensEnabled(env = process.env) {
  return String(env?.TENANT_GPT_REFRESH_TOKENS_ENABLED || "").trim().toLowerCase() === "true";
}

function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function opaqueToken(bytes = 48) {
  return randomBytes(bytes).toString("base64url");
}

function parseScopes(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function grantFromRow(row) {
  if (!row) return null;
  return {
    grant_id: row.grant_id,
    access_jti: row.access_jti,
    refresh_token_hash: row.refresh_token_hash,
    client_id: row.client_id,
    user_id: row.user_id,
    tenant_id: row.tenant_id || null,
    resource: row.resource,
    scopes: parseScopes(row.scopes_json),
    status: row.status,
    access_expires_at: row.access_expires_at,
    refresh_expires_at: row.refresh_expires_at,
  };
}

export async function createTenantGptOAuthGrant({
  pool = getPool(),
  accessJti,
  clientId,
  userId,
  tenantId,
  resource,
  scopes,
  accessExpiresAt,
  refreshExpiresAt = new Date(Date.now() + TENANT_GPT_REFRESH_TOKEN_TTL_SECONDS * 1000),
} = {}) {
  const grantId = randomUUID();
  const refreshToken = opaqueToken();
  await pool.query(
    `INSERT INTO tenant_gpt_oauth_grants
      (grant_id, access_jti, refresh_token_hash, client_id, user_id, tenant_id,
       resource, scopes_json, status, access_expires_at, refresh_expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    [grantId, accessJti, sha256(refreshToken), clientId, userId, tenantId, resource, JSON.stringify(scopes || []), accessExpiresAt, refreshExpiresAt],
  );
  return { grant_id: grantId, refresh_token: refreshToken, refresh_expires_at: refreshExpiresAt };
}

export async function readTenantGptOAuthGrantByRefreshToken(refreshToken, { pool = getPool() } = {}) {
  const [rows] = await pool.query(
    `SELECT grant_id, access_jti, refresh_token_hash, client_id, user_id, tenant_id,
            resource, scopes_json, status, access_expires_at, refresh_expires_at
       FROM tenant_gpt_oauth_grants
      WHERE refresh_token_hash = ?
        AND status = 'active'
        AND refresh_expires_at > NOW()`,
    [sha256(refreshToken)],
  );
  return grantFromRow(rows?.[0]);
}

export async function rotateTenantGptOAuthGrant({
  pool = getPool(),
  refreshToken,
  accessJti,
  accessExpiresAt,
} = {}) {
  const connection = pool?.getConnection ? await pool.getConnection() : pool;
  const transactional = Boolean(pool?.getConnection);
  try {
    if (transactional) await connection.beginTransaction();
    const current = await readTenantGptOAuthGrantByRefreshToken(refreshToken, { pool: connection });
    if (!current) return null;
    const next = await createTenantGptOAuthGrant({
      pool: connection,
      accessJti,
      clientId: current.client_id,
      userId: current.user_id,
      tenantId: current.tenant_id,
      resource: current.resource,
      scopes: current.scopes,
      accessExpiresAt,
      refreshExpiresAt: current.refresh_expires_at,
    });
    const [result] = await connection.query(
      `UPDATE tenant_gpt_oauth_grants
          SET status = 'rotated', replaced_by_grant_id = ?, revoked_at = NOW()
        WHERE grant_id = ? AND status = 'active'`,
      [next.grant_id, current.grant_id],
    );
    if (Number(result?.affectedRows || 0) !== 1) {
      const error = new Error("Refresh token was already rotated or revoked.");
      error.code = "invalid_grant";
      throw error;
    }
    if (transactional) await connection.commit();
    return { current, next };
  } catch (error) {
    if (transactional) {
      try { await connection.rollback(); } catch {}
    }
    throw error;
  } finally {
    if (transactional) connection.release();
  }
}

export async function revokeTenantGptOAuthGrantByRefreshToken(refreshToken, { pool = getPool() } = {}) {
  const [result] = await pool.query(
    `UPDATE tenant_gpt_oauth_grants
        SET status = 'revoked', revoked_at = NOW()
      WHERE refresh_token_hash = ? AND status = 'active'`,
    [sha256(refreshToken)],
  );
  return Number(result?.affectedRows || 0) > 0;
}
