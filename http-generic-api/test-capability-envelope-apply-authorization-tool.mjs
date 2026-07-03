import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateCredentialEnvelope } from "./scripts/capability-resolution-envelope-apply-authorize.mjs";

const script = readFileSync("scripts/capability-resolution-envelope-apply-authorize.mjs", "utf8");
const migration = readFileSync("migrations/902_sprint68_dynamic_capability_apply_authorization_policy.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const adminCli = readFileSync("routes/adminCliRoutes.js", "utf8");
const gptTools = readFileSync("routes/gptToolsRoutes.js", "utf8");
const snapshotRecord = readFileSync("adsProviderGovernanceSnapshotRecord.js", "utf8");

for (const expected of [
  "capability_apply_authorization_policy_registry",
  "loadApplyAuthorizationPolicy",
  "dynamic_capability_apply_authorization_policy",
  "allow_external_write",
  "allow_credential_binding",
  "allow_no_credential_binding",
  "allowed_source_tiers_json",
  "requires_typed_confirmation",
  "requires_same_cycle_dry_run",
  "ready_for_dispatch",
  "dispatch_allowed = 1",
  "blocking_gap_count = 0",
  "apply_allowed = 1",
  "capability_envelope_apply_capability_not_allowlisted",
  "capability_envelope_apply_requires_credential_binding",
  "capability_envelope_apply_credential_binding_not_allowed",
  "capability_envelope_apply_source_tier_not_allowed",
  "no_provider_call",
  "no_credential_payload_read",
  "no_spend_change",
  "secrets_included: false",
  "assertNoSecretBearingFields",
  "capabilityEnvelopeSecretPolicy",
]) {
  assert(script.includes(expected), `apply authorization script must include ${expected}`);
}

for (const expected of [
  "CREATE TABLE IF NOT EXISTS `capability_apply_authorization_policy_registry`",
  "ads_provider_governance_snapshot_record_apply_v1",
  "resource_manifest_create_google_drive_apply_v1",
  "allow_external_write",
  "allow_credential_binding",
  "requires_same_cycle_dry_run",
  "uploadNewFile",
  "getFileMetadata",
  "overwrite_allowed",
  "file_content_read_allowed",
  "secrets_included",
  "ON DUPLICATE KEY UPDATE",
]) {
  assert(migration.includes(expected), `dynamic policy migration must include ${expected}`);
}

assert(!script.includes("APPLY_AUTHORIZABLE_CAPABILITIES"), "apply authorization must not use hardcoded capability sets");
assert(!script.includes("String(row.app_key || \"\") !== \"platform_orchestration\""), "apply authorization must not hardcode one app");
assert(runner.includes("902_sprint68_dynamic_capability_apply_authorization_policy.sql"), "governed migration runner must allowlist the dynamic policy migration");
assert(adminCli.includes("capability_resolution_envelope_apply_authorize"), "admin shell alias must expose apply authorization tool");
assert(gptTools.includes('name: "capability_resolution_envelope_apply_authorize"'), "admin GPT registry must expose apply authorization as a governed virtual tool");
assert(gptTools.includes("authorizeCapabilityResolutionEnvelopeApply"), "admin GPT dispatcher must call the existing dynamic apply authorization service");
assert(gptTools.includes("envelopeId: String(args?.envelope_id"), "admin GPT tool must map the public envelope_id field to the service contract");
assert(gptTools.includes('"state_changing", "approval_required", "readback"'), "admin GPT apply authorization tool must declare mutation governance and readback");
assert(gptTools.includes('"no_provider_call", "no_external_write", "no_secrets"'), "admin GPT apply authorization tool must preserve no-provider and no-secret boundaries");
assert(snapshotRecord.includes("capability_envelope_apply_not_allowed"), "snapshot record apply must reject envelopes without apply_allowed");
assert(snapshotRecord.includes("Number(envelope.apply_allowed) !== 1"), "snapshot record apply must check apply_allowed before insert");
assert.doesNotMatch(script, /fetch\(|axios|GoogleAdsApi|GoogleAdsClient|mutateCampaignBudgets|child_process|exec\(|spawn\(/i, "apply authorization must not call providers or spawn processes");
assert.doesNotMatch(script, /decryptToken|value_ciphertext|encrypted_credentials|private_key|oauth_token|client_secret|refresh_token/i, "apply authorization must not read credential payloads");

const noCredentialPolicy = {
  policy_key: "test_no_credential_policy",
  allow_credential_binding: 0,
  allow_no_credential_binding: 1,
};
assert.doesNotThrow(
  () => validateCredentialEnvelope({
    selected_source: {
      credential_source_candidates: ["platform_managed"],
      active_credential_binding_count: 0,
    },
  }, noCredentialPolicy),
  "platform-managed transport metadata must not be treated as an active credential binding",
);
assert.throws(
  () => validateCredentialEnvelope({
    selected_source: {
      credential_source_candidates: ["none"],
      active_credential_binding_count: 1,
    },
  }, noCredentialPolicy),
  (err) => err?.code === "capability_envelope_apply_credential_binding_not_allowed",
  "an active binding must remain blocked when credential bindings are forbidden",
);

const credentialRequiredPolicy = {
  policy_key: "test_credential_required_policy",
  allow_credential_binding: 1,
  allow_no_credential_binding: 0,
};
assert.throws(
  () => validateCredentialEnvelope({
    selected_source: {
      credential_source_candidates: ["tenant_connection"],
      active_credential_binding_count: 0,
    },
  }, credentialRequiredPolicy),
  (err) => err?.code === "capability_envelope_apply_requires_credential_binding",
  "zero active bindings must remain blocked when the policy requires a credential binding",
);
assert.doesNotThrow(
  () => validateCredentialEnvelope({
    selected_source: {
      credential_source_candidates: ["tenant_connection"],
      active_credential_binding_count: 1,
    },
  }, credentialRequiredPolicy),
  "an active binding must pass when the policy explicitly permits credential-backed execution",
);

console.log("capability envelope apply authorization is dynamic-policy driven, no-provider, and no-secret");
