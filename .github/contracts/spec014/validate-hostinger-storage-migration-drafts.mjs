#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const manifestPath = path.join(HERE, 'hostinger-storage-migration-drafts.json');
const classificationPath = path.join(HERE, 'hostinger-storage-schema-classification.json');
const runtimePath = path.join(HERE, 'hostinger-storage-sql-runtime-contract.json');
const adapterPath = path.join(ROOT, 'http-generic-api', 'hostingerStorageSqlPersistenceAdapter.js');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const classification = JSON.parse(fs.readFileSync(classificationPath, 'utf8'));
const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
const adapterSource = fs.readFileSync(adapterPath, 'utf8');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const normalize = (value) => value.replace(/\s+/gu, ' ').trim();

assert.equal(manifest.contract, 'spec014.hostinger-storage-migration-drafts.v2');
assert.equal(manifest.feature_key, '014-governed-hostinger-storage-orchestration');
assert.deepEqual(manifest.tasks, ['T024', 'T025', 'T026', 'T027']);
assert.equal(manifest.status, 'draft_review_ready');
assert.equal(manifest.classification_source, '.github/contracts/spec014/hostinger-storage-schema-classification.json');
assert.equal(manifest.runtime_contract_source, '.github/contracts/spec014/hostinger-storage-sql-runtime-contract.json');
assert.equal(manifest.location_policy.spec_local_only, true);
assert.equal(manifest.location_policy.discoverable_by_governed_migration_runner, false);
assert.equal(manifest.location_policy.migration_apply_authorized, false);
assert.equal(manifest.required_invariants.exact_table_count, 15);
assert.equal(manifest.required_invariants.exact_view_count, 3);
assert.equal(manifest.required_invariants.exact_default_off_tool_count, 3);
assert.equal(manifest.required_invariants.provider_dispatch_authorized, false);
assert.equal(manifest.required_invariants.migration_apply_authorized, false);
assert.equal(manifest.required_invariants.schema_verified, false);
assert.equal(manifest.required_invariants.production_ready, false);
assert.equal(manifest.required_invariants.secrets_included, false);
assert.equal(manifest.compatibility.runtime_table_count, 6);
assert.equal(manifest.compatibility.adapter_insert_compatible, true);
assert.equal(runtime.contract, 'spec014.hostinger-storage-sql-runtime.v1');
assert.equal(runtime.feature_key, manifest.feature_key);

const expectedByWave = new Map([
  [1, ['storage_provider_accounts', 'storage_targets', 'storage_target_bindings', 'storage_pressure_snapshots']],
  [2, ['storage_cleanup_operations', 'storage_cleanup_plans', 'storage_cleanup_plan_items', 'storage_cleanup_plan_impacts', 'storage_cleanup_approvals', 'storage_execution_leases']],
  [3, ['storage_cleanup_runs', 'storage_cleanup_run_items', 'storage_reconciliation_results', 'storage_emergency_reserves', 'storage_pressure_incidents']],
]);
const expectedTables = [...expectedByWave.values()].flat().sort();
assert.equal(expectedTables.length, 15);
assert.equal(new Set(expectedTables).size, expectedTables.length);
assert.deepEqual(manifest.waves.map((wave) => wave.id), [1, 2, 3]);

