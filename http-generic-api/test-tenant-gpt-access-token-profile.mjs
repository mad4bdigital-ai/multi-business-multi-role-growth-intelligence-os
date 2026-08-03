import assert from "node:assert/strict";
import {
  TENANT_GPT_ACCESS_TOKEN_DEFAULT_TTL_SECONDS,
  TENANT_GPT_ACCESS_TOKEN_MAX_FUTURE_IAT_SKEW_SECONDS,
  TENANT_GPT_ACCESS_TOKEN_MAX_TTL_SECONDS,
  TENANT_GPT_ACCESS_TOKEN_MIN_TTL_SECONDS,
  TENANT_GPT_ACCESS_TOKEN_PROFILE_METRIC,
  TENANT_GPT_LEGACY_ACCESS_TOKEN_MAX_TTL_SECONDS,
  recordTenantGptAccessTokenProfileEvidence,
  resolveTenantGptAccessTokenTtlSeconds,
  validateTenantGptAccessTokenProfile,
  validateTenantGptAccessTokenTtlSeconds,
} from "./tenantGptAccessTokenProfile.js";

const ISSUER = "https://auth.mad4b.com";
const RESOURCE = "https://activation.mad4b.com";
const LEGACY = "mad4b-tenant-gpt";
const NOW_SECONDS = Math.floor(Date.parse("2026-08-04T01:00:00.000Z") / 1000);
const NOW_MS = NOW_SECONDS * 1000;

function payload(overrides = {}) {
  const issuedAt = NOW_SECONDS - 60;
  return {
    iss: ISSUER,
    aud: RESOURCE,
    sub: "tenant:tenant-1:user:user-1",
    user_id: "user-1",
    tenant_id: "tenant-1",
    iat: issuedAt,
    exp: issuedAt + TENANT_GPT_ACCESS_TOKEN_DEFAULT_TTL_SECONDS,
    ...overrides,
  };
}

function validate(overrides = {}, options = {}) {
  return validateTenantGptAccessTokenProfile(payload(overrides), {
    expectedIssuer: ISSUER,
    expectedAudience: RESOURCE,
    audienceMode: "strict",
    nowMs: NOW_MS,
    ...options,
  });
}

assert.equal(TENANT_GPT_ACCESS_TOKEN_DEFAULT_TTL_SECONDS, 3600);
assert.equal(TENANT_GPT_ACCESS_TOKEN_MAX_TTL_SECONDS, 3600);
assert.equal(TENANT_GPT_ACCESS_TOKEN_MIN_TTL_SECONDS, 60);
assert.equal(TENANT_GPT_LEGACY_ACCESS_TOKEN_MAX_TTL_SECONDS, 604800);
assert.equal(TENANT_GPT_ACCESS_TOKEN_MAX_FUTURE_IAT_SKEW_SECONDS, 300);
assert.equal(resolveTenantGptAccessTokenTtlSeconds({}), 3600);
assert.equal(resolveTenantGptAccessTokenTtlSeconds({ TENANT_GPT_ACCESS_TOKEN_TTL_SECONDS: "60" }), 60);
assert.equal(resolveTenantGptAccessTokenTtlSeconds({ TENANT_GPT_ACCESS_TOKEN_TTL_SECONDS: "3600" }), 3600);
assert.equal(validateTenantGptAccessTokenTtlSeconds(300), 300);
for (const invalid of [0, 59, 3601, "60.5", "abc", null]) {
  assert.throws(
    () => validateTenantGptAccessTokenTtlSeconds(invalid),
    (error) => error?.code === "tenant_gpt_access_token_ttl_invalid",
  );
}

