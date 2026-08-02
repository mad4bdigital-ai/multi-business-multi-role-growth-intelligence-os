import assert from 'node:assert/strict';
import {
  createHostingerStorageDurableTenantRepositoryFacade,
  isCanonicalHostingerStorageDurableTenantRepositoryFacade,
} from './hostingerStorageDurableTenantRepositoryFacade.js';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

function makeComposition({ state = 'executing', version = 8 } = {}) {
  const trace = [];
  const operation = {
    operation_id: 'op-1',
    target_id: 'target-1',
    state,
    version,
    secrets_included: false,
  };
  const controlPlane = Object.freeze({
    createOperation() {},
    async readAggregate(operationId) {
      trace.push(`read:${operationId}`);
      return {
        operation: structuredClone(operation),
        plans: [],
        aggregate_digest: SHA_A,
        secrets_included: false,
      };
    },
    async transitionOperation(input) {
      trace.push(`transition:${input.next_state}`);
      assert.equal(input.expected_version, operation.version);
      operation.state = input.next_state;
      operation.version += 1;
      operation.terminal_reason = input.terminal_reason || null;
      return structuredClone(operation);
    },
    async consumePlan() {},
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
    execution_parents: Object.freeze({
      async registerPlanItems() {},
      async startRun() {},
      async finalizeRun() {},
      async readRun() {},
      async readPlanItems() {},
    }),
    child_evidence: Object.freeze({
      async appendJournalEvent() {},
      async appendReconciliation() {},
    }),
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
  return { composition: Object.freeze(composition), operation, trace };
}

{
  const { composition, operation, trace } = makeComposition();
  const facade = createHostingerStorageDurableTenantRepositoryFacade({ composition });
  assert.equal(isCanonicalHostingerStorageDurableTenantRepositoryFacade(facade), true);
  assert.equal(facade.transitionOperation, undefined);
  assert.equal(typeof facade.advanceExecutionState, 'function');
  const result = await facade.advanceExecutionState({
    operation_id: 'op-1',
    expected_version: 8,
    expected_current_state: 'executing',
    next_state: 'readback_pending',
    now_epoch: 100,
    secrets_included: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.operation.state, 'readback_pending');
  assert.equal(result.operation.version, 9);
  assert.equal(operation.state, 'readback_pending');
  assert.deepEqual(trace, ['read:op-1', 'transition:readback_pending', 'read:op-1']);
}

{
  const { composition, trace } = makeComposition();
  const facade = createHostingerStorageDurableTenantRepositoryFacade({ composition });
  await assert.rejects(
    facade.advanceExecutionState({
      operation_id: 'op-1',
      expected_version: 7,
      expected_current_state: 'executing',
      next_state: 'readback_pending',
      now_epoch: 100,
      secrets_included: false,
    }),
    (error) => error.code === 'STORAGE_DURABLE_TENANT_FACADE_OPERATION_VERSION_CONFLICT',
  );
  assert.deepEqual(trace, ['read:op-1']);
}

{
  const { composition, trace } = makeComposition({ state: 'readback_pending', version: 9 });
  const facade = createHostingerStorageDurableTenantRepositoryFacade({ composition });
  await assert.rejects(
    facade.advanceExecutionState({
      operation_id: 'op-1',
      expected_version: 9,
      expected_current_state: 'readback_pending',
      next_state: 'lease_acquired',
      now_epoch: 100,
      secrets_included: false,
    }),
    (error) => error.code === 'STORAGE_DURABLE_TENANT_FACADE_OPERATION_TRANSITION_DENIED'
      && error.details.reason_codes.includes('invalid_state_transition'),
  );
  assert.deepEqual(trace, ['read:op-1']);
}

{
  const { composition, trace } = makeComposition({ state: 'reconciling', version: 10 });
  const facade = createHostingerStorageDurableTenantRepositoryFacade({ composition });
  const result = await facade.advanceExecutionState({
    operation_id: 'op-1',
    expected_version: 10,
    expected_current_state: 'reconciling',
    next_state: 'blocked',
    terminal_reason: 'durable_async_reconciliation_conflict',
    now_epoch: 100,
    secrets_included: false,
  });
  assert.equal(result.operation.state, 'blocked');
  assert.equal(result.operation.terminal_reason, 'durable_async_reconciliation_conflict');
  assert.deepEqual(trace, ['read:op-1', 'transition:blocked', 'read:op-1']);
}

console.log('Hostinger Storage durable Tenant repository facade state-transition tests passed.');
