#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const registryPath = '.specify/work-map-schema-classification-registry.json';
const contractPath = '.github/contracts/spec014/hostinger-storage-schema-classification.json';
const validatorPath = '.github/contracts/spec014/validate-hostinger-storage-schema-classification.mjs';
const guardPath = '.github/workflows/hostinger-storage-schema-classification-guard.yml';
const tasksPath = 'specs/014-governed-hostinger-storage-orchestration/tasks.md';

const readJson = (path) => JSON.parse(fs.readFileSync(path, 'utf8'));
const writeJson = (path, value, pretty = true) => fs.writeFileSync(path, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const matchesRule = (name, match = {}) => (match.exact_names || []).includes(name)
  || (match.prefixes || []).some((prefix) => name.startsWith(prefix))
  || (match.suffixes || []).some((suffix) => name.endsWith(suffix));

const registry = readJson(registryPath);
const contract = readJson(contractPath);
assert.equal(contract.contract, 'spec014.hostinger-storage-schema-classification.v1');
assert.equal(contract.status, 'classified_pending_canonical_registry');
assert.equal(contract.canonical_registry_task, 'T023');
assert.equal(contract.migration_apply_authorized, false);
assert.equal(contract.secrets_included, false);
assert.equal(contract.objects.length, 15);

const expectedNames = new Set(contract.objects.map((entry) => entry.name));
assert.equal(expectedNames.size, 15);
const generatedRuleKeys = new Set(contract.objects.map((entry) => `spec014_hostinger_${entry.name}`));

for (const entry of contract.objects) {
  const collisions = registry.rules.filter((rule) => !generatedRuleKeys.has(rule.rule_key) && matchesRule(entry.name, rule.match));
  assert.deepEqual(collisions.map((rule) => rule.rule_key), [], `${entry.name}: pre-existing classification overlap`);
}

registry.rules = registry.rules.filter((rule) => !generatedRuleKeys.has(rule.rule_key));
for (const entry of [...contract.objects].sort((left, right) => left.name.localeCompare(right.name))) {
  registry.rules.push({
    rule_key: `spec014_hostinger_${entry.name}`,
    scope: 'bounded_exact',
    match: { exact_names: [entry.name] },
    domain: entry.primary_domain,
    existing_map_refs: [...entry.work_maps],
    rationale: `Spec 014 classifies ${entry.name} before SQL creation within the existing ${entry.primary_domain} domain and its governed Work Map boundaries.`,
  });
}

const registeredRules = registry.rules.filter((rule) => generatedRuleKeys.has(rule.rule_key));
assert.equal(registeredRules.length, 15);
for (const entry of contract.objects) {
  const matches = registeredRules.filter((rule) => matchesRule(entry.name, rule.match));
  assert.equal(matches.length, 1, `${entry.name}: exact canonical rule required`);
  const [rule] = matches;
  assert.equal(rule.scope, 'bounded_exact');
  assert.deepEqual(rule.match, { exact_names: [entry.name] });
  assert.equal(rule.domain, entry.primary_domain);
  assert.deepEqual(rule.existing_map_refs, entry.work_maps);
}

contract.status = 'canonical_registry_registered';
contract.canonical_registry_registration = {
  task: 'T023',
  registry_path: registryPath,
  rule_scope: 'bounded_exact',
  rule_count: registeredRules.length,
  exact_object_names_sha256: sha256([...expectedNames].sort().join('\n')),
  sql_created: false,
  migration_apply_authorized: false,
  secrets_included: false,
};
contract.required_invariants.canonical_registry_registered_before_sql = true;

let validator = fs.readFileSync(validatorPath, 'utf8');
validator = validator.replace(
  "assert.equal(contract.status, 'classified_pending_canonical_registry');",
  "assert.equal(contract.status, 'canonical_registry_registered');",
);
assert.ok(validator.includes("assert.equal(contract.status, 'canonical_registry_registered');"));
const insertionMarker = "const byName = new Map(contract.objects.map((entry) => [entry.name, entry]));";
assert.ok(validator.includes(insertionMarker));
const registryValidation = `const canonicalRegistryPath = new URL('../../../.specify/work-map-schema-classification-registry.json', import.meta.url);\nconst canonicalRegistry = JSON.parse(fs.readFileSync(canonicalRegistryPath, 'utf8'));\nconst canonicalRules = canonicalRegistry.rules.filter((rule) => String(rule.rule_key || '').startsWith('spec014_hostinger_storage_'));\nassert.equal(canonicalRules.length, contract.objects.length);\nfor (const entry of contract.objects) {\n  const matches = canonicalRules.filter((rule) => Array.isArray(rule?.match?.exact_names) && rule.match.exact_names.includes(entry.name));\n  assert.equal(matches.length, 1, entry.name + ': one canonical exact rule required');\n  const [rule] = matches;\n  assert.equal(rule.scope, 'bounded_exact');\n  assert.deepEqual(rule.match, { exact_names: [entry.name] });\n  assert.equal(rule.domain, entry.primary_domain);\n  assert.deepEqual(rule.existing_map_refs, entry.work_maps);\n}\nassert.equal(contract.canonical_registry_registration.task, 'T023');\nassert.equal(contract.canonical_registry_registration.registry_path, '.specify/work-map-schema-classification-registry.json');\nassert.equal(contract.canonical_registry_registration.rule_scope, 'bounded_exact');\nassert.equal(contract.canonical_registry_registration.rule_count, contract.objects.length);\nassert.equal(contract.canonical_registry_registration.sql_created, false);\nassert.equal(contract.canonical_registry_registration.migration_apply_authorized, false);\nassert.equal(contract.canonical_registry_registration.secrets_included, false);\nassert.equal(contract.required_invariants.canonical_registry_registered_before_sql, true);\n\n`;
if (!validator.includes('const canonicalRegistryPath =')) validator = validator.replace(insertionMarker, `${registryValidation}${insertionMarker}`);
validator = validator.replace(
  "  canonical_registry_task_pending: contract.canonical_registry_task,",
  "  canonical_registry_task_completed: contract.canonical_registry_registration.task,\n  canonical_registry_rule_count: contract.canonical_registry_registration.rule_count,",
);
assert.ok(validator.includes('canonical_registry_task_completed'));

let guard = fs.readFileSync(guardPath, 'utf8');
guard = guard.replace(
  "grep -q '\"status\":\"classified_pending_canonical_registry\"' .github/contracts/spec014/hostinger-storage-schema-classification.json",
  "grep -q '\"status\":\"canonical_registry_registered\"' .github/contracts/spec014/hostinger-storage-schema-classification.json",
);
assert.ok(guard.includes('canonical_registry_registered'));
const validatorStep = '      - name: Validate exact schema classification contract\n        run: node .github/contracts/spec014/validate-hostinger-storage-schema-classification.mjs\n';
assert.ok(guard.includes(validatorStep));
const officialSteps = `${validatorStep}      - name: Validate canonical Work Map registry contract\n        run: node http-generic-api/scripts/work-map-schema-classification-contract.mjs\n      - name: Validate current Work Map classification coverage\n        run: node http-generic-api/scripts/work-map-schema-classification.mjs\n`;
guard = guard.replace(validatorStep, officialSteps);

let tasks = fs.readFileSync(tasksPath, 'utf8');
tasks = tasks.replace(
  '- [ ] **T021** [P] Classify proposed tables/views into existing schema domains and Work Maps.',
  '- [x] **T021** [P] Classify proposed tables/views into existing schema domains and Work Maps. Evidence: `.github/contracts/spec014/hostinger-storage-schema-classification.json` enumerates the exact 15 additive tables and binds each to one existing domain and its Work Maps.',
);
tasks = tasks.replace(
  '- [ ] **T022** Define indexes, uniqueness, FK, CAS lease, immutable-plan, retention, and encrypted/opaque path constraints.',
  '- [x] **T022** Define indexes, uniqueness, FK, CAS lease, immutable-plan, retention, and encrypted/opaque path constraints. Evidence: the guarded schema-classification contract and validator enforce per-object keys, indexes, authority, immutability, retention, and sensitive-data boundaries.',
);
tasks = tasks.replace(
  '- [ ] **T023** Update canonical schema classification registry before SQL creation; prove zero ambiguity/unresolved objects.',
  '- [x] **T023** Update canonical schema classification registry before SQL creation; prove zero ambiguity/unresolved objects. Evidence: `.specify/work-map-schema-classification-registry.json` contains one bounded exact rule per proposed table; the official registry-contract and classification validators remain fail-closed. No SQL or migration apply is included.',
);
for (const task of ['T021', 'T022', 'T023']) assert.match(tasks, new RegExp(`- \\[x\\] \\*\\*${task}\\*\\*`));

writeJson(registryPath, registry, true);
writeJson(contractPath, contract, false);
fs.writeFileSync(validatorPath, validator);
fs.writeFileSync(guardPath, guard);
fs.writeFileSync(tasksPath, tasks);

console.log(JSON.stringify({
  ok: true,
  task: 'T023',
  registry_path: registryPath,
  bounded_exact_rules_added: registeredRules.length,
  object_count: contract.objects.length,
  tasks_completed: ['T021', 'T022', 'T023'],
  sql_created: false,
  migration_apply_authorized: false,
  secrets_included: false,
}));
