import jwt from "jsonwebtoken";
import {
  REMOTE_MCP_ACCESS_TOKEN_TTL_SECONDS,
  REMOTE_MCP_AUTHORIZATION_REQUEST_TTL_SECONDS,
  resolveRemoteMcpAuthorizationIssuer,
  resolveRemoteMcpOAuthResource,
  resolveRemoteMcpOAuthSigningSecret,
} from "./remoteMcpOAuthProfile.js";

function signingConfiguration(env = process.env) {
  const secret = resolveRemoteMcpOAuthSigningSecret(env);
  const issuer = resolveRemoteMcpAuthorizationIssuer(env);
  const resource = resolveRemoteMcpOAuthResource(env);
  if (!secret || !issuer || !resource) {
    const error = new Error("OAuth signing configuration is unavailable.");
    error.code = "oauth_signing_unavailable";
    throw error;
  }
  return { secret, issuer, resource };
}

export function issueRemoteMcpAuthorizationRequest({
  env = process.env,
  clientId,
  redirectUri,
  state,
  scopes,
  resource,
  codeChallenge,
  jti,
}) {
  const configuration = signingConfiguration(env);
  if (String(resource || "").replace(/\/+$/u, "") !== configuration.resource) {
    const error = new Error("OAuth authorization request resource is invalid.");
    error.code = "invalid_target";
    throw error;
  }
  return jwt.sign(
    {
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      resource: configuration.resource,
      scope: scopes.join(" "),
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      purpose: "remote_mcp_authorization_request",
    },
    configuration.secret,
    {
      algorithm: "HS256",
      issuer: configuration.issuer,
      audience: configuration.resource,
      expiresIn: REMOTE_MCP_AUTHORIZATION_REQUEST_TTL_SECONDS,
      jwtid: jti,
    },
  );
}

export function verifyRemoteMcpAuthorizationRequest(token, { env = process.env } = {}) {
  const configuration = signingConfiguration(env);
  const claims = jwt.verify(String(token || ""), configuration.secret, {
    algorithms: ["HS256"],
    issuer: configuration.issuer,
    audience: configuration.resource,
  });
  if (claims?.purpose !== "remote_mcp_authorization_request") {
    const error = new Error("OAuth authorization request is invalid.");
    error.code = "invalid_authorization_request";
    throw error;
  }
  return claims;
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
      issuer: configuration.issuer,
      audience: configuration.resource,
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
