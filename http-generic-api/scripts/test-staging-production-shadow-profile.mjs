import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const partition = JSON.parse(readFileSync(new URL("../../docs/staging-write-route-partition-2026-08-14.json", import.meta.url)));
const profile = JSON.parse(readFileSync(new URL("../../docs/staging-production-shadow-profile-2026-08-14.json", import.meta.url)));

assert.equal(profile.contract, "mad4b.staging-production-shadow-profile.v1");
assert.equal(profile.environment, "staging");
assert.equal(profile.route_count, 652);
assert.equal(partition.route_count, profile.route_count);
assert.deepEqual(Object.keys(profile.modes).sort(), ["production-canary", "production-live", "shadow", "staging"]);
assert.equal(profile.modes.shadow.enabled, true);
assert.equal(profile.modes.staging.enabled, true);
assert.equal(profile.modes["production-canary"].enabled, false);
assert.equal(profile.modes["production-live"].enabled, false);
for (const mode of Object.values(profile.modes)) {
  assert.equal(mode.mutation_execution, false);
  assert.equal(mode.provider_calls, false);
  assert.equal(mode.db_apply, false);
  assert.equal(mode.default_request, false);
}
assert.equal(profile.shadow_test.enabled, true);
for (const key of ["mutation_execution", "provider_calls", "credential_payload_reads", "external_send", "db_apply"]) {
  assert.equal(profile.shadow_test[key], false, `${key} must remain disabled`);
}
for (const key of ["promotion_allowed", "production_allowed", "write_activation_allowed", "provider_mutation_allowed", "migration_apply_allowed"]) {
  assert.equal(profile.production_readiness[key], false, `${key} must remain disabled`);
}
for (const key of ["default_request", "approval_required", "ttl_required", "lease_required", "readback_required", "rollback_required", "kill_switch_required"]) {
  assert.equal(profile.partition_policy[key], key === "default_request" ? false : true, `${key} policy mismatch`);
}
assert.equal(profile.safety.secrets_included, false);
assert.equal(profile.safety.production_mutation_performed, false);
assert.equal(profile.safety.staging_mutation_performed, false);
assert.equal(profile.safety.oauth_or_dcr_performed, false);

console.log(JSON.stringify({
  ok: true,
  contract: profile.contract,
  route_count: profile.route_count,
  shadow_enabled: profile.shadow_test.enabled,
  all_mutations_disabled: true,
  production_promotion_allowed: profile.production_readiness.promotion_allowed,
  secrets_included: profile.safety.secrets_included,
}, null, 2));
