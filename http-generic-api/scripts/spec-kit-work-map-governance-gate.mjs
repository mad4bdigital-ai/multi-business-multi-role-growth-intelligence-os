#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPO_ROOT,
  buildScaffoldManifest,
  parseWorkMapRegistry,
  validateRepository,
} from "./spec-kit-work-map-integration-gate.mjs";
import {
  applySchemaClassificationRegistry,
  validateSchemaClassification,
} from "./work-map-schema-classification.mjs";

const DEFAULT_POLICY_PATH = ".specify/spec-kit-work-map-integration-policy.json";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function parseArg(args, flag) {
  const direct = args.find((value) => value.startsWith(`${flag}=`));
  if (direct) return direct.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

export function buildEffectiveWorkMapRegistry(options = {}) {
  const root = options.root || REPO_ROOT;
  const policy = options.policy || readJson(path.join(root, DEFAULT_POLICY_PATH));
  const baseRegistry = options.baseRegistry || parseWorkMapRegistry({ root, policy });
  const effectiveRegistry = applySchemaClassificationRegistry(baseRegistry, { root, policy });
  return { root, policy, baseRegistry, effectiveRegistry };
}

export function validateGovernedRepository(options = {}) {
  const { root, policy, effectiveRegistry } = buildEffectiveWorkMapRegistry(options);
  const classification = validateSchemaClassification({ root, policy });
  const integration = validateRepository({
    root,
    policy,
    registry: effectiveRegistry,
    all: options.all === true,
    changedFiles: options.changedFiles,
    newFeatures: options.newFeatures,
    implementationChanged: options.implementationChanged,
  });
  return {
    ok: classification.ok && integration.findings.length === 0,
    findings: [
      ...classification.findings.map((finding) => ({ source: "schema_classification", ...finding })),
      ...integration.findings.map((finding) => ({ source: "spec_kit_integration", ...finding })),
    ],
    classification,
    integration,
    effective_registry: effectiveRegistry,
    policy,
  };
}

function scaffold(feature, options = {}) {
  const { root, policy, effectiveRegistry } = buildEffectiveWorkMapRegistry(options);
  const manifest = buildScaffoldManifest(feature, {
    root,
    policy,
    registry: effectiveRegistry,
    owner: options.owner || "unassigned",
  });
  const outputPath = path.join(root, policy.spec_root, feature, policy.manifest_filename);
  const payload = `${JSON.stringify(manifest, null, 2)}\n`;
  if (options.stdout) process.stdout.write(payload);
  else {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, payload);
    console.log(JSON.stringify({
      ok: true,
      action: "scaffold",
      feature_key: feature,
      output: path.relative(root, outputPath).replaceAll("\\", "/"),
      map_count: effectiveRegistry.maps.length,
      domain_count: effectiveRegistry.domains.length,
      globally_classified_schema_objects: effectiveRegistry.globally_classified_schema_objects.length,
      intentionally_unclassified_schema_objects: effectiveRegistry.intentionally_unclassified_schema_objects.length,
      unresolved_schema_objects: effectiveRegistry.uncategorized_objects.length,
      secrets_included: false,
    }, null, 2));
  }
}

function main() {
  const args = process.argv.slice(2);
  const feature = parseArg(args, "--scaffold");
  if (feature) {
    scaffold(feature, {
      owner: parseArg(args, "--owner") || "unassigned",
      stdout: args.includes("--stdout"),
    });
    return;
  }

  const result = validateGovernedRepository({ all: args.includes("--all") });
  const payload = {
    ok: result.ok,
    gate: "fail_closed",
    policy_key: result.policy.policy_key,
    work_maps_discovered: result.effective_registry.maps.length,
    schema_domains_discovered: result.effective_registry.domains.length,
    source_uncategorized_schema_objects: result.classification.source_uncategorized_count,
    classified_by_existing_maps: result.classification.classified.length,
    intentionally_unclassified: result.classification.intentional_unclassified.length,
    unresolved_schema_objects: result.classification.unresolved.length,
    spec_kits_checked: result.integration.targets,
    new_spec_kits: result.integration.new_features,
    implementation_changed: result.integration.implementation_changed,
    findings: result.findings,
    secrets_included: false,
  };
  const writer = result.ok ? console.log : console.error;
  writer(JSON.stringify(payload, null, 2));
  if (!result.ok) process.exit(1);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) main();
