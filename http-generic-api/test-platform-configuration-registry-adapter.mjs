import assert from "node:assert/strict";
import { createPlatformConfigurationRegistryAdapter } from "./platformConfigurationRegistryAdapter.js";

const calls = [];
const pool = {
  async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes("FROM platform_configuration_catalog")) return [[{
      config_key: "operation.policy",
      namespace: "runtime",
      value_type: "json",
      schema_version: 1,
      schema_json: JSON.stringify({ type: "object", required: ["allow_write", "max_resources"] }),
      allowed_scope_types_json: JSON.stringify(["platform", "tenant"]),
      merge_operator: "priority_replace",
      risk_class: "high",
      mutability: "promotion_only",
      fallback_policy: "deny",
      owner_domain: "platform",
      status: "active",
      revision: 1,
      secrets_included: 0,
    }]];
    if (sql.includes("FROM platform_configuration_bindings")) return [[{
      binding_id: "binding-platform",
      config_key: "operation.policy",
      source_registry: "platform_catalog",
      scope_type: "platform",
      scope_ref: "*",
      precedence: 100,
      payload_json: JSON.stringify({ allow_write: false, max_resources: 10 }),
      lifecycle: "active",
      revision: 1,
      secrets_included: 0,
    }]];
    return [{ affectedRows: 1 }];
  },
};

const adapter = createPlatformConfigurationRegistryAdapter({
  pool,
  uuid: () => "11111111-1111-4111-8111-111111111111",
  now: () => new Date("2026-08-15T00:00:00.000Z"),
});
const resolved = await adapter.resolve({ configKey: "operation.policy", context: {} });
assert.equal(resolved.result.decision, "resolved");
assert.equal(resolved.result.resolved_value.allow_write, false);
assert.equal(resolved.evidence.evidence_id, "11111111-1111-4111-8111-111111111111");
assert.equal(resolved.evidence.secrets_included, false);
const insert = calls.at(-1);
assert.match(insert.sql, /INSERT INTO platform_configuration_resolution_evidence/);
assert.equal(insert.sql.includes("payload_json"), false);
assert.equal(insert.sql.includes("raw_payload"), false);
assert.equal(insert.params.some((value) => String(value).includes("secret-raw-value")), false);
assert.equal(calls.some((call) => /LIMIT\s+1/iu.test(call.sql)), false);

const ambiguousPool = {
  async query(sql) {
    if (sql.includes("FROM platform_configuration_catalog")) return [[{ config_key: "operation.policy" }, { config_key: "operation.policy" }]];
    return [[]];
  },
};
await assert.rejects(
  () => createPlatformConfigurationRegistryAdapter({ pool: ambiguousPool }).getDefinition("operation.policy"),
  (error) => error.code === "PLATFORM_CONFIG_DEFINITION_AMBIGUOUS",
);

console.log(JSON.stringify({ ok: true, contract: "mad4b.platform-configuration-registry-adapter-regression.v1", cases: 3, database_mutation_executed: false, production_activation_executed: false, secrets_included: false }));

const legacyPool = {
  async query(sql) {
    if (sql.includes("FROM platform_configuration_catalog")) return [[{
      config_key: "legacy.policy",
      namespace: "runtime",
      value_type: "json",
      schema_json: JSON.stringify({ type: "object", required: ["allow_write", "max_resources"] }),
      allowed_scope_types_json: JSON.stringify(["platform"]),
      merge_operator: "priority_replace",
      fallback_policy: "legacy_compatibility",
      status: "active",
    }]];
    if (sql.includes("FROM platform_configuration_bindings")) return [[]];
    return [{ affectedRows: 1 }];
  },
};
const legacyResolution = await createPlatformConfigurationRegistryAdapter({
  pool: legacyPool,
  legacyAdapter: { async read() { return { present: true, value: { allow_write: false, max_resources: 1 }, secrets_included: false }; } },
  uuid: () => "22222222-2222-4222-8222-222222222222",
}).resolve({ configKey: "legacy.policy", context: {} });
assert.equal(legacyResolution.result.decision, "resolved");
assert.equal(legacyResolution.result.resolved_value.max_resources, 1);
assert.equal(legacyResolution.result.lineage.length, 0);
