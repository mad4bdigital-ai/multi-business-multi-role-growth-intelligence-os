import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildScaffoldManifest } from "./scripts/spec-kit-work-map-integration-gate.mjs";
import {
  buildEffectiveWorkMapRegistry,
  validateGovernedRepository,
} from "./scripts/spec-kit-work-map-governance-gate.mjs";

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "work-map-governance-"));
  const policy = {
    schema_version: 1,
    policy_key: "fixture",
    enforcement_mode: "fail_closed",
    spec_root: "specs",
    work_map_root: "docs/work-maps",
    work_map_index: "README.md",
    coverage_matrix: "work-map-coverage-matrix.md",
    intentional_unclassified_registry: ".specify/work-map-intentional-unclassified.json",
    manifest_filename: "work-map-integration.json",
    template_filename: "work-map-integration-template.json",
    review_states: ["draft", "ready_for_implementation"],
    decision_states: ["needs_analysis", "integrate", "reuse", "extend", "not_applicable", "deferred_with_risk", "blocked"],
    taxonomy_gap_dispositions: ["needs_analysis", "covered_by_existing_map", "extend_existing_map_or_taxonomy", "new_work_map_candidate", "taxonomy_backlog", "not_relevant_to_feature"],
    map_reuse_strategy: {
      minimum_existing_map_assessments_for_new_candidate: 2,
      new_map_candidate_implementation_blocked: true,
      separate_approval_required: true,
    },
    minimum_rationale_length: 24,
    implementation_exempt_prefixes: ["specs", "docs"],
  };
  write(root, ".specify/spec-kit-work-map-integration-policy.json", JSON.stringify(policy));
  write(root, ".specify/work-map-intentional-unclassified.json", JSON.stringify({
    schema_version: 1,
    policy_key: "fixture",
    default_disposition: "forbidden",
    entries: [],
    secrets_included: false,
  }));
  write(root, "docs/work-maps/README.md", `# Dynamic Platform Work Maps\n\n> Source hash: \`${"a".repeat(64)}\`\n\n## Maps\n\n- [platform resource graph map](./platform-resource-graph-map.md)\n- [policy authority map](./policy-authority-map.md)\n`);
  write(root, "docs/work-maps/platform-resource-graph-map.md", "# Platform Resource Graph\n");
  write(root, "docs/work-maps/policy-authority-map.md", "# Policy Authority\n");
  write(root, "docs/work-maps/work-map-coverage-matrix.md", `# Coverage\n\n> Source hash: \`${"b".repeat(64)}\`\n\n## Domain coverage\n\n| Domain | Tables | Views | Generated maps | Status |\n|---|---:|---:|---|---|\n| Platform resources & graph | 1 | 0 | \`platform-resource-graph-map.md\` | covered |\n| Governance & authority | 1 | 0 | \`policy-authority-map.md\` | covered |\n\n## Uncategorized schema objects\n\n- \`container_projection_runs\` (table)\n`);
  write(root, "specs/001-example/spec.md", "# Example\n");
  return { root, policy };
}

function finalize(manifest) {
  const apply = (rows) => {
    for (const row of Object.values(rows)) {
      row.decision = "not_applicable";
      row.rationale = "This fixture explicitly proves the dimension is outside the bounded test feature scope.";
      row.owner = "platform-architecture";
      row.evidence_refs = row.evidence_refs?.length ? row.evidence_refs : ["fixture-evidence"];
      row.non_applicability_evidence = ["fixture-scope-review"];
    }
  };
  apply(manifest.work_map_decisions);
  apply(manifest.domain_decisions);
  for (const row of Object.values(manifest.dimension_discovery.registry_gap_clusters || {})) {
    row.disposition = "covered_by_existing_map";
    row.rationale = "The fixture gap is explicitly covered by the existing platform resource graph map.";
    row.owner = "platform-architecture";
    row.evidence_refs = ["docs/work-maps/platform-resource-graph-map.md"];
  }
  manifest.review_state = "ready_for_implementation";
  manifest.dimension_discovery.unresolved = [];
  manifest.dimension_discovery.no_new_dimensions_rationale = "All discovered dimensions are represented by the existing fixture maps and no additional map is necessary.";
  manifest.implementation_readiness = {
    status: "ready",
    blocking_dimensions: [],
    reviewed_by: "platform-architecture",
    evidence_refs: ["fixture-readiness-review"],
  };
  return manifest;
}

{
  const { root, policy } = fixture();
  const result = validateGovernedRepository({
    root,
    policy,
    changedFiles: ["specs/001-example/spec.md"],
    newFeatures: ["001-example"],
    implementationChanged: false,
  });
  assert.equal(result.ok, false);
  assert(result.findings.some((row) => row.type === "new_spec_kit_missing_work_map_integration_manifest"));
}

{
  const { root, policy } = fixture();
  const { registry } = buildEffectiveWorkMapRegistry({ root, policy });
  const manifest = finalize(buildScaffoldManifest("001-example", {
    root,
    policy,
    registry,
    owner: "platform-architecture",
  }));
  write(root, "specs/001-example/work-map-integration.json", JSON.stringify(manifest));
  const result = validateGovernedRepository({
    root,
    policy,
    changedFiles: ["specs/001-example/spec.md", "runtime/example.js"],
    newFeatures: ["001-example"],
    implementationChanged: true,
  });
  assert.equal(result.ok, true, JSON.stringify(result.findings));

  delete manifest.work_map_decisions[Object.keys(manifest.work_map_decisions)[0]];
  write(root, "specs/001-example/work-map-integration.json", JSON.stringify(manifest));
  const missing = validateGovernedRepository({
    root,
    policy,
    changedFiles: ["specs/001-example/spec.md", "runtime/example.js"],
    newFeatures: ["001-example"],
    implementationChanged: true,
  });
  assert.equal(missing.ok, false);
  assert(missing.findings.some((row) => row.type === "missing_work_map_decisions"));
}

{
  const { root, policy } = fixture();
  const { registry } = buildEffectiveWorkMapRegistry({ root, policy });
  const manifest = finalize(buildScaffoldManifest("001-example", {
    root,
    policy,
    registry,
    owner: "platform-architecture",
  }));
  manifest.registry.fingerprint = "stale";
  write(root, "specs/001-example/work-map-integration.json", JSON.stringify(manifest));
  const result = validateGovernedRepository({
    root,
    policy,
    changedFiles: ["specs/001-example/spec.md"],
    newFeatures: ["001-example"],
    implementationChanged: false,
  });
  assert.equal(result.ok, false);
  assert(result.findings.some((row) => row.type === "stale_work_map_registry_binding"));
}

console.log("spec kit Work Map governance tests passed");
