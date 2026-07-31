#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");
const REGISTRY_PATH = ".specify/work-map-schema-classification-registry.json";

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function normalizePath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function listFiles(dir, predicate = () => true) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full, predicate) : predicate(full) ? [full] : [];
  }).sort();
}

export function matchesRule(name, match = {}) {
  const exact = Array.isArray(match.exact_names) ? match.exact_names : [];
  const prefixes = Array.isArray(match.prefixes) ? match.prefixes : [];
  const suffixes = Array.isArray(match.suffixes) ? match.suffixes : [];
  return exact.includes(name)
    || prefixes.some((prefix) => name.startsWith(prefix))
    || suffixes.some((suffix) => name.endsWith(suffix));
}

function matchesExactly(name, match = {}) {
  return Array.isArray(match.exact_names) && match.exact_names.includes(name);
}

export function discoverSchemaObjects(root = REPO_ROOT) {
  const objects = new Map();
  const ensure = (name, type, source) => {
    if (!objects.has(name)) objects.set(name, { name, type, sources: new Set() });
    objects.get(name).sources.add(normalizePath(path.relative(root, source)));
  };
  for (const file of listFiles(path.join(root, "http-generic-api", "migrations"), (candidate) => candidate.endsWith(".sql"))) {
    const text = readText(file);
    for (const match of text.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?/gi)) ensure(match[1], "table", file);
    for (const match of text.matchAll(/ALTER\s+TABLE\s+`?([A-Za-z0-9_]+)`?/gi)) ensure(match[1], "table", file);
    for (const match of text.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+`?([A-Za-z0-9_]+)`?/gi)) ensure(match[1], "view", file);
  }
  return [...objects.values()]
    .map((object) => ({ ...object, sources: [...object.sources].sort() }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function push(findings, type, details = {}) {
  findings.push({ type, ...details });
}

function validateRuleScope(rule, findings) {
  const match = rule.match || {};
  const exact = Array.isArray(match.exact_names) ? match.exact_names : [];
  const prefixes = Array.isArray(match.prefixes) ? match.prefixes : [];
  const suffixes = Array.isArray(match.suffixes) ? match.suffixes : [];
  if (rule.scope === "bounded_exact") {
    if (!exact.length || prefixes.length || suffixes.length) push(findings, "bounded_exact_rule_must_use_exact_names_only", { rule_key: rule.rule_key });
    return;
  }
  if (rule.scope !== "governed_family") {
    push(findings, "classification_rule_invalid_scope", { rule_key: rule.rule_key, value: rule.scope });
    return;
  }
  if (!prefixes.length && !suffixes.length) push(findings, "governed_family_rule_missing_family_matcher", { rule_key: rule.rule_key });
  if (typeof rule.family_owner !== "string" || rule.family_owner.trim().length < 2) push(findings, "governed_family_rule_missing_owner", { rule_key: rule.rule_key });
  if (rule.future_object_policy !== "same_domain_by_contract") push(findings, "governed_family_rule_invalid_future_object_policy", { rule_key: rule.rule_key, value: rule.future_object_policy });
  if (typeof rule.boundary !== "string" || rule.boundary.trim().length < 24) push(findings, "governed_family_rule_missing_boundary", { rule_key: rule.rule_key });
  const positive = Array.isArray(rule.positive_examples) ? rule.positive_examples : [];
  const negative = Array.isArray(rule.negative_examples) ? rule.negative_examples : [];
  if (!positive.length) push(findings, "governed_family_rule_missing_positive_examples", { rule_key: rule.rule_key });
  if (!negative.length) push(findings, "governed_family_rule_missing_negative_examples", { rule_key: rule.rule_key });
  for (const example of positive) if (!matchesRule(example, match)) push(findings, "governed_family_positive_example_not_matched", { rule_key: rule.rule_key, example });
  for (const example of negative) if (matchesRule(example, match)) push(findings, "governed_family_negative_example_matched", { rule_key: rule.rule_key, example });
}

export function validateRegistryContract(options = {}) {
  const root = options.root || REPO_ROOT;
  const registry = options.registry || readJson(path.join(root, REGISTRY_PATH));
  const schemaObjects = options.schemaObjects || discoverSchemaObjects(root);
  const rules = Array.isArray(registry.rules) ? registry.rules : [];
  const namespaces = Array.isArray(registry.explicit_only_namespaces) ? registry.explicit_only_namespaces : [];
  const findings = [];

  const ruleKeys = new Set();
  for (const [index, rule] of rules.entries()) {
    if (!rule || typeof rule !== "object") {
      push(findings, "invalid_classification_rule", { index });
      continue;
    }
    if (typeof rule.rule_key !== "string" || !rule.rule_key.trim() || ruleKeys.has(rule.rule_key)) push(findings, "invalid_or_duplicate_classification_rule_key", { index, value: rule.rule_key });
    else ruleKeys.add(rule.rule_key);
    validateRuleScope(rule, findings);
  }

  const prefixes = rules.flatMap((rule) => (Array.isArray(rule?.match?.prefixes) ? rule.match.prefixes : []).map((prefix) => ({ prefix, rule_key: rule.rule_key })));
  for (let leftIndex = 0; leftIndex < prefixes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < prefixes.length; rightIndex += 1) {
      const left = prefixes[leftIndex];
      const right = prefixes[rightIndex];
      if (left.prefix.startsWith(right.prefix) || right.prefix.startsWith(left.prefix)) push(findings, "classification_prefix_overlap", { left, right });
    }
  }

  for (const object of schemaObjects) {
    const matchingRules = rules.filter((rule) => matchesRule(object.name, rule.match));
    if (matchingRules.length > 1) push(findings, "schema_classification_rule_overlap", { object_name: object.name, rule_keys: matchingRules.map((rule) => rule.rule_key) });
  }

  const namespaceKeys = new Set();
  const namespacePrefixes = [];
  for (const [index, namespace] of namespaces.entries()) {
    if (!namespace || typeof namespace !== "object") {
      push(findings, "invalid_explicit_only_namespace", { index });
      continue;
    }
    if (typeof namespace.namespace_key !== "string" || !namespace.namespace_key.trim() || namespaceKeys.has(namespace.namespace_key)) push(findings, "invalid_or_duplicate_explicit_only_namespace_key", { index, value: namespace.namespace_key });
    else namespaceKeys.add(namespace.namespace_key);
    if (typeof namespace.owner !== "string" || namespace.owner.trim().length < 2) push(findings, "explicit_only_namespace_missing_owner", { namespace_key: namespace.namespace_key });
    if (namespace.future_object_policy !== "require_explicit_registry_rule") push(findings, "explicit_only_namespace_invalid_future_object_policy", { namespace_key: namespace.namespace_key, value: namespace.future_object_policy });
    if (typeof namespace.rationale !== "string" || namespace.rationale.trim().length < 24) push(findings, "explicit_only_namespace_missing_rationale", { namespace_key: namespace.namespace_key });
    const currentPrefixes = Array.isArray(namespace.prefixes) ? namespace.prefixes.filter(Boolean) : [];
    if (!currentPrefixes.length) push(findings, "explicit_only_namespace_missing_prefix", { namespace_key: namespace.namespace_key });
    for (const prefix of currentPrefixes) namespacePrefixes.push({ prefix, namespace_key: namespace.namespace_key });
  }

  const explicitObjects = schemaObjects.filter((object) => namespacePrefixes.some((row) => object.name.startsWith(row.prefix)));
  const explicitObjectNames = new Set(explicitObjects.map((object) => object.name));
  for (const object of explicitObjects) {
    const matchingRules = rules.filter((rule) => matchesRule(object.name, rule.match));
    if (!matchingRules.length) {
      push(findings, "explicit_only_namespace_object_unregistered", { object_name: object.name, object_type: object.type, sources: object.sources });
      continue;
    }
    if (matchingRules.length > 1) {
      push(findings, "explicit_only_namespace_object_ambiguous", { object_name: object.name, rule_keys: matchingRules.map((rule) => rule.rule_key) });
      continue;
    }
    const rule = matchingRules[0];
    if (rule.scope !== "bounded_exact" || !matchesExactly(object.name, rule.match)) push(findings, "explicit_only_namespace_requires_exact_match", { object_name: object.name, rule_key: rule.rule_key, scope: rule.scope });
  }

  for (const rule of rules) {
    for (const objectName of Array.isArray(rule?.match?.exact_names) ? rule.match.exact_names : []) {
      if (namespacePrefixes.some((row) => objectName.startsWith(row.prefix)) && !explicitObjectNames.has(objectName)) push(findings, "stale_explicit_only_registry_object", { object_name: objectName, rule_key: rule.rule_key });
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    discovered_schema_objects: schemaObjects.length,
    explicit_only_schema_objects: explicitObjects.length,
    rule_count: rules.length,
    namespace_count: namespaces.length,
    registry_path: REGISTRY_PATH,
    secrets_included: false,
  };
}

function main() {
  const result = validateRegistryContract();
  const writer = result.ok ? console.log : console.error;
  writer(JSON.stringify({ gate: "fail_closed", ...result }, null, 2));
  if (!result.ok) process.exit(1);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) main();
