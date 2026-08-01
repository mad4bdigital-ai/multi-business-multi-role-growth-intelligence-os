#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

const wrapperSource = fs.readFileSync(new URL('./hostingerStorageTenantCanary.js', import.meta.url), 'utf8');
assert.match(wrapperSource, /from '\.\/hostingerStorageTenantCanaryBase\.js';/u);
assert.doesNotMatch(wrapperSource, /new WeakSet\(\)/u);
assert.doesNotMatch(wrapperSource, /function requireCanonical(?:Repository|Adapter)/u);
assert.doesNotMatch(wrapperSource, /executeBaseTenantCanary/u);

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

function buildAuthorizedContext(fixture, now = 1100) {
  const operation = fixture.repository.readAggregate(fixture.operation_id).operation;
  const allowlist = {
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
  };
  const approval = {
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
  };
  const enablement = {
    enablement_id: `enablement-${fixture.operation_id}`,
    mode: 'manual_one_shot',
    status: 'enabled',
    tenant_id: operation.tenant_id,
    workspace_id: operation.workspace_id,
    resource_id: operation.resource_id,
    operation_id: operation.operation_id,
    target_id: operation.target_id,
    plan_hash: fixture.protocol.protocol.plan_hash,
    allowlist_revision: allowlist.revision,
    approved_by_role: 'workspace_owner',
    enabled_at_epoch: 1060,
    expires_at_epoch: 1400,
    generation: 1,
    consumed: false,
    evidence_digest: h('c'),
  };
  const authorization = buildHostingerStorageTenantCanaryAuthorization({
    operation,
    protocol: fixture.protocol.protocol,
    protocol_digest: fixture.protocol.protocol_digest,
    immutable_plan: fixture.plan,
    allowlist_entry: allowlist,
    workspace_owner_approval: approval,
    manual_enablement: enablement,
    now_epoch: now,
  });
  assert.equal(authorization.canary_ready, true);

  const authorityStore = createMemoryHostingerStorageTenantCanaryAuthorityStore();
  authorityStore.registerAllowlist(authorization.authorization.allowlist);
  authorityStore.registerApproval(authorization.authorization.workspace_owner_approval);
  const registry = createMemoryHostingerStorageTenantCanaryEnablementRegistry();
  registry.register({
    enablement_id: enablement.enablement_id,
    authorization_digest: authorization.authorization_digest,
    operation_id: fixture.operation_id,
    run_id: fixture.run_id,
    generation: enablement.generation,
    expires_at_epoch: enablement.expires_at_epoch,
  });
  return { authorization, authorityStore, registry, now };
}

function execute(fixture, context, repository, adapter = fixture.adapter) {
  return executeHostingerStorageTenantCanary({
    canary_authorization: context.authorization,
    protocol: fixture.protocol.protocol,
    protocol_digest: fixture.protocol.protocol_digest,
    repository,
    adapter,
    authority_store: context.authorityStore,
    enablement_registry: context.registry,
    now_epoch: context.now,
  });
}

const fixture = createFixture();
assert.equal(isCanonicalHostingerStorageControlPlaneRepository(fixture.direct_repository), true);
assert.equal(isCanonicalHostingerStorageControlPlaneRepository(fixture.repository), true);
assert.notEqual(fixture.repository, fixture.direct_repository);
assert.equal(Object.isFrozen(fixture.repository), true);
assert.equal(fixture.repository.repository_version, 'spec014-storage-control-plane-repository-v1');
assert.equal(fixture.repository.adapter_key, 'hostinger_storage_memory_test_adapter_v1');
assert.equal(fixture.repository.production_ready, false);

const directContext = buildAuthorizedContext(fixture);
assert.throws(
  () => execute(fixture, directContext, fixture.direct_repository),
  (error) => error?.status === 409
    && error?.code === 'STORAGE_TENANT_CANARY_CONTROL_PLANE_INVALID'
    && error?.details?.repository_provenance === 'tenant_and_control_plane_factory_owned_required'
    && error?.details?.expected_repository_version === 'spec014-storage-control-plane-repository-v1'
    && error?.details?.expected_adapter_key === 'hostinger_storage_memory_test_adapter_v1',
);
assert.equal(directContext.registry.exportState()[0].consumed, false);

const missingAdapterContext = buildAuthorizedContext(fixture);
assert.throws(
  () => execute(fixture, missingAdapterContext, fixture.repository, undefined),
  (error) => error?.status === 409
    && error?.code === 'STORAGE_TENANT_CANARY_EXECUTOR_ADAPTER_INVALID',
);
assert.equal(missingAdapterContext.registry.exportState()[0].consumed, false);

const copiedTenantRepository = Object.freeze({ ...fixture.repository });
assert.equal(isCanonicalHostingerStorageControlPlaneRepository(copiedTenantRepository), false);
const copiedContext = buildAuthorizedContext(fixture);
assert.throws(
  () => execute(fixture, copiedContext, copiedTenantRepository),
  (error) => error?.status === 409
    && error?.code === 'STORAGE_TENANT_CANARY_CONTROL_PLANE_INVALID'
    && error?.details?.repository_provenance === 'tenant_and_control_plane_factory_owned_required',
);
assert.equal(copiedContext.registry.exportState()[0].consumed, false);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_tenant_canary_repository_provenance',
  wrapper_is_reexport_only: true,
  single_base_provenance_authority: true,
  valid_authorization_precondition_preserved: true,
  direct_control_plane_repository_rejected: true,
  tenant_factory_repository_control_plane_canonical: true,
  repository_identity_metadata_pinned: true,
  copied_tenant_repository_rejected: true,
  validation_before_one_shot_consumption: true,
  production_ready: false,
  secrets_included: false,
}));
