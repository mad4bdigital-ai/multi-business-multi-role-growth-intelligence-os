import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  createHostingerStorageSyntheticAdapter,
} from './hostingerStorageSyntheticAdapter.js';
import {
  HOSTINGER_STORAGE_PARENT_AWARE_ASYNC_EXECUTION_ENGINE_VERSION,
  createHostingerStorageParentAwareAsyncExecutionEngine,
  isCanonicalHostingerStorageParentAwareAsyncExecutionEngine,
} from './hostingerStorageParentAwareAsyncExecutionEngine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function protocolFixture() {
  const protocol = {
    schema_version: 1,
    protocol_key: 'hostinger_storage_synthetic_execution_protocol_v1',
    protocol_version: 'spec014-hostinger-storage-executor-v1',
    run_id: 'run-1',
    operation_id: 'op-1',
    target_id: 'target-1',
    plan_id: 'plan-1',
    plan_hash: SHA_A,
    candidate_set_hash: SHA_B,
    plan_expires_at_epoch: 500,
    authorization_bundle_hash: SHA_C,
    lease_id: 'lease-1',
    lease_generation: 1,
    lease_expires_at_epoch: 400,
    synthetic_only: true,
    production_ready: false,
    provider_dispatch_allowed: false,
    automatic_retry_allowed: false,
    items: [{
      item_id: 'item-1',
      ordinal: 1,
      category: 'cache',
      path_ref: 'cache/item-1',
      item_hash: SHA_D,
      relative_path_digest: SHA_B,
      expected: {
        size_bytes: 12,
        device: 1,
        inode: 2,
        ctime_epoch: 3,
        mtime_epoch: 4,
        file_type: 'regular',
      },
      secrets_included: false,
    }],
    secrets_included: false,
  };
  return { protocol, protocol_digest: digest(protocol) };
}

function preparationFixture() {
  return {
    operation_id: 'op-1',
    plan_id: 'plan-1',
    expected_operation_version: 7,
    expected_plan_hash: SHA_A,
    now_epoch: 100,
    plan_items: [{
      item_id: 'item-1',
      item_hash: SHA_D,
      ordinal: 1,
      category: 'cache',
      path_ref: 'cache/item-1',
      size_bytes: '12',
      expected_file_type: 'regular',
      eligibility_rule_key: 'rule-1',
      eligibility_evidence_digest: SHA_B,
      ownership_evidence_ref: 'ownership-1',
      protected_classification: false,
      secrets_included: false,
    }],
    run: {
      run_id: 'run-1',
      operation_id: 'op-1',
      plan_id: 'plan-1',
      target_id: 'target-1',
      lease_id: 'lease-1',
      lease_generation: 1,
      lease_expires_at_epoch: 400,
      run_generation: 1,
      adapter_key: 'hostinger_storage_synthetic_memory_adapter_v1',
      adapter_version: 'spec014-hostinger-storage-synthetic-adapter-v1',
      worker_ref: 'synthetic-worker-1',
      connector_ref: 'synthetic-connector-1',
      dispatch_certification_ref: 'synthetic-dispatch-1',
      host_key_evidence_ref: 'not-applicable-synthetic',
      started_at_epoch: 100,
      state: 'executing',
      journal_digest: SHA_A,
      checkpoint_digest: SHA_B,
      before_snapshot_id: 'snapshot-1',
      provider_response_classification: 'not_dispatched',
      secrets_included: false,
    },
    secrets_included: false,
  };
}