const strict = validate();
assert.equal(strict.accepted, true);
assert.equal(strict.classification, "short_lived_bearer_verified");
assert.equal(strict.issuer_verified, true);
assert.equal(strict.audience_verified, true);
assert.equal(strict.subject_verified, true);
assert.equal(strict.user_claim_present, true);
assert.equal(strict.tenant_claim_present, true);
assert.equal(strict.issued_at_present, true);
assert.equal(strict.expiry_present, true);
assert.equal(strict.lifetime_seconds, 3600);
assert.equal(strict.remaining_seconds, 3540);
assert.equal(strict.max_lifetime_seconds, 3600);
assert.equal(strict.short_lived, true);
assert.equal(strict.metric.name, TENANT_GPT_ACCESS_TOKEN_PROFILE_METRIC);
assert.deepEqual(Object.keys(strict.metric.labels).sort(), [
  "audience_mode", "classification", "outcome", "short_lived",
]);
assert.equal(strict.secrets_included, false);

assert.equal(validate({ iss: "https://evil.example" }).classification, "issuer_claim_invalid");
assert.equal(validate({ aud: [RESOURCE, LEGACY] }).classification, "audience_claim_invalid");
assert.equal(validate({ user_id: "" }).classification, "user_claim_invalid");
assert.equal(validate({ tenant_id: "" }).classification, "tenant_claim_invalid");
assert.equal(validate({ sub: "tenant:other:user:user-1" }).classification, "subject_claim_invalid");
assert.equal(validate({ iat: null }).classification, "issued_at_claim_invalid");
assert.equal(validate({ exp: null }).classification, "expiry_claim_invalid");
assert.equal(validate({ iat: NOW_SECONDS + 301, exp: NOW_SECONDS + 601 }).classification, "issued_at_in_future");
assert.equal(validate({ iat: NOW_SECONDS, exp: NOW_SECONDS }).classification, "token_lifetime_invalid");
assert.equal(validate({ exp: payload().iat + 3601 }).classification, "strict_token_lifetime_exceeded");
assert.equal(validate({ iat: NOW_SECONDS - 4000, exp: NOW_SECONDS - 1 }).classification, "token_expired");

const legacyIssuedAt = NOW_SECONDS - 60;
const legacy = validateTenantGptAccessTokenProfile(payload({
  aud: LEGACY,
  iat: legacyIssuedAt,
  exp: legacyIssuedAt + TENANT_GPT_LEGACY_ACCESS_TOKEN_MAX_TTL_SECONDS,
}), {
  expectedIssuer: ISSUER,
  expectedAudience: LEGACY,
  audienceMode: "legacy",
  nowMs: NOW_MS,
});
assert.equal(legacy.accepted, true);
assert.equal(legacy.classification, "legacy_transition_token_verified");
assert.equal(legacy.short_lived, false);
assert.equal(legacy.max_lifetime_seconds, 604800);
const legacyExceeded = validateTenantGptAccessTokenProfile(payload({
  aud: LEGACY,
  iat: legacyIssuedAt,
  exp: legacyIssuedAt + TENANT_GPT_LEGACY_ACCESS_TOKEN_MAX_TTL_SECONDS + 1,
}), {
  expectedIssuer: ISSUER,
  expectedAudience: LEGACY,
  audienceMode: "legacy",
  nowMs: NOW_MS,
});
assert.equal(legacyExceeded.accepted, false);
assert.equal(legacyExceeded.classification, "legacy_token_lifetime_exceeded");

const loggerEvents = [];
const logger = {
  info(message, entry) { loggerEvents.push({ level: "info", message, entry }); },
  warn(message, entry) { loggerEvents.push({ level: "warn", message, entry }); },
};
assert.equal(recordTenantGptAccessTokenProfileEvidence(strict, { logger }), true);
assert.equal(loggerEvents.length, 0, "strict success must not create default log volume");
assert.equal(recordTenantGptAccessTokenProfileEvidence(legacy, { logger }), true);
assert.equal(recordTenantGptAccessTokenProfileEvidence(legacyExceeded, { logger }), true);
assert.equal(loggerEvents.length, 2);
for (const event of loggerEvents) {
  const serialized = JSON.stringify(event);
  assert.equal(serialized.includes("user-1"), false);
  assert.equal(serialized.includes("tenant-1"), false);
  assert.equal(serialized.includes("Bearer "), false);
  assert.equal(serialized.includes("access_token"), true, "metric name may identify the token profile only");
  assert.equal(event.entry.secrets_included, false);
}

console.log("PASS tenant-gpt-access-token-profile");
