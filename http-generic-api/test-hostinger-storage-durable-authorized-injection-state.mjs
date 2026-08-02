#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { bundle } from './test-hostinger-storage-authorized-mount-executor.mjs';
import { createHostingerStorageAuthorizedDependencyInjectionCoordinator } from './hostingerStorageAuthorizedDependencyInjection.js';
import {
  HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_SCHEMA_CONTRACT,
  HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_SCHEMA_DIGEST,
  createHostingerStorageDurableAuthorizedInjectionStateRegistry,
  isCanonicalHostingerStorageDurableAuthorizedInjectionStateRegistry,
} from './hostingerStorageDurableAuthorizedInjectionState.js';

const h = (character) => character.repeat(64);
const stable = (value) => Array.isArray(value)
  ? value.map(stable)
  : (!value || typeof value !== 'object'
      ? value
      : Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])));
const digest = (value) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const clone = (value) => structuredClone(value);
const containsRuntimeMaterial = (value, active = new WeakSet()) => {
  if (typeof value === 'function') return true;
  if (!value || typeof value !== 'object') return false;
  if (active.has(value)) return false;
  active.add(value);
  try {
    return Reflect.ownKeys(value).some((key) => {
      if (key === 'tenantStorageRuntime') return true;
      return containsRuntimeMaterial(value[key], active);
    });
  } finally {
    active.delete(value);
  }
};
const SOURCE = h('1');
const DATABASE = h('d');
const NOW = 1_786_000_200;
const INJECTION_ID = 'durable-injection-001';

function schemaVerification() {
  return {
    ready: true,
    schema_verified: true,
    blockers: [],
    production_ready: false,
    authority_granted: false,
    migration_apply_authorized: false,
    provider_dispatch_allowed: false,
    evidence_digest: h('e'),
    evidence: {
      source_commit: SOURCE,
      deployed_runtime_sha: SOURCE,
      runtime_parity: true,
      database_fingerprint: DATABASE,
      readback_cycle_id: 'durable-injection-readback-cycle-001',
      expires_at: '2099-01-01T00:15:00.000Z',
      authorized_injection_state_schema: {
        contract_key: HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_SCHEMA_CONTRACT.contract_key,
        contract_digest: HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_SCHEMA_DIGEST,
        tables: [...HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_SCHEMA_CONTRACT.tables],
        secrets_included: false,
      },
      secrets_included: false,
    },
    secrets_included: false,
  };
}

class FakeDatabase {
  constructor() {
    this.tables = { states: new Map(), rollbacks: new Map() };
    this.connections = 0;
    this.commits = 0;
    this.rollbacks = 0;
    this.lockAcquisitions = 0;
    this.lockReleases = 0;
  }
}

