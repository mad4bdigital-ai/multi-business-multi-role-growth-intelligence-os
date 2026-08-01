#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildHostingerStorageTenantCanaryAuthorization,
  verifyHostingerStorageTenantCanaryAuthorization,
} from './hostingerStorageTenantCanaryPolicy.js';
import {
  createMemoryHostingerStorageTenantCanaryEnablementRegistry,
  executeHostingerStorageTenantCanary,
} from './hostingerStorageTenantCanary.js';
import { createSyntheticExecutorFixture, h } from './test-hostinger-storage-executor-fixtures.mjs';

function canaryInputs(fixture, overrides = {}) {
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
    ...(overrides.allowlist || {}),
  };
  const approval = {
    approval_id: `canary-approval-${fixture.operation_id}`,
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
    ...(overrides.approval || {}),
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
    ...(overrides.enablement || {}),
  };
  return { operation, allowlist, approval, enablement };
}

function authorize(fixture, overrides = {}, now = 1100) {
  const inputs = canaryInputs(fixture, overrides);
  const authorization = buildHostingerStorageTenantCanaryAuthorization({
    operation: inputs.operation,
    protocol: fixture.protocol.protocol,
    protocol_digest: fixture.protocol.protocol_digest,
    allowlist_entry: inputs.allowlist,
    workspace_owner_approval: inputs.approval,
    manual_enablement: inputs.enablement,
    now_epoch: now,
  });
  return { ...inputs, authorization };
}

