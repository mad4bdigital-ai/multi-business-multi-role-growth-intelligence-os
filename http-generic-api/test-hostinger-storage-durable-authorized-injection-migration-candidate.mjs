#!/usr/bin/env node
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE,
  HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_CHECKSUM,
  HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_SOURCE_SHA,
  HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_DEPENDENCY,
  HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_DEPENDENCY_CHECKSUM,
  buildHostingerStorageDurableAuthorizedInjectionMigrationCandidate,
} from './hostingerStorageDurableAuthorizedInjectionMigrationCandidate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const candidatePath = path.join(
  __dirname,
  'migrations',
  HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE,
);
const contractDdlPath = path.join(
  __dirname,
  '..',
  '.github',
  'contracts',
  'spec014',
  'sql',
  'hostinger-storage-durable-authorized-injection-state.sql',
);
const runtimeContractPath = path.join(
  __dirname,
  '..',
  '.github',
  'contracts',
  'spec014',
  'hostinger-storage-runtime-migrations.json',
);
const dependencyRegistryPath = path.join(
  __dirname,
  'config',
  'governed-migration-dependencies.json',
);

const [candidateSql, contractSql, runtimeRaw, dependencyRaw] = await Promise.all([
  fs.readFile(candidatePath, 'utf8'),
  fs.readFile(contractDdlPath, 'utf8'),
  fs.readFile(runtimeContractPath, 'utf8'),
  fs.readFile(dependencyRegistryPath, 'utf8'),
]);
const runtimeContract = JSON.parse(runtimeRaw);
const dependencyRegistry = JSON.parse(dependencyRaw);

const packet = await buildHostingerStorageDurableAuthorizedInjectionMigrationCandidate();
assert.equal(
  packet.contract,
  'spec014.hostinger-storage-durable-authorized-injection-migration-candidate.v1',
);
assert.equal(packet.source_commit, HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_SOURCE_SHA);
assert.equal(packet.migration, HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE);
assert.equal(packet.checksum_sha256, HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_CHECKSUM);
assert.equal(packet.statement_count, 2);
assert.deepEqual(packet.tables, [
  'storage_authorized_injection_states',
  'storage_authorized_injection_rollbacks',
]);
assert.equal(packet.dependency, HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_DEPENDENCY);
assert.equal(
  packet.dependency_checksum_sha256,
  HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_DEPENDENCY_CHECKSUM,
);
assert.equal(packet.required_ledger_mode, 'apply');
assert.equal(packet.exact_contract_local_statement_parity, true);
assert.equal(packet.additive_create_table_only, true);
assert.equal(packet.candidate_created, true);
assert.equal(packet.candidate_inspection_passed, true);
assert.equal(packet.runtime_sequence_promoted, false);
assert.equal(packet.dependency_registry_updated, false);
assert.equal(packet.ready_for_promotion_review, true);
assert.equal(packet.ready_for_authorization, false);
assert.equal(packet.ready_for_apply, false);
assert.equal(packet.authorization_created, false);
assert.equal(packet.dry_run_performed, false);
assert.equal(packet.migration_sql_executed, false);
assert.equal(packet.live_database_access_performed, false);
assert.equal(packet.live_schema_readback_performed, false);
assert.equal(packet.provider_dispatch_allowed, false);
assert.equal(packet.worker_mounted, false);
assert.equal(packet.deployment_authorized, false);
assert.equal(packet.production_ready, false);
assert.equal(packet.automatic_retry_allowed, false);
assert.equal(packet.secrets_included, false);
assert.equal(Object.isFrozen(packet), true);
assert.equal(Object.isFrozen(packet.blockers), true);
assert.deepEqual(packet.blockers, [
  'SEPARATELY_REVIEWED_RUNTIME_SEQUENCE_PROMOTION_REQUIRED',
  'DEPENDENCY_REGISTRY_UPDATE_REQUIRED',
  'WAVE_3_APPLY_LEDGER_REQUIRED',
  'FRESH_CAPABILITY_ENVELOPE_REQUIRED',
  'CHECKSUM_BOUND_AUTHORIZATION_REGISTRY_WRITE_REQUIRED',
  'SAME_CYCLE_DRY_RUN_REQUIRED',
  'LIVE_SCHEMA_ABSENCE_OR_COMPATIBILITY_READBACK_REQUIRED',
  'SIGNED_POST_APPLY_SCHEMA_VERIFICATION_REQUIRED',
]);
assert.equal(
  runtimeContract.waves.some((wave) => wave.migration === packet.migration),
  false,
);
assert.equal(Object.hasOwn(dependencyRegistry.migrations, packet.migration), false);