class FakeConnection {
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
    if (sql.includes('spec014:durable-injection:lock:acquire')) {
      this.database.lockAcquisitions += 1;
      return [[{ acquired: 1 }], []];
    }
    if (sql.includes('spec014:durable-injection:lock:release')) {
      this.database.lockReleases += 1;
      return [[{ released: 1 }], []];
    }
    if (sql.includes('spec014:durable-injection:load-state')) {
      const row = this.table('states').get(params[0]);
      return [row ? [clone(row)] : [], []];
    }
    if (sql.includes('spec014:durable-injection:load-rollback')) {
      const row = this.table('rollbacks').get(params[0]);
      return [row ? [clone(row)] : [], []];
    }
    if (sql.includes('spec014:durable-injection:insert-state')) {
      const injectionId = params[0];
      if (this.table('states').has(injectionId)) {
        const error = new Error('duplicate state');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      this.table('states').set(injectionId, {
        record_digest: params[5],
        record_json: params[6],
        row_version: 1,
      });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('spec014:durable-injection:update-rolled-back')) {
      const injectionId = params[2];
      const expectedVersion = Number(params[3]);
      const current = this.table('states').get(injectionId);
      const record = current ? JSON.parse(current.record_json) : null;
      if (!current || record.active !== true || Number(current.row_version) !== expectedVersion) {
        return [{ affectedRows: 0 }, []];
      }
      this.table('states').set(injectionId, {
        record_digest: params[0],
        record_json: params[1],
        row_version: expectedVersion + 1,
      });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('spec014:durable-injection:insert-rollback')) {
      const injectionId = params[1];
      if (this.table('rollbacks').has(injectionId)) {
        const error = new Error('duplicate rollback');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      this.table('rollbacks').set(injectionId, {
        record_digest: params[3],
        record_json: params[4],
      });
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

class FakePool {
  constructor(database) {
    this.database = database;
  }

  async getConnection() {
    this.database.connections += 1;
    return new FakeConnection(this.database);
  }
}

const coordinator = createHostingerStorageAuthorizedDependencyInjectionCoordinator();
const receipt = coordinator.injectAuthorizedDependency({
  bundle,
  injection_id: INJECTION_ID,
  expected_mount_bundle_digest: bundle.mount_bundle_digest,
  expected_runtime_sha: bundle.expected_runtime_sha,
  expected_authorization_generation: bundle.authorization_generation,
  now_epoch: NOW,
});
const readback = coordinator.readMountReadback({
  injection_id: INJECTION_ID,
  expected_injection_receipt_digest: receipt.injection_receipt_digest,
  expected_mount_bundle_digest: bundle.mount_bundle_digest,
});

const database = new FakeDatabase();
const registry = createHostingerStorageDurableAuthorizedInjectionStateRegistry({
  pool: new FakePool(database),
  schema_verification: schemaVerification(),
});
assert.equal(database.connections, 0, 'registry factory must not access SQL');
assert.equal(isCanonicalHostingerStorageDurableAuthorizedInjectionStateRegistry(registry), true);
assert.equal(registry.runtime_material_persisted, false);
assert.equal(registry.live_database_access_performed_by_factory, false);
assert.equal(registry.migration_apply_authorized, false);
assert.equal(registry.provider_dispatch_allowed, false);
assert.equal(registry.production_ready, false);

const registered = await registry.registerVerifiedInjection({
  injection_receipt: receipt,
  mount_readback: readback,
  now_epoch: NOW + 1,
});
assert.equal(registered.created, true);
assert.equal(registered.replay, false);
assert.equal(registered.state.active, true);
assert.equal(registered.state.runtime_material_persisted, false);
assert.equal(containsRuntimeMaterial(registered.state), false);

const replay = await registry.registerVerifiedInjection({
  injection_receipt: receipt,
  mount_readback: readback,
  now_epoch: NOW + 1,
});
assert.equal(replay.created, false);
assert.equal(replay.replay, true);
assert.equal(replay.state.record_digest, registered.state.record_digest);

const restartedRegistry = createHostingerStorageDurableAuthorizedInjectionStateRegistry({
  pool: new FakePool(database),
  schema_verification: schemaVerification(),
});
const persisted = await restartedRegistry.readVerifiedInjection(INJECTION_ID);
assert.equal(persisted.injection_receipt_digest, receipt.injection_receipt_digest);
assert.equal(persisted.mount_readback_digest, readback.mount_readback_digest);
assert.equal(persisted.active, true);
assert.equal(containsRuntimeMaterial(persisted), false);

const resumedCoordinator = createHostingerStorageAuthorizedDependencyInjectionCoordinator();
const resumed = resumedCoordinator.resumeAuthorizedInjection({
  bundle,
  injection_receipt: persisted.injection_receipt,
  mount_readback: persisted.mount_readback,
});
assert.equal(resumed.mount_readback_digest, readback.mount_readback_digest);
assert.equal(resumedCoordinator.readState().route_dependencies_available, true);

const tamperedReadback = clone(readback);
tamperedReadback.expected_runtime_sha = h('f');
delete tamperedReadback.mount_readback_digest;
tamperedReadback.mount_readback_digest = digest(tamperedReadback);
await assert.rejects(
  restartedRegistry.registerVerifiedInjection({
    injection_receipt: receipt,
    mount_readback: tamperedReadback,
    now_epoch: NOW + 2,
  }),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_RECEIPT_READBACK_MISMATCH'
    && error.details.mismatches.includes('expected_runtime_sha'),
);

const rollbackReceipt = coordinator.rollbackAuthorizedInjection({
  injection_id: INJECTION_ID,
  expected_mount_readback_digest: readback.mount_readback_digest,
  rollback_reason_code: 'durable_registry_test_complete',
  now_epoch: NOW + 10,
});
const rolledBack = await restartedRegistry.recordRollback({
  rollback_receipt: rollbackReceipt,
  expected_mount_readback_digest: readback.mount_readback_digest,
  now_epoch: NOW + 10,
});
assert.equal(rolledBack.rolled_back, true);
assert.equal(rolledBack.state.active, false);
assert.equal(rolledBack.state.fail_closed_route_restored, true);
assert.equal(rolledBack.rollback.rollback_receipt_digest, rollbackReceipt.rollback_receipt_digest);
assert.equal(rolledBack.row_version, 2);

const finalState = await registry.readVerifiedInjection(INJECTION_ID);
const finalRollback = await registry.readRollback(INJECTION_ID);
assert.equal(finalState.active, false);
assert.equal(finalState.rollback_receipt_digest, rollbackReceipt.rollback_receipt_digest);
assert.equal(finalRollback.fail_closed_route_restored, true);
assert.equal(containsRuntimeMaterial(finalState), false);
assert.equal(containsRuntimeMaterial(finalRollback), false);

await assert.rejects(
  registry.registerVerifiedInjection({
    injection_receipt: receipt,
    mount_readback: readback,
    now_epoch: NOW + 1,
  }),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_ROLLED_BACK_REPLAY_REJECTED',
);
await assert.rejects(
  registry.recordRollback({
    rollback_receipt: rollbackReceipt,
    expected_mount_readback_digest: readback.mount_readback_digest,
    now_epoch: NOW + 11,
  }),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_ROLLBACK_BINDING_MISMATCH',
);

assert.equal(database.lockAcquisitions, database.lockReleases);
assert.equal(database.commits, 3);
assert.equal(database.rollbacks, 2);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_durable_authorized_injection_state',
  injection_id: INJECTION_ID,
  injection_receipt_digest: receipt.injection_receipt_digest,
  mount_readback_digest: readback.mount_readback_digest,
  rollback_receipt_digest: rollbackReceipt.rollback_receipt_digest,
  exact_registration_readback: true,
  exact_replay_idempotent: true,
  restart_registry_readback: true,
  restart_coordinator_reconstruction: true,
  rehashed_receipt_readback_drift_rejected: true,
  rollback_cas_and_readback: true,
  rolled_back_reactivation_rejected: true,
  runtime_material_persisted: false,
  live_database_access_performed_by_factory: false,
  migration_apply_authorized: false,
  worker_mounted: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  automatic_retry_allowed: false,
  secrets_included: false,
}, null, 2));
