import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateRegistryContract } from "./scripts/work-map-schema-classification-contract.mjs";

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function familyRule(overrides = {}) {
  return {
    rule_key: "canonical_identifier_registries",
    scope: "governed_family",
    match: { prefixes: ["canonical_identifier_"] },
    family_owner: "platform-architecture",
    future_object_policy: "same_domain_by_contract",
    boundary: "Only canonical identifier registry and binding objects belong to this governed family.",
    positive_examples: ["canonical_identifier_contract_registry"],
    negative_examples: ["customer_identifier_records"],
    domain: "Platform resources & graph",
    existing_map_refs: ["platform-resource-graph-map"],
    rationale: "Canonical identifier registries extend the platform resource graph.",
    ...overrides,
  };
}

function exactRule(name, overrides = {}) {
  return {
    rule_key: `exact_${name}`,
    scope: "bounded_exact",
    match: { exact_names: [name] },
    domain: "Governance & authority",
    existing_map_refs: ["policy-authority-map"],
    rationale: "The fixture object is registered explicitly for schema classification contract testing.",
    ...overrides,
  };
}

function namespace() {
  return {
    namespace_key: "growth_control_schema",
    prefixes: ["growth_control_", "v_growth_control_"],
    owner: "platform-architecture",
    future_object_policy: "require_explicit_registry_rule",
    rationale: "Growth Control schema requires exact object registration before keyword classification may be accepted."
  };
}

function fixture(sql, registry) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "work-map-schema-contract-"));
  write(root, "http-generic-api/migrations/001_fixture.sql", sql);
  write(root, ".specify/work-map-schema-classification-registry.json", JSON.stringify(registry, null, 2));
  return root;
}

{
  const objectName = "growth_control_config_versions";
  const registry = {
    rules: [familyRule(), exactRule(objectName)],
    explicit_only_namespaces: [namespace()],
  };
  const root = fixture([
    "CREATE TABLE canonical_identifier_contract_registry (id BIGINT PRIMARY KEY);",
    `CREATE TABLE ${objectName} (id BIGINT PRIMARY KEY);`,
  ].join("\n"), registry);
  const previousCwd = process.cwd();
  process.chdir(os.tmpdir());
  let result;
  try {
    result = validateRegistryContract({ root });
  } finally {
    process.chdir(previousCwd);
  }
  assert.equal(result.ok, true);
  assert.equal(result.explicit_only_schema_objects, 1);
}

{
  const objectName = "growth_control_debug_snapshots";
  const registry = {
    rules: [familyRule()],
    explicit_only_namespaces: [namespace()],
  };
  const root = fixture(`CREATE TABLE ${objectName} (id BIGINT PRIMARY KEY);`, registry);
  const result = validateRegistryContract({ root });
  assert(result.findings.some((row) => row.type === "explicit_only_namespace_object_unregistered" && row.object_name === objectName));
}

{
  const objectName = "growth_control_debug_snapshots";
  const broadRule = familyRule({
    rule_key: "growth_control_catch_all",
    match: { prefixes: ["growth_control_"] },
    positive_examples: [objectName],
    negative_examples: ["growth_dashboard_metrics"],
  });
  const registry = {
    rules: [broadRule],
    explicit_only_namespaces: [namespace()],
  };
  const root = fixture(`CREATE TABLE ${objectName} (id BIGINT PRIMARY KEY);`, registry);
  const result = validateRegistryContract({ root });
  assert(result.findings.some((row) => row.type === "explicit_only_namespace_requires_exact_match" && row.object_name === objectName));
}

{
  const objectName = "canonical_identifier_contract_registry";
  const registry = {
    rules: [familyRule(), exactRule(objectName)],
    explicit_only_namespaces: [],
  };
  const root = fixture(`CREATE TABLE ${objectName} (id BIGINT PRIMARY KEY);`, registry);
  const result = validateRegistryContract({ root });
  assert(result.findings.some((row) => row.type === "schema_classification_rule_overlap" && row.object_name === objectName));
}

{
  const invalidFamily = familyRule({ boundary: "too short" });
  const registry = { rules: [invalidFamily], explicit_only_namespaces: [] };
  const root = fixture("CREATE TABLE canonical_identifier_contract_registry (id BIGINT PRIMARY KEY);", registry);
  const result = validateRegistryContract({ root });
  assert(result.findings.some((row) => row.type === "governed_family_rule_missing_boundary"));
}

console.log("work map schema classification contract tests passed");
