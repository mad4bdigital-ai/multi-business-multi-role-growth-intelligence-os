export const TENANT_GPT_ACCESS_TOKEN_DEFAULT_TTL_SECONDS = 60 * 60;
export const TENANT_GPT_ACCESS_TOKEN_MAX_TTL_SECONDS = 60 * 60;
export const TENANT_GPT_ACCESS_TOKEN_MIN_TTL_SECONDS = 60;
export const TENANT_GPT_LEGACY_ACCESS_TOKEN_MAX_TTL_SECONDS = 7 * 24 * 60 * 60;
export const TENANT_GPT_ACCESS_TOKEN_MAX_FUTURE_IAT_SKEW_SECONDS = 5 * 60;

function profileError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function finiteInteger(value) {
  const normalized = Number(value);
  return Number.isInteger(normalized) ? normalized : null;
}

export function resolveTenantGptAccessTokenTtlSeconds(env = process.env) {
  const configured = String(env?.TENANT_GPT_ACCESS_TOKEN_TTL_SECONDS || "").trim();
  if (!configured) return TENANT_GPT_ACCESS_TOKEN_DEFAULT_TTL_SECONDS;

  const ttlSeconds = finiteInteger(configured);
  if (
    ttlSeconds === null
    || ttlSeconds < TENANT_GPT_ACCESS_TOKEN_MIN_TTL_SECONDS
    || ttlSeconds > TENANT_GPT_ACCESS_TOKEN_MAX_TTL_SECONDS
  ) {
    throw profileError(
      "tenant_gpt_access_token_ttl_invalid",
      `TENANT_GPT_ACCESS_TOKEN_TTL_SECONDS must be an integer between ${TENANT_GPT_ACCESS_TOKEN_MIN_TTL_SECONDS} and ${TENANT_GPT_ACCESS_TOKEN_MAX_TTL_SECONDS}.`,
    );
  }
  return ttlSeconds;
}

function audienceValues(value) {
  return (Array.isArray(value) ? value : [value])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

function evidence({
  accepted,
  classification,
  audienceMode,
  issuerVerified,
  audienceVerified,
  subjectVerified,
  userClaimPresent,
  tenantClaimPresent,
  issuedAtPresent,
  expiryPresent,
  lifetimeSeconds,
  remainingSeconds,
  maxLifetimeSeconds,
} = {}) {
  return Object.freeze({
    accepted: accepted === true,
    classification,
    audience_mode: audienceMode || "unknown",
    issuer_verified: issuerVerified === true,
    audience_verified: audienceVerified === true,
    subject_verified: subjectVerified === true,
    user_claim_present: userClaimPresent === true,
    tenant_claim_present: tenantClaimPresent === true,
    issued_at_present: issuedAtPresent === true,
    expiry_present: expiryPresent === true,
    lifetime_seconds: Number.isFinite(lifetimeSeconds) ? lifetimeSeconds : null,
    remaining_seconds: Number.isFinite(remainingSeconds) ? remainingSeconds : null,
    max_lifetime_seconds: Number.isFinite(maxLifetimeSeconds) ? maxLifetimeSeconds : null,
    short_lived: accepted === true && audienceMode === "strict",
    secrets_included: false,
  });
}

export function validateTenantGptAccessTokenProfile(payload, {
  expectedIssuer,
  expectedAudience,
  audienceMode = "strict",
  nowMs = Date.now(),
  maxFutureIatSkewSeconds = TENANT_GPT_ACCESS_TOKEN_MAX_FUTURE_IAT_SKEW_SECONDS,
} = {}) {
  const userId = String(payload?.user_id || "").trim();
  const tenantId = String(payload?.tenant_id || "").trim();
  const subject = String(payload?.sub || "").trim();
  const issuer = String(payload?.iss || "").trim();
  const audiences = audienceValues(payload?.aud);
  const issuedAt = finiteInteger(payload?.iat);
  const expiresAt = finiteInteger(payload?.exp);
  const nowSeconds = Math.floor(Number(nowMs) / 1000);
  const boundedFutureSkew = Math.min(
    TENANT_GPT_ACCESS_TOKEN_MAX_FUTURE_IAT_SKEW_SECONDS,
    Math.max(0, finiteInteger(maxFutureIatSkewSeconds) ?? TENANT_GPT_ACCESS_TOKEN_MAX_FUTURE_IAT_SKEW_SECONDS),
  );
  const maxLifetimeSeconds = audienceMode === "legacy"
    ? TENANT_GPT_LEGACY_ACCESS_TOKEN_MAX_TTL_SECONDS
    : TENANT_GPT_ACCESS_TOKEN_MAX_TTL_SECONDS;
  const issuerVerified = Boolean(expectedIssuer && issuer === String(expectedIssuer));
  const audienceVerified = audiences.length === 1
    && Boolean(expectedAudience)
    && audiences[0] === String(expectedAudience);
  const userClaimPresent = Boolean(userId && userId.length <= 64);
  const tenantClaimPresent = Boolean(tenantId && tenantId.length <= 64);
  const expectedSubject = userClaimPresent && tenantClaimPresent
    ? `tenant:${tenantId}:user:${userId}`
    : "";
  const subjectVerified = Boolean(expectedSubject && subject === expectedSubject);
  const issuedAtPresent = issuedAt !== null && issuedAt > 0;
  const expiryPresent = expiresAt !== null && expiresAt > 0;
  const lifetimeSeconds = issuedAtPresent && expiryPresent ? expiresAt - issuedAt : null;
  const remainingSeconds = expiryPresent && Number.isFinite(nowSeconds) ? expiresAt - nowSeconds : null;

  const base = {
    audienceMode,
    issuerVerified,
    audienceVerified,
    subjectVerified,
    userClaimPresent,
    tenantClaimPresent,
    issuedAtPresent,
    expiryPresent,
    lifetimeSeconds,
    remainingSeconds,
    maxLifetimeSeconds,
  };

  if (!issuerVerified) return evidence({ ...base, accepted: false, classification: "issuer_claim_invalid" });
  if (!audienceVerified) return evidence({ ...base, accepted: false, classification: "audience_claim_invalid" });
  if (!userClaimPresent) return evidence({ ...base, accepted: false, classification: "user_claim_invalid" });
  if (!tenantClaimPresent) return evidence({ ...base, accepted: false, classification: "tenant_claim_invalid" });
  if (!subjectVerified) return evidence({ ...base, accepted: false, classification: "subject_claim_invalid" });
  if (!issuedAtPresent) return evidence({ ...base, accepted: false, classification: "issued_at_claim_invalid" });
  if (!expiryPresent) return evidence({ ...base, accepted: false, classification: "expiry_claim_invalid" });
  if (issuedAt > nowSeconds + boundedFutureSkew) {
    return evidence({ ...base, accepted: false, classification: "issued_at_in_future" });
  }
  if (!(lifetimeSeconds > 0)) {
    return evidence({ ...base, accepted: false, classification: "token_lifetime_invalid" });
  }
  if (lifetimeSeconds > maxLifetimeSeconds) {
    return evidence({
      ...base,
      accepted: false,
      classification: audienceMode === "legacy"
        ? "legacy_token_lifetime_exceeded"
        : "strict_token_lifetime_exceeded",
    });
  }
  if (!(remainingSeconds > 0)) {
    return evidence({ ...base, accepted: false, classification: "token_expired" });
  }

  return evidence({
    ...base,
    accepted: true,
    classification: audienceMode === "legacy"
      ? "legacy_transition_token_verified"
      : "short_lived_bearer_verified",
  });
}
