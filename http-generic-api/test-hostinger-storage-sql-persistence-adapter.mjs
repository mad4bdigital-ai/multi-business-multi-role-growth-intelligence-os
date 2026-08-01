#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHostingerStorageControlPlaneRepository } from './hostingerStorageControlPlaneRepositoryBase.js';
import { createMySqlHostingerStoragePersistenceAdapter } from './hostingerStorageSqlPersistenceAdapter.js';

const h = (character) => character.repeat(64);
const clone = (value) => structuredClone(value);

class FakeSqlDatabase {
  constructor() {
    this.tables = {
      operations: new Map(),
      plans: new Map(),
      approvals: new Map(),
      leases: new Map(),
      journals: new Map(),
      reconciliations: new Map(),
    };
    this.forceNextCasMiss = false;
    this.commits = 0;
    this.rollbacks = 0;
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
    if (sql.includes('spec014:lock:acquire')) return [[{ acquired: 1 }], []];
    if (sql.includes('spec014:lock:release')) return [[{ released: 1 }], []];
    for (const name of ['operations', 'plans', 'approvals', 'leases', 'journals', 'reconciliations']) {
      if (sql.includes(`spec014:load:${name}`)) return [[...this.table(name).values()].map(clone), []];
      if (sql.includes(`spec014:insert:${name}`)) return [this.insert(name, params), []];
      if (sql.includes(`spec014:update:${name}`)) return [this.update(name, params), []];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
  insert(name, params) {
    const table = this.table(name);
    let key;
    let row;
    if (name === 'operations') {
      const [id, idempotency_key, target_id, state, version, record_digest, record_json] = params;
      key = id;
      row = { id, idempotency_key, target_id, state, version, record_digest, record_json, row_version: 1 };
    } else if (name === 'plans') {
      const [id, operation_id, target_id, plan_hash, consumed, record_digest, record_json] = params;
      key = id;
      row = { id, operation_id, target_id, plan_hash, consumed, record_digest, record_json, row_version: 1 };
    } else if (name === 'approvals') {
      const [id, plan_id, approval_slot, decision, invalidated, record_digest, record_json] = params;
      key = id;
      row = { id, plan_id, approval_slot, decision, invalidated, record_digest, record_json, row_version: 1 };
    } else if (name === 'leases') {
      const [target_id, lease_id, operation_id, generation, status, expires_at_epoch, record_digest, record_json] = params;
      key = target_id;
      row = { target_id, lease_id, operation_id, generation, status, expires_at_epoch, record_digest, record_json, row_version: 1 };
    } else if (name === 'journals') {
      const [id, operation_id, run_id, plan_id, item_id, sequence, phase, result, record_digest, record_json] = params;
      key = id;
      row = { id, operation_id, run_id, plan_id, item_id, sequence, phase, result, record_digest, record_json, row_version: 1 };
    } else {
      const [id, operation_id, run_id, outcome, retry_permission, record_digest, record_json] = params;
      key = id;
      row = { id, operation_id, run_id, outcome, retry_permission, record_digest, record_json, row_version: 1 };
    }
    if (table.has(key)) {
      const error = new Error('duplicate');
      error.code = 'ER_DUP_ENTRY';
      throw error;
    }
    table.set(key, row);
    return { affectedRows: 1 };
  }
  update(name, params) {
    if (this.database.forceNextCasMiss) {
      this.database.forceNextCasMiss = false;
      return { affectedRows: 0 };
    }
    const table = this.table(name);
    let key;
    let expected;
    let patch;
    if (name === 'operations') {
      const [target_id, state, version, record_digest, record_json, id, rowVersion] = params;
      key = id;
      expected = rowVersion;
      patch = { target_id, state, version, record_digest, record_json };
    } else if (name === 'plans') {
      const [consumed, record_digest, record_json, id, rowVersion] = params;
      key = id;
      expected = rowVersion;
      patch = { consumed, record_digest, record_json };
    } else if (name === 'approvals') {
      const [decision, invalidated, record_digest, record_json, id, rowVersion] = params;
      key = id;
      expected = rowVersion;
      patch = { decision, invalidated, record_digest, record_json };
    } else {
      const [lease_id, operation_id, generation, status, expires_at_epoch, record_digest, record_json, target_id, rowVersion] = params;
      key = target_id;
      expected = rowVersion;
      patch = { lease_id, operation_id, generation, status, expires_at_epoch, record_digest, record_json };
    }
    const current = table.get(key);
    if (!current || current.row_version !== expected) return { affectedRows: 0 };
    table.set(key, { ...current, ...patch, row_version: current.row_version + 1 });
    return { affectedRows: 1 };
  }
}

class FakePool {
  constructor(database) { this.database = database; }
  async getConnection() { return new FakeConnection(this.database); }
}

function createRepository(database) {
  const adapter = createMySqlHostingerStoragePersistenceAdapter({
    pool: new FakePool(database),
    schema_verified: true,
  });
  return createHostingerStorageControlPlaneRepository({ adapter });
}

const database = new FakeSqlDatabase();
let repository = createRepository(database);
assert.equal(repository.production_ready, true);
assert.equal(repository.adapter_key, 'hostinger_storage_mysql_control_plane_v1');

const operation = {
  operation_id: 'sql-operation-1',
  operation_key: 'hostinger_storage_apply_plan',
  target_id: 'sql-target-1',
  tenant_id: 'tenant-1',
  workspace_id: 'workspace-1',
  resource_id: 'resource-1',
  context_mode: 'tenant',
  authority_context_hash: h('1'),
  ownership_revision: 'ownership-r1',
  policy_revision: 'policy-r1',
  idempotency_key: h('2'),
  risk_profile: 'tenant_high',
  state: 'approved',
  version: 1,
  created_at_epoch: 1000,
  updated_at_epoch: 1000,
  secrets_included: false,
};
const created = await repository.createOperation(operation, { now_epoch: 1000 });
assert.equal(created.created, true);
const replay = await repository.createOperation(operation, { now_epoch: 1000 });
assert.equal(replay.created, false);

await repository.persistImmutablePlan({
  plan_id: 'sql-plan-1',
  operation_id: operation.operation_id,
  target_id: operation.target_id,
  plan_hash: h('3'),
  candidate_set_hash: h('4'),
  impact_set_hash: h('5'),
  authority_context_hash: h('1'),
  ownership_revision: 'ownership-r1',
  policy_revision: 'policy-r1',
  source_snapshot_id: 'snapshot-1',
  item_count: 1,
  total_bytes: 1024,
  expires_at_epoch: 2000,
  status: 'approved',
  consumed: false,
  immutable_envelope_digest: h('3'),
  secrets_included: false,
});
await repository.appendApproval({
  approval_id: 'sql-approval-1',
  plan_id: 'sql-plan-1',
  slot: 'workspace_owner:workspace-1',
  workspace_id: 'workspace-1',
  approver_principal_id: 'principal-1',
  approver_authority_ref: 'authority/workspace-owner-1',
  decision: 'approved',
  plan_hash: h('3'),
  candidate_set_hash: h('4'),
  impact_set_hash: h('5'),
  authority_context_hash: h('1'),
  ownership_revision: 'ownership-r1',
  policy_revision: 'policy-r1',
  evidence_digest: h('6'),
  decided_at_epoch: 1100,
  expires_at_epoch: 1900,
  invalidated: false,
  secrets_included: false,
});
const lease = await repository.acquireLease({
  lease_id: 'sql-lease-1',
  target_id: operation.target_id,
  operation_id: operation.operation_id,
  purpose: 'cleanup_apply',
  holder_ref: 'worker/session-1',
  expires_at_epoch: 1600,
  evidence_digest: h('7'),
  secrets_included: false,
}, { expected_generation: 0, now_epoch: 1200 });
assert.equal(lease.generation, 1);

await repository.appendJournalEvent({
  event_id: 'sql-event-1',
  operation_id: operation.operation_id,
  run_id: 'sql-run-1',
  plan_id: 'sql-plan-1',
  item_id: 'item-1',
  sequence: 1,
  phase: 'prepared',
  result: 'prepared',
  stat_digest: h('8'),
  evidence_digest: h('9'),
  observed_at_epoch: 1250,
  secrets_included: false,
});
await repository.appendJournalEvent({
  event_id: 'sql-event-2',
  operation_id: operation.operation_id,
  run_id: 'sql-run-1',
  plan_id: 'sql-plan-1',
  item_id: 'item-1',
  sequence: 2,
  phase: 'result',
  result: 'deleted',
  stat_digest: h('8'),
  evidence_digest: h('a'),
  observed_at_epoch: 1260,
  secrets_included: false,
});
await repository.recordReconciliation({
  reconciliation_id: 'sql-reconciliation-1',
  operation_id: operation.operation_id,
  run_id: 'sql-run-1',
  outcome: 'applied',
  input_evidence_hash: h('b'),
  result_digest: h('c'),
  retry_allowed: false,
  reviewed_at_epoch: 1300,
  secrets_included: false,
});

const beforeRestart = await repository.readAggregate(operation.operation_id);
assert.equal(beforeRestart.operation.state, 'approved');
assert.equal(beforeRestart.plans.length, 1);
assert.equal(beforeRestart.approvals.length, 1);
assert.equal(beforeRestart.leases[0].generation, 1);
assert.equal(beforeRestart.journals.length, 2);
assert.equal(beforeRestart.reconciliations.length, 1);
assert(beforeRestart.transaction_version >= 7);

repository = createRepository(database);
const afterRestart = await repository.readAggregate(operation.operation_id);
assert.deepEqual(afterRestart, beforeRestart);

const renewed = await repository.renewLease({
  target_id: operation.target_id,
  lease_id: 'sql-lease-1',
  operation_id: operation.operation_id,
  holder_ref: 'worker/session-1',
  expected_generation: 1,
  expires_at_epoch: 1800,
  evidence_digest: h('d'),
  now_epoch: 1400,
});
assert.equal(renewed.generation, 2);
await assert.rejects(
  repository.renewLease({
    target_id: operation.target_id,
    lease_id: 'sql-lease-1',
    operation_id: operation.operation_id,
    holder_ref: 'worker/session-1',
    expected_generation: 1,
    expires_at_epoch: 1900,
    evidence_digest: h('e'),
    now_epoch: 1450,
  }),
  (error) => error.code === 'STORAGE_LEASE_GENERATION_CONFLICT',
);

database.forceNextCasMiss = true;
await assert.rejects(
  repository.transitionOperation({
    operation_id: operation.operation_id,
    expected_version: 1,
    next_state: 'executing',
    now_epoch: 1500,
  }),
  (error) => error.code === 'STORAGE_SQL_CAS_CONFLICT',
);
const afterCasMiss = await repository.readAggregate(operation.operation_id);
assert.equal(afterCasMiss.operation.version, 1);
assert.equal(database.rollbacks > 0, true);

const transitioned = await repository.transitionOperation({
  operation_id: operation.operation_id,
  expected_version: 1,
  next_state: 'executing',
  now_epoch: 1510,
});
assert.equal(transitioned.version, 2);
const consumed = await repository.consumePlan({
  plan_id: 'sql-plan-1',
  expected_plan_hash: h('3'),
  run_id: 'sql-run-1',
  consumed_at_epoch: 1520,
});
assert.equal(consumed.consumed, true);
const consumedReplay = await repository.consumePlan({
  plan_id: 'sql-plan-1',
  expected_plan_hash: h('3'),
  run_id: 'sql-run-1',
  consumed_at_epoch: 1520,
});
assert.equal(consumedReplay.replay, true);

const snapshot = await repository.exportSnapshot();
assert.equal(snapshot.durable_sql, true);
assert.equal(snapshot.production_ready, true);
assert.equal(snapshot.secrets_included, false);
assert.equal(snapshot.state.operations[operation.operation_id].state, 'executing');

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_sql_persistence_adapter',
  transaction_commit: true,
  rollback_on_cas_conflict: true,
  lease_generation_cas: true,
  immutable_plan_replay: true,
  restart_safe_readback: true,
  journal_restart_safe: true,
  reconciliation_restart_safe: true,
  provider_dispatch_allowed: false,
  migration_applied: false,
  secrets_included: false,
}));
