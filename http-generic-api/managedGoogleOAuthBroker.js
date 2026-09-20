import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";

export const MANAGED_GOOGLE_SESSION_CONTRACT = "mad4b.google-managed-oauth-session.v1";
export const MANAGED_GOOGLE_REDEEM_REQUEST_CONTRACT = "mad4b.google-managed-oauth-redeem-request.v1";
export const MANAGED_GOOGLE_REDEMPTION_CONTRACT = "mad4b.google-managed-oauth-redemption.v1";
export const MANAGED_GOOGLE_REFRESH_REQUEST_CONTRACT = "mad4b.google-managed-oauth-refresh-request.v1";
export const MANAGED_GOOGLE_REFRESH_CONTRACT = "mad4b.google-managed-oauth-refresh.v1";

export const GOOGLE_DRIVE_READ_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const GOOGLE_DRIVE_WRITE_SCOPE = "https://www.googleapis.com/auth/drive";

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DEFAULT_SESSION_TTL_SECONDS = 10 * 60;
const DEFAULT_HANDOFF_TTL_SECONDS = 5 * 60;
const MAX_SESSION_TTL_SECONDS = 10 * 60;
const SESSION_RATE_LIMIT_PER_MINUTE = 20;
const REDEEM_RATE_LIMIT_PER_MINUTE = 40;
const REFRESH_RATE_LIMIT_PER_MINUTE = 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_SHA256_RE = /^[A-Za-z0-9_-]{43}$/;