function tableBody(sql, tableName) {
  const match = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${tableName}\\s*\\(([\\s\\S]*?)\\n\\) ENGINE=InnoDB`, 'u'));
  assert(match, `${tableName}: CREATE TABLE body missing`);
  return match[1];
}

function tableColumns(body) {
  const columns = new Map();
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim().replace(/,$/u, '');
    if (!line || /^(PRIMARY|UNIQUE|KEY|CONSTRAINT|FOREIGN|CHECK)\b/u.test(line)) continue;
    const match = line.match(/^([a-z][a-z0-9_]*)\s+(.+)$/u);
    if (match) columns.set(match[1], match[2]);
  }
  return columns;
}

function adapterInsertColumns(logicalKey) {
  const pattern = new RegExp(
    `spec014:insert:${logicalKey}[\\s\\S]*?INSERT INTO \\$\\{SAFE_TABLES\\.${logicalKey}\\} \\(([^)]+)\\)`,
    'u',
  );
  const match = adapterSource.match(pattern);
  assert(match, `${logicalKey}: adapter INSERT contract missing`);
  return match[1].split(',').map((entry) => entry.trim());
}

function hasOrderedKey(body, keyColumns) {
  const joined = keyColumns.map((column) => column.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('\\s*,\\s*');
  if (keyColumns.length === 1 && new RegExp(`PRIMARY KEY\\s*\\(\\s*${joined}\\s*\\)`, 'u').test(body)) return true;
  return new RegExp(`UNIQUE KEY\\s+[a-z0-9_]+\\s*\\(\\s*${joined}\\s*\\)`, 'u').test(normalize(body));
}

const classified = new Map(classification.objects.map((entry) => [entry.name, entry]));
const allDraftSql = [];
const sqlByTable = new Map();

for (const wave of manifest.waves) {
  assert.ok(wave.file.startsWith('specs/014-governed-hostinger-storage-orchestration/migrations/'));
  assert.ok(!wave.file.startsWith(manifest.location_policy.runtime_migration_directory));
  assert.deepEqual([...wave.objects].sort(), [...expectedByWave.get(wave.id)].sort());

  const sql = read(wave.file);
  allDraftSql.push(sql);
  for (const marker of [
    'DRAFT ONLY',
    'migration_apply_authorized=false',
    'schema_verified=false',
    'production_ready=false',
    'no_provider_call',
    'no_credential_payload_read',
    'no_raw_secrets',
    'no_external_send',
    'no_external_write',
    'secrets_included=false',
  ]) assert.ok(sql.includes(marker), `${wave.file}: missing ${marker}`);

  const creates = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z0-9_]+)/gu)].map((match) => match[1]);
  assert.deepEqual(creates.sort(), [...wave.objects].sort(), `${wave.file}: exact table set`);
  assert.equal(new Set(creates).size, creates.length, `${wave.file}: duplicate table`);
  assert.equal((sql.match(/ENGINE=InnoDB/gu) || []).length, wave.objects.length);
  assert.equal((sql.match(/DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci/gu) || []).length, wave.objects.length);
  assert.doesNotMatch(sql, /^\s*(DROP|TRUNCATE|DELETE)\s+/gmiu, `${wave.file}: destructive statement`);
  assert.doesNotMatch(sql, /^\s*ALTER\s+TABLE\s+/gmiu, `${wave.file}: guessed alter statement`);
  assert.doesNotMatch(sql, /\b(password|private_key|access_token|refresh_token|secret_payload)\b/iu, `${wave.file}: forbidden secret column`);
  for (const table of wave.objects) {
    assert(classified.has(table), `${table}: canonical classification missing`);
    sqlByTable.set(table, sql);
  }
}

const combined = allDraftSql.join('\n');
const createdTables = [...combined.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z0-9_]+)/gu)].map((match) => match[1]).sort();
assert.deepEqual(createdTables, expectedTables);
assert.equal(new Set(createdTables).size, 15);
assert.ok((combined.match(/FOREIGN KEY/gu) || []).length >= 15, 'internal foreign keys required');
assert.ok(combined.includes('external_fk_ddl_deferred_until_exact_parent_readback=true'));
assert.ok(combined.includes('runtime_parent_fk_ddl_deferred_until_parent_writer=true'));
assert.doesNotMatch(combined, /CREATE OR REPLACE VIEW/iu);
assert.doesNotMatch(combined, /ON DUPLICATE KEY UPDATE/iu);

const runtimeNames = runtime.tables.map((entry) => entry.name).sort();
const manifestRuntimeNames = manifest.waves.flatMap((wave) => wave.runtime_adapter_tables || []).sort();
assert.deepEqual(manifestRuntimeNames, runtimeNames);

for (const table of runtime.tables) {
  const sql = sqlByTable.get(table.name);
  assert(sql, `${table.name}: migration wave missing`);
  const body = tableBody(sql, table.name);
  const columns = tableColumns(body);
  for (const column of table.required_columns) {
    assert(columns.has(column), `${table.name}.${column}: required runtime column missing`);
  }
  assert.ok(hasOrderedKey(body, table.primary_key), `${table.name}: primary key mismatch`);
  for (const key of table.required_unique_keys) {
    assert.ok(hasOrderedKey(body, key), `${table.name}: required key (${key.join(',')}) missing`);
  }

  const insertColumns = adapterInsertColumns(table.logical_key);
  assert.deepEqual(insertColumns, table.required_columns, `${table.name}: adapter insert/runtime column drift`);

  for (const [column, definition] of columns) {
    if (!/\bNOT NULL\b/iu.test(definition)) continue;
    if (insertColumns.includes(column)) continue;
    assert.match(
      definition,
      /\b(DEFAULT|AUTO_INCREMENT|GENERATED ALWAYS AS)\b/iu,
      `${table.name}.${column}: adapter-omitted NOT NULL column needs DEFAULT, GENERATED, or AUTO_INCREMENT`,
    );
  }
  assert.match(body, /record_digest\s+CHAR\(64\)\s+NOT NULL/iu);
  assert.match(body, /record_json\s+JSON\s+NOT NULL/iu);
  assert.match(body, /row_version\s+BIGINT UNSIGNED\s+NOT NULL\s+DEFAULT 1/iu);
}

const wave3 = manifest.waves.find((wave) => wave.id === 3);
const wave3Sql = read(wave3.file);
const views = [...wave3Sql.matchAll(/CREATE VIEW\s+([a-z0-9_]+)/gu)].map((match) => match[1]).sort();
assert.deepEqual(views, [...wave3.views].sort());
for (const tool of wave3.default_off_tools) assert.ok(wave3Sql.includes(`'${tool}'`), `${tool}: missing seed`);
assert.equal((wave3Sql.match(/\n\s*0,\n\s*36[0-2]\n\)/gu) || []).length, 3, 'all tools must seed disabled');
assert.ok(wave3Sql.includes('tool_and_operation_seeds_default_off=true'));
assert.ok(wave3Sql.includes('runtime_parent_fk_ddl_deferred_until_parent_writer=true'));
assert.doesNotMatch(wave3Sql, /FOREIGN KEY \(run_id\) REFERENCES storage_cleanup_runs/iu);
assert.doesNotMatch(wave3Sql, /FOREIGN KEY \(plan_item_id\) REFERENCES storage_cleanup_plan_items/iu);

for (const [kind, relative] of Object.entries({
  preflight: manifest.verification.preflight_file,
  readback: manifest.verification.readback_file,
  rollback: manifest.verification.rollback_file,
})) {
  const sql = read(relative);
  assert.ok(relative.startsWith('specs/014-governed-hostinger-storage-orchestration/migrations/'));
  assert.ok(sql.includes('migration_apply_authorized=false'));
  assert.ok(sql.includes('schema_verified=false'));
  assert.ok(sql.includes('production_ready=false'));
  assert.ok(sql.includes('secrets_included=false'));
  assert.doesNotMatch(sql, /^\s*(DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER|CREATE)\s+/gmiu, `${kind}: must remain read-only`);
}

const preflight = read(manifest.verification.preflight_file);
for (const parent of manifest.external_fk_policy.required_parent_readback) {
  const [table, column] = parent.split('.');
  assert.ok(preflight.includes(`'${table}'`));
  assert.ok(preflight.includes(`'${column}'`));
}
for (const table of runtime.tables) {
  for (const column of table.required_columns) {
    assert.ok(preflight.includes(`'${table.name}'`), `${table.name}: preflight table missing`);
    assert.ok(preflight.includes(`'${column}'`), `${table.name}.${column}: preflight missing`);
  }
}
assert.ok(preflight.includes("'admin_platform_endpoint_tools'"));
assert.ok(preflight.includes('blocked_existing_tool_key_requires_reconciliation'));

const readback = read(manifest.verification.readback_file);
assert.ok(readback.includes('= 15'));
assert.ok(readback.includes('= 3'));
assert.ok(readback.includes('signed_schema_verification_required=true'));
assert.ok(readback.includes("'candidate_only_unsigned' AS schema_verification_status"));
for (const tool of wave3.default_off_tools) assert.ok(readback.includes(`'${tool}'`));

const rollback = read(manifest.verification.rollback_file);
assert.ok(rollback.includes('rollback_requires_separate_authority=true'));
assert.ok(rollback.includes('rollback_pre_live_only=true'));
assert.ok(rollback.includes("'not_executed' AS execution_status"));
assert.ok((rollback.match(/separately_governed_statement/gu) || []).length >= 1);

const runtimeMigrationNames = fs.existsSync(path.join(ROOT, 'http-generic-api', 'migrations'))
  ? fs.readdirSync(path.join(ROOT, 'http-generic-api', 'migrations'))
  : [];
for (const file of manifest.waves.map((wave) => path.basename(wave.file))) {
  assert.equal(runtimeMigrationNames.includes(file), false, `${file}: must not be runnable`);
}

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_migration_drafts',
  contract: manifest.contract,
  feature_key: manifest.feature_key,
  tasks: manifest.tasks,
  wave_count: manifest.waves.length,
  table_count: createdTables.length,
  runtime_adapter_table_count: runtime.tables.length,
  runtime_required_column_count: runtime.tables.reduce((sum, table) => sum + table.required_columns.length, 0),
  view_count: views.length,
  default_off_tool_count: wave3.default_off_tools.length,
  spec_local_only: true,
  adapter_insert_compatible: true,
  discoverable_by_governed_migration_runner: false,
  schema_verified: false,
  production_ready: false,
  migration_apply_authorized: false,
  provider_dispatch_authorized: false,
  secrets_included: false,
}));
