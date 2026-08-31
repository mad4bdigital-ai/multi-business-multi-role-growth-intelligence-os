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
const TENANT_STATUS_SCOPE = TENANT_GPT_SCOPE_LINKS.find((scope) => scope.endsWith("/tenant.status")) || TENANT_GPT_SCOPE_LINKS[0];
const MCP_SCOPE = "workspaces.read";
const MCP_PROTOCOL_VERSION = "2025-06-18";
const artifacts = { tenant: {}, mcp: {} };

function text(value, max = 512) { return String(value || "").trim().slice(0, max); }
function sha256(value) { return createHash("sha256").update(String(value || ""), "utf8").digest("hex"); }
function base64Url(value) { return Buffer.from(value).toString("base64url"); }
function pkcePair() {
  const verifier = base64Url(randomBytes(48));
  return { verifier, challenge: base64Url(createHash("sha256").update(verifier, "utf8").digest()) };
}
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }

function assertStagingBoundary() {
  const deployment = text(process.env.DEPLOYMENT_ENVIRONMENT || process.env.NODE_ENV, 128).toLowerCase();
  if (!deployment.includes("staging")) fail("staging_runtime_required", "Authenticated remote readiness is restricted to Staging runtime.");
  if (text(process.env.REMOTE_MCP_ENVIRONMENT, 64).toLowerCase() !== "staging") fail("staging_mcp_environment_required", "REMOTE_MCP_ENVIRONMENT must be staging.");
  for (const endpoint of [TENANT_BASE, TENANT_RESOURCE, MCP_RESOURCE, MCP_ISSUER]) {
    const host = new URL(endpoint).hostname.toLowerCase();
    if (["auth.mad4b.com", "mcp.mad4b.com", "activation.mad4b.com"].includes(host)) fail("production_host_forbidden", "Production host detected in Staging readiness configuration.");
  }
  for (const key of ["PRODUCTION_MUTATION_AUTHORIZED", "RULESET_MUTATION_AUTHORIZED"]) {
    if (text(process.env[key], 16).toLowerCase() !== "false") fail("production_authority_forbidden", `${key} must remain false.`);
  }
  for (const key of ["REMOTE_MCP_ACCESS_TOKEN", "REMOTE_MCP_REFRESH_TOKEN", "REMOTE_MCP_AUTHORIZATION_CODE"]) {
    if (text(process.env[key], 8192)) fail("runtime_token_persistence_forbidden", `${key} must never be persisted in .env.staging.`);
  }
}

async function fetchBody(url, options = {}, expected = [200]) {
  const response = await fetch(url, { redirect: "manual", ...options });
  const type = response.headers.get("content-type") || "";
  let body = null;
  try { body = type.includes("json") ? await response.json() : await response.text(); } catch { body = null; }
  if (!expected.includes(response.status)) {
    const safeCode = body && typeof body === "object" ? text(body?.error?.code || body?.error || body?.code, 128) : "";
    fail("remote_http_probe_failed", `HTTP ${response.status}${safeCode ? ` (${safeCode})` : ""}: ${new URL(url).pathname}`);
  }
  return { response, body };
}

function form(values) {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null && value !== "") out.set(key, String(value));
  return out;
}

function tenantCallback() {
  const callback = TENANT_GPT_CALLBACK_URLS_TO_ALLOW.find((value) => !String(value).includes("{"));
  if (!callback) fail("tenant_callback_unavailable", "No concrete governed Tenant GPT callback is available.");
  return callback;
}

function ssoSidFromHeader(value) {
  const match = String(value || "").match(/(?:^|,|;)\s*mad4b_tenant_gpt_sso=([^;]+)/iu);
  if (!match) return null;
  try { return text(jwt.decode(decodeURIComponent(match[1]))?.sid, 128) || null; } catch { return null; }
}

function signedMcpRequestFromHtml(html) {
  const match = String(html || "").match(/const request=(\{[\s\S]*?\});const out=/u);
  if (!match) fail("mcp_authorization_request_missing", "Remote MCP authorization page did not expose a signed request.");
  try {
    const value = text(JSON.parse(match[1])?.authorization_request, 8192);
    if (value) return value;
  } catch {}
  fail("mcp_authorization_request_invalid", "Remote MCP authorization request could not be parsed.");
}

