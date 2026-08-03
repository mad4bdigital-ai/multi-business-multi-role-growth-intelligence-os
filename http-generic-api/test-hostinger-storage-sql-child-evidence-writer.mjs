#!/usr/bin/env node
import assert from 'node:assert/strict';
import { deriveHostingerStoragePlanItemId } from './hostingerStorageSqlParentWriter.js';
import {
  createHostingerStorageSqlChildEvidenceWriter,
  isCanonicalHostingerStorageSqlChildEvidenceWriter,
} from './hostingerStorageSqlChildEvidenceWriter.js';

const h = (character) => character.repeat(64);
const copyMap = (value) => new Map([...value].map(([key, row]) => [key, structuredClone(row)]));

function verified(overrides = {}) {
  return {
    ready: true,
    schema_verified: true,
    production_ready: false,
    authority_granted: false,
    migration_apply_authorized: false,
    provider_dispatch_allowed: false,
    blockers: [],
    evidence_digest: h('a'),
    evidence: {
      source_commit: h('1'),
      deployed_runtime_sha: h('1'),
      runtime_parity: true,
      database_fingerprint: h('2'),
      readback_cycle_id: 'readback-cycle-1',
      expires_at: '2099-01-01T00:00:00.000Z',
    },
    secrets_included: false,
    ...overrides,
  };
}

class Database {
  constructor() {
    this.runs = new Map();
    this.items = new Map();
    this.journals = new Map();
    this.reconciliations = new Map();
    this.commits = 0;
    this.rollbacks = 0;
    this.locks = 0;
    this.releases = 0;
  }
}

