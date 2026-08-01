#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const path = new URL('./hostinger-storage-schema-classification.json', import.meta.url);
const contract = JSON.parse(fs.readFileSync(path, 'utf8'));

const expectedNames = [
  'storage_provider_accounts',
  'storage_targets',
  'storage_target_bindings',
  'storage_pressure_snapshots',
  'storage_cleanup_operations',
  'storage_cleanup_plans',
  'storage_cleanup_plan_items',
  'storage_cleanup_plan_impacts',
  'storage_cleanup_approvals',
  'storage_execution_leases',
  'storage_cleanup_runs',
  'storage_cleanup_run_items',
  'storage_reconciliation_results',
  'storage_emergency_reserves',
  'storage_pressure_incidents',
].sort();

assert.equal(contract.contract, 'spec014.hostinger-storage-schema-classification.v1');
assert.equal(contract.feature_key, '014-governed-hostinger-storage-orchestration');
assert.deepEqual(contract.tasks, ['T021', 'T022']);
assert.equal(contract.status, 'classified_pending_canonical_registry');
assert.equal(contract.canonical_registry_task, 'T023');
assert.equal(contract.default_disposition, 'blocked');
assert.equal(contract.migration_apply_authorized, false);
assert.equal(contract.secrets_included, false);
assert.equal(contract.required_invariants.exact_object_count, 15);
assert.equal(contract.objects.length, 15);

const names = contract.objects.map((entry) => entry.name).sort();
assert.deepEqual(names, expectedNames);
assert.equal(new Set(names).size, names.length);

const allowedDomains = new Set(contract.allowed_domains);
const allowedMaps = new Set([
  'connector-provider-map',
  'data-model-domain-map',
  'delivery-support-map',
  'execution-log-evidence-map',
  'observability-release-map',
  'platform-resource-graph-map',
  'policy-authority-map',
  'workflow-task-orchestration-map',
]);

for (const entry of contract.objects) {
  assert.match(entry.name, /^storage_[a-z0-9_]+$/);
  assert.equal(entry.kind, 'table');
  assert.ok(allowedDomains.has(entry.primary_domain), `${entry.name}: invalid primary domain`);
  assert.ok(Array.isArray(entry.work_maps) && entry.work_maps.length >= 2, `${entry.name}: work maps missing`);
  assert.ok(entry.work_maps.includes('data-model-domain-map'), `${entry.name}: data model map required`);
  assert.ok(entry.work_maps.every((map) => allowedMaps.has(map)), `${entry.name}: unknown work map`);
  assert.ok([1, 2, 3].includes(entry.migration_wave), `${entry.name}: invalid migration wave`);
  assert.ok(entry.primary_key.length > 0, `${entry.name}: primary key required`);
  assert.ok(entry.unique_keys.length > 0, `${entry.name}: unique key required`);
  assert.ok(entry.required_indexes.length > 0, `${entry.name}: indexes required`);
  assert.ok(entry.write_authority.length > 0, `${entry.name}: write authority required`);
  assert.ok(entry.immutability.length > 0, `${entry.name}: immutability contract required`);
  assert.ok(entry.retention.length > 0, `${entry.name}: retention contract required`);
  assert.ok(entry.sensitive_data_policy.length > 0, `${entry.name}: sensitive-data policy required`);
  assert.doesNotMatch(entry.sensitive_data_policy, /(^|_)(raw_secret|private_key|password|token_payload)($|_)/i);
}

const byName = new Map(contract.objects.map((entry) => [entry.name, entry]));
assert.deepEqual(byName.get('storage_cleanup_plan_items').unique_keys, [
  ['plan_id', 'ordinal'],
  ['plan_id', 'item_hash'],
]);
assert.match(byName.get('storage_execution_leases').immutability, /compare_and_swap/);
assert.match(byName.get('storage_cleanup_plans').immutability, /immutable/);
assert.match(byName.get('storage_cleanup_run_items').immutability, /append_only/);
assert.match(byName.get('storage_cleanup_approvals').sensitive_data_policy, /no_plaintext_confirmation/);
assert.match(byName.get('storage_provider_accounts').sensitive_data_policy, /no_credentials/);
assert.match(byName.get('storage_cleanup_plan_items').sensitive_data_policy, /no_file_content/);

for (const invariant of [
  'all_objects_are_additive',
  'all_paths_are_opaque_or_encrypted',
  'canonical_registry_update_required_before_sql',
  'same_cycle_schema_readback_required',
]) {
  assert.equal(contract.required_invariants[invariant], true, invariant);
}
for (const invariant of [
  'credentials_or_secret_payloads_stored',
  'raw_file_contents_stored',
  'migration_apply_authorized',
]) {
  assert.equal(contract.required_invariants[invariant], false, invariant);
}

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_schema_classification_contract',
  feature_key: contract.feature_key,
  tasks_classified: contract.tasks,
  object_count: contract.objects.length,
  migration_waves: [...new Set(contract.objects.map((entry) => entry.migration_wave))].sort(),
  canonical_registry_task_pending: contract.canonical_registry_task,
  sql_created: false,
  migration_apply_authorized: false,
  secrets_included: false,
}));