function register(registry, fixture, authorization) {
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

const fixture = createSyntheticExecutorFixture({
  run_id: 'tenant-canary-run-1',
  operation_id: 'tenant-canary-operation-1',
  plan_id: 'tenant-canary-plan-1',
  target_id: 'tenant-canary-target-1',
});
const ready = authorize(fixture);
assert.equal(ready.authorization.canary_ready, true);
assert.deepEqual(ready.authorization.blockers, []);
assert.equal(ready.authorization.dispatch_allowed, false);
assert.equal(ready.authorization.live_provider_allowed, false);
assert.equal(ready.authorization.production_ready, false);
const verified = verifyHostingerStorageTenantCanaryAuthorization({
  authorization: ready.authorization.authorization,
  expected_digest: ready.authorization.authorization_digest,
  now_epoch: 1100,
});
assert.equal(verified.valid, true);

const registry = createMemoryHostingerStorageTenantCanaryEnablementRegistry();
register(registry, fixture, ready.authorization);
const applied = executeHostingerStorageTenantCanary({
  canary_authorization: ready.authorization,
  protocol: fixture.protocol.protocol,
  protocol_digest: fixture.protocol.protocol_digest,
  repository: fixture.repository,
  adapter: fixture.adapter,
  enablement_registry: registry,
  now_epoch: 1100,
});
assert.equal(applied.outcome, 'applied');
assert.equal(applied.projection.tenant_id, 'tenant-1');
assert.equal(applied.projection.workspace_id, 'workspace-1');
assert.equal(applied.projection.resource_id, 'resource-1');
assert.equal(applied.projection.tenant_exclusive, true);
assert.equal(applied.projection.manual_enablement_consumed, true);
assert.equal(applied.projection.live_provider_mutated, false);
assert.equal(applied.projection.dispatch_allowed, false);
assert.equal(registry.exportState()[0].consumed, true);
assert.equal(registry.exportState()[0].generation, 2);
assert.throws(
  () => executeHostingerStorageTenantCanary({
    canary_authorization: ready.authorization,
    protocol: fixture.protocol.protocol,
    protocol_digest: fixture.protocol.protocol_digest,
    repository: fixture.repository,
    adapter: fixture.adapter,
    enablement_registry: registry,
    now_epoch: 1110,
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_ENABLEMENT_GENERATION_MISMATCH'
    || error.code === 'STORAGE_TENANT_CANARY_ENABLEMENT_ALREADY_CONSUMED',
);

const interruptedFixture = createSyntheticExecutorFixture({
  run_id: 'tenant-canary-run-interrupted',
  operation_id: 'tenant-canary-operation-interrupted',
  plan_id: 'tenant-canary-plan-interrupted',
  target_id: 'tenant-canary-target-interrupted',
});
const interruptedAuthorization = authorize(interruptedFixture).authorization;
const interruptedRegistry = createMemoryHostingerStorageTenantCanaryEnablementRegistry();
register(interruptedRegistry, interruptedFixture, interruptedAuthorization);
const interrupted = executeHostingerStorageTenantCanary({
  canary_authorization: interruptedAuthorization,
  protocol: interruptedFixture.protocol.protocol,
  protocol_digest: interruptedFixture.protocol.protocol_digest,
  repository: interruptedFixture.repository,
  adapter: interruptedFixture.adapter,
  enablement_registry: interruptedRegistry,
  fault: { phase: 'after_prepared', item_id: 'item-1' },
  now_epoch: 1100,
});
assert.equal(interrupted.outcome, 'unknown_outcome');
assert.equal(interrupted.projection.read_before_retry_required, true);
assert.equal(interruptedRegistry.exportState()[0].consumed, true);
assert.equal(interruptedFixture.repository.readAggregate(interruptedFixture.operation_id).operation.state, 'unknown_outcome');

const crossTenantFixture = createSyntheticExecutorFixture({
  run_id: 'tenant-canary-run-cross', operation_id: 'tenant-canary-operation-cross', plan_id: 'tenant-canary-plan-cross', target_id: 'tenant-canary-target-cross',
});
const crossTenant = authorize(crossTenantFixture, { allowlist: { tenant_id: 'tenant-other' } }).authorization;
assert.equal(crossTenant.canary_ready, false);
assert(crossTenant.blockers.includes('STORAGE_TENANT_CANARY_ALLOWLIST_TENANT_ID_MISMATCH'));

const sharedFixture = createSyntheticExecutorFixture({
  run_id: 'tenant-canary-run-shared', operation_id: 'tenant-canary-operation-shared', plan_id: 'tenant-canary-plan-shared', target_id: 'tenant-canary-target-shared',
});
const shared = authorize(sharedFixture, { allowlist: { target_scope: 'shared', shared_target: true } }).authorization;
assert.equal(shared.canary_ready, false);
assert(shared.blockers.includes('STORAGE_TENANT_CANARY_TENANT_EXCLUSIVE_TARGET_REQUIRED'));

const expiredFixture = createSyntheticExecutorFixture({
  run_id: 'tenant-canary-run-expired', operation_id: 'tenant-canary-operation-expired', plan_id: 'tenant-canary-plan-expired', target_id: 'tenant-canary-target-expired',
});
const expired = authorize(expiredFixture, { allowlist: { expires_at_epoch: 1099 }, enablement: { expires_at_epoch: 1099 } }).authorization;
assert.equal(expired.canary_ready, false);
assert(expired.blockers.includes('STORAGE_TENANT_CANARY_ALLOWLIST_EXPIRED'));
assert(expired.blockers.includes('STORAGE_TENANT_CANARY_ENABLEMENT_EXPIRED'));

const wrongApproverFixture = createSyntheticExecutorFixture({
  run_id: 'tenant-canary-run-approver', operation_id: 'tenant-canary-operation-approver', plan_id: 'tenant-canary-plan-approver', target_id: 'tenant-canary-target-approver',
});
const wrongApprover = authorize(wrongApproverFixture, { approval: { approver_role: 'workspace_editor' } }).authorization;
assert.equal(wrongApprover.canary_ready, false);
assert(wrongApprover.blockers.includes('STORAGE_TENANT_CANARY_WORKSPACE_OWNER_APPROVAL_REQUIRED'));

const overLimitFixture = createSyntheticExecutorFixture({
  run_id: 'tenant-canary-run-limit', operation_id: 'tenant-canary-operation-limit', plan_id: 'tenant-canary-plan-limit', target_id: 'tenant-canary-target-limit',
});
const overLimit = authorize(overLimitFixture, { allowlist: { max_bytes: 100 } }).authorization;
assert.equal(overLimit.canary_ready, false);
assert(overLimit.blockers.includes('STORAGE_TENANT_CANARY_BYTE_LIMIT_EXCEEDED'));

const pathMismatchFixture = createSyntheticExecutorFixture({
  run_id: 'tenant-canary-run-path', operation_id: 'tenant-canary-operation-path', plan_id: 'tenant-canary-plan-path', target_id: 'tenant-canary-target-path',
});
const pathMismatch = authorize(pathMismatchFixture, { allowlist: { path_ref_prefix: 'tenant-root/' } }).authorization;
assert.equal(pathMismatch.canary_ready, false);
assert(pathMismatch.blockers.includes('STORAGE_TENANT_CANARY_PATH_PREFIX_MISMATCH'));

const unsafeRegistryFixture = createSyntheticExecutorFixture({
  run_id: 'tenant-canary-run-registry', operation_id: 'tenant-canary-operation-registry', plan_id: 'tenant-canary-plan-registry', target_id: 'tenant-canary-target-registry',
});
const unsafeRegistryAuthorization = authorize(unsafeRegistryFixture).authorization;
assert.throws(
  () => executeHostingerStorageTenantCanary({
    canary_authorization: unsafeRegistryAuthorization,
    protocol: unsafeRegistryFixture.protocol.protocol,
    protocol_digest: unsafeRegistryFixture.protocol.protocol_digest,
    repository: unsafeRegistryFixture.repository,
    adapter: unsafeRegistryFixture.adapter,
    enablement_registry: { synthetic_only: false, production_ready: true },
    now_epoch: 1100,
  }),
  (error) => error.code === 'STORAGE_TENANT_CANARY_ENABLEMENT_REGISTRY_INVALID',
);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_tenant_canary',
  tenant_exclusive_allowlist: true,
  workspace_owner_approval_required: true,
  manual_one_shot_enablement_consumed: true,
  unknown_outcome_consumes_enablement: true,
  cross_tenant_and_shared_targets_rejected: true,
  bounded_items_and_bytes: true,
  synthetic_only: true,
  dispatch_allowed: false,
  live_provider_mutated: false,
  production_ready: false,
  secrets_included: false,
}));
