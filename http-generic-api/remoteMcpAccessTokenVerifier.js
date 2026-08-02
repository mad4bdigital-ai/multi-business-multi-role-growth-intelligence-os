import jwt from "jsonwebtoken";
import { getPool } from "./db.js";
import { readRemoteMcpGrantByAccessJti } from "./remoteMcpOAuthStore.js";
import {
  resolveRemoteMcpAuthorizationIssuer,
  resolveRemoteMcpOAuthResource,
  resolveRemoteMcpOAuthSigningSecret,
} from "./remoteMcpOAuthProfile.js";

function bearerToken(authorization) {
  const match = String(authorization || "").match(/^Bearer\s+([^\s]+)$/iu);
  return match?.[1] || "";
}

function failure(status, code, message) {
  return { ok: false, status, code, message };
}

function scopeSet(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/\s+/u);
  return new Set(raw.map((scope) => String(scope || "").trim()).filter(Boolean));
}

function optionalId(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function exactlyOneActiveRow(rows = []) {
  const activeCount = rows.reduce(
    (total, row) => total + Number(row?.active_count || 0),
    0,
  );
  return activeCount === 1;
}

async function activeSubjectStillAuthorized(pool, { userId, tenantId }) {
  if (tenantId) {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS active_count
         FROM memberships m
         JOIN users u ON u.user_id = m.user_id
         JOIN tenants t ON t.tenant_id = m.tenant_id
        WHERE m.user_id = ?
          AND m.tenant_id = ?
          AND m.status = 'active'
          AND u.status = 'active'
          AND t.status = 'active'`,
      [userId, tenantId],
    );
    return exactlyOneActiveRow(rows);
  }
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS active_count
       FROM users
      WHERE user_id = ?
        AND status = 'active'`,
    [userId],
  );
  return exactlyOneActiveRow(rows);
}

export async function verifyRemoteMcpBearerAuthorization(authorization, options = {}) {
  const env = options.env || process.env;
  const requiredScopes = Array.isArray(options.requiredScopes) ? options.requiredScopes : [];
  const verifyToken = options.verifyToken || jwt.verify;
  const token = bearerToken(authorization);
  if (!token) return failure(401, "MCP_AUTH_REQUIRED", "OAuth account linking is required for this tool.");

  const secret = resolveRemoteMcpOAuthSigningSecret(env);
  const issuer = resolveRemoteMcpAuthorizationIssuer(env);
  const resource = resolveRemoteMcpOAuthResource(env);
  if (!secret || !issuer || !resource) {
    return failure(503, "MCP_AUTH_UNAVAILABLE", "OAuth token validation is temporarily unavailable.");
  }

  let claims;
  try {
    claims = verifyToken(token, secret, {
      algorithms: ["HS256"],
      issuer,
      audience: resource,
    });
  } catch {
    return failure(401, "MCP_TOKEN_INVALID", "OAuth access token is invalid or expired.");
  }

  const userId = String(claims?.user_id || "").trim();
  const clientId = String(claims?.client_id || "").trim();
  const authorizedParty = String(claims?.azp || "").trim();
  const tenantId = optionalId(claims?.tenant_id);
  const jti = String(claims?.jti || "").trim();
  const expectedSubject = tenantId ? `tenant:${tenantId}:user:${userId}` : `user:${userId}`;
  if (
    claims?.purpose !== "remote_mcp_access"
    || !userId
    || !clientId
    || authorizedParty !== clientId
    || !jti
    || claims?.sub !== expectedSubject
    || String(claims?.resource || "").replace(/\/+$/u, "") !== resource
  ) {
    return failure(401, "MCP_TOKEN_INVALID", "OAuth access token claims are invalid.");
  }

  const grantedScopes = scopeSet(claims.scope);
  const missingScopes = requiredScopes
    .map((scope) => String(scope || "").trim())
    .filter(Boolean)
    .filter((scope) => !grantedScopes.has(scope));
  if (missingScopes.length) {
    return failure(403, "MCP_SCOPE_INSUFFICIENT", "OAuth access token does not include the required scope.");
  }

  let pool;
  let grant;
  try {
    pool = options.pool || getPool();
    grant = await readRemoteMcpGrantByAccessJti(jti, { pool });
  } catch {
    return failure(503, "MCP_AUTH_UNAVAILABLE", "OAuth revocation state is temporarily unavailable.");
  }
  if (!grant) return failure(401, "MCP_TOKEN_REVOKED", "OAuth access token is revoked or no longer active.");

  const grantScopes = scopeSet(grant.scopes);
  const grantTenantId = optionalId(grant.tenant_id);
  const inconsistent = grant.client_id !== clientId
    || grant.user_id !== userId
    || grantTenantId !== tenantId
    || String(grant.resource || "").replace(/\/+$/u, "") !== resource
    || [...grantedScopes].some((scope) => !grantScopes.has(scope));
  if (inconsistent) {
    return failure(401, "MCP_TOKEN_INVALID", "OAuth access token does not match the active grant.");
  }

  try {
    if (!await activeSubjectStillAuthorized(pool, { userId, tenantId })) {
      return failure(401, "MCP_SUBJECT_INACTIVE", "OAuth user or tenant membership is no longer active.");
    }
  } catch {
    return failure(503, "MCP_AUTH_UNAVAILABLE", "OAuth subject authorization state is temporarily unavailable.");
  }

  return {
    ok: true,
    claims: {
      ...claims,
      user_id: userId,
      tenant_id: tenantId,
      client_id: clientId,
      auth_mode: "remote_mcp_oauth_2_1",
    },
    grant: {
      grant_id: grant.grant_id,
      client_id: grant.client_id,
      tenant_id: grantTenantId,
      scopes: [...grantScopes],
      secrets_included: false,
    },
  };
}
