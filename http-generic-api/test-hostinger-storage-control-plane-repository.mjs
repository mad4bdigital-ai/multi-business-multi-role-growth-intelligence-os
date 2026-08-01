#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createHostingerStorageControlPlaneRepository,
  createMemoryHostingerStoragePersistenceAdapter,
} from './hostingerStorageControlPlaneRepository.js';

const h = (character) => character.repeat(64);
const operation = {
  operation_id: 'operation-1',
  operation_key: 'hostinger_storage_apply_plan',
  target_id: 'target-1',
  tenant_id: 'tenant-1',
  workspace_id: 'workspace-1',
  resource_id: 'resource-1',
  context_mode: 'tenant',
  authority_context_hash: h('1'),
  ownership_revision: 'ownership-r1',
  policy_revision: 'policy-r1',
  idempotency_key: h('2'),
  risk_profile: 'tenant_high',
  state: 'observed',
  version: 1,
  created_at_epoch: 100,
  updated_at_epoch: 100,
  secrets_included: false,
};

const adapter = createMemoryHostingerStoragePersistenceAdapter();
const repository = createHostingerStorageControlPlaneRepository({ adapter });
assert.equal(repository.production_ready, false);
assert.equal(repository.adapter_key, 'hostinger_storage_memory_test_adapter_v1');

const created = repository.createOperation(operation, { now_epoch: 100 });
assert.equal(created.created, true);
assert.equal(created.operation.operation_id, 'operation-1');

const replay = repository.createOperation(operation, { now_epoch: 100 });
assert.equal(replay.created, false);
assert.equal(replay.operation.record_digest, created.operation.record_digest);

assert.throws(
  () => repository.createOperation({ ...operation, operation_id: 'operation-2', idempotency_key: h('3') }, { now_epoch: 100 }),
  (error) => error.code === 'STORAGE_OPERATION_TARGET_BUSY',
);

const transitioned = repository.transitionOperation({
  operation_id: 'operation-1',
  expected_version: 1,
  next_state: 'classified',
  now_epoch: 110,
});
assert.equal(transitioned.state, 'classified');
assert.equal(transitioned.version, 2);
assert.throws(
  () => repository.transitionOperation({ operation_id: 'operation-1', expected_version: 1, next_state: 'planned', now_epoch: 120 }),
  (error) => error.code === 'STORAGE_OPERATION_VERSION_CONFLICT',
);

const plan = {
  plan_id: 'plan-1',
  operation_id: 'operation-1',
  target_id: 'target-1',
  plan_hash: h('4'),
  candidate_set_hash: h('5'),
  impact_set_hash: h('6'),
  authority_context_hash: h('1'),
  ownership_revision: 'ownership-r1',
  policy_revision: 'policy-r1',
  source_snapshot_id: 'snapshot-1',
  item_count: 1,
  total_bytes: 1024,
  expires_at_epoch: 1000,
  status: 'planned',
  consumed: false,
  immutable_envelope_digest: h('4'),
  secrets_included: false,
};
const persistedPlan = repository.persistImmutablePlan(plan);
assert.equal(persistedPlan.created, true);
assert.equal(repository.persistImmutablePlan(plan).created, false);
assert.throws(
  () => repository.persistImmutablePlan({ ...plan, immutable_envelope_digest: h('7') }),
  (error) => error.code === 'STORAGE_PLAN_IMMUTABILITY_VIOLATION',
);

