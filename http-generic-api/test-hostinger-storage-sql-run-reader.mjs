#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  HOSTINGER_STORAGE_SQL_RUN_READER_VERSION,
  createHostingerStorageSqlRunReader,
  isCanonicalHostingerStorageSqlRunReader,
} from './hostingerStorageSqlRunReader.js';

const h = (character) => character.repeat(64);

function schemaVerification(overrides = {}) {
  const base = {
    ready: true,
    schema_verified: true,
    blockers: [],
    production_ready: false,
    authority_granted: false,
    migration_apply_authorized: false,
    provider_dispatch_allowed: false,
    evidence_digest: h('a'),
    evidence: {
      source_commit: h('1'),
      deployed_runtime_sha: h('1'),
      runtime_parity: true,
      database_fingerprint: h('b'),
      readback_cycle_id: 'run-reader-cycle-1',
      expires_at: '2099-01-01T00:15:00.000Z',
    },
    secrets_included: false,
  };
  return {
    ...base,
    ...overrides,
    evidence: { ...base.evidence, ...(overrides.evidence || {}) },
  };
}

const runRow = {
  id: 'run-1',
  operation_id: 'operation-1',
  plan_id: 'plan-1',
  run_generation: 2,
  adapter_key: 'adapter-1',
  adapter_version: 'v1',
  worker_ref: 'worker-1',
  connector_ref: 'connector-1',
  dispatch_certification_ref: 'dispatch-1',
  host_key_evidence_ref: 'host-key-1',
  started_at_epoch: 100,
  finished_at_epoch: 200,
  state: 'completed',
  deleted_count: 2,
  deleted_bytes: '300',
  skipped_count: 1,
  missing_count: 0,
  failed_count: 0,
  journal_digest: h('c'),
  checkpoint_digest: h('d'),
  before_snapshot_id: 'snapshot-before',
  after_snapshot_id: 'snapshot-after',
  provider_response_classification: 'synthetic_not_dispatched',
  unknown_outcome: 0,
  readback_status: 'complete',
  result_digest: h('e'),
};

class FakePool {
  constructor(rows = [runRow]) {
    this.rows = rows;
    this.connections = 0;
    this.releases = 0;
    this.error = null;
  }

  async getConnection() {
    this.connections += 1;
    const pool = this;
    return {
      async execute(sql, params) {
        assert.match(sql, /spec014:run-reader:read/u);
        assert.deepEqual(params, ['run-1']);
        if (pool.error) throw pool.error;
        return [structuredClone(pool.rows), []];
      },
      release() { pool.releases += 1; },
    };
  }
}

const pool = new FakePool();
const reader = createHostingerStorageSqlRunReader({ pool, schema_verification: schemaVerification() });
assert.equal(pool.connections, 0, 'factory creation must not access the database');
assert.equal(reader.reader_version, HOSTINGER_STORAGE_SQL_RUN_READER_VERSION);
assert.equal(isCanonicalHostingerStorageSqlRunReader(reader), true);
assert.equal('pool' in reader, false);

const found = await reader.readRun({ run_id: 'run-1', secrets_included: false });
assert.equal(found.found, true);
assert.equal(found.run.run_id, 'run-1');
assert.equal(found.run.deleted_count, 2);
assert.equal(found.run.deleted_bytes, '300');
assert.equal(found.run.worker_ref, 'worker-1');
assert.equal(found.run.result_digest, h('e'));
assert.match(found.run_digest, /^[0-9a-f]{64}$/u);
assert.equal(found.provider_dispatch_allowed, false);
assert.equal(pool.connections, 1);
assert.equal(pool.releases, 1);

const missingPool = new FakePool([]);
const missingReader = createHostingerStorageSqlRunReader({ pool: missingPool, schema_verification: schemaVerification() });
const missing = await missingReader.readRun({ run_id: 'run-1' });
assert.equal(missing.found, false);
assert.equal(missing.run, null);
assert.equal(missing.run_digest, null);

const ambiguousPool = new FakePool([runRow, runRow]);
const ambiguousReader = createHostingerStorageSqlRunReader({ pool: ambiguousPool, schema_verification: schemaVerification() });
await assert.rejects(
  ambiguousReader.readRun({ run_id: 'run-1' }),
  (error) => error.code === 'STORAGE_SQL_RUN_READER_ROW_AMBIGUOUS',
);
assert.equal(ambiguousPool.releases, 1);

const unavailablePool = new FakePool();
unavailablePool.error = Object.assign(new Error('missing table'), { code: 'ER_NO_SUCH_TABLE' });
const unavailableReader = createHostingerStorageSqlRunReader({ pool: unavailablePool, schema_verification: schemaVerification() });
await assert.rejects(
  unavailableReader.readRun({ run_id: 'run-1' }),
  (error) => error.code === 'STORAGE_SQL_RUN_READER_SCHEMA_UNAVAILABLE',
);

assert.throws(
  () => createHostingerStorageSqlRunReader({
    pool: new FakePool(),
    schema_verification: schemaVerification({ evidence: { deployed_runtime_sha: h('2') } }),
  }),
  (error) => error.code === 'STORAGE_SQL_RUN_READER_RUNTIME_PARITY_REQUIRED',
);
assert.throws(
  () => createHostingerStorageSqlRunReader({
    pool: new FakePool(),
    schema_verification: { ...schemaVerification(), private_key: 'forbidden' },
  }),
  (error) => error.code === 'STORAGE_SQL_RUN_READER_SECRET_OR_UNSAFE_FIELD_REJECTED',
);
await assert.rejects(
  reader.readRun({ run_id: 'run-1', api_key: 'forbidden' }),
  (error) => error.code === 'STORAGE_SQL_RUN_READER_SECRET_OR_UNSAFE_FIELD_REJECTED',
);

console.log(JSON.stringify({
  ok: true,
  contract: 'hostinger_storage_sql_run_reader_v1',
  found: true,
  cardinality_guarded: true,
  factory_database_connections: 0,
  runtime_mounted: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  secrets_included: false,
}));
