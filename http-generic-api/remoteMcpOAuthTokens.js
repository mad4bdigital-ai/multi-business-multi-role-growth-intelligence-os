import jwt from "jsonwebtoken";
import {
  REMOTE_MCP_ACCESS_TOKEN_TTL_SECONDS,
  resolveRemoteMcpAuthorizationIssuer,
  resolveRemoteMcpOAuthResource,
} from "./remoteMcpOAuthProfile.js";

function signingConfiguration(env = process.env) {
  const secret = String(env.JWT_SECRET || "").trim();
  const issuer = resolveRemoteMcpAuthorizationIssuer(env);
  const resource = resolveRemoteMcpOAuthResource(env);
  if (!secret || !issuer || !resource) {
    const error = new Error("OAuth signing configuration is unavailable.");
    error.code = "oauth_signing_unavailable";
    throw error;
  }
  return { secret, issuer, resource };
}

export function issueRemoteMcpAccessToken({
  env = process.env,
  client,
  userId,
  tenantId = null,
  scopes,
  resource,
  jti,
}) {
  const configuration = signingConfiguration(env);
  if (String(resource || "").replace(/\/+$/u, "") !== configuration.resource) {
    const error = new Error("OAuth access token resource is invalid.");
    error.code = "invalid_target";
    throw error;
  }
  return jwt.sign(
    {
      iss: configuration.issuer,
      aud: configuration.resource,
      azp: client.client_id,
      client_id: client.client_id,
      client_profile_key: client.client_profile_key,
      resource: configuration.resource,
      sub: tenantId ? `tenant:${tenantId}:user:${userId}` : `user:${userId}`,
      user_id: userId,
      tenant_id: tenantId || null,
      scope: scopes.join(" "),
      purpose: "remote_mcp_access",
    },
    configuration.secret,
    {
      algorithm: "HS256",
      expiresIn: REMOTE_MCP_ACCESS_TOKEN_TTL_SECONDS,
      jwtid: jti,
    },
  );
}

export function verifyRemoteMcpAccessTokenForRevocation(token, { env = process.env } = {}) {
  const configuration = signingConfiguration(env);
  return jwt.verify(String(token || ""), configuration.secret, {
    algorithms: ["HS256"],
    issuer: configuration.issuer,
    audience: configuration.resource,
  });
}
