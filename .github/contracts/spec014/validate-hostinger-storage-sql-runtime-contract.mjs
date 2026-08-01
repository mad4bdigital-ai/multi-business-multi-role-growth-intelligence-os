#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runtimePath = new URL('./hostinger-storage-sql-runtime-contract.json', import.meta.url);
const classificationPath = new URL('./hostinger-storage-schema-classification.json', import.meta.url);
const adapterPath = new URL('../../../http-generic-api/hostingerStorageSqlPersistenceAdapter.js', import.meta.url);
const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
const classification = JSON.parse(fs.readFileSync(classificationPath, 'utf8'));
const adapterSource = fs.readFileSync(adapterPath, 'utf8');

assert.equal(runtime.contract, 'spec014.hostinger-storage-sql-runtime.v1');
assert.equal(runtime.feature_key, classification.feature_key);
assert.equal(runtime.classification_source, '.github/contracts/spec014/hostinger-storage-schema-classification.json');
assert.equal(runtime.canonical_registry_source, '.specify/work-map-schema-classification-registry.json');
assert.equal(runtime.canonical_registry_task, 'T023');
assert.equal(runtime.migration_wave, 2);
assert.equal(runtime.adapter_key, 'hostinger_storage_mysql_control_plane_v1');
assert.equal(runtime.schema_verified_default, false);
assert.equal(runtime.production_ready_default, false);
assert.equal(runtime.migration_apply_authorized, false);
assert.equal(runtime.auto_create_schema, false);
assert.equal(runtime.auto_alter_schema, false);
assert.equal(runtime.auto_drop_schema, false);
assert.equal(runtime.provider_dispatch_authorized, false);
assert.equal(runtime.secrets_included, false);

const classified = new Map(classification.objects.map((entry) => [entry.name, entry]));
assert.equal(runtime.tables.length, 6);
assert.equal(new Set(runtime.tables.map((entry) => entry.name)).size, runtime.tables.length);
for (const table of runtime.tables) {
  const classificationEntry = classified.get(table.name);
  assert(classificationEntry, `${table.name}: missing Spec 014 classification`);
  assert.equal(classificationEntry.kind, 'table');
  assert.equal(classificationEntry.migration_wave, table.name === 'storage_cleanup_run_items' || table.name === 'storage_reconciliation_results' ? 3 : 2);
  assert.ok(table.primary_key.length > 0, `${table.name}: primary key required`);
  assert.ok(table.required_columns.includes('record_digest'), `${table.name}: record_digest required`);
  assert.ok(table.required_columns.includes('record_json'), `${table.name}: record_json required`);
  assert.ok(table.required_columns.includes('row_version'), `${table.name}: row_version required`);
  assert.ok(table.required_unique_keys.length > 0, `${table.name}: unique key contract required`);
  assert.ok(table.retention.length > 0, `${table.name}: retention contract required`);
  if (table.append_only === true) assert.deepEqual(table.mutable_columns, []);
  else assert.equal(table.cas_column, 'row_version');
  assert.match(adapterSource, new RegExp(`['\"]${table.name}['\"]`));
}

for (const token of [
  'GET_LOCK',
  'RELEASE_LOCK',
  ' FOR UPDATE',
  'beginTransaction',
  'rollback',
  'row_version=row_version+1',
  'STORAGE_SQL_CAS_CONFLICT',
  'STORAGE_SQL_DELETE_FORBIDDEN',
]) {
  assert.ok(adapterSource.includes(token), `adapter missing ${token}`);
}

assert.doesNotMatch(adapterSource, /\b(?:CREATE|ALTER|DROP|TRUNCATE)\s+TABLE\b/iu);
assert.doesNotMatch(adapterSource, /child_process|node:(?:fs|net|tls|http|https)|StrictHostKeyChecking=no|rm\s+-rf/iu);
assert.doesNotMatch(adapterSource, /hostinger\.com|ssh\s|private[_-]?key|password\s*[:=]/iu);
assert.equal(runtime.transaction_contract.mysql_transaction_required, true);
assert.equal(runtime.transaction_contract.advisory_lock_required, true);
assert.equal(runtime.transaction_contract.select_for_update_required, true);
assert.equal(runtime.transaction_contract.row_version_compare_and_swap_required, true);
assert.equal(runtime.transaction_contract.rollback_on_any_failure, true);
assert.equal(runtime.transaction_contract.restart_readback_required, true);
assert.equal(runtime.transaction_contract.delete_forbidden, true);
assert.equal(runtime.record_contract.secrets_included_must_be_false, true);
assert.equal(runtime.record_contract.credentials_or_secret_payloads_stored, false);
assert.equal(runtime.record_contract.raw_paths_or_file_contents_stored, false);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_sql_runtime_contract',
  table_count: runtime.tables.length,
  tables_classified: true,
  canonical_registry_task: runtime.canonical_registry_task,
  transaction_and_cas_required: true,
  restart_readback_required: true,
  ddl_present: false,
  migration_apply_authorized: false,
  provider_dispatch_authorized: false,
  secrets_included: false,
}));
