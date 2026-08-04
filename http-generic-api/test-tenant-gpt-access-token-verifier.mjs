process.env.JWT_SECRET = process.env.JWT_SECRET || "oauth_route_test_secret";

import jwt from "jsonwebtoken";

const {
  JWT_SECRET_MAX_LENGTH,
  verifyTenantGptAccessToken,
} = await import("./tenantGptAccessTokenVerifier.js");

const ACTIVATION_RESOURCE = "https://activation.mad4b.com";
const AUTH_RESOURCE = "https://auth.mad4b.com";
const ISSUER = "https://auth.mad4b.com";
const LEGACY_AUDIENCE = "mad4b-tenant-gpt";
const CUTOFF_MS = Date.parse("2026-10-31T23:59:59.000Z");
const TEST_NOW_MS = Date.parse("2026-08-01T00:01:00.000Z");
const BASE_IAT = Math.floor(Date.parse("2026-08-01T00:00:00.000Z") / 1000);
const STRICT_TTL_SECONDS = 60 * 60;
const LEGACY_TTL_SECONDS = 7 * 24 * 60 * 60;

let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
  } else {
    console.error(`  [FAIL] ${label}${detail ? ` - ${detail}` : ""}`);
    failed += 1;
  }
}

function signToken(overrides = {}) {
  const issuedAt = overrides.iat === undefined ? BASE_IAT : overrides.iat;
  const expiresAt = overrides.exp === undefined
    ? Number(issuedAt) + STRICT_TTL_SECONDS
    : overrides.exp;
  return jwt.sign({
    iss: ISSUER,
    aud: ACTIVATION_RESOURCE,
    resource: ACTIVATION_RESOURCE,
    purpose: "tenant_gpt_access",
    sub: "tenant:tenant-1:user:user-1",
    user_id: "user-1",
    tenant_id: "tenant-1",
    iat: issuedAt,
    exp: expiresAt,
    ...overrides,
  }, process.env.JWT_SECRET);
}

function failure(token, options = {}) {
  try {
    verifyTenantGptAccessToken(token, { nowMs: TEST_NOW_MS, ...options });
    return null;
  } catch (error) {
    return error;
  }
}

function failureCode(token, options = {}) {
  const error = failure(token, options);
  return error ? error.code || error.message || "unknown" : null;
}

function captureDecision(token, options = {}) {
  const evidence = [];
  let code = null;
  try {
    verifyTenantGptAccessToken(token, {
      nowMs: TEST_NOW_MS,
      ...options,
      onCompatibilityEvidence: (entry) => evidence.push(entry),
    });
  } catch (error) {
    code = error?.code || error?.message || "unknown";
  }
  return { evidence, code };
}

console.log("\n== Tenant GPT access token verifier");

const strictEvidence = [];
const strict = verifyTenantGptAccessToken(signToken(), {
  nowMs: TEST_NOW_MS,
  onCompatibilityEvidence: (entry) => strictEvidence.push(entry),
});
assert("strict Activation audience is accepted", strict.verification.audience === ACTIVATION_RESOURCE);
assert("strict token is not marked legacy", strict.verification.legacy_audience_accepted === false);
assert("strict audience classification is explicit",
  strict.verification.audience_compatibility_classification === "strict_resource_audience_accepted");
assert("strict bearer profile is short lived", strict.verification.short_lived === true);
assert("strict bearer lifetime is one hour", strict.verification.lifetime_seconds === STRICT_TTL_SECONDS);
assert("strict subject binding is verified", strict.verification.subject_verified === true);
assert("strict verification emits exactly one compatibility metric decision", strictEvidence.length === 1);
assert("strict compatibility decision contains no secrets", strictEvidence[0]?.secrets_included === false);

const wrongAudience = captureDecision(signToken({ aud: AUTH_RESOURCE, resource: AUTH_RESOURCE }));
assert(
  "wrong protected-resource audience is rejected",
  wrongAudience.code === "tenant_gpt_token_audience_invalid",
);
assert("wrong audience emits stable mismatch classification",
  wrongAudience.evidence[0]?.classification === "audience_mismatch_rejected");

const multiAudience = captureDecision(signToken({ aud: [LEGACY_AUDIENCE, ACTIVATION_RESOURCE] }));
assert(
  "multi-audience access token is rejected",
  multiAudience.code === "tenant_gpt_token_audience_invalid",
);
assert("multi-audience rejection is observable",
  multiAudience.evidence[0]?.classification === "multi_audience_rejected");

