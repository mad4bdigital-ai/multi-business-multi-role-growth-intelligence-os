#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  HOSTINGER_STORAGE_DURABLE_TENANT_ENABLEMENT_SCHEMA_CONTRACT,
  HOSTINGER_STORAGE_DURABLE_TENANT_ENABLEMENT_SCHEMA_DIGEST,
  createHostingerStorageDurableTenantEnablementRegistry,
  isCanonicalHostingerStorageDurableTenantEnablementRegistry,
} from './hostingerStorageDurableTenantEnablementRegistry.js';

const h = (character) => character.repeat(64);
const clone = (value) => structuredClone(value);

class FakeEnablementDatabase {
  constructor() {
    this.tables = {
      records: new Map(),
      consumptions: new Map(),
    };
    this.connections = 0;
    this.commits = 0;
    this.rollbacks = 0;
    this.lockAcquisitions = 0;
    this.lockReleases = 0;
    this.forceNextCasMiss = false;
  }
}

class FakeEnablementConnection {
  constructor(database) {
    this.database = database;
    this.working = null;
  }

  async beginTransaction() {
    this.working = clone(this.database.tables);
  }

  async commit() {
    this.database.tables = this.working;
    this.working = null;
    this.database.commits += 1;
  }

  async rollback() {
    this.working = null;
    this.database.rollbacks += 1;
  }

  release() {}

  table(name) {
    return (this.working || this.database.tables)[name];
  }

