import express, { Router } from "express";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { verifyUserJwtAuthorization } from "../userJwtAuth.js";
import {
  REMOTE_MCP_ACCESS_TOKEN_TTL_SECONDS,
  REMOTE_MCP_AUTHORIZATION_CODE_TTL_SECONDS,
  REMOTE_MCP_REFRESH_TOKEN_TTL_SECONDS,
  classifyRemoteMcpClientProfile,
  createOpaqueToken,
  fixedTimeSecretEqual,
  normalizeRemoteMcpRedirectUri,
  normalizeTokenEndpointAuthMethod,
  remoteMcpDynamicClientRegistrationAdvertised,
  remoteMcpDynamicClientRegistrationEnabled,
  remoteMcpDynamicRedirectUriAllowed,
  sha256,
  verifyPkceS256,
} from "../remoteMcpOAuthProfile.js";
import {
  WORDPRESS_STAGING_MCP_AUTHORIZATION_SCOPES,
  WORDPRESS_STAGING_MCP_CLIENT_ID_PREFIX,
  WORDPRESS_STAGING_MCP_SCOPE,
  buildWordpressStagingMcpJwks,
  generateWordpressStagingMcpClientId,
  isWordpressStagingMcpClientId,
  isWordpressStagingMcpClientRecord,
  resolveWordpressStagingMcpIssuer,
  resolveWordpressStagingMcpResource,
  wordpressStagingMcpClientProfileKey,
  wordpressStagingMcpOAuthConfigured,
  wordpressStagingMcpOAuthReady,
  wordpressStagingMcpSubjectAllowed,
} from "../wordpressStagingMcpOAuthProfile.js";
import {
  issueWordpressStagingMcpAccessToken,
  issueWordpressStagingMcpAuthorizationRequest,
  verifyWordpressStagingMcpAccessTokenForRevocation,
  verifyWordpressStagingMcpAuthorizationRequest,
} from "../wordpressStagingMcpOAuthTokens.js";
import {
  consumeRemoteMcpAuthorizationCode,
  createRemoteMcpOAuthGrant,
  issueRemoteMcpAuthorizationCode,
  readRemoteMcpAuthorizationCode,
  readRemoteMcpGrantByRefreshToken,
  readRemoteMcpOAuthClient,
  registerRemoteMcpOAuthClient,
  revokeRemoteMcpGrantByAccessJti,
  revokeRemoteMcpGrantByRefreshToken,
  rotateRemoteMcpOAuthGrant,
} from "../remoteMcpOAuthStore.js";
import { resolveRemoteMcpEffectiveRequestHost } from "../remoteMcpRequestHost.js";

function text(value, maximum = 255) {
  return String(value || "").trim().slice(0, maximum);
}

function noStore(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
}

function oauthError(res, status, error, description) {
  noStore(res);
  return res.status(status).json({ error, error_description: description });
}

function notFound(res) {
  return res.status(404).json({
    ok: false,
    error: { code: "WORDPRESS_STAGING_MCP_OAUTH_NOT_FOUND", message: "Not found." },
    secrets_included: false,
  });
}

function appendQuery(uri, values) {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && String(value) !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</gu, "\\u003c")
    .replace(/>/gu, "\\u003e")
    .replace(/&/gu, "\\u0026");
}

function basicCredentials(authorization) {
  const match = String(authorization || "").match(/^Basic\s+(.+)$/iu);
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      client_id: decodeURIComponent(decoded.slice(0, separator)),
      client_secret: decodeURIComponent(decoded.slice(separator + 1)),
      method: "client_secret_basic",
    };
  } catch {
    return null;
  }
}

function requestCredentials(req) {
  return basicCredentials(req.headers?.authorization) || {
    client_id: text(req.body?.client_id, 128),
    client_secret: String(req.body?.client_secret || ""),
    method: req.body?.client_secret ? "client_secret_post" : "none",
  };
}

