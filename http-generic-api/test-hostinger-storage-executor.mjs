#!/usr/bin/env node
import assert from 'node:assert/strict';
import { executeHostingerStorageSyntheticPlan } from './hostingerStorageSyntheticExecutor.js';
import {
  buildHostingerStorageSyntheticExecutionProtocol,
  verifyHostingerStorageSyntheticExecutionProtocol,
} from './hostingerStorageExecutorProtocol.js';
import { createSyntheticExecutorFixture, h } from './test-hostinger-storage-executor-fixtures.mjs';

const success = createSyntheticExecutorFixture();
const protocolVerification = verifyHostingerStorageSyntheticExecutionProtocol({
  protocol: success.protocol.protocol,
  expected_digest: success.protocol.protocol_digest,
});
assert.equal(protocolVerification.valid, true);
assert.equal(protocolVerification.dispatch_allowed, false);
assert.equal(success.protocol.protocol.plan_expires_at_epoch, 1800);
assert.equal(success.protocol.protocol.lease_expires_at_epoch, 1600);

for (const [field, value, blocker] of [
  ['recovery_required', false, 'STORAGE_ATTESTATION_RECOVERY_REQUIRED_CHANGED'],
  ['recovery_proof_digest', h('0'), 'STORAGE_ATTESTATION_RECOVERY_PROOF_CHANGED'],
  ['recovery_requirement_binding_digest', h('0'), 'STORAGE_ATTESTATION_RECOVERY_REQUIREMENT_CHANGED'],
  ['attestation_toolchain_provenance_digest', h('0'), 'STORAGE_ATTESTATION_TOOLCHAIN_PROVENANCE_CHANGED'],
  ['attestation_toolchain_selected_tools_digest', h('0'), 'STORAGE_ATTESTATION_TOOLCHAIN_CHANGED'],
]) {
  assert.throws(
    () => buildHostingerStorageSyntheticExecutionProtocol({
      authorization: success.authorization,
      expected_bundle_hash: success.authorization.bundle_hash,
      current_bindings: { ...success.currentBindings, [field]: value },
      plan: success.plan,
      run_id: `run-drift-${field}`,
    }),
    (error) => error.code === 'STORAGE_EXECUTOR_AUTHORIZATION_INVALID'
      && error.details?.blockers?.includes(blocker),
  );
}

const applied = executeHostingerStorageSyntheticPlan({
  protocol: success.protocol.protocol,
  protocol_digest: success.protocol.protocol_digest,
  repository: success.repository,
  adapter: success.adapter,
  now_epoch: 1100,
});
assert.equal(applied.outcome, 'applied');
assert.equal(applied.retry_allowed, false);
assert.equal(applied.dispatch_allowed, false);
assert.equal(applied.live_provider_mutated, false);
assert.equal(applied.counts.deleted, 1);
const successAggregate = success.repository.readAggregate(success.operation_id);
assert.equal(successAggregate.operation.state, 'completed');
assert.equal(successAggregate.plans[0].consumed, true);
assert.deepEqual(successAggregate.journals.map((row) => row.phase), ['prepared', 'result', 'readback']);
assert.equal(successAggregate.journals.find((row) => row.phase === 'result').result, 'deleted');
assert.equal(successAggregate.reconciliations[0].outcome, 'applied');
assert.equal(success.adapter.exportState().items[0].exists, false);
assert.equal(success.adapter.exportState().receipts.length, 1);

const changed = createSyntheticExecutorFixture({
  run_id: 'run-changed',
  operation_id: 'operation-changed',
  plan_id: 'plan-changed',
  target_id: 'target-changed',
});
changed.adapter.replaceItemMetadata({
  item_id: 'item-1',
  metadata: {
    size_bytes: 2048,
    device: 7,
    inode: 99,
    ctime_epoch: 1001,
    mtime_epoch: 1001,
    file_type: 'regular',
  },
});
const partial = executeHostingerStorageSyntheticPlan({
  protocol: changed.protocol.protocol,
  protocol_digest: changed.protocol.protocol_digest,
  repository: changed.repository,
  adapter: changed.adapter,
  now_epoch: 1100,
});
assert.equal(partial.outcome, 'partially_applied');
assert.equal(partial.counts.skipped_changed, 1);
assert.equal(changed.adapter.exportState().items[0].exists, true);
assert.equal(changed.repository.readAggregate(changed.operation_id).journals.find((row) => row.phase === 'result').result, 'skipped_changed');
assert.equal(changed.repository.readAggregate(changed.operation_id).operation.state, 'completed');

const expiredPlan = createSyntheticExecutorFixture({
  run_id: 'run-expired-plan',
  operation_id: 'operation-expired-plan',
  plan_id: 'plan-expired-plan',
  target_id: 'target-expired-plan',
  plan_expires_at_epoch: 1200,
});
assert.throws(
  () => executeHostingerStorageSyntheticPlan({
    protocol: expiredPlan.protocol.protocol,
    protocol_digest: expiredPlan.protocol.protocol_digest,
    repository: expiredPlan.repository,
    adapter: expiredPlan.adapter,
    now_epoch: 1201,
  }),
  (error) => error.code === 'STORAGE_SYNTHETIC_EXECUTOR_PLAN_EXPIRED',
);
assert.equal(expiredPlan.repository.readAggregate(expiredPlan.operation_id).journals.length, 0);
assert.equal(expiredPlan.adapter.exportState().items[0].exists, true);

