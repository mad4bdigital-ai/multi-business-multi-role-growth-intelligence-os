import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function codecError(code, message, status = 400) {
  const error = new Error(message);
  error.name = "ProviderConsentStateCodecError";
  error.code = code;
  error.status = status;
  return error;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) result[key] = stableValue(value[key]);
  }
  return result;
}

function requirePayloadObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Provider consent state payload must be an object.");
  }
  return value;
}

function normalizeSecret(secret) {
  const buffer = Buffer.isBuffer(secret) ? Buffer.from(secret) : Buffer.from(String(secret || ""), "utf8");
  if (buffer.length < 32) {
    throw new TypeError("Provider consent state secret must contain at least 32 bytes.");
  }
  return buffer;
}

function parseTimestamp(value, fieldName) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw codecError("oauth_state_invalid", `${fieldName} is invalid.`);
  return date;
}

function signatureHash(signature) {
  return createHash("sha256").update(signature).digest("hex");
}

export function createProviderConsentStateCodec({
  secret,
  signatureVersion = "hmac-sha256.v1",
  clock = () => new Date(),
  maxLifetimeSeconds = 15 * 60,
} = {}) {
  const signingSecret = normalizeSecret(secret);
  if (typeof clock !== "function") throw new TypeError("clock must be a function.");
  if (!Number.isSafeInteger(maxLifetimeSeconds) || maxLifetimeSeconds <= 0) {
    throw new TypeError("maxLifetimeSeconds must be a positive safe integer.");
  }
  const version = String(signatureVersion || "").trim();
  if (!version) throw new TypeError("signatureVersion is required.");

  function sign(encodedPayload) {
    return createHmac("sha256", signingSecret).update(encodedPayload).digest();
  }

  function issue(payload) {
    const source = requirePayloadObject(payload);
    const issuedAt = parseTimestamp(source.issuedAt, "issuedAt");
    const expiresAt = parseTimestamp(source.expiresAt, "expiresAt");
    const lifetimeSeconds = Math.floor((expiresAt.getTime() - issuedAt.getTime()) / 1000);
    if (lifetimeSeconds <= 0 || lifetimeSeconds > maxLifetimeSeconds) {
      throw codecError("oauth_state_lifetime_invalid", "Provider consent state lifetime is outside the allowed range.");
    }
    const envelope = stableValue({ ...source, signatureVersion: version });
    const encodedPayload = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
    const signature = sign(encodedPayload);
    return Object.freeze({
      serializedState: `${encodedPayload}.${signature.toString("base64url")}`,
      signatureHash: signatureHash(signature),
      signatureVersion: version,
    });
  }

  function verify(serializedState) {
    const raw = String(serializedState || "").trim();
    const parts = raw.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw codecError("oauth_state_invalid", "Provider consent state format is invalid.");
    }
    let providedSignature;
    try {
      providedSignature = Buffer.from(parts[1], "base64url");
    } catch {
      throw codecError("oauth_state_invalid", "Provider consent state signature is invalid.");
    }
    const expectedSignature = sign(parts[0]);
    if (
      providedSignature.length !== expectedSignature.length
      || !timingSafeEqual(providedSignature, expectedSignature)
    ) {
      throw codecError("oauth_state_signature_invalid", "Provider consent state signature is invalid.", 401);
    }
    let payload;
    try {
      payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    } catch {
      throw codecError("oauth_state_invalid", "Provider consent state payload is invalid.");
    }
    requirePayloadObject(payload);
    if (payload.signatureVersion !== version) {
      throw codecError("oauth_state_signature_version_invalid", "Provider consent state signature version is not accepted.", 401);
    }
    const issuedAt = parseTimestamp(payload.issuedAt, "issuedAt");
    const expiresAt = parseTimestamp(payload.expiresAt, "expiresAt");
    const now = clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError("clock must return a valid Date.");
    const lifetimeSeconds = Math.floor((expiresAt.getTime() - issuedAt.getTime()) / 1000);
    if (lifetimeSeconds <= 0 || lifetimeSeconds > maxLifetimeSeconds) {
      throw codecError("oauth_state_lifetime_invalid", "Provider consent state lifetime is outside the allowed range.");
    }
    if (expiresAt.getTime() <= now.getTime()) {
      throw codecError("oauth_state_expired", "Provider consent state has expired.", 409);
    }
    if (issuedAt.getTime() > now.getTime() + 30_000) {
      throw codecError("oauth_state_issued_in_future", "Provider consent state issue time is invalid.", 409);
    }
    return Object.freeze({
      payload: Object.freeze(payload),
      signatureHash: signatureHash(providedSignature),
      signatureVersion: version,
    });
  }

  return Object.freeze({ issue, verify, signatureVersion: version });
}

export const _testingProviderConsentStateCodec = Object.freeze({
  stableValue,
  signatureHash,
});
