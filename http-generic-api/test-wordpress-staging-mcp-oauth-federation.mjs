import assert from "node:assert/strict";
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { buildWordpressStagingMcpOAuthRoutes } from "./routes/wordpressStagingMcpOAuthRoutes.js";
import {
  WORDPRESS_STAGING_MCP_AUTHORIZATION_SCOPES,
  WORDPRESS_STAGING_MCP_CLIENT_PROFILE_PREFIX,
  WORDPRESS_STAGING_MCP_OFFLINE_SCOPE,
  WORDPRESS_STAGING_MCP_SCOPE,
  getWordpressStagingMcpOAuthStatus,
  isWordpressStagingMcpClientId,
  wordpressStagingMcpDcrAdvertised,
  wordpressStagingMcpOAuthConfigured,
  wordpressStagingMcpOAuthReady,
} from "./wordpressStagingMcpOAuthProfile.js";
import { isRemoteMcpClientIdForEnvironment, sha256 } from "./remoteMcpOAuthProfile.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });

const approvedSubject = "tenant:workspace-1:user:user-1";
const env = {
  JWT_SECRET: "wordpress-staging-user-session-test-secret",
  REMOTE_MCP_ENVIRONMENT: "staging",
  REMOTE_MCP_OAUTH_ENABLED: "true",
  // Primary remote-MCP DCR deliberately remains disabled.
  REMOTE_MCP_OAUTH_DCR_ENABLED: "false",
  REMOTE_MCP_WORDPRESS_STAGING_DCR_ENABLED: "true",
  REMOTE_MCP_OAUTH_ALLOWED_REDIRECT_ORIGINS: "https://chatgpt.com",
  REMOTE_MCP_OAUTH_SIGNING_SECRET: "wordpress-staging-authorization-request-signing-secret",
  REMOTE_MCP_RESOURCE_URL: "https://mcp-dev.example.test",
  REMOTE_MCP_AUTHORIZATION_SERVER_URL: "https://dev.example.test/auth/mcp",
  REMOTE_MCP_WORDPRESS_STAGING_OAUTH_ENABLED: "true",
  REMOTE_MCP_WORDPRESS_STAGING_RESOURCE_URL: "https://staging.example.test/wp-json/mcp/mad4b-read",
  REMOTE_MCP_WORDPRESS_STAGING_ALLOWED_SUBJECTS: approvedSubject,
  REMOTE_MCP_WORDPRESS_RS256_PRIVATE_KEY_B64: Buffer.from(privatePem, "utf8").toString("base64"),
};
// mcpRoutes projects the dedicated DCR flag into this isolated router only.
const routeEnv = {
  ...env,
  REMOTE_MCP_OAUTH_DCR_ENABLED: env.REMOTE_MCP_WORDPRESS_STAGING_DCR_ENABLED,
  REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true",
};

const clients = new Map();
const codes = new Map();
const grantsById = new Map();
const grantsByAccessJti = new Map();
const grantsByRefreshHash = new Map();

function result(affectedRows = 0) {
  return [{ affectedRows }, []];
}

