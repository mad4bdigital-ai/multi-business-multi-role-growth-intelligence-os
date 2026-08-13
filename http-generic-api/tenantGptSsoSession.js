import jwt from "jsonwebtoken";

export const TENANT_GPT_SSO_SESSION_COOKIE = "mad4b_tenant_gpt_sso";
export const TENANT_GPT_SSO_SESSION_DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;
export const TENANT_GPT_SSO_SESSION_MAX_TTL_SECONDS = 30 * 24 * 60 * 60;
export const TENANT_GPT_SSO_SESSION_MIN_TTL_SECONDS = 5 * 60;
export const TENANT_GPT_SSO_SESSION_PURPOSE = "tenant_gpt_sso_session";

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
  if (secret.length < 16) throw sessionError("tenant_gpt_sso_session_secret_invalid", "A signing secret is required for the Tenant GPT SSO session.");
  return secret;
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
} = {}) {
  const userId = text(user_id, 64);
  const tenantId = text(tenant_id, 64);
  const clientId = text(client_id, 191);
  if (!userId || !tenantId || !clientId) throw sessionError("tenant_gpt_sso_session_claims_invalid", "Tenant GPT SSO session requires user_id, tenant_id, and client_id.");
  const ttl = ttlSeconds === undefined ? TENANT_GPT_SSO_SESSION_DEFAULT_TTL_SECONDS : validateTenantGptSsoSessionTtlSeconds(ttlSeconds);
  const issuedAt = finiteInteger(nowSeconds) ?? Math.floor(Date.now() / 1000);
  return jwt.sign({
    purpose: TENANT_GPT_SSO_SESSION_PURPOSE,
    version: 1,
    user_id: userId,
    tenant_id: tenantId,
    email: text(email, 255) || null,
    client_id: clientId,
    scopes: normalizeScopes(scopes),
    iat: issuedAt,
  }, requireSecret(jwtSecret), { expiresIn: ttl });
}

export function verifyTenantGptSsoSession(value, {
  jwtSecret,
  expectedClientId,
  nowSeconds,
} = {}) {
  const token = text(value, 8192);
  if (!token) return { ok: false, code: "session_missing" };
  try {
    const claims = jwt.verify(token, requireSecret(jwtSecret), {
      clockTimestamp: finiteInteger(nowSeconds) ?? undefined,
    });
    if (claims?.purpose !== TENANT_GPT_SSO_SESSION_PURPOSE || claims?.version !== 1) return { ok: false, code: "session_purpose_invalid" };
    const userId = text(claims.user_id, 64);
    const tenantId = text(claims.tenant_id, 64);
    const clientId = text(claims.client_id, 191);
    if (!userId || !tenantId || !clientId) return { ok: false, code: "session_claims_invalid" };
    if (expectedClientId && clientId !== text(expectedClientId, 191)) return { ok: false, code: "session_client_mismatch" };
    return {
      ok: true,
      claims: {
        ...claims,
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

export function buildTenantGptSsoCookieHeader(token, { ttlSeconds } = {}) {
  const ttl = ttlSeconds === undefined ? TENANT_GPT_SSO_SESSION_DEFAULT_TTL_SECONDS : validateTenantGptSsoSessionTtlSeconds(ttlSeconds);
  return `${TENANT_GPT_SSO_SESSION_COOKIE}=${encodeURIComponent(String(token || ""))}; Max-Age=${ttl}; Domain=.mad4b.com; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function buildTenantGptSsoClearCookieHeader() {
  return `${TENANT_GPT_SSO_SESSION_COOKIE}=; Max-Age=0; Domain=.mad4b.com; Path=/; HttpOnly; Secure; SameSite=Lax`;
}
