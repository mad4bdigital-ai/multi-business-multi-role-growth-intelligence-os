import jwt from "jsonwebtoken";
import {
  REMOTE_MCP_ACCESS_TOKEN_TTL_SECONDS,
  REMOTE_MCP_AUTHORIZATION_REQUEST_TTL_SECONDS,
} from "./remoteMcpOAuthProfile.js";
import {
  WORDPRESS_STAGING_MCP_ACCESS_TOKEN_ALG,
  WORDPRESS_STAGING_MCP_AUTHORIZATION_SCOPES,
  WORDPRESS_STAGING_MCP_SCOPE,
  buildWordpressStagingMcpSubject,
  resolveWordpressStagingMcpIssuer,
  resolveWordpressStagingMcpKeyId,
  resolveWordpressStagingMcpPrivateKey,
  resolveWordpressStagingMcpPublicKey,
  resolveWordpressStagingMcpResource,
  wordpressStagingMcpSubjectAllowed,
} from "./wordpressStagingMcpOAuthProfile.js";

function exactResource(value, env = process.env) {
  const expected = resolveWordpressStagingMcpResource(env);
  return String(value || "").trim().replace(/\/+$/u, "") === expected ? expected : "";
}

function normalizeWordpressScopes(scopes) {
  const allowed = new Set(WORDPRESS_STAGING_MCP_AUTHORIZATION_SCOPES);
  const normalized = [...new Set((scopes || []).map((scope) => String(scope || "").trim()).filter(Boolean))];
  if (!normalized.includes(WORDPRESS_STAGING_MCP_SCOPE)) return [];
  if (normalized.some((scope) => !allowed.has(scope))) return [];
  return normalized;
}

function authorizationRequestConfiguration(env = process.env) {
  const privateKey = resolveWordpressStagingMcpPrivateKey(env);
  const publicKey = resolveWordpressStagingMcpPublicKey(env);
  const kid = resolveWordpressStagingMcpKeyId(env);
  const issuer = resolveWordpressStagingMcpIssuer(env);
  const resource = resolveWordpressStagingMcpResource(env);
  if (!privateKey || !publicKey || !kid || !issuer || !resource) {
    const error = new Error("WordPress staging OAuth authorization-request signing configuration is unavailable.");
    error.code = "wordpress_staging_oauth_request_signing_unavailable";
    throw error;
  }
  return { privateKey, publicKey, kid, issuer, resource };
}

function accessTokenConfiguration(env = process.env) {
  const privateKey = resolveWordpressStagingMcpPrivateKey(env);
  const publicKey = resolveWordpressStagingMcpPublicKey(env);
  const kid = resolveWordpressStagingMcpKeyId(env);
  const issuer = resolveWordpressStagingMcpIssuer(env);
  const resource = resolveWordpressStagingMcpResource(env);
  if (!privateKey || !publicKey || !kid || !issuer || !resource) {
    const error = new Error("WordPress staging OAuth RS256 signing configuration is unavailable.");
    error.code = "wordpress_staging_oauth_rs256_unavailable";
    throw error;
  }
  return { privateKey, publicKey, kid, issuer, resource };
}

export function issueWordpressStagingMcpAuthorizationRequest({
  env = process.env,
  clientId,
  redirectUri,
  state,
  scopes,
  resource,
  codeChallenge,
  jti,
}) {
  const configuration = authorizationRequestConfiguration(env);
  if (!exactResource(resource, env)) {
    const error = new Error("WordPress staging OAuth authorization request resource is invalid.");
    error.code = "invalid_target";
    throw error;
  }
  const normalizedScopes = normalizeWordpressScopes(scopes);
  if (!normalizedScopes.length) {
    const error = new Error("WordPress staging OAuth authorization request scope is invalid.");
    error.code = "invalid_scope";
    throw error;
  }
  return jwt.sign(
    {
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      resource: configuration.resource,
      scope: normalizedScopes.join(" "),
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      purpose: "wordpress_staging_mcp_authorization_request",
    },
    configuration.privateKey,
    {
      algorithm: WORDPRESS_STAGING_MCP_ACCESS_TOKEN_ALG,
      keyid: configuration.kid,
      issuer: configuration.issuer,
      audience: configuration.resource,
      expiresIn: REMOTE_MCP_AUTHORIZATION_REQUEST_TTL_SECONDS,
      jwtid: jti,
    },
  );
}