function makeFacade() {
  const trace = [];
  const journals = [];
  const reconciliations = [];
  const state = {
    operation: { operation_id: 'op-1', state: 'lease_acquired', version: 7, target_id: 'target-1', secrets_included: false },
    run: { state: null, checkpoint_digest: null },
  };
  const runTransitions = {
    executing: new Set(['readback_pending', 'unknown_outcome', 'failed']),
    readback_pending: new Set(['reconciling', 'completed', 'unknown_outcome', 'failed']),
    reconciling: new Set(['completed', 'unknown_outcome', 'failed']),
  };

  const facade = {
    facade_key: 'hostinger_storage_durable_tenant_repository_facade_v1',
    facade_version: 'spec014-hostinger-storage-durable-tenant-repository-facade-v1',
    composition_version: 'spec014-hostinger-storage-verified-sql-runtime-composition-v1',
    schema_provenance: Object.freeze({ evidence_digest: SHA_A, secrets_included: false }),
    async_only: true,
    legacy_synthetic_executor_compatible: false,
    raw_composition_exposed: false,
    legacy_record_reconciliation_exposed: false,
    transition_operation_exposed: false,
    consume_plan_exposed: false,
    runtime_mounted: false,
    route_mounted: false,
    worker_mounted: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    async readExecutionAggregate() {
      trace.push('readAggregate');
      return { operation: structuredClone(state.operation), plans: [], aggregate_digest: SHA_C, secrets_included: false };
    },
    async prepareExecution(preparation) {
      trace.push('prepareExecution');
      assert.equal(preparation.operation_id, 'op-1');
      state.operation.state = 'executing';
      state.operation.version = 8;
      state.run.state = 'executing';
      state.run.checkpoint_digest = preparation.run.checkpoint_digest;
      return {
        ok: true,
        evidence: {
          operation_id: 'op-1',
          operation_version: 8,
          plan_id: 'plan-1',
          run_id: 'run-1',
          secrets_included: false,
        },
        evidence_digest: SHA_D,
        secrets_included: false,
      };
    },
    async advanceExecutionState(input) {
      trace.push(`operation:${input.next_state}`);
      assert.equal(input.expected_current_state, state.operation.state);
      assert.equal(input.expected_version, state.operation.version);
      state.operation.state = input.next_state;
      state.operation.version += 1;
      return {
        ok: true,
        operation: structuredClone(state.operation),
        transition: { current_state: input.expected_current_state, next_state: input.next_state, secrets_included: false },
        secrets_included: false,
      };
    },
    async appendJournalEvent(event) {
      trace.push(`journal:${event.phase}`);
      assert.equal(state.run.state, 'executing');
      journals.push(structuredClone(event));
      return { created: true, journal: structuredClone(event), secrets_included: false };
    },
    async appendReconciliation(record) {
      trace.push('reconciliation');
      assert.equal(state.run.state, 'reconciling');
      assert.equal(state.operation.state, 'reconciling');
      reconciliations.push(structuredClone(record));
      return { created: true, reconciliation: structuredClone(record), secrets_included: false };
    },
    async finalizeRun(input) {
      const next = input.finalization.state;
      trace.push(`run:${next}`);
      assert.equal(input.expected_checkpoint_digest, state.run.checkpoint_digest);
      assert.equal(runTransitions[state.run.state]?.has(next), true, `${state.run.state} -> ${next}`);
      state.run.state = next;
      state.run.checkpoint_digest = input.finalization.checkpoint_digest;
      return { ok: true, run: { state: next, checkpoint_digest: state.run.checkpoint_digest, secrets_included: false }, secrets_included: false };
    },
    secrets_included: false,
  };
  Object.defineProperty(
    facade,
    Symbol.for('mad4b.spec014.hostinger-storage-durable-tenant-repository-facade'),
    { value: true, enumerable: false },
  );
  return { facade: Object.freeze(facade), trace, journals, reconciliations, state };
}

function adapterFixture({ metadata = null } = {}) {
  const expected = protocolFixture().protocol.items[0].expected;
  return createHostingerStorageSyntheticAdapter({
    items: [{
      item_id: 'item-1',
      path_ref: 'cache/item-1',
      item_hash: SHA_D,
      metadata: metadata || expected,
      exists: true,
      protected: false,
    }],
  });
}

assert.throws(
  () => createHostingerStorageParentAwareAsyncExecutionEngine({ facade: {}, adapter: adapterFixture() }),
  (error) => error.code === 'STORAGE_ASYNC_ENGINE_FACADE_INVALID',
);
assert.throws(
  () => createHostingerStorageParentAwareAsyncExecutionEngine({ facade: makeFacade().facade, adapter: {} }),
  (error) => error.code === 'STORAGE_ASYNC_ENGINE_ADAPTER_INVALID',
);
assert.throws(
  () => createHostingerStorageParentAwareAsyncExecutionEngine({ facade: makeFacade().facade, adapter: adapterFixture(), provider: {} }),
  (error) => error.code === 'STORAGE_ASYNC_ENGINE_OVERRIDE_FORBIDDEN',
);

