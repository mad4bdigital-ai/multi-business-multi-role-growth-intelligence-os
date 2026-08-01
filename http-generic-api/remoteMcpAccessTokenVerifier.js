import jwt from "jsonwebtoken";
import { getPool } from "./db.js";
import { readRemoteMcpGrantByAccessJti } from "./remoteMcpOAuthStore.js";
import {
  resolveRemoteMcpAuthorizationIssuer,
  resolveRemoteMcpOAuthResource,
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

export async function verifyRemoteMcpBearerAuthorization(
  authorization,
  {
    env = process.env,
    pool = getPool(),
    requiredScopes = [],
    verifyToken = jwt.verify,
  } = {},
) {
  const token = bearerToken(authorization);
  if (!token) return failure(401, "MCP_AUTH_REQUIRED", "OAuth account linking is required for this tool.");

  const secret = String(env.JWT_SECRET || "").trim();
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
  const clientId = String(claims?.client_id || claims?.azp || "").trim();
  const jti = String(claims?.jti || "").trim();
  if (
    claims?.purpose !== "remote_mcp_access"
    || !userId
    || !clientId
    || !jti
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

  let grant;
  try {
    grant = await readRemoteMcpGrantByAccessJti(jti, { pool });
  } catch {
    return failure(503, "MCP_AUTH_UNAVAILABLE", "OAuth revocation state is temporarily unavailable.");
  }
  if (!grant) return failure(401, "MCP_TOKEN_REVOKED", "OAuth access token is revoked or no longer active.");

  const grantScopes = scopeSet(grant.scopes);
  const inconsistent = grant.client_id !== clientId
    || grant.user_id !== userId
    || String(grant.resource || "").replace(/\/+$/u, "") !== resource
    || [...grantedScopes].some((scope) => !grantScopes.has(scope));
  if (inconsistent) {
    return failure(401, "MCP_TOKEN_INVALID", "OAuth access token does not match the active grant.");
  }

  return {
    ok: true,
    claims: {
      ...claims,
      user_id: userId,
      tenant_id: claims.tenant_id || grant.tenant_id || null,
      client_id: clientId,
      auth_mode: "remote_mcp_oauth_2_1",
    },
    grant: {
      grant_id: grant.grant_id,
      client_id: grant.client_id,
      scopes: [...grantScopes],
      secrets_included: false,
    },
  };
}
