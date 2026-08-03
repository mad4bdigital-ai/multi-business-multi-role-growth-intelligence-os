#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  executeHostingerStorageSyntheticPlan,
  reconcileHostingerStorageSyntheticOutcome,
} from './hostingerStorageSyntheticExecutor.js';
import { createSyntheticExecutorFixture } from './test-hostinger-storage-executor-fixtures.mjs';

const beforeMutation = createSyntheticExecutorFixture({
  run_id: 'run-before-mutation',
  operation_id: 'operation-before-mutation',
  plan_id: 'plan-before-mutation',
  target_id: 'target-before-mutation',
});
const interruptedBefore = executeHostingerStorageSyntheticPlan({
  protocol: beforeMutation.protocol.protocol,
  protocol_digest: beforeMutation.protocol.protocol_digest,
  repository: beforeMutation.repository,
  adapter: beforeMutation.adapter,
  fault: { phase: 'after_prepared', item_id: 'item-1' },
  now_epoch: 1100,
});
assert.equal(interruptedBefore.state, 'unknown_outcome');
assert.equal(interruptedBefore.automatic_retry_allowed, false);
assert.equal(interruptedBefore.read_before_retry_required, true);
assert.equal(beforeMutation.repository.readAggregate(beforeMutation.operation_id).operation.state, 'unknown_outcome');
assert.deepEqual(beforeMutation.repository.readAggregate(beforeMutation.operation_id).journals.map((row) => row.phase), ['prepared']);
assert.equal(beforeMutation.adapter.exportState().items[0].exists, true);
assert.equal(beforeMutation.adapter.exportState().receipts.length, 0);

assert.throws(
  () => executeHostingerStorageSyntheticPlan({
    protocol: beforeMutation.protocol.protocol,
    protocol_digest: beforeMutation.protocol.protocol_digest,
    repository: beforeMutation.repository,
    adapter: beforeMutation.adapter,
    now_epoch: 1110,
  }),
  (error) => error.code === 'STORAGE_SYNTHETIC_EXECUTOR_OPERATION_STATE_INVALID',
);

const notApplied = reconcileHostingerStorageSyntheticOutcome({
  protocol: beforeMutation.protocol.protocol,
  protocol_digest: beforeMutation.protocol.protocol_digest,
  repository: beforeMutation.repository,
  adapter: beforeMutation.adapter,
  now_epoch: 1120,
});
assert.equal(notApplied.outcome, 'not_applied');
assert.equal(notApplied.retry_allowed, true);
assert.equal(notApplied.new_plan_required_for_retry, true);
assert.equal(beforeMutation.repository.readAggregate(beforeMutation.operation_id).operation.state, 'completed');
assert.equal(beforeMutation.repository.readAggregate(beforeMutation.operation_id).reconciliations[0].outcome, 'not_applied');
assert.equal(beforeMutation.repository.readAggregate(beforeMutation.operation_id).journals.length, 1);

const afterMutation = createSyntheticExecutorFixture({
  run_id: 'run-after-mutation',
  operation_id: 'operation-after-mutation',
  plan_id: 'plan-after-mutation',
  target_id: 'target-after-mutation',
});
const interruptedAfter = executeHostingerStorageSyntheticPlan({
  protocol: afterMutation.protocol.protocol,
  protocol_digest: afterMutation.protocol.protocol_digest,
  repository: afterMutation.repository,
  adapter: afterMutation.adapter,
  fault: { phase: 'after_mutation', item_id: 'item-1' },
  now_epoch: 1100,
});
assert.equal(interruptedAfter.state, 'unknown_outcome');
assert.equal(afterMutation.adapter.exportState().items[0].exists, false);
assert.equal(afterMutation.adapter.exportState().receipts.length, 1);
assert.deepEqual(afterMutation.repository.readAggregate(afterMutation.operation_id).journals.map((row) => row.phase), ['prepared']);

const recoveredApplied = reconcileHostingerStorageSyntheticOutcome({
  protocol: afterMutation.protocol.protocol,
  protocol_digest: afterMutation.protocol.protocol_digest,
  repository: afterMutation.repository,
  adapter: afterMutation.adapter,
  now_epoch: 1120,
});
assert.equal(recoveredApplied.outcome, 'applied');
assert.equal(recoveredApplied.retry_allowed, false);
assert.equal(recoveredApplied.counts.deleted_recovered, 1);
const recoveredAggregate = afterMutation.repository.readAggregate(afterMutation.operation_id);
assert.equal(recoveredAggregate.operation.state, 'completed');
assert.deepEqual(recoveredAggregate.journals.map((row) => row.phase), ['prepared', 'result', 'readback']);
assert.equal(recoveredAggregate.journals.find((row) => row.phase === 'result').result, 'deleted_recovered');
assert.equal(recoveredAggregate.reconciliations[0].outcome, 'applied');