{
  const { facade, trace, journals, reconciliations, state } = makeFacade();
  const engine = createHostingerStorageParentAwareAsyncExecutionEngine({ facade, adapter: adapterFixture() });
  assert.equal(isCanonicalHostingerStorageParentAwareAsyncExecutionEngine(engine), true);
  assert.equal(engine.engine_version, HOSTINGER_STORAGE_PARENT_AWARE_ASYNC_EXECUTION_ENGINE_VERSION);
  assert.deepEqual(trace, [], 'Engine construction must perform no database-backed or mutation calls.');
  const protocol = protocolFixture();
  const result = await engine.execute({
    ...protocol,
    preparation: preparationFixture(),
    execution_epoch: 100,
    secrets_included: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'applied');
  assert.equal(result.final_run_state, 'completed');
  assert.equal(result.final_operation_state, 'completed');
  assert.equal(result.final_operation_version, 11);
  assert.equal(result.counts.deleted, 1);
  assert.equal(result.deleted_bytes, '12');
  assert.equal(result.live_provider_mutated, false);
  assert.equal(result.provider_dispatch_allowed, false);
  assert.equal(result.runtime_mounted, false);
  assert.match(result.result_digest, /^[0-9a-f]{64}$/u);
  assert.equal(journals.length, 3);
  assert.deepEqual(journals.map((row) => row.phase), ['prepared', 'result', 'readback']);
  assert.deepEqual(journals.map((row) => row.sequence), [1, 2, 3]);
  assert.equal(reconciliations.length, 1);
  assert.equal(reconciliations[0].outcome, 'applied');
  assert.equal(state.run.state, 'completed');
  assert.equal(state.operation.state, 'completed');
  assert.deepEqual(trace, [
    'prepareExecution',
    'journal:prepared',
    'journal:result',
    'journal:readback',
    'run:readback_pending',
    'operation:readback_pending',
    'run:reconciling',
    'operation:reconciling',
    'reconciliation',
    'run:completed',
    'operation:completed',
  ]);
}

{
  const { facade, trace } = makeFacade();
  const engine = createHostingerStorageParentAwareAsyncExecutionEngine({ facade, adapter: adapterFixture() });
  const protocol = protocolFixture();
  const preparation = preparationFixture();
  preparation.plan_items[0].item_hash = SHA_C;
  await assert.rejects(
    engine.execute({ ...protocol, preparation, execution_epoch: 100, secrets_included: false }),
    (error) => error.code === 'STORAGE_ASYNC_ENGINE_PLAN_ITEM_BINDING_MISMATCH',
  );
  assert.deepEqual(trace, [], 'Plan-item mismatch must fail before durable preparation.');
}

{
  const { facade, trace } = makeFacade();
  const engine = createHostingerStorageParentAwareAsyncExecutionEngine({ facade, adapter: adapterFixture() });
  const protocol = protocolFixture();
  protocol.protocol.items[0].item_hash = SHA_C;
  await assert.rejects(
    engine.execute({ ...protocol, preparation: preparationFixture(), execution_epoch: 100, secrets_included: false }),
    (error) => error.code === 'STORAGE_EXECUTOR_PROTOCOL_TAMPERED',
  );
  assert.deepEqual(trace, [], 'Protocol tampering must fail before durable preparation.');
}

{
  const { facade } = makeFacade();
  const changedMetadata = { size_bytes: 99, device: 1, inode: 2, ctime_epoch: 3, mtime_epoch: 4, file_type: 'regular' };
  const engine = createHostingerStorageParentAwareAsyncExecutionEngine({ facade, adapter: adapterFixture({ metadata: changedMetadata }) });
  const protocol = protocolFixture();
  const result = await engine.execute({ ...protocol, preparation: preparationFixture(), execution_epoch: 100, secrets_included: false });
  assert.equal(result.outcome, 'partially_applied');
  assert.equal(result.counts.skipped_changed, 1);
  assert.equal(result.final_run_state, 'completed');
  assert.equal(result.final_operation_state, 'completed');
}

const source = await readFile(path.join(HERE, 'hostingerStorageParentAwareAsyncExecutionEngine.js'), 'utf8');
for (const forbidden of [
  'hostingerStorageSyntheticAdapterBase',
  'hostingerStorageSyntheticExecutorBase',
  'hostingerStorageTenantRuntime',
  'hostingerStorageTenantCanaryBase',
  'server.js',
  'routes/',
  'getConnection(',
  'providerDispatch',
  'dispatchProvider',
]) {
  assert.equal(source.includes(forbidden), false, `Engine source must not contain ${forbidden}`);
}
for (const required of [
  'verifyHostingerStorageSyntheticExecutionProtocol',
  'isCanonicalHostingerStorageSyntheticAdapter',
  'isCanonicalHostingerStorageDurableTenantRepositoryFacade',
  'prepareExecution',
  'appendJournalEvent',
  'appendReconciliation',
  'advanceExecutionState',
  'finalizeRun',
  'runtime_mounted: false',
  'provider_dispatch_allowed: false',
  'production_ready: false',
]) {
  assert.equal(source.includes(required), true, `Engine source must contain ${required}`);
}

for (const relativePath of ['server.js', 'routes/index.js', 'routes/hostingerStorageTenantRoutes.js']) {
  const candidate = await readFile(path.join(HERE, relativePath), 'utf8');
  assert.equal(candidate.includes('hostingerStorageParentAwareAsyncExecutionEngine'), false, `${relativePath} must not mount the async engine in this slice.`);
}

console.log('Hostinger Storage parent-aware async execution engine tests passed.');
