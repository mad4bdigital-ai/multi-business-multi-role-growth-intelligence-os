#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { bundle } from './test-hostinger-storage-authorized-mount-executor.mjs';
import { createHostingerStorageAuthorizedDependencyInjectionCoordinator } from './hostingerStorageAuthorizedDependencyInjection.js';
import {
  HOSTINGER_STORAGE_DURABLE_INJECTION_READBACK_SCHEMA_CONTRACT,
  HOSTINGER_STORAGE_DURABLE_INJECTION_READBACK_SCHEMA_DIGEST,
  createHostingerStorageDurableInjectionReadbackState,
  isCanonicalHostingerStorageDurableInjectionReadbackState,
} from './hostingerStorageDurableInjectionReadbackState.js';

const SOURCE_SHA = bundle.expected_runtime_sha;
const DATABASE = bundle.database_fingerprint;
const NOW = 1_786_001_000;

const stable = (value) => Array.isArray(value)
  ? value.map(stable)
  : (!value || typeof value !== 'object'
      ? value
      : Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])));
const digest = (value) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const rehash = (value, digestField) => {
  const copy = structuredClone(value);
  delete copy[digestField];
  copy[digestField] = digest(copy);
  return copy;
};

function deepClone(value) {
  return structuredClone(value);
}

class FakePool {
  constructor() {
    this.states = new Map();
    this.events = [];
    this.commits = 0;
    this.rollbacks = 0;
    this.lockAcquisitions = 0;
    this.lockReleases = 0;
    this.ambiguousStateId = null;
  }

  async getConnection() {
    return new FakeConnection(this);
  }
}

class FakeConnection {
  constructor(pool) {
    this.pool = pool;
    this.inTransaction = false;
    this.txStates = null;
    this.txEvents = null;
  }

  stateMap() {
    return this.inTransaction ? this.txStates : this.pool.states;
  }

  eventRows() {
    return this.inTransaction ? this.txEvents : this.pool.events;
  }

  async beginTransaction() {
    this.inTransaction = true;
    this.txStates = new Map([...this.pool.states.entries()].map(([key, value]) => [key, deepClone(value)]));
    this.txEvents = deepClone(this.pool.events);
  }

  async commit() {
    this.pool.states = this.txStates;
    this.pool.events = this.txEvents;
    this.pool.commits += 1;
    this.inTransaction = false;
  }

  async rollback() {
    this.pool.rollbacks += 1;
    this.inTransaction = false;
  }

  release() {}

