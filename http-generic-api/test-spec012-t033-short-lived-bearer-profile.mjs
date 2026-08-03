import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./test-tenant-gpt-access-token-profile.mjs";
import "./test-tenant-gpt-oauth-token-binding-hardening.mjs";
import "./test-tenant-gpt-oauth-token-exchange-routes.mjs";
import "./test-tenant-gpt-access-token-verifier.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

const record = JSON.parse(read(
  "specs/012-tenant-activation-lifecycle/implementation/pr-2o-t033-short-lived-bearer-profile.json",
));
const narrative = read(
  "specs/012-tenant-activation-lifecycle/implementation/pr-2o-t033-short-lived-bearer-profile.md",
);
const tasks = read("specs/012-tenant-activation-lifecycle/tasks.md");
const profile = read("http-generic-api/tenantGptAccessTokenProfile.js");
const issuer = read("http-generic-api/tenantGptOAuthTokenExchangeBindingGuard.js");
const route = read("http-generic-api/routes/tenantGptOAuthTokenExchangeRoutes.js");
const verifier = read("http-generic-api/tenantGptAccessTokenVerifier.js");
const manifest = read("http-generic-api/scripts/manifests/test-manifest-spec012.mjs");

assert.equal(record.task_id, "T033");
assert.equal(record.status, "repository_issuance_and_verification_profile_ready_live_readback_required");
assert.equal(record.authority.requirement, "FR-007");
assert.equal(record.authority.concern, "C-005");
assert.equal(record.issuance_contract.default_ttl_seconds, 3600);
assert.equal(record.issuance_contract.maximum_ttl_seconds, 3600);
assert.equal(record.issuance_contract.minimum_ttl_seconds, 60);
assert.equal(record.issuance_contract.caller_can_extend_maximum, false);
assert.equal(record.issuance_contract.response_expires_in_matches_signed_ttl, true);
assert.equal(record.issuance_contract.activation_context_expiry_matches_signed_ttl, true);
assert.equal(record.issuance_contract.issuer_dependency_required, true);
assert.equal(record.issuance_contract.verifier_dependency_required, true);
assert.equal(record.issuance_contract.known_fallback_secret_allowed, false);
assert.equal(record.verification_contract.strict_maximum_lifetime_seconds, 3600);
assert.equal(record.verification_contract.legacy_transition_maximum_lifetime_seconds, 604800);
assert.equal(record.verification_contract.legacy_longer_lifetime_requires_t032_acceptance, true);
assert.equal(record.verification_contract.future_iat_skew_maximum_seconds, 300);
assert.equal(record.verification_contract.subject_must_equal_tenant_user_binding, true);
assert.equal(record.evidence_contract.metric_name, "tenant_gpt_access_token_profile_total");
assert.deepEqual(record.evidence_contract.labels, [
  "classification", "outcome", "audience_mode", "short_lived",
]);
for (const key of [
  "issuer_value_included",
  "audience_value_included",
  "subject_value_included",
  "user_id_included",
  "tenant_id_included",
  "token_included",
  "authorization_header_included",
]) {
  assert.equal(record.evidence_contract[key], false, `${key} must remain false`);
}
assert.equal(record.validation.profile_regression_complete_on_current_head, false);
assert.equal(record.validation.issuer_regression_complete_on_current_head, false);
assert.equal(record.validation.route_regression_complete_on_current_head, false);
assert.equal(record.validation.verifier_regression_complete_on_current_head, false);
assert.equal(record.validation.readiness_regression_complete_on_current_head, false);
assert.equal(record.validation.exact_head_ci_complete, false);
assert.equal(record.validation.production_deployed, false);
assert.equal(record.validation.live_claim_evidence_readback_complete, false);
assert.equal(record.completion_gate.repository_issuance_profile_complete, true);
assert.equal(record.completion_gate.repository_verification_profile_complete, true);
assert.equal(record.completion_gate.deterministic_regression_complete, false);
assert.equal(record.completion_gate.production_deployed, false);
assert.equal(record.completion_gate.task_completion_allowed, false);
assert.equal(record.completion_gate.required_before_completion.length >= 7, true);
assert.match(tasks, /^- \[ \] \*\*T033\*\*/mu,
  "T033 must remain open until deployment and live claim evidence readback");
assert.match(narrative, /does \*\*not\*\* close T033/u);
assert.match(narrative, /Completion boundary/u);

assert.match(profile, /TENANT_GPT_ACCESS_TOKEN_DEFAULT_TTL_SECONDS = 60 \* 60/u);
assert.match(profile, /TENANT_GPT_ACCESS_TOKEN_MAX_TTL_SECONDS = 60 \* 60/u);
assert.match(profile, /TENANT_GPT_LEGACY_ACCESS_TOKEN_MAX_TTL_SECONDS = 7 \* 24 \* 60 \* 60/u);
assert.match(profile, /TENANT_GPT_ACCESS_TOKEN_PROFILE_METRIC/u);
assert.match(profile, /subject === expectedSubject/u);
assert.match(profile, /lifetimeSeconds > maxLifetimeSeconds/u);
assert.match(profile, /remainingSeconds > 0/u);
assert.match(profile, /issuer_verified/u);
assert.match(profile, /audience_verified/u);
assert.match(profile, /subject_verified/u);
assert.match(profile, /user_claim_present/u);
assert.match(profile, /tenant_claim_present/u);
assert.match(profile, /expiry_present/u);
assert.match(profile, /secrets_included: false/u);
assert.doesNotMatch(profile, /user_id:\s*profile/u);
assert.doesNotMatch(profile, /tenant_id:\s*profile/u);
assert.doesNotMatch(profile, /authorization:\s*profile/u);

assert.match(issuer, /resolveTenantGptAccessTokenTtlSeconds/u);
assert.match(issuer, /expiresIn: accessTokenTtlSeconds/u);
assert.match(issuer, /accessTokenTtlSeconds/u);
assert.doesNotMatch(issuer, /7 \* 24 \* 60 \* 60/u,
  "strict issuer must not retain the seven-day lifetime");

assert.match(route, /validateTenantGptAccessTokenTtlSeconds/u);
assert.match(route, /expires_in: accessTokenTtlSeconds/u);
assert.match(route, /accessExpiresAt = new Date\(now\(\) \+ accessTokenTtlSeconds \* 1000\)/u);
assert.match(route, /oauth_token_exchange_verifier_unavailable/u);
assert.match(route, /oauth_token_exchange_issuer_unavailable/u);
assert.match(route, /bearer_profile/u);
assert.doesNotMatch(route, /development_fallback_secret_only/u);
assert.doesNotMatch(route, /USER_TOKEN_TTL_SECONDS/u);
assert.doesNotMatch(route, /7 \* 24 \* 60 \* 60/u);

assert.match(verifier, /validateTenantGptAccessTokenProfile/u);
assert.match(verifier, /clockTimestamp: Math\.floor\(Number\(nowMs\) \/ 1000\)/u);
assert.match(verifier, /bearer_profile_classification/u);
assert.match(verifier, /issuer_verified/u);
assert.match(verifier, /subject_verified/u);
assert.match(verifier, /lifetime_seconds/u);
assert.match(verifier, /short_lived/u);
assert.doesNotMatch(verifier, /development_fallback_secret_only/u);

assert.match(manifest, /node test-spec012-t033-short-lived-bearer-profile\.mjs/u,
  "T033 readiness regression must be registered in the Spec 012 manifest");

for (const [key, value] of Object.entries(record.non_effects)) {
  assert.equal(value, false, `${key} must remain false`);
}

console.log("Spec 012 T033 short-lived bearer readiness tests passed");