function brokerError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function sha256Hex(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function sha256Base64url(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("base64url");
}

function secureToken(bytes = 32, randomBytesImpl = randomBytes) {
  return randomBytesImpl(bytes).toString("base64url");
}

function cleanText(value, maxLength = 512) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function boundedPositiveInt(value, fallback, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function normalizeOrigin(value) {
  const raw = cleanText(value, 1024);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return "";
    const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    return `${url.origin}${pathname}`;
  } catch {
    return "";
  }
}

function normalizeCallbackUrl(value) {
  const raw = cleanText(value, 2048);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function exactAccessContract(accessMode, requestedScope) {
  const mode = cleanText(accessMode, 32).toLowerCase();
  const scope = cleanText(requestedScope, 512);
  if (mode === "read_only" && scope === GOOGLE_DRIVE_READ_SCOPE) return { access_mode: mode, requested_scope: scope };
  if (mode === "read_write" && scope === GOOGLE_DRIVE_WRITE_SCOPE) return { access_mode: mode, requested_scope: scope };
  throw brokerError(400, "managed_google_oauth_scope_contract_invalid", "Requested Google Drive scope does not exactly match the requested managed access mode.");
}

function normalizeSiteBinding(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const siteUuid = cleanText(raw.site_uuid, 64);
  const origin = normalizeOrigin(raw.origin);
  const callbackUri = normalizeCallbackUrl(raw.callback_uri);
  const status = cleanText(raw.status || "active", 32).toLowerCase();
  if (!UUID_RE.test(siteUuid) || !origin || !callbackUri || status !== "active") return null;
  const callback = new URL(callbackUri);
  const originUrl = new URL(origin);
  if (callback.origin !== originUrl.origin) return null;
  return Object.freeze({
    site_uuid: siteUuid,
    origin,
    callback_uri: callbackUri,
    environment: cleanText(raw.environment || "", 32).toLowerCase(),
    status: "active",
  });
}

export function parseManagedGoogleSiteBindings(env = process.env) {
  const raw = String(env.MANAGED_GOOGLE_OAUTH_SITE_BINDINGS_JSON || "").trim();
  if (!raw) throw brokerError(503, "managed_google_oauth_site_bindings_missing", "Managed Google OAuth site bindings are not configured.");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw brokerError(503, "managed_google_oauth_site_bindings_invalid", "Managed Google OAuth site bindings are invalid JSON.");
  }
  if (!Array.isArray(parsed) || !parsed.length) {
    throw brokerError(503, "managed_google_oauth_site_bindings_invalid", "Managed Google OAuth site bindings must contain at least one active binding.");
  }
  const bindings = parsed.map(normalizeSiteBinding).filter(Boolean);
  if (!bindings.length) {
    throw brokerError(503, "managed_google_oauth_site_bindings_invalid", "Managed Google OAuth site bindings contain no valid active binding.");
  }
  const seen = new Set();
  for (const binding of bindings) {
    const key = `${binding.site_uuid}|\0${binding.origin}|\0${binding.callback_uri}`;
    if (seen.has(key)) throw brokerError(503, "managed_google_oauth_site_binding_duplicate", "Managed Google OAuth site bindings contain duplicate exact bindings.");
    seen.add(key);
  }
  return bindings;
}

function resolveExactSiteBinding(env, { site_uuid, origin, callback_uri }) {
  const siteUuid = cleanText(site_uuid, 64);
  const canonicalOrigin = normalizeOrigin(origin);
  const callbackUri = normalizeCallbackUrl(callback_uri);
  if (!UUID_RE.test(siteUuid) || !canonicalOrigin || !callbackUri) {
    throw brokerError(400, "managed_google_oauth_site_binding_invalid", "Managed Google OAuth site binding is malformed.");
  }
  const binding = parseManagedGoogleSiteBindings(env).find((entry) =>
    entry.site_uuid === siteUuid &&
    entry.origin === canonicalOrigin &&
    entry.callback_uri === callbackUri
  );
  if (!binding) throw brokerError(403, "managed_google_oauth_site_binding_not_allowed", "Managed Google OAuth site binding is not authorized.");
  return binding;
}

function resolveSiteOriginBinding(env, { site_uuid, origin }) {
  const siteUuid = cleanText(site_uuid, 64);
  const canonicalOrigin = normalizeOrigin(origin);
  if (!UUID_RE.test(siteUuid) || !canonicalOrigin) {
    throw brokerError(400, "managed_google_oauth_site_binding_invalid", "Managed Google OAuth site binding is malformed.");
  }
  const binding = parseManagedGoogleSiteBindings(env).find((entry) =>
    entry.site_uuid === siteUuid && entry.origin === canonicalOrigin
  );
  if (!binding) throw brokerError(403, "managed_google_oauth_site_binding_not_allowed", "Managed Google OAuth site binding is not authorized.");
  return binding;
}

function managedConfig(env = process.env) {
  const clientId = cleanText(env.MANAGED_GOOGLE_OAUTH_CLIENT_ID, 1024);
  const clientSecret = String(env.MANAGED_GOOGLE_OAUTH_CLIENT_SECRET || "").trim();
  const encryptionKey = String(env.MANAGED_GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY || "").trim();
  const redirectUri = normalizeCallbackUrl(env.MANAGED_GOOGLE_OAUTH_REDIRECT_URI);
  if (!clientId || !clientSecret || encryptionKey.length < 32 || !redirectUri) {
    throw brokerError(503, "managed_google_oauth_configuration_incomplete", "Managed Google OAuth broker credentials, encryption key, or redirect URI are not fully configured.");
  }
  const redirect = new URL(redirectUri);
  if (!redirect.pathname.endsWith("/v1/google/oauth/callback")) {
    throw brokerError(503, "managed_google_oauth_redirect_uri_invalid", "Managed Google OAuth redirect URI must target the broker callback path.");
  }
  return Object.freeze({
    client_id: clientId,
    client_secret: clientSecret,
    encryption_key: encryptionKey,
    redirect_uri: redirectUri,
    session_ttl_seconds: boundedPositiveInt(env.MANAGED_GOOGLE_OAUTH_SESSION_TTL_SECONDS, DEFAULT_SESSION_TTL_SECONDS, MAX_SESSION_TTL_SECONDS),
    handoff_ttl_seconds: boundedPositiveInt(env.MANAGED_GOOGLE_OAUTH_HANDOFF_TTL_SECONDS, DEFAULT_HANDOFF_TTL_SECONDS, DEFAULT_SESSION_TTL_SECONDS),
  });
}

function encryptionKey(secret) {
  return createHash("sha256").update(String(secret), "utf8").digest();
}

export function sealManagedGoogleEnvelope(value, secret, randomBytesImpl = randomBytes) {
  const iv = randomBytesImpl(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    alg: "A256GCM",
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    ct: ciphertext.toString("base64url"),
  });
}

