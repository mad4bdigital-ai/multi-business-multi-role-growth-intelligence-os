import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { parseManagedGoogleSiteBindings } from "./managedGoogleOAuthBroker.js";

export const MANAGED_GOOGLE_SITE_AUTH_CONTRACT = "mad4b.google-managed-oauth-site-request-auth.v1";
export const MANAGED_GOOGLE_SITE_AUTH_SCHEME = "MAD4B-GOOGLE-OAUTH-SITE-V1";
export const MANAGED_GOOGLE_SITE_AUTH_MAX_SKEW_SECONDS = 300;

const KEY_ID_RE = /^[A-Za-z0-9._:-]{3,64}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{22,128}$/;
const HEX_SHA256_RE = /^[a-f0-9]{64}$/;

function authError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function clean(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stableValue(value[key]);
      return out;
    }, {});
  }
  return value;
}

export function canonicalManagedGoogleRequestBody(body) {
  return JSON.stringify(stableValue(body && typeof body === "object" ? body : {}));
}

export function managedGoogleRequestBodySha256(body) {
  return createHash("sha256").update(canonicalManagedGoogleRequestBody(body), "utf8").digest("hex");
}

export function managedGoogleSiteSigningPayload({
  method,
  path,
  timestamp,
  nonce,
  body,
}) {
  const normalizedMethod = clean(method, 16).toUpperCase();
  const normalizedPath = clean(path, 256);
  const normalizedTimestamp = clean(timestamp, 32);
  const normalizedNonce = clean(nonce, 160);
  if (normalizedMethod !== "POST") throw authError(400, "managed_google_site_auth_method_invalid", "Managed Google OAuth site authentication requires POST.");
  if (!["/v1/google/oauth/session", "/v1/google/oauth/redeem", "/v1/google/oauth/refresh"].includes(normalizedPath)) {
    throw authError(400, "managed_google_site_auth_path_invalid", "Managed Google OAuth site authentication path is invalid.");
  }
  if (!/^\d{10}$/.test(normalizedTimestamp)) throw authError(400, "managed_google_site_auth_timestamp_invalid", "Managed Google OAuth site authentication timestamp is invalid.");
  if (!NONCE_RE.test(normalizedNonce)) throw authError(400, "managed_google_site_auth_nonce_invalid", "Managed Google OAuth site authentication nonce is invalid.");
  return [
    MANAGED_GOOGLE_SITE_AUTH_SCHEME,
    normalizedMethod,
    normalizedPath,
    normalizedTimestamp,
    normalizedNonce,
    managedGoogleRequestBodySha256(body),
  ].join("\n");
}

export function signManagedGoogleSiteRequest({
  secret,
  method,
  path,
  timestamp,
  nonce,
  body,
}) {
  const rawSecret = String(secret || "");
  if (rawSecret.length < 32) throw authError(500, "managed_google_site_auth_secret_invalid", "Managed Google OAuth site authentication secret is invalid.");
  return createHmac("sha256", rawSecret)
    .update(managedGoogleSiteSigningPayload({ method, path, timestamp, nonce, body }), "utf8")
    .digest("hex");
}

export function parseManagedGoogleSiteSecrets(env = process.env) {
  const raw = String(env.MANAGED_GOOGLE_OAUTH_SITE_SECRETS_JSON || "").trim();
  if (!raw) throw authError(503, "managed_google_site_auth_secrets_missing", "Managed Google OAuth site authentication secrets are not configured.");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw authError(503, "managed_google_site_auth_secrets_invalid", "Managed Google OAuth site authentication secrets are invalid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw authError(503, "managed_google_site_auth_secrets_invalid", "Managed Google OAuth site authentication secrets must be a JSON object keyed by key_id.");
  }
  const out = new Map();
  const seenSecretDigests = new Set();
  for (const [keyIdRaw, secretRaw] of Object.entries(parsed)) {
    const keyId = clean(keyIdRaw, 64);
    const secret = String(secretRaw || "");
    if (!KEY_ID_RE.test(keyId) || secret.length < 32) {
      throw authError(503, "managed_google_site_auth_secrets_invalid", "Managed Google OAuth site authentication secret registry contains an invalid key or secret.");
    }
    const secretDigest = createHash("sha256").update(secret, "utf8").digest("hex");
    if (seenSecretDigests.has(secretDigest)) {
      throw authError(503, "managed_google_site_auth_secret_reused", "Managed Google OAuth site authentication secrets must be unique per key_id.");
    }
    seenSecretDigests.add(secretDigest);
    out.set(keyId, secret);
  }
  if (!out.size) throw authError(503, "managed_google_site_auth_secrets_invalid", "Managed Google OAuth site authentication secret registry is empty.");
  return out;
}

