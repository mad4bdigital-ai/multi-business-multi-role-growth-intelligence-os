#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  HOSTINGER_STORAGE_CRASH_SAFE_RESTART_RECONCILER_VERSION,
  createHostingerStorageCrashSafeRestartReconciler,
  isCanonicalHostingerStorageCrashSafeRestartReconciler,
} from './hostingerStorageCrashSafeRestartReconciler.js';

const h = (character) => character.repeat(64);
const clone = (value) => structuredClone(value);

function journal({ item, sequence, phase, result, readbackState = null, evidenceCharacter }) {
  return {
    id: `journal-${sequence}`,
    runtime_event_id: `runtime-event-${sequence}`,
    operation_id: 'operation-1',
    run_id: 'run-1',
    plan_id: 'plan-1',
    item_id: `runtime-${item.ordinal}`,
    plan_item_id: item.id,
    item_hash: item.item_hash,
    sequence,
    phase,
    result,
    result_evidence_digest: evidenceCharacter ? h(evidenceCharacter) : null,
    readback_state: readbackState,
    secrets_included: false,
  };
}

function completeJournals(items, outcomes = ['deleted', 'deleted']) {
  const rows = [];
  let sequence = 0;
  for (const [index, item] of items.entries()) {
    const outcome = outcomes[index];
    rows.push(journal({ item, sequence: ++sequence, phase: 'prepared', result: 'prepared', evidenceCharacter: null }));
    rows.push(journal({ item, sequence: ++sequence, phase: 'result', result: outcome, evidenceCharacter: index === 0 ? '1' : '2' }));
    rows.push(journal({ item, sequence: ++sequence, phase: 'readback', result: outcome, readbackState: outcome, evidenceCharacter: index === 0 ? '3' : '4' }));
  }
  return rows;
}

