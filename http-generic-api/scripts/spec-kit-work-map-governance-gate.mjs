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
import { validateClassificationReport } from "./work-map-classification-gate.mjs";

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
  const registry = options.registry || parseWorkMapRegistry({ root, policy });
  return { root, policy, registry };
}

export function validateGovernedRepository(options = {}) {
  const { root, policy, registry } = buildEffectiveWorkMapRegistry(options);
  const classification = validateClassificationReport({ root, now: options.now || new Date() });
  const repositoryOptions = {
    root,
    policy,
    registry,
    all: options.all === true,
  };
  if (Object.prototype.hasOwnProperty.call(options, "changedFiles")) repositoryOptions.changedFiles = options.changedFiles;
  if (Object.prototype.hasOwnProperty.call(options, "newFeatures")) repositoryOptions.newFeatures = options.newFeatures;
  if (Object.prototype.hasOwnProperty.call(options, "implementationChanged")) repositoryOptions.implementationChanged = options.implementationChanged;
  const integration = validateRepository(repositoryOptions);
  return {
    ok: classification.findings.length === 0 && integration.findings.length === 0,
    findings: [
      ...classification.findings.map((finding) => ({ source: "schema_classification", ...finding })),
      ...integration.findings.map((finding) => ({ source: "spec_kit_integration", ...finding })),
    ],
    classification,
    integration,
    effective_registry: registry,
    policy,
  };
}

function scaffold(feature, options = {}) {
  const { root, policy, registry } = buildEffectiveWorkMapRegistry(options);
  const classification = validateClassificationReport({ root });
  if (classification.findings.length) {
    console.error(JSON.stringify({
      ok: false,
      error: {
        code: "work_map_schema_classification_not_ready",
        message: "Resolve schema classification findings before scaffolding a Spec Kit integration manifest.",
        details: { findings: classification.findings, metrics: classification.metrics },
      },
      secrets_included: false,
    }, null, 2));
    process.exit(1);
  }
  const manifest = buildScaffoldManifest(feature, {
    root,
    policy,
    registry,
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
      map_count: registry.maps.length,
      domain_count: registry.domains.length,
      classified_schema_objects: classification.metrics.classified_objects,
      intentionally_unclassified_schema_objects: classification.metrics.intentional_unclassified_objects,
      unresolved_schema_objects: classification.metrics.unresolved_unclassified_objects,
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
    schema_objects_discovered: result.classification.metrics.total_discovered_objects,
    classified_schema_objects: result.classification.metrics.classified_objects,
    intentionally_unclassified: result.classification.metrics.intentional_unclassified_objects,
    unresolved_schema_objects: result.classification.metrics.unresolved_unclassified_objects,
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
