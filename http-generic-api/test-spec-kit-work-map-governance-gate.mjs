import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildScaffoldManifest } from "./scripts/spec-kit-work-map-integration-gate.mjs";
import {
  buildEffectiveWorkMapRegistry,
  validateGovernedRepository,
} from "./scripts/spec-kit-work-map-governance-gate.mjs";
import { validateSchemaClassification } from "./scripts/work-map-schema-classification.mjs";

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
    schema_classification_registry: ".specify/work-map-schema-classification-registry.json",
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
  write(root, ".specify/work-map-schema-classification-registry.json", JSON.stringify({
    schema_version: 1,
    registry_key: "fixture",
    default_disposition: "blocked",
    rules: [{
      rule_key: "container_resources",
      match: { prefixes: ["container_"] },
      domain: "Platform resources & graph",
      existing_map_refs: ["platform-resource-graph-map", "policy-authority-map"],
      rationale: "Container resources reuse the existing platform resource and policy authority maps."
    }],
    intentional_unclassified: [],
    secrets_included: false,
  }));
  write(root, "docs/work-maps/README.md", `# Dynamic Platform Work Maps\n\n> Source hash: \`${"a".repeat(64)}\`\n\n## Maps\n\n- [platform resource graph map](./platform-resource-graph-map.md)\n- [policy authority map](./policy-authority-map.md)\n- [work map coverage matrix](./work-map-coverage-matrix.md)\n`);
  write(root, "docs/work-maps/platform-resource-graph-map.md", "# Platform Resource Graph\n");
  write(root, "docs/work-maps/policy-authority-map.md", "# Policy Authority\n");
  write(root, "docs/work-maps/work-map-coverage-matrix.md", `# Coverage\n\n> Source hash: \`${"b".repeat(64)}\`\n\n## Domain coverage\n\n| Domain | Tables | Views | Generated maps | Status |\n|---|---:|---:|---|---|\n| Platform resources & graph | 1 | 0 | \`platform-resource-graph-map.md\` | covered |\n| Governance & authority | 1 | 0 | \`policy-authority-map.md\` | covered |\n\n## Unresolved schema objects\n\n- None.\n\n## Intentionally unclassified schema objects\n\n- None.\n`);
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
  manifest.review_state = "ready_for_implementation";
  manifest.dimension_discovery.unresolved = [];
  manifest.dimension_discovery.no_new_dimensions_rationale = "All discovered dimensions are represented by existing fixture maps and no additional map is necessary.";
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
  const { baseRegistry, effectiveRegistry } = buildEffectiveWorkMapRegistry({ root, policy });
  const classification = validateSchemaClassification({ root, policy });
  assert.equal(effectiveRegistry.fingerprint, baseRegistry.fingerprint);
  assert.deepEqual(effectiveRegistry.signature, baseRegistry.signature);
  assert.match(effectiveRegistry.schema_classification_fingerprint, /^[0-9a-f]{64}$/);
  assert.notEqual(effectiveRegistry.schema_classification_fingerprint, effectiveRegistry.fingerprint);
  assert.equal(
    effectiveRegistry.schema_classification_signature.schema_classification_registry_hash,
    classification.registry_hash
  );

  const manifest = finalize(buildScaffoldManifest("001-example", {
    root,
    policy,
    registry: effectiveRegistry,
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
  const { effectiveRegistry } = buildEffectiveWorkMapRegistry({ root, policy });
  const manifest = finalize(buildScaffoldManifest("001-example", {
    root,
    policy,
    registry: effectiveRegistry,
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

{
  const { root, policy } = fixture();
  const { effectiveRegistry } = buildEffectiveWorkMapRegistry({ root, policy });
  const readyManifest = finalize(buildScaffoldManifest("001-example", {
    root,
    policy,
    registry: effectiveRegistry,
    owner: "platform-architecture",
  }));
  write(root, "specs/001-example/work-map-integration.json", JSON.stringify(readyManifest));
  write(root, "specs/002-draft/spec.md", "# Draft feature\n");
  const draftManifest = buildScaffoldManifest("002-draft", {
    root,
    policy,
    registry: effectiveRegistry,
    owner: "platform-architecture",
  });
  write(root, "specs/002-draft/work-map-integration.json", JSON.stringify(draftManifest));

  const registryRefresh = validateGovernedRepository({
    root,
    policy,
    changedFiles: ["docs/work-maps/README.md", "runtime/example.js"],
    newFeatures: [],
    implementationChanged: true,
  });
  assert.equal(registryRefresh.ok, true, JSON.stringify(registryRefresh.findings));
  assert.deepEqual(registryRefresh.integration.targets, ["001-example"]);

  const changedDraft = validateGovernedRepository({
    root,
    policy,
    changedFiles: ["specs/002-draft/spec.md", "runtime/example.js"],
    newFeatures: [],
    implementationChanged: true,
  });
  assert.equal(changedDraft.ok, false);
  assert.deepEqual(changedDraft.integration.targets, ["002-draft"]);
  assert(changedDraft.findings.some((row) => row.feature === "002-draft"));
}

// Regression: design classification does not become a false operational or Production certificate.
{
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const featurePath = "specs/009-local-connector-reachability-recovery";
  const manifest = JSON.parse(fs.readFileSync(path.join(root, featurePath, "work-map-integration.json"), "utf8"));
  const spec = fs.readFileSync(path.join(root, featurePath, "spec.md"), "utf8");
  const tasks = fs.readFileSync(path.join(root, featurePath, "tasks.md"), "utf8");
  const knownAcceptance = new Set([...spec.matchAll(/^### (US[0-9]+: .+)$/gm)]
    .map(([, heading]) => heading.toLowerCase().replace(/:/g, "").replace(/[^a-z0-9 -]/g, "").trim().replace(/ +/g, "-")));
  assert.equal(manifest.review_state, "ready_for_implementation");
  assert.equal(manifest.implementation_readiness.status, "ready");
  assert.equal(manifest.implementation_readiness.scope, "source_architecture_ready_for_phased_implementation_only");
  assert.equal(manifest.implementation_readiness.staging_runtime_verified, false);
  assert.equal(manifest.implementation_readiness.device_generation_attested, false);
  assert.equal(manifest.implementation_readiness.production_promotion_authorized, false);
  assert.equal(manifest.design_review.execution_authority_granted, false);
  assert.equal(manifest.design_review.independent_operational_acceptance_required, true);
  assert.equal(Object.keys(manifest.work_map_decisions).length, manifest.registry.map_count);
  assert.equal(Object.keys(manifest.domain_decisions).length, manifest.registry.domain_count);
  for (const [scope, decisions] of Object.entries({
    maps: manifest.work_map_decisions,
    domains: manifest.domain_decisions,
  })) {
    for (const [dimension, decision] of Object.entries(decisions)) {
      assert.notEqual(decision.decision, "needs_analysis", `${scope}:${dimension} remained unresolved`);
      assert(decision.rationale.length >= 24, `${scope}:${dimension} has no useful rationale`);
      assert(Array.isArray(decision.evidence_refs) && decision.evidence_refs.length > 0);
      for (const evidencePath of decision.evidence_refs) {
        assert(fs.existsSync(path.join(root, evidencePath)), `Missing evidence for ${scope}:${dimension}: ${evidencePath}`);
      }
      if (decision.decision === "not_applicable") {
        assert(Array.isArray(decision.non_applicability_evidence) &&
          decision.non_applicability_evidence.length > 0, `Unproved non-applicability: ${dimension}`);
      } else {
        assert(decision.integration_points.length > 0);
        for (const requirement of decision.requirement_refs) {
          assert(spec.includes(`${requirement}:`), `Unknown requirement: ${dimension}/${requirement}`);
        }
        for (const task of decision.task_refs) {
          assert(tasks.includes(`${task} `), `Unknown delivery task: ${dimension}/${task}`);
        }
        for (const acceptance of decision.acceptance_refs) {
          assert(acceptance.startsWith(`${featurePath}/spec.md#`));
          assert(knownAcceptance.has(acceptance.split("#")[1]), `Unknown acceptance story: ${acceptance}`);
        }
      }
    }
  }
}

console.log("spec kit Work Map governance tests passed");