export function openManagedGoogleEnvelope(envelope, secret) {
  let parsed;
  try {
    parsed = JSON.parse(String(envelope || ""));
  } catch {
    throw brokerError(500, "managed_google_oauth_envelope_invalid", "Managed Google OAuth encrypted envelope is invalid.");
  }
  if (parsed?.v !== 1 || parsed?.alg !== "A256GCM" || !parsed.iv || !parsed.tag || !parsed.ct) {
    throw brokerError(500, "managed_google_oauth_envelope_invalid", "Managed Google OAuth encrypted envelope is malformed.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(parsed.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(parsed.tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(parsed.ct, "base64url")),
      decipher.final(),
    ]);
    const value = JSON.parse(plaintext.toString("utf8"));
    if (!value || typeof value !== "object") throw new Error("invalid_payload");
    return value;
  } catch {
    throw brokerError(500, "managed_google_oauth_envelope_decrypt_failed", "Managed Google OAuth encrypted envelope cannot be decrypted.");
  }
}

async function parseGoogleTokenResponse(response, failureCode) {
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok || !data || typeof data !== "object") {
    const providerCode = cleanText(data?.error || data?.error_description || "", 96);
    throw brokerError(response.status >= 400 && response.status < 500 ? 400 : 502, failureCode, providerCode ? `Google OAuth token endpoint rejected the request (${providerCode}).` : "Google OAuth token endpoint returned a non-success response.");
  }
  return data;
}

function addRedirectParams(callbackUri, params) {
  const url = new URL(callbackUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function safeProviderError(value) {
  const code = cleanText(value, 64).toLowerCase().replace(/[^a-z0-9_.-]/g, "_");
  return code || "access_denied";
}

function sameTimeOrFuture(value, nowDate) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) && ms > nowDate.getTime();
}

export function buildManagedGoogleAuthorizationUrl({ config, brokerState, requestedScope }) {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", config.client_id);
  url.searchParams.set("redirect_uri", config.redirect_uri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", requestedScope);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", brokerState);
  return url.toString();
}

export class SqlManagedGoogleOAuthStore {
  constructor(pool) {
    if (!pool || typeof pool.query !== "function" || typeof pool.getConnection !== "function") {
      throw brokerError(500, "managed_google_oauth_store_invalid", "Managed Google OAuth SQL store requires a MariaDB pool.");
    }
    this.pool = pool;
  }

  async countRecentEvents(siteUuid, event, windowSeconds, nowDate) {
    const threshold = new Date(nowDate.getTime() - windowSeconds * 1000);
    const [rows] = await this.pool.query(
      `SELECT COUNT(*) AS count
         FROM managed_google_oauth_audit
        WHERE site_uuid=? AND event=? AND created_at>=?`,
      [siteUuid, event, threshold]
    );
    return Number(rows?.[0]?.count || 0);
  }

