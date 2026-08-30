#!/usr/bin/env node
import { createHash, randomBytes, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { getPool } from "../db.js";
import { TENANT_GPT_CALLBACK_URLS_TO_ALLOW, TENANT_GPT_SCOPE_LINKS } from "../tenantGptOAuthPreset.js";
import { readRemoteMcpOAuthClient } from "../remoteMcpOAuthStore.js";

const CONTRACT = "mad4b.staging-authenticated-remote-readiness.v1";
const TENANT_BASE = String(process.env.TENANT_GPT_STAGING_AUTHORIZATION_SERVER_URL || "https://dev.mad4b.com").replace(/\/+$/u, "");
const TENANT_RESOURCE = String(process.env.TENANT_GPT_STAGING_RESOURCE_URL || "https://dev.mad4b.com").replace(/\/+$/u, "");
const MCP_RESOURCE = String(process.env.REMOTE_MCP_RESOURCE_URL || "https://mcp_dev.mad4b.com").replace(/\/+$/u, "");
const MCP_ISSUER = String(process.env.REMOTE_MCP_AUTHORIZATION_SERVER_URL || "https://dev.mad4b.com/auth/mcp").replace(/\/+$/u, "");
const MCP_PROTOCOL_VERSION = "2025-06-18";
const TENANT_STATUS_SCOPE = TENANT_GPT_SCOPE_LINKS.find((scope) => scope.endsWith("/tenant.status")) || TENANT_GPT_SCOPE_LINKS[0];
const MCP_SCOPE = "workspaces.read";

function text(value, max = 512) {
  return String(value || "").trim().slice(0, max);
}

function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function pkcePair() {
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash("sha256").update(verifier, "utf8").digest());
  return { verifier, challenge };
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertStagingBoundary() {
  const deployment = text(process.env.DEPLOYMENT_ENVIRONMENT || process.env.NODE_ENV, 128).toLowerCase();
  const remoteEnvironment = text(process.env.REMOTE_MCP_ENVIRONMENT, 64).toLowerCase();
  if (!deployment.includes("staging")) fail("staging_runtime_required", "Authenticated remote readiness is restricted to Staging runtime.");
  if (remoteEnvironment !== "staging") fail("staging_mcp_environment_required", "REMOTE_MCP_ENVIRONMENT must be staging.");
  const forbiddenHosts = [TENANT_BASE, TENANT_RESOURCE, MCP_RESOURCE, MCP_ISSUER]
    .some((value) => /(^|\.)auth\.mad4b\.com|(^|\.)mcp\.mad4b\.com|(^|\.)activation\.mad4b\.com/iu.test(new URL(value).hostname));
  if (forbiddenHosts) fail("production_host_forbidden", "Production host detected in Staging authenticated readiness configuration.");
  for (const key of ["PRODUCTION_MUTATION_AUTHORIZED", "RULESET_MUTATION_AUTHORIZED"]) {
    if (text(process.env[key], 16).toLowerCase() !== "false") fail("production_authority_forbidden", `${key} must remain false.`);
  }
  for (const key of ["REMOTE_MCP_ACCESS_TOKEN", "REMOTE_MCP_REFRESH_TOKEN", "REMOTE_MCP_AUTHORIZATION_CODE"]) {
    if (text(process.env[key], 8192)) fail("runtime_token_persistence_forbidden", `${key} must not be persisted in Staging environment.`);
  }
}

async function fetchJson(url, options = {}, expected = [200]) {
  const response = await fetch(url, { redirect: "manual", ...options });
  let body = null;
  const type = response.headers.get("content-type") || "";
  try {
    body = type.includes("json") ? await response.json() : await response.text();
  } catch {
    body = null;
  }
  if (!expected.includes(response.status)) {
    const safeCode = body && typeof body === "object"
      ? text(body?.error?.code || body?.error || body?.code, 128)
      : "";
    fail("remote_http_probe_failed", `Remote endpoint returned HTTP ${response.status}${safeCode ? ` (${safeCode})` : ""}: ${new URL(url).pathname}`);
  }
  return { response, body };
}

function form(values) {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") continue;
    out.set(key, String(value));
  }
  return out;
}

