#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import jwt from "jsonwebtoken";
import { getPool } from "../db.js";
import { resolveTenantGptOAuthClientConfig } from "../tenantGptOAuthClientConfig.js";
import {
  TENANT_GPT_CALLBACK_URLS_TO_ALLOW,
  TENANT_GPT_OAUTH_CLIENT_ID,
  TENANT_GPT_SCOPE,
} from "../tenantGptOAuthPreset.js";

export const LIVE_SMOKE_CONFIRMATION = "RUN_TENANT_GPT_OAUTH_LIVE_SMOKE";
const PRODUCTION_ORIGIN = "https://auth.mad4b.com";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseArgs(argv = []) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = String(argv[index] || "");
    if (!value.startsWith("--")) continue;
    const separator = value.indexOf("=");
    if (separator > 2) {
      result[value.slice(2, separator).replaceAll("-", "_")] = value.slice(separator + 1);
      continue;
    }
    const key = value.slice(2).replaceAll("-", "_");
    const next = argv[index + 1];
    if (next !== undefined && !String(next).startsWith("--")) {
      result[key] = String(next);
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

function requireUuid(name, value) {
  const normalized = String(value || "").trim();
  if (!UUID_RE.test(normalized)) throw fail(`invalid_${name}`, `${name} must be a UUID.`);
  return normalized;
}

function normalizeOrigin(value, allowNonProductionOrigin = false) {
  let origin;
  try {
    origin = new URL(String(value || PRODUCTION_ORIGIN)).origin;
  } catch {
    throw fail("invalid_base_url", "base_url must be an absolute URL.");
  }
  if (!allowNonProductionOrigin && origin !== PRODUCTION_ORIGIN) {
    throw fail("production_base_url_required", `Live smoke is restricted to ${PRODUCTION_ORIGIN}.`);
  }
  return origin;
}

function normalizeCallback(value) {
  const fallback = TENANT_GPT_CALLBACK_URLS_TO_ALLOW.find((url) => url.includes("chatgpt.com/aip/g-")) || TENANT_GPT_CALLBACK_URLS_TO_ALLOW[0];
  let callback;
  try {
    callback = new URL(String(value || fallback));
  } catch {
    throw fail("invalid_callback_url", "callback_url must be absolute.");
  }
  if (callback.protocol !== "https:" || !["chatgpt.com", "chat.openai.com"].includes(callback.hostname)) {
    throw fail("invalid_callback_url", "callback_url must use an approved ChatGPT HTTPS host.");
  }
  if (!/^\/aip\/g-[a-z0-9]+\/oauth\/callback$/i.test(callback.pathname)) {
    throw fail("invalid_callback_url", "callback_url must match the ChatGPT AIP OAuth callback shape.");
  }
  return callback.toString();
}

function errorCode(payload) {
  if (typeof payload?.error === "string") return payload.error;
  if (typeof payload?.error?.code === "string") return payload.error.code;
  return null;
}

async function json(response, stage, allowFailure = false) {
  const payload = await response.json().catch(() => null);
  if (!allowFailure && !response.ok) {
    throw fail(`${stage}_failed`, `${stage} failed with HTTP ${response.status} (${errorCode(payload) || "unknown"}).`);
  }
  return payload;
}

function assertSafeOutput(result) {
  const serialized = JSON.stringify(result);
  for (const forbiddenKey of ["access_token", "client_secret", "authorization_code", "raw_token"]) {
    if (serialized.includes(`\"${forbiddenKey}\"`)) {
      throw fail("sensitive_output_detected", "Smoke output attempted to include sensitive material.");
    }
  }
}

export async function runTenantGptOAuthLiveSmoke(options = {}, dependencies = {}) {
  if (String(options.confirm || "") !== LIVE_SMOKE_CONFIRMATION) {
    throw fail("live_smoke_confirmation_required", `confirm=${LIVE_SMOKE_CONFIRMATION} is required.`);
  }

  const userId = requireUuid("user_id", options.user_id);
  const tenantId = requireUuid("tenant_id", options.tenant_id);
  const origin = normalizeOrigin(options.base_url, dependencies.allowNonProductionOrigin === true);
  const callbackUrl = normalizeCallback(options.callback_url);
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const environment = dependencies.env || process.env;
  const backendApiKey = String(environment.BACKEND_API_KEY || "").trim();
  const jwtSecret = String(dependencies.jwtSecret || environment.JWT_SECRET || "").trim();
  const pool = (dependencies.getPoolImpl || getPool)();
  const resolveClientConfig = dependencies.resolveClientConfig || resolveTenantGptOAuthClientConfig;

  if (typeof fetchImpl !== "function") throw fail("fetch_unavailable", "fetch is unavailable.");
  if (!backendApiKey) throw fail("backend_api_key_unavailable", "BACKEND_API_KEY is unavailable.");
  if (!jwtSecret) throw fail("jwt_secret_unavailable", "JWT_SECRET is unavailable.");

  const resolvedClient = await resolveClientConfig();
  const clientId = String(resolvedClient?.config?.client_id || TENANT_GPT_OAUTH_CLIENT_ID).trim();
  const clientSecret = String(resolvedClient?.config?.client_secret || "").trim();
  if (!resolvedClient?.ok || !clientSecret) throw fail("oauth_client_secret_unavailable", "Governed OAuth client secret resolution failed.");

  const state = randomUUID();
  const authorizeUrl = new URL(`${origin}/auth/oauth/authorize`);
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("scope", TENANT_GPT_SCOPE);
  authorizeUrl.searchParams.set("screen_hint", "signin");

  let accessJti = null;
  let codeJti = null;
  let result = null;
  const cleanup = { attempted: false, deleted_rows: 0, passed: true };

  try {
    const authorizeResponse = await fetchImpl(authorizeUrl, { method: "GET", redirect: "manual" });
    const authorizeHtml = await authorizeResponse.text();
    if (!authorizeResponse.ok) throw fail("authorize_failed", `authorize returned HTTP ${authorizeResponse.status}.`);
    const absoluteLinksPresent = [
      'href="https://auth.mad4b.com/connect"',
      'href="https://auth.mad4b.com/privacy-policy"',
      'href="https://auth.mad4b.com/terms-of-use"',
    ].every((needle) => authorizeHtml.includes(needle));
    const relativeSetupLinkAbsent = !authorizeHtml.includes('href="/connect"');
    if (!absoluteLinksPresent || !relativeSetupLinkAbsent) throw fail("authorize_link_contract_failed", "Authorize link contract failed.");

    const issueResponse = await fetchImpl(`${origin}/auth/platform-jwt/issue`, {
      method: "POST",
      headers: { authorization: `Bearer ${backendApiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ user_id: userId, tenant_id: tenantId, ttl_seconds: 600, reason: "tenant_gpt_oauth_live_smoke" }),
    });
    const issued = await json(issueResponse, "platform_jwt_issue");
    const userToken = String(issued?.access_token || issued?.token || "");
    if (!userToken) throw fail("platform_jwt_missing", "Platform JWT issue returned no token.");

    const codeResponse = await fetchImpl(`${origin}/auth/oauth/code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: userToken,
        redirect_uri: callbackUrl,
        state,
        scope: TENANT_GPT_SCOPE,
        activation_context: { purpose: "tenant_activation", workspace_name: "Tenant GPT OAuth live smoke", screen_hint: "signin" },
      }),
    });
    const codePayload = await json(codeResponse, "oauth_code_issue");
    const authorizationCode = String(codePayload?.code || "");
    if (!authorizationCode) throw fail("oauth_code_missing", "OAuth code issue returned no code.");
    const decodedCode = jwt.decode(authorizationCode);
    codeJti = typeof decodedCode === "object" && decodedCode ? decodedCode.jti || null : null;
    const redirectedState = new URL(String(codePayload?.redirect_to || callbackUrl)).searchParams.get("state");
    if (redirectedState !== state) throw fail("oauth_state_mismatch", "OAuth state was not preserved.");

    const tokenForm = new URLSearchParams({
      grant_type: "authorization_code",
      code: authorizationCode,
      redirect_uri: callbackUrl,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString();
    const tokenResponse = await fetchImpl(`${origin}/auth/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: tokenForm,
    });
    const tokenPayload = await json(tokenResponse, "oauth_token_exchange");
    const accessToken = String(tokenPayload?.access_token || "");
    if (!accessToken || tokenPayload?.token_type !== "bearer") throw fail("oauth_token_contract_failed", "OAuth token response contract failed.");

    let accessPayload;
    try {
      accessPayload = jwt.verify(accessToken, jwtSecret, {
        issuer: environment.PLATFORM_JWT_ISSUER || PRODUCTION_ORIGIN,
        audience: environment.TENANT_GPT_JWT_AUDIENCE || "mad4b-tenant-gpt",
      });
    } catch {
      throw fail("oauth_access_token_verification_failed", "OAuth access token verification failed.");
    }
    accessJti = accessPayload?.jti || null;
    if (accessPayload?.user_id !== userId || accessPayload?.tenant_id !== tenantId) {
      throw fail("oauth_tenant_binding_failed", "Access token user or tenant binding failed.");
    }

    const replayResponse = await fetchImpl(`${origin}/auth/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: tokenForm,
    });
    const replayPayload = await json(replayResponse, "oauth_code_replay", true);
    const replayPassed = replayResponse.status === 400 && errorCode(replayPayload) === "invalid_grant";
    if (!replayPassed) throw fail("oauth_replay_protection_failed", "OAuth code replay was not rejected as invalid_grant.");

    result = {
      ok: true,
      authorize: { status: authorizeResponse.status, absolute_links_present: absoluteLinksPresent, relative_setup_link_absent: relativeSetupLinkAbsent },
      code_issue: { status: codeResponse.status, state_preserved: true, code_jti_present: Boolean(codeJti) },
      token_exchange: {
        status: tokenResponse.status,
        token_type: tokenPayload.token_type,
        cache_control_no_store: String(tokenResponse.headers?.get?.("cache-control") || "").toLowerCase().includes("no-store"),
        issuer_matches: accessPayload?.iss === (environment.PLATFORM_JWT_ISSUER || PRODUCTION_ORIGIN),
        audience_matches: accessPayload?.aud === (environment.TENANT_GPT_JWT_AUDIENCE || "mad4b-tenant-gpt"),
        user_id_matches: true,
        tenant_id_matches: true,
        access_jti_present: Boolean(accessJti),
      },
      replay_protection: { status: replayResponse.status, error: errorCode(replayPayload), passed: replayPassed },
      cleanup,
      secrets_included: false,
    };
  } finally {
    if (accessJti || codeJti) {
      cleanup.attempted = true;
      cleanup.passed = false;
      try {
        const [deleted] = await pool.query(
          "DELETE FROM `tenant_gpt_activation_contexts` WHERE access_jti = ? OR oauth_code_jti = ?",
          [accessJti || "", codeJti || ""],
        );
        cleanup.deleted_rows = Number(deleted?.affectedRows || 0);
        cleanup.passed = true;
      } catch {
        cleanup.passed = false;
      }
    }
  }

  if (!cleanup.passed) throw fail("oauth_smoke_cleanup_failed", "Transient activation-context cleanup failed.");
  assertSafeOutput(result);
  return result;
}

async function main() {
  try {
    const result = await runTenantGptOAuthLiveSmoke(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code: error?.code || "tenant_gpt_oauth_live_smoke_failed", message: error?.message || "Live smoke failed." }, secrets_included: false }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
