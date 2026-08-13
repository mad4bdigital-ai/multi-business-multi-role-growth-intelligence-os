import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

export const TENANT_GPT_SSO_SESSION_COOKIE = "mad4b_tenant_gpt_sso";
export const TENANT_GPT_SSO_SESSION_DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;
export const TENANT_GPT_SSO_SESSION_MAX_TTL_SECONDS = 30 * 24 * 60 * 60;
export const TENANT_GPT_SSO_SESSION_MIN_TTL_SECONDS = 5 * 60;
export const TENANT_GPT_SSO_SESSION_DEFAULT_IDLE_TTL_SECONDS = 8 * 60 * 60;
export const TENANT_GPT_SSO_SESSION_MAX_IDLE_TTL_SECONDS = TENANT_GPT_SSO_SESSION_MAX_TTL_SECONDS;
export const TENANT_GPT_SSO_SESSION_PURPOSE = "tenant_gpt_sso_session";
export const TENANT_GPT_SSO_COOKIE_MODE_SHARED = "shared_domain";
export const TENANT_GPT_SSO_COOKIE_MODE_HOST_ONLY = "host_only";

function resolveCookiePolicy(env = process.env) {
  const mode = String(env?.TENANT_GPT_SSO_COOKIE_MODE || TENANT_GPT_SSO_COOKIE_MODE_SHARED).trim().toLowerCase();
  if (![TENANT_GPT_SSO_COOKIE_MODE_SHARED, TENANT_GPT_SSO_COOKIE_MODE_HOST_ONLY].includes(mode)) throw sessionError("tenant_gpt_sso_cookie_mode_invalid", "Unsupported Tenant GPT SSO cookie mode.");
  if (mode === TENANT_GPT_SSO_COOKIE_MODE_SHARED && String(env?.TENANT_GPT_SSO_TRUST_BOUNDARY_ATTESTED || "").trim().toLowerCase() !== "true") {
    throw sessionError("tenant_gpt_sso_cookie_trust_boundary_unattested", "Shared-domain SSO cookie requires an explicit trusted-subdomain boundary attestation.");
  }
  return { mode, domain: mode === TENANT_GPT_SSO_COOKIE_MODE_SHARED ? ".mad4b.com" : null };
}

function sessionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function finiteInteger(value) {
  const normalized = Number(value);
  return Number.isInteger(normalized) ? normalized : null;
}

export function validateTenantGptSsoSessionTtlSeconds(value) {
  const ttlSeconds = finiteInteger(value);
  if (
    ttlSeconds === null
    || ttlSeconds < TENANT_GPT_SSO_SESSION_MIN_TTL_SECONDS
    || ttlSeconds > TENANT_GPT_SSO_SESSION_MAX_TTL_SECONDS
  ) {
    throw sessionError(
      "tenant_gpt_sso_session_ttl_invalid",
      `Tenant GPT SSO session TTL must be an integer between ${TENANT_GPT_SSO_SESSION_MIN_TTL_SECONDS} and ${TENANT_GPT_SSO_SESSION_MAX_TTL_SECONDS}.`,
    );
  }
  return ttlSeconds;
}

export function validateTenantGptSsoSessionIdleTtlSeconds(value) {
  const ttlSeconds = finiteInteger(value);
  if (ttlSeconds === null || ttlSeconds < TENANT_GPT_SSO_SESSION_MIN_TTL_SECONDS || ttlSeconds > TENANT_GPT_SSO_SESSION_MAX_IDLE_TTL_SECONDS) {
    throw sessionError("tenant_gpt_sso_session_idle_ttl_invalid", `Tenant GPT SSO idle TTL must be an integer between ${TENANT_GPT_SSO_SESSION_MIN_TTL_SECONDS} and ${TENANT_GPT_SSO_SESSION_MAX_IDLE_TTL_SECONDS}.`);
  }
  return ttlSeconds;
}

export function resolveTenantGptSsoSessionIdleTtlSeconds(env = process.env) {
  const configured = String(env?.TENANT_GPT_SSO_SESSION_IDLE_TTL_SECONDS || "").trim();
  if (!configured) return TENANT_GPT_SSO_SESSION_DEFAULT_IDLE_TTL_SECONDS;
  return validateTenantGptSsoSessionIdleTtlSeconds(configured);
}

