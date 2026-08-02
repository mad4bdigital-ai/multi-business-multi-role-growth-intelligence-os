import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { buildRemoteMcpOAuthRoutes } from "./routes/remoteMcpOAuthRoutes.js";
import { sha256 } from "./remoteMcpOAuthProfile.js";

const env = {
  JWT_SECRET: "user-session-route-test-secret",
  REMOTE_MCP_OAUTH_SIGNING_SECRET: "remote-mcp-oauth-route-test-secret",
  REMOTE_MCP_ENABLED: "true",
  REMOTE_MCP_OAUTH_ENABLED: "true",
  REMOTE_MCP_OAUTH_DCR_ENABLED: "true",
  REMOTE_MCP_OAUTH_ALLOWED_REDIRECT_ORIGINS: "https://claude.ai https://chatgpt.com",
  REMOTE_MCP_RESOURCE_URL: "https://mcp.example.test",
  REMOTE_MCP_AUTHORIZATION_SERVER_URL: "https://auth.example.test/auth/mcp",
};

const clients = new Map();
const codes = new Map();
const grantsById = new Map();
const grantsByAccessJti = new Map();
const grantsByRefreshHash = new Map();
let membershipActive = true;

function result(affectedRows = 0) {
  return [{ affectedRows }, []];
}

const pool = {
  async query(sqlValue, params = []) {
    const sql = String(sqlValue);
    if (sql.includes("INSERT INTO remote_mcp_oauth_clients")) {
      clients.set(params[0], {
        client_id: params[0],
        client_name: params[1],
        client_profile_key: params[2],
        token_endpoint_auth_method: params[3],
        client_secret_hash: params[4],
        redirect_uris_json: params[5],
        allowed_scopes_json: params[6],
        registration_access_token_hash: params[7],
        status: "active",
        expires_at: null,
      });
      return result(1);
    }
    if (sql.includes("FROM remote_mcp_oauth_clients")) {
      const row = clients.get(params[0]);
      return [[row].filter(Boolean), []];
    }
    if (sql.includes("FROM users")) {
      return [[{ user_id: "user-1", email: "user@example.test", display_name: "User One", status: "active" }], []];
    }
    if (sql.includes("FROM memberships m") && sql.includes("JOIN tenants")) {
      return [membershipActive
        ? [{ tenant_id: "workspace-1", role: "owner", status: "active", tenant_status: "active" }]
        : [], []];
    }
    if (sql.includes("INSERT INTO remote_mcp_oauth_authorization_codes")) {
      codes.set(params[0], {
        code_hash: params[0],
        client_id: params[1],
        user_id: params[2],
        tenant_id: params[3],
        redirect_uri: params[4],
        resource: params[5],
        scopes_json: params[6],
        code_challenge: params[7],
        code_challenge_method: "S256",
        status: "issued",
        expires_at: params[8],
      });
      return result(1);
    }
    if (sql.includes("FROM remote_mcp_oauth_authorization_codes")) {
      const row = codes.get(params[0]);
      const matches = row
        && row.client_id === params[1]
        && row.redirect_uri === params[2]
        && row.status === "issued";
      return [[matches ? row : null].filter(Boolean), []];
    }
    if (sql.includes("UPDATE remote_mcp_oauth_authorization_codes")) {
      const row = codes.get(params[0]);
      const canConsume = row
        && row.client_id === params[1]
        && row.redirect_uri === params[2]
        && row.status === "issued";
      if (canConsume) row.status = "consumed";
      return result(canConsume ? 1 : 0);
    }
    if (sql.includes("INSERT INTO remote_mcp_oauth_grants")) {
      const row = {
        grant_id: params[0],
        access_jti: params[1],
        refresh_token_hash: params[2],
        client_id: params[3],
        user_id: params[4],
        tenant_id: params[5],
        resource: params[6],
        scopes_json: params[7],
        status: "active",
        access_expires_at: params[8],
        refresh_expires_at: params[9],
        replaced_by_grant_id: null,
      };
      grantsById.set(row.grant_id, row);
      grantsByAccessJti.set(row.access_jti, row);
      grantsByRefreshHash.set(row.refresh_token_hash, row);
      return result(1);
    }
    if (sql.includes("FROM remote_mcp_oauth_grants") && sql.includes("refresh_token_hash = ?")) {
      const row = grantsByRefreshHash.get(params[0]);
      return [[row && row.status === "active" ? row : null].filter(Boolean), []];
    }
    if (sql.includes("FROM remote_mcp_oauth_grants") && sql.includes("access_jti = ?")) {
      const row = grantsByAccessJti.get(params[0]);
      return [[row && row.status === "active" ? row : null].filter(Boolean), []];
    }
    if (sql.includes("SET status = 'rotated'")) {
      const row = grantsById.get(params[1]);
      if (!row || row.status !== "active") return result(0);
      row.status = "rotated";
      row.replaced_by_grant_id = params[0];
      return result(1);
    }
    if (sql.includes("SET status = 'revoked'") && sql.includes("access_jti = ?")) {
      const row = grantsByAccessJti.get(params[0]);
      if (!row || row.status !== "active") return result(0);
      row.status = "revoked";
      return result(1);
    }
    if (sql.includes("SET status = 'revoked'") && sql.includes("refresh_token_hash = ?")) {
      const row = grantsByRefreshHash.get(params[0]);
      if (!row || row.status !== "active") return result(0);
      row.status = "revoked";
      return result(1);
    }
    throw new Error(`Unexpected query: ${sql} ${JSON.stringify(params)}`);
  },
  async getConnection() {
    return {
      query: (...args) => pool.query(...args),
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => {},
      release: () => {},
    };
  },
};

