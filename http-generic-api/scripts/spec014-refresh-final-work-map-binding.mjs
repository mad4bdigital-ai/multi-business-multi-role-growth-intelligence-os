#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEffectiveWorkMapRegistry } from "./spec-kit-work-map-governance-gate.mjs";
import { validateSchemaClassification } from "./work-map-schema-classification.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const FEATURE_KEY = "014-governed-hostinger-storage-orchestration";
const MANIFEST_PATH = `specs/${FEATURE_KEY}/work-map-integration.json`;
const TASKS_PATH = `specs/${FEATURE_KEY}/tasks.md`;

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8"));
}

function writeJson(relativePath, value) {
  fs.writeFileSync(path.join(REPO_ROOT, relativePath), `${JSON.stringify(value, null, 2)}\n`);
}

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

const manifest = readJson(MANIFEST_PATH);
if (manifest.feature_key !== FEATURE_KEY || manifest.review_state !== "ready_for_implementation") {
  throw new Error("Spec 014 Work Map manifest identity or review state is not eligible for deterministic refresh");
}

const previousRegistry = { ...(manifest.registry || {}) };
manifest.registry = {
  fingerprint: effectiveRegistry.fingerprint,
  index_source_hash: effectiveRegistry.signature.index_source_hash,
  coverage_source_hash: effectiveRegistry.signature.coverage_source_hash,
  map_count: effectiveRegistry.maps.length,
  domain_count: effectiveRegistry.domains.length,
  uncategorized_count: effectiveRegistry.uncategorized_objects.length,
  taxonomy_gap_cluster_count: effectiveRegistry.taxonomy_gap_clusters.length,
};
writeJson(MANIFEST_PATH, manifest);

const tasksFile = path.join(REPO_ROOT, TASKS_PATH);
let tasks = fs.readFileSync(tasksFile, "utf8");
const openTask = "- [ ] **T006** Re-run Work Map scaffold/gate on final exact head and repair any fingerprint drift caused by later `main` movement.";
const closedTask = "- [x] **T006** Re-run Work Map scaffold/gate on final exact head and repair fingerprint drift caused by later `main` movement. Evidence: `http-generic-api/scripts/spec014-final-work-map-readback.mjs`, `http-generic-api/scripts/spec014-refresh-final-work-map-binding.mjs`, and `.github/workflows/hostinger-storage-final-work-map-readback-guard.yml`.";
if (tasks.includes(openTask)) tasks = tasks.replace(openTask, closedTask);
else if (!tasks.includes(closedTask)) throw new Error("T006 task line is missing or has an unexpected form");
fs.writeFileSync(tasksFile, tasks);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.spec014-final-work-map-binding-refresh.v1",
  feature_key: FEATURE_KEY,
  changed_files: [MANIFEST_PATH, TASKS_PATH],
  previous_registry: previousRegistry,
  current_registry: manifest.registry,
  schema_classification_registry_hash: classification.registry_hash,
  classification_coverage_percent: classification.classification_coverage_percent,
  unresolved_schema_objects: classification.unresolved.length,
  repository_mutation_scope: "candidate_branch_only",
  provider_dispatch: false,
  live_database_access: false,
  migration_apply: false,
  secrets_included: false
}, null, 2));