  async appendAudit({ event, site_uuid, session_id = null, outcome, reason = null, origin = null, metadata = null, now }) {
    await this.pool.query(
      `INSERT INTO managed_google_oauth_audit
        (audit_id,event,site_uuid,session_id,outcome,reason,origin_sha256,metadata_json,created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        randomUUID(),
        cleanText(event, 64),
        cleanText(site_uuid, 64),
        session_id ? cleanText(session_id, 64) : null,
        cleanText(outcome, 32),
        reason ? cleanText(reason, 96) : null,
        origin ? sha256Hex(origin) : null,
        metadata ? JSON.stringify(metadata) : null,
        now,
      ]
    );
  }

  async createSession(record) {
    await this.pool.query(
      `INSERT INTO managed_google_oauth_sessions
        (session_id,site_uuid,origin,callback_uri,access_mode,requested_scope,client_state_envelope,broker_state_hash,verifier_challenge,status,expires_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?,?)`,
      [
        record.session_id,
        record.site_uuid,
        record.origin,
        record.callback_uri,
        record.access_mode,
        record.requested_scope,
        record.client_state_envelope,
        record.broker_state_hash,
        record.verifier_challenge,
        record.expires_at,
        record.created_at,
        record.created_at,
      ]
    );
  }

  async findSessionByBrokerStateHash(hash) {
    const [rows] = await this.pool.query(
      `SELECT * FROM managed_google_oauth_sessions WHERE broker_state_hash=? LIMIT 1`,
      [hash]
    );
    return rows?.[0] || null;
  }

  async markDenied({ session_id, reason, now }) {
    const [result] = await this.pool.query(
      `UPDATE managed_google_oauth_sessions
          SET status='denied', denied_reason=?, denied_at=?, updated_at=?
        WHERE session_id=? AND status='pending'`,
      [cleanText(reason, 96), now, now, session_id]
    );
    return Number(result?.affectedRows || 0) === 1;
  }

  async authorizeSession({ session_id, handoff_hash, token_envelope, token_expires_in, handoff_expires_at, now }) {
    const [result] = await this.pool.query(
      `UPDATE managed_google_oauth_sessions
          SET status='authorized', handoff_hash=?, token_envelope=?, token_expires_in=?, handoff_expires_at=?, authorized_at=?, updated_at=?
        WHERE session_id=? AND status='pending' AND expires_at>?`,
      [handoff_hash, token_envelope, token_expires_in, handoff_expires_at, now, now, session_id, now]
    );
    return Number(result?.affectedRows || 0) === 1;
  }

  async consumeAuthorizedSession({
    session_id,
    handoff_hash,
    site_uuid,
    origin,
    callback_uri,
    verifier_challenge,
    now,
  }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT * FROM managed_google_oauth_sessions WHERE session_id=? LIMIT 1 FOR UPDATE`,
        [session_id]
      );
      const row = rows?.[0] || null;
      if (!row) throw brokerError(404, "managed_google_oauth_session_not_found", "Managed Google OAuth session was not found.");
      if (row.status !== "authorized") throw brokerError(409, row.status === "redeemed" ? "managed_google_oauth_handoff_replayed" : "managed_google_oauth_session_not_redeemable", "Managed Google OAuth session is not redeemable.");
      if (!sameTimeOrFuture(row.handoff_expires_at, now)) throw brokerError(410, "managed_google_oauth_handoff_expired", "Managed Google OAuth handoff has expired.");
      if (row.handoff_hash !== handoff_hash) throw brokerError(403, "managed_google_oauth_handoff_invalid", "Managed Google OAuth handoff code is invalid.");
      if (row.site_uuid !== site_uuid || row.origin !== origin || row.callback_uri !== callback_uri) {
        throw brokerError(403, "managed_google_oauth_binding_mismatch", "Managed Google OAuth redemption binding does not match the authorized session.");
      }
      if (row.verifier_challenge !== verifier_challenge) throw brokerError(403, "managed_google_oauth_verifier_mismatch", "Managed Google OAuth verifier does not match the session challenge.");
      const snapshot = { ...row };
      const [result] = await connection.query(
        `UPDATE managed_google_oauth_sessions
            SET status='redeemed', token_envelope=NULL, redeemed_at=?, updated_at=?
          WHERE session_id=? AND status='authorized'`,
        [now, now, session_id]
      );
      if (Number(result?.affectedRows || 0) !== 1) throw brokerError(409, "managed_google_oauth_handoff_replayed", "Managed Google OAuth handoff was already consumed.");
      await connection.commit();
      return snapshot;
    } catch (error) {
      try { await connection.rollback(); } catch {}
      throw error;
    } finally {
      connection.release();
    }
  }
}

