#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_SCHEMA_CONTRACT,
  HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_SCHEMA_DIGEST,
} from './hostingerStorageDurableAuthorizedInjectionState.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const contractPath = path.join(root, '.github/contracts/spec014/hostinger-storage-durable-authorized-injection-state.json');
const ddlPath = path.join(root, '.github/contracts/spec014/sql/hostinger-storage-durable-authorized-injection-state.sql');
const modulePath = path.join(here, 'hostingerStorageDurableAuthorizedInjectionState.js');

const [contractText, ddl, moduleText] = await Promise.all([
  readFile(contractPath, 'utf8'),
  readFile(ddlPath, 'utf8'),
  readFile(modulePath, 'utf8'),
]);
const contract = JSON.parse(contractText);

const expectedTables = [
  'storage_authorized_injection_states',
  'storage_authorized_injection_rollbacks',
];
assert.deepEqual([...HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_SCHEMA_CONTRACT.tables], expectedTables);
assert.deepEqual(contract.schema_contract.tables, expectedTables);
assert.equal(contract.schema_contract.contract_key, HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_SCHEMA_CONTRACT.contract_key);
assert.equal(contract.schema_contract.ddl_contract_path, '.github/contracts/spec014/sql/hostinger-storage-durable-authorized-injection-state.sql');
assert.equal(contract.schema_contract.ddl_contract_present, true);
assert.equal(contract.schema_contract.ddl_matches_registry_sql, true);
assert.equal(contract.schema_contract.contract_local_only, true);
assert.equal(contract.schema_contract.governed_runtime_migration_promoted, false);
assert.equal(contract.schema_contract.migration_apply_authorized, false);
assert.equal(contract.terminal_state.explicit_ddl_contract_present, true);
assert.equal(contract.secrets_included, false);

const occurrences = (text, pattern) => [...text.matchAll(pattern)].length;
assert.equal(occurrences(ddl, /CREATE TABLE IF NOT EXISTS storage_authorized_injection_states\s*\(/gu), 1);
assert.equal(occurrences(ddl, /CREATE TABLE IF NOT EXISTS storage_authorized_injection_rollbacks\s*\(/gu), 1);
assert.equal(occurrences(moduleText, /storage_authorized_injection_states/gu) >= 2, true);
assert.equal(occurrences(moduleText, /storage_authorized_injection_rollbacks/gu) >= 2, true);

for (const column of [
  'injection_id VARCHAR(191) NOT NULL',
  'injection_receipt_digest CHAR(64) NOT NULL',
  'mount_readback_digest CHAR(64) NOT NULL',
  'mount_bundle_digest CHAR(64) NOT NULL',
  'active TINYINT(1) NOT NULL DEFAULT 1',
  'generation BIGINT UNSIGNED NOT NULL DEFAULT 1',
  'record_digest CHAR(64) NOT NULL',
  'record_json JSON NOT NULL',
  'row_version BIGINT UNSIGNED NOT NULL DEFAULT 1',
  'secrets_included TINYINT(1) NOT NULL DEFAULT 0',
]) {
  assert.equal(ddl.includes(column), true, `missing state column contract: ${column}`);
}
for (const column of [
  'id CHAR(36) NOT NULL',
  'injection_id VARCHAR(191) NOT NULL',
  'rollback_receipt_digest CHAR(64) NOT NULL',
  'record_digest CHAR(64) NOT NULL',
  'record_json JSON NOT NULL',
  'secrets_included TINYINT(1) NOT NULL DEFAULT 0',
]) {
  assert.equal(ddl.includes(column), true, `missing rollback column contract: ${column}`);
}

assert.match(ddl, /PRIMARY KEY \(injection_id\)/u);
assert.match(ddl, /UNIQUE KEY uq_storage_authorized_injection_receipt \(injection_receipt_digest\)/u);
assert.match(ddl, /UNIQUE KEY uq_storage_authorized_injection_readback \(mount_readback_digest\)/u);
assert.match(ddl, /KEY idx_storage_authorized_injection_active_generation \(active, generation\)/u);
assert.match(ddl, /PRIMARY KEY \(id\)/u);
assert.match(ddl, /UNIQUE KEY uq_storage_authorized_injection_rollback_once \(injection_id\)/u);
assert.match(ddl, /UNIQUE KEY uq_storage_authorized_injection_rollback_digest \(rollback_receipt_digest\)/u);
assert.match(ddl, /FOREIGN KEY \(injection_id\)\s+REFERENCES storage_authorized_injection_states\(injection_id\)/u);
assert.match(ddl, /CHECK \(generation >= 1 AND row_version >= 1\)/u);
assert.match(ddl, /CHECK \(active IN \(0, 1\)\)/u);
assert.equal(occurrences(ddl, /CHECK \(secrets_included = 0\)/gu), 2);
assert.equal(occurrences(ddl, /REGEXP '\^\[0-9a-f\]\{64\}\$'/gu) >= 6, true);

for (const sqlMarker of [
  'spec014:durable-injection:load-state',
  'spec014:durable-injection:load-rollback',
  'spec014:durable-injection:insert-state',
  'spec014:durable-injection:update-rolled-back',
  'spec014:durable-injection:insert-rollback',
]) {
  assert.equal(moduleText.includes(sqlMarker), true, `missing canonical registry SQL marker: ${sqlMarker}`);
}
assert.match(moduleText, /WHERE injection_id=\? AND active=1 AND row_version=\?/u);
assert.match(moduleText, /active=0, generation=generation\+1[\s\S]*row_version=row_version\+1/u);

assert.match(ddl, /CONTRACT-LOCAL DDL ONLY/u);
assert.match(ddl, /not part of the promoted runtime migration sequence/u);
assert.match(ddl, /No UPDATE or DELETE path is authorized for storage_authorized_injection_rollbacks/u);
assert.match(ddl, /grants no migration Apply, provider dispatch, deployment, or Production authority/u);
assert.doesNotMatch(ddl, /\b(?:DROP|TRUNCATE)\s+TABLE\b/iu);
assert.doesNotMatch(ddl, /\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM)?\s*schema_migrations\b/iu);
assert.equal(ddlPath.includes(`${path.sep}migrations${path.sep}`), false);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_durable_authorized_injection_schema_ddl',
  schema_contract_digest: HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_SCHEMA_DIGEST,
  tables: expectedTables,
  ddl_contract_present: true,
  ddl_matches_registry_sql: true,
  state_row_version_cas_columns_present: true,
  immutable_rollback_uniqueness_present: true,
  rollback_foreign_key_present: true,
  digest_checks_present: true,
  secrets_constraints_present: true,
  contract_local_only: true,
  governed_runtime_migration_promoted: false,
  migration_apply_authorized: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  repository_mutation_performed: false,
  secrets_included: false,
}, null, 2));