class Connection {
  constructor(database) {
    this.database = database;
    this.working = null;
  }
  async beginTransaction() {
    this.working = {
      runs: copyMap(this.database.runs),
      items: copyMap(this.database.items),
      journals: copyMap(this.database.journals),
      reconciliations: copyMap(this.database.reconciliations),
    };
  }
  async commit() {
    this.database.runs = this.working.runs;
    this.database.items = this.working.items;
    this.database.journals = this.working.journals;
    this.database.reconciliations = this.working.reconciliations;
    this.working = null;
    this.database.commits += 1;
  }
  async rollback() {
    this.working = null;
    this.database.rollbacks += 1;
  }
  release() {}
  table(name) { return (this.working || this.database)[name]; }
  async execute(statement, params = []) {
    if (statement.includes('spec014:child:lock:acquire')) {
      this.database.locks += 1;
      return [[{ acquired: 1 }], []];
    }
    if (statement.includes('spec014:child:lock:release')) {
      this.database.releases += 1;
      return [[{ released: 1 }], []];
    }
    if (statement.includes('spec014:child:load:run')) {
      const row = this.table('runs').get(params[0]);
      return [[...(row ? [structuredClone(row)] : [])], []];
    }
    if (statement.includes('spec014:child:load:plan-item')) {
      const row = this.table('items').get(params[0]);
      return [[...(row && row.plan_id === params[1] ? [structuredClone(row)] : [])], []];
    }
    if (statement.includes('spec014:child:load:journals')) {
      const rows = [...this.table('journals').values()]
        .filter((row) => row.run_id === params[0])
        .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
      return [rows.map((row) => structuredClone(row)), []];
    }
    if (statement.includes('spec014:child:insert:journal')) {
      const row = JSON.parse(params.at(-1));
      const table = this.table('journals');
      if (table.has(row.id)) {
        const error = new Error('duplicate');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      table.set(row.id, {
        id: row.id,
        run_id: row.run_id,
        plan_item_id: row.plan_item_id,
        sequence: row.sequence,
        phase: row.phase,
        record_digest: row.record_digest,
        record_json: JSON.stringify(row),
        row_version: 1,
      });
      return [{ affectedRows: 1 }, []];
    }
    if (statement.includes('spec014:child:readback:journal')) {
      const row = this.table('journals').get(params[0]);
      return [[...(row ? [structuredClone(row)] : [])], []];
    }
    if (statement.includes('spec014:child:load:reconciliation')) {
      const row = this.table('reconciliations').get(params[0]);
      return [[...(row ? [structuredClone(row)] : [])], []];
    }
    if (statement.includes('spec014:child:count:plan-items')) {
      return [[{
        item_count: [...this.table('items').values()].filter((row) => row.plan_id === params[0]).length,
      }], []];
    }
    if (statement.includes('spec014:child:insert:reconciliation')) {
      const row = JSON.parse(params.at(-1));
      const table = this.table('reconciliations');
      if (table.has(row.id)) {
        const error = new Error('duplicate');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      table.set(row.id, {
        id: row.id,
        record_digest: row.record_digest,
        record_json: JSON.stringify(row),
        row_version: 1,
      });
      return [{ affectedRows: 1 }, []];
    }
    if (statement.includes('spec014:child:readback:reconciliation')) {
      const row = this.table('reconciliations').get(params[0]);
      return [[...(row ? [structuredClone(row)] : [])], []];
    }
    throw new Error(`Unexpected SQL: ${statement}`);
  }
}

class Pool {
  constructor(database) { this.database = database; }
  async getConnection() { return new Connection(this.database); }
}

const database = new Database();
const itemHash = h('3');
const parentId = deriveHostingerStoragePlanItemId({ plan_id: 'plan-1', item_id: 'item-1', item_hash: itemHash });
database.runs.set('run-1', {
  id: 'run-1', operation_id: 'operation-1', plan_id: 'plan-1', state: 'reconciling',
});
database.items.set(parentId, { id: parentId, plan_id: 'plan-1', item_hash: itemHash });

const writer = createHostingerStorageSqlChildEvidenceWriter({
  pool: new Pool(database),
  schema_verification: verified(),
});
assert.equal(isCanonicalHostingerStorageSqlChildEvidenceWriter(writer), true);
assert.equal(writer.production_ready, false);
assert.equal(writer.runtime_mounted, false);
assert.equal(writer.foreign_keys_enabled, false);
assert.equal(writer.provider_dispatch_allowed, false);

const common = {
  operation_id: 'operation-1',
  run_id: 'run-1',
  plan_id: 'plan-1',
  item_id: 'item-1',
  item_hash: itemHash,
  secrets_included: false,
};
const prepared = {
  ...common,
  event_id: 'event-prepared-1',
  sequence: 1,
  phase: 'prepared',
  result: 'prepared',
  prepared_at_epoch: 1000,
  observed_stat_digest: h('4'),
  checkpoint_at_epoch: 1000,
};
const preparedWrite = await writer.appendJournalEvent(prepared);
assert.equal(preparedWrite.created, true);
assert.equal(preparedWrite.journal.plan_item_id, parentId);
assert.equal((await writer.appendJournalEvent(prepared)).replay, true);

await assert.rejects(writer.appendJournalEvent({
  ...common,
  event_id: 'sequence-gap',
  sequence: 3,
  phase: 'result',
  result: 'deleted',
  result_evidence_digest: h('5'),
}), (error) => error.code === 'STORAGE_SQL_CHILD_JOURNAL_SEQUENCE_CONFLICT');

assert.equal((await writer.appendJournalEvent({
  ...common,
  event_id: 'event-result-1',
  sequence: 2,
  phase: 'result',
  result: 'deleted',
  result_evidence_digest: h('5'),
  checkpoint_at_epoch: 1010,
})).created, true);
assert.equal((await writer.appendJournalEvent({
  ...common,
  event_id: 'event-readback-1',
  sequence: 3,
  phase: 'readback',
  result: 'deleted',
  result_evidence_digest: h('6'),
  checkpoint_at_epoch: 1020,
  readback_state: 'absent',
})).created, true);

await assert.rejects(writer.appendJournalEvent({
  ...prepared,
  run_id: 'missing-run',
  event_id: 'missing-run-event',
}), (error) => error.code === 'STORAGE_SQL_CHILD_RUN_PARENT_REQUIRED');
await assert.rejects(writer.appendJournalEvent({
  ...prepared,
  item_hash: h('7'),
  event_id: 'wrong-parent',
  sequence: 4,
}), (error) => error.code === 'STORAGE_SQL_CHILD_PLAN_ITEM_PARENT_REQUIRED');

const reconciliation = {
  reconciliation_id: 'reconciliation-1',
  operation_id: 'operation-1',
  run_id: 'run-1',
  input_evidence_hashes: { journal: h('8'), filesystem: h('9') },
  item_accounting: { total: 1, prepared: 1, result: 1, readback: 1, conflict: 0 },
  outcome: 'applied',
  retry_permission: false,
  reviewed_at_epoch: 1030,
  evidence_digest: h('a'),
  secrets_included: false,
};
assert.equal((await writer.appendReconciliation(reconciliation)).created, true);
assert.equal((await writer.appendReconciliation(reconciliation)).replay, true);
await assert.rejects(writer.appendReconciliation({
  ...reconciliation,
  reconciliation_id: 'reconciliation-2',
  item_accounting: { total: 1, prepared: 1, result: 1, readback: 0, conflict: 0 },
}), (error) => error.code === 'STORAGE_SQL_CHILD_RECONCILIATION_ACCOUNTING_MISMATCH');

const legacyRunId = 'run-legacy';
const legacyHash = h('b');
const legacyParentId = deriveHostingerStoragePlanItemId({ plan_id: 'plan-legacy', item_id: 'legacy-item', item_hash: legacyHash });
database.runs.set(legacyRunId, {
  id: legacyRunId, operation_id: 'operation-legacy', plan_id: 'plan-legacy', state: 'executing',
});
database.items.set(legacyParentId, { id: legacyParentId, plan_id: 'plan-legacy', item_hash: legacyHash });
database.journals.set('legacy-row', {
  id: 'legacy-row', run_id: legacyRunId, plan_item_id: null, sequence: 1, phase: 'prepared',
  record_digest: h('c'), record_json: '{}', row_version: 1,
});
await assert.rejects(writer.appendJournalEvent({
  operation_id: 'operation-legacy', run_id: legacyRunId, plan_id: 'plan-legacy',
  item_id: 'legacy-item', item_hash: legacyHash, event_id: 'legacy-result', sequence: 2,
  phase: 'result', result: 'deleted', result_evidence_digest: h('d'), secrets_included: false,
}), (error) => error.code === 'STORAGE_SQL_CHILD_LEGACY_UNBOUND_ROW_BLOCKS_APPEND');

assert.throws(() => createHostingerStorageSqlChildEvidenceWriter({
  pool: new Pool(database),
  schema_verification: verified({ provider_dispatch_allowed: true }),
}), (error) => error.code === 'STORAGE_SQL_CHILD_SCHEMA_VERIFICATION_BOUNDARY_INVALID');
assert.throws(() => createHostingerStorageSqlChildEvidenceWriter({
  pool: new Pool(database),
  schema_verification: { ...verified(), private_key: 'forbidden' },
}), (error) => error.code === 'STORAGE_SQL_CHILD_SECRET_OR_UNSAFE_FIELD_REJECTED');

assert.equal(database.rollbacks >= 4, true);
assert.equal(database.locks, database.releases);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_sql_child_evidence_writer',
  deterministic_plan_item_parent_binding: true,
  exact_run_parent_binding: true,
  append_only_journal: true,
  journal_phase_ordering: true,
  exact_replay: true,
  reconciliation_accounting_readback: true,
  shared_parent_child_lock: true,
  rollback_on_conflict: true,
  foreign_keys_enabled: false,
  runtime_mounted: false,
  migration_applied: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  secrets_included: false,
}));