async function enforceRateLimit(store, { siteUuid, event, limit, nowDate }) {
  if (!store || typeof store.countRecentEvents !== "function") return;
  const count = await store.countRecentEvents(siteUuid, event, 60, nowDate);
  if (count >= limit) throw brokerError(429, "managed_google_oauth_rate_limited", "Managed Google OAuth request rate limit exceeded.");
}

export function createManagedGoogleOAuthBroker({
  env = process.env,
  store,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  randomBytesImpl = randomBytes,
  randomUuidImpl = randomUUID,
} = {}) {
  if (!store) throw brokerError(500, "managed_google_oauth_store_missing", "Managed Google OAuth broker store is required.");
  if (typeof fetchImpl !== "function") throw brokerError(500, "managed_google_oauth_fetch_unavailable", "Managed Google OAuth broker requires fetch.");

  async function createSession(input = {}) {
    const config = managedConfig(env);
    if (cleanText(input.contract, 128) !== MANAGED_GOOGLE_SESSION_CONTRACT) {
      throw brokerError(400, "managed_google_oauth_session_contract_invalid", "Managed Google OAuth session contract is invalid.");
    }
    const binding = resolveExactSiteBinding(env, input);
    const access = exactAccessContract(input.access_mode, input.requested_scope);
    const clientState = cleanText(input.state, 256);
    const verifierChallenge = cleanText(input.verifier_challenge, 128);
    if (clientState.length < 32 || !BASE64URL_SHA256_RE.test(verifierChallenge) || cleanText(input.verifier_method, 16) !== "S256") {
      throw brokerError(400, "managed_google_oauth_session_proof_invalid", "Managed Google OAuth state or verifier challenge is invalid.");
    }

    const nowDate = now();
    await enforceRateLimit(store, { siteUuid: binding.site_uuid, event: "session_create", limit: SESSION_RATE_LIMIT_PER_MINUTE, nowDate });
    const sessionId = randomUuidImpl();
    const brokerState = secureToken(32, randomBytesImpl);
    const record = {
      session_id: sessionId,
      site_uuid: binding.site_uuid,
      origin: binding.origin,
      callback_uri: binding.callback_uri,
      access_mode: access.access_mode,
      requested_scope: access.requested_scope,
      client_state_envelope: sealManagedGoogleEnvelope({ state: clientState }, config.encryption_key, randomBytesImpl),
      broker_state_hash: sha256Hex(brokerState),
      verifier_challenge: verifierChallenge,
      expires_at: new Date(nowDate.getTime() + config.session_ttl_seconds * 1000),
      created_at: nowDate,
    };
    await store.createSession(record);
    await store.appendAudit?.({
      event: "session_create",
      site_uuid: binding.site_uuid,
      session_id: sessionId,
      outcome: "success",
      origin: binding.origin,
      metadata: { access_mode: access.access_mode, scope_sha256_prefix: sha256Hex(access.requested_scope).slice(0, 12) },
      now: nowDate,
    });
    return {
      contract: MANAGED_GOOGLE_SESSION_CONTRACT,
      session_id: sessionId,
      authorization_url: buildManagedGoogleAuthorizationUrl({ config, brokerState, requestedScope: access.requested_scope }),
    };
  }

  async function handleGoogleCallback({ code, state, error: providerError } = {}) {
    const config = managedConfig(env);
    const brokerState = cleanText(state, 512);
    if (!brokerState) throw brokerError(400, "managed_google_oauth_callback_state_missing", "Managed Google OAuth callback state is missing.");
    const session = await store.findSessionByBrokerStateHash(sha256Hex(brokerState));
    if (!session) throw brokerError(400, "managed_google_oauth_callback_state_invalid", "Managed Google OAuth callback state is invalid.");
    const nowDate = now();
    if (session.status !== "pending") throw brokerError(409, "managed_google_oauth_callback_session_closed", "Managed Google OAuth callback session is no longer pending.");
    if (!sameTimeOrFuture(session.expires_at, nowDate)) throw brokerError(410, "managed_google_oauth_session_expired", "Managed Google OAuth authorization session has expired.");
    resolveExactSiteBinding(env, {
      site_uuid: session.site_uuid,
      origin: session.origin,
      callback_uri: session.callback_uri,
    });
    const clientState = openManagedGoogleEnvelope(session.client_state_envelope, config.encryption_key).state;
    if (providerError) {
      const reason = safeProviderError(providerError);
      await store.markDenied({ session_id: session.session_id, reason, now: nowDate });
      await store.appendAudit?.({ event: "google_callback", site_uuid: session.site_uuid, session_id: session.session_id, outcome: "denied", reason, origin: session.origin, now: nowDate });
      return { redirect_url: addRedirectParams(session.callback_uri, { error: reason, state: clientState }) };
    }
    const authorizationCode = cleanText(code, 4096);
    if (!authorizationCode) throw brokerError(400, "managed_google_oauth_code_missing", "Google OAuth authorization code is missing.");

    const body = new URLSearchParams({
      client_id: config.client_id,
      client_secret: config.client_secret,
      code: authorizationCode,
      grant_type: "authorization_code",
      redirect_uri: config.redirect_uri,
    });
    const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: body.toString(),
      redirect: "manual",
    });
    const tokens = await parseGoogleTokenResponse(response, "managed_google_oauth_code_exchange_failed");
    const accessToken = cleanText(tokens.access_token, 8192);
    const refreshToken = cleanText(tokens.refresh_token, 8192);
    const grantedScope = cleanText(tokens.scope, 512);
    if (!accessToken || !refreshToken) throw brokerError(502, "managed_google_oauth_token_missing", "Google OAuth token exchange did not return both access and refresh tokens.");
    exactAccessContract(session.access_mode, grantedScope);
    const expiresIn = boundedPositiveInt(tokens.expires_in, 3600, 24 * 60 * 60);
    const handoffCode = secureToken(32, randomBytesImpl);
    const tokenEnvelope = sealManagedGoogleEnvelope({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
      scope: grantedScope,
    }, config.encryption_key, randomBytesImpl);
    const authorized = await store.authorizeSession({
      session_id: session.session_id,
      handoff_hash: sha256Hex(handoffCode),
      token_envelope: tokenEnvelope,
      token_expires_in: expiresIn,
      handoff_expires_at: new Date(nowDate.getTime() + config.handoff_ttl_seconds * 1000),
      now: nowDate,
    });
    if (!authorized) throw brokerError(409, "managed_google_oauth_callback_race", "Managed Google OAuth session changed before authorization could be finalized.");
    await store.appendAudit?.({
      event: "google_callback",
      site_uuid: session.site_uuid,
      session_id: session.session_id,
      outcome: "authorized",
      origin: session.origin,
      metadata: { scope_sha256_prefix: sha256Hex(grantedScope).slice(0, 12) },
      now: nowDate,
    });
    return { redirect_url: addRedirectParams(session.callback_uri, { handoff_code: handoffCode, state: clientState }) };
  }

  async function redeem(input = {}) {
    const config = managedConfig(env);
    if (cleanText(input.contract, 128) !== MANAGED_GOOGLE_REDEEM_REQUEST_CONTRACT) {
      throw brokerError(400, "managed_google_oauth_redeem_contract_invalid", "Managed Google OAuth redemption request contract is invalid.");
    }
    const binding = resolveExactSiteBinding(env, input);
    const sessionId = cleanText(input.session_id, 64);
    const handoffCode = cleanText(input.handoff_code, 4096);
    const verifier = cleanText(input.verifier, 256);
    if (!sessionId || !handoffCode || verifier.length < 43 || verifier.length > 128) {
      throw brokerError(400, "managed_google_oauth_redeem_input_invalid", "Managed Google OAuth redemption input is invalid.");
    }
    const nowDate = now();
    await enforceRateLimit(store, { siteUuid: binding.site_uuid, event: "redeem", limit: REDEEM_RATE_LIMIT_PER_MINUTE, nowDate });
    const row = await store.consumeAuthorizedSession({
      session_id: sessionId,
      handoff_hash: sha256Hex(handoffCode),
      site_uuid: binding.site_uuid,
      origin: binding.origin,
      callback_uri: binding.callback_uri,
      verifier_challenge: sha256Base64url(verifier),
      now: nowDate,
    });
    const tokens = openManagedGoogleEnvelope(row.token_envelope, config.encryption_key);
    exactAccessContract(row.access_mode, tokens.scope);
    await store.appendAudit?.({ event: "redeem", site_uuid: binding.site_uuid, session_id: sessionId, outcome: "success", origin: binding.origin, now: nowDate });
    return {
      contract: MANAGED_GOOGLE_REDEMPTION_CONTRACT,
      access_token: String(tokens.access_token || ""),
      refresh_token: String(tokens.refresh_token || ""),
      expires_in: boundedPositiveInt(tokens.expires_in, Number(row.token_expires_in) || 3600, 24 * 60 * 60),
      scope: String(tokens.scope || ""),
    };
  }

  async function refresh(input = {}) {
    const config = managedConfig(env);
    if (cleanText(input.contract, 128) !== MANAGED_GOOGLE_REFRESH_REQUEST_CONTRACT) {
      throw brokerError(400, "managed_google_oauth_refresh_contract_invalid", "Managed Google OAuth refresh request contract is invalid.");
    }
    const binding = resolveSiteOriginBinding(env, input);
    const access = exactAccessContract(input.access_mode, input.requested_scope);
    const refreshToken = cleanText(input.refresh_token, 8192);
    if (!refreshToken) throw brokerError(400, "managed_google_oauth_refresh_token_missing", "Managed Google OAuth refresh token is missing.");
    const nowDate = now();
    await enforceRateLimit(store, { siteUuid: binding.site_uuid, event: "refresh", limit: REFRESH_RATE_LIMIT_PER_MINUTE, nowDate });
    const body = new URLSearchParams({
      client_id: config.client_id,
      client_secret: config.client_secret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: body.toString(),
      redirect: "manual",
    });
    const tokens = await parseGoogleTokenResponse(response, "managed_google_oauth_refresh_failed");
    const accessToken = cleanText(tokens.access_token, 8192);
    if (!accessToken) throw brokerError(502, "managed_google_oauth_refreshed_token_missing", "Google OAuth refresh did not return an access token.");
    const returnedScope = cleanText(tokens.scope || access.requested_scope, 512);
    exactAccessContract(access.access_mode, returnedScope);
    const expiresIn = boundedPositiveInt(tokens.expires_in, 3600, 24 * 60 * 60);
    await store.appendAudit?.({
      event: "refresh",
      site_uuid: binding.site_uuid,
      outcome: "success",
      origin: binding.origin,
      metadata: { access_mode: access.access_mode, scope_sha256_prefix: sha256Hex(returnedScope).slice(0, 12) },
      now: nowDate,
    });
    return {
      contract: MANAGED_GOOGLE_REFRESH_CONTRACT,
      access_token: accessToken,
      expires_in: expiresIn,
      scope: returnedScope,
    };
  }

  return Object.freeze({ createSession, handleGoogleCallback, redeem, refresh });
}

export function managedGoogleOAuthErrorResponse(error) {
  const status = Number(error?.status) || 500;
  const code = cleanText(error?.code || "managed_google_oauth_failed", 96) || "managed_google_oauth_failed";
  const message = status >= 500
    ? "Managed Google OAuth broker could not complete the request."
    : cleanText(error?.message || "Managed Google OAuth request failed.", 300);
  return Object.freeze({ status, body: { ok: false, error: { code, message, status }, secrets_included: false } });
}
