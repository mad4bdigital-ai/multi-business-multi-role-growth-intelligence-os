#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");
const DEFAULT_POLICY_PATH = ".specify/spec-kit-work-map-integration-policy.json";
const DEFAULT_REGISTRY_PATH = ".specify/work-map-schema-classification-registry.json";

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function normalizePath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function section(text, heading) {
  const marker = `## ${heading}`;
  const start = text.indexOf(marker);
  if (start < 0) return "";
  const lineEnd = text.indexOf("\n", start + marker.length);
  if (lineEnd < 0) return "";
  const rest = text.slice(lineEnd + 1);
  const next = rest.search(/^## /m);
  return next >= 0 ? rest.slice(0, next) : rest;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function clusterKey(objectName) {
  const normalized = String(objectName || "").replace(/^v_/, "");
  const token = normalized.startsWith("containers") ? "container" : normalized.split("_")[0] || "unknown";
  return token.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function parseMapIds(indexText) {
  return [...section(indexText, "Maps").matchAll(/^- \[[^\]]+\]\(\.\/([^)]+\.md)\)\s*$/gm)]
    .map((match) => path.basename(match[1], ".md"))
    .sort();
}

function parseUncategorized(coverageText) {
  return [...section(coverageText, "Uncategorized schema objects").matchAll(/^- `([^`]+)`(?: \(([^)]+)\))?/gm)]
    .map((match) => ({ name: match[1], type: match[2] || "unknown" }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function matchesRule(name, match = {}) {
  const exact = Array.isArray(match.exact_names) ? match.exact_names : [];
  const prefixes = Array.isArray(match.prefixes) ? match.prefixes : [];
  const suffixes = Array.isArray(match.suffixes) ? match.suffixes : [];
  return exact.includes(name)
    || prefixes.some((prefix) => name.startsWith(prefix))
    || suffixes.some((suffix) => name.endsWith(suffix));
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function push(findings, type, details = {}) {
  findings.push({ type, ...details });
}

export function loadClassificationInputs(options = {}) {
  const root = options.root || REPO_ROOT;
  const policy = options.policy || readJson(path.join(root, DEFAULT_POLICY_PATH));
  const registryPath = policy.schema_classification_registry || DEFAULT_REGISTRY_PATH;
  const classificationRegistry = options.classificationRegistry || readJson(path.join(root, registryPath));
  const indexText = options.indexText ?? readText(path.join(root, policy.work_map_root, policy.work_map_index));
  const coverageText = options.coverageText ?? readText(path.join(root, policy.work_map_root, policy.coverage_matrix));
  return {
    root,
    policy,
    registry_path: normalizePath(registryPath),
    classification_registry: classificationRegistry,
    map_ids: parseMapIds(indexText),
    uncategorized_objects: parseUncategorized(coverageText),
  };
}

export function validateSchemaClassification(options = {}) {
  const inputs = loadClassificationInputs(options);
  const { classification_registry: registry, map_ids: mapIds, uncategorized_objects: objects } = inputs;
  const findings = [];
  const mapSet = new Set(mapIds);
  const rules = Array.isArray(registry.rules) ? registry.rules : [];
  const exceptions = Array.isArray(registry.intentional_unclassified) ? registry.intentional_unclassified : [];
  const ruleKeys = new Set();
  const exceptionNames = new Set();

  if (registry.schema_version !== 1) push(findings, "invalid_classification_registry_schema_version", { value: registry.schema_version });
  if (registry.default_disposition !== "blocked") push(findings, "classification_default_must_block", { value: registry.default_disposition });
  if (registry.secrets_included !== false) push(findings, "classification_registry_secret_boundary_missing");

  for (const [index, rule] of rules.entries()) {
    if (!rule || typeof rule !== "object") {
      push(findings, "invalid_classification_rule", { index });
      continue;
    }
    if (typeof rule.rule_key !== "string" || !rule.rule_key.trim() || ruleKeys.has(rule.rule_key)) {
      push(findings, "invalid_or_duplicate_classification_rule_key", { index, value: rule.rule_key });
    } else ruleKeys.add(rule.rule_key);
    if (typeof rule.domain !== "string" || !rule.domain.trim()) push(findings, "classification_rule_missing_domain", { rule_key: rule.rule_key });
    if (typeof rule.rationale !== "string" || rule.rationale.trim().length < 24) push(findings, "classification_rule_missing_rationale", { rule_key: rule.rule_key });
    const refs = Array.isArray(rule.existing_map_refs) ? rule.existing_map_refs : [];
    if (!refs.length) push(findings, "classification_rule_missing_existing_map_refs", { rule_key: rule.rule_key });
    for (const ref of refs) if (!mapSet.has(ref)) push(findings, "classification_rule_unknown_map_ref", { rule_key: rule.rule_key, map_ref: ref });
    const match = rule.match || {};
    if (!(Array.isArray(match.exact_names) && match.exact_names.length)
      && !(Array.isArray(match.prefixes) && match.prefixes.length)
      && !(Array.isArray(match.suffixes) && match.suffixes.length)) {
      push(findings, "classification_rule_missing_matcher", { rule_key: rule.rule_key });
    }
  }

  const exceptionByName = new Map();
  for (const [index, row] of exceptions.entries()) {
    if (!row || typeof row !== "object" || typeof row.object_name !== "string" || !row.object_name.trim() || exceptionNames.has(row.object_name)) {
      push(findings, "invalid_or_duplicate_intentional_exception", { index, object_name: row?.object_name });
      continue;
    }
    exceptionNames.add(row.object_name);
    exceptionByName.set(row.object_name, row);
    for (const field of ["object_type", "owner", "rationale", "review_gate"]) {
      if (typeof row[field] !== "string" || row[field].trim().length < (field === "rationale" ? 24 : 2)) {
        push(findings, "intentional_exception_missing_governance", { object_name: row.object_name, field });
      }
    }
    if (!Array.isArray(row.nearest_existing_map_refs) || row.nearest_existing_map_refs.length < 1) {
      push(findings, "intentional_exception_missing_existing_map_assessment", { object_name: row.object_name });
    } else {
      for (const ref of row.nearest_existing_map_refs) if (!mapSet.has(ref)) push(findings, "intentional_exception_unknown_map_ref", { object_name: row.object_name, map_ref: ref });
    }
    if (!validDate(row.expires_on)) push(findings, "intentional_exception_invalid_expiry", { object_name: row.object_name, value: row.expires_on });
    else if (Date.parse(`${row.expires_on}T23:59:59Z`) < Date.now()) push(findings, "intentional_exception_expired", { object_name: row.object_name, expires_on: row.expires_on });
  }

  const classified = [];
  const intentional = [];
  const unresolved = [];
  for (const object of objects) {
    const matchingRules = rules.filter((rule) => matchesRule(object.name, rule.match));
    const exception = exceptionByName.get(object.name);
    if (matchingRules.length > 1 || (matchingRules.length === 1 && exception)) {
      push(findings, "ambiguous_schema_classification", {
        object_name: object.name,
        rule_keys: matchingRules.map((rule) => rule.rule_key),
        intentional_exception: Boolean(exception),
      });
      unresolved.push(object);
    } else if (matchingRules.length === 1) {
      const rule = matchingRules[0];
      classified.push({ ...object, rule_key: rule.rule_key, domain: rule.domain, existing_map_refs: rule.existing_map_refs });
    } else if (exception) {
      if (exception.object_type !== object.type) push(findings, "intentional_exception_type_mismatch", { object_name: object.name, expected: object.type, actual: exception.object_type });
      intentional.push({ ...object, ...exception });
    } else {
      push(findings, "unclassified_schema_object", { object_name: object.name, object_type: object.type });
      unresolved.push(object);
    }
  }

  const objectNames = new Set(objects.map((row) => row.name));
  for (const exception of exceptions) {
    if (exception?.object_name && !objectNames.has(exception.object_name)) push(findings, "stale_intentional_exception", { object_name: exception.object_name });
  }

  return {
    ok: findings.length === 0,
    findings,
    classified,
    intentional_unclassified: intentional,
    unresolved,
    map_ids: mapIds,
    source_uncategorized_count: objects.length,
    classification_coverage_percent: objects.length ? Number((((classified.length + intentional.length) / objects.length) * 100).toFixed(2)) : 100,
    registry_hash: sha256(JSON.stringify(registry)),
    registry_path: inputs.registry_path,
  };
}

export function applySchemaClassificationRegistry(workMapRegistry, options = {}) {
  const result = validateSchemaClassification(options);
  const unresolved = result.unresolved;
  const clusterMap = new Map();
  for (const row of unresolved) {
    const key = clusterKey(row.name);
    if (!clusterMap.has(key)) clusterMap.set(key, []);
    clusterMap.get(key).push(row.name);
  }
  const taxonomyGapClusters = [...clusterMap.entries()]
    .map(([id, names]) => ({ id, count: names.length, sample: names.slice(0, 8) }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const signature = {
    ...workMapRegistry.signature,
    uncategorized_count: unresolved.length,
    taxonomy_gap_cluster_ids: taxonomyGapClusters.map((row) => row.id),
    schema_classification_registry_hash: result.registry_hash,
    globally_classified_count: result.classified.length,
    intentionally_unclassified_count: result.intentional_unclassified.length,
  };
  return {
    ...workMapRegistry,
    uncategorized_objects: unresolved,
    taxonomy_gap_clusters: taxonomyGapClusters,
    globally_classified_schema_objects: result.classified,
    intentionally_unclassified_schema_objects: result.intentional_unclassified,
    schema_classification_findings: result.findings,
    signature,
    fingerprint: sha256(JSON.stringify(signature)),
  };
}

function main() {
  const result = validateSchemaClassification();
  const payload = {
    ok: result.ok,
    gate: "fail_closed",
    source_uncategorized_count: result.source_uncategorized_count,
    classified_by_existing_maps: result.classified.length,
    intentionally_unclassified: result.intentional_unclassified.length,
    unresolved: result.unresolved.length,
    classification_coverage_percent: result.classification_coverage_percent,
    registry_path: result.registry_path,
    findings: result.findings,
    secrets_included: false,
  };
  const writer = result.ok ? console.log : console.error;
  writer(JSON.stringify(payload, null, 2));
  if (!result.ok) process.exit(1);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) main();