async function probePrincipal(pool) {
  const userId = text(process.env.STAGING_READINESS_PROBE_USER_ID, 64);
  const tenantId = text(process.env.STAGING_READINESS_PROBE_TENANT_ID, 64);
  if (!userId || !tenantId) fail("staging_probe_principal_not_configured", "Set STAGING_READINESS_PROBE_USER_ID and STAGING_READINESS_PROBE_TENANT_ID to an existing active Staging membership.");
  const [rows] = await pool.query(
    `SELECT u.user_id, m.tenant_id, u.status AS user_status, m.status AS membership_status, t.status AS tenant_status
       FROM users u JOIN memberships m ON m.user_id=u.user_id JOIN tenants t ON t.tenant_id=m.tenant_id
      WHERE u.user_id=? AND m.tenant_id=? LIMIT 2`,
    [userId, tenantId],
  );
  if (rows.length !== 1 || rows[0].user_status !== "active" || rows[0].membership_status !== "active" || rows[0].tenant_status !== "active") {
    fail("staging_probe_principal_inactive", "Configured Staging readiness principal is missing, ambiguous, or inactive.");
  }
  return { user_id: userId, tenant_id: tenantId };
}

async function issueProbeJwt(principal) {
  const backendKey = text(process.env.BACKEND_API_KEY, 8192);
  if (!backendKey) fail("backend_api_key_missing", "BACKEND_API_KEY is required for the bounded probe JWT.");
  const { body } = await fetchBody(`${TENANT_BASE}/auth/platform-jwt/issue`, {
    method: "POST",
    headers: { authorization: `Bearer ${backendKey}`, "content-type": "application/json" },
    body: JSON.stringify({ user_id: principal.user_id, tenant_id: principal.tenant_id, resource: TENANT_RESOURCE, ttl_seconds: 300, reason: "staging_authenticated_remote_readiness_probe" }),
  });
  const token = text(body?.access_token, 8192);
  if (!body?.ok || !token) fail("probe_user_jwt_issue_failed", "Staging platform JWT endpoint did not issue the probe JWT.");
  return token;
}

async function tenantOAuthRead(principal, userJwt) {
  const clientId = text(process.env.TENANT_GPT_STAGING_OAUTH_CLIENT_ID, 191);
  const clientSecret = text(process.env.TENANT_GPT_STAGING_OAUTH_CLIENT_SECRET, 8192);
  if (!clientId || !clientSecret) fail("tenant_oauth_client_missing", "Staging Tenant GPT OAuth client ID/secret are required.");
  artifacts.tenant.client_id = clientId;
  const redirectUri = tenantCallback();
  const state = `stg-tenant-${randomUUID()}`;
  const pkce = pkcePair();
  const authorize = new URL(`${TENANT_BASE}/auth/oauth/authorize`);
  for (const [key, value] of Object.entries({ client_id: clientId, response_type: "code", redirect_uri: redirectUri, state, scope: TENANT_STATUS_SCOPE, resource: TENANT_RESOURCE, code_challenge: pkce.challenge, code_challenge_method: "S256", prompt: "login" })) authorize.searchParams.set(key, value);
  await fetchBody(authorize, {}, [200]);

  const codeResult = await fetchBody(`${TENANT_BASE}/auth/oauth/code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: userJwt, redirect_uri: redirectUri, state, scope: TENANT_STATUS_SCOPE, oauth_client_id: clientId, oauth_resource: TENANT_RESOURCE, code_challenge: pkce.challenge, code_challenge_method: "S256" }),
  });
  artifacts.tenant.sso_sid = ssoSidFromHeader(codeResult.response.headers.get("set-cookie"));
  const code = text(codeResult.body?.code, 8192);
  const codeClaims = jwt.decode(code) || {};
  artifacts.tenant.code_jti = text(codeClaims.jti, 128) || null;
  if (!code || !artifacts.tenant.code_jti || codeClaims.user_id !== principal.user_id || codeClaims.tenant_id !== principal.tenant_id) fail("tenant_oauth_code_subject_mismatch", "Tenant OAuth code is missing or not bound to the configured probe principal.");

  const tokenResult = await fetchBody(`${TENANT_BASE}/auth/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: pkce.verifier, resource: TENANT_RESOURCE, client_id: clientId, client_secret: clientSecret }),
  });
  artifacts.tenant.token_request_id = text(tokenResult.response.headers.get("x-request-id"), 128) || null;
  const accessToken = text(tokenResult.body?.access_token, 8192);
  const accessClaims = jwt.decode(accessToken) || {};
  artifacts.tenant.access_jti = text(accessClaims.jti, 128) || null;
  if (!accessToken || !artifacts.tenant.access_jti || accessClaims.user_id !== principal.user_id || accessClaims.tenant_id !== principal.tenant_id) fail("tenant_oauth_access_subject_mismatch", "Tenant OAuth bearer is missing or has the wrong subject.");

  const { body: status } = await fetchBody(`${TENANT_BASE}/connect/status`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!status?.ok || status?.tenant?.tenant_id !== principal.tenant_id) fail("tenant_authenticated_read_failed", "Tenant OAuth bearer could not complete GET /connect/status.");
  return { tenant_oauth_ready: true, tenant_authenticated_action_ready: true };
}

