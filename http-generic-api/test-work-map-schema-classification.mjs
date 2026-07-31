import assert from "node:assert/strict";
import {
  applySchemaClassificationRegistry,
  validateSchemaClassification,
} from "./scripts/work-map-schema-classification.mjs";

const indexText = `# Maps\n\n## Maps\n\n- [platform resource graph map](./platform-resource-graph-map.md)\n- [policy authority map](./policy-authority-map.md)\n- [repository development map](./repository-development-map.md)\n`;

function coverage(...objects) {
  return `# Coverage\n\n## Uncategorized schema objects\n\n${objects.map((row) => `- \`${row.name}\` (${row.type})`).join("\n") || "- None."}\n`;
}

function registry(overrides = {}) {
  return {
    schema_version: 1,
    registry_key: "fixture",
    default_disposition: "blocked",
    rules: [
      {
        rule_key: "container",
        match: { prefixes: ["container_"] },
        domain: "Platform resources & graph",
        existing_map_refs: ["platform-resource-graph-map", "policy-authority-map"],
        rationale: "Container resources extend the existing platform graph and authority maps.",
      },
      {
        rule_key: "repository",
        match: { prefixes: ["repository_"] },
        domain: "Repository & development",
        existing_map_refs: ["repository-development-map"],
        rationale: "Repository resources belong to the existing repository development map.",
      },
    ],
    intentional_unclassified: [],
    secrets_included: false,
    ...overrides,
  };
}

{
  const result = validateSchemaClassification({
    classificationRegistry: registry(),
    indexText,
    coverageText: coverage(
      { name: "container_projection_runs", type: "table" },
      { name: "repository_automation_runs", type: "table" },
    ),
  });
  assert.equal(result.ok, true);
  assert.equal(result.classified.length, 2);
  assert.equal(result.unresolved.length, 0);
}

{
  const result = validateSchemaClassification({
    classificationRegistry: registry(),
    indexText,
    coverageText: coverage({ name: "unknown_surface", type: "view" }),
  });
  assert.equal(result.ok, false);
  assert(result.findings.some((row) => row.type === "unclassified_schema_object"));
}

{
  const overlapping = registry({
    rules: [
      ...registry().rules,
      {
        rule_key: "container_duplicate",
        match: { prefixes: ["container_projection_"] },
        domain: "Platform resources & graph",
        existing_map_refs: ["platform-resource-graph-map"],
        rationale: "This fixture intentionally overlaps another classification rule for testing.",
      },
    ],
  });
  const result = validateSchemaClassification({
    classificationRegistry: overlapping,
    indexText,
    coverageText: coverage({ name: "container_projection_runs", type: "table" }),
  });
  assert.equal(result.ok, false);
  assert(result.findings.some((row) => row.type === "ambiguous_schema_classification"));
}

{
  const intentional = registry({
    intentional_unclassified: [
      {
        object_name: "experimental_surface",
        object_type: "view",
        owner: "platform-architecture",
        rationale: "The experimental surface is deliberately isolated while its bounded domain is reviewed.",
        nearest_existing_map_refs: ["platform-resource-graph-map", "policy-authority-map"],
        review_gate: "architecture-review-2099",
        expires_on: "2099-01-01",
      },
    ],
  });
  const result = validateSchemaClassification({
    classificationRegistry: intentional,
    indexText,
    coverageText: coverage({ name: "experimental_surface", type: "view" }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.intentional_unclassified.length, 1);
}

{
  const expired = registry({
    intentional_unclassified: [
      {
        object_name: "experimental_surface",
        object_type: "view",
        owner: "platform-architecture",
        rationale: "The experimental surface was deliberately isolated but the review window expired.",
        nearest_existing_map_refs: ["platform-resource-graph-map"],
        review_gate: "architecture-review-expired",
        expires_on: "2020-01-01",
      },
    ],
  });
  const result = validateSchemaClassification({
    classificationRegistry: expired,
    indexText,
    coverageText: coverage({ name: "experimental_surface", type: "view" }),
  });
  assert.equal(result.ok, false);
  assert(result.findings.some((row) => row.type === "intentional_exception_expired"));
}

{
  const baseRegistry = {
    signature: { map_ids: ["platform-resource-graph-map"], domain_ids: ["platform-resources-and-graph"] },
    fingerprint: "base",
    maps: [],
    domains: [],
    uncategorized_objects: [{ name: "container_projection_runs", type: "table" }],
    taxonomy_gap_clusters: [{ id: "container", count: 1, sample: ["container_projection_runs"] }],
  };
  const effective = applySchemaClassificationRegistry(baseRegistry, {
    classificationRegistry: registry(),
    indexText,
    coverageText: coverage({ name: "container_projection_runs", type: "table" }),
  });
  assert.equal(effective.uncategorized_objects.length, 0);
  assert.equal(effective.globally_classified_schema_objects.length, 1);
  assert.equal(effective.taxonomy_gap_clusters.length, 0);
}

{
  const repositoryResult = validateSchemaClassification();
  assert.equal(repositoryResult.ok, true);
  assert.equal(repositoryResult.unresolved.length, 0);
  assert.equal(repositoryResult.classification_coverage_percent, 100);
}

console.log("work map schema classification tests passed");