function fixture({
  candidate = candidateSql,
  contract = contractSql,
  runtime = runtimeContract,
  dependencies = dependencyRegistry,
} = {}) {
  let reads = 0;
  return {
    reads: () => reads,
    deps: {
      readFile: async (requestedPath) => {
        reads += 1;
        const normalized = String(requestedPath).replaceAll('\\', '/');
        if (normalized.endsWith(HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE)) {
          return candidate;
        }
        if (normalized.endsWith('hostinger-storage-durable-authorized-injection-state.sql')) {
          return contract;
        }
        if (normalized.endsWith('hostinger-storage-runtime-migrations.json')) {
          return JSON.stringify(runtime, null, 2);
        }
        if (normalized.endsWith('governed-migration-dependencies.json')) {
          return JSON.stringify(dependencies, null, 2);
        }
        throw new Error(`Unexpected candidate path: ${requestedPath}`);
      },
    },
  };
}

const exactFixture = fixture();
const exactPacket = await buildHostingerStorageDurableAuthorizedInjectionMigrationCandidate(
  {},
  exactFixture.deps,
);
assert.equal(exactFixture.reads(), 4);
assert.equal(exactPacket.checksum_sha256, HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_CHECKSUM);

await assert.rejects(
  buildHostingerStorageDurableAuthorizedInjectionMigrationCandidate({
    source_commit: '1'.repeat(40),
  }),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_SOURCE_MISMATCH',
);
await assert.rejects(
  buildHostingerStorageDurableAuthorizedInjectionMigrationCandidate({ api_key: 'forbidden' }),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_FIELD_FORBIDDEN',
);

const checksumDrift = fixture({
  candidate: candidateSql.replace('row_version BIGINT', 'row_version  BIGINT'),
});
await assert.rejects(
  buildHostingerStorageDurableAuthorizedInjectionMigrationCandidate({}, checksumDrift.deps),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_CHECKSUM_MISMATCH',
);

const sourceParityDrift = fixture({
  candidate: candidateSql,
  contract: contractSql.replace('row_version BIGINT', 'row_version  BIGINT'),
});
await assert.rejects(
  buildHostingerStorageDurableAuthorizedInjectionMigrationCandidate({}, sourceParityDrift.deps),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_SOURCE_PARITY_MISMATCH',
);

const promotedRuntime = structuredClone(runtimeContract);
promotedRuntime.waves.push({
  wave: 4,
  migration: HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE,
  checksum_sha256: HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_CHECKSUM,
  statement_count: 2,
  dependency: HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_DEPENDENCY,
});
await assert.rejects(
  buildHostingerStorageDurableAuthorizedInjectionMigrationCandidate(
    {},
    fixture({ runtime: promotedRuntime }).deps,
  ),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_ALREADY_PROMOTED',
);

const registeredDependencies = structuredClone(dependencyRegistry);
registeredDependencies.migrations[HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE] = {
  checksum_sha256: HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_CHECKSUM,
  statement_count: 2,
  dependencies: [],
};
await assert.rejects(
  buildHostingerStorageDurableAuthorizedInjectionMigrationCandidate(
    {},
    fixture({ dependencies: registeredDependencies }).deps,
  ),
  (error) => error.code
    === 'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_DEPENDENCY_ALREADY_REGISTERED',
);

const dependencyDrift = structuredClone(runtimeContract);
const wave3 = dependencyDrift.waves.find(
  (wave) => wave.migration === HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_DEPENDENCY,
);
wave3.checksum_sha256 = 'f'.repeat(64);
await assert.rejects(
  buildHostingerStorageDurableAuthorizedInjectionMigrationCandidate(
    {},
    fixture({ runtime: dependencyDrift }).deps,
  ),
  (error) => error.code
    === 'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_DEPENDENCY_CONTRACT_MISMATCH',
);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_durable_authorized_injection_migration_candidate',
  migration: packet.migration,
  checksum_sha256: packet.checksum_sha256,
  statement_count: packet.statement_count,
  dependency: packet.dependency,
  dependency_checksum_sha256: packet.dependency_checksum_sha256,
  candidate_created: true,
  runtime_sequence_promoted: false,
  dependency_registry_updated: false,
  ready_for_promotion_review: true,
  ready_for_authorization: false,
  ready_for_apply: false,
  migration_sql_executed: false,
  live_database_access_performed: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  secrets_included: false,
}, null, 2));