const approval = {
  approval_id: 'approval-1',
  plan_id: 'plan-1',
  slot: 'workspace_owner:workspace-1',
  workspace_id: 'workspace-1',
  approver_principal_id: 'principal-1',
  approver_authority_ref: 'authority/workspace-owner-1',
  decision: 'approved',
  plan_hash: h('4'),
  candidate_set_hash: h('5'),
  impact_set_hash: h('6'),
  authority_context_hash: h('1'),
  ownership_revision: 'ownership-r1',
  policy_revision: 'policy-r1',
  evidence_digest: h('8'),
  decided_at_epoch: 130,
  expires_at_epoch: 900,
  invalidated: false,
  secrets_included: false,
};
assert.equal(repository.appendApproval(approval).created, true);
assert.equal(repository.appendApproval(approval).created, false);
const replacementApproval = {
  ...approval,
  approval_id: 'approval-2',
  evidence_digest: h('9'),
  decided_at_epoch: 140,
  supersedes_approval_id: 'approval-1',
};
assert.equal(repository.appendApproval(replacementApproval).created, true);
let aggregate = repository.readAggregate('operation-1');
assert.equal(aggregate.approvals.length, 2);
assert.equal(aggregate.approvals.find((row) => row.approval_id === 'approval-1').invalidated, true);

const lease = repository.acquireLease({
  lease_id: 'lease-1',
  target_id: 'target-1',
  operation_id: 'operation-1',
  purpose: 'cleanup_apply',
  holder_ref: 'worker/session-1',
  expires_at_epoch: 500,
  evidence_digest: h('a'),
}, { expected_generation: 0, now_epoch: 150 });
assert.equal(lease.generation, 1);
assert.equal(lease.status, 'active');
assert.throws(
  () => repository.acquireLease({
    lease_id: 'lease-2', target_id: 'target-1', operation_id: 'operation-2', purpose: 'cleanup_apply',
    holder_ref: 'worker/session-2', expires_at_epoch: 500, evidence_digest: h('b'),
  }, { expected_generation: 1, now_epoch: 160 }),
  (error) => error.code === 'STORAGE_LEASE_TARGET_BUSY',
);
const renewed = repository.renewLease({
  target_id: 'target-1', lease_id: 'lease-1', operation_id: 'operation-1', holder_ref: 'worker/session-1',
  expected_generation: 1, expires_at_epoch: 600, evidence_digest: h('c'), now_epoch: 200,
});
assert.equal(renewed.generation, 2);
assert.equal(renewed.expires_at_epoch, 600);
assert.throws(
  () => repository.renewLease({
    target_id: 'target-1', lease_id: 'lease-1', operation_id: 'operation-1', holder_ref: 'worker/session-1',
    expected_generation: 1, expires_at_epoch: 700, evidence_digest: h('d'), now_epoch: 210,
  }),
  (error) => error.code === 'STORAGE_LEASE_GENERATION_CONFLICT',
);

const baseJournal = {
  operation_id: 'operation-1',
  run_id: 'run-1',
  plan_id: 'plan-1',
  item_id: 'item-1',
  stat_digest: h('e'),
  secrets_included: false,
};
const prepared = repository.appendJournalEvent({
  ...baseJournal,
  event_id: 'event-1',
  sequence: 1,
  phase: 'prepared',
  result: 'prepared',
  evidence_digest: h('f'),
  observed_at_epoch: 220,
});
assert.equal(prepared.created, true);
assert.equal(repository.appendJournalEvent({
  ...baseJournal,
  event_id: 'event-1', sequence: 1, phase: 'prepared', result: 'prepared', evidence_digest: h('f'), observed_at_epoch: 220,
}).created, false);
assert.throws(
  () => repository.appendJournalEvent({
    ...baseJournal,
    event_id: 'event-3', sequence: 3, phase: 'result', result: 'deleted', evidence_digest: h('1'), observed_at_epoch: 230,
  }),
  (error) => error.code === 'STORAGE_JOURNAL_SEQUENCE_CONFLICT',
);
repository.appendJournalEvent({
  ...baseJournal,
  event_id: 'event-2', sequence: 2, phase: 'result', result: 'deleted', evidence_digest: h('1'), observed_at_epoch: 230,
});

