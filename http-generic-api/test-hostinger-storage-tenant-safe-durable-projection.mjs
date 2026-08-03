#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  HOSTINGER_STORAGE_TENANT_SAFE_DURABLE_PROJECTION_VERSION,
  createHostingerStorageTenantSafeDurableProjection,
  isCanonicalHostingerStorageTenantSafeDurableProjection,
} from './hostingerStorageTenantSafeDurableProjection.js';

const h = (character) => character.repeat(64);

function makeDependencies(overrides = {}) {
  const calls = [];
  const aggregate = {
    operation: {
      operation_id: 'operation-1',
      context_mode: 'tenant',
      tenant_id: 'tenant-1',
      workspace_id: 'workspace-1',
      resource_id: 'resource-1',
      target_id: 'target-1',
      state: 'unknown_outcome',
      version: 9,
      updated_at_epoch: 900,
      terminal_reason: null,
      secrets_included: false,
    },
    plans: [{
      plan_id: 'plan-1',
      operation_id: 'operation-1',
      target_id: 'target-1',
      status: 'consumed',
      item_count: 2,
      total_bytes: 300,
      expires_at_epoch: 2000,
      consumed: true,
      consumed_run_id: 'run-1',
      plan_hash: h('a'),
      path_ref: 'must-not-leak/plan-path',
      secrets_included: false,
    }],
    leases: [{ target_id: 'target-1', lease_id: 'lease-secret', secrets_included: false }],
    journals: [
      {
        run_id: 'run-1', sequence: 1, phase: 'prepared', result: 'prepared',
        item_id: 'item-secret-1', path_ref: 'must-not-leak/item-1', observed_stat_digest: h('1'), secrets_included: false,
      },
      {
        run_id: 'run-1', sequence: 2, phase: 'result', result: 'deleted',
        item_id: 'item-secret-1', result_evidence_digest: h('2'), secrets_included: false,
      },
      {
        run_id: 'run-1', sequence: 3, phase: 'readback', result: 'deleted',
        item_id: 'item-secret-1', result_evidence_digest: h('3'), secrets_included: false,
      },
      {
        run_id: 'run-1', sequence: 4, phase: 'prepared', result: 'prepared',
        item_id: 'item-secret-2', path_ref: 'must-not-leak/item-2', secrets_included: false,
      },
      {
        run_id: 'run-1', sequence: 5, phase: 'result', result: 'skipped_changed',
        item_id: 'item-secret-2', secrets_included: false,
      },
      {
        run_id: 'run-1', sequence: 6, phase: 'readback', result: 'skipped_changed',
        item_id: 'item-secret-2', secrets_included: false,
      },
    ],
    reconciliations: [{
      reconciliation_id: 'reconciliation-secret',
      operation_id: 'operation-1',
      run_id: 'run-1',
      outcome: 'not_applied',
      retry_permission: true,
      reviewed_at_epoch: 950,
      input_evidence_hashes: { secret_internal_key: h('4') },
      secrets_included: false,
    }],
    aggregate_digest: h('b'),
    secrets_included: false,
  };
  const run = {
    run_id: 'run-1',
    operation_id: 'operation-1',
    plan_id: 'plan-1',
    run_generation: 2,
    state: 'unknown_outcome',
    started_at_epoch: 800,
    finished_at_epoch: 940,
    deleted_count: 1,
    deleted_bytes: '100',
    skipped_count: 1,
    missing_count: 0,
    failed_count: 0,
    readback_status: 'complete',
    unknown_outcome: true,
    provider_response_classification: 'synthetic_not_dispatched',
    result_digest: h('c'),
    worker_ref: 'must-not-leak-worker',
    connector_ref: 'must-not-leak-connector',
    dispatch_certification_ref: 'must-not-leak-dispatch',
    host_key_evidence_ref: 'must-not-leak-host-key',
    before_snapshot_id: 'must-not-leak-before-snapshot',
    after_snapshot_id: 'must-not-leak-after-snapshot',
    secrets_included: false,
  };
  const allowlist = {
    allowlist_id: 'allowlist-1',
    revision: 'revision-1',
    status: 'active',
    environment: 'production',
    target_scope: 'tenant',
    tenant_id: 'tenant-1',
    workspace_id: 'workspace-1',
    resource_id: 'resource-1',
    target_id: 'target-1',
    root_ref: 'must-not-leak-root',
    path_ref_prefix: 'must-not-leak-prefix',
    shared_target: false,
    platform_target: false,
    valid_from_epoch: 100,
    expires_at_epoch: 2000,
    max_items: 10,
    max_bytes: 10000,
    evidence_digest: h('d'),
    secrets_included: false,
  };
  const approval = {
    approval_id: 'approval-1',
    slot: 'workspace_owner',
    status: 'approved',
    tenant_id: 'tenant-1',
    workspace_id: 'workspace-1',
    operation_id: 'operation-1',
    target_id: 'target-1',
    plan_hash: h('a'),
    authority_context_hash: h('e'),
    approver_role: 'workspace_owner',
    expires_at_epoch: 2000,
    evidence_digest: h('f'),
    secrets_included: false,
  };
  const enablement = {
    enablement_id: 'enablement-1',
    authorization_digest: h('9'),
    operation_id: 'operation-1',
    run_id: 'run-1',
    generation: 4,
    expires_at_epoch: 2000,
    consumed: true,
    consumed_by_run_id: 'run-1',
    consumed_at_epoch: 820,
    secrets_included: false,
  };
  const consumption = {
    consumption_id: 'consumption-secret',
    enablement_id: 'enablement-1',
    authorization_digest: h('9'),
    operation_id: 'operation-1',
    run_id: 'run-1',
    registered_generation: 3,
    consumed_generation: 4,
    consumed_at_epoch: 820,
    secrets_included: false,
  };

  Object.assign(aggregate.operation, overrides.operation || {});
  Object.assign(aggregate.plans[0], overrides.plan || {});
  Object.assign(run, overrides.run || {});
  Object.assign(allowlist, overrides.allowlist || {});
  Object.assign(approval, overrides.approval || {});
  Object.assign(enablement, overrides.enablement || {});

  const composition = {
    composition_key: 'hostinger_storage_verified_sql_runtime_composition_v1',
    composition_version: 'spec014-hostinger-storage-verified-sql-runtime-composition-v1',
    schema_verified: true,
    schema_provenance: Object.freeze({ database_fingerprint: overrides.compositionFingerprint || h('8') }),
    control_plane: Object.freeze({
      createOperation() {},
      async readAggregate(operationId) {
        calls.push(`aggregate:${operationId}`);
        return structuredClone(aggregate);
      },
    }),
    execution_parents: Object.freeze({
      registerPlanItems() {},
      async readRun(input) {
        calls.push(`run:${input.run_id}`);
        return { found: true, run: structuredClone(run), run_digest: h('7'), secrets_included: false };
      },
    }),
    child_evidence: Object.freeze({ appendJournalEvent() {}, appendReconciliation() {} }),
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
  Object.defineProperty(composition, Symbol.for('mad4b.spec014.hostinger-storage-verified-sql-runtime-composition'), { value: true, enumerable: false });

  const authorityStore = {
    adapter_key: 'hostinger_storage_mysql_tenant_authority_v1',
    store_version: 'spec014-hostinger-storage-durable-tenant-authority-store-v1',
    durable_sql: true,
    async_only: true,
    tenant_exclusive: true,
    schema_verified: true,
    database_fingerprint: overrides.authorityFingerprint || h('8'),
    legacy_tenant_canary_compatible: false,
    runtime_mounted: false,
    route_mounted: false,
    worker_mounted: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    async readAllowlist(id) { calls.push(`allowlist:${id}`); return structuredClone(allowlist); },
    async readApproval(id) { calls.push(`approval:${id}`); return structuredClone(approval); },
  };
  Object.defineProperty(authorityStore, Symbol.for('mad4b.spec014.hostinger-storage-durable-tenant-authority-store'), { value: true, enumerable: false });

  const enablementRegistry = {
    adapter_key: 'hostinger_storage_mysql_tenant_enablement_v1',
    registry_version: 'spec014-hostinger-storage-durable-tenant-enablement-registry-v1',
    durable_sql: true,
    async_only: true,
    one_shot: true,
    generation_cas: true,
    schema_verified: true,
    database_fingerprint: overrides.enablementFingerprint || h('8'),
    legacy_tenant_canary_compatible: false,
    automatic_retry_allowed: false,
    runtime_mounted: false,
    route_mounted: false,
    worker_mounted: false,
    provider_dispatch_allowed: false,
    production_ready: false,
    async read(id) { calls.push(`enablement:${id}`); return structuredClone(enablement); },
    async readConsumption(id) {
      calls.push(`consumption:${id}`);
      if (overrides.consumption === null) return null;
      return structuredClone(overrides.consumption || consumption);
    },
  };
  Object.defineProperty(enablementRegistry, Symbol.for('mad4b.spec014.hostinger-storage-durable-tenant-enablement-registry'), { value: true, enumerable: false });

  return {
    composition: Object.freeze(composition),
    authorityStore: Object.freeze(authorityStore),
    enablementRegistry: Object.freeze(enablementRegistry),
    calls,
  };
}

function request(overrides = {}) {
  return {
    tenant_id: 'tenant-1',
    workspace_id: 'workspace-1',
    resource_id: 'resource-1',
    operation_id: 'operation-1',
    plan_id: 'plan-1',
    run_id: 'run-1',
    allowlist_id: 'allowlist-1',
    approval_id: 'approval-1',
    enablement_id: 'enablement-1',
    secrets_included: false,
    ...overrides,
  };
}

{
  const dependencies = makeDependencies();
  const projector = createHostingerStorageTenantSafeDurableProjection({
    composition: dependencies.composition,
    authority_store: dependencies.authorityStore,
    enablement_registry: dependencies.enablementRegistry,
  });
  assert.equal(isCanonicalHostingerStorageTenantSafeDurableProjection(projector), true);
  assert.equal(projector.projection_version, HOSTINGER_STORAGE_TENANT_SAFE_DURABLE_PROJECTION_VERSION);
  assert.deepEqual(dependencies.calls, [], 'Factory construction must not read durable state.');
  assert.equal('composition' in projector, false);
  assert.equal('authority_store' in projector, false);
  assert.equal('enablement_registry' in projector, false);

  const result = await projector.project(request());
  assert.equal(result.ok, true);
  assert.equal(result.projection.tenant_id, 'tenant-1');
  assert.equal(result.projection.operation.state, 'unknown_outcome');
  assert.equal(result.projection.plan.item_count, 2);
  assert.equal(result.projection.run.counts.deleted, 1);
  assert.equal(result.projection.run.counts.skipped, 1);
  assert.equal(result.projection.evidence.journals.total, 6);
  assert.equal(result.projection.evidence.journals.phases.prepared, 2);
  assert.equal(result.projection.evidence.journals.phases.result, 2);
  assert.equal(result.projection.evidence.journals.phases.readback, 2);
  assert.equal(result.projection.evidence.journals.results.deleted, 2);
  assert.equal(result.projection.evidence.journals.results.skipped, 2);
  assert.equal(result.projection.evidence.reconciliation.latest_outcome, 'not_applied');
  assert.equal(result.projection.retry_allowed, true);
  assert.equal(result.projection.read_before_retry_required, true);
  assert.equal(result.projection.enablement.immutable_consumption_receipt_present, true);
  assert.equal(result.projection.authority.workspace_owner_bound, true);
  assert.equal(Object.isFrozen(result.projection), true);
  assert.match(result.projection_digest, /^[0-9a-f]{64}$/u);
  assert.deepEqual(dependencies.calls, [
    'aggregate:operation-1',
    'run:run-1',
    'allowlist:allowlist-1',
    'approval:approval-1',
    'enablement:enablement-1',
    'consumption:enablement-1',
  ]);

  const serialized = JSON.stringify(result.projection);
  for (const secretValue of [
    'must-not-leak/plan-path',
    'must-not-leak/item-1',
    'must-not-leak/item-2',
    'must-not-leak-worker',
    'must-not-leak-connector',
    'must-not-leak-dispatch',
    'must-not-leak-host-key',
    'must-not-leak-before-snapshot',
    'must-not-leak-after-snapshot',
    'must-not-leak-root',
    'must-not-leak-prefix',
    'item-secret-1',
    'item-secret-2',
    'reconciliation-secret',
    'consumption-secret',
    'lease-secret',
  ]) assert.equal(serialized.includes(secretValue), false, `Projection leaked ${secretValue}`);
}

{
  const dependencies = makeDependencies({ operation: { tenant_id: 'tenant-other' } });
  const projector = createHostingerStorageTenantSafeDurableProjection({
    composition: dependencies.composition,
    authority_store: dependencies.authorityStore,
    enablement_registry: dependencies.enablementRegistry,
  });
  await assert.rejects(projector.project(request()), (error) => error.code === 'STORAGE_TENANT_PROJECTION_AUDIENCE_MISMATCH');
  assert.deepEqual(dependencies.calls, ['aggregate:operation-1'], 'Audience mismatch must stop before authority, enablement, or run reads.');
}

{
  const dependencies = makeDependencies({ run: { plan_id: 'plan-other' } });
  const projector = createHostingerStorageTenantSafeDurableProjection({
    composition: dependencies.composition,
    authority_store: dependencies.authorityStore,
    enablement_registry: dependencies.enablementRegistry,
  });
  await assert.rejects(projector.project(request()), (error) => error.code === 'STORAGE_TENANT_PROJECTION_RUN_BINDING_MISMATCH');
}

{
  const dependencies = makeDependencies({ allowlist: { workspace_id: 'workspace-other' } });
  const projector = createHostingerStorageTenantSafeDurableProjection({
    composition: dependencies.composition,
    authority_store: dependencies.authorityStore,
    enablement_registry: dependencies.enablementRegistry,
  });
  await assert.rejects(projector.project(request()), (error) => error.code === 'STORAGE_TENANT_PROJECTION_ALLOWLIST_BINDING_MISMATCH');
}

{
  const dependencies = makeDependencies({ consumption: null });
  const projector = createHostingerStorageTenantSafeDurableProjection({
    composition: dependencies.composition,
    authority_store: dependencies.authorityStore,
    enablement_registry: dependencies.enablementRegistry,
  });
  await assert.rejects(projector.project(request()), (error) => error.code === 'STORAGE_TENANT_PROJECTION_CONSUMPTION_STATE_MISMATCH');
}

{
  const dependencies = makeDependencies({ authorityFingerprint: h('6') });
  assert.throws(
    () => createHostingerStorageTenantSafeDurableProjection({
      composition: dependencies.composition,
      authority_store: dependencies.authorityStore,
      enablement_registry: dependencies.enablementRegistry,
    }),
    (error) => error.code === 'STORAGE_TENANT_PROJECTION_DATABASE_PROVENANCE_MISMATCH',
  );
}

{
  const dependencies = makeDependencies();
  const projector = createHostingerStorageTenantSafeDurableProjection({
    composition: dependencies.composition,
    authority_store: dependencies.authorityStore,
    enablement_registry: dependencies.enablementRegistry,
  });
  await assert.rejects(
    projector.project({ ...request(), api_key: 'forbidden' }),
    (error) => error.code === 'STORAGE_TENANT_PROJECTION_SECRET_OR_UNSAFE_FIELD_REJECTED',
  );
}

console.log(JSON.stringify({
  ok: true,
  contract: 'hostinger_storage_tenant_safe_durable_projection_v1',
  audience_checked_before_secondary_reads: true,
  sensitive_refs_redacted: true,
  durable_sql: true,
  read_only: true,
  runtime_mounted: false,
  route_mounted: false,
  worker_mounted: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  secrets_included: false,
}));
