#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildHostingerStorageTenantCanaryAuthorization } from './hostingerStorageTenantCanaryPolicy.js';
import {
  createHostingerStorageTenantCanaryControlPlaneRepository,
  createHostingerStorageTenantCanarySyntheticAdapter,
  createMemoryHostingerStorageTenantCanaryAuthorityStore,
  createMemoryHostingerStorageTenantCanaryEnablementRegistry,
  executeHostingerStorageTenantCanary,
} from './hostingerStorageTenantCanary.js';
import { isCanonicalHostingerStorageControlPlaneRepository } from './hostingerStorageControlPlaneRepository.js';
import {
  createSyntheticExecutorFixture as createBaseSyntheticExecutorFixture,
  h,
} from './test-hostinger-storage-executor-fixtures.mjs';

function createFixture() {
  const base = createBaseSyntheticExecutorFixture({
    run_id: 'tenant-canary-repository-provenance-run',
    operation_id: 'tenant-canary-repository-provenance-operation',
    plan_id: 'tenant-canary-repository-provenance-plan',
    target_id: 'tenant-canary-repository-provenance-target',
  });
  const items = base.adapter.exportState().items.map((item) => ({
    item_id: item.item_id,
    path_ref: item.path_ref,
    item_hash: item.item_hash,
    metadata: item.metadata,
    exists: item.exists,
    protected: item.protected,
  }));
  return {
    ...base,
    direct_repository: base.repository,
    repository: createHostingerStorageTenantCanaryControlPlaneRepository({
      snapshot: base.repository.exportSnapshot(),
    }),
    adapter: createHostingerStorageTenantCanarySyntheticAdapter({ items }),
  };
}

function authorize(fixture, now = 1100) {
  const operation = fixture.repository.readAggregate(fixture.operation_id).operation;
  return buildHostingerStorageTenantCanaryAuthorization({
    operation,
    protocol: fixture.protocol.protocol,
    protocol_digest: fixture.protocol.protocol_digest,
    immutable_plan: fixture.plan,
    allowlist_entry: {
      allowlist_id: `allowlist-${fixture.operation_id}`,
      revision: 'allowlist-r1',
      status: 'active',
      environment: 'synthetic_non_production',
      target_scope: 'tenant_exclusive',
      tenant_id: operation.tenant_id,
      workspace_id: operation.workspace_id,
      resource_id: operation.resource_id,
      target_id: operation.target_id,
      root_ref: `tenant-roots/${operation.tenant_id}/${operation.workspace_id}/${operation.resource_id}`,
      path_ref_prefix: 'paths/',
      shared_target: false,
      platform_target: false,
      valid_from_epoch: 1000,
      expires_at_epoch: 1500,
      max_items: 5,
      max_bytes: 10_000,
      evidence_digest: h('a'),
    },
    workspace_owner_approval: {
      approval_id: `approval-${fixture.operation_id}`,
      slot: `workspace_owner:${operation.workspace_id}`,
      status: 'approved',
      tenant_id: operation.tenant_id,
      workspace_id: operation.workspace_id,
      operation_id: operation.operation_id,
      target_id: operation.target_id,
      plan_hash: fixture.protocol.protocol.plan_hash,
      authority_context_hash: operation.authority_context_hash,
      approver_role: 'workspace_owner',
      approved_at_epoch: 1050,
      expires_at_epoch: 1450,
      evidence_digest: h('b'),
    },
    manual_enablement: {
      enablement_id: `enablement-${fixture.operation_id}`,
      mode: 'manual_one_shot',
      status: 'enabled',
      tenant_id: operation.tenant_id,
      workspace_id: operation.workspace_id,
      resource_id: operation.resource_id,
      operation_id: operation.operation_id,
      target_id: operation.target_id,
      plan_hash: fixture.protocol.protocol.plan_hash,
      allowlist_revision: 'allowlist-r1',
      approved_by_role: 'workspace_owner',
      enabled_at_epoch: 1060,
      expires_at_epoch: 1400,
      generation: 1,
      consumed: false,
      evidence_digest: h('c'),
    },
    now_epoch: now,
  });
}

