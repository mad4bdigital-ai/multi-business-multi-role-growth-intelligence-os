import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  HOSTINGER_STORAGE_DURABLE_TENANT_REPOSITORY_FACADE_VERSION,
  createHostingerStorageDurableTenantRepositoryFacade,
  isCanonicalHostingerStorageDurableTenantRepositoryFacade,
} from './hostingerStorageDurableTenantRepositoryFacade.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

function makeComposition({ operationState = 'lease_acquired', consumed = false, consumedRunId = null } = {}) {
  const trace = [];
  const aggregate = {
    operation: {
      operation_id: 'op-1',
      target_id: 'target-1',
      state: operationState,
      version: 7,
      secrets_included: false,
    },
    plans: [{
      plan_id: 'plan-1',
      operation_id: 'op-1',
      target_id: 'target-1',
      plan_hash: SHA_A,
      status: consumed ? 'consumed' : 'approved',
      consumed,
      consumed_run_id: consumedRunId,
      secrets_included: false,
    }],
    aggregate_digest: SHA_B,
    secrets_included: false,
  };

  const controlPlane = Object.freeze({
    createOperation() {},
    async readAggregate(operationId) {
      trace.push(`read:${operationId}`);
      return structuredClone(aggregate);
    },
    async transitionOperation(input) {
      trace.push('transition');
      aggregate.operation.state = input.next_state;
      aggregate.operation.version += 1;
      return structuredClone(aggregate.operation);
    },
    async consumePlan(input) {
      trace.push('consume');
      aggregate.plans[0].status = 'consumed';
      aggregate.plans[0].consumed = true;
      aggregate.plans[0].consumed_run_id = input.run_id;
      return {
        consumed: true,
        replay: false,
        plan: structuredClone(aggregate.plans[0]),
        secrets_included: false,
      };
    },
  });

  const executionParents = Object.freeze({
    async registerPlanItems() {
      trace.push('registerPlanItems');
      return {
        mapping: [{ runtime_item_id: 'item-1', plan_item_id: 'plan-item-1', item_hash: SHA_C }],
        item_set_digest: SHA_C,
        secrets_included: false,
      };
    },
    async startRun() {
      trace.push('startRun');
      return { created: true, replay: false, secrets_included: false };
    },
    async finalizeRun(input) {
      trace.push('finalizeRun');
      return { ok: true, run_id: input.run_id, secrets_included: false };
    },
    async readRun(input) {
      trace.push('readRun');
      return { found: true, run: { run_id: input.run_id, secrets_included: false }, secrets_included: false };
    },
    async readPlanItems(input) {
      trace.push('readPlanItems');
      return { found: true, plan_id: input.plan_id, items: [], item_count: 0, secrets_included: false };
    },
  });

  const childEvidence = Object.freeze({
    async appendJournalEvent(input) {
      trace.push('journal');
      return { created: true, journal: input, secrets_included: false };
    },
    async appendReconciliation(input) {
      trace.push('reconciliation');
      return { created: true, reconciliation: input, secrets_included: false };
    },
  });

  const composition = {
    composition_key: 'hostinger_storage_verified_sql_runtime_composition_v1',
    composition_version: 'spec014-hostinger-storage-verified-sql-runtime-composition-v1',
    schema_verified: true,
    schema_provenance: Object.freeze({
      evidence_digest: SHA_A,
      source_commit: SHA_A,
      deployed_runtime_sha: SHA_A,
      database_fingerprint: SHA_B,
      readback_cycle_id: 'cycle-1',
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
  return { composition: Object.freeze(composition), trace, aggregate };
}

function preparationInput() {
  return {
    operation_id: 'op-1',
    plan_id: 'plan-1',
    expected_operation_version: 7,
    expected_plan_hash: SHA_A,
    now_epoch: 100,
    plan_items: [{
      item_id: 'item-1',
      item_hash: SHA_C,
      ordinal: 1,
      category: 'cache',
      path_ref: 'cache/item-1',
      size_bytes: '1',
      expected_file_type: 'file',
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
      lease_expires_at_epoch: 200,
      run_generation: 1,
      adapter_key: 'adapter-1',
      adapter_version: 'v1',
      worker_ref: 'worker-1',
      connector_ref: 'connector-1',
      dispatch_certification_ref: 'dispatch-1',
      host_key_evidence_ref: 'host-key-1',
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

assert.throws(
  () => createHostingerStorageDurableTenantRepositoryFacade({ composition: {} }),
  (error) => error.code === 'STORAGE_DURABLE_TENANT_FACADE_COMPOSITION_INVALID',
);
assert.throws(
  () => createHostingerStorageDurableTenantRepositoryFacade({ composition: makeComposition().composition, repository: {} }),
  (error) => error.code === 'STORAGE_DURABLE_TENANT_FACADE_OVERRIDE_FORBIDDEN',
);

{
  const { composition, trace } = makeComposition();
  const facade = createHostingerStorageDurableTenantRepositoryFacade({ composition });
  assert.equal(isCanonicalHostingerStorageDurableTenantRepositoryFacade(facade), true);
  assert.equal(facade.facade_version, HOSTINGER_STORAGE_DURABLE_TENANT_REPOSITORY_FACADE_VERSION);
  assert.deepEqual(trace, [], 'Factory construction must not perform database-backed calls.');
  assert.equal(facade.raw_composition_exposed, false);
  assert.equal(facade.transitionOperation, undefined);
  assert.equal(facade.consumePlan, undefined);
  assert.equal(facade.recordReconciliation, undefined);
  assert.equal(facade.async_only, true);
  assert.equal(facade.legacy_synthetic_executor_compatible, false);

  const result = await facade.prepareExecution(preparationInput());
  assert.equal(result.ok, true);
  assert.equal(result.evidence.transitioned_to_executing, true);
  assert.equal(result.evidence.plan_consumed, true);
  assert.equal(result.evidence.run_parent_created, true);
  assert.equal(result.evidence.legacy_synthetic_executor_compatible, false);
  assert.equal(result.evidence.runtime_mounted, false);
  assert.equal(result.evidence.provider_dispatch_allowed, false);
  assert.match(result.evidence_digest, /^[0-9a-f]{64}$/u);
  assert.deepEqual(trace, [
    'read:op-1',
    'registerPlanItems',
    'transition',
    'consume',
    'startRun',
    'read:op-1',
  ]);
}

{
  const { composition, trace } = makeComposition({
    operationState: 'executing',
    consumed: true,
    consumedRunId: 'run-1',
  });
  const facade = createHostingerStorageDurableTenantRepositoryFacade({ composition });
  const result = await facade.prepareExecution(preparationInput());
  assert.equal(result.evidence.transitioned_to_executing, false);
  assert.deepEqual(trace, [
    'read:op-1',
    'registerPlanItems',
    'consume',
    'startRun',
    'read:op-1',
  ]);
}

{
  const { composition, trace } = makeComposition();
  const facade = createHostingerStorageDurableTenantRepositoryFacade({ composition });
  const input = preparationInput();
  input.run.target_id = 'target-2';
  await assert.rejects(
    facade.prepareExecution(input),
    (error) => error.code === 'STORAGE_DURABLE_TENANT_FACADE_OPERATION_BINDING_MISMATCH',
  );
  assert.deepEqual(trace, ['read:op-1'], 'Binding rejection must occur before the first mutation.');
}

{
  const { composition, trace } = makeComposition();
  const facade = createHostingerStorageDurableTenantRepositoryFacade({ composition });
  const input = preparationInput();
  input.expected_operation_version = 6;
  await assert.rejects(
    facade.prepareExecution(input),
    (error) => error.code === 'STORAGE_DURABLE_TENANT_FACADE_OPERATION_VERSION_CONFLICT',
  );
  assert.deepEqual(trace, ['read:op-1']);
}

{
  const { composition, trace } = makeComposition();
  const facade = createHostingerStorageDurableTenantRepositoryFacade({ composition });
  const promise = facade.readExecutionAggregate('op-1');
  assert.equal(promise instanceof Promise, true, 'Durable facade reads must be async-only.');
  await promise;
  await facade.appendJournalEvent({ run_id: 'run-1', secrets_included: false });
  await facade.appendReconciliation({ run_id: 'run-1', secrets_included: false });
  await facade.finalizeRun({ run_id: 'run-1', secrets_included: false });
  assert.deepEqual(trace, ['read:op-1', 'journal', 'reconciliation', 'finalizeRun']);
}

{
  const { composition } = makeComposition();
  const facade = createHostingerStorageDurableTenantRepositoryFacade({ composition });
  const unsafe = preparationInput();
  unsafe.run.private_key = 'forbidden';
  await assert.rejects(
    facade.prepareExecution(unsafe),
    (error) => error.code === 'STORAGE_DURABLE_TENANT_FACADE_SECRET_OR_UNSAFE_FIELD_REJECTED',
  );
}

const source = await readFile(path.join(HERE, 'hostingerStorageDurableTenantRepositoryFacade.js'), 'utf8');
for (const forbidden of [
  'hostingerStorageSyntheticExecutorBase',
  'hostingerStorageSyntheticExecutor.js',
  'hostingerStorageTenantCanaryBase',
  'hostingerStorageTenantRuntime.js',
  'routes/',
  'server.js',
  'getConnection(',
  'providerDispatch',
  'dispatchProvider',
]) {
  assert.equal(source.includes(forbidden), false, `Facade source must not contain ${forbidden}`);
}
for (const required of [
  'registerPlanItems',
  'transitionOperation',
  'consumePlan',
  'startRun',
  'appendJournalEvent',
  'appendReconciliation',
  'legacy_synthetic_executor_compatible: false',
  'runtime_mounted: false',
  'provider_dispatch_allowed: false',
  'production_ready: false',
]) {
  assert.equal(source.includes(required), true, `Facade source must contain ${required}`);
}

for (const relativePath of [
  'server.js',
  'routes/index.js',
  'routes/hostingerStorageTenantRoutes.js',
]) {
  const candidate = await readFile(path.join(HERE, relativePath), 'utf8');
  assert.equal(
    candidate.includes('hostingerStorageDurableTenantRepositoryFacade'),
    false,
    `${relativePath} must not mount or import the durable facade in this slice.`,
  );
}

console.log('Hostinger Storage durable Tenant repository facade tests passed.');
