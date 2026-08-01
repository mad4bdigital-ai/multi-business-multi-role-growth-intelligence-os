#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createHostingerStorageControlPlaneRepository,
  createMySqlHostingerStoragePersistenceAdapter,
  isCanonicalHostingerStorageControlPlaneRepository,
  isCanonicalMySqlHostingerStoragePersistenceAdapter,
} from './hostingerStorageControlPlaneRepository.js';

const h = (character) => character.repeat(64);
const clone = (value) => structuredClone(value);
const TABLE_NAMES = ['operations', 'plans', 'approvals', 'leases', 'journals', 'reconciliations'];

function recordKey(table, record) {
  return {
    operations: record.operation_id,
    plans: record.plan_id,
    approvals: record.approval_id,
    leases: record.target_id,
    journals: record.event_id,
    reconciliations: record.reconciliation_id,
  }[table];
}

function sqlRow(table, record, rowVersion) {
  return {
    id: table === 'leases'
      ? record.lease_id
      : ['operations', 'plans', 'approvals', 'journals', 'reconciliations'].includes(table)
        ? recordKey(table, record)
        : undefined,
    target_id: table === 'leases' ? record.target_id : record.target_id,
    plan_id: table === 'approvals' ? record.plan_id : undefined,
    run_id: table === 'journals' ? record.run_id : undefined,
    idempotency_key: table === 'operations' ? record.idempotency_key : undefined,
    record_digest: record.record_digest,
    record_json: JSON.stringify(record),
    row_version: rowVersion,
  };
}

