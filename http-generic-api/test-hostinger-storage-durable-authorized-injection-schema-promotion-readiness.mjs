#!/usr/bin/env node
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HOSTINGER_STORAGE_DURABLE_INJECTION_SCHEMA_DDL_BLOB_SHA,
  HOSTINGER_STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_BASE_SHA,
  buildHostingerStorageDurableAuthorizedInjectionSchemaPromotionReadiness,
} from './hostingerStorageDurableAuthorizedInjectionSchemaPromotionReadiness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ddlPath = path.join(
  __dirname,
  '..',
  '.github',
  'contracts',
  'spec014',
  'sql',
  'hostinger-storage-durable-authorized-injection-state.sql',
);
const stateContractPath = path.join(
  __dirname,
  '..',
  '.github',
  'contracts',
  'spec014',
  'hostinger-storage-durable-authorized-injection-state.json',
);

const [canonicalDdl, canonicalContractRaw] = await Promise.all([
  fs.readFile(ddlPath, 'utf8'),
  fs.readFile(stateContractPath, 'utf8'),
]);
const canonicalContract = JSON.parse(canonicalContractRaw);

const packet = await buildHostingerStorageDurableAuthorizedInjectionSchemaPromotionReadiness();
assert.equal(packet.contract, 'spec014.hostinger-storage-durable-authorized-injection-schema-promotion-readiness.v1');
assert.equal(packet.source_commit, HOSTINGER_STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_BASE_SHA);
assert.equal(packet.ddl_blob_sha, HOSTINGER_STORAGE_DURABLE_INJECTION_SCHEMA_DDL_BLOB_SHA);
assert.match(packet.ddl_sha256, /^[0-9a-f]{64}$/u);
assert.match(packet.state_contract_sha256, /^[0-9a-f]{64}$/u);
assert.equal(packet.statement_count, 2);
assert.deepEqual(packet.tables, [
  'storage_authorized_injection_states',
  'storage_authorized_injection_rollbacks',
]);
assert.equal(packet.state_before_rollback, true);
assert.equal(packet.foreign_key_order_verified, true);
assert.equal(packet.additive_create_table_only, true);
assert.equal(packet.contract_local_ddl_verified, true);
assert.equal(packet.ready_for_migration_candidate, true);
assert.equal(packet.ready_for_runtime_sequence_promotion, false);
assert.equal(packet.ready_for_authorization, false);
assert.equal(packet.ready_for_apply, false);
assert.equal(packet.migration_candidate_created, false);
assert.equal(packet.governed_runtime_migration_promoted, false);
assert.equal(packet.capability_envelope_resolved, false);
assert.equal(packet.authorization_created, false);
assert.equal(packet.dry_run_performed, false);
assert.equal(packet.migration_sql_executed, false);
assert.equal(packet.live_database_access_performed, false);
assert.equal(packet.live_schema_readback_performed, false);
assert.equal(packet.signed_schema_verification_created, false);
assert.equal(packet.provider_dispatch_allowed, false);
assert.equal(packet.worker_mounted, false);
assert.equal(packet.deployment_authorized, false);
assert.equal(packet.production_ready, false);
assert.equal(packet.automatic_retry_allowed, false);
assert.equal(packet.secrets_included, false);
assert.equal(Object.isFrozen(packet), true);
assert.equal(Object.isFrozen(packet.blockers), true);
assert.deepEqual(packet.blockers, [
  'SEPARATELY_REVIEWED_MIGRATION_CANDIDATE_REQUIRED',
  'RUNTIME_MIGRATION_SEQUENCE_PROMOTION_REQUIRED',
  'FRESH_CAPABILITY_ENVELOPE_REQUIRED',
  'CHECKSUM_BOUND_AUTHORIZATION_REGISTRY_WRITE_REQUIRED',
  'SAME_CYCLE_DRY_RUN_REQUIRED',
  'LIVE_SCHEMA_ABSENCE_OR_COMPATIBILITY_READBACK_REQUIRED',
  'SIGNED_POST_APPLY_SCHEMA_VERIFICATION_REQUIRED',
]);