async function authenticateClient(req, pool, env) {
  const credentials = requestCredentials(req);
  if (!credentials.client_id || !isWordpressStagingMcpClientId(credentials.client_id, env)) return null;
  const client = await readRemoteMcpOAuthClient(credentials.client_id, { pool });
  if (!isWordpressStagingMcpClientRecord(client, env)) return null;
  if (client.token_endpoint_auth_method === "none") {
    return credentials.method === "none" && !credentials.client_secret ? client : null;
  }
  if (credentials.method !== client.token_endpoint_auth_method || !client.client_secret_hash) return null;
  return fixedTimeSecretEqual(sha256(credentials.client_secret), client.client_secret_hash) ? client : null;
}

async function activeUserContext(pool, claims) {
  const userId = text(claims?.user_id, 64);
  if (!userId) return null;
  const [userRows] = await pool.query(
    `SELECT user_id FROM users WHERE user_id = ? AND status = 'active'`,
    [userId],
  );
  const [user] = userRows;
  if (!user) return null;

  const preferredTenant = text(claims?.tenant_id, 64);
  if (!preferredTenant) return { user_id: userId, tenant_id: null };
  const [membershipRows] = await pool.query(
    `SELECT m.tenant_id
       FROM memberships m
       JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ?
        AND m.tenant_id = ?
        AND m.status = 'active'
        AND t.status = 'active'`,
    [userId, preferredTenant],
  );
  const [membership] = membershipRows;
  return membership ? { user_id: userId, tenant_id: membership.tenant_id } : null;
}

function exactSubjectContext(context, userId, tenantId) {
  return Boolean(context)
    && context.user_id === userId
    && (context.tenant_id || null) === (tenantId || null);
}

function exactResource(value, env) {
  const resource = resolveWordpressStagingMcpResource(env);
  const candidate = String(value || resource).trim().replace(/\/+$/u, "");
  return candidate === resource ? resource : "";
}

function normalizeScope(value) {
  const allowed = new Set(WORDPRESS_STAGING_MCP_AUTHORIZATION_SCOPES);
  const raw = Array.isArray(value) ? value : String(value || "").split(/\s+/u);
  const scopes = [...new Set(raw.map((scope) => String(scope || "").trim()).filter(Boolean))];
  const effective = scopes.length ? scopes : [...WORDPRESS_STAGING_MCP_AUTHORIZATION_SCOPES];
  if (!effective.includes(WORDPRESS_STAGING_MCP_SCOPE)) return { ok: false, scopes: [] };
  if (effective.some((scope) => !allowed.has(scope))) return { ok: false, scopes: [] };
  return { ok: true, scopes: effective };
}

