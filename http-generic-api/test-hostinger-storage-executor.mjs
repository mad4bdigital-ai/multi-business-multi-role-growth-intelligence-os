#!/usr/bin/env node
import assert from 'node:assert/strict';
import { executeHostingerStorageSyntheticPlan } from './hostingerStorageSyntheticExecutor.js';
import { verifyHostingerStorageSyntheticExecutionProtocol } from './hostingerStorageExecutorProtocol.js';
import { createSyntheticExecutorFixture } from './test-hostinger-storage-executor-fixtures.mjs';

const success = createSyntheticExecutorFixture();
const protocolVerification = verifyHostingerStorageSyntheticExecutionProtocol({
  protocol: success.protocol.protocol,
  expected_digest: success.protocol.protocol_digest,
});
assert.equal(protocolVerification.valid, true);
assert.equal(protocolVerification.dispatch_allowed, false);

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
  changed_inode_skipped: true,
  append_only_journal: true,
  provider_dispatch_allowed: false,
  live_provider_mutated: false,
  production_ready: false,
  secrets_included: false,
}));