async function remoteMcpOAuthRead(pool, principal, userJwt) {
  const clientId = text(process.env.REMOTE_MCP_APP_ID, 191);
  const clientSecret = text(process.env.REMOTE_MCP_APP_SECRET, 8192);
  if (!clientId || !clientSecret) fail("mcp_app_credentials_missing", "Canonical REMOTE_MCP_APP_ID/REMOTE_MCP_APP_SECRET are required.");
  artifacts.mcp.client_id = clientId;
  const client = await readRemoteMcpOAuthClient(clientId, { pool });
  if (!client) fail("mcp_app_not_provisioned", "Canonical Staging MCP App is not provisioned; run One-Click with -ProvisionMcpApp.");
  if (!client.allowed_scopes.includes(MCP_SCOPE)) fail("mcp_scope_not_provisioned", `Canonical MCP App does not allow ${MCP_SCOPE}.`);
  const redirectUri = client.redirect_uris.find((uri) => /^https:\/\/chatgpt\.com\//iu.test(uri)) || client.redirect_uris[0];
  if (!redirectUri) fail("mcp_redirect_not_provisioned", "Canonical MCP App has no registered redirect URI.");

  const state = `stg-mcp-${randomUUID()}`;
  const pkce = pkcePair();
  const authorize = new URL(`${MCP_ISSUER}/oauth/authorize`);
  for (const [key, value] of Object.entries({ client_id: clientId, response_type: "code", redirect_uri: redirectUri, state, resource: MCP_RESOURCE, scope: MCP_SCOPE, code_challenge: pkce.challenge, code_challenge_method: "S256" })) authorize.searchParams.set(key, value);
  const authorizeResult = await fetchBody(authorize, {}, [200]);
  const authorizationRequest = signedMcpRequestFromHtml(authorizeResult.body);

  const codeResult = await fetchBody(`${MCP_ISSUER}/oauth/code`, {
    method: "POST",
    headers: { authorization: `Bearer ${userJwt}`, "content-type": "application/json" },
    body: JSON.stringify({ authorization_request: authorizationRequest, consent: true }),
  });
  const code = text(codeResult.body?.code, 8192);
  if (!code) fail("mcp_oauth_code_missing", "Remote MCP OAuth code endpoint did not issue a code.");
  artifacts.mcp.code_hash = sha256(code);

  const basic = Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`, "utf8").toString("base64");
  const tokenResult = await fetchBody(`${MCP_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
    body: form({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: pkce.verifier, resource: MCP_RESOURCE }),
  });
  const accessToken = text(tokenResult.body?.access_token, 8192);
  const refreshToken = text(tokenResult.body?.refresh_token, 8192);
  const accessClaims = jwt.decode(accessToken) || {};
  artifacts.mcp.access_jti = text(accessClaims.jti, 128) || null;
  if (!accessToken || !refreshToken || !artifacts.mcp.access_jti || accessClaims.user_id !== principal.user_id || accessClaims.tenant_id !== principal.tenant_id) fail("mcp_oauth_access_subject_mismatch", "Remote MCP OAuth tokens are missing or bound to the wrong subject.");

  const { body: read } = await fetchBody(`${MCP_RESOURCE}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json, text/event-stream", "content-type": "application/json", "mcp-protocol-version": MCP_PROTOCOL_VERSION },
    body: JSON.stringify({ jsonrpc: "2.0", id: `staging-readiness-${randomUUID()}`, method: "tools/call", params: { name: "list_accessible_workspaces", arguments: { limit: 1 } } }),
  });
  if (read?.error || read?.result?.isError === true) fail("mcp_authenticated_read_failed", "Remote MCP bearer could not complete list_accessible_workspaces.");

  for (const token of [accessToken, refreshToken]) {
    await fetchBody(`${MCP_ISSUER}/oauth/revoke`, { method: "POST", headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" }, body: form({ token }) });
  }
  return { remote_mcp_oauth_ready: true, remote_mcp_read_ready: true };
}

async function cleanup(pool) {
  const tasks = [];
  if (artifacts.tenant.access_jti) {
    tasks.push(pool.query("DELETE FROM tenant_gpt_activation_contexts WHERE access_jti=?", [artifacts.tenant.access_jti]));
    tasks.push(pool.query("DELETE FROM tenant_gpt_oauth_grants WHERE access_jti=?", [artifacts.tenant.access_jti]));
  }
  if (artifacts.tenant.code_jti) tasks.push(pool.query("DELETE FROM tenant_gpt_oauth_authorization_codes WHERE code_jti_hash=?", [sha256(artifacts.tenant.code_jti)]));
  if (artifacts.tenant.sso_sid) tasks.push(pool.query("DELETE FROM tenant_gpt_sso_sessions WHERE sid=?", [artifacts.tenant.sso_sid]));
  if (artifacts.tenant.token_request_id) tasks.push(pool.query(`DELETE FROM execution_log WHERE JSON_UNQUOTE(JSON_EXTRACT(runtime_evidence_json,'$.request_id'))=? AND action_key IN ('tenant_gpt_oauth_token_exchange','tenant_gpt_oauth_token_exchange_v2')`, [artifacts.tenant.token_request_id]));
  if (artifacts.mcp.code_hash) tasks.push(pool.query("DELETE FROM remote_mcp_oauth_authorization_codes WHERE code_hash=?", [artifacts.mcp.code_hash]));
  if (artifacts.mcp.access_jti) tasks.push(pool.query("DELETE FROM remote_mcp_oauth_grants WHERE access_jti=?", [artifacts.mcp.access_jti]));
  await Promise.all(tasks);
}

async function residueCount(pool) {
  const checks = [];
  if (artifacts.tenant.access_jti) {
    checks.push(["tenant_activation_context", "SELECT COUNT(*) AS n FROM tenant_gpt_activation_contexts WHERE access_jti=?", [artifacts.tenant.access_jti]]);
    checks.push(["tenant_oauth_grant", "SELECT COUNT(*) AS n FROM tenant_gpt_oauth_grants WHERE access_jti=?", [artifacts.tenant.access_jti]]);
  }
  if (artifacts.tenant.code_jti) checks.push(["tenant_oauth_code", "SELECT COUNT(*) AS n FROM tenant_gpt_oauth_authorization_codes WHERE code_jti_hash=?", [sha256(artifacts.tenant.code_jti)]]);
  if (artifacts.tenant.sso_sid) checks.push(["tenant_sso", "SELECT COUNT(*) AS n FROM tenant_gpt_sso_sessions WHERE sid=?", [artifacts.tenant.sso_sid]]);
  if (artifacts.tenant.token_request_id) checks.push(["tenant_oauth_diagnostic", `SELECT COUNT(*) AS n FROM execution_log WHERE JSON_UNQUOTE(JSON_EXTRACT(runtime_evidence_json,'$.request_id'))=? AND action_key IN ('tenant_gpt_oauth_token_exchange','tenant_gpt_oauth_token_exchange_v2')`, [artifacts.tenant.token_request_id]]);
  if (artifacts.mcp.code_hash) checks.push(["mcp_oauth_code", "SELECT COUNT(*) AS n FROM remote_mcp_oauth_authorization_codes WHERE code_hash=?", [artifacts.mcp.code_hash]]);
  if (artifacts.mcp.access_jti) checks.push(["mcp_oauth_grant", "SELECT COUNT(*) AS n FROM remote_mcp_oauth_grants WHERE access_jti=?", [artifacts.mcp.access_jti]]);
  const details = {};
  let total = 0;
  for (const [name, sql, params] of checks) {
    const [rows] = await pool.query(sql, params);
    const count = Number(rows?.[0]?.n || 0);
    details[name] = count;
    total += count;
  }
  return { total, details };
}

const pool = getPool();
let principal = null;
let tenant = null;
let mcp = null;
let failure = null;
let residue = { total: null, details: {} };
try {
  assertStagingBoundary();
  principal = await probePrincipal(pool);
  const userJwt = await issueProbeJwt(principal);
  tenant = await tenantOAuthRead(principal, userJwt);
  mcp = await remoteMcpOAuthRead(pool, principal, userJwt);
} catch (error) {
  failure = { code: text(error?.code || "authenticated_remote_readiness_failed", 128), message: text(error?.message || "Authenticated remote readiness failed.", 320) };
} finally {
  try {
    await cleanup(pool);
    residue = await residueCount(pool);
  } catch (error) {
    failure = failure || { code: "staging_probe_cleanup_failed", message: text(error?.message || "Staging readiness cleanup failed.", 320) };
    residue = { total: null, details: { cleanup_failed: 1 } };
  }
  await pool.end();
}

const ready = !failure && Boolean(principal) && tenant?.tenant_oauth_ready === true && tenant?.tenant_authenticated_action_ready === true && mcp?.remote_mcp_oauth_ready === true && mcp?.remote_mcp_read_ready === true && residue.total === 0;
console.log(JSON.stringify({
  contract: CONTRACT,
  ready,
  probe_principal_active: Boolean(principal),
  tenant_oauth_ready: tenant?.tenant_oauth_ready === true,
  tenant_authenticated_action_ready: tenant?.tenant_authenticated_action_ready === true,
  remote_mcp_oauth_ready: mcp?.remote_mcp_oauth_ready === true,
  remote_mcp_read_ready: mcp?.remote_mcp_read_ready === true,
  probe_residue: residue.total,
  probe_residue_by_surface: residue.details,
  runtime_tokens_persisted_to_env: false,
  production_mutation: false,
  cloudflare_mutation: false,
  provider_mutation: false,
  secrets_included: false,
  ...(failure ? { failure } : {}),
}));
process.exitCode = ready ? 0 : 1;
