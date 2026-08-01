import express, { Router } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { verifyUserJwtAuthorization } from "../userJwtAuth.js";
import {
  REMOTE_MCP_ACCESS_TOKEN_TTL_SECONDS,
  REMOTE_MCP_AUTHORIZATION_CODE_TTL_SECONDS,
  REMOTE_MCP_REFRESH_TOKEN_TTL_SECONDS,
  REMOTE_MCP_SCOPES,
  classifyRemoteMcpClientProfile,
  createOpaqueToken,
  fixedTimeSecretEqual,
  normalizeRemoteMcpRedirectUri,
  normalizeRemoteMcpScopes,
  normalizeTokenEndpointAuthMethod,
  remoteMcpDynamicClientRegistrationEnabled,
  remoteMcpOAuthEnabled,
  resolveRemoteMcpAuthorizationIssuer,
  resolveRemoteMcpOAuthResource,
  sha256,
  verifyPkceS256,
} from "../remoteMcpOAuthProfile.js";
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

function noStore(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
}

function cleanText(value, maximum = 255) {
  return String(value || "").trim().slice(0, maximum);
}

function safeJsonForHtml(value) {
  return JSON.stringify(value)
    .replace(/</gu, "\\u003c")
    .replace(/>/gu, "\\u003e")
    .replace(/&/gu, "\\u0026");
}

function oauthError(res, status, error, description) {
  noStore(res);
  return res.status(status).json({ error, error_description: description });
}

