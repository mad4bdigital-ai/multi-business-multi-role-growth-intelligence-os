#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");
const DEFAULT_POLICY_PATH = ".specify/spec-kit-work-map-integration-policy.json";

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function normalizePath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function slug(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sourceHash(text) {
  return text.match(/^> Source hash:\s*`([0-9a-f]{64})`/m)?.[1] || null;
}

function section(text, heading) {
  const marker = `## ${heading}`;
  const start = text.indexOf(marker);
  if (start < 0) return "";
  const afterHeading = text.indexOf("\n", start + marker.length);
  if (afterHeading < 0) return "";
  const rest = text.slice(afterHeading + 1);
  const nextHeading = rest.search(/^## /m);
  return nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function clusterKey(objectName) {
  const normalized = String(objectName || "").replace(/^v_/, "");
  let token = normalized.split("_")[0] || "unknown";
  if (token === "containers") token = "container";
  return slug(token) || "unknown";
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function parseWorkMapRegistry({ root = REPO_ROOT, policy } = {}) {
  const resolvedPolicy = policy || readJson(path.join(root, DEFAULT_POLICY_PATH));
  const mapRoot = path.join(root, resolvedPolicy.work_map_root);
  const indexPath = path.join(mapRoot, resolvedPolicy.work_map_index);
  const coveragePath = path.join(mapRoot, resolvedPolicy.coverage_matrix);
  const indexText = readText(indexPath);
  const coverageText = readText(coveragePath);

  const mapsSection = section(indexText, "Maps");
  const maps = [...mapsSection.matchAll(/^- \[([^\]]+)\]\(\.\/([^)]+\.md)\)\s*$/gm)]
    .map((match) => ({
      id: path.basename(match[2], ".md"),
      title: match[1].trim(),
      file: match[2].trim(),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  const domainSection = section(coverageText, "Domain coverage");
  const domains = domainSection
    .split(/\r?\n/)
    .filter((line) => /^\|/.test(line) && !/^\|\s*(Domain|---)/i.test(line))
    .map(splitTableRow)
    .filter((cells) => cells.length >= 5)
    .map(([name, tables, views, generatedMaps, status]) => ({
      id: slug(name),
      name,
      tables: Number.parseInt(tables, 10) || 0,
      views: Number.parseInt(views, 10) || 0,
      generated_maps: [...generatedMaps.matchAll(/`([^`]+\.md)`/g)].map((match) => match[1]),
      status,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  const uncategorizedSection = section(coverageText, "Uncategorized schema objects");
  const uncategorizedObjects = [...uncategorizedSection.matchAll(/^- `([^`]+)`(?: \(([^)]+)\))?/gm)]
    .map((match) => ({ name: match[1], type: match[2] || "unknown" }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const clusterMap = new Map();
  for (const row of uncategorizedObjects) {
    const key = clusterKey(row.name);
    if (!clusterMap.has(key)) clusterMap.set(key, []);
    clusterMap.get(key).push(row.name);
  }
  const taxonomyGapClusters = [...clusterMap.entries()]
    .map(([id, objects]) => ({ id, count: objects.length, sample: objects.slice(0, 8) }))
    .sort((left, right) => left.id.localeCompare(right.id));

  const actualMapFiles = fs.existsSync(mapRoot)
    ? fs.readdirSync(mapRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== resolvedPolicy.work_map_index)
      .map((entry) => entry.name)
      .sort()
    : [];
  const listedFiles = maps.map((row) => row.file);
  const missingMapFiles = listedFiles.filter((file) => !fs.existsSync(path.join(mapRoot, file)));
  const orphanMapFiles = actualMapFiles.filter((file) => !listedFiles.includes(file));
  const referencedMapFiles = unique(domains.flatMap((row) => row.generated_maps)).sort();
  const unlistedReferencedMapFiles = referencedMapFiles.filter((file) => !listedFiles.includes(file));

  const signature = {
    index_source_hash: sourceHash(indexText),
    coverage_source_hash: sourceHash(coverageText),
    map_ids: maps.map((row) => row.id),
    domain_ids: domains.map((row) => row.id),
    uncategorized_count: uncategorizedObjects.length,
    taxonomy_gap_cluster_ids: taxonomyGapClusters.map((row) => row.id),
  };
  const fingerprint = sha256(JSON.stringify(signature));

  return {
    map_root: normalizePath(path.relative(root, mapRoot)),
    maps,
    domains,
    uncategorized_objects: uncategorizedObjects,
    taxonomy_gap_clusters: taxonomyGapClusters,
    missing_map_files: missingMapFiles,
    orphan_map_files: orphanMapFiles,
    unlisted_referenced_map_files: unlistedReferencedMapFiles,
    signature,
    fingerprint,
  };
}

function tokenize(text) {
  const stop = new Set([
    "the", "and", "for", "with", "from", "this", "that", "into", "over", "under", "map", "maps",
    "platform", "generated", "source", "status", "table", "tables", "view", "views", "work", "file", "files",
    "must", "should", "will", "shall", "not", "are", "was", "were", "has", "have", "its", "their", "all",
  ]);
  return unique(String(text || "").toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || [])
    .map((value) => value.replace(/[_-]+/g, "-"))
    .filter((value) => !stop.has(value));
}

function listSpecTextFiles(featureRoot, manifestFilename) {
  if (!fs.existsSync(featureRoot)) return [];
  const allowed = new Set([".md", ".json", ".yaml", ".yml"]);
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name !== manifestFilename && allowed.has(path.extname(entry.name).toLowerCase())) files.push(full);
    }
  };
  walk(featureRoot);
  return files.sort();
}

function relevanceForMap(root, mapRoot, map, specTokens) {
  const mapText = readText(path.join(root, mapRoot, map.file));
  const mapTokens = new Set(tokenize(`${map.title}\n${mapText}`));
  const matches = [...specTokens].filter((token) => mapTokens.has(token)).sort();
  return {
    score: matches.length,
    matched_terms: matches.slice(0, 20),
    candidate: matches.length >= 4 ? "likely_relevant" : matches.length > 0 ? "review" : "no_signal",
  };
}

export function buildScaffoldManifest(feature, options = {}) {
  const root = options.root || REPO_ROOT;
  const policy = options.policy || readJson(path.join(root, DEFAULT_POLICY_PATH));
  const registry = options.registry || parseWorkMapRegistry({ root, policy });
  const featureRoot = path.join(root, policy.spec_root, feature);
  const specText = listSpecTextFiles(featureRoot, policy.manifest_filename).map(readText).join("\n");
  const specTokens = new Set(tokenize(specText));
  const owner = options.owner || "unassigned";

  const workMapDecisions = Object.fromEntries(registry.maps.map((map) => [map.id, {
    decision: "needs_analysis",
    rationale: "Pending explicit integration analysis against this generated platform Work Map.",
    owner,
    integration_points: [],
    requirement_refs: [],
    task_refs: [],
    acceptance_refs: [],
    evidence_refs: [normalizePath(path.join(policy.work_map_root, map.file))],
    depends_on: [],
    generated_relevance: relevanceForMap(root, policy.work_map_root, map, specTokens),
  }]));

  const domainDecisions = Object.fromEntries(registry.domains.map((domain) => [domain.id, {
    label: domain.name,
    decision: "needs_analysis",
    rationale: "Pending explicit integration analysis against this generated schema domain.",
    owner,
    integration_points: [],
    requirement_refs: [],
    task_refs: [],
    acceptance_refs: [],
    evidence_refs: [normalizePath(path.join(policy.work_map_root, policy.coverage_matrix))],
    depends_on: [],
  }]));

  const clusterDecisions = Object.fromEntries(registry.taxonomy_gap_clusters.map((cluster) => [cluster.id, {
    disposition: "needs_analysis",
    rationale: `Review ${cluster.count} currently uncategorized schema objects in the ${cluster.id} cluster.`,
    owner,
    evidence_refs: [normalizePath(path.join(policy.work_map_root, policy.coverage_matrix))],
  }]));

  return {
    schema_version: policy.schema_version,
    feature_key: feature,
    review_state: "draft",
    registry: {
      fingerprint: registry.fingerprint,
      index_source_hash: registry.signature.index_source_hash,
      coverage_source_hash: registry.signature.coverage_source_hash,
      map_count: registry.maps.length,
      domain_count: registry.domains.length,
      uncategorized_count: registry.uncategorized_objects.length,
      taxonomy_gap_cluster_count: registry.taxonomy_gap_clusters.length,
    },
    work_map_decisions: workMapDecisions,
    domain_decisions: domainDecisions,
    cross_map_dependencies: [],
    dimension_discovery: {
      registry_gap_clusters: clusterDecisions,
      new_dimension_candidates: [],
      unresolved: registry.taxonomy_gap_clusters.map((cluster) => cluster.id),
      no_new_dimensions_rationale: "Pending registry-gap and cross-map analysis.",
    },
    implementation_readiness: {
      status: "blocked",
      blocking_dimensions: [...registry.maps.map((row) => row.id), ...registry.domains.map((row) => row.id)],
      reviewed_by: owner,
      evidence_refs: [],
    },
    secrets_included: false,
  };
}

function push(findings, type, feature, details = {}) {
  findings.push({ type, feature, ...details });
}

function arrayOfStrings(value) {
  return Array.isArray(value) && value.length > 0 && value.every((row) => typeof row === "string" && row.trim());
}

function validateDecision({ findings, feature, scope, id, decision, policy, implementationRequired }) {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    push(findings, "invalid_integration_decision", feature, { scope, id });
    return;
  }
  if (!policy.decision_states.includes(decision.decision)) {
    push(findings, "invalid_integration_decision_state", feature, { scope, id, value: decision.decision });
    return;
  }
  if (typeof decision.rationale !== "string" || decision.rationale.trim().length < policy.minimum_rationale_length) {
    push(findings, "integration_decision_missing_rationale", feature, { scope, id });
  }
  if (typeof decision.owner !== "string" || decision.owner.trim().length < 2) {
    push(findings, "integration_decision_missing_owner", feature, { scope, id });
  }
  if (!arrayOfStrings(decision.evidence_refs)) {
    push(findings, "integration_decision_missing_evidence_refs", feature, { scope, id });
  }

  if (["integrate", "reuse", "extend"].includes(decision.decision)) {
    for (const field of ["integration_points", "requirement_refs", "task_refs", "acceptance_refs"]) {
      if (!arrayOfStrings(decision[field])) push(findings, "integration_decision_missing_delivery_binding", feature, { scope, id, field });
    }
  }
  if (decision.decision === "not_applicable" && !arrayOfStrings(decision.non_applicability_evidence)) {
    push(findings, "not_applicable_missing_evidence", feature, { scope, id });
  }
  if (decision.decision === "deferred_with_risk") {
    for (const field of ["risk_ref", "target_gate", "approval_ref"]) {
      if (typeof decision[field] !== "string" || !decision[field].trim()) push(findings, "deferred_dimension_missing_governance", feature, { scope, id, field });
    }
  }
  if (decision.decision === "blocked" && !arrayOfStrings(decision.blockers)) {
    push(findings, "blocked_dimension_missing_blockers", feature, { scope, id });
  }
  if (implementationRequired && decision.decision === "needs_analysis") {
    push(findings, "implementation_started_before_dimension_resolution", feature, { scope, id });
  }

  const dependencies = Array.isArray(decision.depends_on) ? decision.depends_on : [];
  if (dependencies.some((value) => typeof value !== "string" || !value.trim())) {
    push(findings, "invalid_dimension_dependency", feature, { scope, id });
  }
}

function validateGapDisposition({ findings, feature, id, row, policy, implementationRequired }) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    push(findings, "invalid_taxonomy_gap_disposition", feature, { id });
    return;
  }
  if (!policy.taxonomy_gap_dispositions.includes(row.disposition)) {
    push(findings, "invalid_taxonomy_gap_disposition_state", feature, { id, value: row.disposition });
  }
  if (typeof row.rationale !== "string" || row.rationale.trim().length < policy.minimum_rationale_length) {
    push(findings, "taxonomy_gap_disposition_missing_rationale", feature, { id });
  }
  if (typeof row.owner !== "string" || row.owner.trim().length < 2) {
    push(findings, "taxonomy_gap_disposition_missing_owner", feature, { id });
  }
  if (!arrayOfStrings(row.evidence_refs)) {
    push(findings, "taxonomy_gap_disposition_missing_evidence", feature, { id });
  }
  if (implementationRequired && row.disposition === "needs_analysis") {
    push(findings, "implementation_started_before_taxonomy_gap_resolution", feature, { id });
  }
  if (row.disposition === "new_work_map_candidate" && !arrayOfStrings(row.candidate_refs)) {
    push(findings, "new_work_map_candidate_missing_refs", feature, { id });
  }
}

function keyDiff(expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  return {
    missing: expected.filter((value) => !actualSet.has(value)),
    unknown: actual.filter((value) => !expectedSet.has(value)),
  };
}

export function validateIntegrationManifest(feature, options = {}) {
  const root = options.root || REPO_ROOT;
  const policy = options.policy || readJson(path.join(root, DEFAULT_POLICY_PATH));
  const registry = options.registry || parseWorkMapRegistry({ root, policy });
  const implementationRequired = options.implementationRequired === true;
  const manifestPath = path.join(root, policy.spec_root, feature, policy.manifest_filename);
  const findings = [];

  if (!fs.existsSync(manifestPath)) {
    push(findings, "missing_work_map_integration_manifest", feature, { file: normalizePath(path.relative(root, manifestPath)) });
    return findings;
  }

  let manifest;
  try {
    manifest = readJson(manifestPath);
  } catch (error) {
    push(findings, "invalid_work_map_integration_json", feature, { message: error.message });
    return findings;
  }

  if (manifest.schema_version !== policy.schema_version) push(findings, "invalid_work_map_integration_schema_version", feature, { value: manifest.schema_version });
  if (manifest.feature_key !== feature) push(findings, "work_map_integration_feature_key_mismatch", feature, { value: manifest.feature_key });
  if (!policy.review_states.includes(manifest.review_state)) push(findings, "invalid_work_map_review_state", feature, { value: manifest.review_state });
  if (manifest.secrets_included !== false) push(findings, "work_map_manifest_secret_boundary_missing", feature);

  if (registry.missing_map_files.length || registry.orphan_map_files.length || registry.unlisted_referenced_map_files.length) {
    push(findings, "work_map_registry_integrity_failed", feature, {
      missing_map_files: registry.missing_map_files,
      orphan_map_files: registry.orphan_map_files,
      unlisted_referenced_map_files: registry.unlisted_referenced_map_files,
    });
  }

  const manifestRegistry = manifest.registry || {};
  const registryChecks = {
    fingerprint: registry.fingerprint,
    index_source_hash: registry.signature.index_source_hash,
    coverage_source_hash: registry.signature.coverage_source_hash,
    map_count: registry.maps.length,
    domain_count: registry.domains.length,
    uncategorized_count: registry.uncategorized_objects.length,
    taxonomy_gap_cluster_count: registry.taxonomy_gap_clusters.length,
  };
  for (const [field, expected] of Object.entries(registryChecks)) {
    if (manifestRegistry[field] !== expected) push(findings, "stale_work_map_registry_binding", feature, { field, expected, actual: manifestRegistry[field] });
  }

  const workMapDecisions = manifest.work_map_decisions && typeof manifest.work_map_decisions === "object" ? manifest.work_map_decisions : {};
  const workMapKeys = Object.keys(workMapDecisions).sort();
  const workMapDiff = keyDiff(registry.maps.map((row) => row.id), workMapKeys);
  if (workMapDiff.missing.length) push(findings, "missing_work_map_decisions", feature, { ids: workMapDiff.missing });
  if (workMapDiff.unknown.length) push(findings, "unknown_work_map_decisions", feature, { ids: workMapDiff.unknown });
  for (const map of registry.maps) {
    if (Object.prototype.hasOwnProperty.call(workMapDecisions, map.id)) {
      validateDecision({ findings, feature, scope: "work_map", id: map.id, decision: workMapDecisions[map.id], policy, implementationRequired });
    }
  }

  const domainDecisions = manifest.domain_decisions && typeof manifest.domain_decisions === "object" ? manifest.domain_decisions : {};
  const domainKeys = Object.keys(domainDecisions).sort();
  const domainDiff = keyDiff(registry.domains.map((row) => row.id), domainKeys);
  if (domainDiff.missing.length) push(findings, "missing_domain_decisions", feature, { ids: domainDiff.missing });
  if (domainDiff.unknown.length) push(findings, "unknown_domain_decisions", feature, { ids: domainDiff.unknown });
  for (const domain of registry.domains) {
    if (Object.prototype.hasOwnProperty.call(domainDecisions, domain.id)) {
      validateDecision({ findings, feature, scope: "domain", id: domain.id, decision: domainDecisions[domain.id], policy, implementationRequired });
    }
  }

  const allDimensionIds = new Set([...registry.maps.map((row) => row.id), ...registry.domains.map((row) => row.id)]);
  const crossMapDependencies = Array.isArray(manifest.cross_map_dependencies) ? manifest.cross_map_dependencies : [];
  for (const [index, edge] of crossMapDependencies.entries()) {
    if (!edge || typeof edge !== "object" || !allDimensionIds.has(edge.from) || !allDimensionIds.has(edge.to) || edge.from === edge.to) {
      push(findings, "invalid_cross_map_dependency", feature, { index, edge });
    }
  }

  const discovery = manifest.dimension_discovery || {};
  const gapRows = discovery.registry_gap_clusters && typeof discovery.registry_gap_clusters === "object" ? discovery.registry_gap_clusters : {};
  const gapKeys = Object.keys(gapRows).sort();
  const gapDiff = keyDiff(registry.taxonomy_gap_clusters.map((row) => row.id), gapKeys);
  if (gapDiff.missing.length) push(findings, "missing_taxonomy_gap_cluster_dispositions", feature, { ids: gapDiff.missing });
  if (gapDiff.unknown.length) push(findings, "unknown_taxonomy_gap_cluster_dispositions", feature, { ids: gapDiff.unknown });
  for (const cluster of registry.taxonomy_gap_clusters) {
    if (Object.prototype.hasOwnProperty.call(gapRows, cluster.id)) {
      validateGapDisposition({ findings, feature, id: cluster.id, row: gapRows[cluster.id], policy, implementationRequired });
    }
  }

  const candidates = Array.isArray(discovery.new_dimension_candidates) ? discovery.new_dimension_candidates : [];
  if (candidates.length === 0 && (typeof discovery.no_new_dimensions_rationale !== "string" || discovery.no_new_dimensions_rationale.trim().length < policy.minimum_rationale_length)) {
    push(findings, "dimension_discovery_missing_conclusion", feature);
  }
  for (const [index, candidate] of candidates.entries()) {
    if (!candidate || typeof candidate !== "object" || typeof candidate.key !== "string" || !candidate.key.trim() || !arrayOfStrings(candidate.evidence_refs) || typeof candidate.disposition !== "string") {
      push(findings, "invalid_new_dimension_candidate", feature, { index });
    }
  }

  const unresolved = Array.isArray(discovery.unresolved) ? discovery.unresolved : [];
  if (implementationRequired && unresolved.length) push(findings, "implementation_started_with_unresolved_dimension_discovery", feature, { ids: unresolved });

  const readiness = manifest.implementation_readiness || {};
  if (implementationRequired) {
    if (readiness.status !== "ready") push(findings, "work_map_integration_not_ready_for_implementation", feature, { value: readiness.status });
    if (Array.isArray(readiness.blocking_dimensions) && readiness.blocking_dimensions.length) push(findings, "work_map_integration_has_blocking_dimensions", feature, { ids: readiness.blocking_dimensions });
    if (!arrayOfStrings(readiness.evidence_refs)) push(findings, "work_map_readiness_missing_evidence", feature);
    if (manifest.review_state !== "ready_for_implementation") push(findings, "work_map_review_not_finalized", feature, { value: manifest.review_state });
  }

  return findings;
}

function gitChangedFiles(root = REPO_ROOT) {
  const ranges = [
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}...HEAD` : null,
    "origin/main...HEAD",
    "HEAD~1...HEAD",
  ].filter(Boolean);
  for (const range of ranges) {
    try {
      return execFileSync("git", ["diff", "--name-only", range], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).split(/\r?\n/).map((row) => normalizePath(row.trim())).filter(Boolean);
    } catch {}
  }
  return [];
}

function featureFromFile(file, specRoot) {
  const normalized = normalizePath(file);
  const prefix = `${normalizePath(specRoot)}/`;
  if (!normalized.startsWith(prefix)) return null;
  return normalized.slice(prefix.length).split("/")[0] || null;
}

function listFeatureDirectories(root, specRoot) {
  const specPath = path.join(root, specRoot);
  if (!fs.existsSync(specPath)) return [];
  return fs.readdirSync(specPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function gitFeatureExistsAtBase(root, specRoot, feature) {
  const refs = [
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null,
    "origin/main",
  ].filter(Boolean);
  for (const ref of refs) {
    try {
      execFileSync("git", ["cat-file", "-e", `${ref}:${normalizePath(path.join(specRoot, feature))}`], {
        cwd: root,
        stdio: "ignore",
      });
      return true;
    } catch {}
  }
  return false;
}

function implementationChanged(changedFiles, policy) {
  const exempt = policy.implementation_exempt_prefixes.map((value) => normalizePath(value));
  return changedFiles.some((file) => !exempt.some((prefix) => file === prefix || file.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`)));
}