function makeComposition({
  operationState = 'executing',
  runState = 'executing',
  journals = null,
  planOperationId = 'operation-1',
} = {}) {
  const trace = [];
  const items = [
    { id: 'plan-item-1', plan_id: 'plan-1', ordinal: 1, item_hash: h('a'), size_bytes: '100', secrets_included: false },
    { id: 'plan-item-2', plan_id: 'plan-1', ordinal: 2, item_hash: h('b'), size_bytes: '200', secrets_included: false },
  ];
  const state = {
    operation: {
      operation_id: 'operation-1',
      context_mode: 'tenant',
      tenant_id: 'tenant-1',
      workspace_id: 'workspace-1',
      resource_id: 'resource-1',
      target_id: 'target-1',
      state: operationState,
      version: 8,
      terminal_reason: null,
      secrets_included: false,
    },
    plan: {
      plan_id: 'plan-1',
      operation_id: planOperationId,
      target_id: 'target-1',
      plan_hash: h('c'),
      item_count: 2,
      consumed: true,
      consumed_run_id: 'run-1',
      status: 'consumed',
      secrets_included: false,
    },
    run: {
      run_id: 'run-1',
      operation_id: 'operation-1',
      plan_id: 'plan-1',
      state: runState,
      run_generation: 1,
      started_at_epoch: 100,
      finished_at_epoch: null,
      deleted_count: 0,
      deleted_bytes: '0',
      skipped_count: 0,
      missing_count: 0,
      failed_count: 0,
      journal_digest: h('d'),
      checkpoint_digest: h('e'),
      unknown_outcome: runState === 'unknown_outcome',
      readback_status: 'pending',
      result_digest: null,
      record_digest: h('f'),
      secrets_included: false,
    },
    items,
    journals: journals || completeJournals(items),
    reconciliations: [],
  };

  const runTransitions = {
    executing: new Set(['readback_pending', 'unknown_outcome', 'failed']),
    readback_pending: new Set(['reconciling', 'completed', 'failed']),
    reconciling: new Set(['completed', 'unknown_outcome', 'failed']),
    unknown_outcome: new Set(['reconciling', 'failed']),
    completed: new Set(),
    failed: new Set(),
  };

  function aggregate() {
    return {
      operation: clone(state.operation),
      plans: [clone(state.plan)],
      journals: clone(state.journals),
      reconciliations: clone(state.reconciliations),
      aggregate_digest: h('9'),
      secrets_included: false,
    };
  }

  const controlPlane = Object.freeze({
    createOperation() {},
    async readAggregate(operationId) {
      trace.push(`readAggregate:${operationId}`);
      return aggregate();
    },
    async transitionOperation(input) {
      trace.push(`operation:${input.next_state}`);
      assert.equal(input.operation_id, 'operation-1');
      assert.equal(input.expected_version, state.operation.version);
      state.operation.state = input.next_state;
      state.operation.version += 1;
      state.operation.terminal_reason = input.terminal_reason || null;
      return clone(state.operation);
    },
  });

  const executionParents = Object.freeze({
    registerPlanItems() {},
    startRun() {},
    async readRun(input) {
      trace.push(`readRun:${input.run_id}`);
      return {
        found: true,
        run: clone(state.run),
        run_digest: h('6'),
        database_fingerprint: h('8'),
        secrets_included: false,
      };
    },
    async readPlanItems(input) {
      trace.push(`readPlanItems:${input.plan_id}`);
      return {
        found: true,
        plan_id: 'plan-1',
        items: clone(state.items),
        item_count: state.items.length,
        item_set_digest: h('7'),
        database_fingerprint: h('8'),
        secrets_included: false,
      };
    },
    async finalizeRun(input) {
      const next = input.finalization.state;
      trace.push(`run:${next}`);
      assert.equal(input.expected_checkpoint_digest, state.run.checkpoint_digest);
      assert.equal(runTransitions[state.run.state].has(next), true, `${state.run.state} -> ${next}`);
      state.run = {
        ...state.run,
        ...clone(input.finalization),
        run_id: 'run-1',
        operation_id: 'operation-1',
        plan_id: 'plan-1',
        record_digest: h('f'),
        secrets_included: false,
      };
      return { ok: true, run: clone(state.run), secrets_included: false };
    },
  });

  const childEvidence = Object.freeze({
    appendJournalEvent() {},
    async appendReconciliation(input) {
      trace.push(`reconciliation:${input.outcome}`);
      const existing = state.reconciliations.find((row) => row.reconciliation_id === input.reconciliation_id);
      if (existing) {
        assert.deepEqual(existing, input);
        return { created: false, replay: true, reconciliation: clone(existing), secrets_included: false };
      }
      state.reconciliations.push(clone(input));
      return { created: true, replay: false, reconciliation: clone(input), secrets_included: false };
    },
  });

  const composition = {
    composition_key: 'hostinger_storage_verified_sql_runtime_composition_v1',
    composition_version: 'spec014-hostinger-storage-verified-sql-runtime-composition-v1',
    schema_verified: true,
    schema_provenance: Object.freeze({
      evidence_digest: h('1'),
      source_commit: h('2'),
      deployed_runtime_sha: h('2'),
      database_fingerprint: h('8'),
      readback_cycle_id: 'restart-cycle-1',
      expires_at: '2099-01-01T00:00:00.000Z',
      secrets_included: false,
    }),
    control_plane: controlPlane,
    execution_parents: executionParents,
    child_evidence: childEvidence,
    raw_components_exposed: false,
    legacy_child_write_paths_exposed: false,
    duplicate_write_paths_allowed: false,
    runtime_mounted: false,
    route_mounted: false,
    worker_mounted: false,
    foreign_keys_enabled: false,
    migration_apply_authorized: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    secrets_included: false,
  };
  Object.defineProperty(
    composition,
    Symbol.for('mad4b.spec014.hostinger-storage-verified-sql-runtime-composition'),
    { value: true, enumerable: false },
  );
  return { composition: Object.freeze(composition), state, trace };
}

function request() {
  return {
    operation_id: 'operation-1',
    plan_id: 'plan-1',
    run_id: 'run-1',
    recovery_epoch: 500,
    secrets_included: false,
  };
}

assert.throws(
  () => createHostingerStorageCrashSafeRestartReconciler({ composition: {} }),
  (error) => error.code === 'STORAGE_RESTART_RECONCILER_COMPOSITION_INVALID',
);

