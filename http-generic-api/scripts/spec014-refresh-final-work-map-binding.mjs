#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEffectiveWorkMapRegistry } from "./spec-kit-work-map-governance-gate.mjs";
import { validateSchemaClassification } from "./work-map-schema-classification.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const DEFAULT_FEATURE_KEY = "014-governed-hostinger-storage-orchestration";
const HOSTINGER_TASKS_PATH = `specs/${DEFAULT_FEATURE_KEY}/tasks.md`;

function parseArgs(argv) {
  const options = { featureKey: DEFAULT_FEATURE_KEY, check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    if (argument === "--feature-key") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--feature-key requires a value");
      options.featureKey = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--feature-key=")) {
      options.featureKey = argument.slice("--feature-key=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!/^[a-z0-9][a-z0-9-]*$/.test(options.featureKey)) {
    throw new Error(`Invalid feature key: ${options.featureKey}`);
  }
  return options;
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8"));
}

function writeJson(relativePath, value) {
  fs.writeFileSync(path.join(REPO_ROOT, relativePath), `${JSON.stringify(value, null, 2)}\n`);
}

function registryBinding(effectiveRegistry) {
  return {
    fingerprint: effectiveRegistry.fingerprint,
    index_source_hash: effectiveRegistry.signature.index_source_hash,
    coverage_source_hash: effectiveRegistry.signature.coverage_source_hash,
    map_count: effectiveRegistry.maps.length,
    domain_count: effectiveRegistry.domains.length,
    uncategorized_count: effectiveRegistry.uncategorized_objects.length,
    taxonomy_gap_cluster_count: effectiveRegistry.taxonomy_gap_clusters.length,
  };
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

const { featureKey, check } = parseArgs(process.argv.slice(2));
const manifestPath = `specs/${featureKey}/work-map-integration.json`;
const manifestFile = path.join(REPO_ROOT, manifestPath);
if (!fs.existsSync(manifestFile)) throw new Error(`Work Map integration manifest does not exist: ${manifestPath}`);

const { effectiveRegistry } = buildEffectiveWorkMapRegistry({ root: REPO_ROOT });
const classification = validateSchemaClassification({ root: REPO_ROOT });

if (!classification.ok || classification.unresolved.length !== 0 || classification.classification_coverage_percent !== 100) {
  throw new Error(`Schema classification is not ready: ${JSON.stringify(classification.findings)}`);
}
if (effectiveRegistry.maps.length !== 19 || effectiveRegistry.domains.length !== 16) {
  throw new Error(`Unexpected Work Map registry shape: maps=${effectiveRegistry.maps.length}, domains=${effectiveRegistry.domains.length}`);
}
if (effectiveRegistry.uncategorized_objects.length !== 0 || effectiveRegistry.taxonomy_gap_clusters.length !== 0) {
  throw new Error("Work Map registry still contains unresolved objects or taxonomy gaps");
}

const manifest = readJson(manifestPath);
if (manifest.feature_key !== featureKey || manifest.review_state !== "ready_for_implementation") {
  throw new Error(`Work Map manifest ${featureKey} is not eligible for deterministic refresh`);
}

const previousRegistry = { ...(manifest.registry || {}) };
const currentRegistry = registryBinding(effectiveRegistry);
const registryChanged = !equalJson(previousRegistry, currentRegistry);
const changedFiles = [];

if (check && registryChanged) {
  throw new Error(`Stale Work Map registry binding for ${featureKey}: ${JSON.stringify({ expected: currentRegistry, actual: previousRegistry })}`);
}

if (!check && registryChanged) {
  manifest.registry = currentRegistry;
  writeJson(manifestPath, manifest);
  changedFiles.push(manifestPath);
}

if (featureKey === DEFAULT_FEATURE_KEY) {
  const tasksFile = path.join(REPO_ROOT, HOSTINGER_TASKS_PATH);
  let tasks = fs.readFileSync(tasksFile, "utf8");
  const previousTasks = tasks;
  const openTask = "- [ ] **T006** Re-run Work Map scaffold/gate on final exact head and repair any fingerprint drift caused by later `main` movement.";
  const closedTask = "- [x] **T006** Re-run Work Map scaffold/gate on final exact head and repair fingerprint drift caused by later `main` movement. Evidence: `http-generic-api/scripts/spec014-final-work-map-readback.mjs`, `http-generic-api/scripts/spec014-refresh-final-work-map-binding.mjs`, and `.github/workflows/hostinger-storage-final-work-map-readback-guard.yml`.";
  if (tasks.includes(openTask)) tasks = tasks.replace(openTask, closedTask);
  else if (!tasks.includes(closedTask)) throw new Error("T006 task line is missing or has an unexpected form");

  if (!check && tasks !== previousTasks) {
    fs.writeFileSync(tasksFile, tasks);
    changedFiles.push(HOSTINGER_TASKS_PATH);
  }
}

console.log(JSON.stringify({
  ok: true,
  contract: check
    ? "mad4b.spec014-final-work-map-binding-check.v1"
    : "mad4b.spec014-final-work-map-binding-refresh.v1",
  feature_key: featureKey,
  mode: check ? "check" : "write",
  changed_files: changedFiles,
  previous_registry: previousRegistry,
  current_registry: currentRegistry,
  schema_classification_registry_hash: classification.registry_hash,
  classification_coverage_percent: classification.classification_coverage_percent,
  unresolved_schema_objects: classification.unresolved.length,
  repository_mutation_scope: check ? "none" : "candidate_branch_only",
  provider_dispatch: false,
  live_database_access: false,
  migration_apply: false,
  secrets_included: false
}, null, 2));