function appendOAuthParams(redirectUri, params) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function basicClientCredentials(authorization) {
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

function requestClientCredentials(req) {
  const basic = basicClientCredentials(req.headers?.authorization);
  if (basic) return basic;
  return {
    client_id: cleanText(req.body?.client_id, 128),
    client_secret: String(req.body?.client_secret || ""),
    method: req.body?.client_secret ? "client_secret_post" : "none",
  };
}

async function authenticateOAuthClient(req, pool) {
  const credentials = requestClientCredentials(req);
  if (!credentials.client_id) return { ok: false, status: 401, error: "invalid_client" };
  const client = await readRemoteMcpOAuthClient(credentials.client_id, { pool });
  if (!client) return { ok: false, status: 401, error: "invalid_client" };

  if (client.token_endpoint_auth_method === "none") {
    if (credentials.method !== "none" || credentials.client_secret) {
      return { ok: false, status: 401, error: "invalid_client" };
    }
    return { ok: true, client };
  }

  if (credentials.method !== client.token_endpoint_auth_method) {
    return { ok: false, status: 401, error: "invalid_client" };
  }
  const suppliedHash = sha256(credentials.client_secret);
  if (!client.client_secret_hash || !fixedTimeSecretEqual(suppliedHash, client.client_secret_hash)) {
    return { ok: false, status: 401, error: "invalid_client" };
  }
  return { ok: true, client };
}

function issueAccessToken({ env, client, userId, tenantId, scopes, resource, jti }) {
  const secret = String(env.JWT_SECRET || "").trim();
  const issuer = resolveRemoteMcpAuthorizationIssuer(env);
  if (!secret || !issuer) {
    const error = new Error("OAuth signing configuration is unavailable.");
    error.code = "oauth_signing_unavailable";
    throw error;
  }
  return jwt.sign(
    {
      iss: issuer,
      aud: resource,
      azp: client.client_id,
      client_id: client.client_id,
      client_profile_key: client.client_profile_key,
      resource,
      sub: tenantId ? `tenant:${tenantId}:user:${userId}` : `user:${userId}`,
      user_id: userId,
      tenant_id: tenantId || null,
      scope: scopes.join(" "),
      purpose: "remote_mcp_access",
    },
    secret,
    {
      algorithm: "HS256",
      expiresIn: REMOTE_MCP_ACCESS_TOKEN_TTL_SECONDS,
      jwtid: jti,
    },
  );
}

async function resolveActiveUserContext(pool, claims) {
  const userId = cleanText(claims?.user_id, 64);
  if (!userId) return null;
  const [users] = await pool.query(
    `SELECT user_id, email, display_name, status
       FROM users
      WHERE user_id = ? AND status = 'active'
      LIMIT 1`,
    [userId],
  );
  if (!users[0]) return null;

  const preferredTenantId = cleanText(claims?.tenant_id, 64);
  const [memberships] = await pool.query(
    `SELECT m.tenant_id, m.role, m.status, t.status AS tenant_status
       FROM memberships m
       JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ?
        AND m.status = 'active'
        AND t.status = 'active'
      ORDER BY CASE WHEN m.tenant_id = ? THEN 0 ELSE 1 END, m.granted_at ASC
      LIMIT 1`,
    [userId, preferredTenantId || ""],
  );
  return {
    user_id: userId,
    tenant_id: memberships[0]?.tenant_id || null,
  };
}

function buildAuthorizeHtml({ client, redirectUri, state, scope, resource, codeChallenge }) {
  const payload = {
    client_id: client.client_id,
    client_name: client.client_name,
    redirect_uri: redirectUri,
    state,
    scope,
    resource,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Connect ${String(client.client_name).replace(/[<>]/gu, "")}</title>
<style>
body{font-family:Arial,sans-serif;margin:0;background:#07111f;color:#eef4ff;display:grid;min-height:100vh;place-items:center}
main{width:min(480px,calc(100vw - 32px));background:#101a30;border:1px solid #2d3f62;border-radius:22px;padding:26px;box-shadow:0 24px 70px rgba(0,0,0,.28)}
label{display:block;margin:12px 0 5px;color:#a8b6d8;font-size:13px}input{width:100%;box-sizing:border-box;border-radius:14px;border:1px solid #2d3f62;padding:12px;background:#0b1428;color:#f0f5ff}button{border-radius:14px;border:1px solid #87a0ff;padding:12px 16px;color:white;background:#6383ff;font-weight:800;margin-top:14px;cursor:pointer}button.secondary{background:#17233e}pre{white-space:pre-wrap;background:#0b1428;border:1px solid #2d3f62;border-radius:14px;padding:12px;min-height:42px}.muted{color:#a8b6d8;font-size:13px}.consent{display:flex;gap:10px;align-items:flex-start;margin:16px 0;color:#eef4ff}.consent input{width:auto;margin-top:2px}
</style>
</head>
<body><main>
<h1>Connect ${String(client.client_name).replace(/[<>]/gu, "")}</h1>
<p class="muted">This connection requests read-only access to: ${scope.replace(/[<>]/gu, "")}. Workspace and Brand authority remains controlled by the platform.</p>
<label>Email</label><input id="email" type="email" autocomplete="username"/>
<label>Password</label><input id="password" type="password" autocomplete="current-password"/>
<label id="name-label" hidden>Display name</label><input id="display-name" hidden autocomplete="name"/>
<label class="consent"><input id="consent" type="checkbox"/><span>I authorize this client to use the read-only scopes shown above. I can revoke the connection later.</span></label>
<button id="login">Sign in and connect</button>
<button id="register" class="secondary">Create account</button>
<pre id="out">Waiting for sign-in and consent.</pre>
<script>
const request=${safeJsonForHtml(payload)};
const out=document.getElementById('out');
async function finish(token){
  const response=await fetch('/auth/mcp/oauth/code',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+token},body:JSON.stringify(request)});
  const data=await response.json();
  if(!response.ok)throw new Error(data?.error?.message||data?.error_description||'Authorization failed.');
  location.assign(data.redirect_to);
}
async function authenticate(kind){
  if(!document.getElementById('consent').checked)throw new Error('Consent is required before connecting this client.');
  out.textContent='Signing in…';
  const body={email:document.getElementById('email').value,password:document.getElementById('password').value};
  if(kind==='register')body.display_name=document.getElementById('display-name').value||body.email;
  const response=await fetch('/auth/'+kind,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok||!data.token)throw new Error(data?.error?.message||'Sign-in failed.');
  await finish(data.token);
}
document.getElementById('login').onclick=()=>authenticate('login').catch(error=>out.textContent=error.message);
document.getElementById('register').onclick=()=>{
  const displayName=document.getElementById('display-name');
  if(displayName.hidden){document.getElementById('name-label').hidden=false;displayName.hidden=false;out.textContent='Enter a display name, confirm consent, then click Create account again.';return;}
  authenticate('register').catch(error=>out.textContent=error.message);
};
</script>
</main></body></html>`;
}

export function buildRemoteMcpOAuthRoutes(deps = {}) {
  const router = Router();
  const env = deps.env || process.env;
  const pool = deps.pool || deps.getPool?.() || getPool();

  router.post("/auth/mcp/oauth/register", async (req, res) => {
    if (!remoteMcpOAuthEnabled(env) || !remoteMcpDynamicClientRegistrationEnabled(env)) {
      return res.status(404).json({ ok: false, error: { code: "MCP_OAUTH_DCR_DISABLED", message: "Not found." }, secrets_included: false });
    }
    try {
      const redirectUris = Array.isArray(req.body?.redirect_uris)
        ? [...new Set(req.body.redirect_uris.map((uri) => normalizeRemoteMcpRedirectUri(uri, env)).filter(Boolean))]
        : [];
      if (!redirectUris.length || redirectUris.length !== req.body.redirect_uris.length) {
        return oauthError(res, 400, "invalid_redirect_uri", "Every redirect URI must be an exact approved HTTPS URI.");
      }
      const authMethod = normalizeTokenEndpointAuthMethod(req.body?.token_endpoint_auth_method || "none");
      if (!authMethod) return oauthError(res, 400, "invalid_client_metadata", "Unsupported token endpoint authentication method.");
      const scopeResult = normalizeRemoteMcpScopes(req.body?.scope, REMOTE_MCP_SCOPES);
      if (!scopeResult.ok) return oauthError(res, 400, "invalid_scope", "Requested scope is not available.");

      const clientName = cleanText(req.body?.client_name || "Remote MCP client", 255);
      const clientProfileKey = classifyRemoteMcpClientProfile({ clientName, redirectUris });
      const clientSecret = authMethod === "none" ? "" : createOpaqueToken(32);
      const registered = await registerRemoteMcpOAuthClient({
        pool,
        clientName,
        clientProfileKey,
        tokenEndpointAuthMethod: authMethod,
        clientSecret,
        redirectUris,
        allowedScopes: scopeResult.scopes,
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
        scope: scopeResult.scopes.join(" "),
        client_name: clientName,
      });
    } catch {
      return oauthError(res, 503, "temporarily_unavailable", "Client registration is temporarily unavailable.");
    }
  });

  router.get("/auth/mcp/oauth/authorize", async (req, res) => {
    if (!remoteMcpOAuthEnabled(env)) return res.status(404).type("text/plain").send("Not found.");
    try {
      const clientId = cleanText(req.query?.client_id, 128);
      const client = await readRemoteMcpOAuthClient(clientId, { pool });
      if (!client) return res.status(400).type("text/plain").send("OAuth client is not registered or active.");
      if (String(req.query?.response_type || "") !== "code") return res.status(400).type("text/plain").send("response_type must be code.");
      const state = cleanText(req.query?.state, 512);
      if (!state) return res.status(400).type("text/plain").send("state is required.");
      const redirectUri = normalizeRemoteMcpRedirectUri(req.query?.redirect_uri, env);
      if (!redirectUri || !client.redirect_uris.includes(redirectUri)) return res.status(400).type("text/plain").send("redirect_uri is not registered.");
      const resource = resolveRemoteMcpOAuthResource(env);
      if (String(req.query?.resource || resource).replace(/\/+$/u, "") !== resource) return res.status(400).type("text/plain").send("resource is invalid.");
      const scopeResult = normalizeRemoteMcpScopes(req.query?.scope, client.allowed_scopes);
      if (!scopeResult.ok) return res.status(400).type("text/plain").send("scope is invalid.");
      const codeChallenge = cleanText(req.query?.code_challenge, 128);
      if (String(req.query?.code_challenge_method || "") !== "S256" || !/^[A-Za-z0-9_-]{43}$/u.test(codeChallenge)) {
        return res.status(400).type("text/plain").send("PKCE S256 code_challenge is required.");
      }
      noStore(res);
      res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'");
      return res.status(200).type("html").send(buildAuthorizeHtml({
        client,
        redirectUri,
        state,
        scope: scopeResult.scopes.join(" "),
        resource,
        codeChallenge,
      }));
    } catch {
      return res.status(503).type("text/plain").send("OAuth authorization is temporarily unavailable.");
    }
  });

  router.post("/auth/mcp/oauth/code", async (req, res) => {
    if (!remoteMcpOAuthEnabled(env)) return res.status(404).json({ ok: false, error: { code: "MCP_OAUTH_DISABLED", message: "Not found." } });
    const verified = verifyUserJwtAuthorization(req.headers?.authorization, { env });
    if (!verified.ok) return res.status(verified.status).json({ ok: false, error: { code: verified.code, message: verified.message }, secrets_included: false });
    try {
      const client = await readRemoteMcpOAuthClient(cleanText(req.body?.client_id, 128), { pool });
      if (!client) return res.status(400).json({ ok: false, error: { code: "invalid_client", message: "OAuth client is not active." } });
      const redirectUri = normalizeRemoteMcpRedirectUri(req.body?.redirect_uri, env);
      if (!redirectUri || !client.redirect_uris.includes(redirectUri)) return res.status(400).json({ ok: false, error: { code: "invalid_redirect_uri", message: "redirect_uri is not registered." } });
      const resource = resolveRemoteMcpOAuthResource(env);
      if (String(req.body?.resource || "").replace(/\/+$/u, "") !== resource) return res.status(400).json({ ok: false, error: { code: "invalid_target", message: "resource is invalid." } });
      const scopeResult = normalizeRemoteMcpScopes(req.body?.scope, client.allowed_scopes);
      if (!scopeResult.ok) return res.status(400).json({ ok: false, error: { code: "invalid_scope", message: "scope is invalid." } });
      const codeChallenge = cleanText(req.body?.code_challenge, 128);
      if (req.body?.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/u.test(codeChallenge)) {
        return res.status(400).json({ ok: false, error: { code: "invalid_request", message: "PKCE S256 code_challenge is required." } });
      }
      const context = await resolveActiveUserContext(pool, verified.claims);
      if (!context) return res.status(403).json({ ok: false, error: { code: "inactive_user", message: "The signed-in user is not active." } });
      const issued = await issueRemoteMcpAuthorizationCode({
        pool,
        clientId: client.client_id,
        userId: context.user_id,
        tenantId: context.tenant_id,
        redirectUri,
        resource,
        scopes: scopeResult.scopes,
        codeChallenge,
      });
      noStore(res);
      return res.status(200).json({
        ok: true,
        code: issued.code,
        expires_in: REMOTE_MCP_AUTHORIZATION_CODE_TTL_SECONDS,
        redirect_to: appendOAuthParams(redirectUri, { code: issued.code, state: cleanText(req.body?.state, 512) }),
        secrets_included: false,
      });
    } catch {
      return res.status(503).json({ ok: false, error: { code: "oauth_code_unavailable", message: "OAuth authorization code service is temporarily unavailable." }, secrets_included: false });
    }
  });

  router.post("/auth/mcp/oauth/token", express.urlencoded({ extended: false }), async (req, res) => {
    if (!remoteMcpOAuthEnabled(env)) return oauthError(res, 404, "invalid_request", "Not found.");
    try {
      const authenticated = await authenticateOAuthClient(req, pool);
      if (!authenticated.ok) return oauthError(res, authenticated.status, authenticated.error, "OAuth client authentication failed.");
      const client = authenticated.client;
      const grantType = cleanText(req.body?.grant_type, 64);
      const resource = resolveRemoteMcpOAuthResource(env);

      if (grantType === "authorization_code") {
        const redirectUri = normalizeRemoteMcpRedirectUri(req.body?.redirect_uri, env);
        if (!redirectUri || !client.redirect_uris.includes(redirectUri)) return oauthError(res, 400, "invalid_grant", "redirect_uri does not match the authorization request.");
        const codeRecord = await readRemoteMcpAuthorizationCode({
          pool,
          code: req.body?.code,
          clientId: client.client_id,
          redirectUri,
        });
        if (!codeRecord || codeRecord.resource !== resource || codeRecord.code_challenge_method !== "S256") {
          return oauthError(res, 400, "invalid_grant", "Authorization code is invalid, expired, or already used.");
        }
        if (!verifyPkceS256(req.body?.code_verifier, codeRecord.code_challenge)) {
          return oauthError(res, 400, "invalid_grant", "PKCE verification failed.");
        }
        const consumed = await consumeRemoteMcpAuthorizationCode({
          pool,
          code: req.body?.code,
          clientId: client.client_id,
          redirectUri,
        });
        if (!consumed) return oauthError(res, 400, "invalid_grant", "Authorization code is invalid, expired, or already used.");

        const accessJti = randomUUID();
        const accessExpiresAt = new Date(Date.now() + REMOTE_MCP_ACCESS_TOKEN_TTL_SECONDS * 1000);
        const accessToken = issueAccessToken({
          env,
          client,
          userId: codeRecord.user_id,
          tenantId: codeRecord.tenant_id,
          scopes: codeRecord.scopes,
          resource,
          jti: accessJti,
        });
        const grant = await createRemoteMcpOAuthGrant({
          pool,
          accessJti,
          clientId: client.client_id,
          userId: codeRecord.user_id,
          tenantId: codeRecord.tenant_id,
          resource,
          scopes: codeRecord.scopes,
          accessExpiresAt,
        });
        noStore(res);
        return res.status(200).json({
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: REMOTE_MCP_ACCESS_TOKEN_TTL_SECONDS,
          refresh_token: grant.refresh_token,
          refresh_token_expires_in: REMOTE_MCP_REFRESH_TOKEN_TTL_SECONDS,
          scope: codeRecord.scopes.join(" "),
        });
      }

      if (grantType === "refresh_token") {
        const refreshToken = String(req.body?.refresh_token || "");
        const current = await readRemoteMcpGrantByRefreshToken(refreshToken, { pool });
        if (!current || current.client_id !== client.client_id || current.resource !== resource) {
          return oauthError(res, 400, "invalid_grant", "Refresh token is invalid, expired, or revoked.");
        }
        const accessJti = randomUUID();
        const accessExpiresAt = new Date(Date.now() + REMOTE_MCP_ACCESS_TOKEN_TTL_SECONDS * 1000);
        const rotated = await rotateRemoteMcpOAuthGrant({ pool, refreshToken, accessJti, accessExpiresAt });
        if (!rotated) return oauthError(res, 400, "invalid_grant", "Refresh token is invalid, expired, or revoked.");
        const accessToken = issueAccessToken({
          env,
          client,
          userId: current.user_id,
          tenantId: current.tenant_id,
          scopes: current.scopes,
          resource,
          jti: accessJti,
        });
        noStore(res);
        return res.status(200).json({
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: REMOTE_MCP_ACCESS_TOKEN_TTL_SECONDS,
          refresh_token: rotated.next.refresh_token,
          scope: current.scopes.join(" "),
        });
      }

      return oauthError(res, 400, "unsupported_grant_type", "Only authorization_code and refresh_token are supported.");
    } catch (error) {
      if (error?.code === "invalid_grant") return oauthError(res, 400, "invalid_grant", error.message);
      return oauthError(res, 503, "temporarily_unavailable", "OAuth token service is temporarily unavailable.");
    }
  });

  router.post("/auth/mcp/oauth/revoke", express.urlencoded({ extended: false }), async (req, res) => {
    if (!remoteMcpOAuthEnabled(env)) return res.status(404).end();
    try {
      const authenticated = await authenticateOAuthClient(req, pool);
      if (!authenticated.ok) return oauthError(res, authenticated.status, authenticated.error, "OAuth client authentication failed.");
      const token = String(req.body?.token || "");
      if (token.includes(".")) {
        try {
          const claims = jwt.verify(token, String(env.JWT_SECRET || ""), {
            algorithms: ["HS256"],
            issuer: resolveRemoteMcpAuthorizationIssuer(env),
            audience: resolveRemoteMcpOAuthResource(env),
          });
          if (claims?.client_id === authenticated.client.client_id && claims?.jti) {
            await revokeRemoteMcpGrantByAccessJti(claims.jti, { pool });
          }
        } catch {}
      } else if (token) {
        const grant = await readRemoteMcpGrantByRefreshToken(token, { pool });
        if (grant?.client_id === authenticated.client.client_id) {
          await revokeRemoteMcpGrantByRefreshToken(token, { pool });
        }
      }
      noStore(res);
      return res.status(200).end();
    } catch {
      return res.status(200).end();
    }
  });

  return router;
}