export function verifyWordpressStagingMcpAuthorizationRequest(token, { env = process.env } = {}) {
  const configuration = authorizationRequestConfiguration(env);
  const claims = jwt.verify(String(token || ""), configuration.publicKey, {
    algorithms: [WORDPRESS_STAGING_MCP_ACCESS_TOKEN_ALG],
    issuer: configuration.issuer,
    audience: configuration.resource,
  });
  const scopes = normalizeWordpressScopes(String(claims?.scope || "").split(/\s+/u));
  if (
    claims?.purpose !== "wordpress_staging_mcp_authorization_request"
    || claims?.resource !== configuration.resource
    || !scopes.length
  ) {
    const error = new Error("WordPress staging OAuth authorization request is invalid.");
    error.code = "invalid_authorization_request";
    throw error;
  }
  return { ...claims, scope: scopes.join(" ") };
}

export function issueWordpressStagingMcpAccessToken({
  env = process.env,
  client,
  userId,
  tenantId = null,
  scopes,
  resource,
  jti,
}) {
  const configuration = accessTokenConfiguration(env);
  if (!exactResource(resource, env)) {
    const error = new Error("WordPress staging OAuth access token resource is invalid.");
    error.code = "invalid_target";
    throw error;
  }
  if (!wordpressStagingMcpSubjectAllowed({ userId, tenantId }, env)) {
    const error = new Error("WordPress staging OAuth subject is not approved for this resource.");
    error.code = "invalid_grant";
    throw error;
  }
  const subject = buildWordpressStagingMcpSubject(userId, tenantId);
  if (!subject) {
    const error = new Error("WordPress staging OAuth subject is invalid.");
    error.code = "invalid_grant";
    throw error;
  }
  const normalizedScopes = normalizeWordpressScopes(scopes);
  if (!normalizedScopes.length) {
    const error = new Error("WordPress staging OAuth access token scope is invalid.");
    error.code = "invalid_scope";
    throw error;
  }
  return jwt.sign(
    {
      azp: client.client_id,
      client_id: client.client_id,
      client_profile_key: client.client_profile_key,
      resource: configuration.resource,
      sub: subject,
      user_id: userId,
      tenant_id: tenantId || null,
      scope: normalizedScopes.join(" "),
      purpose: "wordpress_staging_mcp_access",
    },
    configuration.privateKey,
    {
      algorithm: WORDPRESS_STAGING_MCP_ACCESS_TOKEN_ALG,
      keyid: configuration.kid,
      issuer: configuration.issuer,
      audience: configuration.resource,
      expiresIn: REMOTE_MCP_ACCESS_TOKEN_TTL_SECONDS,
      jwtid: jti,
    },
  );
}

export function verifyWordpressStagingMcpAccessTokenForRevocation(token, { env = process.env } = {}) {
  const configuration = accessTokenConfiguration(env);
  const claims = jwt.verify(String(token || ""), configuration.publicKey, {
    algorithms: [WORDPRESS_STAGING_MCP_ACCESS_TOKEN_ALG],
    issuer: configuration.issuer,
    audience: configuration.resource,
  });
  const scopes = normalizeWordpressScopes(String(claims?.scope || "").split(/\s+/u));
  if (
    claims?.purpose !== "wordpress_staging_mcp_access"
    || claims?.resource !== configuration.resource
    || !scopes.length
  ) {
    const error = new Error("WordPress staging OAuth access token is invalid.");
    error.code = "invalid_access_token";
    throw error;
  }
  return { ...claims, scope: scopes.join(" ") };
}
