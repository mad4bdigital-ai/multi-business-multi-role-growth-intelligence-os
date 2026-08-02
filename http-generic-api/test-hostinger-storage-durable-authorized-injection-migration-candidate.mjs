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
const candidateContractPath = path.join(
  __dirname,
  '..',
  '.github',
  'contracts',
  'spec014',
  'hostinger-storage-durable-authorized-injection-migration-candidate.json',
);
const promotionContractPath = path.join(
  __dirname,
  '..',
  '.github',
  'contracts',
  'spec014',
  'hostinger-storage-durable-authorized-injection-runtime-sequence-promotion.json',
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

const [
  candidateSql,
  contractSql,
  candidateContractRaw,
  promotionContractRaw,
  runtimeRaw,
  dependencyRaw,
] = await Promise.all([
  fs.readFile(candidatePath, 'utf8'),
  fs.readFile(contractDdlPath, 'utf8'),
  fs.readFile(candidateContractPath, 'utf8'),
  fs.readFile(promotionContractPath, 'utf8'),
  fs.readFile(runtimeContractPath, 'utf8'),
  fs.readFile(dependencyRegistryPath, 'utf8'),
]);
const candidateContract = JSON.parse(candidateContractRaw);
const promotionContract = JSON.parse(promotionContractRaw);
const runtimeContract = JSON.parse(runtimeRaw);
const dependencyRegistry = JSON.parse(dependencyRaw);

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

const unpromotedRuntime = structuredClone(runtimeContract);
unpromotedRuntime.waves = unpromotedRuntime.waves.filter(
  (wave) => wave.migration !== HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE,
);
const unpromotedDependencies = structuredClone(dependencyRegistry);
delete unpromotedDependencies.migrations[
  HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE
];

const historicalFixture = fixture({
  runtime: unpromotedRuntime,
  dependencies: unpromotedDependencies,
});
const packet = await buildHostingerStorageDurableAuthorizedInjectionMigrationCandidate(
  {},
  historicalFixture.deps,
);
assert.equal(historicalFixture.reads(), 4);
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
  candidateContract.contract_key,
  'spec014_hostinger_storage_durable_authorized_injection_migration_candidate',
);
assert.equal(candidateContract.candidate.migration, packet.migration);
assert.equal(candidateContract.candidate.checksum_sha256, packet.checksum_sha256);
assert.equal(candidateContract.candidate.statement_count, packet.statement_count);
assert.deepEqual(candidateContract.candidate.tables, packet.tables);
assert.equal(candidateContract.candidate.candidate_created, true);
assert.equal(candidateContract.candidate.candidate_inspection_passed, true);
assert.equal(candidateContract.promotion_boundary.runtime_sequence_promoted, false);
assert.equal(candidateContract.promotion_boundary.dependency_registry_updated, false);
assert.equal(candidateContract.promotion_boundary.ready_for_promotion_review, true);
assert.equal(candidateContract.promotion_boundary.ready_for_authorization, false);
assert.equal(candidateContract.promotion_boundary.ready_for_apply, false);
assert.equal(candidateContract.secrets_included, false);

assert.equal(runtimeContract.contract, 'spec014.hostinger-storage-runtime-migrations.v1');
assert.equal(runtimeContract.status, 'governed_sequence_registered_apply_blocked');
assert.equal(runtimeContract.migration_apply_authorized, false);
assert.equal(runtimeContract.live_database_access_performed, false);
assert.equal(runtimeContract.schema_verified, false);
assert.equal(runtimeContract.production_ready, false);
assert.equal(runtimeContract.secrets_included, false);
assert.equal(runtimeContract.waves.length, 4);
const promotedWaves = runtimeContract.waves.filter(
  (wave) => wave.migration === HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE,
);
assert.equal(promotedWaves.length, 1);
const promotedWave = promotedWaves[0];
assert.equal(promotedWave.wave, 4);
assert.equal(promotedWave.checksum_sha256, HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_CHECKSUM);
assert.equal(promotedWave.statement_count, 2);
assert.equal(promotedWave.dependency, HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_DEPENDENCY);
assert.equal(promotedWave.preflight_status, 'pass');
assert.equal(promotedWave.preflight_risk_count, 0);
assert.deepEqual(promotedWave.preflight_risk_codes, []);

