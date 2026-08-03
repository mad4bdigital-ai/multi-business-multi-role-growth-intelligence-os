#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createMySqlHostingerStorageSqlParentWriter,
  deriveHostingerStoragePlanItemId,
  isCanonicalMySqlHostingerStorageSqlParentWriter,
} from './hostingerStorageSqlParentWriter.js';

const h = (character) => character.repeat(64);
const clone = (value) => structuredClone(value);

class FakeParentDatabase {
  constructor() {
    this.tables = {
      plans: new Map(),
      planItems: new Map(),
      operations: new Map(),
      leases: new Map(),
      snapshots: new Map(),
      runs: new Map(),
    };
    this.commits = 0;
    this.rollbacks = 0;
    this.lockAcquisitions = 0;
    this.lockReleases = 0;
    this.forceNextCheckpointMiss = false;
    this.duplicateRunReadback = false;
  }
}

class FakeParentConnection {
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
    if (sql.includes('spec014:parent:lock:acquire')) {
      this.database.lockAcquisitions += 1;
      return [[{ acquired: 1 }], []];
    }
    if (sql.includes('spec014:parent:lock:release')) {
      this.database.lockReleases += 1;
      return [[{ released: 1 }], []];
    }
    if (sql.includes('spec014:parent:load-plan-items') || sql.includes('spec014:parent:readback-plan-items')) {
      const planId = params[0];
      return [[...this.table('planItems').values()]
        .filter((row) => row.plan_id === planId)
        .sort((left, right) => left.ordinal - right.ordinal)
        .map(clone), []];
    }
    if (sql.includes('spec014:parent:load-plan')) {
      const row = this.table('plans').get(params[0]);
      return [row ? [clone(row)] : [], []];
    }
    if (sql.includes('spec014:parent:insert-plan-item')) {
      const row = {
        id: params[0],
        plan_id: params[1],
        ordinal: Number(params[2]),
        category: params[3],
        path_ref: params[4],
        tenant_safe_relative_path: params[5],
        size_bytes: String(params[6]),
        device_id_digest: params[7],
        inode_value: params[8],
        ctime_ns: params[9],
        mtime_ns: params[10],
        expected_file_type: params[11],
        eligibility_rule_key: params[12],
        eligibility_evidence_digest: params[13],
        ownership_evidence_ref: params[14],
        protected_classification: 0,
        item_hash: params[15],
        planned_result_state: params[16],
      };
      if (this.table('planItems').has(row.id)
        || [...this.table('planItems').values()].some((existing) => existing.plan_id === row.plan_id
          && (existing.ordinal === row.ordinal || existing.item_hash === row.item_hash))) {
        const error = new Error('duplicate plan item');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      this.table('planItems').set(row.id, row);
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('spec014:parent:load-run-generation')) {
      const operationId = params[0];
      const rows = [...this.table('runs').values()]
        .filter((row) => row.operation_id === operationId)
        .sort((left, right) => right.run_generation - left.run_generation || right.id.localeCompare(left.id));
      return [rows.length ? [{ id: rows[0].id, run_generation: rows[0].run_generation }] : [], []];
    }
    if (sql.includes('spec014:parent:load-run')) {
      const row = this.table('runs').get(params[0]);
      if (!row) return [[], []];
      const candidates = this.database.duplicateRunReadback
        ? [clone(row), clone(row)]
        : [clone(row)];
      return [candidates, []];
    }
    if (sql.includes('spec014:parent:insert-run')) {
      const row = {
        id: params[0],
        operation_id: params[1],
        plan_id: params[2],
        run_generation: Number(params[3]),
        adapter_key: params[4],
        adapter_version: params[5],
        worker_ref: params[6],
        connector_ref: params[7],
        dispatch_certification_ref: params[8],
        host_key_evidence_ref: params[9],
        started_at_epoch: Number(params[10]),
        finished_at_epoch: null,
        state: params[11],
        deleted_count: 0,
        deleted_bytes: '0',
        skipped_count: 0,
        missing_count: 0,
        failed_count: 0,
        journal_digest: params[12],
        checkpoint_digest: params[13],
        before_snapshot_id: params[14],
        after_snapshot_id: null,
        provider_response_classification: params[15],
        unknown_outcome: 0,
        readback_status: 'pending',
        result_digest: null,
        secrets_included: 0,
      };
      if (this.table('runs').has(row.id)
        || [...this.table('runs').values()].some((existing) => existing.operation_id === row.operation_id && existing.run_generation === row.run_generation)) {
        const error = new Error('duplicate run');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      this.table('runs').set(row.id, row);
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('spec014:parent:update-run')) {
      const runId = params[14];
      const expectedCheckpoint = params[15];
      const current = this.table('runs').get(runId);
      if (this.database.forceNextCheckpointMiss) {
        this.database.forceNextCheckpointMiss = false;
        return [{ affectedRows: 0 }, []];
      }
      if (!current || current.checkpoint_digest !== expectedCheckpoint) return [{ affectedRows: 0 }, []];
      this.table('runs').set(runId, {
        ...current,
        finished_at_epoch: Number(params[0]),
        state: params[1],
        deleted_count: Number(params[2]),
        deleted_bytes: String(params[3]),
        skipped_count: Number(params[4]),
        missing_count: Number(params[5]),
        failed_count: Number(params[6]),
        journal_digest: params[7],
        checkpoint_digest: params[8],
        after_snapshot_id: params[9],
        provider_response_classification: params[10],
        unknown_outcome: Number(params[11]),
        readback_status: params[12],
        result_digest: params[13],
      });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.includes('spec014:parent:load-operation')) {
      const row = this.table('operations').get(params[0]);
      return [row ? [clone(row)] : [], []];
    }
    if (sql.includes('spec014:parent:load-lease')) {
      const row = this.table('leases').get(params[0]);
      return [row ? [clone(row)] : [], []];
    }
    if (sql.includes('spec014:parent:load-snapshot')) {
      const row = this.table('snapshots').get(params[0]);
      return [row ? [clone(row)] : [], []];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

class FakeParentPool {
  constructor(database) { this.database = database; }
  async getConnection() { return new FakeParentConnection(this.database); }
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
    source_commit: 'b85d325f6503053b3795150efb9624d2989d274b',
    deployed_runtime_sha: 'b85d325f6503053b3795150efb9624d2989d274b',
    runtime_parity: true,
    readback_cycle_id: 'schema-readback-cycle-parent-writer',
    readback_digest: h('a'),
    migration_evidence_digest: h('b'),
    database_fingerprint: h('c'),
    verified_at: '2026-08-02T00:00:00.000Z',
    expires_at: '2099-08-02T00:15:00.000Z',
    secrets_included: false,
  },
  secrets_included: false,
};

assert.throws(
  () => createMySqlHostingerStorageSqlParentWriter({
    pool: new FakeParentPool(new FakeParentDatabase()),
    schema_verification: { ...schemaVerification, ready: false },
  }),
  (error) => error.code === 'STORAGE_SQL_PARENT_SCHEMA_VERIFICATION_REQUIRED',
);

const database = new FakeParentDatabase();
database.tables.plans.set('plan-1', {
  id: 'plan-1',
  operation_id: 'operation-1',
  target_id: 'target-1',
  plan_hash: h('1'),
  item_count: 2,
  total_bytes: '300',
  consumed: 0,
  consumed_run_id: null,
  record_json: JSON.stringify({
    plan_id: 'plan-1', operation_id: 'operation-1', target_id: 'target-1', plan_hash: h('1'),
    item_count: 2, total_bytes: 300, consumed: false, consumed_run_id: null,
  }),
});
database.tables.operations.set('operation-1', { id: 'operation-1', target_id: 'target-1', state: 'executing' });
database.tables.leases.set('target-1', {
  target_id: 'target-1', lease_id: 'lease-1', operation_id: 'operation-1', generation: 3,
  status: 'active', expires_at_epoch: 5000,
});
database.tables.snapshots.set('snapshot-before', { id: 'snapshot-before' });
database.tables.snapshots.set('snapshot-after', { id: 'snapshot-after' });

const writer = createMySqlHostingerStorageSqlParentWriter({
  pool: new FakeParentPool(database),
  schema_verification: schemaVerification,
});
assert.equal(isCanonicalMySqlHostingerStorageSqlParentWriter(writer), true);
assert.equal(writer.schema_verified, true);
assert.equal(writer.production_ready, false);
assert.equal(writer.runtime_mounted, false);
assert.equal(writer.provider_dispatch_allowed, false);
assert.equal(writer.migration_apply_authorized, false);
assert.equal(writer.database_fingerprint, h('c'));

const items = [
  {
    item_id: 'runtime-item-a', ordinal: 1, category: 'cache', path_ref: 'cache/a.tmp',
    tenant_safe_relative_path: 'cache/a.tmp', size_bytes: 100, expected_file_type: 'file',
    eligibility_rule_key: 'cache-expired-v1', eligibility_evidence_digest: h('2'),
    ownership_evidence_ref: 'ownership/item-a', protected_classification: false,
    item_hash: h('3'), inode_value: 11, ctime_ns: '1700000000000000000', mtime_ns: '1700000001000000000',
    planned_result_state: 'pending', secrets_included: false,
  },
  {
    item_id: 'runtime-item-b', ordinal: 2, category: 'cache', path_ref: 'cache/b.tmp',
    tenant_safe_relative_path: 'cache/b.tmp', size_bytes: 200, expected_file_type: 'file',
    eligibility_rule_key: 'cache-expired-v1', eligibility_evidence_digest: h('4'),
    ownership_evidence_ref: 'ownership/item-b', protected_classification: false,
    item_hash: h('5'), inode_value: 12, planned_result_state: 'pending', secrets_included: false,
  },
];

const itemAParentId = deriveHostingerStoragePlanItemId({ plan_id: 'plan-1', item_id: 'runtime-item-a', item_hash: h('3') });
assert.match(itemAParentId, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/u);

const registered = await writer.registerPlanItems({ plan_id: 'plan-1', expected_plan_hash: h('1'), items });
assert.equal(registered.created, true);
assert.equal(registered.replay, false);
assert.equal(registered.item_count, 2);
assert.equal(registered.total_bytes, '300');
assert.equal(registered.mapping[0].plan_item_id, itemAParentId);
assert.match(registered.item_set_digest, /^[0-9a-f]{64}$/u);
assert.equal(database.tables.planItems.size, 2);

const replayed = await writer.registerPlanItems({ plan_id: 'plan-1', expected_plan_hash: h('1'), items });
assert.equal(replayed.created, false);
assert.equal(replayed.replay, true);
assert.equal(replayed.item_set_digest, registered.item_set_digest);

await assert.rejects(
  writer.registerPlanItems({
    plan_id: 'plan-1', expected_plan_hash: h('1'),
    items: items.map((item, index) => index === 1 ? { ...item, eligibility_evidence_digest: h('6') } : item),
  }),
  (error) => error.code === 'STORAGE_SQL_PARENT_PLAN_ITEM_REPLAY_MISMATCH',
);
await assert.rejects(
  writer.registerPlanItems({
    plan_id: 'plan-1', expected_plan_hash: h('1'),
    items: items.map((item, index) => index === 0 ? { ...item, protected_classification: true } : item),
  }),
  (error) => error.code === 'STORAGE_SQL_PARENT_PROTECTED_ITEM_FORBIDDEN',
);
await assert.rejects(
  writer.registerPlanItems({
    plan_id: 'plan-1', expected_plan_hash: h('1'),
    items: items.map((item, index) => index === 1 ? { ...item, ordinal: 3 } : item),
  }),
  (error) => error.code === 'STORAGE_SQL_PARENT_PLAN_ITEM_ORDINAL_GAP',
);
await assert.rejects(
  writer.registerPlanItems({
    plan_id: 'plan-1', expected_plan_hash: h('1'),
    items: items.map((item, index) => index === 1 ? { ...item, size_bytes: 201 } : item),
  }),
  (error) => ['STORAGE_SQL_PARENT_PLAN_TOTALS_MISMATCH', 'STORAGE_SQL_PARENT_PLAN_ITEM_REPLAY_MISMATCH'].includes(error.code),
);
await assert.rejects(
  writer.registerPlanItems({
    plan_id: 'plan-1', expected_plan_hash: h('1'),
    items: items.map((item, index) => index === 0 ? { ...item, password: 'forbidden' } : item),
  }),
  (error) => error.code === 'STORAGE_SQL_PARENT_SECRET_OR_UNSAFE_FIELD_REJECTED',
);

const run = {
  run_id: 'run-1', operation_id: 'operation-1', plan_id: 'plan-1', target_id: 'target-1',
  lease_id: 'lease-1', lease_generation: 3, lease_expires_at_epoch: 5000, run_generation: 1,
  adapter_key: 'hostinger_storage_synthetic_adapter_v1', adapter_version: '1.0.0',
  worker_ref: 'worker/synthetic-1', connector_ref: 'connector/synthetic-1',
  dispatch_certification_ref: 'certification/synthetic-1', host_key_evidence_ref: 'host-key/synthetic-1',
  started_at_epoch: 2000, state: 'executing', journal_digest: h('7'), checkpoint_digest: h('8'),
  before_snapshot_id: 'snapshot-before', provider_response_classification: 'synthetic_not_dispatched',
  secrets_included: false,
};

await assert.rejects(
  writer.startRun({ run }),
  (error) => error.code === 'STORAGE_SQL_PARENT_PLAN_CONSUMPTION_REQUIRED',
);
assert.equal(database.tables.runs.size, 0);

database.tables.plans.get('plan-1').consumed = 1;
database.tables.plans.get('plan-1').consumed_run_id = 'run-1';
database.tables.plans.get('plan-1').record_json = JSON.stringify({
  plan_id: 'plan-1', operation_id: 'operation-1', target_id: 'target-1', plan_hash: h('1'),
  item_count: 2, total_bytes: 300, consumed: true, consumed_run_id: 'run-1',
});

const started = await writer.startRun({ run });
assert.equal(started.created, true);
assert.equal(started.replay, false);
assert.equal(started.run.state, 'executing');
assert.equal(started.run.run_generation, 1);
assert.equal(started.plan_item_count, 2);
assert.match(started.run_digest, /^[0-9a-f]{64}$/u);
assert.equal(database.tables.runs.size, 1);

const runReplay = await writer.startRun({ run });
assert.equal(runReplay.created, false);
assert.equal(runReplay.replay, true);
assert.equal(runReplay.run_digest, started.run_digest);

database.duplicateRunReadback = true;
try {
  await assert.rejects(
    writer.startRun({ run }),
    (error) => error.code === 'STORAGE_SQL_PARENT_RUN_AMBIGUOUS'
      && error.details?.candidate_count === 2
      && error.details?.secrets_included === false,
  );
} finally {
  database.duplicateRunReadback = false;
}

await assert.rejects(
  writer.startRun({ run: { ...run, adapter_version: '2.0.0' } }),
  (error) => error.code === 'STORAGE_SQL_PARENT_RUN_REPLAY_MISMATCH',
);

const partial = await writer.finalizeRun({
  run_id: 'run-1', expected_checkpoint_digest: h('8'),
  finalization: {
    state: 'readback_pending', finished_at_epoch: 2100,
    deleted_count: 1, deleted_bytes: 100, skipped_count: 0, missing_count: 0, failed_count: 0,
    journal_digest: h('9'), checkpoint_digest: h('a'), after_snapshot_id: 'snapshot-after',
    provider_response_classification: 'synthetic_readback_pending', unknown_outcome: false,
    readback_status: 'pending', result_digest: null, secrets_included: false,
  },
});
assert.equal(partial.run.state, 'readback_pending');
assert.equal(partial.accounted_items, 1);
assert.equal(partial.plan_item_count, 2);

await assert.rejects(
  writer.finalizeRun({
    run_id: 'run-1', expected_checkpoint_digest: h('a'),
    finalization: {
      state: 'completed', finished_at_epoch: 2200,
      deleted_count: 1, deleted_bytes: 100, skipped_count: 0, missing_count: 0, failed_count: 0,
      journal_digest: h('b'), checkpoint_digest: h('c'), after_snapshot_id: 'snapshot-after',
      provider_response_classification: 'synthetic_complete', unknown_outcome: false,
      readback_status: 'complete', result_digest: h('d'), secrets_included: false,
    },
  }),
  (error) => error.code === 'STORAGE_SQL_PARENT_RUN_ACCOUNTING_MISMATCH',
);
assert.equal(database.tables.runs.get('run-1').state, 'readback_pending');

const completed = await writer.finalizeRun({
  run_id: 'run-1', expected_checkpoint_digest: h('a'),
  finalization: {
    state: 'completed', finished_at_epoch: 2200,
    deleted_count: 1, deleted_bytes: 100, skipped_count: 1, missing_count: 0, failed_count: 0,
    journal_digest: h('b'), checkpoint_digest: h('c'), after_snapshot_id: 'snapshot-after',
    provider_response_classification: 'synthetic_complete', unknown_outcome: false,
    readback_status: 'complete', result_digest: h('d'), secrets_included: false,
  },
});
assert.equal(completed.run.state, 'completed');
assert.equal(completed.run.result_digest, h('d'));
assert.equal(completed.accounted_items, 2);

await assert.rejects(
  writer.finalizeRun({
    run_id: 'run-1', expected_checkpoint_digest: h('a'),
    finalization: {
      state: 'failed', finished_at_epoch: 2300, deleted_count: 1, deleted_bytes: 100,
      skipped_count: 1, missing_count: 0, failed_count: 0, journal_digest: h('b'), checkpoint_digest: h('f'),
      after_snapshot_id: 'snapshot-after', provider_response_classification: 'synthetic_failed',
      unknown_outcome: false, readback_status: 'failed', result_digest: h('f'), secrets_included: false,
    },
  }),
  (error) => error.code === 'STORAGE_SQL_PARENT_RUN_CHECKPOINT_CONFLICT',
);

database.forceNextCheckpointMiss = true;
database.tables.runs.get('run-1').state = 'readback_pending';
database.tables.runs.get('run-1').checkpoint_digest = h('c');
await assert.rejects(
  writer.finalizeRun({
    run_id: 'run-1', expected_checkpoint_digest: h('c'),
    finalization: {
      state: 'completed', finished_at_epoch: 2400, deleted_count: 1, deleted_bytes: 100,
      skipped_count: 1, missing_count: 0, failed_count: 0, journal_digest: h('b'), checkpoint_digest: h('f'),
      after_snapshot_id: 'snapshot-after', provider_response_classification: 'synthetic_complete',
      unknown_outcome: false, readback_status: 'complete', result_digest: h('f'), secrets_included: false,
    },
  }),
  (error) => error.code === 'STORAGE_SQL_PARENT_RUN_CHECKPOINT_CONFLICT',
);
assert.equal(database.rollbacks > 0, true);
assert.equal(database.commits >= 5, true);
assert.equal(database.lockAcquisitions, database.lockReleases);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_sql_parent_writer',
  deterministic_plan_item_parent_ids: true,
  append_only_plan_items: true,
  same_set_replay: true,
  plan_totals_bound: true,
  plan_consumption_bound: true,
  active_lease_bound: true,
  monotonic_run_generation: true,
  checkpoint_compare_and_swap: true,
  terminal_accounting_complete: true,
  same_transaction_readback: true,
  rollback_on_conflict: true,
  deferred_foreign_keys_enabled: false,
  live_database_access_performed: false,
  migration_apply_performed: false,
  provider_dispatch_performed: false,
  runtime_mounted: false,
  production_ready: false,
  secrets_included: false,
}, null, 2));