  async execute(sql, params = []) {
    if (sql.includes('spec014:enablement:lock:acquire')) {
      this.database.lockAcquisitions += 1;
      return [[{ acquired: 1 }], []];
    }
    if (sql.includes('spec014:enablement:lock:release')) {
      this.database.lockReleases += 1;
      return [[{ released: 1 }], []];
    }
    if (sql.includes('spec014:enablement:load-record')) {
      const row = this.table('records').get(params[0]);
      return [row ? [clone(row)] : [], []];
    }
    if (sql.includes('spec014:enablement:load-consumption')) {
      const row = this.table('consumptions').get(params[0]);
      return [row ? [clone(row)] : [], []];
    }
    if (sql.includes('spec014:enablement:insert-record')) {
      const id = params[0];
      if (this.table('records').has(id)) {
        const error = new Error('duplicate record');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      this.table('records').set(id, {
        id,
        authorization_digest: params[1],
        operation_id: params[2],
        run_id: params[3],
        generation: Number(params[4]),
        expires_at_epoch: Number(params[5]),
        consumed: 0,
        consumed_by_run_id: null,
        consumed_at_epoch: null,
        record_digest: params[6],
        record_json: params[7],
        row_version: 1,
      });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('spec014:enablement:update-consumed')) {
      const id = params[5];
      const expectedGeneration = Number(params[6]);
      const expectedVersion = Number(params[7]);
      const current = this.table('records').get(id);
      if (this.database.forceNextCasMiss) {
        this.database.forceNextCasMiss = false;
        return [{ affectedRows: 0 }, []];
      }
      if (!current || Number(current.generation) !== expectedGeneration
        || Number(current.consumed) !== 0 || Number(current.row_version) !== expectedVersion) {
        return [{ affectedRows: 0 }, []];
      }
      this.table('records').set(id, {
        ...current,
        generation: Number(params[0]),
        consumed: 1,
        consumed_by_run_id: params[1],
        consumed_at_epoch: Number(params[2]),
        record_digest: params[3],
        record_json: params[4],
        row_version: expectedVersion + 1,
      });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('spec014:enablement:insert-consumption')) {
      const enablementId = params[1];
      if (this.table('consumptions').has(enablementId)) {
        const error = new Error('duplicate consumption');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      this.table('consumptions').set(enablementId, {
        id: params[0],
        enablement_id: enablementId,
        authorization_digest: params[2],
        operation_id: params[3],
        run_id: params[4],
        registered_generation: Number(params[5]),
        consumed_generation: Number(params[6]),
        consumed_at_epoch: Number(params[7]),
        record_digest: params[8],
        record_json: params[9],
      });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('spec014:enablement:export-records')) {
      return [[...this.table('records').values()].sort((a, b) => a.id.localeCompare(b.id)).map(clone), []];
    }
    if (sql.includes('spec014:enablement:export-consumptions')) {
      return [[...this.table('consumptions').values()].sort((a, b) => a.enablement_id.localeCompare(b.enablement_id)).map(clone), []];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

class FakeEnablementPool {
  constructor(database) {
    this.database = database;
  }

  async getConnection() {
    this.database.connections += 1;
    return new FakeEnablementConnection(this.database);
  }
}

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
    source_commit: 'ca4359491113276ef25cf3aff160a045f2b99854',
    deployed_runtime_sha: 'ca4359491113276ef25cf3aff160a045f2b99854',
    runtime_parity: true,
    database_fingerprint: h('f'),
    readback_cycle_id: 'enablement-schema-readback-cycle-1',
    expires_at: '2099-08-02T00:15:00.000Z',
    enablement_registry_schema: {
      contract_key: HOSTINGER_STORAGE_DURABLE_TENANT_ENABLEMENT_SCHEMA_CONTRACT.contract_key,
      contract_digest: HOSTINGER_STORAGE_DURABLE_TENANT_ENABLEMENT_SCHEMA_DIGEST,
      tables: [...HOSTINGER_STORAGE_DURABLE_TENANT_ENABLEMENT_SCHEMA_CONTRACT.tables],
      secrets_included: false,
    },
    secrets_included: false,
  },
  secrets_included: false,
};

assert.throws(
  () => createHostingerStorageDurableTenantEnablementRegistry({
    pool: new FakeEnablementPool(new FakeEnablementDatabase()),
    schema_verification: {
      ...schemaVerification,
      evidence: {
        ...schemaVerification.evidence,
        enablement_registry_schema: {
          ...schemaVerification.evidence.enablement_registry_schema,
          contract_digest: h('0'),
        },
      },
    },
  }),
  (error) => error.code === 'STORAGE_DURABLE_ENABLEMENT_SCHEMA_CONTRACT_MISMATCH',
);

const database = new FakeEnablementDatabase();
const registry = createHostingerStorageDurableTenantEnablementRegistry({
  pool: new FakeEnablementPool(database),
  schema_verification: schemaVerification,
});

assert.equal(database.connections, 0, 'factory creation must not connect to the database');
assert.equal(isCanonicalHostingerStorageDurableTenantEnablementRegistry(registry), true);
assert.equal(registry.legacy_tenant_canary_compatible, false);
assert.equal(registry.automatic_retry_allowed, false);
assert.equal(registry.runtime_mounted, false);
assert.equal('pool' in registry, false);

const enablement = {
  enablement_id: 'enablement-1',
  authorization_digest: h('a'),
  operation_id: 'operation-1',
  run_id: 'run-1',
  generation: 3,
  expires_at_epoch: 1000,
  consumed: false,
  consumed_by_run_id: null,
  consumed_at_epoch: null,
  secrets_included: false,
};

const registered = await registry.register(enablement);
assert.equal(registered.created, true);
assert.equal(registered.enablement.generation, 3);
assert.equal(registered.row_version, 1);
assert.equal(await registry.readConsumption('enablement-1'), null);

const replay = await registry.register(enablement);
assert.equal(replay.replay, true);
assert.equal(database.tables.records.size, 1);

await assert.rejects(
  registry.register({ ...enablement, expires_at_epoch: 1100 }),
  (error) => error.code === 'STORAGE_DURABLE_ENABLEMENT_ID_CONFLICT',
);

await assert.rejects(
  registry.consume({
    enablement_id: 'enablement-1', authorization_digest: h('b'), operation_id: 'operation-1',
    run_id: 'run-1', expected_generation: 3, now_epoch: 500,
  }),
  (error) => error.code === 'STORAGE_DURABLE_ENABLEMENT_BINDING_MISMATCH',
);

await assert.rejects(
  registry.consume({
    enablement_id: 'enablement-1', authorization_digest: h('a'), operation_id: 'operation-1',
    run_id: 'run-1', expected_generation: 2, now_epoch: 500,
  }),
  (error) => error.code === 'STORAGE_DURABLE_ENABLEMENT_GENERATION_MISMATCH',
);

const consumed = await registry.consume({
  enablement_id: 'enablement-1', authorization_digest: h('a'), operation_id: 'operation-1',
  run_id: 'run-1', expected_generation: 3, now_epoch: 500,
});
assert.equal(consumed.consumed, true);
assert.equal(consumed.previous_generation, 3);
assert.equal(consumed.current_generation, 4);
assert.equal(consumed.row_version, 2);
assert.equal(consumed.enablement.consumed, true);
assert.equal(consumed.enablement.consumed_by_run_id, 'run-1');
assert.equal(consumed.consumption.registered_generation, 3);
assert.equal(consumed.consumption.consumed_generation, 4);
assert.equal(database.tables.consumptions.size, 1);

const receipt = await registry.readConsumption('enablement-1');
assert.equal(receipt.consumed_at_epoch, 500);
assert.match(receipt.record_digest, /^[0-9a-f]{64}$/u);

await assert.rejects(
  registry.consume({
    enablement_id: 'enablement-1', authorization_digest: h('a'), operation_id: 'operation-1',
    run_id: 'run-1', expected_generation: 4, now_epoch: 501,
  }),
  (error) => error.code === 'STORAGE_DURABLE_ENABLEMENT_ALREADY_CONSUMED',
);

await assert.rejects(
  registry.register(enablement),
  (error) => error.code === 'STORAGE_DURABLE_ENABLEMENT_ID_CONFLICT',
);

const expiredEnablement = {
  ...enablement,
  enablement_id: 'enablement-expired',
  operation_id: 'operation-expired',
  run_id: 'run-expired',
  generation: 1,
  expires_at_epoch: 600,
};
await registry.register(expiredEnablement);
await assert.rejects(
  registry.consume({
    enablement_id: 'enablement-expired', authorization_digest: h('a'), operation_id: 'operation-expired',
    run_id: 'run-expired', expected_generation: 1, now_epoch: 600,
  }),
  (error) => error.code === 'STORAGE_DURABLE_ENABLEMENT_EXPIRED',
);
assert.equal((await registry.read('enablement-expired')).consumed, false);

const casEnablement = {
  ...enablement,
  enablement_id: 'enablement-cas',
  operation_id: 'operation-cas',
  run_id: 'run-cas',
  generation: 7,
  expires_at_epoch: 2000,
};
await registry.register(casEnablement);
database.forceNextCasMiss = true;
const rollbackBeforeCas = database.rollbacks;
await assert.rejects(
  registry.consume({
    enablement_id: 'enablement-cas', authorization_digest: h('a'), operation_id: 'operation-cas',
    run_id: 'run-cas', expected_generation: 7, now_epoch: 700,
  }),
  (error) => error.code === 'STORAGE_DURABLE_ENABLEMENT_CAS_CONFLICT',
);
assert.equal(database.rollbacks, rollbackBeforeCas + 1);
assert.equal((await registry.read('enablement-cas')).generation, 7);
assert.equal(await registry.readConsumption('enablement-cas'), null);

await assert.rejects(
  registry.register({
    ...enablement,
    enablement_id: 'enablement-invalid-state',
    operation_id: 'operation-invalid-state',
    run_id: 'run-invalid-state',
    consumed: true,
    consumed_by_run_id: 'run-invalid-state',
    consumed_at_epoch: 100,
  }),
  (error) => error.code === 'STORAGE_DURABLE_ENABLEMENT_INITIAL_STATE_INVALID',
);

await assert.rejects(
  registry.register({
    ...enablement,
    enablement_id: 'enablement-unsafe',
    operation_id: 'operation-unsafe',
    run_id: 'run-unsafe',
    api_key: 'forbidden',
  }),
  (error) => error.code === 'STORAGE_DURABLE_ENABLEMENT_SECRET_OR_UNSAFE_FIELD_REJECTED',
);

const snapshot = await registry.exportState();
assert.equal(snapshot.enablements.length, 3);
assert.equal(snapshot.consumptions.length, 1);
assert.equal(snapshot.automatic_retry_allowed, false);
assert.equal(snapshot.runtime_mounted, false);
assert.equal(snapshot.production_ready, false);
assert.match(snapshot.snapshot_digest, /^[0-9a-f]{64}$/u);

assert.ok(database.commits >= 5);
assert.ok(database.rollbacks >= 5);
assert.equal(database.lockAcquisitions, database.lockReleases);

console.log(JSON.stringify({
  ok: true,
  contract: 'hostinger_storage_durable_tenant_enablement_registry_v1',
  consumed_generation: consumed.current_generation,
  immutable_consumption_count: database.tables.consumptions.size,
  commits: database.commits,
  rollbacks: database.rollbacks,
  automatic_retry_allowed: false,
  runtime_mounted: false,
  route_mounted: false,
  worker_mounted: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  secrets_included: false,
}));