export function resolveTenantGptSsoSessionTtlSeconds(env = process.env) {
  const configured = String(env?.TENANT_GPT_SSO_SESSION_TTL_SECONDS || "").trim();
  if (!configured) return TENANT_GPT_SSO_SESSION_DEFAULT_TTL_SECONDS;
  return validateTenantGptSsoSessionTtlSeconds(configured);
}

function text(value, max = 128) {
  return String(value || "").trim().slice(0, max);
}

function normalizeScopes(value) {
  const scopes = Array.isArray(value) ? value : String(value || "").split(/\s+/u);
  return [...new Set(scopes.map((scope) => text(scope, 256)).filter(Boolean))].sort();
}

function requireSecret(jwtSecret) {
  const secret = String(jwtSecret || "");
  if (secret.length < 32) throw sessionError("tenant_gpt_sso_session_secret_invalid", "A signing secret with at least 32 characters is required for the Tenant GPT SSO session.");
  return secret;
}

function sessionId(value) {
  const sid = text(value, 128);
  return sid && /^[A-Za-z0-9_-]{16,128}$/u.test(sid) ? sid : "";
}

export function issueTenantGptSsoSession({
  user_id,
  tenant_id,
  email = null,
  client_id,
  scopes = [],
  jwtSecret,
  ttlSeconds,
  nowSeconds,
  sid,
  idleTtlSeconds,
} = {}) {
  const userId = text(user_id, 64);
  const tenantId = text(tenant_id, 64);
  const clientId = text(client_id, 191);
  const resolvedSid = sessionId(sid) || randomUUID();
  if (!userId || !tenantId || !clientId || !resolvedSid) throw sessionError("tenant_gpt_sso_session_claims_invalid", "Tenant GPT SSO session requires user_id, tenant_id, client_id, and sid.");
  const ttl = ttlSeconds === undefined ? TENANT_GPT_SSO_SESSION_DEFAULT_TTL_SECONDS : validateTenantGptSsoSessionTtlSeconds(ttlSeconds);
  const issuedAt = finiteInteger(nowSeconds) ?? Math.floor(Date.now() / 1000);
  const idleTtl = idleTtlSeconds === undefined ? TENANT_GPT_SSO_SESSION_DEFAULT_IDLE_TTL_SECONDS : validateTenantGptSsoSessionIdleTtlSeconds(idleTtlSeconds);
  return jwt.sign({
    purpose: TENANT_GPT_SSO_SESSION_PURPOSE,
    version: 1,
    sid: resolvedSid,
    user_id: userId,
    tenant_id: tenantId,
    email: text(email, 255) || null,
    client_id: clientId,
    scopes: normalizeScopes(scopes),
    idle_expires_at: issuedAt + idleTtl,
    iat: issuedAt,
  }, requireSecret(jwtSecret), { expiresIn: ttl });
}

export function verifyTenantGptSsoSession(value, {
  jwtSecret,
  expectedClientId,
  nowSeconds,
  revokedSessionIds,
} = {}) {
  const token = text(value, 8192);
  if (!token) return { ok: false, code: "session_missing" };
  try {
    const claims = jwt.verify(token, requireSecret(jwtSecret), {
      clockTimestamp: finiteInteger(nowSeconds) ?? undefined,
    });
    if (claims?.purpose !== TENANT_GPT_SSO_SESSION_PURPOSE || claims?.version !== 1) return { ok: false, code: "session_purpose_invalid" };
    const now = finiteInteger(nowSeconds) ?? Math.floor(Date.now() / 1000);
    if (!Number.isInteger(Number(claims.idle_expires_at)) || now >= Number(claims.idle_expires_at)) return { ok: false, code: "session_idle_expired" };
    const userId = text(claims.user_id, 64);
    const tenantId = text(claims.tenant_id, 64);
    const clientId = text(claims.client_id, 191);
    const sid = sessionId(claims.sid);
    if (!userId || !tenantId || !clientId || !sid) return { ok: false, code: "session_claims_invalid" };
    if (expectedClientId && clientId !== text(expectedClientId, 191)) return { ok: false, code: "session_client_mismatch" };
    const revoked = revokedSessionIds instanceof Set
      ? revokedSessionIds.has(sid)
      : Array.isArray(revokedSessionIds) && revokedSessionIds.includes(sid);
    if (revoked) return { ok: false, code: "session_revoked" };
    return {
      ok: true,
      claims: {
        ...claims,
        sid,
        user_id: userId,
        tenant_id: tenantId,
        client_id: clientId,
        scopes: normalizeScopes(claims.scopes),
      },
    };
  } catch (error) {
    return { ok: false, code: error?.name === "TokenExpiredError" ? "session_expired" : "session_invalid" };
  }
}

