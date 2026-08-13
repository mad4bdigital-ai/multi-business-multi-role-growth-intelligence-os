import assert from "node:assert/strict";
import {
  LEGACY_ACTIVATION_CANONICAL_REFERENCES,
  resolveActivationCanonicalReferences,
  resolveCanonicalResourceRegistry,
} from "./canonicalResourceRegistry.js";

const rows = [
  {
    resource_key: "bootstrap",
    path: "system_bootstrap.md",
    resource_type: "document",
    resource_class: "runtime_critical",
    load_strategy: "load_at_activation",
    validation_strategy: "exists_nonempty",
    required_at_activation: 1,
    searchable: 0,
    environment_scope: "all",
    registry_revision: 7,
    metadata_json: "{}",
  },
  {
    resource_key: "knowledge",
    path: "knowledge/example.md",
    resource_type: "document",
    resource_class: "on_demand_searchable",
    load_strategy: "on_demand_search",
    validation_strategy: "exists_nonempty",
    required_at_activation: 0,
    searchable: 1,
    environment_scope: "all",
    registry_revision: 7,
    metadata_json: "{}",
  },
];

const pool = { async query() { return [rows]; } };
const registry = await resolveCanonicalResourceRegistry({ environment_scope: "staging" }, { pool });
assert.equal(registry.ok, true);
assert.equal(registry.source, "sql_canonical_resource_registry");
assert.equal(registry.registry_revision, 7);
assert.equal(registry.activation_resources.length, 1);
assert.equal(registry.searchable_resources.length, 1);

const activation = await resolveActivationCanonicalReferences({ environment_scope: "staging" }, { pool });
assert.deepEqual(activation.references, ["system_bootstrap.md"]);
assert.equal(activation.legacy_fallback_used, false);

const missingTablePool = {
  async query() {
    const error = new Error("Table 'growthOS.canonical_resource_registry' doesn't exist");
    error.code = "ER_NO_SUCH_TABLE";
    throw error;
  },
};
const fallback = await resolveActivationCanonicalReferences({}, { pool: missingTablePool });
assert.equal(fallback.ok, true);
assert.equal(fallback.legacy_fallback_used, true);
assert.deepEqual(fallback.references, [...LEGACY_ACTIVATION_CANONICAL_REFERENCES]);
assert.equal(fallback.parity_required_before_fallback_retirement, true);

const empty = await resolveActivationCanonicalReferences({}, { pool: { async query() { return [[]]; } } });
assert.equal(empty.legacy_fallback_used, true);
assert.deepEqual(empty.references, [...LEGACY_ACTIVATION_CANONICAL_REFERENCES]);

console.log("canonical resource registry tests passed");
