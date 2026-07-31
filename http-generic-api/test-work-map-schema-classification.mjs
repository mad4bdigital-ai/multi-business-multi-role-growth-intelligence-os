import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSchemaIntelligenceMaps } from "./scripts/platform-work-map-schema-intelligence.mjs";
import { validateSchemaClassification } from "./scripts/work-map-schema-classification.mjs";

const REGISTRY_OBJECT = "quasar_zeta_rows";
const UNRESOLVED_OBJECT = "novel_unmapped_dimension_records";

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function registry(intentional = []) {
  return {
    schema_version: 1,
    registry_key: "work_map_schema_classification_registry_v1",
    default_disposition: "blocked",
    explicit_only_namespaces: [],
    rules: [{
      rule_key: "quasar_fixture_objects",
      scope: "governed_family",
      match: { prefixes: ["quasar_"] },
      family_owner: "platform-architecture",
      future_object_policy: "same_domain_by_contract",
      boundary: "Only synthetic quasar fixture objects created by this isolated regression test belong to this family.",
      positive_examples: [REGISTRY_OBJECT],
      negative_examples: ["customer_records"],
      domain: "Platform resources & graph",
      existing_map_refs: ["platform-resource-graph-map", "policy-authority-map", "data-model-domain-map"],
      rationale: "Synthetic quasar fixture objects prove registry classification independently from production keyword rules."
    }],
    intentional_unclassified: intentional,
    secrets_included: false
  };
}

function fixture(intentional = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "work-map-schema-classification-"));
  write(root, "memory_schema.json", JSON.stringify({ type: "object", properties: {} }));
  write(root, ".specify/work-map-schema-classification-registry.json", JSON.stringify(registry(intentional), null, 2));
  write(root, "http-generic-api/migrations/001_fixture.sql", [
    "CREATE TABLE users (id BIGINT PRIMARY KEY);",
    `CREATE TABLE ${REGISTRY_OBJECT} (id BIGINT PRIMARY KEY);`,
    `CREATE TABLE ${UNRESOLVED_OBJECT} (id BIGINT PRIMARY KEY);`,
  ].join("\n"));
  return root;
}

function classificationFor(generated, objectName) {
  const row = generated.catalog.find((candidate) => candidate.object_name === objectName);
  assert(row, `Expected generated catalog to contain ${objectName}`);
  return row;
}

const indexText = [
  "# Dynamic Platform Work Maps",
  "",
  "## Maps",
  "",
  "- [data model domain map](./data-model-domain-map.md)",
  "- [platform resource graph map](./platform-resource-graph-map.md)",
  "- [policy authority map](./policy-authority-map.md)",
].join("\n");

{
  const root = fixture();
  const previousCwd = process.cwd();
  process.chdir(os.tmpdir());
  let generated;
  try {
    generated = buildSchemaIntelligenceMaps({ repoRoot: root });
  } finally {
    process.chdir(previousCwd);
  }

  assert.equal(generated.metrics.total_discovered_objects, 3);
  assert.equal(generated.metrics.unresolved_unclassified_objects, 1);
  assert.equal(generated.metrics.registry_classified_objects, 1);

  const builtin = classificationFor(generated, "users");
  assert.equal(builtin.classification_source, "builtin");

  const registered = classificationFor(generated, REGISTRY_OBJECT);
  assert.equal(registered.classification_source, "registry");
  assert.equal(registered.matched_rule, "quasar_fixture_objects");
  assert.equal(registered.domain, "Platform resources & graph");

  const unresolved = classificationFor(generated, UNRESOLVED_OBJECT);
  assert.equal(unresolved.classification_source, "unresolved");
  assert.equal(unresolved.matched_rule, null);
  assert.equal(unresolved.domain, null);

  assert.match(generated.maps["work-map-coverage-matrix.md"], new RegExp(UNRESOLVED_OBJECT));
  assert.match(generated.maps["platform-resource-graph-map.md"], new RegExp(REGISTRY_OBJECT));

  const result = validateSchemaClassification({
    root,
    indexText,
    coverageText: generated.maps["work-map-coverage-matrix.md"],
    classificationRegistry: registry(),
  });
  assert(result.findings.some((row) => row.type === "unresolved_schema_objects_forbidden"));
}

{
  const exception = {
    object_name: UNRESOLVED_OBJECT,
    object_type: "table",
    owner: "platform-architecture",
    rationale: "Temporary bounded exception while existing map reuse and taxonomy extension are reviewed.",
    nearest_existing_map_refs: ["data-model-domain-map", "platform-resource-graph-map"],
    review_gate: "work-map-taxonomy-closeout",
    expires_on: "2099-12-31"
  };
  const root = fixture([exception]);
  const generated = buildSchemaIntelligenceMaps({ repoRoot: root });
  assert.equal(generated.metrics.unresolved_unclassified_objects, 0);
  assert.equal(generated.metrics.intentional_unclassified_objects, 1);
  assert.equal(classificationFor(generated, REGISTRY_OBJECT).classification_source, "registry");
  assert.equal(classificationFor(generated, UNRESOLVED_OBJECT).classification_source, "intentional_unclassified");
  assert.match(generated.maps["work-map-coverage-matrix.md"], /Intentionally unclassified schema objects/);

  const result = validateSchemaClassification({
    root,
    indexText,
    coverageText: generated.maps["work-map-coverage-matrix.md"],
    classificationRegistry: registry([exception]),
  });
  assert.deepEqual(result.findings, []);
}

{
  const root = fixture();
  const generated = buildSchemaIntelligenceMaps({ repoRoot: root });
  const badRegistry = registry();
  badRegistry.rules[0].existing_map_refs = ["missing-map"];
  const result = validateSchemaClassification({
    root,
    indexText,
    coverageText: generated.maps["work-map-coverage-matrix.md"],
    classificationRegistry: badRegistry,
  });
  assert(result.findings.some((row) => row.type === "classification_rule_unknown_map_ref"));
}

console.log("work map schema classification tests passed");
