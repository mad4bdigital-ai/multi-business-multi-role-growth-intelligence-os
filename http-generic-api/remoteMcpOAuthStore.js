import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import {
  REMOTE_MCP_AUTHORIZATION_CODE_TTL_SECONDS,
  REMOTE_MCP_REFRESH_TOKEN_TTL_SECONDS,
  createOpaqueToken,
  sha256,
} from "./remoteMcpOAuthProfile.js";

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clientFromRow(row) {
  if (!row) return null;
  return {
    client_id: row.client_id,
    client_name: row.client_name,
    client_profile_key: row.client_profile_key,
    token_endpoint_auth_method: row.token_endpoint_auth_method,
    client_secret_hash: row.client_secret_hash || null,
    redirect_uris: parseJsonArray(row.redirect_uris_json),
    allowed_scopes: parseJsonArray(row.allowed_scopes_json),
    status: row.status,
    expires_at: row.expires_at || null,
  };
}

function codeFromRow(row) {
  if (!row) return null;
  return {
    client_id: row.client_id,
    user_id: row.user_id,
    tenant_id: row.tenant_id || null,
    redirect_uri: row.redirect_uri,
    resource: row.resource,
    scopes: parseJsonArray(row.scopes_json),
    code_challenge: row.code_challenge,
    code_challenge_method: row.code_challenge_method,
    expires_at: row.expires_at,
  };
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
    scopes: parseJsonArray(row.scopes_json),
    status: row.status,
    access_expires_at: row.access_expires_at,
    refresh_expires_at: row.refresh_expires_at,
  };
}

async function withConnection(pool, fn) {
  if (!pool?.getConnection) return fn(pool, false);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection, true);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

export async function registerRemoteMcpOAuthClient({
  pool = getPool(),
  clientName,
  clientProfileKey,
  tokenEndpointAuthMethod,
  clientSecret = "",
  redirectUris,
  allowedScopes,
}) {
  const clientId = `mcp_${randomUUID().replace(/-/gu, "")}`;
  const registrationAccessToken = createOpaqueToken(32);
  await pool.query(
    `INSERT INTO remote_mcp_oauth_clients
      (client_id, client_name, client_profile_key, token_endpoint_auth_method,
       client_secret_hash, redirect_uris_json, allowed_scopes_json,
       registration_access_token_hash, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [
      clientId,
      clientName,
      clientProfileKey,
      tokenEndpointAuthMethod,
      clientSecret ? sha256(clientSecret) : null,
      JSON.stringify(redirectUris),
      JSON.stringify(allowedScopes),
      sha256(registrationAccessToken),
    ],
  );
  return { client_id: clientId, registration_access_token: registrationAccessToken };
}

export async function readRemoteMcpOAuthClient(clientId, { pool = getPool() } = {}) {
  const [rows] = await pool.query(
    `SELECT client_id, client_name, client_profile_key, token_endpoint_auth_method,
            client_secret_hash, redirect_uris_json, allowed_scopes_json, status, expires_at
       FROM remote_mcp_oauth_clients
      WHERE client_id = ?
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > NOW())`,
    [String(clientId || "").trim()],
  );
  const [row] = rows;
  return clientFromRow(row);
}

export async function issueRemoteMcpAuthorizationCode({
  pool = getPool(),
  clientId,
  userId,
  tenantId = null,
  redirectUri,
  resource,
  scopes,
  codeChallenge,
}) {
  const code = createOpaqueToken(32);
  const expiresAt = new Date(Date.now() + REMOTE_MCP_AUTHORIZATION_CODE_TTL_SECONDS * 1000);
  await pool.query(
    `INSERT INTO remote_mcp_oauth_authorization_codes
      (code_hash, client_id, user_id, tenant_id, redirect_uri, resource,
       scopes_json, code_challenge, code_challenge_method, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'S256', 'issued', ?)`,
    [
      sha256(code),
      clientId,
      userId,
      tenantId,
      redirectUri,
      resource,
      JSON.stringify(scopes),
      codeChallenge,
      expiresAt,
    ],
  );
  return { code, expires_at: expiresAt };
}

export async function readRemoteMcpAuthorizationCode({
  pool = getPool(),
  code,
  clientId,
  redirectUri,
}) {
  const codeHash = sha256(code);
  const [rows] = await pool.query(
    `SELECT client_id, user_id, tenant_id, redirect_uri, resource, scopes_json,
            code_challenge, code_challenge_method, expires_at
       FROM remote_mcp_oauth_authorization_codes
      WHERE code_hash = ?
        AND client_id = ?
        AND redirect_uri = ?
        AND status = 'issued'
        AND expires_at > NOW()`,
    [codeHash, clientId, redirectUri],
  );
  const [row] = rows;
  return codeFromRow(row);
}

export async function consumeRemoteMcpAuthorizationCode({
  pool = getPool(),
  code,
  clientId,
  redirectUri,
}) {
  const [result] = await pool.query(
    `UPDATE remote_mcp_oauth_authorization_codes
        SET status = 'consumed', consumed_at = NOW()
      WHERE code_hash = ?
        AND client_id = ?
        AND redirect_uri = ?
        AND status = 'issued'
        AND expires_at > NOW()`,
    [sha256(code), clientId, redirectUri],
  );
  return Number(result?.affectedRows || 0) === 1;
}

export async function createRemoteMcpOAuthGrant({
  pool = getPool(),
  accessJti,
  clientId,
  userId,
  tenantId = null,
  resource,
  scopes,
  accessExpiresAt,
  refreshExpiresAt = new Date(Date.now() + REMOTE_MCP_REFRESH_TOKEN_TTL_SECONDS * 1000),
}) {
  const grantId = randomUUID();
  const refreshToken = createOpaqueToken(48);
  await pool.query(
    `INSERT INTO remote_mcp_oauth_grants
      (grant_id, access_jti, refresh_token_hash, client_id, user_id, tenant_id,
       resource, scopes_json, status, access_expires_at, refresh_expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    [
      grantId,
      accessJti,
      sha256(refreshToken),
      clientId,
      userId,
      tenantId,
      resource,
      JSON.stringify(scopes),
      accessExpiresAt,
      refreshExpiresAt,
    ],
  );
  return { grant_id: grantId, refresh_token: refreshToken, refresh_expires_at: refreshExpiresAt };
}

