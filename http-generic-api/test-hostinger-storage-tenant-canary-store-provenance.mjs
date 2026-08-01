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
import {
  createSyntheticExecutorFixture as createBaseSyntheticExecutorFixture,
  h,
} from './test-hostinger-storage-executor-fixtures.mjs';

function createFixture(options = {}) {
  const fixture = createBaseSyntheticExecutorFixture(options);
  const items = fixture.adapter.exportState().items.map((item) => ({
    item_id: item.item_id,
    path_ref: item.path_ref,
    item_hash: item.item_hash,
    metadata: item.metadata,
    exists: item.exists,
    protected: item.protected,
  }));
  return {
    ...fixture,
    repository: createHostingerStorageTenantCanaryControlPlaneRepository({
      snapshot: fixture.repository.exportSnapshot(),
    }),
    adapter: createHostingerStorageTenantCanarySyntheticAdapter({ items }),
  };
}

function authorize(fixture) {
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
    now_epoch: 1100,
  });
}

function registerAuthority(store, authorization) {
  store.registerAllowlist(authorization.authorization.allowlist);
  store.registerApproval(authorization.authorization.workspace_owner_approval);
}

function registerEnablement(registry, fixture, authorization) {
  const enablement = authorization.authorization.manual_enablement;
  registry.register({
    enablement_id: enablement.enablement_id,
    authorization_digest: authorization.authorization_digest,
    operation_id: fixture.operation_id,
    run_id: fixture.run_id,
    generation: enablement.generation,
    expires_at_epoch: enablement.expires_at_epoch,
  });
}

function execute({ fixture, authorization, authorityStore, registry }) {
  return executeHostingerStorageTenantCanary({
    canary_authorization: authorization,
    protocol: fixture.protocol.protocol,
    protocol_digest: fixture.protocol.protocol_digest,
    repository: fixture.repository,
    adapter: fixture.adapter,
    authority_store: authorityStore,
    enablement_registry: registry,
    now_epoch: 1100,
  });
}

function assertUnchanged(fixture) {
  assert.equal(fixture.adapter.exportState().items[0].exists, true);
  assert.equal(fixture.repository.readAggregate(fixture.operation_id).operation.state, 'lease_acquired');
}

const authorityFixture = createFixture({
  run_id: 'tenant-canary-forged-authority-run',
  operation_id: 'tenant-canary-forged-authority-operation',
  plan_id: 'tenant-canary-forged-authority-plan',
  target_id: 'tenant-canary-forged-authority-target',
});
const authorityAuthorization = authorize(authorityFixture);
const genuineRegistry = createMemoryHostingerStorageTenantCanaryEnablementRegistry();
registerEnablement(genuineRegistry, authorityFixture, authorityAuthorization);
let authorityReadCalled = false;
const forgedAuthorityStore = Object.freeze({
  adapter_key: 'memory_hostinger_storage_tenant_canary_authority_v1',
  synthetic_only: true,
  production_ready: false,
  readAllowlist() {
    authorityReadCalled = true;
    return structuredClone(authorityAuthorization.authorization.allowlist);
  },
  readApproval() {
    authorityReadCalled = true;
    return structuredClone(authorityAuthorization.authorization.workspace_owner_approval);
  },
});
assert.throws(
  () => execute({
    fixture: authorityFixture,
    authorization: authorityAuthorization,
    authorityStore: forgedAuthorityStore,
    registry: genuineRegistry,
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_AUTHORITY_STORE_INVALID'
    && error.details?.authority_store_provenance === 'tenant_factory_owned_required',
);
assert.equal(authorityReadCalled, false);
assert.equal(genuineRegistry.exportState()[0].consumed, false);
assertUnchanged(authorityFixture);

const registryFixture = createFixture({
  run_id: 'tenant-canary-forged-registry-run',
  operation_id: 'tenant-canary-forged-registry-operation',
  plan_id: 'tenant-canary-forged-registry-plan',
  target_id: 'tenant-canary-forged-registry-target',
});
const registryAuthorization = authorize(registryFixture);
const genuineAuthorityStore = createMemoryHostingerStorageTenantCanaryAuthorityStore();
registerAuthority(genuineAuthorityStore, registryAuthorization);
let registryReadCalled = false;
let registryConsumeCalled = false;
const forgedRegistry = Object.freeze({
  adapter_key: 'memory_hostinger_storage_tenant_canary_enablement_v1',
  synthetic_only: true,
  production_ready: false,
  read() {
    registryReadCalled = true;
    return {};
  },
  consume() {
    registryConsumeCalled = true;
    return {};
  },
});
assert.throws(
  () => execute({
    fixture: registryFixture,
    authorization: registryAuthorization,
    authorityStore: genuineAuthorityStore,
    registry: forgedRegistry,
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_ENABLEMENT_REGISTRY_INVALID'
    && error.details?.enablement_registry_provenance === 'tenant_factory_owned_required',
);
assert.equal(registryReadCalled, false);
assert.equal(registryConsumeCalled, false);
assertUnchanged(registryFixture);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_tenant_canary_store_provenance',
  authority_store_factory_brand_required: true,
  enablement_registry_factory_brand_required: true,
  forged_authority_read_not_invoked: true,
  forged_registry_read_not_invoked: true,
  forged_registry_consume_not_invoked: true,
  one_shot_not_consumed_on_authority_rejection: true,
  synthetic_mutation_not_started: true,
  production_ready: false,
  secrets_included: false,
}));