export function validateRepository(options = {}) {
  const root = options.root || REPO_ROOT;
  const policy = options.policy || readJson(path.join(root, DEFAULT_POLICY_PATH));
  const registry = options.registry || parseWorkMapRegistry({ root, policy });
  const changedFiles = options.changedFiles || gitChangedFiles(root);
  const changedFeatures = unique(changedFiles.map((file) => featureFromFile(file, policy.spec_root)).filter(Boolean)).sort();
  const allFeatures = listFeatureDirectories(root, policy.spec_root);
  const policyChanged = changedFiles.some((file) => [
    DEFAULT_POLICY_PATH,
    normalizePath(path.join(".specify/templates", policy.template_filename)),
    "http-generic-api/scripts/spec-kit-work-map-integration-gate.mjs",
  ].includes(file) || file.startsWith(`${normalizePath(policy.work_map_root)}/`));

  const manifestFeatures = allFeatures.filter((feature) => fs.existsSync(path.join(root, policy.spec_root, feature, policy.manifest_filename)));
  const newFeatures = options.newFeatures || changedFeatures.filter((feature) => !gitFeatureExistsAtBase(root, policy.spec_root, feature));
  const optedInChanged = changedFeatures.filter((feature) => manifestFeatures.includes(feature));
  const targets = options.all
    ? manifestFeatures
    : unique([
      ...newFeatures,
      ...optedInChanged,
      ...(policyChanged ? manifestFeatures : []),
    ]).sort();

  const runtimeChanged = Object.prototype.hasOwnProperty.call(options, "implementationChanged")
    ? options.implementationChanged === true
    : implementationChanged(changedFiles, policy);
  const findings = [];

  for (const feature of newFeatures) {
    if (!fs.existsSync(path.join(root, policy.spec_root, feature, policy.manifest_filename))) {
      push(findings, "new_spec_kit_missing_work_map_integration_manifest", feature, {
        file: normalizePath(path.join(policy.spec_root, feature, policy.manifest_filename)),
      });
    }
  }

  for (const feature of targets) {
    findings.push(...validateIntegrationManifest(feature, {
      root,
      policy,
      registry,
      implementationRequired: runtimeChanged,
    }));
  }

  return {
    findings,
    targets,
    new_features: newFeatures,
    changed_features: changedFeatures,
    changed_files: changedFiles,
    implementation_changed: runtimeChanged,
    registry,
    policy,
  };
}

function parseArgValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function writeScaffold(feature, root, policy) {
  const manifest = buildScaffoldManifest(feature, { root, policy });
  const file = path.join(root, policy.spec_root, feature, policy.manifest_filename);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return { file: normalizePath(path.relative(root, file)), manifest };
}

function main() {
  const args = process.argv.slice(2);
  const root = REPO_ROOT;
  const policy = readJson(path.join(root, DEFAULT_POLICY_PATH));
  const scaffoldFeature = parseArgValue(args, "--scaffold");
  if (scaffoldFeature) {
    const result = writeScaffold(scaffoldFeature, root, policy);
    console.log(JSON.stringify({ ok: true, mode: "scaffold", ...result, secrets_included: false }, null, 2));
    return;
  }
  if (args.includes("--registry-report")) {
    console.log(JSON.stringify({ ok: true, registry: parseWorkMapRegistry({ root, policy }), secrets_included: false }, null, 2));
    return;
  }

  const result = validateRepository({ all: args.includes("--all") });
  if (result.findings.length) {
    console.error(JSON.stringify({
      ok: false,
      error: {
        code: "spec_kit_work_map_integration_gate_failed",
        message: "One or more Spec Kits do not cover the current platform Work Maps and schema dimensions.",
        details: {
          findings: result.findings,
          targets: result.targets,
          new_features: result.new_features,
          implementation_changed: result.implementation_changed,
          registry_fingerprint: result.registry.fingerprint,
        },
      },
      secrets_included: false,
    }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({
    ok: true,
    policy_key: result.policy.policy_key,
    enforcement_mode: result.policy.enforcement_mode,
    features_checked: result.targets,
    new_features: result.new_features,
    implementation_changed: result.implementation_changed,
    work_maps: result.registry.maps.length,
    schema_domains: result.registry.domains.length,
    taxonomy_gap_clusters: result.registry.taxonomy_gap_clusters.length,
    registry_fingerprint: result.registry.fingerprint,
    gate: "fail_closed",
    secrets_included: false,
  }, null, 2));
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) main();