export async function persistTenantGptSsoSession({ pool = getPool(), claims, expiresAt } = {}) {
  const sid = sessionId(claims?.sid);
  if (!sid || !claims?.user_id || !claims?.tenant_id || !claims?.client_id) throw sessionError("tenant_gpt_sso_session_claims_invalid", "Persistent Tenant GPT SSO session claims are incomplete.");
  await pool.query(
    `INSERT INTO tenant_gpt_sso_sessions
      (sid, user_id, tenant_id, client_id, scopes_json, status, issued_at, expires_at)
     VALUES (?, ?, ?, ?, ?, 'active', FROM_UNIXTIME(?), ?)
     ON DUPLICATE KEY UPDATE status = 'active', expires_at = VALUES(expires_at), scopes_json = VALUES(scopes_json)`,
    [sid, claims.user_id, claims.tenant_id, claims.client_id, JSON.stringify(normalizeScopes(claims.scopes)), Number(claims.iat || Math.floor(Date.now() / 1000)), expiresAt || new Date(Number(claims.exp || 0) * 1000)],
  );
  return { ok: true, sid };
}

export async function isTenantGptSsoSessionActive({ pool = getPool(), sid } = {}) {
  const normalizedSid = sessionId(sid);
  if (!normalizedSid) return { ok: false, active: false, code: "session_sid_invalid" };
  try {
    const [rows] = await pool.query(
      `SELECT sid FROM tenant_gpt_sso_sessions WHERE sid = ? AND status = 'active' AND expires_at > NOW() LIMIT 1`,
      [normalizedSid],
    );
    return { ok: true, active: Boolean(rows?.[0]?.sid), sid: normalizedSid };
  } catch {
    return { ok: false, active: false, code: "session_revocation_store_unavailable", sid: normalizedSid };
  }
}

export async function revokeTenantGptSsoSessionBySid({ pool = getPool(), sid } = {}) {
  const normalizedSid = sessionId(sid);
  if (!normalizedSid) return false;
  const [result] = await pool.query(
    `UPDATE tenant_gpt_sso_sessions SET status = 'revoked', revoked_at = NOW() WHERE sid = ? AND status = 'active'`,
    [normalizedSid],
  );
  return Number(result?.affectedRows || 0) > 0;
}

export async function revokeTenantGptSsoSessionsForUser({ pool = getPool(), userId } = {}) {
  const normalizedUserId = text(userId, 64);
  if (!normalizedUserId) return 0;
  const [result] = await pool.query(
    `UPDATE tenant_gpt_sso_sessions SET status = 'revoked', revoked_at = NOW() WHERE user_id = ? AND status = 'active'`,
    [normalizedUserId],
  );
  return Number(result?.affectedRows || 0);
}

export function parseTenantGptSsoCookie(cookieHeader) {
  const cookies = String(cookieHeader || "").split(";");
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;
    const name = cookie.slice(0, separator).trim();
    if (name !== TENANT_GPT_SSO_SESSION_COOKIE) continue;
    return decodeURIComponent(cookie.slice(separator + 1).trim());
  }
  return "";
}

export function buildTenantGptSsoCookieHeader(token, { ttlSeconds, env = process.env } = {}) {
  const ttl = ttlSeconds === undefined ? TENANT_GPT_SSO_SESSION_DEFAULT_TTL_SECONDS : validateTenantGptSsoSessionTtlSeconds(ttlSeconds);
  const policy = resolveCookiePolicy(env);
  const domain = policy.domain ? ` Domain=${policy.domain};` : "";
  return `${TENANT_GPT_SSO_SESSION_COOKIE}=${encodeURIComponent(String(token || ""))}; Max-Age=${ttl};${domain} Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function buildTenantGptSsoClearCookieHeader({ env = process.env } = {}) {
  const policy = resolveCookiePolicy(env);
  const domain = policy.domain ? ` Domain=${policy.domain};` : "";
  return `${TENANT_GPT_SSO_SESSION_COOKIE}=; Max-Age=0;${domain} Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export { sessionId };
