#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildHostingerStorageTenantCanaryAuthorization } from './hostingerStorageTenantCanaryPolicy.js';
import {
  createMemoryHostingerStorageTenantCanaryAuthorityStore,
  createMemoryHostingerStorageTenantCanaryEnablementRegistry,
  executeHostingerStorageTenantCanary,
} from './hostingerStorageTenantCanary.js';
import { createSyntheticExecutorFixture, h } from './test-hostinger-storage-executor-fixtures.mjs';

const fixture = createSyntheticExecutorFixture({
  run_id: 'tenant-canary-preflight-run',
  operation_id: 'tenant-canary-preflight-operation',
  plan_id: 'tenant-canary-preflight-plan',
  target_id: 'tenant-canary-preflight-target',
});
const operation = fixture.repository.readAggregate(fixture.operation_id).operation;
const allowlist = {
  allowlist_id: 'tenant-canary-preflight-allowlist',
  revision: 'allowlist-r1',
  status: 'active',
  environment: 'synthetic_non_production',
  target_scope: 'tenant_exclusive',
  tenant_id: operation.tenant_id,
  workspace_id: operation.workspace_id,
  resource_id: operation.resource_id,
  target_id: operation.target_id,
  root_ref: 'tenant-roots/tenant-1/workspace-1/resource-1',
  path_ref_prefix: 'paths/',
  shared_target: false,
  platform_target: false,
  valid_from_epoch: 1000,
  expires_at_epoch: 1500,
  max_items: 5,
  max_bytes: 10000,
  evidence_digest: h('a'),
  secrets_included: false,
};
const approval = {
  approval_id: 'tenant-canary-preflight-approval',
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
  secrets_included: false,
};
const enablement = {
  enablement_id: 'tenant-canary-preflight-enablement',
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
  secrets_included: false,
};
const authorization = buildHostingerStorageTenantCanaryAuthorization({
  operation,
  protocol: fixture.protocol.protocol,
  protocol_digest: fixture.protocol.protocol_digest,
  immutable_plan: fixture.plan,
  allowlist_entry: allowlist,
  workspace_owner_approval: approval,
  manual_enablement: enablement,
  now_epoch: 1100,
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
  generation: 1,
  expires_at_epoch: enablement.expires_at_epoch,
});

const incompleteRepository = {
  production_ready: false,
  readAggregate: fixture.repository.readAggregate.bind(fixture.repository),
};
assert.throws(
  () => executeHostingerStorageTenantCanary({
    canary_authorization: authorization,
    protocol: fixture.protocol.protocol,
    protocol_digest: fixture.protocol.protocol_digest,
    repository: incompleteRepository,
    adapter: fixture.adapter,
    authority_store: authorityStore,
    enablement_registry: registry,
    now_epoch: 1100,
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_CONTROL_PLANE_INVALID'
    && error.details?.missing_methods?.includes('transitionOperation')
    && error.details?.missing_methods?.includes('consumePlan')
    && error.details?.missing_methods?.includes('appendJournalEvent')
    && error.details?.missing_methods?.includes('recordReconciliation'),
);
assert.equal(registry.exportState()[0].consumed, false);
assert.equal(registry.exportState()[0].generation, 1);
assert.equal(fixture.repository.readAggregate(fixture.operation_id).journals.length, 0);
assert.equal(fixture.adapter.exportState().items[0].exists, true);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_tenant_canary_preflight_contract_v2',
  full_repository_contract_required: true,
  incomplete_repository_rejected_before_consumption: true,
  adapter_unchanged: true,
  synthetic_only: true,
  production_ready: false,
  secrets_included: false,
}));
