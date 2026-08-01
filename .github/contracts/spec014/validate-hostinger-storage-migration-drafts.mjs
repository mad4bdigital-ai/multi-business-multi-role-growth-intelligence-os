#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const manifestPath = path.join(HERE, 'hostinger-storage-migration-drafts.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

assert.equal(manifest.contract, 'spec014.hostinger-storage-migration-drafts.v1');
assert.equal(manifest.feature_key, '014-governed-hostinger-storage-orchestration');
assert.deepEqual(manifest.tasks, ['T024', 'T025', 'T026', 'T027']);
assert.equal(manifest.status, 'draft_review_only');
assert.equal(manifest.location_policy.spec_local_only, true);
assert.equal(manifest.location_policy.discoverable_by_governed_migration_runner, false);
assert.equal(manifest.location_policy.migration_apply_authorized, false);
assert.equal(manifest.required_invariants.exact_table_count, 15);
assert.equal(manifest.required_invariants.exact_view_count, 3);
assert.equal(manifest.required_invariants.exact_default_off_tool_count, 3);
assert.equal(manifest.required_invariants.provider_dispatch_authorized, false);
assert.equal(manifest.required_invariants.migration_apply_authorized, false);
assert.equal(manifest.required_invariants.secrets_included, false);

const expectedByWave = new Map([
  [1, ['storage_provider_accounts', 'storage_targets', 'storage_target_bindings', 'storage_pressure_snapshots']],
  [2, ['storage_cleanup_operations', 'storage_cleanup_plans', 'storage_cleanup_plan_items', 'storage_cleanup_plan_impacts', 'storage_cleanup_approvals', 'storage_execution_leases']],
  [3, ['storage_cleanup_runs', 'storage_cleanup_run_items', 'storage_reconciliation_results', 'storage_emergency_reserves', 'storage_pressure_incidents']],
]);
const expectedTables = [...expectedByWave.values()].flat().sort();
assert.equal(expectedTables.length, 15);
assert.equal(new Set(expectedTables).size, expectedTables.length);
assert.deepEqual(manifest.waves.map((wave) => wave.id), [1, 2, 3]);

const allDraftSql = [];
for (const wave of manifest.waves) {
  assert.ok(wave.file.startsWith('specs/014-governed-hostinger-storage-orchestration/migrations/'));
  assert.ok(!wave.file.startsWith(manifest.location_policy.runtime_migration_directory));
  assert.deepEqual([...wave.objects].sort(), [...expectedByWave.get(wave.id)].sort());

  const sql = read(wave.file);
  allDraftSql.push(sql);
  for (const marker of [
    'DRAFT ONLY',
    'migration_apply_authorized=false',
    'no_provider_call',
    'no_credential_payload_read',
    'no_raw_secrets',
    'no_external_send',
    'no_external_write',
    'secrets_included=false',
  ]) assert.ok(sql.includes(marker), `${wave.file}: missing ${marker}`);

  const creates = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z0-9_]+)/g)].map((match) => match[1]);
  assert.deepEqual(creates.sort(), [...wave.objects].sort(), `${wave.file}: exact table set`);
  assert.equal(new Set(creates).size, creates.length, `${wave.file}: duplicate table`);
  assert.equal((sql.match(/ENGINE=InnoDB/g) || []).length, wave.objects.length);
  assert.equal((sql.match(/DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci/g) || []).length, wave.objects.length);
  assert.doesNotMatch(sql, /^\s*(DROP|TRUNCATE|DELETE)\s+/gmi, `${wave.file}: destructive statement`);
  assert.doesNotMatch(sql, /^\s*ALTER\s+TABLE\s+/gmi, `${wave.file}: guessed alter statement`);
  assert.doesNotMatch(sql, /\b(password|private_key|access_token|refresh_token|secret_payload)\b/i, `${wave.file}: forbidden secret column`);
}

const combined = allDraftSql.join('\n');
const createdTables = [...combined.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z0-9_]+)/g)].map((match) => match[1]).sort();
assert.deepEqual(createdTables, expectedTables);
assert.equal(new Set(createdTables).size, 15);
assert.ok((combined.match(/FOREIGN KEY/g) || []).length >= 15, 'internal foreign keys required');
assert.ok(combined.includes('external_fk_ddl_deferred_until_exact_parent_readback=true'));

const wave3 = manifest.waves.find((wave) => wave.id === 3);
const wave3Sql = read(wave3.file);
const views = [...wave3Sql.matchAll(/CREATE OR REPLACE VIEW\s+([a-z0-9_]+)/g)].map((match) => match[1]).sort();
assert.deepEqual(views, [...wave3.views].sort());
for (const tool of wave3.default_off_tools) {
  assert.ok(wave3Sql.includes(`'${tool}'`), `${tool}: missing seed`);
}
assert.equal((wave3Sql.match(/\n\s*0,\n\s*36[0-2]\n\)/g) || []).length, 3, 'all tools must seed disabled');
assert.ok(wave3Sql.includes('is_enabled = 0'));
assert.ok(wave3Sql.includes('tool_and_operation_seeds_default_off=true'));

for (const [kind, relative] of Object.entries({
  preflight: manifest.verification.preflight_file,
  readback: manifest.verification.readback_file,
  rollback: manifest.verification.rollback_file,
})) {
  const sql = read(relative);
  assert.ok(relative.startsWith('specs/014-governed-hostinger-storage-orchestration/migrations/'));
  assert.ok(sql.includes('migration_apply_authorized=false'));
  assert.ok(sql.includes('secrets_included=false'));
  assert.doesNotMatch(sql, /^\s*(DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER|CREATE)\s+/gmi, `${kind}: must remain read-only`);
}
const preflight = read(manifest.verification.preflight_file);
for (const parent of manifest.external_fk_policy.required_parent_readback) {
  const [table, column] = parent.split('.');
  assert.ok(preflight.includes(`'${table}'`));
  assert.ok(preflight.includes(`'${column}'`));
}
const readback = read(manifest.verification.readback_file);
assert.ok(readback.includes('= 15'));
assert.ok(readback.includes('= 3'));
for (const tool of wave3.default_off_tools) assert.ok(readback.includes(`'${tool}'`));
const rollback = read(manifest.verification.rollback_file);
assert.ok(rollback.includes('rollback_requires_separate_authority=true'));
assert.ok(rollback.includes('rollback_pre_live_only=true'));
assert.ok(rollback.includes("'not_executed' AS execution_status"));
assert.equal((rollback.match(/separately_governed_statement/g) || []).length >= 1, true);

const runtimeMigrationNames = fs.existsSync(path.join(ROOT, 'http-generic-api', 'migrations'))
  ? fs.readdirSync(path.join(ROOT, 'http-generic-api', 'migrations'))
  : [];
for (const file of manifest.waves.map((wave) => path.basename(wave.file))) {
  assert.equal(runtimeMigrationNames.includes(file), false, `${file}: must not be runnable`);
}

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_migration_drafts',
  feature_key: manifest.feature_key,
  tasks: manifest.tasks,
  wave_count: manifest.waves.length,
  table_count: createdTables.length,
  view_count: views.length,
  default_off_tool_count: wave3.default_off_tools.length,
  spec_local_only: true,
  discoverable_by_governed_migration_runner: false,
  migration_apply_authorized: false,
  provider_dispatch_authorized: false,
  secrets_included: false,
}));