const replaySafe = createSyntheticExecutorFixture({
  run_id: 'run-reconciliation-replay',
  operation_id: 'operation-reconciliation-replay',
  plan_id: 'plan-reconciliation-replay',
  target_id: 'target-reconciliation-replay',
});
executeHostingerStorageSyntheticPlan({
  protocol: replaySafe.protocol.protocol,
  protocol_digest: replaySafe.protocol.protocol_digest,
  repository: replaySafe.repository,
  adapter: replaySafe.adapter,
  fault: { phase: 'after_mutation', item_id: 'item-1' },
  now_epoch: 1100,
});
let crashInjected = false;
const crashAfterCommittedReconciliation = {
  ...replaySafe.repository,
  recordReconciliation(record) {
    const persisted = replaySafe.repository.recordReconciliation(record);
    if (!crashInjected) {
      crashInjected = true;
      const error = new Error('synthetic crash after reconciliation commit');
      error.code = 'SYNTHETIC_TEST_CRASH_AFTER_RECONCILIATION_COMMIT';
      throw error;
    }
    return persisted;
  },
};
assert.throws(
  () => reconcileHostingerStorageSyntheticOutcome({
    protocol: replaySafe.protocol.protocol,
    protocol_digest: replaySafe.protocol.protocol_digest,
    repository: crashAfterCommittedReconciliation,
    adapter: replaySafe.adapter,
    now_epoch: 1120,
  }),
  (error) => error.code === 'SYNTHETIC_TEST_CRASH_AFTER_RECONCILIATION_COMMIT',
);
const afterCommittedCrash = replaySafe.repository.readAggregate(replaySafe.operation_id);
assert.equal(afterCommittedCrash.operation.state, 'reconciling');
assert.equal(afterCommittedCrash.reconciliations.length, 1);
const persistedReviewedAt = afterCommittedCrash.reconciliations[0].reviewed_at_epoch;
const replayedReconciliation = reconcileHostingerStorageSyntheticOutcome({
  protocol: replaySafe.protocol.protocol,
  protocol_digest: replaySafe.protocol.protocol_digest,
  repository: replaySafe.repository,
  adapter: replaySafe.adapter,
  now_epoch: 1190,
});
assert.equal(replayedReconciliation.outcome, 'applied');
const afterReplay = replaySafe.repository.readAggregate(replaySafe.operation_id);
assert.equal(afterReplay.operation.state, 'completed');
assert.equal(afterReplay.reconciliations.length, 1);
assert.equal(afterReplay.reconciliations[0].reviewed_at_epoch, persistedReviewedAt);

const conflict = createSyntheticExecutorFixture({
  run_id: 'run-conflict',
  operation_id: 'operation-conflict',
  plan_id: 'plan-conflict',
  target_id: 'target-conflict',
});
executeHostingerStorageSyntheticPlan({
  protocol: conflict.protocol.protocol,
  protocol_digest: conflict.protocol.protocol_digest,
  repository: conflict.repository,
  adapter: conflict.adapter,
  fault: { phase: 'after_prepared', item_id: 'item-1' },
  now_epoch: 1100,
});
conflict.adapter.replaceItemMetadata({
  item_id: 'item-1',
  metadata: {
    size_bytes: 4096,
    device: 7,
    inode: 777,
    ctime_epoch: 1110,
    mtime_epoch: 1110,
    file_type: 'regular',
  },
});
const conflicted = reconcileHostingerStorageSyntheticOutcome({
  protocol: conflict.protocol.protocol,
  protocol_digest: conflict.protocol.protocol_digest,
  repository: conflict.repository,
  adapter: conflict.adapter,
  now_epoch: 1120,
});
assert.equal(conflicted.outcome, 'conflict');
assert.equal(conflicted.retry_allowed, false);
assert.equal(conflict.repository.readAggregate(conflict.operation_id).operation.state, 'blocked');

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_unknown_outcome',
  crash_before_mutation_reconciled_not_applied: true,
  crash_after_mutation_recovered_from_receipt: true,
  reconciliation_record_replay_safe: true,
  automatic_retry_forbidden: true,
  conflict_blocks_operation: true,
  dispatch_allowed: false,
  secrets_included: false,
}));