function concreteTenantCallback() {
  const callback = TENANT_GPT_CALLBACK_URLS_TO_ALLOW.find((value) => !String(value).includes("{"));
  if (!callback) fail("tenant_callback_unavailable", "A concrete governed Tenant GPT callback URL is required for Staging OAuth E2E.");
  return callback;
}

function parseSsoSid(setCookie) {
  const match = String(setCookie || "").match(/(?:^|,|;)\s*mad4b_tenant_gpt_sso=([^;]+)/iu);
  if (!match) return null;
  try {
    return text(jwt.decode(decodeURIComponent(match[1]))?.sid, 128) || null;
  } catch {
    return null;
  }
}

function parseRemoteMcpAuthorizationRequest(html) {
  const match = String(html || "").match(/const request=(\{[\s\S]*?\});const out=/u);
  if (!match) fail("mcp_authorization_request_missing", "Remote MCP authorization page did not expose its signed authorization request.");
  let parsed;
  try { parsed = JSON.parse(match[1]); }
  catch { fail("mcp_authorization_request_invalid", "Remote MCP authorization request payload was not valid JSON."); }
  const signed = text(parsed?.authorization_request, 8192);
  if (!signed) fail("mcp_authorization_request_missing", "Remote MCP signed authorization request was empty.");
  return signed;
}

async function assertProbePrincipal(pool) {
  const userId = text(process.env.STAGING_READINESS_PROBE_USER_ID, 64);
  const tenantId = text(process.env.STAGING_READINESS_PROBE_TENANT_ID, 64);
  if (!userId || !tenantId) {
    fail("staging_probe_principal_not_configured", "STAGING_READINESS_PROBE_USER_ID and STAGING_READINESS_PROBE_TENANT_ID must identify an existing active Staging membership.");
  }
  const [rows] = await pool.query(
    `SELECT u.user_id, m.tenant_id, u.status AS user_status, m.status AS membership_status, t.status AS tenant_status
       FROM users u
       JOIN memberships m ON m.user_id = u.user_id
       JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE u.user_id = ? AND m.tenant_id = ?
      LIMIT 2`,
    [userId, tenantId],
  );
  if (rows.length !== 1 || rows[0].user_status !== "active" || rows[0].membership_status !== "active" || rows[0].tenant_status !== "active") {
    fail("staging_probe_principal_inactive", "Configured Staging readiness probe principal is missing, ambiguous, or inactive.");
  }
  return { user_id: userId, tenant_id: tenantId };
}

async function issueProbeUserJwt(principal) {
  const backendKey = text(process.env.BACKEND_API_KEY, 8192);
  if (!backendKey) fail("backend_api_key_missing", "BACKEND_API_KEY is required to mint the bounded Staging readiness principal token.");
  const result = await fetchJson(`${TENANT_BASE}/auth/platform-jwt/issue`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${backendKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      user_id: principal.user_id,
      tenant_id: principal.tenant_id,
      resource: TENANT_RESOURCE,
      ttl_seconds: 300,
      reason: "staging_authenticated_remote_readiness_probe",
    }),
  });
  const token = text(result.body?.access_token, 8192);
  if (!result.body?.ok || !token) fail("probe_user_jwt_issue_failed", "Staging platform JWT endpoint did not issue a probe token.");
  return token;
}

