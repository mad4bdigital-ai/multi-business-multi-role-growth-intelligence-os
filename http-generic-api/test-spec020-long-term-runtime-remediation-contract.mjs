import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const contractRoot = path.join(root, "../specs/020-platform-resource-identity-brand-governance/contracts");
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(contractRoot, name), "utf8"));
const readText = (name) => fs.readFileSync(path.join(contractRoot, name), "utf8");

const authority = readJson("runtime-db-write-authority-profiles.json");
const environment = readJson("runtime-environment-invariant-contract.json");
const resilience = readJson("control-plane-persistence-resilience-contract.json");
const capability = readJson("capability-identity-certification-contract.json");

for (const contract of [authority, environment, resilience, capability]) {
  assert.equal(contract.status, "prepared-only");
  assert.equal(contract.authority, "shadow-library-only");
  assert.equal(contract.runtime_mutation_allowed, false);
  assert.equal(contract.production_activation_allowed, false);
  assert.equal(contract.credentials_read_allowed, false);
  assert.equal(contract.secrets_included, false);
}

assert.equal(authority.grant_mutation_allowed, false);
assert.equal(authority.migration_apply_allowed, false);
assert.equal(authority.registry_policy.generic_runtime_principal_fallback, false);
assert.equal(authority.registry_policy.schema_wide_privileges_forbidden, true);
assert.equal(authority.registry_policy.global_privileges_forbidden, true);
assert.equal(authority.registry_policy.grant_option_forbidden, true);

const profileKeys = new Set(authority.profiles.map((profile) => profile.profile_key));
for (const required of [
  "runtime_inventory_writer",
  "session_continuity_writer",
  "identity_oauth_writer",
  "observability_sink_writer",
  "runtime_chunk_writer",
  "governance_writer",
]) assert.ok(profileKeys.has(required), `${required} profile is required`);

const bindings = authority.profiles.flatMap((profile) => profile.bindings.map((binding) => ({
  profile_key: profile.profile_key,
  table_name: binding.table_name,
  allowed_operations: binding.allowed_operations,
})));
const bindingKeys = bindings.map((binding) => `${binding.profile_key}:${binding.table_name}`);
assert.equal(new Set(bindingKeys).size, bindingKeys.length, "authority bindings must be unique");
assert.ok(bindings.some((binding) => binding.profile_key === "session_continuity_writer" && binding.table_name === "customer_sessions"));
assert.ok(bindings.some((binding) => binding.profile_key === "session_continuity_writer" && binding.table_name === "gpt_session_turns"));
assert.ok(bindings.some((binding) => binding.profile_key === "identity_oauth_writer" && binding.table_name === "tenant_gpt_oauth_authorization_codes"));
assert.ok(bindings.some((binding) => binding.profile_key === "runtime_chunk_writer" && binding.table_name === "governed_tool_response_chunks"));
assert.ok(bindings.every((binding) => binding.allowed_operations.includes("SELECT")));

assert.equal(environment.invariant, "requested_environment == resolved_environment == credential_environment == provider_host_environment");
assert.equal(environment.routing_rules.find((rule) => rule.environment_key === "staging").default_for_custom_gpt, true);
assert.equal(environment.routing_rules.find((rule) => rule.environment_key === "production").explicit_selection_required, true);
for (const failure of [
  "environment_chain_mismatch",
  "cross_environment_credential_namespace",
  "cross_environment_provider_host",
  "implicit_production_selection",
  "production_to_staging_fallback",
  "staging_to_production_fallback",
]) assert.ok(environment.fail_closed_conditions.includes(failure), `${failure} must fail closed`);
assert.equal(environment.same_cycle_readback.required, true);

assert.equal(resilience.execution_outcomes.operation_status_is_independent_from_payload_status, true);
assert.equal(resilience.execution_outcomes.replay_required_when_payload_persistence_fails, false);
assert.equal(resilience.bounded_summary.required_on_large_payload_failure, true);
assert.equal(resilience.pagination_contract.silent_truncation_forbidden, true);
assert.equal(resilience.pagination_contract.maximum_page_size, 200);
for (const forbidden of ["credentials", "access_tokens", "authorization_codes", "unbounded_payload"]) {
  assert.ok(resilience.bounded_summary.must_exclude.includes(forbidden));
}

assert.deepEqual(capability.identity_input_tuple, ["tool_name", "parent_action_key", "endpoint_key", "resource_scope"]);
assert.equal(capability.ambiguity_policy.tool_name_alone_is_sufficient, false);
assert.equal(capability.ambiguity_policy.ambiguous_endpoint_binding_is_fail_closed, true);
assert.equal(capability.certification_contract.dispatch_allowed_manual_override, false);
assert.equal(capability.certification_contract.dispatch_allowed_without_readback, false);
assert.equal(capability.certification_contract.dispatch_allowed_without_resource_binding, false);
assert.equal(capability.certification_contract.dispatch_allowed_without_certification, false);
assert.ok(capability.failure_codes.includes("CAPABILITY_IDENTITY_MISSING"));
assert.ok(capability.failure_codes.includes("CAPABILITY_AMBIGUOUS"));
assert.ok(capability.failure_codes.includes("CAPABILITY_DISPATCH_NOT_ALLOWED"));

for (const file of [
  "runtime-db-write-authority-profiles.json",
  "runtime-environment-invariant-contract.json",
  "control-plane-persistence-resilience-contract.json",
  "capability-identity-certification-contract.json",
]) {
  const serialized = readText(file);
  for (const executableMutation of ["GRANT ", "REVOKE ", "ALTER TABLE", "CREATE TABLE", "DROP TABLE", "migration apply"]) {
    assert.ok(!serialized.includes(`\"sql\": \"${executableMutation}`), `${file} must not contain executable ${executableMutation}`);
  }
}

console.log("Spec 020 long-term runtime remediation contract guard passed");