export async function readRemoteMcpGrantByAccessJti(accessJti, { pool = getPool() } = {}) {
  const [rows] = await pool.query(
    `SELECT grant_id, access_jti, refresh_token_hash, client_id, user_id, tenant_id,
            resource, scopes_json, status, access_expires_at, refresh_expires_at
       FROM remote_mcp_oauth_grants
      WHERE access_jti = ?
        AND status = 'active'
        AND access_expires_at > NOW()`,
    [String(accessJti || "").trim()],
  );
  const [row] = rows;
  return grantFromRow(row);
}

export async function readRemoteMcpGrantByRefreshToken(refreshToken, { pool = getPool() } = {}) {
  const [rows] = await pool.query(
    `SELECT grant_id, access_jti, refresh_token_hash, client_id, user_id, tenant_id,
            resource, scopes_json, status, access_expires_at, refresh_expires_at
       FROM remote_mcp_oauth_grants
      WHERE refresh_token_hash = ?
        AND status = 'active'
        AND refresh_expires_at > NOW()`,
    [sha256(refreshToken)],
  );
  const [row] = rows;
  return grantFromRow(row);
}

export async function rotateRemoteMcpOAuthGrant({
  pool = getPool(),
  refreshToken,
  accessJti,
  accessExpiresAt,
}) {
  return withConnection(pool, async (connection) => {
    const current = await readRemoteMcpGrantByRefreshToken(refreshToken, { pool: connection });
    if (!current) return null;
    const next = await createRemoteMcpOAuthGrant({
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
      `UPDATE remote_mcp_oauth_grants
          SET status = 'rotated', replaced_by_grant_id = ?, revoked_at = NOW()
        WHERE grant_id = ? AND status = 'active'`,
      [next.grant_id, current.grant_id],
    );
    if (Number(result?.affectedRows || 0) !== 1) {
      const error = new Error("Refresh token was already rotated or revoked.");
      error.code = "invalid_grant";
      throw error;
    }
    return { current, next };
  });
}

export async function revokeRemoteMcpGrantByAccessJti(accessJti, { pool = getPool() } = {}) {
  const [result] = await pool.query(
    `UPDATE remote_mcp_oauth_grants
        SET status = 'revoked', revoked_at = NOW()
      WHERE access_jti = ? AND status = 'active'`,
    [String(accessJti || "").trim()],
  );
  return Number(result?.affectedRows || 0) > 0;
}

export async function revokeRemoteMcpGrantByRefreshToken(refreshToken, { pool = getPool() } = {}) {
  const [result] = await pool.query(
    `UPDATE remote_mcp_oauth_grants
        SET status = 'revoked', revoked_at = NOW()
      WHERE refresh_token_hash = ? AND status = 'active'`,
    [sha256(refreshToken)],
  );
  return Number(result?.affectedRows || 0) > 0;
}
