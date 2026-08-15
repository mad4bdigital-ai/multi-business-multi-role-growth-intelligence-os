import assert from "node:assert/strict";
import { resolvePlatformConfiguration, PLATFORM_CONFIGURATION_RESOLVER_VERSION, __test__ } from "./platformConfigurationResolver.js";

const definition = {
  config_key: "operation.policy",
  schema_json: { type: "object", required: ["allow_write", "max_resources"] },
  allowed_scope_types_json: ["platform", "tenant", "workspace", "route"],
  merge_operator: "priority_replace",
  fallback_policy: "deny",
};

const baseBindings = [
  { binding_id: "platform-1", config_key: "operation.policy", source_registry: "platform_catalog", scope_type: "platform", scope_ref: "*", precedence: 100, lifecycle: "active", payload_json: { allow_write: false, max_resources: 10 } },
  { binding_id: "tenant-1", config_key: "operation.policy", source_registry: "growth_control", scope_type: "tenant", scope_ref: "tenant-a", precedence: 200, lifecycle: "active", payload_json: { allow_write: false, max_resources: 5 } },
];

const resolved = resolvePlatformConfiguration({ definition, bindings: baseBindings, context: { tenant_id: "tenant-a" } });
assert.equal(resolved.decision, "resolved");
assert.deepEqual(resolved.resolved_value, { allow_write: false, max_resources: 5 });
assert.equal(resolved.lineage.length, 2);
assert.equal(resolved.resolver_version, PLATFORM_CONFIGURATION_RESOLVER_VERSION);
assert.equal(resolved.mutation_allowed, false);
assert.equal(resolved.production_activation_allowed, false);
assert.equal(resolved.secrets_included, false);

const notFound = resolvePlatformConfiguration({ definition, bindings: baseBindings, context: { tenant_id: "tenant-missing" } });
assert.equal(notFound.decision, "resolved");
assert.deepEqual(notFound.resolved_value, { allow_write: false, max_resources: 10 });

const ambiguous = resolvePlatformConfiguration({
  definition: { ...definition, merge_operator: "block_on_ambiguity" },
  bindings: [
    { ...baseBindings[0], payload_json: { allow_write: false, max_resources: 10 } },
    { binding_id: "platform-2", ...baseBindings[0], payload_json: { allow_write: true, max_resources: 10 } },
  ],
  context: {},
});
assert.equal(ambiguous.decision, "ambiguous");
assert.equal(ambiguous.reason, "CONFIG_CONFLICT");

const denyWins = resolvePlatformConfiguration({
  definition: { config_key: "operation.write", schema_json: { type: "boolean" }, allowed_scope_types_json: ["platform", "tenant"], merge_operator: "deny_wins", fallback_policy: "deny" },
  bindings: [
    { ...baseBindings[0], config_key: "operation.write", payload_json: false },
    { binding_id: "tenant-deny", ...baseBindings[1], config_key: "operation.write", payload_json: true },
  ],
  context: { tenant_id: "tenant-a" },
});
assert.equal(denyWins.decision, "resolved");
assert.equal(denyWins.resolved_value, false);

const minimum = resolvePlatformConfiguration({
  definition: { config_key: "quota.max", schema_json: { type: "number" }, allowed_scope_types_json: ["platform", "tenant"], merge_operator: "minimum", fallback_policy: "deny" },
  bindings: [
    { binding_id: "q-platform", config_key: "quota.max", source_registry: "platform_catalog", scope_type: "platform", scope_ref: "*", precedence: 100, lifecycle: "active", payload_json: 100 },
    { binding_id: "q-tenant", config_key: "quota.max", source_registry: "growth_control", scope_type: "tenant", scope_ref: "tenant-a", precedence: 200, lifecycle: "active", payload_json: 25 },
  ],
  context: { tenant_id: "tenant-a" },
});
assert.equal(minimum.decision, "resolved");
assert.equal(minimum.resolved_value, 25);

const legacy = resolvePlatformConfiguration({
  definition: { ...definition, fallback_policy: "legacy_compatibility" },
  bindings: [],
  context: { tenant_id: "tenant-a" },
  legacyValue: { allow_write: false, max_resources: 2 },
});
assert.equal(legacy.decision, "resolved");
assert.equal(legacy.resolved_value.max_resources, 2);
assert.equal(legacy.lineage.length, 0);

const expired = resolvePlatformConfiguration({
  definition,
  bindings: [{ ...baseBindings[0], effective_to: "2020-01-01T00:00:00.000Z" }],
  context: {},
  now: new Date("2026-08-15T00:00:00.000Z"),
});
assert.equal(expired.decision, "not_found");

assert.deepEqual(__test__.flatten({ a: { b: 1 } }), { "a.b": 1 });
assert.equal(JSON.stringify(resolved).includes("secret-raw-value"), false);
console.log(JSON.stringify({ ok: true, contract: "mad4b.platform-configuration-resolver-regression.v1", cases: 8, resolver_version: PLATFORM_CONFIGURATION_RESOLVER_VERSION, secrets_included: false }));