async function tenantOAuthRead({ principal, userJwt }) {
  const clientId = text(process.env.TENANT_GPT_STAGING_OAUTH_CLIENT_ID, 191);
  const clientSecret = text(process.env.TENANT_GPT_STAGING_OAUTH_CLIENT_SECRET, 8192);
  if (!clientId || !clientSecret) fail("tenant_oauth_client_missing", "Canonical Staging Tenant GPT OAuth client ID/secret are required.");

  const redirectUri = concreteTenantCallback();
  const state = `stg-tenant-${randomUUID()}`;
  const pkce = pkcePair();
  const authorize = new URL(`${TENANT_BASE}/auth/oauth/authorize`);
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("scope", TENANT_STATUS_SCOPE);
  authorize.searchParams.set("resource", TENANT_RESOURCE);
  authorize.searchParams.set("code_challenge", pkce.challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("prompt", "login");
  await fetchJson(authorize, {}, [200]);

  const codeResponse = await fetchJson(`${TENANT_BASE}/auth/oauth/code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: userJwt,
      redirect_uri: redirectUri,
      state,
      scope: TENANT_STATUS_SCOPE,
      oauth_client_id: clientId,
      oauth_resource: TENANT_RESOURCE,
      code_challenge: pkce.challenge,
      code_challenge_method: "S256",
    }),
  });
  const code = text(codeResponse.body?.code, 8192);
  if (!code) fail("tenant_oauth_code_missing", "Tenant OAuth code endpoint did not issue a code.");
  const codeClaims = jwt.decode(code) || {};
  const codeJti = text(codeClaims.jti, 128);
  if (!codeJti || codeClaims.user_id !== principal.user_id || codeClaims.tenant_id !== principal.tenant_id) {
    fail("tenant_oauth_code_subject_mismatch", "Tenant OAuth code is not bound to the configured Staging probe principal.");
  }
  const ssoSid = parseSsoSid(codeResponse.response.headers.get("set-cookie"));

  const tokenResponse = await fetchJson(`${TENANT_BASE}/auth/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: pkce.verifier,
      resource: TENANT_RESOURCE,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const accessToken = text(tokenResponse.body?.access_token, 8192);
  if (!accessToken) fail("tenant_oauth_access_token_missing", "Tenant OAuth token endpoint did not issue an access token.");
  const accessClaims = jwt.decode(accessToken) || {};
  const accessJti = text(accessClaims.jti, 128);
  if (!accessJti || accessClaims.user_id !== principal.user_id || accessClaims.tenant_id !== principal.tenant_id) {
    fail("tenant_oauth_access_subject_mismatch", "Tenant OAuth access token is not bound to the configured Staging probe principal.");
  }

  const read = await fetchJson(`${TENANT_BASE}/connect/status`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!read.body?.ok || read.body?.tenant?.tenant_id !== principal.tenant_id) {
    fail("tenant_authenticated_read_failed", "Tenant OAuth bearer did not complete the bounded read-only /connect/status action.");
  }

  return {
    client_id: clientId,
    code_jti: codeJti,
    access_jti: accessJti,
    sso_sid: ssoSid,
    token_request_id: text(tokenResponse.response.headers.get("x-request-id"), 128) || null,
    tenant_oauth_ready: true,
    tenant_authenticated_action_ready: true,
  };
}

async function remoteMcpOAuthRead({ pool, principal, userJwt }) {
  const clientId = text(process.env.REMOTE_MCP_APP_ID, 191);
  const clientSecret = text(process.env.REMOTE_MCP_APP_SECRET, 8192);
  if (!clientId || !clientSecret) fail("mcp_app_credentials_missing", "Canonical REMOTE_MCP_APP_ID/REMOTE_MCP_APP_SECRET are required.");
  const client = await readRemoteMcpOAuthClient(clientId, { pool });
  if (!client) fail("mcp_app_not_provisioned", "Canonical Staging MCP App ID is not provisioned in the Runtime DB. Run One-Click with -ProvisionMcpApp.");
  if (!client.allowed_scopes.includes(MCP_SCOPE)) fail("mcp_scope_not_provisioned", `Canonical MCP App does not allow ${MCP_SCOPE}.`);
  const redirectUri = client.redirect_uris.find((uri) => /^https:\/\/chatgpt\.com\//iu.test(uri)) || client.redirect_uris[0];
  if (!redirectUri) fail("mcp_redirect_not_provisioned", "Canonical MCP App has no registered redirect URI.");

  const state = `stg-mcp-${randomUUID()}`;
  const pkce = pkcePair();
  const authorize = new URL(`${MCP_ISSUER}/oauth/authorize`);
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("resource", MCP_RESOURCE);
  authorize.searchParams.set("scope", MCP_SCOPE);
  authorize.searchParams.set("code_challenge", pkce.challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  const authorizeResponse = await fetchJson(authorize, {}, [200]);
  const authorizationRequest = parseRemoteMcpAuthorizationRequest(authorizeResponse.body);

  const codeResponse = await fetchJson(`${MCP_ISSUER}/oauth/code`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${userJwt}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ authorization_request: authorizationRequest, consent: true }),
  });
  const code = text(codeResponse.body?.code, 8192);
  if (!code) fail("mcp_oauth_code_missing", "Remote MCP OAuth code endpoint did not issue a code.");

  const basic = Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`, "utf8").toString("base64");
  const tokenResponse = await fetchJson(`${MCP_ISSUER}/oauth/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: pkce.verifier,
      resource: MCP_RESOURCE,
    }),
  });
  const accessToken = text(tokenResponse.body?.access_token, 8192);
  const refreshToken = text(tokenResponse.body?.refresh_token, 8192);
  if (!accessToken || !refreshToken) fail("mcp_oauth_tokens_missing", "Remote MCP OAuth token endpoint did not issue access and refresh tokens.");
  const accessClaims = jwt.decode(accessToken) || {};
  const accessJti = text(accessClaims.jti, 128);
  if (!accessJti || accessClaims.user_id !== principal.user_id || accessClaims.tenant_id !== principal.tenant_id) {
    fail("mcp_oauth_access_subject_mismatch", "Remote MCP bearer is not bound to the configured Staging probe principal.");
  }

  const mcpRead = await fetchJson(`${MCP_RESOURCE}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `staging-readiness-${randomUUID()}`,
      method: "tools/call",
      params: { name: "list_accessible_workspaces", arguments: { limit: 1 } },
    }),
  });
  if (mcpRead.body?.error || mcpRead.body?.result?.isError === true) {
    fail("mcp_authenticated_read_failed", "Remote MCP OAuth bearer did not complete list_accessible_workspaces successfully.");
  }

  for (const token of [accessToken, refreshToken]) {
    await fetchJson(`${MCP_ISSUER}/oauth/revoke`, {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form({ token }),
    });
  }

  return {
    client_id: clientId,
    code_hash: sha256(code),
    access_jti: accessJti,
    remote_mcp_oauth_ready: true,
    remote_mcp_read_ready: true,
  };
}

async function cleanupProbeResidue(pool, tenant, mcp) {
  const cleanup = [];
  if (tenant?.access_jti) {
    cleanup.push(pool.query("DELETE FROM tenant_gpt_activation_contexts WHERE access_jti = ?", [tenant.access_jti]));
    cleanup.push(pool.query("DELETE FROM tenant_gpt_oauth_grants WHERE access_jti = ?", [tenant.access_jti]));
  }
  if (tenant?.code_jti) {
    cleanup.push(pool.query("DELETE FROM tenant_gpt_oauth_authorization_codes WHERE code_jti_hash = ?", [sha256(tenant.code_jti)]));
  }
  if (tenant?.sso_sid) {
    cleanup.push(pool.query("DELETE FROM tenant_gpt_sso_sessions WHERE sid = ?", [tenant.sso_sid]));
  }
  if (tenant?.token_request_id) {
    cleanup.push(pool.query(
      `DELETE FROM execution_log
        WHERE JSON_UNQUOTE(JSON_EXTRACT(runtime_evidence_json, '$.request_id')) = ?
          AND action_key IN ('tenant_gpt_oauth_token_exchange','tenant_gpt_oauth_token_exchange_v2')`,
      [tenant.token_request_id],
    ));
  }
  if (mcp?.code_hash) cleanup.push(pool.query("DELETE FROM remote_mcp_oauth_authorization_codes WHERE code_hash = ?", [mcp.code_hash]));
  if (mcp?.access_jti) cleanup.push(pool.query("DELETE FROM remote_mcp_oauth_grants WHERE access_jti = ?", [mcp.access_jti]));
  await Promise.all(cleanup);
}

async function countProbeResidue(pool, tenant, mcp) {
  const checks = [];
  if (tenant?.access_jti) {
    checks.push(["tenant_activation_context", "SELECT COUNT(*) AS n FROM tenant_gpt_activation_contexts WHERE access_jti = ?", [tenant.access_jti]]);
    checks.push(["tenant_oauth_grant", "SELECT COUNT(*) AS n FROM tenant_gpt_oauth_grants WHERE access_jti = ?", [tenant.access_jti]]);
  }
  if (tenant?.code_jti) checks.push(["tenant_oauth_code", "SELECT COUNT(*) AS n FROM tenant_gpt_oauth_authorization_codes WHERE code_jti_hash = ?", [sha256(tenant.code_jti)]]);
  if (tenant?.sso_sid) checks.push(["tenant_sso", "SELECT COUNT(*) AS n FROM tenant_gpt_sso_sessions WHERE sid = ?", [tenant.sso_sid]]);
  if (tenant?.token_request_id) {
    checks.push(["tenant_oauth_diagnostic", `SELECT COUNT(*) AS n FROM execution_log WHERE JSON_UNQUOTE(JSON_EXTRACT(runtime_evidence_json, '$.request_id')) = ? AND action_key IN ('tenant_gpt_oauth_token_exchange','tenant_gpt_oauth_token_exchange_v2')`, [tenant.token_request_id]]);
  }
  if (mcp?.code_hash) checks.push(["mcp_oauth_code", "SELECT COUNT(*) AS n FROM remote_mcp_oauth_authorization_codes WHERE code_hash = ?", [mcp.code_hash]]);
  if (mcp?.access_jti) checks.push(["mcp_oauth_grant", "SELECT COUNT(*) AS n FROM remote_mcp_oauth_grants WHERE access_jti = ?", [mcp.access_jti]]);
  let total = 0;
  const details = {};
  for (const [name, sql, params] of checks) {
    const [rows] = await pool.query(sql, params);
    const count = Number(rows?.[0]?.n || 0);
    details[name] = count;
    total += count;
  }
  return { total, details };
}

const pool = getPool();
let tenant = null;
let mcp = null;
let principal = null;
let failure = null;
let residue = { total: null, details: {} };
try {
  assertStagingBoundary();
  principal = await assertProbePrincipal(pool);
  const userJwt = await issueProbeUserJwt(principal);
  tenant = await tenantOAuthRead({ principal, userJwt });
  mcp = await remoteMcpOAuthRead({ pool, principal, userJwt });
} catch (error) {
  failure = { code: text(error?.code || "authenticated_remote_readiness_failed", 128), message: text(error?.message || "Authenticated remote readiness failed.", 320) };
} finally {
  try {
    await cleanupProbeResidue(pool, tenant, mcp);
    residue = await countProbeResidue(pool, tenant, mcp);
  } catch (cleanupError) {
    failure = failure || { code: "staging_probe_cleanup_failed", message: text(cleanupError?.message || "Staging probe cleanup failed.", 320) };
    residue = { total: null, details: { cleanup_failed: 1 } };
  }
  await pool.end();
}

const ready = !failure
  && principal
  && tenant?.tenant_oauth_ready === true
  && tenant?.tenant_authenticated_action_ready === true
  && mcp?.remote_mcp_oauth_ready === true
  && mcp?.remote_mcp_read_ready === true
  && residue.total === 0;

const output = {
  contract: CONTRACT,
  ready: Boolean(ready),
  probe_principal_active: Boolean(principal),
  tenant_oauth_ready: tenant?.tenant_oauth_ready === true,
  tenant_authenticated_action_ready: tenant?.tenant_authenticated_action_ready === true,
  remote_mcp_oauth_ready: mcp?.remote_mcp_oauth_ready === true,
  remote_mcp_read_ready: mcp?.remote_mcp_read_ready === true,
  probe_residue: residue.total,
  probe_residue_by_surface: residue.details,
  runtime_tokens_persisted_to_env: false,
  production_mutation: false,
  provider_mutation: false,
  cloudflare_mutation: false,
  secrets_included: false,
  ...(failure ? { failure } : {}),
};
console.log(JSON.stringify(output));
process.exitCode = ready ? 0 : 1;