function issuerHost(env) {
  try {
    return new URL(resolveWordpressStagingMcpIssuer(env)).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function requestUsesIssuerHost(req, env) {
  const expected = issuerHost(env);
  const actual = resolveRemoteMcpEffectiveRequestHost(req, env);
  return Boolean(expected && actual && expected === actual);
}

function metadata(env) {
  const issuer = resolveWordpressStagingMcpIssuer(env);
  const resource = resolveWordpressStagingMcpResource(env);
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    ...(remoteMcpDynamicClientRegistrationAdvertised(env)
      ? { registration_endpoint: `${issuer}/oauth/register` }
      : {}),
    revocation_endpoint: `${issuer}/oauth/revoke`,
    jwks_uri: `${issuer}/oauth/jwks`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [...WORDPRESS_STAGING_MCP_AUTHORIZATION_SCOPES],
    resource_parameter_supported: true,
    authorization_response_iss_parameter_supported: true,
    protected_resources: [resource],
    "x-mad4b-resource-profile": {
      environment: "staging",
      resource,
      resource_scope: WORDPRESS_STAGING_MCP_SCOPE,
      refresh_token_supported: true,
      access_token_alg: "RS256",
      asymmetric_resource_server_verification: true,
      authorization_response_issuer_bound: true,
      subject_authorization_required: true,
      client_id_namespace: WORDPRESS_STAGING_MCP_CLIENT_ID_PREFIX,
      mutation_authority: false,
    },
  };
}

function authorizePage({ client, authorizationRequest }) {
  const request = safeJson({ authorization_request: authorizationRequest });
  const name = String(client.client_name || "Remote MCP client").replace(/[<>]/gu, "");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Connect ${name}</title><style>
body{font-family:Arial,sans-serif;margin:0;background:#07111f;color:#eef4ff;display:grid;min-height:100vh;place-items:center}main{width:min(480px,calc(100vw - 32px));background:#101a30;border:1px solid #2d3f62;border-radius:22px;padding:26px}label{display:block;margin:12px 0 5px;color:#a8b6d8;font-size:13px}input{width:100%;box-sizing:border-box;border-radius:14px;border:1px solid #2d3f62;padding:12px;background:#0b1428;color:#f0f5ff}button{border-radius:14px;border:1px solid #87a0ff;padding:12px 16px;color:white;background:#6383ff;font-weight:800;margin-top:14px;cursor:pointer}.consent{display:flex;gap:10px;align-items:flex-start;margin:16px 0;color:#eef4ff}.consent input{width:auto}pre{white-space:pre-wrap;background:#0b1428;border:1px solid #2d3f62;border-radius:14px;padding:12px}.muted{color:#a8b6d8;font-size:13px}
</style></head><body><main><h1>Connect ${name}</h1>
<p class="muted">This client requests read-only WordPress Staging access: ${WORDPRESS_STAGING_MCP_SCOPE}. Only pre-approved Staging subjects can complete authorization. Refresh access carries no additional mutation authority.</p>
<label>Email</label><input id="email" type="email" autocomplete="username"/>
<label>Password</label><input id="password" type="password" autocomplete="current-password"/>
<label class="consent"><input id="consent" type="checkbox"/><span>I authorize this client to use the read-only scope shown above and understand that I can revoke access later.</span></label>
<button id="login">Sign in and connect</button><pre id="out">Waiting for sign-in and consent.</pre>
<script>
const request=${request};const out=document.getElementById('out');
async function finish(token){const response=await fetch('/auth/mcp/wordpress-staging/oauth/code',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+token},body:JSON.stringify({...request,consent:true})});const data=await response.json();if(!response.ok)throw new Error(data?.error?.message||data?.error_description||'Authorization failed.');location.assign(data.redirect_to)}
async function authenticate(){if(!document.getElementById('consent').checked)throw new Error('Consent is required before connecting this client.');const body={email:document.getElementById('email').value,password:document.getElementById('password').value};const response=await fetch('/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok||!data.token)throw new Error(data?.error?.message||'Sign-in failed.');await finish(data.token)}
document.getElementById('login').onclick=()=>authenticate().catch(error=>out.textContent=error.message);
</script></main></body></html>`;
}

export function buildWordpressStagingMcpOAuthRoutes(deps = {}) {
  const router = Router();
  const env = deps.env || process.env;
  const pool = deps.pool || deps.getPool?.() || getPool();

  const serveMetadata = (req, res) => {
    if (!wordpressStagingMcpOAuthConfigured(env) || !requestUsesIssuerHost(req, env)) return notFound(res);
    if (!wordpressStagingMcpOAuthReady(env)) return oauthError(res, 503, "temporarily_unavailable", "WordPress staging OAuth signing authority or subject policy is not ready.");
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).json(metadata(env));
  };

  router.get("/.well-known/oauth-authorization-server/auth/mcp/wordpress-staging", serveMetadata);
  router.get("/.well-known/openid-configuration/auth/mcp/wordpress-staging", serveMetadata);
  router.get("/auth/mcp/wordpress-staging/.well-known/oauth-authorization-server", serveMetadata);

  router.get("/auth/mcp/wordpress-staging/oauth/jwks", (req, res) => {
    if (!wordpressStagingMcpOAuthConfigured(env) || !requestUsesIssuerHost(req, env)) return notFound(res);
    const jwks = buildWordpressStagingMcpJwks(env);
    if (!wordpressStagingMcpOAuthReady(env) || !jwks.keys.length) return oauthError(res, 503, "temporarily_unavailable", "WordPress staging OAuth signing authority or subject policy is not ready.");
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).json(jwks);
  });

  router.post("/auth/mcp/wordpress-staging/oauth/register", async (req, res) => {
    if (!wordpressStagingMcpOAuthConfigured(env) || !requestUsesIssuerHost(req, env)) return notFound(res);
    if (!wordpressStagingMcpOAuthReady(env)) return oauthError(res, 503, "temporarily_unavailable", "WordPress staging OAuth signing authority or subject policy is not ready.");
    if (!remoteMcpDynamicClientRegistrationEnabled(env)) return notFound(res);
    try {
      const suppliedRedirects = Array.isArray(req.body?.redirect_uris) ? req.body.redirect_uris : [];
      const redirectUris = [...new Set(suppliedRedirects.map((uri) => normalizeRemoteMcpRedirectUri(uri, env)).filter(Boolean))];
      if (
        !redirectUris.length
        || redirectUris.length !== suppliedRedirects.length
        || redirectUris.some((uri) => !remoteMcpDynamicRedirectUriAllowed(uri, env))
      ) return oauthError(res, 400, "invalid_redirect_uri", "Every redirect URI must be an exact approved HTTPS URI or explicitly enabled loopback URI.");

      const authMethod = normalizeTokenEndpointAuthMethod(req.body?.token_endpoint_auth_method || "none");
      if (!authMethod) return oauthError(res, 400, "invalid_client_metadata", "Unsupported token endpoint authentication method.");
      const scopes = normalizeScope(req.body?.scope);
      if (!scopes.ok) return oauthError(res, 400, "invalid_scope", "Only mad4b:read and offline_access are available for the WordPress staging OAuth client.");
      const clientName = text(req.body?.client_name || "WordPress Staging MCP client", 255);
      const clientSecret = authMethod === "none" ? "" : createOpaqueToken(32);
      const clientId = generateWordpressStagingMcpClientId(env);
      if (!clientId) return oauthError(res, 503, "temporarily_unavailable", "WordPress staging client namespace is unavailable.");
      const registered = await registerRemoteMcpOAuthClient({
        pool,
        clientId,
        env,
        clientName,
        clientProfileKey: wordpressStagingMcpClientProfileKey(classifyRemoteMcpClientProfile({ clientName, redirectUris })),
        tokenEndpointAuthMethod: authMethod,
        clientSecret,
        redirectUris,
        allowedScopes: [...WORDPRESS_STAGING_MCP_AUTHORIZATION_SCOPES],
      });
      noStore(res);
      return res.status(201).json({
        client_id: registered.client_id,
        ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
        client_id_issued_at: Math.floor(Date.now() / 1000),
        redirect_uris: redirectUris,
        token_endpoint_auth_method: authMethod,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: scopes.scopes.join(" "),
        client_name: clientName,
      });
    } catch {
      return oauthError(res, 503, "temporarily_unavailable", "WordPress staging client registration is temporarily unavailable.");
    }
  });

  router.get("/auth/mcp/wordpress-staging/oauth/authorize", async (req, res) => {
    if (!wordpressStagingMcpOAuthConfigured(env) || !requestUsesIssuerHost(req, env)) return notFound(res);
    if (!wordpressStagingMcpOAuthReady(env)) return oauthError(res, 503, "temporarily_unavailable", "WordPress staging OAuth signing authority or subject policy is not ready.");
    try {
      const requestedClientId = text(req.query?.client_id, 128);
      if (!isWordpressStagingMcpClientId(requestedClientId, env)) return res.status(400).type("text/plain").send("OAuth client is not registered for the WordPress staging profile.");
      const client = await readRemoteMcpOAuthClient(requestedClientId, { pool });
      if (!isWordpressStagingMcpClientRecord(client, env)) return res.status(400).type("text/plain").send("OAuth client is not registered for the WordPress staging resource.");
      if (String(req.query?.response_type || "") !== "code") return res.status(400).type("text/plain").send("response_type must be code.");
      const state = text(req.query?.state, 512);
      if (!state) return res.status(400).type("text/plain").send("state is required.");
      const redirectUri = normalizeRemoteMcpRedirectUri(req.query?.redirect_uri, env);
      if (!redirectUri || !client.redirect_uris.includes(redirectUri)) return res.status(400).type("text/plain").send("redirect_uri is not registered.");
      const resource = exactResource(req.query?.resource, env);
      if (!resource) return res.status(400).type("text/plain").send("resource is invalid.");
      const scopes = normalizeScope(req.query?.scope);
      if (!scopes.ok || scopes.scopes.some((scope) => !client.allowed_scopes.includes(scope))) return res.status(400).type("text/plain").send("scope is invalid.");
      const challenge = text(req.query?.code_challenge, 128);
      if (req.query?.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/u.test(challenge)) return res.status(400).type("text/plain").send("PKCE S256 code_challenge is required.");
      const authorizationRequest = issueWordpressStagingMcpAuthorizationRequest({
        env,
        clientId: client.client_id,
        redirectUri,
        state,
        scopes: scopes.scopes,
        resource,
        codeChallenge: challenge,
        jti: randomUUID(),
      });
      noStore(res);
      res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'");
      return res.status(200).type("html").send(authorizePage({ client, authorizationRequest }));
    } catch {
      return res.status(503).type("text/plain").send("WordPress staging OAuth authorization is temporarily unavailable.");
    }
  });

  router.post("/auth/mcp/wordpress-staging/oauth/code", async (req, res) => {
    if (!wordpressStagingMcpOAuthConfigured(env) || !requestUsesIssuerHost(req, env)) return notFound(res);
    if (!wordpressStagingMcpOAuthReady(env)) return oauthError(res, 503, "temporarily_unavailable", "WordPress staging OAuth signing authority or subject policy is not ready.");
    const verified = verifyUserJwtAuthorization(req.headers?.authorization, { env });
    if (!verified.ok) return res.status(verified.status).json({ ok: false, error: { code: verified.code, message: verified.message }, secrets_included: false });
    if (req.body?.consent !== true) return oauthError(res, 400, "consent_required", "Explicit user consent is required.");
    try {
      const request = verifyWordpressStagingMcpAuthorizationRequest(text(req.body?.authorization_request, 8192), { env });
      const client = await readRemoteMcpOAuthClient(text(request?.client_id, 128), { pool });
      if (!isWordpressStagingMcpClientRecord(client, env)) return oauthError(res, 400, "invalid_client", "OAuth client is not active for the WordPress staging resource.");
      const redirectUri = normalizeRemoteMcpRedirectUri(request?.redirect_uri, env);
      if (!redirectUri || !client.redirect_uris.includes(redirectUri)) return oauthError(res, 400, "invalid_redirect_uri", "redirect_uri is not registered.");
      const resource = exactResource(request?.resource, env);
      if (!resource) return oauthError(res, 400, "invalid_target", "resource is invalid.");
      const scopes = normalizeScope(request?.scope);
      if (!scopes.ok || scopes.scopes.some((scope) => !client.allowed_scopes.includes(scope))) return oauthError(res, 400, "invalid_scope", "scope is invalid.");
      const challenge = text(request?.code_challenge, 128);
      if (request?.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/u.test(challenge)) return oauthError(res, 400, "invalid_request", "PKCE S256 code_challenge is required.");
      const context = await activeUserContext(pool, verified.claims);
      if (!context) return oauthError(res, 403, "inactive_user", "The signed-in user or requested tenant context is not active.");
      if (!wordpressStagingMcpSubjectAllowed({ userId: context.user_id, tenantId: context.tenant_id }, env)) return oauthError(res, 403, "access_denied", "The signed-in subject is not approved for the WordPress staging MCP resource.");
      const issued = await issueRemoteMcpAuthorizationCode({
        pool,
        clientId: client.client_id,
        userId: context.user_id,
        tenantId: context.tenant_id,
        redirectUri,
        resource,
        scopes: scopes.scopes,
        codeChallenge: challenge,
      });
      noStore(res);
      return res.status(200).json({
        ok: true,
        code: issued.code,
        expires_in: REMOTE_MCP_AUTHORIZATION_CODE_TTL_SECONDS,
        redirect_to: appendQuery(redirectUri, {
          code: issued.code,
          state: text(request?.state, 512),
          iss: resolveWordpressStagingMcpIssuer(env),
        }),
        secrets_included: false,
      });
    } catch (error) {
      if (["JsonWebTokenError", "TokenExpiredError", "NotBeforeError"].includes(error?.name) || error?.code === "invalid_authorization_request") return oauthError(res, 400, "invalid_request", "The signed authorization request is invalid or expired.");
      return oauthError(res, 503, "temporarily_unavailable", "WordPress staging authorization code service is temporarily unavailable.");
    }
  });

  router.post("/auth/mcp/wordpress-staging/oauth/token", express.urlencoded({ extended: false }), async (req, res) => {
    if (!wordpressStagingMcpOAuthConfigured(env) || !requestUsesIssuerHost(req, env)) return notFound(res);
    if (!wordpressStagingMcpOAuthReady(env)) return oauthError(res, 503, "temporarily_unavailable", "WordPress staging OAuth signing authority or subject policy is not ready.");
    try {
      const client = await authenticateClient(req, pool, env);
      if (!client) return oauthError(res, 401, "invalid_client", "OAuth client authentication failed.");
      const resource = resolveWordpressStagingMcpResource(env);
      if (req.body?.resource && !exactResource(req.body.resource, env)) return oauthError(res, 400, "invalid_target", "resource is invalid.");
      const grantType = text(req.body?.grant_type, 64);

      if (grantType === "authorization_code") {
        const redirectUri = normalizeRemoteMcpRedirectUri(req.body?.redirect_uri, env);
        if (!redirectUri || !client.redirect_uris.includes(redirectUri)) return oauthError(res, 400, "invalid_grant", "redirect_uri does not match the authorization request.");
        const record = await readRemoteMcpAuthorizationCode({ pool, code: req.body?.code, clientId: client.client_id, redirectUri });
        if (!record || record.resource !== resource || record.code_challenge_method !== "S256") return oauthError(res, 400, "invalid_grant", "Authorization code is invalid, expired, or already used.");
        const scopes = normalizeScope(record.scopes);
        if (!scopes.ok || scopes.scopes.some((scope) => !client.allowed_scopes.includes(scope))) return oauthError(res, 400, "invalid_grant", "Authorization code scope is invalid.");
        if (!verifyPkceS256(req.body?.code_verifier, record.code_challenge)) return oauthError(res, 400, "invalid_grant", "PKCE verification failed.");
        const subject = await activeUserContext(pool, { user_id: record.user_id, tenant_id: record.tenant_id });
        if (!exactSubjectContext(subject, record.user_id, record.tenant_id)) return oauthError(res, 400, "invalid_grant", "The authorization subject is no longer active.");
        if (!wordpressStagingMcpSubjectAllowed({ userId: record.user_id, tenantId: record.tenant_id }, env)) return oauthError(res, 400, "invalid_grant", "The authorization subject is not approved for this resource.");
        const consumed = await consumeRemoteMcpAuthorizationCode({ pool, code: req.body?.code, clientId: client.client_id, redirectUri });
        if (!consumed) return oauthError(res, 400, "invalid_grant", "Authorization code is invalid, expired, or already used.");
        const jti = randomUUID();
        const accessExpiresAt = new Date(Date.now() + REMOTE_MCP_ACCESS_TOKEN_TTL_SECONDS * 1000);
        const accessToken = issueWordpressStagingMcpAccessToken({ env, client, userId: record.user_id, tenantId: record.tenant_id, scopes: scopes.scopes, resource, jti });
        const grant = await createRemoteMcpOAuthGrant({ pool, accessJti: jti, clientId: client.client_id, userId: record.user_id, tenantId: record.tenant_id, resource, scopes: scopes.scopes, accessExpiresAt });
        noStore(res);
        return res.status(200).json({ access_token: accessToken, token_type: "Bearer", expires_in: REMOTE_MCP_ACCESS_TOKEN_TTL_SECONDS, refresh_token: grant.refresh_token, refresh_token_expires_in: REMOTE_MCP_REFRESH_TOKEN_TTL_SECONDS, scope: scopes.scopes.join(" ") });
      }

      if (grantType === "refresh_token") {
        const refreshToken = String(req.body?.refresh_token || "");
        const current = await readRemoteMcpGrantByRefreshToken(refreshToken, { pool });
        const currentScopes = normalizeScope(current?.scopes || []);
        if (!current || current.client_id !== client.client_id || current.resource !== resource || !currentScopes.ok) return oauthError(res, 400, "invalid_grant", "Refresh token is invalid, expired, revoked, or bound to another resource.");
        const subject = await activeUserContext(pool, { user_id: current.user_id, tenant_id: current.tenant_id });
        if (!exactSubjectContext(subject, current.user_id, current.tenant_id)) return oauthError(res, 400, "invalid_grant", "The refresh subject is no longer active.");
        if (!wordpressStagingMcpSubjectAllowed({ userId: current.user_id, tenantId: current.tenant_id }, env)) return oauthError(res, 400, "invalid_grant", "The refresh subject is no longer approved for this resource.");
        const jti = randomUUID();
        const accessExpiresAt = new Date(Date.now() + REMOTE_MCP_ACCESS_TOKEN_TTL_SECONDS * 1000);
        const rotated = await rotateRemoteMcpOAuthGrant({ pool, refreshToken, accessJti: jti, accessExpiresAt });
        if (!rotated) return oauthError(res, 400, "invalid_grant", "Refresh token is invalid, expired, or revoked.");
        const accessToken = issueWordpressStagingMcpAccessToken({ env, client, userId: current.user_id, tenantId: current.tenant_id, scopes: currentScopes.scopes, resource, jti });
        noStore(res);
        return res.status(200).json({ access_token: accessToken, token_type: "Bearer", expires_in: REMOTE_MCP_ACCESS_TOKEN_TTL_SECONDS, refresh_token: rotated.next.refresh_token, scope: currentScopes.scopes.join(" ") });
      }

      return oauthError(res, 400, "unsupported_grant_type", "Only authorization_code and refresh_token are supported.");
    } catch (error) {
      if (error?.code === "invalid_grant" || error?.code === "invalid_target" || error?.code === "invalid_scope") return oauthError(res, 400, error.code, error.message);
      return oauthError(res, 503, "temporarily_unavailable", "WordPress staging token service is temporarily unavailable.");
    }
  });

  router.post("/auth/mcp/wordpress-staging/oauth/revoke", express.urlencoded({ extended: false }), async (req, res) => {
    if (!wordpressStagingMcpOAuthConfigured(env) || !requestUsesIssuerHost(req, env)) return notFound(res);
    if (!wordpressStagingMcpOAuthReady(env)) return oauthError(res, 503, "temporarily_unavailable", "WordPress staging OAuth signing authority or subject policy is not ready.");
    try {
      const client = await authenticateClient(req, pool, env);
      if (!client) return oauthError(res, 401, "invalid_client", "OAuth client authentication failed.");
      const token = String(req.body?.token || "");
      if (token.includes(".")) {
        try {
          const claims = verifyWordpressStagingMcpAccessTokenForRevocation(token, { env });
          if (claims?.client_id === client.client_id && claims?.jti) await revokeRemoteMcpGrantByAccessJti(claims.jti, { pool });
        } catch {}
      } else if (token) {
        const grant = await readRemoteMcpGrantByRefreshToken(token, { pool });
        if (grant?.client_id === client.client_id && grant?.resource === resolveWordpressStagingMcpResource(env)) await revokeRemoteMcpGrantByRefreshToken(token, { pool });
      }
      noStore(res);
      return res.status(200).end();
    } catch {
      return oauthError(res, 503, "temporarily_unavailable", "WordPress staging revocation service is temporarily unavailable.");
    }
  });

  return router;
}