assert.equal(dependencyRegistry.schema_version, 'governed_migration_dependencies.v1');
const promotedDependency = dependencyRegistry.migrations[
  HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE
];
assert.ok(promotedDependency);
assert.equal(
  promotedDependency.checksum_sha256,
  HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_CHECKSUM,
);
assert.equal(promotedDependency.statement_count, 2);
assert.equal(promotedDependency.dependencies.length, 1);
assert.deepEqual(promotedDependency.dependencies[0], {
  migration: HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_DEPENDENCY,
  checksum_sha256: HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_DEPENDENCY_CHECKSUM,
  statement_count: 9,
  required_ledger_mode: 'apply',
});

assert.equal(
  promotionContract.contract,
  'spec014.hostinger-storage-durable-authorized-injection-runtime-sequence-promotion.v1',
);
assert.equal(promotionContract.candidate_source.pull_request, 4879);
assert.equal(
  promotionContract.candidate_source.candidate_head_sha,
  '25f937c5ee0ff68a65da245c8af607e66eafa737',
);
assert.equal(
  promotionContract.candidate_source.integration_merge_sha,
  '4ca8d8691baa66210b679da51c5d92909c88c14c',
);
assert.equal(promotionContract.candidate_source.migration, packet.migration);
assert.equal(promotionContract.candidate_source.checksum_sha256, packet.checksum_sha256);
assert.equal(promotionContract.candidate_source.statement_count, packet.statement_count);
assert.equal(promotionContract.promotion.wave, 4);
assert.equal(promotionContract.promotion.runtime_sequence_promoted, true);
assert.equal(promotionContract.promotion.dependency_registry_updated, true);
assert.equal(promotionContract.promotion.dependency, packet.dependency);
assert.equal(
  promotionContract.promotion.dependency_checksum_sha256,
  packet.dependency_checksum_sha256,
);
assert.equal(promotionContract.promotion.dependency_statement_count, 9);
assert.equal(promotionContract.promotion.required_ledger_mode, 'apply');
assert.equal(promotionContract.promotion.preflight_status, 'pass');
assert.equal(promotionContract.promotion.preflight_risk_count, 0);
assert.deepEqual(promotionContract.promotion.preflight_risk_codes, []);
assert.equal(promotionContract.terminal_boundary.ready_for_repository_authorization_inspection, true);
assert.equal(promotionContract.terminal_boundary.ready_for_authorization, false);
assert.equal(promotionContract.terminal_boundary.ready_for_apply, false);
assert.equal(promotionContract.terminal_boundary.authorization_created, false);
assert.equal(promotionContract.terminal_boundary.authorization_registry_mutated, false);
assert.equal(promotionContract.terminal_boundary.capability_envelope_resolved, false);
assert.equal(promotionContract.terminal_boundary.dry_run_performed, false);
assert.equal(promotionContract.terminal_boundary.migration_sql_executed, false);
assert.equal(promotionContract.terminal_boundary.live_database_access_performed, false);
assert.equal(promotionContract.terminal_boundary.live_schema_readback_performed, false);
assert.equal(promotionContract.terminal_boundary.schema_verified, false);
assert.equal(promotionContract.terminal_boundary.provider_dispatch_allowed, false);
assert.equal(promotionContract.terminal_boundary.worker_mounted, false);
assert.equal(promotionContract.terminal_boundary.deployment_authorized, false);
assert.equal(promotionContract.terminal_boundary.production_ready, false);
assert.equal(promotionContract.terminal_boundary.automatic_retry_allowed, false);
assert.equal(promotionContract.terminal_boundary.secrets_included, false);
assert.deepEqual(promotionContract.blockers, [
  'WAVE_3_APPLY_LEDGER_REQUIRED',
  'FRESH_CAPABILITY_ENVELOPE_REQUIRED',
  'CHECKSUM_BOUND_AUTHORIZATION_REGISTRY_WRITE_REQUIRED',
  'SAME_CYCLE_DRY_RUN_REQUIRED',
  'LIVE_TABLE_ABSENCE_OR_EXACT_COMPATIBILITY_READBACK_REQUIRED',
  'SIGNED_SCHEMA_VERIFICATION_CONTRACT_REFRESH_REQUIRED',
  'SIGNED_POST_APPLY_SCHEMA_VERIFICATION_REQUIRED',
]);
assert.equal(promotionContract.secrets_included, false);

