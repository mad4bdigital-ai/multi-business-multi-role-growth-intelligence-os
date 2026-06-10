import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync("scripts/capability-resolution-envelope-apply-authorize.mjs", "utf8");
const adminCli = readFileSync("routes/adminCliRoutes.js", "utf8");
const snapshotRecord = readFileSync("adsProviderGovernanceSnapshotRecord.js", "utf8");

for (const expected of [
  "APPLY_AUTHORIZABLE_CAPABILITIES",
  "ads_provider_governance_snapshot_record",
  "platform_orchestration",
  "ready_for_dispatch",
  "dispatch_allowed = 1",
  "blocking_gap_count = 0",
  "apply_allowed = 1",
  "capability_envelope_apply_capability_not_allowlisted",
  "capability_envelope_apply_requires_no_credential_binding",
  "capability_envelope_apply_credential_binding_not_allowed",
  "no_provider_call",
  "no_credential_payload_read",
  "no_spend_change",
  "secrets_included: false",
]) {
  assert(script.includes(expected), `apply authorization script must include ${expected}`);
}

assert(adminCli.includes("capability_resolution_envelope_apply_authorize"), "admin shell alias must expose apply authorization tool");
assert(snapshotRecord.includes("capability_envelope_apply_not_allowed"), "snapshot record apply must reject envelopes without apply_allowed");
assert(snapshotRecord.includes("Number(envelope.apply_allowed) !== 1"), "snapshot record apply must check apply_allowed before insert");
assert.doesNotMatch(script, /fetch\(|axios|GoogleAdsApi|GoogleAdsClient|mutateCampaignBudgets|child_process|exec\(|spawn\(/i, "apply authorization must not call providers or spawn processes");
assert.doesNotMatch(script, /decryptToken|value_ciphertext|encrypted_credentials|private_key|oauth_token|client_secret|refresh_token/i, "apply authorization must not read credential payloads");

console.log("capability envelope apply authorization is allowlisted, no-credential, and no-provider");