const snapshot = repository.exportSnapshot();
assert.equal(snapshot.production_ready, false);
assert.match(snapshot.state_digest, /^[0-9a-f]{64}$/);
const restarted = createHostingerStorageControlPlaneRepository({
  adapter: createMemoryHostingerStoragePersistenceAdapter({ snapshot }),
});
restarted.appendJournalEvent({
  ...baseJournal,
  event_id: 'event-3', sequence: 3, phase: 'readback', result: 'missing_after_delete', evidence_digest: h('2'), observed_at_epoch: 240,
});
const afterRestart = restarted.readAggregate('operation-1');
assert.equal(afterRestart.journals.length, 3);
assert.deepEqual(afterRestart.journals.map((row) => row.sequence), [1, 2, 3]);

const consumed = restarted.consumePlan({ plan_id: 'plan-1', expected_plan_hash: h('4'), run_id: 'run-1', consumed_at_epoch: 250 });
assert.equal(consumed.consumed, true);
const consumedReplay = restarted.consumePlan({ plan_id: 'plan-1', expected_plan_hash: h('4'), run_id: 'run-1', consumed_at_epoch: 251 });
assert.equal(consumedReplay.consumed, false);
assert.equal(consumedReplay.replay, true);
assert.throws(
  () => restarted.consumePlan({ plan_id: 'plan-1', expected_plan_hash: h('4'), run_id: 'run-2', consumed_at_epoch: 252 }),
  (error) => error.code === 'STORAGE_PLAN_ALREADY_CONSUMED',
);

const reconciliation = restarted.recordReconciliation({
  reconciliation_id: 'reconciliation-1',
  operation_id: 'operation-1',
  run_id: 'run-1',
  outcome: 'applied',
  input_evidence_hash: h('3'),
  result_digest: h('4'),
  retry_allowed: false,
  reviewed_at_epoch: 260,
});
assert.equal(reconciliation.created, true);
assert.equal(restarted.recordReconciliation({
  reconciliation_id: 'reconciliation-1', operation_id: 'operation-1', run_id: 'run-1', outcome: 'applied',
  input_evidence_hash: h('3'), result_digest: h('4'), retry_allowed: false, reviewed_at_epoch: 260,
}).created, false);
assert.throws(
  () => restarted.recordReconciliation({
    reconciliation_id: 'reconciliation-2', operation_id: 'operation-1', run_id: 'run-1', outcome: 'partially_applied',
    input_evidence_hash: h('3'), result_digest: h('4'), retry_allowed: true, reviewed_at_epoch: 260,
  }),
  (error) => error.code === 'STORAGE_RECONCILIATION_RETRY_FORBIDDEN',
);

const released = restarted.releaseLease({
  target_id: 'target-1', lease_id: 'lease-1', operation_id: 'operation-1', holder_ref: 'worker/session-1',
  expected_generation: 2, evidence_digest: h('5'), now_epoch: 270,
});
assert.equal(released.status, 'released');
assert.equal(released.generation, 3);

aggregate = restarted.readAggregate('operation-1');
assert.equal(aggregate.plans[0].consumed, true);
assert.equal(aggregate.leases[0].status, 'released');
assert.equal(aggregate.reconciliations.length, 1);
assert.match(aggregate.aggregate_digest, /^[0-9a-f]{64}$/);

const invalidated = restarted.invalidateApprovals({ plan_id: 'plan-1', expected_plan_hash: h('4'), reason: 'ownership-revision-changed' });
assert.equal(invalidated.invalidated_count, 1);
assert.equal(restarted.readAggregate('operation-1').approvals.every((row) => row.invalidated), true);

const finalSnapshot = restarted.exportSnapshot();
const tampered = structuredClone(finalSnapshot);
tampered.state.operations['operation-1'].state = 'completed';
assert.throws(
  () => createMemoryHostingerStoragePersistenceAdapter({ snapshot: tampered }),
  (error) => error.code === 'STORAGE_REPOSITORY_SNAPSHOT_TAMPERED',
);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_control_plane_repository',
  operation_idempotency: true,
  immutable_plan: true,
  append_only_approvals: true,
  cas_lease_generation: true,
  restart_safe_journal: true,
  single_use_plan: true,
  unknown_outcome_retry_guard: true,
  production_ready: false,
  secrets_included: false,
}));