{
  const fixture = makeComposition();
  const reconciler = createHostingerStorageCrashSafeRestartReconciler({ composition: fixture.composition });
  assert.equal(isCanonicalHostingerStorageCrashSafeRestartReconciler(reconciler), true);
  assert.equal(reconciler.reconciler_version, HOSTINGER_STORAGE_CRASH_SAFE_RESTART_RECONCILER_VERSION);
  assert.equal(reconciler.evidence_only, true);
  assert.equal(reconciler.mutation_replay_allowed, false);
  assert.equal(reconciler.provider_calls_allowed, false);
  assert.equal(reconciler.automatic_retry_allowed, false);
  assert.equal('composition' in reconciler, false);
  assert.deepEqual(fixture.trace, [], 'Factory construction must not read durable state.');

  const result = await reconciler.reconcile(request());
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'applied');
  assert.equal(result.final_run_state, 'completed');
  assert.equal(result.final_operation_state, 'completed');
  assert.equal(result.analysis.complete, true);
  assert.equal(result.analysis.counts.deleted, 2);
  assert.equal(result.analysis.deleted_bytes, '300');
  assert.equal(result.mutation_replayed, false);
  assert.equal(result.provider_called, false);
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(fixture.state.reconciliations.length, 1);
  assert.equal(fixture.state.run.state, 'completed');
  assert.equal(fixture.state.operation.state, 'completed');
  assert.deepEqual(
    fixture.trace.filter((entry) => entry.startsWith('run:') || entry.startsWith('operation:') || entry.startsWith('reconciliation:')),
    [
      'run:readback_pending',
      'operation:readback_pending',
      'run:reconciling',
      'operation:reconciling',
      'reconciliation:applied',
      'run:completed',
      'operation:completed',
    ],
  );

  const writesBeforeReplay = fixture.trace.filter((entry) => entry.startsWith('run:') || entry.startsWith('operation:') || entry.startsWith('reconciliation:')).length;
  const replay = await reconciler.reconcile(request());
  assert.equal(replay.terminal_replay, true);
  assert.equal(replay.outcome, 'applied');
  const writesAfterReplay = fixture.trace.filter((entry) => entry.startsWith('run:') || entry.startsWith('operation:') || entry.startsWith('reconciliation:')).length;
  assert.equal(writesAfterReplay, writesBeforeReplay, 'Terminal replay must perform no mutation.');
}

{
  const base = makeComposition();
  const incompleteRows = base.state.journals.slice(0, -1);
  const fixture = makeComposition({
    operationState: 'executing',
    runState: 'readback_pending',
    journals: incompleteRows,
  });
  const reconciler = createHostingerStorageCrashSafeRestartReconciler({ composition: fixture.composition });
  const result = await reconciler.reconcile(request());
  assert.equal(result.outcome, 'still_unknown');
  assert.equal(result.final_run_state, 'unknown_outcome');
  assert.equal(result.final_operation_state, 'unknown_outcome');
  assert.equal(result.analysis.complete, false);
  assert.equal(result.analysis.blockers.some((entry) => entry.startsWith('incomplete_item:')), true);
  assert.equal(result.read_before_retry_required, true);
  assert.equal(result.mutation_replayed, false);
  assert.equal(result.provider_called, false);
  assert.equal(fixture.state.run.state, 'unknown_outcome');
  assert.equal(fixture.state.operation.state, 'unknown_outcome');
  assert.deepEqual(
    fixture.trace.filter((entry) => entry.startsWith('run:') || entry.startsWith('operation:') || entry.startsWith('reconciliation:')),
    [
      'run:reconciling',
      'run:unknown_outcome',
      'operation:unknown_outcome',
      'reconciliation:still_unknown',
    ],
  );
}

{
  const fixture = makeComposition({ planOperationId: 'operation-other' });
  const reconciler = createHostingerStorageCrashSafeRestartReconciler({ composition: fixture.composition });
  await assert.rejects(
    reconciler.reconcile(request()),
    (error) => error.code === 'STORAGE_RESTART_RECONCILER_PLAN_BINDING_MISMATCH',
  );
  assert.equal(fixture.trace.some((entry) => entry.startsWith('run:') || entry.startsWith('operation:') || entry.startsWith('reconciliation:')), false);
}

const source = await readFile(new URL('./hostingerStorageCrashSafeRestartReconciler.js', import.meta.url), 'utf8');
for (const forbidden of [
  'hostingerStorageSyntheticAdapter',
  'hostingerStorageSyntheticExecutor',
  'mutateExact(',
  'readbackItem(',
  'providerDispatch',
  'dispatchProvider',
  'node:child_process',
  'node:net',
  'node:tls',
  'server.js',
  'routes/',
  'migrations/',
  'getConnection(',
]) assert.equal(source.includes(forbidden), false, `Restart reconciler source must not contain ${forbidden}`);
for (const required of [
  'mutation_replay_allowed: false',
  'provider_calls_allowed: false',
  'automatic_retry_allowed: false',
  'evidence_only: true',
  'readPlanItems',
  'appendReconciliation',
  'runtime_mounted: false',
  'provider_dispatch_allowed: false',
  'production_ready: false',
]) assert.equal(source.includes(required), true, `Restart reconciler source must contain ${required}`);

console.log(JSON.stringify({
  ok: true,
  contract: 'hostinger_storage_crash_safe_restart_reconciler_v1',
  complete_evidence_outcome: 'applied',
  incomplete_evidence_outcome: 'still_unknown',
  mutation_replay_allowed: false,
  provider_calls_allowed: false,
  automatic_retry_allowed: false,
  runtime_mounted: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  secrets_included: false,
}));