function prepare(fixture, authorization) {
  assert.equal(authorization.canary_ready, true);
  const authorityStore = createMemoryHostingerStorageTenantCanaryAuthorityStore();
  authorityStore.registerAllowlist(authorization.authorization.allowlist);
  authorityStore.registerApproval(authorization.authorization.workspace_owner_approval);

  const registry = createMemoryHostingerStorageTenantCanaryEnablementRegistry();
  const enablement = authorization.authorization.manual_enablement;
  registry.register({
    enablement_id: enablement.enablement_id,
    authorization_digest: authorization.authorization_digest,
    operation_id: fixture.operation_id,
    run_id: fixture.run_id,
    generation: enablement.generation,
    expires_at_epoch: enablement.expires_at_epoch,
  });
  return { authorityStore, registry };
}

function execute({ fixture, authorization, authorityStore, registry, repository, adapter }) {
  return executeHostingerStorageTenantCanary({
    canary_authorization: authorization,
    protocol: fixture.protocol.protocol,
    protocol_digest: fixture.protocol.protocol_digest,
    repository,
    adapter,
    authority_store: authorityStore,
    enablement_registry: registry,
    now_epoch: 1100,
  });
}

function assertUnconsumedAndUnchanged(fixture, registry) {
  assert.equal(registry.exportState()[0].consumed, false);
  assert.equal(fixture.adapter.exportState().items[0].exists, true);
  assert.equal(fixture.repository.readAggregate(fixture.operation_id).operation.state, 'lease_acquired');
}

const fixture = createFixture();
assert.equal(isCanonicalHostingerStorageControlPlaneRepository(fixture.direct_repository), true);
assert.equal(isCanonicalHostingerStorageControlPlaneRepository(fixture.repository), true);
assert.notEqual(fixture.repository, fixture.direct_repository);
assert.equal(Object.isFrozen(fixture.repository), true);
assert.equal(fixture.repository.repository_version, 'spec014-storage-control-plane-repository-v1');
assert.equal(fixture.repository.adapter_key, 'hostinger_storage_memory_test_adapter_v1');
assert.equal(fixture.repository.production_ready, false);

const directAuthorization = authorize(fixture);
const directPrepared = prepare(fixture, directAuthorization);
assert.throws(
  () => execute({
    fixture,
    authorization: directAuthorization,
    ...directPrepared,
    repository: fixture.direct_repository,
    adapter: fixture.adapter,
  }),
  (error) => error?.status === 409
    && error?.code === 'STORAGE_TENANT_CANARY_CONTROL_PLANE_INVALID'
    && error?.details?.repository_provenance === 'tenant_and_control_plane_factory_owned_required'
    && error?.details?.expected_repository_version === 'spec014-storage-control-plane-repository-v1'
    && error?.details?.expected_adapter_key === 'hostinger_storage_memory_test_adapter_v1',
);
assertUnconsumedAndUnchanged(fixture, directPrepared.registry);

const missingAdapterAuthorization = authorize(fixture);
const missingAdapterPrepared = prepare(fixture, missingAdapterAuthorization);
assert.throws(
  () => execute({
    fixture,
    authorization: missingAdapterAuthorization,
    ...missingAdapterPrepared,
    repository: fixture.repository,
    adapter: null,
  }),
  (error) => error?.status === 409
    && error?.code === 'STORAGE_TENANT_CANARY_EXECUTOR_ADAPTER_INVALID',
);
assertUnconsumedAndUnchanged(fixture, missingAdapterPrepared.registry);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_tenant_canary_repository_provenance',
  direct_control_plane_repository_rejected: true,
  tenant_factory_repository_control_plane_canonical: true,
  repository_identity_metadata_pinned: true,
  missing_adapter_is_explicit_null: true,
  validation_before_one_shot_consumption: true,
  existing_ast_and_store_provenance_tests_preserved: true,
  synthetic_only: true,
  production_ready: false,
  secrets_included: false,
}));