class FakeSqlDatabase {
  constructor() {
    this.tables = Object.fromEntries(TABLE_NAMES.map((name) => [name, new Map()]));
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
    for (const name of TABLE_NAMES) {
      if (sql.includes(`spec014:load:${name}`)) return [[...this.table(name).values()].map(clone), []];
      if (sql.includes(`spec014:insert:${name}`)) return [this.write(name, params, false), []];
      if (sql.includes(`spec014:update:${name}`)) return [this.write(name, params, true), []];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
  write(tableName, params, update) {
    const json = params.find((value) => typeof value === 'string' && value.startsWith('{'));
    const record = JSON.parse(json);
    const key = recordKey(tableName, record);
    const table = this.table(tableName);
    if (!update) {
      if (table.has(key)) {
        const error = new Error('duplicate');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      table.set(key, sqlRow(tableName, record, 1));
      return { affectedRows: 1 };
    }
    if (this.database.forceNextCasMiss) {
      this.database.forceNextCasMiss = false;
      return { affectedRows: 0 };
    }
    const expectedVersion = Number(params.at(-1));
    const current = table.get(key);
    if (!current || current.row_version !== expectedVersion) return { affectedRows: 0 };
    table.set(key, sqlRow(tableName, record, current.row_version + 1));
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
  assert.equal(adapter.schema_verified, false);
  assert.equal(adapter.production_ready, false);
  assert.equal(isCanonicalMySqlHostingerStoragePersistenceAdapter(adapter), true);
  const repository = createHostingerStorageControlPlaneRepository({ adapter });
  assert.equal(repository.production_ready, false);
  assert.equal(isCanonicalHostingerStorageControlPlaneRepository(repository), true);
  return repository;
}

const database = new FakeSqlDatabase();
let repository = createRepository(database);
const operation = {
  operation_id: 'sql-operation-1', operation_key: 'hostinger_storage_apply_plan', target_id: 'sql-target-1',
  tenant_id: 'tenant-1', workspace_id: 'workspace-1', resource_id: 'resource-1', context_mode: 'tenant',
  authority_context_hash: h('1'), ownership_revision: 'ownership-r1', policy_revision: 'policy-r1',
  idempotency_key: h('2'), risk_profile: 'tenant_high', state: 'approved', version: 1,
  created_at_epoch: 1000, updated_at_epoch: 1000, secrets_included: false,
};
assert.equal((await repository.createOperation(operation, { now_epoch: 1000 })).created, true);
assert.equal((await repository.createOperation(operation, { now_epoch: 1000 })).created, false);

await repository.persistImmutablePlan({
  plan_id: 'sql-plan-1', operation_id: operation.operation_id, target_id: operation.target_id,
  plan_hash: h('3'), candidate_set_hash: h('4'), impact_set_hash: h('5'),
  authority_context_hash: h('1'), ownership_revision: 'ownership-r1', policy_revision: 'policy-r1',
  source_snapshot_id: 'snapshot-1', item_count: 1, total_bytes: 1024, expires_at_epoch: 2000,
  status: 'approved', consumed: false, immutable_envelope_digest: h('3'), secrets_included: false,
});
await repository.appendApproval({
  approval_id: 'sql-approval-1', plan_id: 'sql-plan-1', slot: 'workspace_owner:workspace-1',
  workspace_id: 'workspace-1', approver_principal_id: 'principal-1',
  approver_authority_ref: 'authority/workspace-owner-1', decision: 'approved',
  plan_hash: h('3'), candidate_set_hash: h('4'), impact_set_hash: h('5'),
  authority_context_hash: h('1'), ownership_revision: 'ownership-r1', policy_revision: 'policy-r1',
  evidence_digest: h('6'), decided_at_epoch: 1100, expires_at_epoch: 1900,
  invalidated: false, secrets_included: false,
});
assert.equal((await repository.acquireLease({
  lease_id: 'sql-lease-1', target_id: operation.target_id, operation_id: operation.operation_id,
  purpose: 'cleanup_apply', holder_ref: 'worker/session-1', expires_at_epoch: 1600,
  evidence_digest: h('7'), secrets_included: false,
}, { expected_generation: 0, now_epoch: 1200 })).generation, 1);
assert.equal(database.tables.leases.get(operation.target_id).id, 'sql-lease-1');

for (const event of [
  { event_id: 'sql-event-1', sequence: 1, phase: 'prepared', result: 'prepared', evidence_digest: h('9') },
  { event_id: 'sql-event-2', sequence: 2, phase: 'result', result: 'deleted', evidence_digest: h('a') },
]) {
  await repository.appendJournalEvent({
    ...event, operation_id: operation.operation_id, run_id: 'sql-run-1', plan_id: 'sql-plan-1',
    item_id: 'item-1', stat_digest: h('8'), observed_at_epoch: 1240 + event.sequence * 10,
    secrets_included: false,
  });
}
await repository.recordReconciliation({
  reconciliation_id: 'sql-reconciliation-1', operation_id: operation.operation_id,
  run_id: 'sql-run-1', outcome: 'applied', input_evidence_hash: h('b'), result_digest: h('c'),
  retry_allowed: false, reviewed_at_epoch: 1300, secrets_included: false,
});

const beforeRestart = await repository.readAggregate(operation.operation_id);
assert.deepEqual({
  plans: beforeRestart.plans.length,
  approvals: beforeRestart.approvals.length,
  leases: beforeRestart.leases.length,
  journals: beforeRestart.journals.length,
  reconciliations: beforeRestart.reconciliations.length,
}, { plans: 1, approvals: 1, leases: 1, journals: 2, reconciliations: 1 });
repository = createRepository(database);
assert.deepEqual(await repository.readAggregate(operation.operation_id), beforeRestart);

assert.equal((await repository.renewLease({
  target_id: operation.target_id, lease_id: 'sql-lease-1', operation_id: operation.operation_id,
  holder_ref: 'worker/session-1', expected_generation: 1, expires_at_epoch: 1800,
  evidence_digest: h('d'), now_epoch: 1400,
})).generation, 2);
await assert.rejects(repository.renewLease({
  target_id: operation.target_id, lease_id: 'sql-lease-1', operation_id: operation.operation_id,
  holder_ref: 'worker/session-1', expected_generation: 1, expires_at_epoch: 1900,
  evidence_digest: h('e'), now_epoch: 1450,
}), (error) => error.code === 'STORAGE_LEASE_GENERATION_CONFLICT');

database.forceNextCasMiss = true;
await assert.rejects(repository.transitionOperation({
  operation_id: operation.operation_id, expected_version: 1, next_state: 'executing', now_epoch: 1500,
}), (error) => error.code === 'STORAGE_SQL_CAS_CONFLICT');
assert.equal((await repository.readAggregate(operation.operation_id)).operation.version, 1);
assert.equal(database.rollbacks > 0, true);

assert.equal((await repository.transitionOperation({
  operation_id: operation.operation_id, expected_version: 1, next_state: 'executing', now_epoch: 1510,
})).version, 2);
assert.equal((await repository.consumePlan({
  plan_id: 'sql-plan-1', expected_plan_hash: h('3'), run_id: 'sql-run-1', consumed_at_epoch: 1520,
})).consumed, true);
assert.equal((await repository.consumePlan({
  plan_id: 'sql-plan-1', expected_plan_hash: h('3'), run_id: 'sql-run-1', consumed_at_epoch: 1520,
})).replay, true);

const snapshot = await repository.exportSnapshot();
assert.equal(snapshot.durable_sql, true);
assert.equal(snapshot.production_ready, false);
assert.equal(snapshot.secrets_included, false);
assert.equal(snapshot.state.operations[operation.operation_id].state, 'executing');

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_sql_persistence_adapter',
  canonical_factory_provenance: true,
  caller_schema_claim_ignored: true,
  production_ready: false,
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
