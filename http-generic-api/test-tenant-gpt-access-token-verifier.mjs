process.env.JWT_SECRET = process.env.JWT_SECRET || "oauth_route_test_secret";

import jwt from "jsonwebtoken";

const {
  verifyTenantGptAccessToken,
} = await import("./tenantGptAccessTokenVerifier.js");

const ACTIVATION_RESOURCE = "https://activation.mad4b.com";
const AUTH_RESOURCE = "https://auth.mad4b.com";
const ISSUER = "https://auth.mad4b.com";
const LEGACY_AUDIENCE = "mad4b-tenant-gpt";

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
  return jwt.sign({
    iss: ISSUER,
    aud: ACTIVATION_RESOURCE,
    resource: ACTIVATION_RESOURCE,
    purpose: "tenant_gpt_access",
    user_id: "user-1",
    tenant_id: "tenant-1",
    ...overrides,
  }, process.env.JWT_SECRET, { expiresIn: "365d" });
}

function failureCode(token, options = {}) {
  try {
    verifyTenantGptAccessToken(token, options);
    return null;
  } catch (error) {
    return error?.code || error?.message || "unknown";
  }
}

console.log("\n== Tenant GPT access token verifier");

const strict = verifyTenantGptAccessToken(signToken());
assert("strict Activation audience is accepted", strict.verification.audience === ACTIVATION_RESOURCE);
assert("strict token is not marked legacy", strict.verification.legacy_audience_accepted === false);

assert(
  "wrong protected-resource audience is rejected",
  failureCode(signToken({ aud: AUTH_RESOURCE, resource: AUTH_RESOURCE })) === "tenant_gpt_token_audience_invalid",
);
assert(
  "multi-audience access token is rejected",
  failureCode(signToken({ aud: [LEGACY_AUDIENCE, ACTIVATION_RESOURCE] })) === "tenant_gpt_token_audience_invalid",
);
assert(
  "mismatched resource claim is rejected",
  failureCode(signToken({ resource: AUTH_RESOURCE })) === "tenant_gpt_token_resource_invalid",
);
assert(
  "wrong issuer is rejected",
  failureCode(signToken({ iss: "https://evil.example" })) === "invalid_user_jwt",
);
assert(
  "missing tenant subject is rejected",
  failureCode(signToken({ tenant_id: null })) === "tenant_gpt_token_subject_invalid",
);

const legacyToken = signToken({ aud: LEGACY_AUDIENCE, resource: undefined });
const legacyBeforeCutoff = verifyTenantGptAccessToken(legacyToken, {
  nowMs: Date.parse("2026-08-01T00:00:00.000Z"),
});
assert("legacy audience is accepted before cutoff", legacyBeforeCutoff.verification.legacy_audience_accepted === true);
assert(
  "legacy audience is rejected after cutoff",
  failureCode(legacyToken, { nowMs: Date.parse("2026-11-01T00:00:00.000Z") }) === "tenant_gpt_token_audience_invalid",
);

if (failed) {
  console.error(`\nTenant GPT access token verifier tests failed: ${failed}`);
  process.exitCode = 1;
} else {
  console.log("\nTenant GPT access token verifier tests passed.");
}