const resourceMismatch = captureDecision(signToken({ resource: AUTH_RESOURCE }));
assert(
  "mismatched resource claim is rejected",
  resourceMismatch.code === "tenant_gpt_token_resource_invalid",
);
assert("resource mismatch does not emit a false accepted metric",
  resourceMismatch.evidence[0]?.classification === "token_resource_mismatch_rejected"
    && resourceMismatch.evidence[0]?.accepted === false);

assert(
  "wrong issuer is rejected",
  failureCode(signToken({ iss: "https://evil.example" })) === "invalid_user_jwt",
);
assert(
  "missing tenant subject is rejected",
  failureCode(signToken({ tenant_id: null })) === "tenant_gpt_token_subject_invalid",
);
assert(
  "mismatched bound subject is rejected",
  failureCode(signToken({ sub: "tenant:tenant-2:user:user-1" })) === "tenant_gpt_token_subject_invalid",
);

const legacyToken = signToken({
  aud: LEGACY_AUDIENCE,
  resource: undefined,
  exp: BASE_IAT + LEGACY_TTL_SECONDS,
});
const legacyEvidence = [];
const legacyBeforeCutoff = verifyTenantGptAccessToken(legacyToken, {
  nowMs: TEST_NOW_MS,
  legacyAudienceCutoffMs: CUTOFF_MS,
  onCompatibilityEvidence: (entry) => legacyEvidence.push(entry),
});
assert("legacy audience is accepted before cutoff", legacyBeforeCutoff.verification.legacy_audience_accepted === true);
assert("legacy acceptance exposes cutoff state", legacyBeforeCutoff.verification.legacy_audience_cutoff_state === "active");
assert("legacy transition lifetime remains bounded to seven days",
  legacyBeforeCutoff.verification.lifetime_seconds === LEGACY_TTL_SECONDS);
assert("legacy acceptance emits observable compatibility evidence",
  legacyEvidence[0]?.classification === "legacy_audience_accepted_before_cutoff");

const cutoffIat = Math.floor((CUTOFF_MS - 60_000) / 1000);
const legacyAtCutoffToken = signToken({
  aud: LEGACY_AUDIENCE,
  resource: undefined,
  iat: cutoffIat,
  exp: cutoffIat + STRICT_TTL_SECONDS,
});
assert(
  "legacy audience is rejected after cutoff",
  failureCode(legacyAtCutoffToken, {
    nowMs: CUTOFF_MS + 1,
    legacyAudienceCutoffMs: CUTOFF_MS,
  }) === "tenant_gpt_token_audience_invalid",
);
assert(
  "legacy audience can be disabled before cutoff",
  failureCode(legacyToken, {
    allowLegacyAudience: false,
    legacyAudienceCutoffMs: CUTOFF_MS,
  }) === "tenant_gpt_token_audience_invalid",
);
assert(
  "legacy audience fails closed when cutoff is invalid",
  failureCode(legacyToken, {
    legacyAudienceCutoffMs: 0,
  }) === "tenant_gpt_token_audience_invalid",
);

let telemetryFailureCalls = 0;
const strictWithBrokenTelemetry = verifyTenantGptAccessToken(signToken(), {
  nowMs: TEST_NOW_MS,
  onCompatibilityEvidence: () => {
    telemetryFailureCalls += 1;
    const error = new Error("telemetry unavailable");
    error.code = "telemetry_unavailable";
    throw error;
  },
});
assert("telemetry failure does not deny a valid strict token",
  strictWithBrokenTelemetry.verification.audience === ACTIVATION_RESOURCE);
assert("telemetry callback is attempted once", telemetryFailureCalls === 1);

const tokenBeforeSecretRemoval = signToken();
const originalSecret = process.env.JWT_SECRET;
delete process.env.JWT_SECRET;
const missingSecretError = failure(tokenBeforeSecretRemoval);
process.env.JWT_SECRET = originalSecret;
assert("missing verifier secret fails closed", missingSecretError?.code === "tenant_gpt_verifier_unavailable");
assert("missing verifier secret is a dependency failure", missingSecretError?.status === 503);

process.env.JWT_SECRET = "x".repeat(JWT_SECRET_MAX_LENGTH + 1);
const oversizedSecretError = failure(tokenBeforeSecretRemoval);
process.env.JWT_SECRET = originalSecret;
assert("oversized verifier secret fails closed", oversizedSecretError?.code === "tenant_gpt_verifier_unavailable");
assert("oversized verifier secret is a dependency failure", oversizedSecretError?.status === 503);

if (failed) {
  console.error(`\nTenant GPT access token verifier tests failed: ${failed}`);
  process.exitCode = 1;
} else {
  console.log("\nTenant GPT access token verifier tests passed.");
}