const exactFixture = fixture({
  runtime: unpromotedRuntime,
  dependencies: unpromotedDependencies,
});
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
  runtime: unpromotedRuntime,
  dependencies: unpromotedDependencies,
});
await assert.rejects(
  buildHostingerStorageDurableAuthorizedInjectionMigrationCandidate({}, checksumDrift.deps),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_CHECKSUM_MISMATCH',
);

const sourceParityDrift = fixture({
  candidate: candidateSql,
  contract: contractSql.replace('row_version BIGINT', 'row_version  BIGINT'),
  runtime: unpromotedRuntime,
  dependencies: unpromotedDependencies,
});
await assert.rejects(
  buildHostingerStorageDurableAuthorizedInjectionMigrationCandidate({}, sourceParityDrift.deps),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_SOURCE_PARITY_MISMATCH',
);

const promotedRuntime = structuredClone(unpromotedRuntime);
promotedRuntime.waves.push(structuredClone(promotedWave));
await assert.rejects(
  buildHostingerStorageDurableAuthorizedInjectionMigrationCandidate(
    {},
    fixture({ runtime: promotedRuntime, dependencies: unpromotedDependencies }).deps,
  ),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_ALREADY_PROMOTED',
);

const registeredDependencies = structuredClone(unpromotedDependencies);
registeredDependencies.migrations[HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE] =
  structuredClone(promotedDependency);
await assert.rejects(
  buildHostingerStorageDurableAuthorizedInjectionMigrationCandidate(
    {},
    fixture({ runtime: unpromotedRuntime, dependencies: registeredDependencies }).deps,
  ),
  (error) => error.code
    === 'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_DEPENDENCY_ALREADY_REGISTERED',
);

const dependencyDrift = structuredClone(unpromotedRuntime);
const wave3 = dependencyDrift.waves.find(
  (wave) => wave.migration === HOSTINGER_STORAGE_DURABLE_INJECTION_MIGRATION_DEPENDENCY,
);
wave3.checksum_sha256 = 'f'.repeat(64);
await assert.rejects(
  buildHostingerStorageDurableAuthorizedInjectionMigrationCandidate(
    {},
    fixture({ runtime: dependencyDrift, dependencies: unpromotedDependencies }).deps,
  ),
  (error) => error.code
    === 'STORAGE_DURABLE_INJECTION_MIGRATION_CANDIDATE_DEPENDENCY_CONTRACT_MISMATCH',
);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_durable_authorized_injection_migration_candidate_lifecycle',
  migration: packet.migration,
  checksum_sha256: packet.checksum_sha256,
  statement_count: packet.statement_count,
  dependency: packet.dependency,
  dependency_checksum_sha256: packet.dependency_checksum_sha256,
  historical_candidate_snapshot_verified: true,
  candidate_created: true,
  candidate_inspection_passed: true,
  runtime_sequence_promoted: true,
  dependency_registry_updated: true,
  promotion_contract_verified: true,
  ready_for_repository_authorization_inspection: true,
  ready_for_authorization: false,
  ready_for_apply: false,
  authorization_created: false,
  dry_run_performed: false,
  migration_sql_executed: false,
  live_database_access_performed: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  secrets_included: false,
}, null, 2));