function normalizedHeaders(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) out[String(key).toLowerCase()] = value;
  return out;
}

function exactBindingForRequest(env, body, keyId) {
  const siteUuid = clean(body?.site_uuid, 64);
  const origin = clean(body?.origin, 1024);
  const callbackUri = clean(body?.callback_uri, 2048);
  const bindings = parseManagedGoogleSiteBindings(env);
  return bindings.find((binding) =>
    binding.key_id === keyId &&
    binding.site_uuid === siteUuid &&
    binding.origin === origin &&
    (!callbackUri || binding.callback_uri === callbackUri)
  ) || null;
}

export async function authenticateManagedGoogleSiteRequest({
  env = process.env,
  store,
  method,
  path,
  headers,
  body,
  now = () => new Date(),
}) {
  if (!store || typeof store.consumeRequestNonce !== "function") {
    throw authError(500, "managed_google_site_auth_nonce_store_missing", "Managed Google OAuth site authentication nonce store is unavailable.");
  }

  const h = normalizedHeaders(headers);
  const keyId = clean(h["x-mad4b-site-key-id"], 64);
  const timestamp = clean(h["x-mad4b-site-timestamp"], 32);
  const nonce = clean(h["x-mad4b-site-nonce"], 160);
  const signature = clean(h["x-mad4b-site-signature"], 128).toLowerCase();

  if (!KEY_ID_RE.test(keyId)) throw authError(401, "managed_google_site_auth_key_id_invalid", "Managed Google OAuth site authentication key ID is missing or invalid.");
  if (!/^\d{10}$/.test(timestamp)) throw authError(401, "managed_google_site_auth_timestamp_invalid", "Managed Google OAuth site authentication timestamp is missing or invalid.");
  if (!NONCE_RE.test(nonce)) throw authError(401, "managed_google_site_auth_nonce_invalid", "Managed Google OAuth site authentication nonce is missing or invalid.");
  if (!HEX_SHA256_RE.test(signature)) throw authError(401, "managed_google_site_auth_signature_invalid", "Managed Google OAuth site authentication signature is missing or invalid.");

  const nowDate = now();
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(nowDate.getTime() - timestampMs) > MANAGED_GOOGLE_SITE_AUTH_MAX_SKEW_SECONDS * 1000) {
    throw authError(401, "managed_google_site_auth_timestamp_expired", "Managed Google OAuth site authentication timestamp is outside the permitted clock-skew window.");
  }

  const binding = exactBindingForRequest(env, body, keyId);
  if (!binding) throw authError(403, "managed_google_site_auth_binding_mismatch", "Managed Google OAuth site request is not bound to an authorized site credential.");

  const secrets = parseManagedGoogleSiteSecrets(env);
  const secret = secrets.get(keyId);
  if (!secret) throw authError(403, "managed_google_site_auth_key_unbound", "Managed Google OAuth site authentication key is not configured.");

  const expected = signManagedGoogleSiteRequest({ secret, method, path, timestamp, nonce, body });
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(signature, "hex");
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    throw authError(401, "managed_google_site_auth_signature_mismatch", "Managed Google OAuth site authentication signature does not match.");
  }

  const consumed = await store.consumeRequestNonce({
    key_id: keyId,
    nonce_hash: createHash("sha256").update(nonce, "utf8").digest("hex"),
    site_uuid: binding.site_uuid,
    expires_at: new Date(nowDate.getTime() + MANAGED_GOOGLE_SITE_AUTH_MAX_SKEW_SECONDS * 1000),
    now: nowDate,
  });
  if (!consumed) throw authError(409, "managed_google_site_auth_nonce_replayed", "Managed Google OAuth site authentication nonce was already used.");

  return Object.freeze({
    contract: MANAGED_GOOGLE_SITE_AUTH_CONTRACT,
    authenticated: true,
    key_id: keyId,
    site_uuid: binding.site_uuid,
    origin: binding.origin,
    callback_uri: binding.callback_uri,
    body_sha256: managedGoogleRequestBodySha256(body),
    secrets_included: false,
  });
}