function fixture({ ddl = canonicalDdl, contract = canonicalContract } = {}) {
  let reads = 0;
  return {
    reads: () => reads,
    deps: {
      readFile: async (requestedPath) => {
        reads += 1;
        const normalized = String(requestedPath).replaceAll('\\', '/');
        if (normalized.endsWith('hostinger-storage-durable-authorized-injection-state.sql')) {
          return ddl;
        }
        if (normalized.endsWith('hostinger-storage-durable-authorized-injection-state.json')) {
          return JSON.stringify(contract, null, 2);
        }
        throw new Error(`Unexpected readiness path: ${requestedPath}`);
      },
    },
  };
}

const exactFixture = fixture();
const exactPacket = await buildHostingerStorageDurableAuthorizedInjectionSchemaPromotionReadiness(
  {},
  exactFixture.deps,
);
assert.equal(exactFixture.reads(), 2);
assert.equal(exactPacket.ddl_sha256, packet.ddl_sha256);
assert.equal(exactPacket.state_contract_sha256.length, 64);

await assert.rejects(
  buildHostingerStorageDurableAuthorizedInjectionSchemaPromotionReadiness({
    source_commit: '1'.repeat(40),
  }),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_SOURCE_MISMATCH',
);
await assert.rejects(
  buildHostingerStorageDurableAuthorizedInjectionSchemaPromotionReadiness({
    ddl_blob_sha: '2'.repeat(40),
  }),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_DDL_BLOB_MISMATCH',
);
await assert.rejects(
  buildHostingerStorageDurableAuthorizedInjectionSchemaPromotionReadiness({
    api_key: 'forbidden',
  }),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_FIELD_FORBIDDEN',
);

const unsafeFixture = fixture({
  ddl: `${canonicalDdl}\nDROP TABLE storage_authorized_injection_states;\n`,
});
await assert.rejects(
  buildHostingerStorageDurableAuthorizedInjectionSchemaPromotionReadiness({}, unsafeFixture.deps),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_STATEMENT_COUNT_INVALID'
    || error.code === 'STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_UNSAFE_SQL_REJECTED',
);

const wrongOrderFixture = fixture({
  ddl: canonicalDdl.replace(
    'CREATE TABLE IF NOT EXISTS storage_authorized_injection_states',
    'CREATE TABLE IF NOT EXISTS storage_authorized_injection_states_wrong',
  ),
});
await assert.rejects(
  buildHostingerStorageDurableAuthorizedInjectionSchemaPromotionReadiness({}, wrongOrderFixture.deps),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_TABLE_ORDER_INVALID',
);

const missingForeignKeyFixture = fixture({
  ddl: canonicalDdl.replace(
    'REFERENCES storage_authorized_injection_states(injection_id)',
    'REFERENCES storage_authorized_injection_states_missing(injection_id)',
  ),
});
await assert.rejects(
  buildHostingerStorageDurableAuthorizedInjectionSchemaPromotionReadiness({}, missingForeignKeyFixture.deps),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_DDL_CONTRACT_MISMATCH'
    && error.details.field === 'rollback.state_foreign_key',
);

const promotedContractFixture = fixture({
  contract: {
    ...canonicalContract,
    schema_contract: {
      ...canonicalContract.schema_contract,
      governed_runtime_migration_promoted: true,
    },
  },
});
await assert.rejects(
  buildHostingerStorageDurableAuthorizedInjectionSchemaPromotionReadiness({}, promotedContractFixture.deps),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_STATE_CONTRACT_INVALID',
);

const authorizedContractFixture = fixture({
  contract: {
    ...canonicalContract,
    schema_contract: {
      ...canonicalContract.schema_contract,
      migration_apply_authorized: true,
    },
  },
});
await assert.rejects(
  buildHostingerStorageDurableAuthorizedInjectionSchemaPromotionReadiness({}, authorizedContractFixture.deps),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_SCHEMA_PROMOTION_STATE_CONTRACT_INVALID',
);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_durable_authorized_injection_schema_promotion_readiness',
  source_commit: packet.source_commit,
  ddl_blob_sha: packet.ddl_blob_sha,
  ddl_sha256: packet.ddl_sha256,
  statement_count: packet.statement_count,
  table_count: packet.tables.length,
  contract_local_ddl_verified: true,
  ready_for_migration_candidate: true,
  ready_for_runtime_sequence_promotion: false,
  ready_for_authorization: false,
  ready_for_apply: false,
  live_database_access_performed: false,
  migration_sql_executed: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  secrets_included: false,
}, null, 2));
