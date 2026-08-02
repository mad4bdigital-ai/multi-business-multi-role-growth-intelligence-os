#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  HOSTINGER_STORAGE_DURABLE_TENANT_AUTHORITY_SCHEMA_CONTRACT,
  HOSTINGER_STORAGE_DURABLE_TENANT_AUTHORITY_SCHEMA_DIGEST,
  createHostingerStorageDurableTenantAuthorityStore,
} from './hostingerStorageDurableTenantAuthorityStore.js';

const h = (character) => character.repeat(64);
const runtimeSha = 'a'.repeat(40);

const schemaVerification = {
  ready: true,
  schema_verified: true,
  production_ready: false,
  authority_granted: false,
  migration_apply_authorized: false,
  provider_dispatch_allowed: false,
  evidence_digest: h('e'),
  blockers: [],
  evidence: {
    source_commit: runtimeSha,
    deployed_runtime_sha: runtimeSha,
    runtime_parity: true,
    database_fingerprint: h('f'),
    readback_cycle_id: 'authority-row-ambiguity-test-cycle',
    expires_at: '2099-08-02T00:15:00.000Z',
    authority_store_schema: {
      contract_key: HOSTINGER_STORAGE_DURABLE_TENANT_AUTHORITY_SCHEMA_CONTRACT.contract_key,
      contract_digest: HOSTINGER_STORAGE_DURABLE_TENANT_AUTHORITY_SCHEMA_DIGEST,
      tables: [...HOSTINGER_STORAGE_DURABLE_TENANT_AUTHORITY_SCHEMA_CONTRACT.tables],
      secrets_included: false,
    },
    secrets_included: false,
  },
  secrets_included: false,
};

class AmbiguousAuthorityConnection {
  constructor() {
    this.releaseCount = 0;
  }

  async execute(sql) {
    if (sql.includes('spec014:authority:load-allowlist')) {
      return [[
        { record_json: '{}', row_version: 1 },
        { record_json: '{}', row_version: 2 },
      ], []];
    }
    if (sql.includes('spec014:authority:load-approval')) {
      return [[
        { record_json: '{}', row_version: 1 },
        { record_json: '{}', row_version: 2 },
      ], []];
    }
    throw new Error(`Unexpected SQL in ambiguity regression: ${sql}`);
  }

  release() {
    this.releaseCount += 1;
  }
}

const connections = [];
const pool = {
  async getConnection() {
    const connection = new AmbiguousAuthorityConnection();
    connections.push(connection);
    return connection;
  },
};

const store = createHostingerStorageDurableTenantAuthorityStore({
  pool,
  schema_verification: schemaVerification,
});

await assert.rejects(
  store.readAllowlist('allowlist-ambiguous'),
  (error) => error.code === 'STORAGE_DURABLE_AUTHORITY_ROW_AMBIGUOUS'
    && error.status === 409
    && error.details?.authority_type === 'allowlist'
    && error.details?.authority_id === 'allowlist-ambiguous',
  'multiple allowlist rows must fail closed instead of selecting the first candidate',
);

await assert.rejects(
  store.readApproval('approval-ambiguous'),
  (error) => error.code === 'STORAGE_DURABLE_AUTHORITY_ROW_AMBIGUOUS'
    && error.status === 409
    && error.details?.authority_type === 'approval'
    && error.details?.authority_id === 'approval-ambiguous',
  'multiple approval rows must fail closed instead of selecting the first candidate',
);

assert.equal(connections.length, 2);
assert.equal(connections.every((connection) => connection.releaseCount === 1), true);

console.log('Hostinger durable Tenant authority row ambiguity regression tests passed');
