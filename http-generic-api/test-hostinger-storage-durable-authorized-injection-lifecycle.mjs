#!/usr/bin/env node
import assert from 'node:assert/strict';

import { bundle } from './test-hostinger-storage-authorized-mount-executor.mjs';
import {
  HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_SCHEMA_CONTRACT,
  HOSTINGER_STORAGE_DURABLE_AUTHORIZED_INJECTION_SCHEMA_DIGEST,
  createHostingerStorageDurableAuthorizedInjectionStateRegistry,
} from './hostingerStorageDurableAuthorizedInjectionState.js';
import {
  createHostingerStorageDurableAuthorizedInjectionLifecycle,
  isCanonicalHostingerStorageDurableAuthorizedInjectionLifecycle,
} from './hostingerStorageDurableAuthorizedInjectionLifecycle.js';

const h = (character) => character.repeat(64);
const clone = (value) => structuredClone(value);
const SOURCE = h('1');
const DATABASE = h('d');
const NOW = 1_786_000_500;

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
      readback_cycle_id: 'durable-lifecycle-readback-cycle-001',
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
    this.failNextRollbackUpdate = false;
  }
}

class FakeConnection {
  constructor(database) {
    this.database = database;
    this.working = null;
  }

  async beginTransaction() { this.working = clone(this.database.tables); }
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
  table(name) { return (this.working || this.database.tables)[name]; }

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
      if (this.database.failNextRollbackUpdate) {
        this.database.failNextRollbackUpdate = false;
        const error = new Error('simulated rollback deadlock');
        error.code = 'ER_LOCK_DEADLOCK';
        throw error;
      }
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
  constructor(database) { this.database = database; }
  async getConnection() {
    this.database.connections += 1;
    return new FakeConnection(this.database);
  }
}

function createRegistry(database) {
  return createHostingerStorageDurableAuthorizedInjectionStateRegistry({
    pool: new FakePool(database),
    schema_verification: schemaVerification(),
  });
}

const database = new FakeDatabase();
const registry = createRegistry(database);
const lifecycle = createHostingerStorageDurableAuthorizedInjectionLifecycle({
  durable_injection_registry: registry,
});
assert.equal(database.connections, 0, 'lifecycle construction must not access SQL');
assert.equal(isCanonicalHostingerStorageDurableAuthorizedInjectionLifecycle(lifecycle), true);
assert.equal(lifecycle.canonical_coordinator_owned_internally, true);
assert.equal(lifecycle.route_available_only_after_durable_readback, true);
assert.equal(lifecycle.runtime_material_persisted, false);
assert.equal(lifecycle.live_server_modified, false);
assert.equal(lifecycle.provider_dispatch_allowed, false);
assert.equal(lifecycle.production_ready, false);

assert.throws(
  () => createHostingerStorageDurableAuthorizedInjectionLifecycle({
    durable_injection_registry: registry,
    coordinator: {},
  }),
  (error) => error.code === 'STORAGE_DURABLE_LIFECYCLE_OVERRIDE_FORBIDDEN',
);
assert.throws(
  () => createHostingerStorageDurableAuthorizedInjectionLifecycle({
    durable_injection_registry: Object.freeze({}),
  }),
  (error) => error.code === 'STORAGE_DURABLE_LIFECYCLE_REGISTRY_INVALID',
);

const before = lifecycle.resolveRouteDependencies({
  expected_mount_readback_digest: '0'.repeat(64),
});
assert.equal(Object.isFrozen(before), true);
assert.equal('tenantStorageRuntime' in before, false);

const activation = await lifecycle.activateAuthorizedInjection({
  bundle,
  injection_id: 'lifecycle-injection-001',
  now_epoch: NOW,
});
assert.equal(activation.mode, 'new_activation');
assert.equal(activation.durable_state_active, true);
assert.equal(activation.exact_readback_verified, true);
assert.equal(activation.ready_for_route_resolution, true);
assert.equal(activation.runtime_material_persisted, false);
assert.equal(database.tables.states.size, 1);

const wrongDigest = lifecycle.resolveRouteDependencies({
  expected_mount_readback_digest: 'f'.repeat(64),
});
assert.equal('tenantStorageRuntime' in wrongDigest, false);
const routeDependencies = lifecycle.resolveRouteDependencies({
  expected_mount_readback_digest: activation.mount_readback_digest,
});
const descriptor = Object.getOwnPropertyDescriptor(routeDependencies, 'tenantStorageRuntime');
assert.equal(Object.isFrozen(routeDependencies), true);
assert.equal(descriptor.enumerable, false);
assert.equal(descriptor.configurable, false);
assert.equal(descriptor.writable, false);
assert.equal(descriptor.value, bundle.tenantStorageRuntime);

await assert.rejects(
  lifecycle.activateAuthorizedInjection({
    bundle,
    injection_id: 'lifecycle-injection-replay',
    now_epoch: NOW + 1,
  }),
  (error) => error.code === 'STORAGE_DURABLE_LIFECYCLE_SLOT_OCCUPIED',
);