const pool = {
  async query(sqlValue, params = []) {
    const sql = String(sqlValue);
    if (sql.includes("INSERT INTO remote_mcp_oauth_clients")) {
      clients.set(params[0], {
        client_id: params[0], client_name: params[1], client_profile_key: params[2],
        token_endpoint_auth_method: params[3], client_secret_hash: params[4],
        redirect_uris_json: params[5], allowed_scopes_json: params[6],
        registration_access_token_hash: params[7], status: "active", expires_at: null,
      });
      return result(1);
    }
    if (sql.includes("FROM remote_mcp_oauth_clients")) {
      return [[[clients.get(params[0])].filter(Boolean)[0]].filter(Boolean), []];
    }
    if (sql.includes("FROM users")) return [[{ user_id: params[0], status: "active" }], []];
    if (sql.includes("FROM memberships m") && sql.includes("JOIN tenants")) return [[{ tenant_id: params[1] }], []];
    if (sql.includes("INSERT INTO remote_mcp_oauth_authorization_codes")) {
      codes.set(params[0], {
        code_hash: params[0], client_id: params[1], user_id: params[2], tenant_id: params[3],
        redirect_uri: params[4], resource: params[5], scopes_json: params[6],
        code_challenge: params[7], code_challenge_method: "S256", status: "issued", expires_at: params[8],
      });
      return result(1);
    }
    if (sql.includes("FROM remote_mcp_oauth_authorization_codes")) {
      const row = codes.get(params[0]);
      const ok = row && row.client_id === params[1] && row.redirect_uri === params[2] && row.status === "issued";
      return [[ok ? row : null].filter(Boolean), []];
    }
    if (sql.includes("UPDATE remote_mcp_oauth_authorization_codes")) {
      const row = codes.get(params[0]);
      const ok = row && row.client_id === params[1] && row.redirect_uri === params[2] && row.status === "issued";
      if (ok) row.status = "consumed";
      return result(ok ? 1 : 0);
    }
    if (sql.includes("INSERT INTO remote_mcp_oauth_grants")) {
      const row = {
        grant_id: params[0], access_jti: params[1], refresh_token_hash: params[2], client_id: params[3],
        user_id: params[4], tenant_id: params[5], resource: params[6], scopes_json: params[7], status: "active",
        access_expires_at: params[8], refresh_expires_at: params[9], replaced_by_grant_id: null,
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
      beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    };
  },
};

assert.equal(wordpressStagingMcpOAuthConfigured(env), true);
assert.equal(wordpressStagingMcpOAuthReady(env), true);
assert.equal(wordpressStagingMcpDcrAdvertised(env), true);
assert.equal(env.REMOTE_MCP_OAUTH_DCR_ENABLED, "false", "primary DCR must remain disabled");
const profileStatus = getWordpressStagingMcpOAuthStatus(env);
assert.equal(profileStatus.resource, env.REMOTE_MCP_WORDPRESS_STAGING_RESOURCE_URL);
assert.equal(profileStatus.issuer, `${env.REMOTE_MCP_AUTHORIZATION_SERVER_URL}/wordpress-staging`);
assert.equal(profileStatus.resource_scope, WORDPRESS_STAGING_MCP_SCOPE);
assert.deepEqual(profileStatus.authorization_scopes, WORDPRESS_STAGING_MCP_AUTHORIZATION_SCOPES);
assert.equal(profileStatus.refresh_token_supported, true);
assert.equal(profileStatus.access_token_alg, "RS256");
assert.equal(profileStatus.subject_authorization_required, true);
assert.equal(profileStatus.subject_authorization_configured, true);
assert.equal(profileStatus.allowed_subject_count, 1);
assert.equal(profileStatus.secrets_included, false);
assert.equal(wordpressStagingMcpOAuthConfigured({ ...env, REMOTE_MCP_ENVIRONMENT: "production" }), false);
assert.equal(wordpressStagingMcpOAuthReady({ ...env, REMOTE_MCP_WORDPRESS_RS256_PRIVATE_KEY_B64: "" }), false);
assert.equal(wordpressStagingMcpOAuthReady({ ...env, REMOTE_MCP_WORDPRESS_STAGING_ALLOWED_SUBJECTS: "" }), false);

const app = express();
app.use(express.json());
app.use(buildWordpressStagingMcpOAuthRoutes({ env: routeEnv, pool }));
const server = await new Promise((resolve) => {
  const started = app.listen(0, () => resolve(started));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const hostHeaders = { "x-original-host": "dev.example.test" };

async function json(response) {
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

try {
  const wrongHost = await fetch(`${baseUrl}/.well-known/oauth-authorization-server/auth/mcp/wordpress-staging`);
  assert.equal(wrongHost.status, 404);

  const metadataResponse = await fetch(`${baseUrl}/.well-known/oauth-authorization-server/auth/mcp/wordpress-staging`, { headers: hostHeaders });
  const metadata = await json(metadataResponse);
  assert.equal(metadataResponse.status, 200);
  assert.equal(metadata.issuer, `${env.REMOTE_MCP_AUTHORIZATION_SERVER_URL}/wordpress-staging`);
  assert.equal(metadata.registration_endpoint, `${metadata.issuer}/oauth/register`);
  assert.equal(metadata.jwks_uri, `${metadata.issuer}/oauth/jwks`);
  assert.deepEqual(metadata.scopes_supported, WORDPRESS_STAGING_MCP_AUTHORIZATION_SCOPES);
  assert.deepEqual(metadata.grant_types_supported, ["authorization_code", "refresh_token"]);
  assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
  assert.equal(metadata["x-mad4b-resource-profile"].subject_authorization_required, true);
  assert.equal(metadata["x-mad4b-resource-profile"].mutation_authority, false);

  const jwksResponse = await fetch(`${baseUrl}/auth/mcp/wordpress-staging/oauth/jwks`, { headers: hostHeaders });
  const jwks = await json(jwksResponse);
  assert.equal(jwksResponse.status, 200);
  assert.equal(jwks.keys.length, 1);
  assert.equal(jwks.keys[0].kty, "RSA");
  assert.equal(jwks.keys[0].alg, "RS256");
  assert(jwks.keys[0].kid && jwks.keys[0].n && jwks.keys[0].e);
  assert.equal(jwks.keys[0].x5c, undefined);

  const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
  const registerResponse = await fetch(`${baseUrl}/auth/mcp/wordpress-staging/oauth/register`, {
    method: "POST",
    headers: { ...hostHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "ChatGPT WordPress Staging",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: `${WORDPRESS_STAGING_MCP_SCOPE} ${WORDPRESS_STAGING_MCP_OFFLINE_SCOPE}`,
    }),
  });
  const registered = await json(registerResponse);
  assert.equal(registerResponse.status, 201);
  assert.match(registered.client_id, /^mcp_stg_wp_/u);
  assert.equal(isWordpressStagingMcpClientId(registered.client_id, env), true);
  assert.equal(isRemoteMcpClientIdForEnvironment(registered.client_id, env), false, "generic Remote MCP must reject the WordPress client namespace");
  assert.equal(registered.scope, `${WORDPRESS_STAGING_MCP_SCOPE} ${WORDPRESS_STAGING_MCP_OFFLINE_SCOPE}`);
  assert.equal(registered.client_secret, undefined);
  assert.deepEqual(JSON.parse(clients.get(registered.client_id).allowed_scopes_json), WORDPRESS_STAGING_MCP_AUTHORIZATION_SCOPES);
  assert.match(clients.get(registered.client_id).client_profile_key, new RegExp(`^${WORDPRESS_STAGING_MCP_CLIENT_PROFILE_PREFIX}`));

  const invalidScopeRegistration = await fetch(`${baseUrl}/auth/mcp/wordpress-staging/oauth/register`, {
    method: "POST",
    headers: { ...hostHeaders, "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Invalid writer", redirect_uris: [redirectUri], token_endpoint_auth_method: "none", scope: "mad4b:write" }),
  });
  assert.equal(invalidScopeRegistration.status, 400);
  assert.equal((await json(invalidScopeRegistration)).error, "invalid_scope");

  const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  const authorizeUrl = new URL(`${baseUrl}/auth/mcp/wordpress-staging/oauth/authorize`);
  authorizeUrl.searchParams.set("client_id", registered.client_id);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", "state-wp-1");
  authorizeUrl.searchParams.set("scope", `${WORDPRESS_STAGING_MCP_SCOPE} ${WORDPRESS_STAGING_MCP_OFFLINE_SCOPE}`);
  authorizeUrl.searchParams.set("resource", env.REMOTE_MCP_WORDPRESS_STAGING_RESOURCE_URL);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  const authorizeResponse = await fetch(authorizeUrl, { headers: hostHeaders });
  const authorizeHtml = await authorizeResponse.text();
  assert.equal(authorizeResponse.status, 200);
  assert(authorizeHtml.includes("mad4b:read"));
  assert.equal(authorizeHtml.includes("Create account"), false, "dedicated resource consent must not advertise self-registration");
  const requestMatch = authorizeHtml.match(/"authorization_request":"([^"]+)"/u);
  assert(requestMatch?.[1]);

  const unapprovedToken = jwt.sign({ user_id: "user-2", tenant_id: "workspace-1" }, env.JWT_SECRET, { algorithm: "HS256", expiresIn: 3600 });
  const deniedCodeResponse = await fetch(`${baseUrl}/auth/mcp/wordpress-staging/oauth/code`, {
    method: "POST",
    headers: { ...hostHeaders, "content-type": "application/json", authorization: `Bearer ${unapprovedToken}` },
    body: JSON.stringify({ authorization_request: requestMatch[1], consent: true }),
  });
  assert.equal(deniedCodeResponse.status, 403);
  assert.equal((await json(deniedCodeResponse)).error, "access_denied");
  assert.equal(codes.size, 0, "unapproved subjects must not receive authorization codes");

  const userToken = jwt.sign({ user_id: "user-1", tenant_id: "workspace-1" }, env.JWT_SECRET, { algorithm: "HS256", expiresIn: 3600 });
  const codeResponse = await fetch(`${baseUrl}/auth/mcp/wordpress-staging/oauth/code`, {
    method: "POST",
    headers: { ...hostHeaders, "content-type": "application/json", authorization: `Bearer ${userToken}` },
    body: JSON.stringify({ authorization_request: requestMatch[1], consent: true }),
  });
  const codeResult = await json(codeResponse);
  assert.equal(codeResponse.status, 200);

  const wrongResourceResponse = await fetch(`${baseUrl}/auth/mcp/wordpress-staging/oauth/token`, {
    method: "POST",
    headers: { ...hostHeaders, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: registered.client_id, code: codeResult.code, redirect_uri: redirectUri, code_verifier: verifier, resource: "https://staging.example.test/wp-json/mcp/mad4b-write" }),
  });
  assert.equal(wrongResourceResponse.status, 400);
  assert.equal((await json(wrongResourceResponse)).error, "invalid_target");
  assert.equal(codes.get(sha256(codeResult.code)).status, "issued");

  const tokenResponse = await fetch(`${baseUrl}/auth/mcp/wordpress-staging/oauth/token`, {
    method: "POST",
    headers: { ...hostHeaders, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: registered.client_id, code: codeResult.code, redirect_uri: redirectUri, code_verifier: verifier, resource: env.REMOTE_MCP_WORDPRESS_STAGING_RESOURCE_URL }),
  });
  const tokens = await json(tokenResponse);
  assert.equal(tokenResponse.status, 200);
  assert(tokens.refresh_token);
  assert.equal(tokens.scope, `${WORDPRESS_STAGING_MCP_SCOPE} ${WORDPRESS_STAGING_MCP_OFFLINE_SCOPE}`);
  const decoded = jwt.decode(tokens.access_token, { complete: true });
  assert.equal(decoded.header.alg, "RS256");
  assert.equal(decoded.header.kid, jwks.keys[0].kid);
  const publicKey = createPublicKey({ key: jwks.keys[0], format: "jwk" });
  const claims = jwt.verify(tokens.access_token, publicKey, { algorithms: ["RS256"], issuer: metadata.issuer, audience: env.REMOTE_MCP_WORDPRESS_STAGING_RESOURCE_URL });
  assert.equal(claims.resource, env.REMOTE_MCP_WORDPRESS_STAGING_RESOURCE_URL);
  assert.equal(claims.sub, approvedSubject);
  assert.equal(claims.scope, `${WORDPRESS_STAGING_MCP_SCOPE} ${WORDPRESS_STAGING_MCP_OFFLINE_SCOPE}`);
  assert.equal(claims.purpose, "wordpress_staging_mcp_access");
  assert.throws(() => jwt.verify(tokens.access_token, env.REMOTE_MCP_OAUTH_SIGNING_SECRET, { algorithms: ["HS256"] }));

  // Removing the subject from the allowlist invalidates refresh authority even
  // while the durable grant itself is still active.
  routeEnv.REMOTE_MCP_WORDPRESS_STAGING_ALLOWED_SUBJECTS = "tenant:workspace-1:user:user-9";
  const deauthorizedRefresh = await fetch(`${baseUrl}/auth/mcp/wordpress-staging/oauth/token`, {
    method: "POST",
    headers: { ...hostHeaders, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: registered.client_id, refresh_token: tokens.refresh_token }),
  });
  assert.equal(deauthorizedRefresh.status, 400);
  assert.equal((await json(deauthorizedRefresh)).error, "invalid_grant");
  routeEnv.REMOTE_MCP_WORDPRESS_STAGING_ALLOWED_SUBJECTS = approvedSubject;

  // ChatGPT can refresh without having to resend the protected resource. The
  // durable grant itself remains the authoritative resource binding.
  const refreshResponse = await fetch(`${baseUrl}/auth/mcp/wordpress-staging/oauth/token`, {
    method: "POST",
    headers: { ...hostHeaders, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: registered.client_id, refresh_token: tokens.refresh_token }),
  });
  const refreshed = await json(refreshResponse);
  assert.equal(refreshResponse.status, 200);
  assert.notEqual(refreshed.refresh_token, tokens.refresh_token);
  const refreshedClaims = jwt.verify(refreshed.access_token, publicKey, { algorithms: ["RS256"], issuer: metadata.issuer, audience: env.REMOTE_MCP_WORDPRESS_STAGING_RESOURCE_URL });
  assert.equal(refreshedClaims.scope, `${WORDPRESS_STAGING_MCP_SCOPE} ${WORDPRESS_STAGING_MCP_OFFLINE_SCOPE}`);

  const replayResponse = await fetch(`${baseUrl}/auth/mcp/wordpress-staging/oauth/token`, {
    method: "POST",
    headers: { ...hostHeaders, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: registered.client_id, refresh_token: tokens.refresh_token }),
  });
  assert.equal(replayResponse.status, 400);
  assert.equal((await json(replayResponse)).error, "invalid_grant");

  console.log("wordpress-staging-mcp-oauth-federation: PASS");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