const app = express();
app.use(express.json());
app.use(buildRemoteMcpOAuthRoutes({ env, pool }));
const server = await new Promise((resolve) => {
  const started = app.listen(0, () => resolve(started));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

async function json(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

try {
  const rejectedRegistration = await fetch(`${baseUrl}/auth/mcp/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Unapproved Client",
      redirect_uris: ["https://evil.example/callback"],
      token_endpoint_auth_method: "none",
      scope: "workspaces.read",
    }),
  });
  const rejectedRegistrationBody = await json(rejectedRegistration);
  assert.equal(rejectedRegistration.status, 400);
  assert.equal(rejectedRegistrationBody.error, "invalid_redirect_uri");
  assert.equal(clients.size, 0);

  const redirectUri = "https://claude.ai/api/mcp/auth_callback";
  const registerResponse = await fetch(`${baseUrl}/auth/mcp/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Claude",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "workspaces.read brands.read",
    }),
  });
  const registered = await json(registerResponse);
  assert.equal(registerResponse.status, 201);
  assert.match(registered.client_id, /^mcp_/u);
  assert.equal(registered.token_endpoint_auth_method, "none");
  assert.equal(registered.client_secret, undefined);
  assert.equal(registered.registration_access_token, undefined);
  assert.equal(registered.registration_client_uri, undefined);
  assert.equal(clients.get(registered.client_id).client_profile_key, "anthropic_claude");

  const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  const authorizeUrl = new URL(`${baseUrl}/auth/mcp/oauth/authorize`);
  authorizeUrl.searchParams.set("client_id", registered.client_id);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", "state-1");
  authorizeUrl.searchParams.set("scope", "workspaces.read brands.read");
  authorizeUrl.searchParams.set("resource", env.REMOTE_MCP_RESOURCE_URL);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  const authorizeResponse = await fetch(authorizeUrl);
  const authorizeHtml = await authorizeResponse.text();
  assert.equal(authorizeResponse.status, 200);
  assert(authorizeHtml.includes("Connect Claude"));
  assert(authorizeHtml.includes("/auth/mcp/oauth/code"));
  assert(authorizeHtml.includes('id="consent"'));
  assert(authorizeHtml.includes("Consent is required"));
  assert(authorizeResponse.headers.get("cache-control")?.includes("no-store"));
  const requestMatch = authorizeHtml.match(/"authorization_request":"([^"]+)"/u);
  assert(requestMatch?.[1], "authorize page should contain a signed authorization request");
  const authorizationRequest = requestMatch[1];
  const authorizationClaims = jwt.verify(authorizationRequest, env.REMOTE_MCP_OAUTH_SIGNING_SECRET, {
    algorithms: ["HS256"],
    issuer: env.REMOTE_MCP_AUTHORIZATION_SERVER_URL,
    audience: env.REMOTE_MCP_RESOURCE_URL,
  });
  assert.equal(authorizationClaims.purpose, "remote_mcp_authorization_request");
  assert.equal(authorizationClaims.client_id, registered.client_id);
  assert.equal(authorizationClaims.redirect_uri, redirectUri);
  assert.equal(authorizationClaims.code_challenge, challenge);

  const userToken = jwt.sign(
    { user_id: "user-1", tenant_id: "workspace-1", email: "user@example.test" },
    env.JWT_SECRET,
    { algorithm: "HS256", expiresIn: 3600 },
  );

  const missingConsentResponse = await fetch(`${baseUrl}/auth/mcp/oauth/code`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${userToken}` },
    body: JSON.stringify({ authorization_request: authorizationRequest, consent: false }),
  });
  const missingConsent = await json(missingConsentResponse);
  assert.equal(missingConsentResponse.status, 400);
  assert.equal(missingConsent.error, "consent_required");
  assert.equal(codes.size, 0);

  const tamperedRequestResponse = await fetch(`${baseUrl}/auth/mcp/oauth/code`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${userToken}` },
    body: JSON.stringify({ authorization_request: `${authorizationRequest}x`, consent: true }),
  });
  const tamperedRequest = await json(tamperedRequestResponse);
  assert.equal(tamperedRequestResponse.status, 400);
  assert.equal(tamperedRequest.error, "invalid_request");
  assert.equal(codes.size, 0);

  const codeResponse = await fetch(`${baseUrl}/auth/mcp/oauth/code`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ authorization_request: authorizationRequest, consent: true }),
  });
  const codeResult = await json(codeResponse);
  assert.equal(codeResponse.status, 200);
  assert.equal(codeResult.ok, true);
  assert(codeResult.redirect_to.includes("state=state-1"));
  assert(codeResult.redirect_to.includes("code="));

  const wrongResourceResponse = await fetch(`${baseUrl}/auth/mcp/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: registered.client_id,
      code: codeResult.code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource: "https://other.example.test",
    }),
  });
  const wrongResource = await json(wrongResourceResponse);
  assert.equal(wrongResourceResponse.status, 400);
  assert.equal(wrongResource.error, "invalid_target");
  assert.equal(codes.get(sha256(codeResult.code)).status, "issued");

  const wrongVerifierResponse = await fetch(`${baseUrl}/auth/mcp/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: registered.client_id,
      code: codeResult.code,
      redirect_uri: redirectUri,
      code_verifier: `${verifier}x`,
      resource: env.REMOTE_MCP_RESOURCE_URL,
    }),
  });
  const wrongVerifier = await json(wrongVerifierResponse);
  assert.equal(wrongVerifierResponse.status, 400);
  assert.equal(wrongVerifier.error, "invalid_grant");
  assert.equal(codes.get(sha256(codeResult.code)).status, "issued");

  const tokenResponse = await fetch(`${baseUrl}/auth/mcp/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: registered.client_id,
      code: codeResult.code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource: env.REMOTE_MCP_RESOURCE_URL,
    }),
  });
  const tokens = await json(tokenResponse);
  assert.equal(tokenResponse.status, 200);
  assert.equal(tokens.token_type, "Bearer");
  assert(tokens.refresh_token);
  assert.equal(codes.get(sha256(codeResult.code)).status, "consumed");
  const accessClaims = jwt.verify(tokens.access_token, env.REMOTE_MCP_OAUTH_SIGNING_SECRET, {
    algorithms: ["HS256"],
    issuer: env.REMOTE_MCP_AUTHORIZATION_SERVER_URL,
    audience: env.REMOTE_MCP_RESOURCE_URL,
  });
  assert.equal(accessClaims.purpose, "remote_mcp_access");
  assert.equal(accessClaims.client_id, registered.client_id);
  assert.equal(accessClaims.user_id, "user-1");
  assert.equal(accessClaims.tenant_id, "workspace-1");
  assert.equal(accessClaims.sub, "tenant:workspace-1:user:user-1");
  assert.throws(() => jwt.verify(tokens.access_token, env.JWT_SECRET, { algorithms: ["HS256"] }));

  const refreshResponse = await fetch(`${baseUrl}/auth/mcp/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: registered.client_id,
      refresh_token: tokens.refresh_token,
      resource: env.REMOTE_MCP_RESOURCE_URL,
    }),
  });
  const refreshed = await json(refreshResponse);
  assert.equal(refreshResponse.status, 200);
  assert(refreshed.refresh_token);
  assert.notEqual(refreshed.refresh_token, tokens.refresh_token);

  const refreshedClaims = jwt.verify(refreshed.access_token, env.REMOTE_MCP_OAUTH_SIGNING_SECRET, {
    algorithms: ["HS256"],
    issuer: env.REMOTE_MCP_AUTHORIZATION_SERVER_URL,
    audience: env.REMOTE_MCP_RESOURCE_URL,
  });
  assert.equal(grantsByAccessJti.get(accessClaims.jti).status, "rotated");
  assert.equal(grantsByAccessJti.get(refreshedClaims.jti).status, "active");

  const replayRefreshResponse = await fetch(`${baseUrl}/auth/mcp/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: registered.client_id,
      refresh_token: tokens.refresh_token,
      resource: env.REMOTE_MCP_RESOURCE_URL,
    }),
  });
  const replayRefresh = await json(replayRefreshResponse);
  assert.equal(replayRefreshResponse.status, 400);
  assert.equal(replayRefresh.error, "invalid_grant");

  membershipActive = false;
  const inactiveRefreshResponse = await fetch(`${baseUrl}/auth/mcp/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: registered.client_id,
      refresh_token: refreshed.refresh_token,
      resource: env.REMOTE_MCP_RESOURCE_URL,
    }),
  });
  const inactiveRefresh = await json(inactiveRefreshResponse);
  assert.equal(inactiveRefreshResponse.status, 400);
  assert.equal(inactiveRefresh.error, "invalid_grant");
  assert.equal(grantsByAccessJti.get(refreshedClaims.jti).status, "active");

  const revokeResponse = await fetch(`${baseUrl}/auth/mcp/oauth/revoke`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: registered.client_id,
      token: refreshed.access_token,
      token_type_hint: "access_token",
    }),
  });
  assert.equal(revokeResponse.status, 200);
  assert.equal(grantsByAccessJti.get(refreshedClaims.jti).status, "revoked");

  const originalRefreshHash = sha256(tokens.refresh_token);
  assert.equal(grantsByRefreshHash.get(originalRefreshHash).status, "rotated");
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log("remote MCP OAuth 2.1 route tests passed");