  async execute(statement, params = []) {
    if (statement.includes('spec014:durable-injection:lock:acquire')) {
      this.pool.lockAcquisitions += 1;
      return [[{ acquired: 1 }]];
    }
    if (statement.includes('spec014:durable-injection:lock:release')) {
      this.pool.lockReleases += 1;
      return [[{ released: 1 }]];
    }
    if (statement.includes('spec014:durable-injection:load-state')) {
      const id = params[0];
      const row = this.stateMap().get(id);
      if (!row) return [[]];
      const result = [{
        record_digest: row.record_digest,
        record_json: JSON.stringify(row.record_json),
        row_version: row.row_version,
      }];
      if (this.pool.ambiguousStateId === id) result.push(deepClone(result[0]));
      return [result];
    }
    if (statement.includes('spec014:durable-injection:load-events')) {
      const injectionId = params[0];
      const rows = this.eventRows()
        .filter((event) => event.injection_id === injectionId)
        .sort((left, right) => left.state_generation - right.state_generation)
        .map((event) => ({
          record_digest: event.record_digest,
          record_json: JSON.stringify(event.record_json),
        }));
      return [rows];
    }
    if (statement.includes('spec014:durable-injection:insert-state')) {
      const [id, mountBundleDigest, injectionReceiptDigest, mountReadbackDigest, recordDigest, recordJson] = params;
      if (this.stateMap().has(id)) {
        const error = new Error('duplicate');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      this.stateMap().set(id, {
        id,
        mount_bundle_digest: mountBundleDigest,
        injection_receipt_digest: injectionReceiptDigest,
        mount_readback_digest: mountReadbackDigest,
        rollback_receipt_digest: null,
        status: 'readback_verified',
        active: 1,
        generation: 1,
        record_digest: recordDigest,
        record_json: JSON.parse(recordJson),
        row_version: 1,
      });
      return [{ affectedRows: 1 }];
    }
    if (statement.includes('spec014:durable-injection:update-rollback')) {
      const [rollbackDigest, generation, recordDigest, recordJson, id, expectedGeneration, expectedVersion] = params;
      const current = this.stateMap().get(id);
      if (!current || current.active !== 1 || current.generation !== expectedGeneration || current.row_version !== expectedVersion) {
        return [{ affectedRows: 0 }];
      }
      this.stateMap().set(id, {
        ...current,
        rollback_receipt_digest: rollbackDigest,
        status: 'rolled_back',
        active: 0,
        generation,
        record_digest: recordDigest,
        record_json: JSON.parse(recordJson),
        row_version: current.row_version + 1,
      });
      return [{ affectedRows: 1 }];
    }
    if (statement.includes('spec014:durable-injection:insert-event')) {
      const [id, injectionId, eventType, stateGeneration, recordDigest, recordJson] = params;
      if (this.eventRows().some((event) => event.id === id)) {
        const error = new Error('duplicate');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      this.eventRows().push({
        id,
        injection_id: injectionId,
        event_type: eventType,
        state_generation: stateGeneration,
        record_digest: recordDigest,
        record_json: JSON.parse(recordJson),
      });
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL statement: ${statement}`);
  }
}

function schemaVerification() {
  return {
    ready: true,
    schema_verified: true,
    blockers: [],
    production_ready: false,
    authority_granted: false,
    migration_apply_authorized: false,
    provider_dispatch_allowed: false,
    evidence_digest: 'd'.repeat(64),
    evidence: {
      source_commit: SOURCE_SHA,
      deployed_runtime_sha: SOURCE_SHA,
      runtime_parity: true,
      database_fingerprint: DATABASE,
      readback_cycle_id: 'durable-injection-readback-cycle-001',
      expires_at: '2099-01-01T00:00:00.000Z',
      durable_injection_readback_schema: {
        contract_key: HOSTINGER_STORAGE_DURABLE_INJECTION_READBACK_SCHEMA_CONTRACT.contract_key,
        contract_digest: HOSTINGER_STORAGE_DURABLE_INJECTION_READBACK_SCHEMA_DIGEST,
        tables: [...HOSTINGER_STORAGE_DURABLE_INJECTION_READBACK_SCHEMA_CONTRACT.tables],
      },
    },
    secrets_included: false,
  };
}

function createEvidence(injectionId = 'durable-injection-001', now = NOW) {
  const coordinator = createHostingerStorageAuthorizedDependencyInjectionCoordinator();
  const receipt = coordinator.injectAuthorizedDependency({
    bundle,
    injection_id: injectionId,
    expected_mount_bundle_digest: bundle.mount_bundle_digest,
    expected_runtime_sha: bundle.expected_runtime_sha,
    expected_authorization_generation: bundle.authorization_generation,
    now_epoch: now,
  });
  const readback = coordinator.readMountReadback({
    injection_id: injectionId,
    expected_injection_receipt_digest: receipt.injection_receipt_digest,
    expected_mount_bundle_digest: bundle.mount_bundle_digest,
  });
  return { coordinator, receipt, readback };
}

const pool = new FakePool();
const repository = createHostingerStorageDurableInjectionReadbackState({
  pool,
  schema_verification: schemaVerification(),
  lock_timeout_seconds: 3,
});
assert.equal(isCanonicalHostingerStorageDurableInjectionReadbackState(repository), true);
assert.equal(repository.runtime_object_persisted, false);
assert.equal(repository.provider_dispatch_allowed, false);
assert.equal(repository.production_ready, false);
assert.equal(repository.automatic_retry_allowed, false);

assert.throws(
  () => createHostingerStorageDurableInjectionReadbackState({
    pool,
    schema_verification: schemaVerification(),
    command: 'forbidden',
  }),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_OVERRIDE_FORBIDDEN',
);

const evidence = createEvidence();
const persisted = await repository.persistVerifiedMount({
  injection_receipt: evidence.receipt,
  mount_readback: evidence.readback,
  expected_mount_bundle_digest: bundle.mount_bundle_digest,
});
assert.equal(persisted.created, true);
assert.equal(persisted.replay, false);
assert.equal(persisted.row_version, 1);
assert.equal(persisted.state.status, 'readback_verified');
assert.equal(persisted.state.active, true);
assert.equal(persisted.state.resume_allowed, true);
assert.equal(persisted.state.runtime_object_persisted, false);
assert.equal(JSON.stringify(persisted.state).includes('tenantStorageRuntime'), false);
assert.equal(pool.commits, 1);
assert.equal(pool.rollbacks, 0);

const replay = await repository.persistVerifiedMount({
  injection_receipt: evidence.receipt,
  mount_readback: evidence.readback,
  expected_mount_bundle_digest: bundle.mount_bundle_digest,
});
assert.equal(replay.created, false);
assert.equal(replay.replay, true);
assert.equal(replay.row_version, 1);
assert.equal(pool.commits, 2);

const eventsBeforeRollback = await repository.readEvents(evidence.receipt.injection_id);
assert.equal(eventsBeforeRollback.length, 1);
assert.equal(eventsBeforeRollback[0].event_type, 'readback_verified');
assert.equal(eventsBeforeRollback[0].state_generation, 1);

const recovery = await repository.readRecoverySnapshot(evidence.receipt.injection_id);
assert.equal(recovery.active, true);
assert.equal(recovery.resume_allowed, true);
assert.equal(recovery.runtime_object_persisted, false);
assert.equal(recovery.injection_receipt_digest, evidence.receipt.injection_receipt_digest);
assert.equal(recovery.mount_readback_digest, evidence.readback.mount_readback_digest);

const resumedCoordinator = createHostingerStorageAuthorizedDependencyInjectionCoordinator();
const resumedReadback = resumedCoordinator.resumeAuthorizedInjection({
  bundle,
  injection_receipt: recovery.injection_receipt,
  mount_readback: recovery.mount_readback,
});
assert.equal(resumedReadback.mount_readback_digest, evidence.readback.mount_readback_digest);
const resumedDependencies = resumedCoordinator.resolveRouteDependencies({
  expected_mount_readback_digest: resumedReadback.mount_readback_digest,
});
assert.equal(Object.getOwnPropertyDescriptor(resumedDependencies, 'tenantStorageRuntime').value, bundle.tenantStorageRuntime);

const conflictingReceipt = rehash({
  ...structuredClone(evidence.receipt),
  injected_at_epoch: evidence.receipt.injected_at_epoch + 1,
}, 'injection_receipt_digest');
const conflictingReadback = rehash({
  ...structuredClone(evidence.readback),
  injection_receipt_digest: conflictingReceipt.injection_receipt_digest,
}, 'mount_readback_digest');
await assert.rejects(
  repository.persistVerifiedMount({
    injection_receipt: conflictingReceipt,
    mount_readback: conflictingReadback,
    expected_mount_bundle_digest: bundle.mount_bundle_digest,
  }),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_ID_CONFLICT',
);
assert.equal(pool.rollbacks, 1);

await assert.rejects(
  repository.persistVerifiedMount({
    injection_receipt: evidence.receipt,
    mount_readback: evidence.readback,
    expected_mount_bundle_digest: 'f'.repeat(64),
  }),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_MOUNT_BUNDLE_MISMATCH',
);

const rollbackReceipt = evidence.coordinator.rollbackAuthorizedInjection({
  injection_id: evidence.receipt.injection_id,
  expected_mount_readback_digest: evidence.readback.mount_readback_digest,
  rollback_reason_code: 'durable_state_close',
  now_epoch: NOW + 10,
});
const rolledBack = await repository.recordRollback({
  rollback_receipt: rollbackReceipt,
  expected_generation: 1,
  expected_row_version: 1,
});
assert.equal(rolledBack.updated, true);
assert.equal(rolledBack.replay, false);
assert.equal(rolledBack.row_version, 2);
assert.equal(rolledBack.state.status, 'rolled_back');
assert.equal(rolledBack.state.active, false);
assert.equal(rolledBack.state.resume_allowed, false);
assert.equal(rolledBack.state.rollback_receipt_digest, rollbackReceipt.rollback_receipt_digest);

const rollbackReplay = await repository.recordRollback({
  rollback_receipt: rollbackReceipt,
  expected_generation: 1,
  expected_row_version: 1,
});
assert.equal(rollbackReplay.updated, false);
assert.equal(rollbackReplay.replay, true);
assert.equal(rollbackReplay.row_version, 2);

const recoveryAfterRollback = await repository.readRecoverySnapshot(evidence.receipt.injection_id);
assert.equal(recoveryAfterRollback.active, false);
assert.equal(recoveryAfterRollback.resume_allowed, false);
assert.equal(recoveryAfterRollback.injection_receipt, null);
assert.equal(recoveryAfterRollback.mount_readback, null);
assert.equal(recoveryAfterRollback.rollback_receipt_digest, rollbackReceipt.rollback_receipt_digest);

const eventsAfterRollback = await repository.readEvents(evidence.receipt.injection_id);
assert.equal(eventsAfterRollback.length, 2);
assert.deepEqual(eventsAfterRollback.map((event) => event.event_type), ['readback_verified', 'rolled_back']);
assert.deepEqual(eventsAfterRollback.map((event) => event.state_generation), [1, 2]);

const restartedRepository = createHostingerStorageDurableInjectionReadbackState({
  pool,
  schema_verification: schemaVerification(),
});
const restartedState = await restartedRepository.read(evidence.receipt.injection_id);
assert.equal(restartedState.status, 'rolled_back');
assert.equal(restartedState.state_digest, rolledBack.state.state_digest);
assert.equal((await restartedRepository.readRecoverySnapshot(evidence.receipt.injection_id)).resume_allowed, false);

const conflictingRollback = rehash({
  ...structuredClone(rollbackReceipt),
  rollback_reason_code: 'different_reason',
}, 'rollback_receipt_digest');
await assert.rejects(
  repository.recordRollback({
    rollback_receipt: conflictingRollback,
    expected_generation: 1,
    expected_row_version: 1,
  }),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_ROLLBACK_CONFLICT',
);

const second = createEvidence('durable-injection-002', NOW + 20);
await repository.persistVerifiedMount({
  injection_receipt: second.receipt,
  mount_readback: second.readback,
  expected_mount_bundle_digest: bundle.mount_bundle_digest,
});
const secondRollback = second.coordinator.rollbackAuthorizedInjection({
  injection_id: second.receipt.injection_id,
  expected_mount_readback_digest: second.readback.mount_readback_digest,
  rollback_reason_code: 'cas_probe',
  now_epoch: NOW + 30,
});
await assert.rejects(
  repository.recordRollback({
    rollback_receipt: secondRollback,
    expected_generation: 1,
    expected_row_version: 9,
  }),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_GENERATION_MISMATCH',
);

pool.ambiguousStateId = second.receipt.injection_id;
await assert.rejects(
  repository.read(second.receipt.injection_id),
  (error) => error.code === 'STORAGE_DURABLE_INJECTION_STATE_AMBIGUOUS',
);
pool.ambiguousStateId = null;

assert.equal(pool.lockAcquisitions, pool.lockReleases);
assert.equal(repository.schema_contract.tables.length, 2);
assert.equal(repository.schema_contract_digest, HOSTINGER_STORAGE_DURABLE_INJECTION_READBACK_SCHEMA_DIGEST);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_durable_injection_readback_state',
  injection_id: evidence.receipt.injection_id,
  state_digest: rolledBack.state.state_digest,
  injection_receipt_digest: evidence.receipt.injection_receipt_digest,
  mount_readback_digest: evidence.readback.mount_readback_digest,
  rollback_receipt_digest: rollbackReceipt.rollback_receipt_digest,
  events: eventsAfterRollback.length,
  exact_replay: true,
  conflicting_replay_rejected: true,
  generation_and_row_version_cas: true,
  restart_readback: true,
  runtime_object_persisted: false,
  route_files_modified: false,
  server_files_modified: false,
  live_database_access: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  automatic_retry_allowed: false,
  migration_applied: false,
  secrets_included: false,
}, null, 2));