const expiredLease = createSyntheticExecutorFixture({
  run_id: 'run-expired-lease',
  operation_id: 'operation-expired-lease',
  plan_id: 'plan-expired-lease',
  target_id: 'target-expired-lease',
});
assert.throws(
  () => executeHostingerStorageSyntheticPlan({
    protocol: expiredLease.protocol.protocol,
    protocol_digest: expiredLease.protocol.protocol_digest,
    repository: expiredLease.repository,
    adapter: expiredLease.adapter,
    now_epoch: 1701,
  }),
  (error) => error.code === 'STORAGE_SYNTHETIC_EXECUTOR_LEASE_EXPIRED',
);
assert.equal(expiredLease.repository.readAggregate(expiredLease.operation_id).journals.length, 0);
assert.equal(expiredLease.adapter.exportState().items[0].exists, true);

const releasedLease = createSyntheticExecutorFixture({
  run_id: 'run-released-lease',
  operation_id: 'operation-released-lease',
  plan_id: 'plan-released-lease',
  target_id: 'target-released-lease',
});
releasedLease.repository.releaseLease({
  target_id: releasedLease.target_id,
  lease_id: releasedLease.lease.lease_id,
  operation_id: releasedLease.operation_id,
  holder_ref: releasedLease.lease.holder_ref,
  expected_generation: releasedLease.lease.generation,
  evidence_digest: h('a'),
  now_epoch: 1050,
});
assert.throws(
  () => executeHostingerStorageSyntheticPlan({
    protocol: releasedLease.protocol.protocol,
    protocol_digest: releasedLease.protocol.protocol_digest,
    repository: releasedLease.repository,
    adapter: releasedLease.adapter,
    now_epoch: 1100,
  }),
  (error) => error.code === 'STORAGE_SYNTHETIC_EXECUTOR_LEASE_BINDING_STALE'
    && error.details?.mismatches?.includes('generation'),
);
assert.equal(releasedLease.repository.readAggregate(releasedLease.operation_id).journals.length, 0);
assert.equal(releasedLease.adapter.exportState().items[0].exists, true);

const renewedLease = createSyntheticExecutorFixture({
  run_id: 'run-renewed-lease',
  operation_id: 'operation-renewed-lease',
  plan_id: 'plan-renewed-lease',
  target_id: 'target-renewed-lease',
});
renewedLease.repository.renewLease({
  target_id: renewedLease.target_id,
  lease_id: renewedLease.lease.lease_id,
  operation_id: renewedLease.operation_id,
  holder_ref: renewedLease.lease.holder_ref,
  expected_generation: renewedLease.lease.generation,
  expires_at_epoch: 1700,
  evidence_digest: h('b'),
  now_epoch: 1050,
});
assert.throws(
  () => executeHostingerStorageSyntheticPlan({
    protocol: renewedLease.protocol.protocol,
    protocol_digest: renewedLease.protocol.protocol_digest,
    repository: renewedLease.repository,
    adapter: renewedLease.adapter,
    now_epoch: 1100,
  }),
  (error) => error.code === 'STORAGE_SYNTHETIC_EXECUTOR_LEASE_BINDING_STALE'
    && error.details?.mismatches?.includes('generation'),
);
assert.equal(renewedLease.repository.readAggregate(renewedLease.operation_id).journals.length, 0);
assert.equal(renewedLease.adapter.exportState().items[0].exists, true);

const tampered = structuredClone(success.protocol.protocol);
tampered.items[0].expected.inode = 999;
assert.throws(
  () => verifyHostingerStorageSyntheticExecutionProtocol({ protocol: tampered, expected_digest: success.protocol.protocol_digest }),
  (error) => error.code === 'STORAGE_EXECUTOR_PROTOCOL_TAMPERED',
);

const unsafeAdapter = {
  synthetic_only: false,
  production_ready: true,
  live_provider: true,
  filesystem_access: true,
  shell_access: true,
};
const unsafeFixture = createSyntheticExecutorFixture({
  run_id: 'run-unsafe',
  operation_id: 'operation-unsafe',
  plan_id: 'plan-unsafe',
  target_id: 'target-unsafe',
});
assert.throws(
  () => executeHostingerStorageSyntheticPlan({
    protocol: unsafeFixture.protocol.protocol,
    protocol_digest: unsafeFixture.protocol.protocol_digest,
    repository: unsafeFixture.repository,
    adapter: unsafeAdapter,
    now_epoch: 1100,
  }),
  (error) => error.code === 'STORAGE_SYNTHETIC_EXECUTOR_ADAPTER_INVALID',
);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_synthetic_executor',
  exact_plan_applied_in_memory: true,
  attestation_readback_drift_rejected: true,
  changed_inode_skipped: true,
  plan_expiry_revalidated: true,
  lease_status_generation_and_expiry_revalidated: true,
  append_only_journal: true,
  provider_dispatch_allowed: false,
  live_provider_mutated: false,
  production_ready: false,
  secrets_included: false,
}));
