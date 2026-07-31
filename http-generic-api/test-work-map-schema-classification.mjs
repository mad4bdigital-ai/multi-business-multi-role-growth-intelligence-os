import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSchemaIntelligenceMaps } from "./scripts/platform-work-map-schema-intelligence.mjs";
import { validateSchemaClassification } from "./scripts/work-map-schema-classification.mjs";

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
    rules: [{
      rule_key: "canonical_identifier_registries",
      match: { prefixes: ["canonical_identifier_"] },
      domain: "Platform resources & graph",
      existing_map_refs: ["platform-resource-graph-map", "policy-authority-map", "data-model-domain-map"],
      rationale: "Canonical identifier registries extend the existing resource and authority maps."
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
    "CREATE TABLE canonical_identifier_contract_registry (id BIGINT PRIMARY KEY);",
    "CREATE TABLE novel_unmapped_dimension_records (id BIGINT PRIMARY KEY);",
  ].join("\n"));
  return root;
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
  const generated = buildSchemaIntelligenceMaps({ repoRoot: root });
  assert.equal(generated.metrics.total_discovered_objects, 3);
  assert.equal(generated.metrics.unresolved_unclassified_objects, 1);
  assert.match(generated.maps["work-map-coverage-matrix.md"], /novel_unmapped_dimension_records/);
  assert.match(generated.maps["platform-resource-graph-map.md"], /canonical_identifier_contract_registry/);

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
    object_name: "novel_unmapped_dimension_records",
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
