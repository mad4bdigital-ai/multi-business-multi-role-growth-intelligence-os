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

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8"));
}

function sameStrings(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function push(findings, code, details = {}) {
  findings.push({ code, ...details });
}

const manifest = readJson(MANIFEST_PATH);
const { effectiveRegistry } = buildEffectiveWorkMapRegistry({ root: REPO_ROOT });
const classification = validateSchemaClassification({ root: REPO_ROOT });
const findings = [];

const expectedMapIds = effectiveRegistry.maps.map((row) => row.id);
const expectedDomainIds = effectiveRegistry.domains.map((row) => row.id);
const manifestMapIds = Object.keys(manifest.work_map_decisions || {});
const manifestDomainIds = Object.keys(manifest.domain_decisions || {});

if (manifest.schema_version !== 1) push(findings, "invalid_manifest_schema_version", { actual: manifest.schema_version });
if (manifest.feature_key !== FEATURE_KEY) push(findings, "unexpected_feature_key", { actual: manifest.feature_key });
if (manifest.review_state !== "ready_for_implementation") push(findings, "manifest_not_ready_for_implementation", { actual: manifest.review_state });
if (manifest.secrets_included !== false) push(findings, "manifest_secret_boundary_missing");

if (effectiveRegistry.maps.length !== 19) push(findings, "unexpected_work_map_count", { expected: 19, actual: effectiveRegistry.maps.length });
if (effectiveRegistry.domains.length !== 16) push(findings, "unexpected_schema_domain_count", { expected: 16, actual: effectiveRegistry.domains.length });
if (effectiveRegistry.uncategorized_objects.length !== 0) push(findings, "unresolved_effective_schema_objects", { count: effectiveRegistry.uncategorized_objects.length });
if (effectiveRegistry.taxonomy_gap_clusters.length !== 0) push(findings, "unresolved_taxonomy_gap_clusters", { count: effectiveRegistry.taxonomy_gap_clusters.length });
if (effectiveRegistry.missing_map_files.length !== 0) push(findings, "missing_work_map_files", { files: effectiveRegistry.missing_map_files });
if (effectiveRegistry.orphan_map_files.length !== 0) push(findings, "orphan_work_map_files", { files: effectiveRegistry.orphan_map_files });
if (effectiveRegistry.unlisted_referenced_map_files.length !== 0) push(findings, "unlisted_referenced_work_map_files", { files: effectiveRegistry.unlisted_referenced_map_files });

if (!classification.ok) push(findings, "schema_classification_not_ready", { findings: classification.findings });
if (classification.unresolved.length !== 0) push(findings, "schema_classification_unresolved", { count: classification.unresolved.length });
if (classification.classification_coverage_percent !== 100) push(findings, "schema_classification_coverage_incomplete", { actual: classification.classification_coverage_percent });

if (!sameStrings(manifestMapIds, expectedMapIds)) push(findings, "work_map_decision_set_drift", { expected: expectedMapIds, actual: manifestMapIds });
if (!sameStrings(manifestDomainIds, expectedDomainIds)) push(findings, "domain_decision_set_drift", { expected: expectedDomainIds, actual: manifestDomainIds });

const registryChecks = [
  ["fingerprint", effectiveRegistry.fingerprint],
  ["index_source_hash", effectiveRegistry.signature.index_source_hash],
  ["coverage_source_hash", effectiveRegistry.signature.coverage_source_hash],
  ["map_count", effectiveRegistry.maps.length],
  ["domain_count", effectiveRegistry.domains.length],
  ["uncategorized_count", effectiveRegistry.uncategorized_objects.length],
  ["taxonomy_gap_cluster_count", effectiveRegistry.taxonomy_gap_clusters.length],
];
for (const [field, expected] of registryChecks) {
  const actual = manifest.registry?.[field];
  if (actual !== expected) push(findings, "stale_work_map_registry_binding", { field, expected, actual });
}

if (manifest.implementation_readiness?.status !== "ready") {
  push(findings, "implementation_readiness_not_ready", { actual: manifest.implementation_readiness?.status });
}
if (!Array.isArray(manifest.implementation_readiness?.blocking_dimensions)
  || manifest.implementation_readiness.blocking_dimensions.length !== 0) {
  push(findings, "implementation_readiness_has_blocking_dimensions", {
    actual: manifest.implementation_readiness?.blocking_dimensions,
  });
}
if (!Array.isArray(manifest.dimension_discovery?.unresolved)
  || manifest.dimension_discovery.unresolved.length !== 0) {
  push(findings, "dimension_discovery_unresolved", { actual: manifest.dimension_discovery?.unresolved });
}

const report = {
  contract: "mad4b.spec014-final-work-map-readback.v1",
  generated_at: new Date().toISOString(),
  candidate_sha: process.env.GITHUB_SHA || null,
  feature_key: FEATURE_KEY,
  manifest_path: MANIFEST_PATH,
  ok: findings.length === 0,
  current_registry: {
    fingerprint: effectiveRegistry.fingerprint,
    index_source_hash: effectiveRegistry.signature.index_source_hash,
    coverage_source_hash: effectiveRegistry.signature.coverage_source_hash,
    schema_classification_registry_hash: effectiveRegistry.signature.schema_classification_registry_hash,
    map_count: effectiveRegistry.maps.length,
    domain_count: effectiveRegistry.domains.length,
    uncategorized_count: effectiveRegistry.uncategorized_objects.length,
    taxonomy_gap_cluster_count: effectiveRegistry.taxonomy_gap_clusters.length,
    globally_classified_schema_objects: effectiveRegistry.globally_classified_schema_objects.length,
    intentionally_unclassified_schema_objects: effectiveRegistry.intentionally_unclassified_schema_objects.length,
  },
  manifest_registry: manifest.registry || null,
  classification: {
    ok: classification.ok,
    coverage_percent: classification.classification_coverage_percent,
    unresolved_count: classification.unresolved.length,
    intentionally_unclassified_count: classification.intentional_unclassified.length,
    registry_hash: classification.registry_hash,
  },
  findings,
  repository_mutation: false,
  provider_dispatch: false,
  live_database_access: false,
  migration_apply: false,
  secrets_included: false,
};

const payload = `${JSON.stringify(report, null, 2)}\n`;
const reportPath = process.env.REPORT_PATH;
if (reportPath) {
  const absolute = path.resolve(REPO_ROOT, reportPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, payload);
}
process.stdout.write(payload);
if (!report.ok) process.exit(1);