const restartedLifecycle = createHostingerStorageDurableAuthorizedInjectionLifecycle({
  durable_injection_registry: createRegistry(database),
});
const resumed = await restartedLifecycle.resumeAuthorizedInjection({
  bundle,
  injection_id: 'lifecycle-injection-001',
});
assert.equal(resumed.mode, 'restart_reconstruction');
assert.equal(resumed.mount_readback_digest, activation.mount_readback_digest);
const resumedDependencies = restartedLifecycle.resolveRouteDependencies({
  expected_mount_readback_digest: resumed.mount_readback_digest,
});
assert.equal(Object.getOwnPropertyDescriptor(resumedDependencies, 'tenantStorageRuntime').value, bundle.tenantStorageRuntime);

const rollback = await restartedLifecycle.rollbackAuthorizedInjection({
  injection_id: 'lifecycle-injection-001',
  rollback_reason_code: 'lifecycle_test_complete',
  now_epoch: NOW + 10,
});
assert.equal(rollback.durable_rollback_recorded, true);
assert.equal(rollback.route_fail_closed, true);
assert.equal(rollback.runtime_material_persisted, false);
assert.equal(restartedLifecycle.readState().active, false);
assert.equal(restartedLifecycle.readState().route_dependencies_available, false);
const afterRollback = restartedLifecycle.resolveRouteDependencies({
  expected_mount_readback_digest: resumed.mount_readback_digest,
});
assert.equal('tenantStorageRuntime' in afterRollback, false);

const rolledBackReplayLifecycle = createHostingerStorageDurableAuthorizedInjectionLifecycle({
  durable_injection_registry: createRegistry(database),
});
await assert.rejects(
  rolledBackReplayLifecycle.activateAuthorizedInjection({
    bundle,
    injection_id: 'lifecycle-injection-001',
    now_epoch: NOW + 11,
  }),
  (error) => error.code === 'STORAGE_DURABLE_LIFECYCLE_REGISTRATION_FAILED'
    && error.details.cause_code === 'STORAGE_DURABLE_INJECTION_ROLLED_BACK_REPLAY_REJECTED'
    && error.details.route_fail_closed === true,
);
assert.equal(rolledBackReplayLifecycle.readState().route_dependencies_available, false);

const pendingLifecycle = createHostingerStorageDurableAuthorizedInjectionLifecycle({
  durable_injection_registry: createRegistry(database),
});
const pendingActivation = await pendingLifecycle.activateAuthorizedInjection({
  bundle,
  injection_id: 'lifecycle-injection-002',
  now_epoch: NOW + 20,
});
database.failNextRollbackUpdate = true;
await assert.rejects(
  pendingLifecycle.rollbackAuthorizedInjection({
    injection_id: 'lifecycle-injection-002',
    rollback_reason_code: 'simulate_durable_unknown_outcome',
    now_epoch: NOW + 30,
  }),
  (error) => error.code === 'STORAGE_DURABLE_LIFECYCLE_DURABLE_ROLLBACK_PENDING'
    && error.details.route_fail_closed === true
    && error.details.durable_reconciliation_required === true
    && error.details.automatic_retry_allowed === false,
);
assert.equal(pendingLifecycle.readState().active, false);
assert.equal(pendingLifecycle.readState().route_dependencies_available, false);
assert.equal(pendingLifecycle.readState().durable_reconciliation_required, true);
const pendingRoute = pendingLifecycle.resolveRouteDependencies({
  expected_mount_readback_digest: pendingActivation.mount_readback_digest,
});
assert.equal('tenantStorageRuntime' in pendingRoute, false);
const reconciled = await pendingLifecycle.reconcilePendingRollback({});
assert.equal(reconciled.reconciled, true);
assert.equal(reconciled.route_fail_closed, true);
assert.equal(pendingLifecycle.readState().durable_reconciliation_required, false);

assert.equal(database.lockAcquisitions, database.lockReleases);
assert.equal(database.tables.states.size, 2);
assert.equal(database.tables.rollbacks.size, 2);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_durable_authorized_injection_lifecycle',
  first_injection_receipt_digest: activation.injection_receipt_digest,
  first_mount_readback_digest: activation.mount_readback_digest,
  first_rollback_receipt_digest: rollback.rollback_receipt_digest,
  durable_activation_before_route_availability: true,
  exact_route_dependency_resolution: true,
  restart_reconstruction_from_durable_state: true,
  rolled_back_reactivation_rejected: true,
  rollback_route_fail_closed_before_durable_commit: true,
  explicit_pending_rollback_reconciliation: true,
  runtime_material_persisted: false,
  live_server_modified: false,
  live_route_registration_performed: false,
  migration_apply_authorized: false,
  worker_mounted: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  automatic_retry_allowed: false,
  secrets_included: false,
}, null, 2));
